# ruff: noqa: F821  -- reportlab names are populated lazily by _load() (see module __getattr__)
"""Branded A4 PDF generation (reportlab, imported lazily on first use). One template for every customer-facing document.

Output is deterministic for the same data on the same IST day (invariant PDF metadata, date-level generated stamp), so the
ERP and portal variants of a document are byte-identical."""
from services import clock
import hashlib
import hmac
import io
import os
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "fonts")
_LAZY = ("colors", "TA_RIGHT", "A4", "landscape", "ParagraphStyle", "getSampleStyleSheet", "mm", "Image", "PageBreak", "Paragraph", "SimpleDocTemplate", "Spacer", "Table", "TableStyle",
         "NAVY", "GOLD", "IVORY", "INK", "MUTED", "RULE", "H1", "H2", "BODY", "SMALL", "RIGHT", "CELL", "NumberedCanvas")


def _load():
    import reportlab.lib.colors as colors
    from reportlab import platypus
    from reportlab.lib import enums, pagesizes, styles, units
    from reportlab.lib.fonts import addMapping
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas as rl_canvas
    if "Helvetica" not in pdfmetrics.getRegisteredFontNames() or not isinstance(pdfmetrics.getFont("Helvetica"), TTFont):
        for name, file in [("Helvetica", "DejaVuSans.ttf"), ("Helvetica-Bold", "DejaVuSans-Bold.ttf"), ("Helvetica-Oblique", "DejaVuSans-Oblique.ttf"), ("Courier", "DejaVuSansMono.ttf")]:
            pdfmetrics.registerFont(TTFont(name, os.path.join(FONT_DIR, file)))  # Unicode (₹) under the standard names
        addMapping("Helvetica", 0, 0, "Helvetica"); addMapping("Helvetica", 1, 0, "Helvetica-Bold"); addMapping("Helvetica", 0, 1, "Helvetica-Oblique"); addMapping("Helvetica", 1, 1, "Helvetica-Bold")

    class NumberedCanvas(rl_canvas.Canvas):
        """Two-pass canvas so the footer can print 'Page X of Y'."""
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._saved = []

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved)
            for state in self._saved:
                self.__dict__.update(state)
                self.draw_page_number(total)
                super().showPage()
            super().save()

        def draw_page_number(self, total):
            self.setFont("Helvetica", 7.5)
            self.setFillColor(colors.HexColor("#64748B"))
            self.drawRightString(self._pagesize[0] - 14 * units.mm, 9 * units.mm, f"Page {self._pageNumber} of {total}")

    g = globals()
    g.update(colors=colors, TA_RIGHT=enums.TA_RIGHT, A4=pagesizes.A4, landscape=pagesizes.landscape, ParagraphStyle=styles.ParagraphStyle, getSampleStyleSheet=styles.getSampleStyleSheet, mm=units.mm,
             Image=platypus.Image, PageBreak=platypus.PageBreak, Paragraph=platypus.Paragraph, SimpleDocTemplate=platypus.SimpleDocTemplate, Spacer=platypus.Spacer, Table=platypus.Table, TableStyle=platypus.TableStyle,
             NumberedCanvas=NumberedCanvas)
    g["NAVY"] = colors.HexColor("#0B1F3A")
    g["GOLD"] = colors.HexColor("#C9A227")
    g["IVORY"] = colors.HexColor("#F8F6F1")
    g["INK"] = colors.HexColor("#0A0C10")
    g["MUTED"] = colors.HexColor("#475569")
    g["RULE"] = colors.HexColor("#E2E8F0")
    ss = styles.getSampleStyleSheet()
    g["H1"] = styles.ParagraphStyle("h1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=16, textColor=g["NAVY"], alignment=0, spaceAfter=4)
    g["H2"] = styles.ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=10.5, textColor=g["NAVY"], spaceBefore=9, spaceAfter=4)
    g["BODY"] = styles.ParagraphStyle("body", parent=ss["BodyText"], fontName="Helvetica", fontSize=9, leading=12.5)
    g["SMALL"] = styles.ParagraphStyle("small", parent=g["BODY"], fontSize=7.5, leading=10, textColor=g["MUTED"])
    g["RIGHT"] = styles.ParagraphStyle("right", parent=g["BODY"], alignment=enums.TA_RIGHT)
    g["CELL"] = styles.ParagraphStyle("cell", parent=g["BODY"], fontSize=8, leading=10)


def __getattr__(name):
    if name in _LAZY:
        _load()
        return globals()[name]
    raise AttributeError(name)


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
    out = f"₹{s}.{p:02d}" if p else f"₹{s}"
    return f"({out})" if neg else out


def fmt_date(s) -> str:
    if not s:
        return "-"
    try:
        return datetime.fromisoformat(str(s)[:19]).strftime("%d %b %Y")
    except ValueError:
        return str(s)


def today_ist() -> str:
    return clock.now(clock.IST).date().isoformat()


def verify_code(doc_type: str, entity_id: str) -> str:
    """Short, stable verification code printed in the footer (HMAC of type+id with the server secret)."""
    key = (os.environ.get("ENCRYPTION_KEY") or os.environ.get("JWT_SECRET") or "kkt").encode()
    return hmac.new(key, f"{doc_type}:{entity_id}".encode(), hashlib.sha256).hexdigest()[:8].upper()


def pdf_response(content: bytes, filename: str, download: bool = False):
    from fastapi import Response
    disp = "attachment" if download else "inline"
    return Response(content=content, media_type="application/pdf", headers={"Content-Disposition": f'{disp}; filename="{filename}"', "Cache-Control": "private, no-store"})


_MONOGRAM: dict = {}


def kkt_monogram_png() -> bytes:
    """Deterministic PNG of the KKT monogram (gold mark on royal black), same geometry as frontend/public/kkt-monogram.svg."""
    if "png" not in _MONOGRAM:
        from PIL import Image, ImageDraw
        S = 4  # supersample
        im = Image.new("RGBA", (160 * S, 160 * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        gold, black = (210, 170, 90, 255), (11, 11, 15, 255)
        d.rounded_rectangle((0, 0, 160 * S - 1, 160 * S - 1), radius=28 * S, fill=black)
        w = 10 * S
        for x in (34, 76):
            d.line(((x * S, 44 * S), (x * S, 116 * S)), fill=gold, width=w)
            d.line((((x + 2) * S, 80 * S), ((x + 36 - (2 if x == 76 else 0)) * S, 44 * S)), fill=gold, width=w)
            d.line((((x + 2) * S, 80 * S), ((x + 36 - (2 if x == 76 else 0)) * S, 116 * S)), fill=gold, width=w)
        d.rectangle((98 * S, 44 * S, 134 * S, 54 * S), fill=gold)
        d.rectangle((111 * S, 54 * S, 121 * S, 116 * S), fill=gold)
        d.rectangle((34 * S, 128 * S, 134 * S, 130 * S), fill=(210, 170, 90, 150))
        im = im.resize((160, 160), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="PNG", optimize=False)
        _MONOGRAM["png"] = out.getvalue()
    return _MONOGRAM["png"]


class BrandedDoc:
    """Shared letterhead/footer template. `number` and `date` render in the title block; `verify` in the footer."""

    def __init__(self, title: str, company: dict, landscape_mode=False, subtitle: str | None = None, number: str | None = None, date: str | None = None, verify: str | None = None):
        _load()
        self.buf = io.BytesIO()
        self.company = company or {}
        if not self.company.get("_logo_bytes"):
            self.company["_logo_bytes"] = kkt_monogram_png()
        self.title, self.subtitle, self.number, self.date, self.verify = title, subtitle, number, date, verify
        self.pagesize = landscape(A4) if landscape_mode else A4
        self.doc = SimpleDocTemplate(self.buf, pagesize=self.pagesize, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=40 * mm, bottomMargin=20 * mm,
                                     title=f"{title} {number or ''}".strip(), author=self.company.get("legal_name") or self.company.get("name", "KKT"), subject=title, creator="KKT ERP", invariant=1)
        self.story = []
        self.generated = clock.now(clock.IST).strftime("%d %b %Y")

    def _header_footer(self, canvas, doc):
        canvas.saveState()
        w, h = self.pagesize
        c = self.company
        left, right = 14 * mm, w - 14 * mm
        y = h - 12 * mm
        x = left
        logo = c.get("_logo_bytes")
        if logo:
            try:
                canvas.drawImage(io.BytesIO(logo), x, y - 10 * mm, width=22 * mm, height=11 * mm, preserveAspectRatio=True, mask="auto")
                x += 25 * mm
            except Exception:
                pass
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 14)
        canvas.drawString(x, y - 3 * mm, c.get("legal_name") or c.get("name") or "KKT")
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        addr = c.get("address") or {}
        canvas.drawString(x, y - 7.5 * mm, ", ".join(filter(None, [addr.get("line1"), addr.get("line2"), addr.get("city"), addr.get("state"), addr.get("pincode")])))
        contact = " · ".join(filter(None, [c.get("letterhead_phone") or c.get("phone"), c.get("letterhead_email") or c.get("email")]))
        canvas.drawString(x, y - 11 * mm, contact)
        reg = " · ".join(filter(None, [f"GSTIN {c['gstin']}" if c.get("gstin") else None, f"RERA {c['rera_registration']}" if c.get("rera_registration") else None]))
        canvas.drawRightString(right, y - 11 * mm, reg)
        if c.get("letterhead_tagline"):
            canvas.setFont("Helvetica-Oblique", 8)
            canvas.setFillColor(GOLD)
            canvas.drawRightString(right, y - 3 * mm, c["letterhead_tagline"])
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(1.4)
        canvas.line(left, y - 14 * mm, right, y - 14 * mm)
        # title block
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 12)
        canvas.drawString(left, y - 20.5 * mm, self.title.upper())
        canvas.setFont("Helvetica", 8.5)
        canvas.setFillColor(INK)
        meta = " · ".join(filter(None, [f"No. {self.number}" if self.number else None, f"Date {fmt_date(self.date)}" if self.date else None])) or (self.subtitle or "")
        canvas.drawRightString(right, y - 20.5 * mm, meta)
        if self.subtitle and (self.number or self.date):
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(MUTED)
            canvas.drawRightString(right, y - 24.5 * mm, self.subtitle)
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(left, y - 26.5 * mm, right, y - 26.5 * mm)
        # footer (page X of Y is drawn by NumberedCanvas)
        canvas.line(left, 14 * mm, right, 14 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(left, 10 * mm, f"{c.get('name', 'KKT')} · Computer-generated document, no signature required unless stamped.")
        tail = f"Generated {self.generated} IST" + (f" · Verification {self.verify}" if self.verify else "")
        canvas.drawString(left, 6.5 * mm, tail)
        canvas.restoreState()

    def h1(self, text):
        self.story.append(Paragraph(text, H1))

    def h2(self, text):
        self.story.append(Paragraph(text, H2))

    def p(self, text, style=None):
        self.story.append(Paragraph(text, style or BODY))

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
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BACKGROUND", (0, 0), (-1, -1), IVORY),
                               ("BOX", (0, 0), (-1, -1), 0.5, RULE), ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
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
                 ("GRID", (0, 1), (-1, -1), 0.25, RULE), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
        if zebra:
            for i in range(1, len(data)):
                if i % 2 == 0:
                    style.append(("BACKGROUND", (0, i), (-1, i), IVORY))
        if totals:
            style += [("BACKGROUND", (0, len(data) - 1), (-1, len(data) - 1), colors.HexColor("#FBF3D5")), ("LINEABOVE", (0, len(data) - 1), (-1, len(data) - 1), 1, GOLD)]
        t.setStyle(TableStyle(style))
        self.story.append(t)

    def totals(self, pairs: list[tuple[str, str]], emphasis_last=True):
        """Right-aligned totals block (label / amount) used under tables."""
        avail = self.pagesize[0] - 28 * mm
        rows = [[Paragraph(k, ParagraphStyle("tl", parent=CELL, alignment=TA_RIGHT, textColor=MUTED)), Paragraph(f"<b>{v}</b>", ParagraphStyle("tv", parent=CELL, alignment=TA_RIGHT))] for k, v in pairs]
        t = Table(rows, colWidths=[avail * 0.72, avail * 0.28])
        style = [("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
        if emphasis_last and rows:
            style += [("LINEABOVE", (1, len(rows) - 1), (1, len(rows) - 1), 1, GOLD), ("BACKGROUND", (1, len(rows) - 1), (1, len(rows) - 1), colors.HexColor("#FBF3D5"))]
        t.setStyle(TableStyle(style))
        self.story.append(t)

    def signature(self, name: str, label="Authorised Signatory"):
        """Right-aligned signature block flush with the right margin: company line, signature rule, signatory name, label."""
        self.spacer(8)
        avail = self.pagesize[0] - 28 * mm
        box = 64 * mm
        rows = [["", f"For {self.company.get('legal_name') or self.company.get('name', '')}"], ["", ""], ["", ""], ["", name or ""], ["", label]]
        t = Table(rows, colWidths=[avail - box, box], rowHeights=[5 * mm, 5 * mm, 5 * mm, 5 * mm, 4.5 * mm])
        t.setStyle(TableStyle([("FONTNAME", (1, 0), (1, 0), "Helvetica-Bold"), ("FONTNAME", (1, 3), (1, 3), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                               ("TEXTCOLOR", (1, 0), (1, 0), NAVY), ("TEXTCOLOR", (1, 4), (1, 4), colors.HexColor("#64748B")), ("FONTSIZE", (1, 4), (1, 4), 7.5),
                               ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("LINEABOVE", (1, 3), (1, 3), 0.6, NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("BOTTOMPADDING", (0, 0), (-1, -1), 1), ("TOPPADDING", (0, 0), (-1, -1), 1)]))
        self.story.append(t)

    def build(self) -> bytes:
        self.doc.build(self.story, onFirstPage=self._header_footer, onLaterPages=self._header_footer, canvasmaker=NumberedCanvas)
        return self.buf.getvalue()


def brochure_pdf(project: dict, company: dict | None = None) -> bytes:
    """Simple branded brochure used when a project has no uploaded brochure."""
    web = project.get("website") or {}
    d = BrandedDoc(f"{project['name']} — Brochure", company or {"name": "KKT Constructions"}, subtitle=(project.get("address") or {}).get("city") or "Patna")
    d.h1(project["name"])
    d.p(web.get("public_description") or project.get("description") or "A thoughtfully designed residential address by Shree Ganesh Builders.")
    d.spacer(6)
    d.h2("Highlights")
    for h in (web.get("highlights") or ["RERA-registered", "Construction-linked payment plan", "Vastu-compliant layouts"])[:10]:
        d.p(f"• {h}")
    d.spacer(6)
    d.kv([("Project type", project.get("project_type") or "Residential"), ("Status", project.get("status") or "Under Construction"), ("RERA", project.get("rera_number") or "—"), ("Location", ", ".join(filter(None, [(project.get("address") or {}).get("line1"), (project.get("address") or {}).get("city")])) or "Patna")])
    d.spacer(8)
    d.small("Prices and specifications are indicative and subject to change. E&OE.")
    return d.build()
