"""Versioned assessment rubric. Bump RUBRIC_VERSION whenever anchors or dimensions change."""

RUBRIC_VERSION = "cl-rubric-2026.1"

DIMENSIONS = {
    "technical_knowledge": {
        "label": "Technical knowledge",
        "assesses": [
            "Correctness of technical concepts",
            "Understanding of relevant tools and technologies",
            "Appropriate use of technical terminology",
            "Ability to explain how something works",
            "Awareness of limitations and trade-offs",
        ],
    },
    "problem_solving": {
        "label": "Problem-solving and reasoning",
        "assesses": [
            "Breaks the problem down",
            "Identifies relevant constraints",
            "Proposes a logical approach",
            "Considers edge cases",
            "Explains trade-offs and possible improvements",
        ],
    },
    "communication_clarity": {
        "label": "Communication clarity",
        "assesses": [
            "The response addresses the question",
            "The explanation is understandable",
            "The answer is logically organized",
            "Technical ideas are explained clearly",
        ],
    },
    "project_understanding": {
        "label": "Project understanding and ownership",
        "assesses": [
            "Understanding of the described project",
            "Explanation of the candidate's stated role",
            "Ability to discuss implementation details",
            "Understanding of challenges and decisions",
            "Ability to explain the project's limitations",
        ],
    },
    "scenario_application": {
        "label": "Scenario-based application",
        "assesses": [
            "Recognition of the problem",
            "Proposed steps",
            "Technical correctness",
            "Risk and edge-case awareness",
            "Reasoning behind the proposed solution",
        ],
    },
}
DIMENSION_KEYS = tuple(DIMENSIONS)

SCORE_ANCHORS = {
    1: "Insufficient evidence - does not address the main question or provides no usable relevant evidence.",
    2: "Limited evidence - partial understanding with substantial gaps or technical inaccuracies.",
    3: "Developing evidence - addresses the main requirement with some correct understanding, but notable gaps in detail or reasoning.",
    4: "Strong evidence - substantially correct, well-reasoned and supported by relevant details, with only minor omissions.",
    5: "Extensive evidence - accurate, detailed, relevant, with strong reasoning including appropriate trade-offs or edge cases.",
}

# Never scored, per responsible-use policy.
EXCLUDED_SIGNALS = (
    "accent, dialect, voice pitch, speech speed, eye contact, facial expression, appearance, "
    "perceived confidence, personality, emotion, or any protected characteristic"
)

CATEGORIES = {
    "resume_technical": {"label": "Resume-based technical", "candidate_label": "About your experience"},
    "technical_knowledge": {"label": "Technical knowledge", "candidate_label": "Technical question"},
    "project_defense": {"label": "Project defense", "candidate_label": "About your projects"},
    "scenario": {"label": "Scenario-based", "candidate_label": "Scenario"},
}
CATEGORY_KEYS = tuple(CATEGORIES)

# Dimensions are assigned by category, not chosen by the model, so scoring stays consistent.
CATEGORY_DIMENSIONS = {
    "resume_technical": ["technical_knowledge", "project_understanding", "communication_clarity"],
    "technical_knowledge": ["technical_knowledge", "communication_clarity"],
    "project_defense": ["project_understanding", "problem_solving", "communication_clarity"],
    "scenario": ["scenario_application", "problem_solving", "communication_clarity"],
}

# Categories that must be grounded in an extracted resume claim.
CLAIM_BACKED_CATEGORIES = ("resume_technical", "project_defense")

DEFAULT_QUESTION_COUNTS = {
    "resume_technical": 2,
    "technical_knowledge": 2,
    "project_defense": 2,
    "scenario": 2,
}
ASKING_ORDER = ("resume_technical", "project_defense", "technical_knowledge", "scenario")
MAX_TOTAL_QUESTIONS = 12
MIN_MINUTES_PER_QUESTION = 3


def rubric_prompt_block(dimensions: list[str]) -> str:
    lines = [f"Rubric version: {RUBRIC_VERSION}", "Score scale (apply per dimension):"]
    lines += [f"  {k}: {v}" for k, v in SCORE_ANCHORS.items()]
    lines.append("Dimensions to evaluate for this question:")
    for key in dimensions:
        d = DIMENSIONS[key]
        lines.append(f"- {key} ({d['label']}): " + "; ".join(d["assesses"]))
    return "\n".join(lines)
