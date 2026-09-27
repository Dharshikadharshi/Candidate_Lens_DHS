"""Role profiles used for question generation.

Defaults live here; HR/admins can add or override roles with a JSON file referenced by
AI_ROLE_PROFILES_PATH (same shape as DEFAULT_ROLE_PROFILES). Unknown roles fall back to a
generic profile named after the candidate's target role.
"""
import json
import logging
import re
from functools import lru_cache
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

DEFAULT_ROLE_PROFILES: dict[str, dict] = {
    "backend_developer": {
        "label": "Backend Developer",
        "aliases": ["backend", "backend engineer", "api developer"],
        "technical_topics": [
            "Python", "FastAPI or Django", "REST API design", "PostgreSQL", "database transactions",
            "authentication and authorization", "error handling", "performance and scalability",
            "testing", "deployment",
        ],
        "scenario_themes": [
            "idempotent payment API under client retries",
            "slow PostgreSQL queries during peak traffic",
            "API that works locally but fails after deployment",
            "partially failed booking transaction",
        ],
    },
    "frontend_developer": {
        "label": "Frontend Developer",
        "aliases": ["frontend", "front end developer", "ui developer", "react developer"],
        "technical_topics": [
            "React", "JavaScript/TypeScript", "component design", "state management",
            "API integration", "rendering performance", "accessibility", "testing",
        ],
        "scenario_themes": [
            "slow rendering of a large dataset",
            "duplicate form submissions while a response is delayed",
            "preserving progress in a multi-step form after an API error",
        ],
    },
    "full_stack_developer": {
        "label": "Full Stack Developer",
        "aliases": ["full stack", "fullstack", "full-stack developer", "full stack engineer"],
        "technical_topics": [
            "React", "REST API design", "Python or Node.js backends", "SQL databases",
            "authentication", "state management", "deployment", "testing across layers",
        ],
        "scenario_themes": [
            "end-to-end latency regression after a release",
            "keeping frontend and backend validation consistent",
            "rolling out a schema change without downtime",
        ],
    },
    "python_developer": {
        "label": "Python Developer",
        "aliases": ["python", "python engineer"],
        "technical_topics": [
            "Python data model", "generators and iterators", "concurrency (threads, asyncio, processes)",
            "packaging and dependencies", "testing with pytest", "error handling", "performance profiling",
        ],
        "scenario_themes": [
            "memory growth in a long-running Python service",
            "speeding up a CPU-bound batch job",
            "a flaky test suite in CI",
        ],
    },
    "machine_learning_engineer": {
        "label": "Machine Learning Engineer",
        "aliases": ["ml engineer", "machine learning", "ml", "ai engineer"],
        "technical_topics": [
            "Python", "model training and evaluation", "data preprocessing", "feature engineering",
            "model deployment", "metrics", "overfitting and underfitting", "model monitoring",
        ],
        "scenario_themes": [
            "model performs well on training data but poorly on new data",
            "deployed model accuracy declines over time",
            "serving a model under strict latency requirements",
        ],
    },
    "data_analyst": {
        "label": "Data Analyst",
        "aliases": ["data analytics", "business analyst", "analyst"],
        "technical_topics": [
            "SQL", "data cleaning", "descriptive statistics", "data visualization",
            "spreadsheets/BI tools", "A/B test interpretation", "metric definition",
        ],
        "scenario_themes": [
            "a dashboard metric suddenly drops overnight",
            "conflicting numbers between two reports",
            "presenting uncertain results to stakeholders",
        ],
    },
}


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


@lru_cache
def role_profiles() -> dict[str, dict]:
    profiles = {k: dict(v) for k, v in DEFAULT_ROLE_PROFILES.items()}
    path = settings.AI_ROLE_PROFILES_PATH
    if path:
        try:
            with open(path, encoding="utf-8") as fh:
                extra = json.load(fh)
            for key, profile in extra.items():
                if isinstance(profile, dict) and profile.get("label"):
                    profiles[key] = profile
        except (OSError, ValueError) as exc:
            logger.error("Could not load AI_ROLE_PROFILES_PATH %s: %s", path, exc)
    return profiles


def resolve_role(role: str) -> tuple[Optional[str], dict]:
    """Return (profile_key, profile). Unknown roles get a generic profile."""
    wanted = _normalize(role)
    for key, profile in role_profiles().items():
        names = [profile["label"], key.replace("_", " "), *profile.get("aliases", [])]
        if wanted in {_normalize(n) for n in names}:
            return key, profile
    return None, {"label": role.strip(), "aliases": [], "technical_topics": [], "scenario_themes": []}
