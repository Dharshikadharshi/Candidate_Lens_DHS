"""Shared AI client: one place for provider calls, error mapping and usage accounting.

Services call AIClient; AIClient calls a provider (OpenAIProvider in production, a fake in
tests). Every call - success or failure - is recorded in ai_usage_events. Prompt/response
content is never logged.
"""
import json
import logging
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Callable, Optional, Type, TypeVar

from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class AIError(Exception):
    """kind: not_configured | auth | rate_limited | timeout | connection | context_length |
    invalid_output | refused | provider_error"""

    RETRYABLE = {"rate_limited", "timeout", "connection", "provider_error", "invalid_output"}

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind
        self.message = message

    @property
    def retryable(self) -> bool:
        return self.kind in self.RETRYABLE

    def public_message(self) -> str:
        return {
            "not_configured": "AI features are not configured (OPENAI_API_KEY is missing).",
            "auth": "The AI provider rejected the API credentials.",
            "rate_limited": "The AI provider is rate limiting requests. Please retry shortly.",
            "timeout": "The AI provider timed out. Please retry.",
            "connection": "Could not reach the AI provider. Please retry.",
            "context_length": "The content was too long for the AI model.",
            "invalid_output": "The AI returned an unusable response. Please retry.",
            "refused": "The AI declined to process this content.",
        }.get(self.kind, "The AI provider returned an error. Please retry.")


@dataclass
class ProviderResult:
    parsed: Any
    model: str
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None


@dataclass
class TranscriptionResult:
    text: str
    model: str
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None


class OpenAIProvider:
    name = "openai"

    def __init__(self, api_key: str):
        from openai import OpenAI

        self._client = OpenAI(
            api_key=api_key,
            timeout=settings.OPENAI_TIMEOUT_SECONDS,
            max_retries=settings.OPENAI_MAX_RETRIES,  # SDK retries 429/5xx/connection errors with backoff
        )

    def _map_error(self, exc: Exception) -> AIError:
        import openai

        cause = exc.__cause__ or exc.__context__
        # Class names and status only - never request or response content.
        logger.warning("openai call failed: %s status=%s cause=%s", exc.__class__.__name__,
                       getattr(exc, "status_code", None), cause.__class__.__name__ if cause else None)

        if isinstance(exc, openai.RateLimitError):
            return AIError("rate_limited", str(exc))
        if isinstance(exc, openai.APITimeoutError):
            return AIError("timeout", str(exc))
        if isinstance(exc, openai.APIConnectionError):
            return AIError("connection", str(exc))
        if isinstance(exc, (openai.AuthenticationError, openai.PermissionDeniedError)):
            return AIError("auth", str(exc))
        if isinstance(exc, openai.BadRequestError):
            code = getattr(exc, "code", "") or ""
            if "context_length" in code or "context_length" in str(exc):
                return AIError("context_length", str(exc))
            return AIError("provider_error", str(exc))
        if isinstance(exc, (openai.LengthFinishReasonError, ValidationError)):
            return AIError("invalid_output", str(exc))
        if isinstance(exc, openai.APIError):
            return AIError("provider_error", str(exc))
        return AIError("provider_error", exc.__class__.__name__)

    def parse(self, *, model: str, instructions: str, input: str, schema: Type[T], max_output_tokens: int) -> ProviderResult:
        kwargs = dict(
            model=model, instructions=instructions, input=input, text_format=schema,
            max_output_tokens=max_output_tokens, store=False,
        )
        if settings.OPENAI_REASONING_EFFORT:
            kwargs["reasoning"] = {"effort": settings.OPENAI_REASONING_EFFORT}
        try:
            response = self._client.responses.parse(**kwargs)
        except Exception as exc:
            raise self._map_error(exc) from exc

        usage = getattr(response, "usage", None)
        tokens = (getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None))
        for item in response.output or []:
            for content in getattr(item, "content", None) or []:
                if getattr(content, "type", "") == "refusal":
                    raise _with_usage(AIError("refused", "Model refused"), response.model, tokens)
        if response.status == "incomplete" or response.output_parsed is None:
            raise _with_usage(AIError("invalid_output", f"Incomplete response ({response.status})"), response.model, tokens)
        return ProviderResult(response.output_parsed, response.model, *tokens)

    def transcribe(self, *, model: str, filename: str, data: bytes, content_type: str, prompt: Optional[str]) -> TranscriptionResult:
        try:
            kwargs = dict(model=model, file=(filename, data, content_type), response_format="json")
            if prompt:
                kwargs["prompt"] = prompt
            response = self._client.audio.transcriptions.create(**kwargs)
        except Exception as exc:
            raise self._map_error(exc) from exc
        usage = getattr(response, "usage", None)
        return TranscriptionResult(
            text=(getattr(response, "text", "") or "").strip(),
            model=model,
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )


def _with_usage(error: AIError, model: str, tokens: tuple) -> AIError:
    error.model, error.tokens = model, tokens
    return error


@lru_cache
def _pricing() -> dict:
    if not settings.AI_PRICING_JSON:
        return {}
    try:
        return json.loads(settings.AI_PRICING_JSON)
    except ValueError:
        logger.error("AI_PRICING_JSON is not valid JSON; cost estimates disabled")
        return {}


def estimate_cost(model: str, input_tokens: Optional[int], output_tokens: Optional[int],
                  audio_seconds: Optional[float]) -> Optional[float]:
    table = _pricing()
    # Longest configured prefix wins, so "gpt-5.4-mini" prices "gpt-5.4-mini-2026-03-17".
    key = max((k for k in table if model.startswith(k)), key=len, default=None)
    if not key:
        return None
    price = table[key]
    cost = 0.0
    cost += (input_tokens or 0) / 1_000_000 * float(price.get("input_per_1m", 0))
    cost += (output_tokens or 0) / 1_000_000 * float(price.get("output_per_1m", 0))
    cost += (audio_seconds or 0) / 60 * float(price.get("per_audio_minute", 0))
    return round(cost, 6)


class AIClient:
    def __init__(self, provider, session_factory: Callable[[], Session]):
        self.provider = provider
        self.session_factory = session_factory

    @property
    def configured(self) -> bool:
        return self.provider is not None

    @property
    def model(self) -> str:
        return settings.OPENAI_MODEL

    def structured(self, operation: str, schema: Type[T], *, instructions: str, input: str,
                   max_output_tokens: int = 4000, interview_id=None, candidate_id=None) -> tuple[T, str]:
        if not self.configured:
            raise AIError("not_configured", "OPENAI_API_KEY is not set")
        started = time.monotonic()
        try:
            result = self.provider.parse(
                model=self.model, instructions=instructions, input=input, schema=schema,
                max_output_tokens=max_output_tokens,
            )
        except AIError as exc:
            model, tokens = getattr(exc, "model", self.model), getattr(exc, "tokens", (None, None))
            self._record(operation, model, tokens[0], tokens[1], None, "error", exc.kind, started, interview_id, candidate_id)
            raise
        if not isinstance(result.parsed, schema):
            self._record(operation, result.model, result.input_tokens, result.output_tokens, None, "error",
                         "invalid_output", started, interview_id, candidate_id)
            raise AIError("invalid_output", "Parsed output has the wrong type")
        self._record(operation, result.model, result.input_tokens, result.output_tokens, None, "success", None,
                     started, interview_id, candidate_id)
        return result.parsed, result.model

    def transcribe(self, data: bytes, filename: str, content_type: str, *, duration_seconds: Optional[float],
                   prompt: Optional[str] = None, interview_id=None) -> TranscriptionResult:
        if not self.configured:
            raise AIError("not_configured", "OPENAI_API_KEY is not set")
        model = settings.OPENAI_TRANSCRIPTION_MODEL
        started = time.monotonic()
        try:
            result = self.provider.transcribe(model=model, filename=filename, data=data, content_type=content_type, prompt=prompt)
        except AIError as exc:
            self._record("transcription", model, None, None, duration_seconds, "error", exc.kind, started, interview_id, None)
            raise
        self._record("transcription", result.model, result.input_tokens, result.output_tokens, duration_seconds,
                     "success", None, started, interview_id, None)
        return result

    def _record(self, operation, model, input_tokens, output_tokens, audio_seconds, status, error_type, started,
                interview_id, candidate_id) -> None:
        from app.models.assessment import AIUsageEvent

        # Own short session so usage is kept even if the caller's transaction rolls back.
        db = self.session_factory()
        try:
            db.add(AIUsageEvent(
                interview_id=interview_id, candidate_id=candidate_id,
                provider=getattr(self.provider, "name", "unknown"), model=model or "unknown", operation=operation,
                input_tokens=input_tokens, output_tokens=output_tokens, audio_duration_seconds=audio_seconds,
                status=status, error_type=error_type, latency_ms=int((time.monotonic() - started) * 1000),
                estimated_cost=estimate_cost(model or "", input_tokens, output_tokens, audio_seconds),
            ))
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Failed to record AI usage event")
        finally:
            db.close()
        logger.info("ai call op=%s model=%s status=%s err=%s in=%s out=%s", operation, model, status, error_type,
                    input_tokens, output_tokens)


@lru_cache
def _default_provider():
    return OpenAIProvider(settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY else None
