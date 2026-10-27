/**
 * PDF renderer (runs inside the PDF worker threads, never on the API event loop): replays a serialisable list of layout operations
 * recorded by `BrandedPdf` (services/pdf.ts) onto pdfkit. Every string arrives pre-formatted (₹ amounts with Indian grouping, words, IST
 * dates), so this module depends on pdfkit and node builtins only and the worker's module graph stays tiny.
 *
 * Fonts: DejaVu Sans (regular, bold, oblique) from the `dejavu-fonts-ttf` package, embedded and subset into every document, so the
 * rupee sign (U+20B9) and every other Unicode glyph print correctly. A copy under apps/api/assets/fonts (DejaVuSans*.ttf) wins when present.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

/** Theme (SPEC §0: royal deep navy + gold). */
export const PDF_THEME = {
  navy: "#0B1F3A",
  gold: "#C9A227",
  ink: "#1F2937",
  muted: "#6B7280",
  rule: "#D1D5DB",
  zebra: "#F6F3EA",
  white: "#FFFFFF",
  danger: "#B00020",
} as const;

/** Letterhead strings (+ logo bytes) as they reach the renderer. */
export interface RenderLetterhead {
  name: string;
  subLine: string | null;
  lines: string[];
  /** PNG or JPEG bytes (checked on the main thread). */
  logo: Uint8Array | null;
}

/** Document-level options of a render task. */
export interface RenderOptions {
  letterhead: RenderLetterhead;
  title: string;
  reference: string | null;
  watermark: string | null;
  landscape: boolean;
  metaTitle: string;
  author: string;
  /** Left part of every page footer ("Generated 24 Oct 2026, 10:30 IST · Company"). */
  footer: string;
}

/** One table column as rendered. */
export interface RenderColumn {
  header: string;
  width: number;
  align: "left" | "right" | "center";
}

/** A recorded layout operation (all text pre-formatted). */
export type PdfOp =
  | { op: "spacer"; h: number }
  | { op: "ensureSpace"; needed: number }
  | { op: "heading"; text: string }
  | {
      op: "paragraph";
      text: string;
      size: number;
      italic: boolean;
      color: string;
      align: "left" | "right" | "center" | "justify";
    }
  | { op: "kv"; blocks: { title: string | null; rows: [string, string][] }[] }
  | {
      op: "table";
      columns: RenderColumn[];
      rows: string[][];
      totals: string[] | null;
      emptyText: string;
      fontSize: number;
    }
  | { op: "boxedText"; text: string }
  | { op: "amountBox"; label: string; amount: string }
  | { op: "signature"; forName: string; name: string; title: string | null };

/** What the worker receives. */
export interface PdfRenderTask {
  options: RenderOptions;
  ops: PdfOp[];
}

/** Font files used by every PDF. */
export interface PdfFontFiles {
  regular: string;
  bold: string;
  italic: string;
}

const FONT_FILES = {
  regular: "DejaVuSans.ttf",
  bold: "DejaVuSans-Bold.ttf",
  italic: "DejaVuSans-Oblique.ttf",
} as const;

/**
 * Locates the DejaVu Sans TTFs: apps/api/assets/fonts (operator override) first, then the `dejavu-fonts-ttf` package. Throws when the
 * regular face cannot be found — a PDF without the rupee glyph is a defect, not a fallback.
 */
export function resolvePdfFonts(): PdfFontFiles {
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs = [
    join(here, "../../../../assets/fonts"), // source tree: src/modules/reports/services
    join(here, "../assets/fonts"), // tsup bundle: dist/<chunk>.js
    join(process.cwd(), "assets/fonts"),
    join(process.cwd(), "apps/api/assets/fonts"),
  ];
  try {
    const require = createRequire(import.meta.url);
    dirs.push(join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf"));
  } catch {
    /* package missing: only the asset directories remain */
  }
  for (const dir of dirs) {
    const regular = join(dir, FONT_FILES.regular);
    if (!existsSync(regular)) continue;
    const pick = (f: string): string => (existsSync(join(dir, f)) ? join(dir, f) : regular);
    return { regular, bold: pick(FONT_FILES.bold), italic: pick(FONT_FILES.italic) };
  }
  throw new Error(
    `PDF fonts not found: ${FONT_FILES.regular} is in none of ${dirs.join(", ")} (install dejavu-fonts-ttf)`,
  );
}

let fontCache: { regular: Buffer; bold: Buffer; italic: Buffer } | null = null;

/** Font bytes, read once per thread. */
function fontBytes(): { regular: Buffer; bold: Buffer; italic: Buffer } {
  if (!fontCache) {
    const f = resolvePdfFonts();
    fontCache = { regular: readFileSync(f.regular), bold: readFileSync(f.bold), italic: readFileSync(f.italic) };
  }
  return fontCache;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const F_REGULAR = "DejaVuSans";
const F_BOLD = "DejaVuSans-Bold";
const F_ITALIC = "DejaVuSans-Oblique";

type Doc = InstanceType<typeof PDFDocument>;

/** Renders a task into a pdfkit document; `onData` receives the bytes as pdfkit produces them. Resolves when the document has ended. */
export function renderPdf(task: PdfRenderTask, onData: (chunk: Buffer) => void): Promise<void> {
  const r = new Renderer(task.options);
  return new Promise<void>((resolve, reject) => {
    r.doc.on("data", onData);
    r.doc.on("end", () => resolve());
    r.doc.on("error", reject);
    try {
      for (const op of task.ops) r.apply(op);
      r.stampFooters();
      r.doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Renders a task into one buffer (tests, the in-thread path of the worker). */
export async function renderPdfToBuffer(task: PdfRenderTask): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await renderPdf(task, (c) => chunks.push(c));
  return Buffer.concat(chunks);
}

class Renderer {
  readonly doc: Doc;
  private readonly opts: RenderOptions;
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly bodyTop: number;
  private readonly bodyBottom: number;

  constructor(opts: RenderOptions) {
    this.opts = opts;
    const landscape = opts.landscape;
    this.pageWidth = landscape ? A4.height : A4.width;
    this.pageHeight = landscape ? A4.width : A4.height;
    this.doc = new PDFDocument({
      size: "A4",
      layout: landscape ? "landscape" : "portrait",
      margins: { top: MARGIN, bottom: MARGIN + 22, left: MARGIN, right: MARGIN },
      bufferPages: true,
      autoFirstPage: false,
      info: { Title: opts.metaTitle, Author: opts.author, Creator: "KKT", Producer: "KKT (pdfkit)" },
    });
    const fonts = fontBytes();
    this.doc.registerFont(F_REGULAR, fonts.regular);
    this.doc.registerFont(F_BOLD, fonts.bold);
    this.doc.registerFont(F_ITALIC, fonts.italic);
    this.bodyBottom = this.pageHeight - MARGIN - 22;
    this.bodyTop = MARGIN + 92;
    this.doc.on("pageAdded", () => this.drawPageChrome());
    this.doc.addPage();
  }

  get contentWidth(): number {
    return this.pageWidth - 2 * MARGIN;
  }

  apply(op: PdfOp): void {
    switch (op.op) {
      case "spacer":
        this.doc.y += op.h;
        return;
      case "ensureSpace":
        this.ensureSpace(op.needed);
        return;
      case "heading":
        return this.heading(op.text);
      case "paragraph":
        return this.paragraph(op.text, op);
      case "kv":
        return this.kv(op.blocks);
      case "table":
        return this.table(op);
      case "boxedText":
        return this.boxedText(op.text);
      case "amountBox":
        return this.amountBox(op.label, op.amount);
      case "signature":
        return this.signature(op.forName, op.name, op.title);
    }
  }

  private drawPageChrome(): void {
    const d = this.doc;
    const lh = this.opts.letterhead;
    const left = MARGIN;
    let textLeft = left;
    if (lh.logo) {
      try {
        d.image(Buffer.from(lh.logo), left, MARGIN, { fit: [64, 44] });
        textLeft = left + 76;
      } catch {
        textLeft = left;
      }
    }
    const textWidth = this.pageWidth - MARGIN - textLeft;
    d.font(F_BOLD)
      .fontSize(15)
      .fillColor(PDF_THEME.navy)
      .text(lh.name, textLeft, MARGIN, { width: textWidth, lineBreak: false });
    let y = MARGIN + 18;
    if (lh.subLine) {
      d.font(F_ITALIC)
        .fontSize(8.5)
        .fillColor(PDF_THEME.muted)
        .text(lh.subLine, textLeft, y, { width: textWidth, lineBreak: false });
      y += 11;
    }
    d.font(F_REGULAR).fontSize(8).fillColor(PDF_THEME.ink);
    for (const line of lh.lines) {
      d.text(line, textLeft, y, { width: textWidth, lineBreak: false });
      y += 10;
    }
    // gold rule
    const ruleY = MARGIN + 58;
    d.moveTo(left, ruleY)
      .lineTo(this.pageWidth - MARGIN, ruleY)
      .lineWidth(1.6)
      .strokeColor(PDF_THEME.gold)
      .stroke();
    // title bar
    const barY = ruleY + 8;
    d.rect(left, barY, this.contentWidth, 22).fill(PDF_THEME.navy);
    d.font(F_BOLD)
      .fontSize(11)
      .fillColor(PDF_THEME.white)
      .text(this.opts.title.toUpperCase(), left + 8, barY + 6, { width: this.contentWidth * 0.6, lineBreak: false });
    if (this.opts.reference) {
      d.font(F_REGULAR)
        .fontSize(9)
        .fillColor(PDF_THEME.white)
        .text(this.opts.reference, left + this.contentWidth * 0.5 - 8, barY + 7, {
          width: this.contentWidth * 0.5,
          align: "right",
          lineBreak: false,
        });
    }
    if (this.opts.watermark) this.drawWatermark(this.opts.watermark);
    d.fillColor(PDF_THEME.ink).font(F_REGULAR).fontSize(9);
    d.x = left;
    d.y = this.bodyTop;
  }

  private drawWatermark(text: string): void {
    const d = this.doc;
    d.save();
    const cx = this.pageWidth / 2;
    const cy = this.pageHeight / 2;
    d.rotate(-35, { origin: [cx, cy] });
    d.font(F_BOLD).fontSize(84).fillColor(PDF_THEME.danger).fillOpacity(0.12);
    const w = d.widthOfString(text);
    d.text(text, cx - w / 2, cy - 42, { lineBreak: false });
    d.restore();
    d.fillOpacity(1);
  }

  private ensureSpace(needed: number): void {
    if (this.doc.y + needed > this.bodyBottom) this.doc.addPage();
  }

  private heading(text: string): void {
    this.ensureSpace(26);
    const d = this.doc;
    d.font(F_BOLD).fontSize(10.5).fillColor(PDF_THEME.navy).text(text, MARGIN, d.y, { width: this.contentWidth });
    const y = d.y + 2;
    d.moveTo(MARGIN, y)
      .lineTo(MARGIN + 60, y)
      .lineWidth(1)
      .strokeColor(PDF_THEME.gold)
      .stroke();
    d.y = y + 7;
    d.fillColor(PDF_THEME.ink).font(F_REGULAR).fontSize(9);
  }

  private paragraph(
    text: string,
    opts: { size: number; italic: boolean; color: string; align: "left" | "right" | "center" | "justify" },
  ): void {
    const d = this.doc;
    d.font(opts.italic ? F_ITALIC : F_REGULAR)
      .fontSize(opts.size)
      .fillColor(opts.color);
    const h = d.heightOfString(text, { width: this.contentWidth, align: opts.align });
    this.ensureSpace(Math.min(h, 200));
    d.text(text, MARGIN, d.y, { width: this.contentWidth, align: opts.align });
    d.y += 6;
  }

  private kv(blocks: { title: string | null; rows: [string, string][] }[]): void {
    const d = this.doc;
    const gap = 16;
    const colWidth = (this.contentWidth - gap) / 2;
    for (let i = 0; i < blocks.length; i += 2) {
      const pair = blocks.slice(i, i + 2);
      const heights = pair.map((b) => this.kvHeight(b, colWidth));
      const rowHeight = Math.max(...heights);
      this.ensureSpace(rowHeight + 8);
      const top = d.y;
      pair.forEach((b, idx) => this.drawKvBlock(b, MARGIN + idx * (colWidth + gap), top, colWidth));
      d.y = top + rowHeight + 8;
      d.x = MARGIN;
    }
  }

  private kvHeight(block: { title: string | null; rows: [string, string][] }, width: number): number {
    const d = this.doc;
    let h = block.title ? 16 : 0;
    const valueWidth = width * 0.6;
    for (const [, v] of block.rows) {
      d.font(F_BOLD).fontSize(9);
      h += Math.max(12, d.heightOfString(v, { width: valueWidth }) + 3);
    }
    return h + 4;
  }

  private drawKvBlock(
    block: { title: string | null; rows: [string, string][] },
    x: number,
    top: number,
    width: number,
  ): void {
    const d = this.doc;
    let y = top;
    if (block.title) {
      d.font(F_BOLD)
        .fontSize(8)
        .fillColor(PDF_THEME.gold)
        .text(block.title.toUpperCase(), x, y, { width, lineBreak: false });
      y += 14;
      d.moveTo(x, y - 2)
        .lineTo(x + width, y - 2)
        .lineWidth(0.5)
        .strokeColor(PDF_THEME.rule)
        .stroke();
      y += 2;
    }
    const labelWidth = width * 0.4 - 4;
    const valueWidth = width * 0.6;
    for (const [label, text] of block.rows) {
      d.font(F_REGULAR)
        .fontSize(8.5)
        .fillColor(PDF_THEME.muted)
        .text(label, x, y, { width: labelWidth, lineBreak: false });
      d.font(F_BOLD).fontSize(9).fillColor(PDF_THEME.ink);
      const h = d.heightOfString(text, { width: valueWidth });
      d.text(text, x + width * 0.4, y, { width: valueWidth });
      y += Math.max(12, h + 3);
    }
    d.fillColor(PDF_THEME.ink);
  }

  private table(t: Extract<PdfOp, { op: "table" }>): void {
    const d = this.doc;
    const { columns, fontSize } = t;
    const totalWeight = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (this.contentWidth * c.width) / totalWeight);
    const pad = 4;

    const drawHeader = (): void => {
      const y = d.y;
      d.rect(MARGIN, y, this.contentWidth, 16).fill(PDF_THEME.navy);
      d.font(F_BOLD).fontSize(fontSize).fillColor(PDF_THEME.white);
      let x = MARGIN;
      columns.forEach((c, i) => {
        const w = widths[i] ?? 0;
        d.text(c.header, x + pad, y + 4.5, { width: w - 2 * pad, align: c.align, lineBreak: false, ellipsis: true });
        x += w;
      });
      d.y = y + 16;
      d.fillColor(PDF_THEME.ink).font(F_REGULAR);
    };

    const rowHeight = (texts: string[], bold: boolean): number => {
      d.font(bold ? F_BOLD : F_REGULAR).fontSize(fontSize);
      let h = 0;
      texts.forEach((txt, i) => {
        h = Math.max(h, d.heightOfString(txt, { width: (widths[i] ?? 0) - 2 * pad }));
      });
      return Math.max(14, h + 5);
    };

    const drawRow = (texts: string[], opt: { zebra: boolean; bold?: boolean; top?: boolean }): void => {
      const h = rowHeight(texts, opt.bold === true);
      if (d.y + h > this.bodyBottom) {
        d.addPage();
        drawHeader();
      }
      const y = d.y;
      if (opt.zebra) d.rect(MARGIN, y, this.contentWidth, h).fill(PDF_THEME.zebra);
      if (opt.top)
        d.moveTo(MARGIN, y)
          .lineTo(MARGIN + this.contentWidth, y)
          .lineWidth(1)
          .strokeColor(PDF_THEME.gold)
          .stroke();
      d.font(opt.bold ? F_BOLD : F_REGULAR)
        .fontSize(fontSize)
        .fillColor(PDF_THEME.ink);
      let x = MARGIN;
      texts.forEach((txt, i) => {
        const w = widths[i] ?? 0;
        d.text(txt, x + pad, y + 3, { width: w - 2 * pad, align: columns[i]?.align ?? "left" });
        x += w;
      });
      d.moveTo(MARGIN, y + h)
        .lineTo(MARGIN + this.contentWidth, y + h)
        .lineWidth(0.3)
        .strokeColor(PDF_THEME.rule)
        .stroke();
      d.y = y + h;
      d.x = MARGIN;
    };

    this.ensureSpace(40);
    drawHeader();
    if (t.rows.length === 0) drawRow([t.emptyText, ...columns.slice(1).map(() => "")], { zebra: false });
    t.rows.forEach((row, idx) => drawRow(row, { zebra: idx % 2 === 1 }));
    if (t.totals) drawRow(t.totals, { zebra: false, bold: true, top: true });
    d.y += 8;
  }

  private boxedText(text: string): void {
    const d = this.doc;
    d.font(F_ITALIC).fontSize(9.5);
    const h = d.heightOfString(text, { width: this.contentWidth - 16 }) + 12;
    this.ensureSpace(h + 6);
    const y = d.y;
    d.rect(MARGIN, y, this.contentWidth, h).lineWidth(0.6).strokeColor(PDF_THEME.gold).stroke();
    d.fillColor(PDF_THEME.ink).text(text, MARGIN + 8, y + 6, { width: this.contentWidth - 16 });
    d.y = y + h + 8;
    d.x = MARGIN;
  }

  private amountBox(label: string, amount: string): void {
    const d = this.doc;
    this.ensureSpace(44);
    const y = d.y;
    d.rect(MARGIN, y, this.contentWidth, 36).fill(PDF_THEME.zebra);
    d.font(F_REGULAR)
      .fontSize(9)
      .fillColor(PDF_THEME.muted)
      .text(label, MARGIN + 10, y + 12, { width: this.contentWidth / 2, lineBreak: false });
    d.font(F_BOLD)
      .fontSize(16)
      .fillColor(PDF_THEME.navy)
      .text(amount, MARGIN + this.contentWidth / 2 - 10, y + 9, {
        width: this.contentWidth / 2,
        align: "right",
        lineBreak: false,
      });
    d.y = y + 44;
    d.x = MARGIN;
    d.fillColor(PDF_THEME.ink);
  }

  private signature(forName: string, name: string, title: string | null): void {
    const d = this.doc;
    this.ensureSpace(70);
    const w = 200;
    const x = MARGIN + this.contentWidth - w;
    const y = d.y + 10;
    d.font(F_BOLD)
      .fontSize(9)
      .fillColor(PDF_THEME.ink)
      .text(`For ${forName}`, x, y, { width: w, align: "right", lineBreak: false });
    d.moveTo(x + 40, y + 40)
      .lineTo(x + w, y + 40)
      .lineWidth(0.6)
      .strokeColor(PDF_THEME.rule)
      .stroke();
    d.font(F_REGULAR)
      .fontSize(8.5)
      .text(name, x, y + 43, { width: w, align: "right", lineBreak: false });
    if (title) d.fillColor(PDF_THEME.muted).text(title, x, y + 53, { width: w, align: "right", lineBreak: false });
    d.y = y + 66;
    d.x = MARGIN;
    d.fillColor(PDF_THEME.ink);
  }

  /** Stamps the footer on every page (page x of y, generated at IST); called exactly once before the document is ended. */
  stampFooters(): void {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      d.switchToPage(i);
      // the footer sits inside the bottom margin: lift the margin so the line wrapper never starts a new page while stamping it
      d.page.margins.bottom = 0;
      const y = this.pageHeight - MARGIN - 12;
      d.moveTo(MARGIN, y - 4)
        .lineTo(this.pageWidth - MARGIN, y - 4)
        .lineWidth(0.6)
        .strokeColor(PDF_THEME.gold)
        .stroke();
      d.font(F_REGULAR).fontSize(7.5).fillColor(PDF_THEME.muted);
      d.text(this.opts.footer, MARGIN, y, { width: this.contentWidth * 0.7, lineBreak: false });
      d.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + this.contentWidth * 0.7, y, {
        width: this.contentWidth * 0.3,
        align: "right",
        lineBreak: false,
      });
    }
  }
}
