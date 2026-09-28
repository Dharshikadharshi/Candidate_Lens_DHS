"""Usage and cost summaries built from ai_usage_events."""
from collections import defaultdict
from statistics import mean
from typing import Optional

from sqlalchemy.orm import Session

from app.models.assessment import AIUsageEvent, InterviewQuestionPlan

PRICING_NOTE = ("Costs are estimates from AI_PRICING_JSON. Provider prices change; update the configuration to keep "
                "estimates meaningful. Calls for models without configured prices show no cost.")


def _summarize(events: list[AIUsageEvent]) -> dict:
    by_operation = defaultdict(lambda: {"calls": 0, "failed": 0, "input_tokens": 0, "output_tokens": 0,
                                        "audio_seconds": 0.0, "estimated_cost": 0.0, "priced_calls": 0})
    for e in events:
        op = by_operation[e.operation]
        op["calls"] += 1
        op["failed"] += e.status != "success"
        op["input_tokens"] += e.input_tokens or 0
        op["output_tokens"] += e.output_tokens or 0
        op["audio_seconds"] += e.audio_duration_seconds or 0
        if e.estimated_cost is not None:
            op["estimated_cost"] += e.estimated_cost
            op["priced_calls"] += 1
    totals = {k: sum(op[k] for op in by_operation.values()) for k in
              ("calls", "failed", "input_tokens", "output_tokens", "audio_seconds", "estimated_cost", "priced_calls")}
    totals["estimated_cost"] = round(totals["estimated_cost"], 4)
    totals["audio_seconds"] = round(totals["audio_seconds"], 1)
    return {
        "totals": totals,
        "by_operation": {k: {**v, "estimated_cost": round(v["estimated_cost"], 4), "audio_seconds": round(v["audio_seconds"], 1)}
                         for k, v in sorted(by_operation.items())},
        "models": sorted({e.model for e in events}),
    }


def interview_usage(db: Session, interview_id) -> dict:
    events = db.query(AIUsageEvent).filter(AIUsageEvent.interview_id == interview_id).all()
    return {**_summarize(events), "pricing_note": PRICING_NOTE}


def usage_summary(db: Session, projected_candidates: int = 100) -> dict:
    events = db.query(AIUsageEvent).all()
    summary = _summarize(events)

    # Per completed AI interview: its own calls plus the resume analysis of its candidate.
    completed = db.query(InterviewQuestionPlan).filter(InterviewQuestionPlan.status == "completed").all()
    per_interview_costs, per_interview_calls = [], []
    for plan in completed:
        related = [e for e in events if e.interview_id == plan.interview_id or
                   (e.interview_id is None and plan.interview and e.candidate_id == plan.interview.candidate_id)]
        per_interview_calls.append(len(related))
        costs = [e.estimated_cost for e in related if e.estimated_cost is not None]
        if costs and len(costs) == len(related):
            per_interview_costs.append(sum(costs))

    average: Optional[float] = round(mean(per_interview_costs), 4) if per_interview_costs else None
    return {
        **summary,
        "completed_ai_interviews": len(completed),
        "average_calls_per_interview": round(mean(per_interview_calls), 1) if per_interview_calls else None,
        "average_cost_per_interview": average,
        "projection": {
            "candidates": projected_candidates,
            "estimated_monthly_cost": round(average * projected_candidates, 2) if average is not None else None,
            "basis": f"{len(per_interview_costs)} fully priced completed interview(s)",
        },
        "pricing_note": PRICING_NOTE,
    }
