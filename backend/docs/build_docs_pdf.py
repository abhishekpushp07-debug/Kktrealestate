"""Render /app/docs/KKT_Technical_Documentation.md into a branded A4 PDF with reportlab.
Supports: # / ## / ### headings, paragraphs, - bullets, 1. lists, | tables |, ``` code, ```flow, ```state, ```seq diagrams,
> callouts, {{include:name.md}}, {{toc}}. Usage: python build_docs_pdf.py [--regen]"""
import datetime as dt
import os
import re
import subprocess
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, NextPageTemplate, PageBreak, PageTemplate, Paragraph, Preformatted, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = "/app/docs"
SRC = f"{ROOT}/KKT_Technical_Documentation.md"
OUT = f"{ROOT}/KKT_Technical_Documentation.pdf"
NAVY, GOLD, IVORY, INK = colors.HexColor("#0B1F3A"), colors.HexColor("#C9A227"), colors.HexColor("#F7F5EF"), colors.HexColor("#1F2937")
VERSION = "9.0"
W, H = A4
ss = getSampleStyleSheet()
S = {
    "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=22, textColor=NAVY, spaceBefore=18, spaceAfter=12),
    "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=15, textColor=NAVY, spaceBefore=14, spaceAfter=8),
    "h3": ParagraphStyle("h3", parent=ss["Heading3"], fontName="Helvetica-Bold", fontSize=11.5, textColor=colors.HexColor("#163866"), spaceBefore=10, spaceAfter=5),
    "body": ParagraphStyle("body", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.6, leading=13.5, textColor=INK, spaceAfter=5),
    "bullet": ParagraphStyle("bullet", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.6, leading=13.2, textColor=INK, leftIndent=12, bulletIndent=2, spaceAfter=2),
    "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8, leading=10, textColor=INK),
    "cellh": ParagraphStyle("cellh", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.white),
    "code": ParagraphStyle("code", fontName="Courier", fontSize=7.8, leading=10, textColor=INK, backColor=colors.HexColor("#F3F4F6"), borderPadding=6, leftIndent=4, spaceBefore=4, spaceAfter=8),
    "callout": ParagraphStyle("callout", parent=ss["BodyText"], fontName="Helvetica-Oblique", fontSize=9.4, leading=13, textColor=NAVY, backColor=colors.HexColor("#FBF6E4"), borderColor=GOLD, borderWidth=1, borderPadding=7, leftIndent=6, spaceBefore=6, spaceAfter=10),
    "toc0": ParagraphStyle("toc0", fontName="Helvetica-Bold", fontSize=11, textColor=NAVY, spaceBefore=6, leading=14),
    "toc1": ParagraphStyle("toc1", fontName="Helvetica", fontSize=9.5, leftIndent=14, leading=12.5),
    "toc2": ParagraphStyle("toc2", fontName="Helvetica", fontSize=8.5, leftIndent=28, leading=11.5, textColor=colors.HexColor("#4B5563")),
}
_section = {"title": ""}


def inline(t: str) -> str:
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"`([^`]+)`", r'<font face="Courier" size="8.5" color="#0B1F3A">\1</font>', t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<i>\1</i>", t)
    return t


class Doc(BaseDocTemplate):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        frame = Frame(18 * mm, 20 * mm, W - 36 * mm, H - 40 * mm, id="f")
        self.addPageTemplates([PageTemplate(id="cover", frames=[Frame(0, 0, W, H, id="c")], onPage=lambda c, d: None), PageTemplate(id="main", frames=[frame], onPage=self.decorate)])

    def decorate(self, c, d):
        c.saveState()
        c.setFillColor(NAVY); c.rect(0, H - 12 * mm, W, 12 * mm, fill=1, stroke=0)
        c.setFillColor(GOLD); c.rect(0, H - 12.6 * mm, W, 0.6 * mm, fill=1, stroke=0)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 8.5); c.drawString(18 * mm, H - 8 * mm, "KKT — Technical & Functional Specification")
        c.setFont("Helvetica", 8.5); c.drawRightString(W - 18 * mm, H - 8 * mm, _section["title"][:80])
        c.setFillColor(colors.HexColor("#6B7280")); c.setFont("Helvetica", 8)
        c.drawString(18 * mm, 11 * mm, f"v{VERSION} · {dt.date.today().strftime('%d %b %Y')} · Confidential")
        c.restoreState()

    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name in ("h1", "h2", "h3"):
            text = re.sub(r"<[^>]+>", "", f.getPlainText())
            lvl = {"h1": 0, "h2": 1, "h3": 2}[f.style.name]
            if lvl < 2:
                _section["title"] = text
            key = f"s{abs(hash(text)) % 10**9}{self.page}"
            self.canv.bookmarkPage(key)
            self.notify("TOCEntry", (lvl, text, self.page, key))


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *a, **k):
        super().__init__(*a, **k); self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__)); self._startPage()

    def save(self):
        n = len(self._saved)
        for st in self._saved:
            self.__dict__.update(st)
            if self._pageNumber > 1:
                self.setFont("Helvetica", 8); self.setFillColor(colors.HexColor("#6B7280"))
                self.drawRightString(W - 18 * mm, 11 * mm, f"Page {self._pageNumber} of {n}")
            super().showPage()
        super().save()


def cover():
    def draw(c, d):
        c.setFillColor(NAVY); c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setFillColor(GOLD); c.rect(18 * mm, H - 70 * mm, 60 * mm, 1.2 * mm, fill=1, stroke=0)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 44); c.drawString(18 * mm, H - 95 * mm, "KKT")
        c.setFont("Helvetica", 20); c.drawString(18 * mm, H - 108 * mm, "Real Estate ERP · Marketing Site · Customer Portal")
        c.setFillColor(GOLD); c.setFont("Helvetica-Bold", 15); c.drawString(18 * mm, H - 128 * mm, "Technical & Functional Specification")
        c.setFillColor(colors.HexColor("#CBD5E1")); c.setFont("Helvetica", 11)
        for i, l in enumerate([f"Version {VERSION} · {dt.date.today().strftime('%d %B %Y')}", "Derived from the production code base (FastAPI · React · MongoDB · Expo)", "Audience: owners, sales leadership, IT & integration teams", "Confidential — prepared for prospective enterprise customers"]):
            c.drawString(18 * mm, H - 145 * mm - i * 7 * mm, l)
        c.setFillColor(GOLD); c.rect(0, 0, W, 6 * mm, fill=1, stroke=0)
    return draw


def table(rows):
    ncol = max(len(r) for r in rows)
    data = [[Paragraph(inline(c), S["cellh"] if i == 0 else S["cell"]) for c in r + [""] * (ncol - len(r))] for i, r in enumerate(rows)]
    avail = W - 36 * mm
    lens = [max(len(re.sub(r"[`*]", "", r[j])) if j < len(r) else 1 for r in rows) for j in range(ncol)]
    tot = sum(min(max(l, 4), 60) for l in lens)
    widths = [avail * min(max(l, 4), 60) / tot for l in lens]
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#D1D5DB")), ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    for i in range(1, len(data)):
        if i % 2 == 0:
            st.append(("BACKGROUND", (0, i), (-1, i), IVORY))
    t.setStyle(TableStyle(st))
    return [t, Spacer(1, 8)]


def box(d, x, y, w, h, text, fill=IVORY, stroke=NAVY, size=7.5):
    d.add(Rect(x, y, w, h, rx=4, ry=4, fillColor=fill, strokeColor=stroke, strokeWidth=0.8))
    lines = []
    for word in text.split():
        if lines and len(lines[-1] + " " + word) * size * 0.52 < w - 8:
            lines[-1] += " " + word
        else:
            lines.append(word)
    for i, l in enumerate(lines[:3]):
        d.add(String(x + w / 2, y + h / 2 + (len(lines[:3]) - 1) * size * 0.6 - i * size * 1.2 - size * 0.35, l, fontName="Helvetica", fontSize=size, fillColor=NAVY, textAnchor="middle"))


def arrow(d, x1, y1, x2, y2, label=None):
    d.add(Line(x1, y1, x2, y2, strokeColor=NAVY, strokeWidth=0.8))
    if x2 >= x1:
        d.add(Polygon([x2, y2, x2 - 5, y2 + 2.5, x2 - 5, y2 - 2.5], fillColor=NAVY, strokeColor=NAVY))
    else:
        d.add(Polygon([x2, y2, x2 + 5, y2 + 2.5, x2 + 5, y2 - 2.5], fillColor=NAVY, strokeColor=NAVY))
    if label:
        d.add(String((x1 + x2) / 2, max(y1, y2) + 3, label, fontName="Helvetica-Oblique", fontSize=6.5, fillColor=colors.HexColor("#6B7280"), textAnchor="middle"))


def flow_diagram(lines):
    """Each line: 'A -> B -> C' rendered as a row of boxes (wrapping 4 per row)."""
    steps = [s.strip() for l in lines for s in l.split("->") if s.strip()]
    per, bw, bh, gap = 4, 112, 34, 22
    rows = (len(steps) + per - 1) // per
    d = Drawing(W - 36 * mm, rows * (bh + 18))
    for i, s in enumerate(steps):
        r, c = divmod(i, per)
        x, y = 10 + c * (bw + gap), d.height - (r + 1) * (bh + 18) + 9
        box(d, x, y, bw, bh, s, fill=IVORY if i else colors.HexColor("#E8EEF7"))
        if i + 1 < len(steps):
            if c + 1 < per:
                arrow(d, x + bw, y + bh / 2, x + bw + gap - 1, y + bh / 2)
            else:
                arrow(d, x + bw / 2, y, 10 + bw / 2, y - 18 + 1)
    return [KeepTogether([d, Spacer(1, 6)])]


def state_diagram(lines):
    """Lines 'A -> B : guard'. States as gold-outlined pills in a grid + transition table below."""
    trans = []
    for l in lines:
        m = re.match(r"\s*(.+?)\s*->\s*(.+?)\s*(?::\s*(.*))?$", l)
        if m:
            trans.append((m.group(1), m.group(2), m.group(3) or ""))
    states = list(dict.fromkeys([t[0] for t in trans] + [t[1] for t in trans]))
    per, bw, bh, gap = 5, 88, 24, 14
    rows = (len(states) + per - 1) // per
    d = Drawing(W - 36 * mm, rows * (bh + 10))
    for i, s in enumerate(states):
        r, c = divmod(i, per)
        box(d, 10 + c * (bw + gap), d.height - (r + 1) * (bh + 10) + 5, bw, bh, s, fill=colors.white, stroke=GOLD, size=7.5)
    return [d, Spacer(1, 4)] + table([["From", "To", "Transition / guard"]] + [[a, b, g] for a, b, g in trans])


def seq_diagram(lines):
    """Lines 'Actor -> Actor : message' rendered with lifelines and labelled arrows."""
    msgs = []
    for l in lines:
        m = re.match(r"\s*(.+?)\s*->\s*(.+?)\s*:\s*(.*)$", l)
        if m:
            msgs.append(m.groups())
    actors = list(dict.fromkeys([m[0] for m in msgs] + [m[1] for m in msgs]))
    width = W - 36 * mm
    col = width / max(len(actors), 1)
    top, step = 30, 22
    d = Drawing(width, top + step * len(msgs) + 20)
    xs = {a: col * i + col / 2 for i, a in enumerate(actors)}
    for a in actors:
        box(d, xs[a] - 42, d.height - 26, 84, 22, a, fill=colors.HexColor("#E8EEF7"))
        d.add(Line(xs[a], d.height - 26, xs[a], 6, strokeColor=colors.HexColor("#9CA3AF"), strokeWidth=0.6, strokeDashArray=[2, 2]))
    for i, (a, b, msg) in enumerate(msgs):
        y = d.height - top - 10 - i * step
        if a == b:
            d.add(String(xs[a] + 6, y, f"{i + 1}. {msg}", fontName="Helvetica", fontSize=6.8, fillColor=INK))
        else:
            arrow(d, xs[a], y, xs[b] + (-3 if xs[b] > xs[a] else 3), y)
            d.add(String((xs[a] + xs[b]) / 2, y + 3, f"{i + 1}. {msg}", fontName="Helvetica", fontSize=6.8, fillColor=INK, textAnchor="middle"))
    return [KeepTogether([d, Spacer(1, 6)])]


def render(md: str):
    out, i, lines = [], 0, md.split("\n")
    while i < len(lines):
        l = lines[i]
        if l.startswith("```"):
            kind = l[3:].strip()
            j = i + 1
            block = []
            while j < len(lines) and not lines[j].startswith("```"):
                block.append(lines[j]); j += 1
            i = j + 1
            if kind == "flow":
                out += flow_diagram(block)
            elif kind == "state":
                out += state_diagram(block)
            elif kind == "seq":
                out += seq_diagram(block)
            else:
                out.append(Preformatted("\n".join(block), S["code"]))
            continue
        if l.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                if not re.match(r"^\|[\s:|-]+\|$", lines[i]):
                    rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            out += table(rows)
            continue
        m = re.match(r"\{\{include:(.+)\}\}", l.strip())
        if m:
            out += render(open(f"{ROOT}/generated/{m.group(1)}").read()); i += 1; continue
        if l.strip() == "{{toc}}":
            toc = TableOfContents(); toc.levelStyles = [S["toc0"], S["toc1"], S["toc2"]]
            out += [Paragraph("Contents", S["h1"]), toc, PageBreak()]; i += 1; continue
        if l.startswith("# "):
            out += [PageBreak(), Paragraph(inline(l[2:]), S["h1"])]
        elif l.startswith("## "):
            out.append(Paragraph(inline(l[3:]), S["h2"]))
        elif l.startswith("### "):
            out.append(Paragraph(inline(l[4:]), S["h3"]))
        elif l.startswith("> "):
            buf = []
            while i < len(lines) and lines[i].startswith("> "):
                buf.append(lines[i][2:]); i += 1
            out.append(Paragraph(inline(" ".join(buf)), S["callout"])); continue
        elif re.match(r"^\s*[-*] ", l):
            out.append(Paragraph(inline(re.sub(r"^\s*[-*] ", "", l)), S["bullet"], bulletText="•"))
        elif re.match(r"^\s*\d+\. ", l):
            n = re.match(r"^\s*(\d+)\. ", l).group(1)
            out.append(Paragraph(inline(re.sub(r"^\s*\d+\. ", "", l)), S["bullet"], bulletText=f"{n}."))
        elif l.strip():
            out.append(Paragraph(inline(l), S["body"]))
        i += 1
    return out


def build():
    md = open(SRC).read()
    doc = Doc(OUT, pagesize=A4, title="KKT — Technical & Functional Specification", author="KKT")
    story = [NextPageTemplate("cover"), Spacer(1, 1), NextPageTemplate("main"), PageBreak()] + render(md)
    doc.pageTemplates[0].onPage = cover()
    doc.multiBuild(story, canvasmaker=NumberedCanvas)
    return OUT


if __name__ == "__main__":
    if "--regen" in sys.argv:
        subprocess.run([sys.executable, "/app/backend/docs/gen_sections.py"], check=True, cwd="/app/backend")
    build()
    from pypdf import PdfReader
    print("pages", len(PdfReader(OUT).pages), OUT)
