"""Branded A4 PDF generation (reportlab). Generated on demand, never stored."""
import io
from datetime import UTC, datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

NAVY = colors.HexColor("#0B1F3A")
GOLD = colors.HexColor("#C9A227")
IVORY = colors.HexColor("#F8F6F1")
_ss = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=_ss["Title"], fontName="Helvetica-Bold", fontSize=16, textColor=NAVY, alignment=0, spaceAfter=4)
H2 = ParagraphStyle("h2", parent=_ss["Heading2"], fontName="Helvetica-Bold", fontSize=11, textColor=NAVY, spaceBefore=8, spaceAfter=4)
BODY = ParagraphStyle("body", parent=_ss["BodyText"], fontName="Helvetica", fontSize=9, leading=12)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=7.5, leading=10, textColor=colors.HexColor("#475569"))
RIGHT = ParagraphStyle("right", parent=BODY, alignment=TA_RIGHT)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8, leading=10)


def inr(paise, blank_zero=False) -> str:
    if paise is None or (blank_zero and not paise):
        return "" if blank_zero else "-"
    neg = paise < 0
    rupees, p = divmod(abs(int(paise)), 100)
    s = str(rupees)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    out = f"Rs {s}.{p:02d}" if p else f"Rs {s}"
    return f"({out})" if neg else out


def fmt_date(s) -> str:
    if not s:
        return "-"
    try:
        return datetime.fromisoformat(str(s)[:19]).strftime("%d %b %Y")
    except ValueError:
        return str(s)


class BrandedDoc:
    def __init__(self, title: str, company: dict, landscape_mode=False, subtitle: str | None = None):
        self.buf = io.BytesIO()
        self.company = company or {}
        self.title = title
        self.subtitle = subtitle
        self.pagesize = landscape(A4) if landscape_mode else A4
        self.doc = SimpleDocTemplate(self.buf, pagesize=self.pagesize, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=34 * mm, bottomMargin=18 * mm, title=title, author=self.company.get("name", "KKT"))
        self.story = []
        self.generated = datetime.now(UTC).strftime("%d %b %Y %H:%M UTC")

    def _header_footer(self, canvas, doc):
        canvas.saveState()
        w, h = self.pagesize
        c = self.company
        y = h - 14 * mm
        x = 14 * mm
        logo = c.get("_logo_bytes")
        if logo:
            try:
                canvas.drawImage(Image(io.BytesIO(logo)).filename if False else io.BytesIO(logo), x, y - 9 * mm, width=22 * mm, height=11 * mm, preserveAspectRatio=True, mask="auto")
                x += 25 * mm
            except Exception:
                pass
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 14)
        canvas.drawString(x, y - 2 * mm, c.get("legal_name") or c.get("name") or "KKT")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#475569"))
        addr = c.get("address") or {}
        line = ", ".join(filter(None, [addr.get("line1"), addr.get("city"), addr.get("state"), addr.get("pincode")]))
        canvas.drawString(x, y - 6.5 * mm, line)
        contact = " · ".join(filter(None, [c.get("letterhead_phone"), c.get("letterhead_email"), f"GSTIN {c['gstin']}" if c.get("gstin") else None, f"RERA {c['rera_registration']}" if c.get("rera_registration") else None]))
        canvas.drawString(x, y - 10.5 * mm, contact)
        if c.get("letterhead_tagline"):
            canvas.setFont("Helvetica-Oblique", 8)
            canvas.setFillColor(GOLD)
            canvas.drawRightString(w - 14 * mm, y - 2 * mm, c["letterhead_tagline"])
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(1.2)
        canvas.line(14 * mm, y - 13 * mm, w - 14 * mm, y - 13 * mm)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.setFillColor(NAVY)
        canvas.drawString(14 * mm, y - 18.5 * mm, self.title.upper())
        if self.subtitle:
            canvas.setFont("Helvetica", 8)
            canvas.setFillColor(colors.HexColor("#475569"))
            canvas.drawRightString(w - 14 * mm, y - 18.5 * mm, self.subtitle)
        canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
        canvas.setLineWidth(0.5)
        canvas.line(14 * mm, 13 * mm, w - 14 * mm, 13 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(14 * mm, 9 * mm, f"Generated {self.generated} · {c.get('name', 'KKT')} ERP · System generated document")
        canvas.drawRightString(w - 14 * mm, 9 * mm, f"Page {doc.page}")
        canvas.restoreState()

    def h1(self, text):
        self.story.append(Paragraph(text, H1))

    def h2(self, text):
        self.story.append(Paragraph(text, H2))

    def p(self, text, style=BODY):
        self.story.append(Paragraph(text, style))

    def small(self, text):
        self.story.append(Paragraph(text, SMALL))

    def spacer(self, h=4):
        self.story.append(Spacer(1, h * mm))

    def page_break(self):
        self.story.append(PageBreak())

    def kv(self, pairs: list[tuple[str, str]], cols=2):
        rows, row = [], []
        for k, v in pairs:
            row += [Paragraph(f"<font color='#64748B'>{k}</font>", CELL), Paragraph(f"<b>{v if v not in (None, '') else '-'}</b>", CELL)]
            if len(row) == cols * 2:
                rows.append(row)
                row = []
        if row:
            row += [""] * (cols * 2 - len(row))
            rows.append(row)
        avail = self.pagesize[0] - 28 * mm
        unit = avail / (cols * 3)
        t = Table(rows, colWidths=[unit, unit * 2] * cols)
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3)]))
        self.story.append(t)

    def table(self, headers: list[str], rows: list[list], widths: list[float] | None = None, align_right: list[int] | None = None, totals: list | None = None, zebra=True):
        avail = self.pagesize[0] - 28 * mm
        if widths:
            s = sum(widths)
            cw = [avail * w / s for w in widths]
        else:
            cw = [avail / len(headers)] * len(headers)
        data = [[Paragraph(f"<b>{h}</b>", ParagraphStyle("hc", parent=CELL, textColor=colors.white)) for h in headers]]
        for r in rows:
            data.append([Paragraph(str(c if c is not None else ""), ParagraphStyle("c", parent=CELL, alignment=TA_RIGHT if (align_right and i in align_right) else 0)) for i, c in enumerate(r)])
        if totals:
            data.append([Paragraph(f"<b>{c if c is not None else ''}</b>", ParagraphStyle("t", parent=CELL, alignment=TA_RIGHT if (align_right and i in align_right) else 0)) for i, c in enumerate(totals)])
        t = Table(data, colWidths=cw, repeatRows=1)
        style = [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("LINEBELOW", (0, 0), (-1, 0), 1, GOLD), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                 ("GRID", (0, 1), (-1, -1), 0.25, colors.HexColor("#E2E8F0")), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
        if zebra:
            for i in range(1, len(data)):
                if i % 2 == 0:
                    style.append(("BACKGROUND", (0, i), (-1, i), IVORY))
        if totals:
            style += [("BACKGROUND", (0, len(data) - 1), (-1, len(data) - 1), colors.HexColor("#FBF3D5")), ("LINEABOVE", (0, len(data) - 1), (-1, len(data) - 1), 1, GOLD)]
        t.setStyle(TableStyle(style))
        self.story.append(t)

    def signature(self, name: str, label="Authorised Signatory"):
        self.spacer(14)
        t = Table([["", f"For {self.company.get('legal_name') or self.company.get('name', '')}"], ["", ""], ["", ""], ["", name or ""], ["", label]], colWidths=[(self.pagesize[0] - 28 * mm) * 0.6, (self.pagesize[0] - 28 * mm) * 0.4])
        t.setStyle(TableStyle([("FONTNAME", (1, 0), (1, 0), "Helvetica-Bold"), ("FONTNAME", (1, 3), (1, 3), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (1, 4), (1, 4), colors.HexColor("#64748B")), ("LINEABOVE", (1, 3), (1, 3), 0.5, NAVY)]))
        self.story.append(t)

    def build(self) -> bytes:
        self.doc.build(self.story, onFirstPage=self._header_footer, onLaterPages=self._header_footer)
        return self.buf.getvalue()
