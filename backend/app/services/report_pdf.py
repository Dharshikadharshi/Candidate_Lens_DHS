"""Render a saved assessment report as a downloadable PDF (built only from persisted report data)."""
import io
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

PURPLE = colors.HexColor("#4F46E5")
GREY = colors.HexColor("#4B5563")
LIGHT = colors.HexColor("#F3F4F6")
BORDER = colors.HexColor("#E5E7EB")

NEXT_STEPS = {
    "proceed_to_round_1": "Proceed to Round 1", "additional_assessment": "Additional assessment",
    "on_hold": "On hold", "do_not_proceed": "Do not proceed", "undecided": "Undecided",
}
CLAIM_STATUS = {
    "evidence_demonstrated": "Evidence demonstrated in interview", "partially_demonstrated": "Partially demonstrated",
    "not_demonstrated_in_interview": "Not demonstrated in interview", "needs_human_clarification": "Needs human clarification",
    "explored_not_assessed": "Explored, not assessed", "not_explored": "Not explored (unverified)",
}
EVIDENCE = {"not_enough_evidence": "Not enough evidence", "limited_evidence": "Limited evidence",
            "sufficient_evidence": "Sufficient evidence"}


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=base["Title"], fontSize=18, textColor=colors.black, alignment=TA_LEFT, spaceAfter=2),
        "meta": ParagraphStyle("meta", parent=base["Normal"], fontSize=8, textColor=GREY),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontSize=12.5, textColor=PURPLE, spaceBefore=10, spaceAfter=4),
        "h3": ParagraphStyle("h3", parent=base["Heading3"], fontSize=10, spaceBefore=6, spaceAfter=2),
        "body": ParagraphStyle("body", parent=base["Normal"], fontSize=9, leading=12.5),
        "small": ParagraphStyle("small", parent=base["Normal"], fontSize=8, leading=10.5, textColor=GREY),
        "quote": ParagraphStyle("quote", parent=base["Normal"], fontSize=8.5, leading=11.5, textColor=GREY,
                                leftIndent=8, fontName="Helvetica-Oblique"),
        "cell": ParagraphStyle("cell", parent=base["Normal"], fontSize=8, leading=10),
        "banner": ParagraphStyle("banner", parent=base["Normal"], fontSize=8.5, textColor=colors.HexColor("#5B21B6"),
                                 backColor=colors.HexColor("#EDE9FE"), borderPadding=5, spaceBefore=6, spaceAfter=6),
    }


def _p(text, style) -> Paragraph:
    return Paragraph(escape(str(text)) if text is not None else "—", style)


def _refs(refs) -> str:
    return f" [{', '.join(refs)}]" if refs else ""


def _date(value) -> str:
    if not value:
        return "—"
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%d %b %Y, %H:%M UTC%z")
    except ValueError:
        return str(value)


def _table(rows, widths, s, header=True) -> Table:
    data = [[c if isinstance(c, Paragraph) else _p(c, s["cell"]) for c in row] for row in rows]
    table = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), LIGHT))
    table.setStyle(TableStyle(style))
    return table


def _bullets(items, s):
    return [_p(f"• {item}", s["body"]) for item in items] or [_p("None.", s["small"])]


def render_report_pdf(report: dict) -> bytes:
    s = _styles()
    info = report.get("candidate_info") or {}
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"Assessment report - {info.get('candidate_name', 'Candidate')}", author="CandidateLens")
    width = doc.width
    story = [
        _p(f"Assessment report — {info.get('candidate_name', 'Candidate')}", s["title"]),
        _p(f"Version {report.get('report_version')} · generated {_date(report.get('generated_at'))} · rubric {report.get('rubric_version')}", s["meta"]),
        _p("AI-assisted report for human review. It does not make a hiring decision; the decision belongs to HR.", s["banner"]),
    ]
    if report.get("status") == "partial":
        story.append(_p(f"Note: the narrative sections could not be generated ({report.get('error')}). Scores and evidence come directly from saved data.", s["small"]))

    # A. Candidate and interview
    story.append(_p("A. Candidate and interview", s["h2"]))
    resume = info.get("resume_reference") or {}
    duration = (f"{info['actual_duration_minutes']} min interview" if info.get("actual_duration_minutes") is not None else "Interview still in progress")
    if info.get("ai_duration_minutes") is not None:
        duration += f" · {info['ai_duration_minutes']} min question portion"
    completion = f"{info.get('questions_answered')} of {info.get('questions_planned')} planned questions answered"
    if info.get("follow_ups_answered"):
        completion += f" (+{info['follow_ups_answered']} follow-ups)"
    completion += f" · {str(info.get('completion_reason') or info.get('ai_interview_status') or '').replace('_', ' ')}"
    story.append(_table([
        ["Candidate", f"{info.get('candidate_name')} ({info.get('candidate_id')})"],
        ["Target role", f"{info.get('target_role')} · {info.get('difficulty')}"],
        ["Interview", info.get("interview_id")],
        ["Date", _date(info.get("interview_date"))],
        ["Duration", f"{duration} (scheduled {info.get('scheduled_duration_minutes')} min)"],
        ["Completion", completion],
        ["Resume", f"{resume.get('filename')} (ref {resume.get('fingerprint')})" if resume else "No resume analysis"],
        ["Rubric", info.get("rubric_version")],
    ], [35 * mm, width - 35 * mm], s, header=False))

    # B. Executive summary
    story.append(_p("B. Executive summary", s["h2"]))
    summary = report.get("executive_summary")
    if summary:
        story.append(_p(summary.get("text"), s["body"]))
        if summary.get("topics_covered"):
            story.append(_p("Topics covered: " + ", ".join(summary["topics_covered"]), s["small"]))
        for title, key in (("Skills demonstrated", "skills_demonstrated"), ("Technical observations", "technical_observations")):
            if summary.get(key):
                story.append(_p(title, s["h3"]))
                story += _bullets([f"{i['text']}{_refs(i.get('question_refs'))}" for i in summary[key]], s)
        for title, key in (("Areas with limited evidence", "limited_evidence_areas"), ("Items requiring follow-up", "items_requiring_follow_up")):
            if summary.get(key):
                story.append(_p(title, s["h3"]))
                story += _bullets(summary[key], s)
    else:
        story.append(_p("Not available.", s["small"]))

    # C. Score analysis
    story.append(_p("C. Score analysis", s["h2"]))
    rows = [["Dimension", "Score", "Answers scored", "Evidence status", "Review"]]
    for d in report.get("dimension_scores") or []:
        rows.append([
            d["label"], f"{d['average']:.1f}/5" if d.get("average") is not None else "—",
            f"{d['evaluated_answers']}" + (f" (+{d['needs_review']} need review)" if d.get("needs_review") else ""),
            EVIDENCE.get(d["evidence_status"], d["evidence_status"]), "Needs review" if d.get("review_status") == "needs_review" else "OK",
        ])
    story.append(_table(rows, [width * 0.34, width * 0.12, width * 0.2, width * 0.2, width * 0.14], s))
    aggregate = report.get("aggregate")
    if aggregate:
        value = f"{aggregate['value']:.2f} / 5" if aggregate.get("value") is not None else "not calculable"
        story.append(Spacer(1, 4))
        story.append(_p(f"Aggregate: {value}", s["h3"]))
        story.append(_p(aggregate.get("formula"), s["small"]))
        contributing = " · ".join(f"{c['label']} {c['average']:.1f} × {c['weight']}" for c in aggregate.get("contributing", []))
        story.append(_p(f"Contributing: {contributing or 'none'}", s["small"]))
        if aggregate.get("excluded"):
            story.append(_p("Excluded: " + " · ".join(f"{e['label']} ({e['reason']})" for e in aggregate["excluded"]), s["small"]))

    # Resume claim verification
    claims = report.get("claim_verification")
    if claims and claims.get("items"):
        story.append(_p("Resume claim verification", s["h2"]))
        story.append(_p(claims.get("note"), s["small"]))
        rows = [["Claim (candidate-provided)", "Source in resume", "Interview evidence"]]
        for c in claims["items"]:
            source = f"“{c.get('source_text')}”" if c.get("source_verified") else "Quote not found in resume"
            evidence = CLAIM_STATUS.get(c["interview_status"], c["interview_status"]) + _refs(c.get("question_refs"))
            if c.get("note"):
                evidence += f" — {c['note']}"
            rows.append([f"{c['claim_id']} {c['claim']}", source, evidence])
        story.append(_table(rows, [width * 0.34, width * 0.33, width * 0.33], s))

    # D. Question-by-question analysis
    story.append(_p("D. Question-by-question analysis", s["h2"]))
    for q in report.get("question_analysis") or []:
        block = [_p(f"{q['label']} · {q['category_label']}{' · Follow-up' if q.get('is_follow_up') else ''}"
                    + (f"  [{', '.join(f.replace('_', ' ') for f in q['review_flags'])}]" if q.get("review_flags") else ""), s["h3"]),
                 _p(q["text"], s["body"])]
        if not q.get("asked"):
            block.append(_p("Not asked.", s["small"]))
        elif q.get("status") == "skipped":
            block.append(_p(f"Skipped: {q.get('skip_reason')}", s["small"]))
        elif q.get("transcript"):
            method = q.get("capture_method") or ""
            block.append(_p(f"Candidate answer ({method}{', transcript corrected by candidate' if q.get('transcript_edited') else ''}):", s["small"]))
            block.append(_p(q["transcript"], s["quote"]))
        else:
            block.append(_p("No answer submitted.", s["small"]))
        if q.get("evaluations"):
            rows = [["Dimension", "Score", "Rationale and evidence"]]
            for e in q["evaluations"]:
                score = f"{e['score']}/5" if e.get("score") is not None else e["evidence_status"].replace("_", " ")
                rationale = (e.get("rationale") or "") + (f"  “{e['evidence_excerpt']}”" if e.get("evidence_excerpt") else "")
                rows.append([e["dimension_label"] + (" (HR-reviewed)" if e.get("source") == "hr" else ""), score, rationale])
            block.append(Spacer(1, 3))
            block.append(_table(rows, [width * 0.26, width * 0.12, width * 0.62], s))
        if q.get("missing_evidence"):
            block.append(_p("Missing evidence: " + "; ".join(q["missing_evidence"]), s["small"]))
        if q.get("follow_up"):
            block.append(_p(f"Follow-up asked ({q['follow_up']['label']}): {q['follow_up']['text']}", s["small"]))
        block.append(Spacer(1, 4))
        story.append(KeepTogether(block[:3]))
        story += block[3:]

    # E-H
    story.append(_p("E. Strengths", s["h2"]))
    strengths = report.get("strengths") or []
    if strengths:
        for st in strengths:
            story.append(_p(f"• {st['strength']}{_refs(st.get('question_refs'))}", s["body"]))
            story.append(_p(f"“{st['evidence_excerpt']}”", s["quote"]))
    else:
        story.append(_p("No evidence-backed strengths were identified.", s["small"]))

    story.append(_p("F. Areas for further assessment", s["h2"]))
    story += _bullets([f"{a['area']} — {a['reason']}{_refs(a.get('question_refs'))}" for a in report.get("areas_for_follow_up") or []], s)

    story.append(_p("G. Suggested HR follow-up questions", s["h2"]))
    story.append(_p("Suggestions only — not mandatory interview requirements.", s["small"]))
    suggested = report.get("suggested_questions") or []
    story += [_p(f"{i}. {q['question']} — {q['rationale']}", s["body"]) for i, q in enumerate(suggested, 1)] or [_p("None.", s["small"])]

    story.append(_p("H. Evidence and limitations", s["h2"]))
    story += _bullets(report.get("limitations") or [], s)

    # I. HR review (separate from AI findings)
    review = report.get("hr_review") or {}
    story.append(_p("I. HR review", s["h2"]))
    story.append(_p("Independent human review, stored separately from the AI-generated findings above.", s["small"]))
    story.append(_table([
        ["Reviewer", review.get("reviewer_name") or "Not reviewed yet"],
        ["Review date", _date(review.get("reviewed_at"))],
        ["Notes", review.get("notes") or "—"],
        ["Areas for clarification", review.get("clarifications") or "—"],
        ["Suggested next step", NEXT_STEPS.get(review.get("next_step"), review.get("next_step") or "—")],
        ["Independent decision", review.get("decision") or "—"],
    ], [42 * mm, width - 42 * mm], s, header=False))

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(GREY)
        canvas.drawString(16 * mm, 8 * mm, "CandidateLens · Confidential candidate assessment · AI-assisted, requires human review")
        canvas.drawRightString(A4[0] - 16 * mm, 8 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
