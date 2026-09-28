"""Render a saved resume validation report as a polished, downloadable PDF with visual charts and structured cards using ReportLab."""
import io
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Drawing, Rect
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

PURPLE = colors.HexColor("#4F46E5")
DARK = colors.HexColor("#111827")
GREY = colors.HexColor("#4B5563")
LIGHT_BG = colors.HexColor("#F9FAFB")
BORDER = colors.HexColor("#E5E7EB")
GREEN = colors.HexColor("#059669")
AMBER = colors.HexColor("#D97706")
RED = colors.HexColor("#DC2626")

CATEGORY_CONFIG = {
    "completeness": {"title": "1. Resume Completeness", "max": 20, "color": "#3B82F6"},
    "role_relevance": {"title": "2. Target-Role Relevance", "max": 25, "color": "#8B5CF6"},
    "skill_evidence": {"title": "3. Evidence Supporting Skills", "max": 25, "color": "#10B981"},
    "consistency": {"title": "4. Internal Consistency", "max": 15, "color": "#F59E0B"},
    "readability": {"title": "5. Readability & Structure", "max": 15, "color": "#6366F1"},
}


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("val_title", parent=base["Title"], fontSize=18, leading=22, textColor=DARK, alignment=TA_LEFT, spaceAfter=2),
        "subtitle": ParagraphStyle("val_subtitle", parent=base["Normal"], fontSize=9, leading=12, textColor=GREY, spaceAfter=6),
        "h2": ParagraphStyle("val_h2", parent=base["Heading2"], fontSize=12, leading=15, textColor=PURPLE, spaceBefore=8, spaceAfter=4),
        "h3": ParagraphStyle("val_h3", parent=base["Heading3"], fontSize=10, leading=13, textColor=DARK, spaceBefore=5, spaceAfter=2),
        "body": ParagraphStyle("val_body", parent=base["Normal"], fontSize=8.5, leading=11.5, textColor=DARK),
        "small": ParagraphStyle("val_small", parent=base["Normal"], fontSize=7.5, leading=10, textColor=GREY),
        "quote": ParagraphStyle("val_quote", parent=base["Normal"], fontSize=8, leading=10.5, textColor=GREY, leftIndent=6, fontName="Helvetica-Oblique"),
        "cell": ParagraphStyle("val_cell", parent=base["Normal"], fontSize=8, leading=10.5, textColor=DARK),
        "cell_bold": ParagraphStyle("val_cell_bold", parent=base["Normal"], fontSize=8, leading=10.5, textColor=DARK, fontName="Helvetica-Bold"),
        "cell_center": ParagraphStyle("val_cell_center", parent=base["Normal"], fontSize=8, leading=10.5, alignment=TA_CENTER),
        "cell_pct": ParagraphStyle("val_cell_pct", parent=base["Normal"], fontSize=8, leading=10.5, fontName="Helvetica-Bold", alignment=TA_CENTER),
        "finding_title": ParagraphStyle("f_title", parent=base["Normal"], fontSize=9, leading=12, textColor=DARK),
        "finding_analysis": ParagraphStyle("f_analysis", parent=base["Normal"], fontSize=8, leading=11, textColor=colors.HexColor("#374151")),
        "finding_excerpt": ParagraphStyle("f_excerpt", parent=base["Normal"], fontSize=7.5, leading=10.5, textColor=colors.HexColor("#4B5563"), fontName="Helvetica-Oblique"),
        "finding_action": ParagraphStyle("f_action", parent=base["Normal"], fontSize=8, leading=11, textColor=colors.HexColor("#1E1B4B")),
        "disclaimer": ParagraphStyle(
            "val_disclaimer",
            parent=base["Normal"],
            fontSize=7.5,
            leading=10,
            textColor=colors.HexColor("#4B5563"),
            backColor=colors.HexColor("#F3F4F6"),
            borderPadding=5,
            spaceBefore=6,
            spaceAfter=6,
        ),
        "score_banner": ParagraphStyle(
            "val_score",
            parent=base["Normal"],
            fontSize=10,
            leading=13.5,
            textColor=colors.HexColor("#1E1B4B"),
            backColor=colors.HexColor("#EEF2FF"),
            borderPadding=8,
            spaceBefore=4,
            spaceAfter=6,
        ),
    }


def _p(html_text: str, style: ParagraphStyle) -> Paragraph:
    """Creates a ReportLab Paragraph without double-escaping valid markup tags."""
    return Paragraph(html_text if html_text is not None else "—", style)


def _clean(value) -> str:
    """Escapes user/AI text safely so XML special characters (&, <, >) don't break ReportLab's parser."""
    if value is None:
        return ""
    return escape(str(value))


def _date(value) -> str:
    if not value:
        return "—"
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%d %b %Y, %H:%M UTC")
    except ValueError:
        return str(value)


def _make_bar(pct: int, color_hex: str, width: float = 75, height: float = 9) -> Drawing:
    """Renders a clean, rounded horizontal progress bar drawing."""
    d = Drawing(width, height)
    # Background rail
    d.add(Rect(0, 1, width, height - 2, fillColor=colors.HexColor("#E5E7EB"), strokeColor=None, rx=3, ry=3))
    # Filled meter
    fill_w = max(2.5, (min(100, max(0, pct)) / 100.0) * width) if pct > 0 else 0
    if fill_w > 0:
        d.add(Rect(0, 1, fill_w, height - 2, fillColor=colors.HexColor(color_hex), strokeColor=None, rx=3, ry=3))
    return d


def render_validation_pdf(report: dict, candidate: dict) -> bytes:
    s = _styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=11 * mm,
        bottomMargin=11 * mm,
        title=f"Resume Validation Report - {candidate.get('full_name', 'Candidate')}",
        author="CandidateLens",
    )

    story = []

    # Title & Metadata
    candidate_name = _clean(candidate.get("full_name", "Candidate"))
    target_role = _clean(report.get("target_role", "Target Role"))
    score = float(report.get("overall_score") or 0.0)
    rubric = _clean(report.get("rubric_version", "rv-1.0"))
    version = report.get("version", 1)
    validated_date = _date(report.get("created_at"))

    story.append(_p(f"AI Resume Validation Report — {candidate_name}", s["title"]))
    story.append(_p(
        f"Target Role: <b>{target_role}</b> · Version {version} · Validated: {validated_date} · Rubric: {rubric}",
        s["subtitle"],
    ))

    # Assessment Notice / Disclaimer
    story.append(_p(
        "<b>Assessment Notice:</b> This report evaluates resume document quality, structural completeness, and evidence coverage. "
        "It does not verify a candidate's personal honesty or predict job performance. Hiring decisions remain the sole responsibility of HR.",
        s["disclaimer"],
    ))

    # Score Banner
    score_color = "#059669" if score >= 80 else "#D97706" if score >= 60 else "#DC2626"
    summary_text = _clean(report.get("summary") or "Resume validation completed successfully.")
    exp_badge = ""
    if report.get("experience_level"):
        exp_badge = f" &nbsp;·&nbsp; Experience Level: <b>{_clean(report.get('experience_level').upper())}</b>"

    story.append(_p(
        f"<b>Overall Resume Quality Score: <font color='{score_color}' size='12'><b>{score:.1f} / 100</b></font></b>"
        f"{exp_badge}<br/><br/>"
        f"<b>Executive Summary:</b> {summary_text}",
        s["score_banner"],
    ))

    # =========================================================================
    # 1. Category Assessment Table with Visual Horizontal Bar Charts
    # =========================================================================
    story.append(_p("Score Breakdown by Category (Visual Analysis)", s["h2"]))
    cat_scores = report.get("category_scores") or {}

    # Total width = 182 mm
    # Columns: Category (48mm), Score (24mm), Visual Chart (36mm), Coverage (16mm), Assessment (58mm)
    table_rows = [[
        _p("Category", s["cell_bold"]),
        _p("Score", s["cell_bold"]),
        _p("Visual Chart", s["cell_bold"]),
        _p("Coverage", s["cell_bold"]),
        _p("Key Category Assessment", s["cell_bold"]),
    ]]

    cat_keys = ["completeness", "role_relevance", "skill_evidence", "consistency", "readability"]
    for k in cat_keys:
        cfg = CATEGORY_CONFIG.get(k, {"title": k.replace("_", " ").title(), "max": 20, "color": "#4F46E5"})
        item = cat_scores.get(k, {})
        pts = float(item.get("score", 0))
        max_pts = float(item.get("max_score", cfg["max"]))
        pct = int(round((pts / max_pts * 100))) if max_pts else 0

        # Bar chart color based on performance
        bar_color = "#059669" if pct >= 75 else "#D97706" if pct >= 50 else "#DC2626"
        chart_drawing = _make_bar(pct, bar_color, width=90, height=8)

        table_rows.append([
            _p(f"<b>{_clean(cfg['title'])}</b><br/><font color='#6B7280' size='7'>Max {int(max_pts)} pts</font>", s["cell"]),
            _p(f"<b>{pts:.1f}</b> / {max_pts:.1f}", s["cell"]),
            chart_drawing,
            _p(f"<font color='{bar_color}'><b>{pct}%</b></font>", s["cell_pct"]),
            _p(_clean(item.get("summary", "—")), s["cell"]),
        ])

    category_table = Table(table_rows, colWidths=[48 * mm, 24 * mm, 36 * mm, 16 * mm, 58 * mm])
    category_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BG),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FCFCFD")]),
    ]))
    story.append(category_table)
    story.append(Spacer(1, 8))

    # =========================================================================
    # 2. Skills Evidence Mapping Table
    # =========================================================================
    skills_map = report.get("skills_evidence_map") or []
    if skills_map:
        story.append(_p("Skills Evidence Verification Map", s["h2"]))
        s_rows = [[
            _p("Skill / Requirement", s["cell_bold"]),
            _p("Status", s["cell_bold"]),
            _p("Supporting Resume Evidence", s["cell_bold"]),
            _p("Section & Notes", s["cell_bold"]),
        ]]
        for sk in skills_map[:15]:
            st = sk.get("status", "indeterminate")
            st_color = "#059669" if st == "supported" else "#D97706" if st == "unsupported" else "#6B7280"
            st_label = st.replace("_", " ").title()
            quote_raw = sk.get("evidence_excerpt")
            quote_text = f'“{_clean(quote_raw)}”' if quote_raw else "<font color='#9CA3AF'>None provided in resume</font>"
            notes_text = _clean(sk.get("notes") or sk.get("section_or_page") or "—")

            s_rows.append([
                _p(f"<b>{_clean(sk.get('skill', '—'))}</b>", s["cell"]),
                _p(f"<font color='{st_color}'><b>&bull; {st_label}</b></font>", s["cell"]),
                _p(quote_text, s["quote"] if quote_raw else s["small"]),
                _p(notes_text, s["small"]),
            ])
        s_table = Table(s_rows, colWidths=[36 * mm, 26 * mm, 68 * mm, 52 * mm])
        s_table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BG),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FCFCFD")]),
        ]))
        story.append(s_table)
        story.append(Spacer(1, 8))

    # =========================================================================
    # 3. De-clumped Detailed Audit Findings (Structured Card Blocks)
    # =========================================================================
    findings = report.get("detailed_findings") or []
    if findings:
        story.append(_p("Detailed Audit Findings & Evidence", s["h2"]))
        story.append(_p(
            "Individual checks evaluated against Rubric rv-1.0. Each item specifies the deduction rationale, source excerpt, and recommended HR verification action.",
            s["small"],
        ))
        story.append(Spacer(1, 3))

        for f in findings:
            raw_cat = f.get("category", "")
            cat_cfg = CATEGORY_CONFIG.get(raw_cat, {"title": raw_cat.replace("_", " ").title(), "color": "#4F46E5"})
            cat_title = cat_cfg["title"]
            desc = _clean(f.get("finding_description", ""))
            reason = _clean(f.get("reasoning", ""))
            action = _clean(f.get("recommended_action", ""))
            excerpt = _clean(f.get("relevant_excerpt"))
            sec = _clean(f.get("section_or_page"))
            f_score = f.get("score", 0)
            f_max = f.get("max_score", 0)
            status_val = f.get("review_status", "verified")

            # Determine card accent color
            accent_hex = "#059669" if status_val == "verified" else "#D97706" if status_val == "needs_review" else "#6D28D9"
            status_badge_label = "Verified" if status_val == "verified" else "Needs Review" if status_val == "needs_review" else "Clarification Recommended"

            # Build card contents
            card_flowables = []

            # 1. Header Row: Category Badge + Score Badge
            header_text = (
                f"<font color='{cat_cfg['color']}'><b>[{cat_title}]</b></font> "
                f"<b>{desc}</b> &nbsp;·&nbsp; "
                f"<font color='{accent_hex}'><b>{status_badge_label}</b></font> "
                f"<font color='#6B7280'>({f_score}/{f_max} pts)</font>"
            )
            card_flowables.append(_p(header_text, s["finding_title"]))
            card_flowables.append(Spacer(1, 1.5))

            # 2. Analysis / Reasoning
            card_flowables.append(_p(f"<b>Audit Analysis:</b> {reason}", s["finding_analysis"]))

            # 3. Source Excerpt Callout (if present)
            if excerpt:
                card_flowables.append(Spacer(1, 1.5))
                loc_text = f" <font color='#6B7280' size='7'>({sec})</font>" if sec else ""
                excerpt_subtable = Table(
                    [[_p(f"“{excerpt}”{loc_text}", s["finding_excerpt"])]],
                    colWidths=[172 * mm],
                )
                excerpt_subtable.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F4F6")),
                    ("LINELEFT", (0, 0), (0, 0), 2.5, colors.HexColor(cat_cfg["color"])),
                    ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ]))
                card_flowables.append(excerpt_subtable)

            # 4. Recommended HR Action
            if action:
                card_flowables.append(Spacer(1, 1.5))
                card_flowables.append(_p(f"<font color='#1E1B4B'><b>💡 Recruiter Action:</b></font> {action}", s["finding_action"]))

            # Wrap in an outer card Table with left accent stripe and light border
            card_table = Table([[card_flowables]], colWidths=[182 * mm])
            card_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
                ("LINELEFT", (0, 0), (0, 0), 3.0, colors.HexColor(accent_hex)),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]))

            story.append(KeepTogether(card_table))
            story.append(Spacer(1, 4.5))

    # =========================================================================
    # 4. Suggested Interview Questions
    # =========================================================================
    questions = report.get("suggested_questions") or []
    if questions:
        story.append(Spacer(1, 4))
        story.append(_p("Recommended Interview Follow-Up Questions", s["h2"]))
        q_rows = []
        for i, q in enumerate(questions, 1):
            q_rows.append([
                _p(f"<b>Q{i}</b>", s["cell_bold"]),
                _p(_clean(q), s["body"]),
            ])
        q_table = Table(q_rows, colWidths=[14 * mm, 168 * mm])
        q_table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EEF2FF")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(q_table)

    doc.build(story)
    return buffer.getvalue()
