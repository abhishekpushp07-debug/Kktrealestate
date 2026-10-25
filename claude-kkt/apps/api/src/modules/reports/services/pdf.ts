/**
 * Branded A4 PDF generator (SPEC §14 "Branded A4 PDFs"): letterhead (company, legal name, address, GSTIN, RERA line, logo), gold rule,
 * navy title bar, two-column key/value blocks, tables with Indian number formatting right-aligned, "Page x of y", generated-at footer in IST,
 * optional diagonal watermark and the amount-in-words line. Fonts: Helvetica (built in). The ₹ glyph is missing in Helvetica, so amounts are
 * written "Rs. 1,00,000" unless a TrueType font is present under apps/api/assets/fonts (first *.ttf wins), in which case ₹ is used.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { amountInWords, formatINR, groupIndian, istParts, formatDateLabel } from "@kkt/domain";

/** Theme (SPEC §0: royal deep navy + gold). */
export const PDF_THEME = { navy: "#0B1F3A", gold: "#C9A227", ink: "#1F2937", muted: "#6B7280", rule: "#D1D5DB", zebra: "#F6F3EA", white: "#FFFFFF", danger: "#B00020" } as const;

/** Letterhead content printed at the top of every page. */
export interface PdfLetterhead {
  name: string;
  legalName?: string | null;
  tagline?: string | null;
  addressLine?: string | null;
  gstin?: string | null;
  /** e.g. "RERA BRERAP00123-1/23" (project-specific documents) */
  reraLine?: string | null;
  contactLine?: string | null;
  /** PNG or JPEG bytes (pdfkit cannot embed webp/svg); anything else is ignored. */
  logo?: Buffer | null;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
}

/** Options of a document. */
export interface PdfOptions {
  letterhead: PdfLetterhead;
  title: string;
  /** Printed right-aligned in the title bar (document number, date range …). */
  reference?: string | null;
  /** Diagonal watermark text on every page, e.g. "CANCELLED". */
  watermark?: string | null;
  landscape?: boolean;
  generatedAt?: Date;
  /** PDF metadata title (defaults to `title`). */
  metaTitle?: string;
  author?: string;
}

/** One column of a table. */
export interface PdfColumn<T = Record<string, unknown>> {
  key: string;
  header: string;
  /** Relative width weight (default 1). */
  width?: number;
  align?: "left" | "right" | "center";
  /** Integer paise → Indian-grouped rupees, right-aligned. */
  money?: boolean;
  /** Custom renderer (wins over key/money). */
  render?: (row: T) => string;
}

/** One key/value block. */
export interface KvBlock {
  title?: string | null;
  rows: readonly (readonly [string, string | number | null | undefined])[];
}

const FONT_DIR_CANDIDATES = [join(dirname(fileURLToPath(import.meta.url)), "../../../../assets/fonts"), join(process.cwd(), "assets/fonts"), join(process.cwd(), "apps/api/assets/fonts")];

/** First TrueType font found under apps/api/assets/fonts, or null (Helvetica fallback). */
export function findRupeeFont(): string | null {
  for (const dir of FONT_DIR_CANDIDATES) {
    try {
      if (!existsSync(dir)) continue;
      const ttf = readdirSync(dir).find((f) => /\.ttf$/i.test(f));
      if (ttf) return join(dir, ttf);
    } catch {
      /* unreadable directory: fall through */
    }
  }
  return null;
}

const RUPEE_FONT = findRupeeFont();

/** Currency prefix used on every PDF ("₹" with an embedded TTF, else "Rs. "). */
export const PDF_CURRENCY_PREFIX = RUPEE_FONT ? "₹" : "Rs. ";

/** Money for PDFs: "Rs. 1,00,00,000" / "-Rs. 1,000" (paise shown only when non-zero). */
export function pdfMoney(paise: number): string {
  const negative = paise < 0;
  return `${negative ? "-" : ""}${PDF_CURRENCY_PREFIX}${formatINR(Math.abs(paise), { symbol: false })}`;
}

/** Date YYYY-MM-DD → "24 Oct 2026" (anything else is passed through). */
export function pdfDate(value: string | null | undefined): string {
  if (!value) return "—";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDateLabel(value) : value;
}

/** Instant → "24 Oct 2026, 10:30 IST". */
export function pdfDateTimeIST(instant: Date | string): string {
  const p = istParts(instant);
  return `${formatDateLabel(p.date)}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} IST`;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;

type Doc = InstanceType<typeof PDFDocument>;

/**
 * A branded document. Build it with the content methods (kv, table, paragraph, amountInWords …) then `finish()` for the bytes.
 * Page headers/watermarks are drawn on every page; footers (page x of y, generated at) are stamped once the page count is known.
 */
export class BrandedPdf {
  readonly doc: Doc;
  private readonly opts: PdfOptions;
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly bodyTop: number;
  private readonly bodyBottom: number;
  private readonly fontRegular: string;
  private readonly fontBold: string;
  private readonly fontItalic: string;

  constructor(opts: PdfOptions) {
    this.opts = opts;
    const landscape = opts.landscape === true;
    this.pageWidth = landscape ? A4.height : A4.width;
    this.pageHeight = landscape ? A4.width : A4.height;
    this.doc = new PDFDocument({
      size: "A4",
      layout: landscape ? "landscape" : "portrait",
      margins: { top: MARGIN, bottom: MARGIN + 22, left: MARGIN, right: MARGIN },
      bufferPages: true,
      autoFirstPage: false,
      info: { Title: opts.metaTitle ?? opts.title, Author: opts.author ?? opts.letterhead.name, Creator: "KKT", Producer: "KKT (pdfkit)" },
    });
    if (RUPEE_FONT) {
      this.doc.registerFont("KKT-Regular", RUPEE_FONT);
      this.fontRegular = "KKT-Regular";
      this.fontBold = "KKT-Regular";
      this.fontItalic = "KKT-Regular";
    } else {
      this.fontRegular = "Helvetica";
      this.fontBold = "Helvetica-Bold";
      this.fontItalic = "Helvetica-Oblique";
    }
    this.bodyBottom = this.pageHeight - MARGIN - 22;
    this.bodyTop = MARGIN + 92;
    this.doc.on("pageAdded", () => this.drawPageChrome());
    this.doc.addPage();
  }

  /** Usable width between the margins. */
  get contentWidth(): number {
    return this.pageWidth - 2 * MARGIN;
  }

  /** Current vertical position. */
  get y(): number {
    return this.doc.y;
  }

  private drawPageChrome(): void {
    const d = this.doc;
    const lh = this.opts.letterhead;
    const left = MARGIN;
    let textLeft = left;
    const logo = lh.logo;
    if (logo && isPngOrJpeg(logo)) {
      try {
        d.image(logo, left, MARGIN, { fit: [64, 44] });
        textLeft = left + 76;
      } catch {
        textLeft = left;
      }
    }
    const textWidth = this.pageWidth - MARGIN - textLeft;
    d.font(this.fontBold).fontSize(15).fillColor(PDF_THEME.navy).text(lh.name, textLeft, MARGIN, { width: textWidth, lineBreak: false });
    let y = MARGIN + 18;
    const sub: string[] = [];
    if (lh.legalName && lh.legalName !== lh.name) sub.push(lh.legalName);
    if (lh.tagline) sub.push(lh.tagline);
    if (sub.length > 0) {
      d.font(this.fontItalic).fontSize(8.5).fillColor(PDF_THEME.muted).text(sub.join(" · "), textLeft, y, { width: textWidth, lineBreak: false });
      y += 11;
    }
    const lines: string[] = [];
    if (lh.addressLine) lines.push(lh.addressLine);
    const regs = [lh.gstin ? `GSTIN ${lh.gstin}` : null, lh.reraLine ?? null, lh.contactLine ?? null].filter((x): x is string => !!x);
    if (regs.length > 0) lines.push(regs.join("  ·  "));
    d.font(this.fontRegular).fontSize(8).fillColor(PDF_THEME.ink);
    for (const line of lines) {
      d.text(line, textLeft, y, { width: textWidth, lineBreak: false });
      y += 10;
    }
    // gold rule
    const ruleY = MARGIN + 58;
    d.moveTo(left, ruleY).lineTo(this.pageWidth - MARGIN, ruleY).lineWidth(1.6).strokeColor(PDF_THEME.gold).stroke();
    // title bar
    const barY = ruleY + 8;
    d.rect(left, barY, this.contentWidth, 22).fill(PDF_THEME.navy);
    d.font(this.fontBold).fontSize(11).fillColor(PDF_THEME.white).text(this.opts.title.toUpperCase(), left + 8, barY + 6, { width: this.contentWidth * 0.6, lineBreak: false });
    if (this.opts.reference) {
      d.font(this.fontRegular).fontSize(9).fillColor(PDF_THEME.white).text(this.opts.reference, left + this.contentWidth * 0.5 - 8, barY + 7, { width: this.contentWidth * 0.5, align: "right", lineBreak: false });
    }
    if (this.opts.watermark) this.drawWatermark(this.opts.watermark);
    d.fillColor(PDF_THEME.ink).font(this.fontRegular).fontSize(9);
    d.x = left;
    d.y = this.bodyTop;
  }

  private drawWatermark(text: string): void {
    const d = this.doc;
    d.save();
    const cx = this.pageWidth / 2;
    const cy = this.pageHeight / 2;
    d.rotate(-35, { origin: [cx, cy] });
    d.font(this.fontBold).fontSize(84).fillColor(PDF_THEME.danger).fillOpacity(0.12);
    const w = d.widthOfString(text);
    d.text(text, cx - w / 2, cy - 42, { lineBreak: false });
    d.restore();
    d.fillOpacity(1);
  }

  /** Starts a new page when fewer than `needed` points remain. */
  ensureSpace(needed: number): void {
    if (this.doc.y + needed > this.bodyBottom) this.doc.addPage();
  }

  /** Adds vertical space. */
  spacer(h = 8): this {
    this.doc.y += h;
    return this;
  }

  /** Section heading (navy, small caps feel) with a thin gold underline. */
  heading(text: string): this {
    this.ensureSpace(26);
    const d = this.doc;
    d.font(this.fontBold).fontSize(10.5).fillColor(PDF_THEME.navy).text(text, MARGIN, d.y, { width: this.contentWidth });
    const y = d.y + 2;
    d.moveTo(MARGIN, y).lineTo(MARGIN + 60, y).lineWidth(1).strokeColor(PDF_THEME.gold).stroke();
    d.y = y + 7;
    d.fillColor(PDF_THEME.ink).font(this.fontRegular).fontSize(9);
    return this;
  }

  /** Body paragraph. */
  paragraph(text: string, opts: { size?: number; italic?: boolean; color?: string; align?: "left" | "right" | "center" | "justify" } = {}): this {
    const d = this.doc;
    d.font(opts.italic ? this.fontItalic : this.fontRegular).fontSize(opts.size ?? 9.5).fillColor(opts.color ?? PDF_THEME.ink);
    const h = d.heightOfString(text, { width: this.contentWidth, align: opts.align ?? "left" });
    this.ensureSpace(Math.min(h, 200));
    d.text(text, MARGIN, d.y, { width: this.contentWidth, align: opts.align ?? "left" });
    d.y += 6;
    return this;
  }

  /** Small muted note. */
  note(text: string): this {
    return this.paragraph(text, { size: 8, italic: true, color: PDF_THEME.muted });
  }

  /** Key/value blocks laid out two per row (label muted, value bold). */
  kv(blocks: readonly KvBlock[]): this {
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
    return this;
  }

  private kvHeight(block: KvBlock, width: number): number {
    const d = this.doc;
    let h = block.title ? 16 : 0;
    const valueWidth = width * 0.6;
    for (const [, v] of block.rows) {
      d.font(this.fontBold).fontSize(9);
      h += Math.max(12, d.heightOfString(valueText(v), { width: valueWidth }) + 3);
    }
    return h + 4;
  }

  private drawKvBlock(block: KvBlock, x: number, top: number, width: number): void {
    const d = this.doc;
    let y = top;
    if (block.title) {
      d.font(this.fontBold).fontSize(8).fillColor(PDF_THEME.gold).text(block.title.toUpperCase(), x, y, { width, lineBreak: false });
      y += 14;
      d.moveTo(x, y - 2).lineTo(x + width, y - 2).lineWidth(0.5).strokeColor(PDF_THEME.rule).stroke();
      y += 2;
    }
    const labelWidth = width * 0.4 - 4;
    const valueWidth = width * 0.6;
    for (const [label, v] of block.rows) {
      d.font(this.fontRegular).fontSize(8.5).fillColor(PDF_THEME.muted).text(label, x, y, { width: labelWidth, lineBreak: false });
      d.font(this.fontBold).fontSize(9).fillColor(PDF_THEME.ink);
      const text = valueText(v);
      const h = d.heightOfString(text, { width: valueWidth });
      d.text(text, x + width * 0.4, y, { width: valueWidth });
      y += Math.max(12, h + 3);
    }
    d.fillColor(PDF_THEME.ink);
  }

  /**
   * Table with a navy header, zebra rows, right-aligned Indian-formatted money and an optional bold totals row; breaks across pages
   * (header repeated). `rows` beyond what fits are paged automatically.
   */
  table<T extends Record<string, unknown>>(columns: readonly PdfColumn<T>[], rows: readonly T[], opts: { totals?: Record<string, unknown> | null; emptyText?: string; fontSize?: number } = {}): this {
    const d = this.doc;
    const fontSize = opts.fontSize ?? 8.5;
    const weights = columns.map((c) => c.width ?? 1);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const widths = weights.map((w) => (this.contentWidth * w) / totalWeight);
    const pad = 4;
    const cellText = (col: PdfColumn<T>, row: T): string => {
      if (col.render) return col.render(row);
      const v = row[col.key];
      if (col.money) return typeof v === "number" ? pdfMoney(v) : v == null ? "" : String(v);
      return valueText(v as string | number | null | undefined);
    };
    const align = (col: PdfColumn<T>): "left" | "right" | "center" => col.align ?? (col.money ? "right" : "left");

    const drawHeader = (): void => {
      const y = d.y;
      d.rect(MARGIN, y, this.contentWidth, 16).fill(PDF_THEME.navy);
      d.font(this.fontBold).fontSize(fontSize).fillColor(PDF_THEME.white);
      let x = MARGIN;
      columns.forEach((c, i) => {
        const w = widths[i] ?? 0;
        d.text(c.header, x + pad, y + 4.5, { width: w - 2 * pad, align: align(c), lineBreak: false, ellipsis: true });
        x += w;
      });
      d.y = y + 16;
      d.fillColor(PDF_THEME.ink).font(this.fontRegular);
    };

    const rowHeight = (texts: string[]): number => {
      d.font(this.fontRegular).fontSize(fontSize);
      let h = 0;
      texts.forEach((t, i) => {
        h = Math.max(h, d.heightOfString(t, { width: (widths[i] ?? 0) - 2 * pad }));
      });
      return Math.max(14, h + 5);
    };

    const drawRow = (texts: string[], opt: { zebra: boolean; bold?: boolean; top?: boolean }): void => {
      const h = rowHeight(texts);
      if (d.y + h > this.bodyBottom) {
        d.addPage();
        drawHeader();
      }
      const y = d.y;
      if (opt.zebra) d.rect(MARGIN, y, this.contentWidth, h).fill(PDF_THEME.zebra);
      if (opt.top) d.moveTo(MARGIN, y).lineTo(MARGIN + this.contentWidth, y).lineWidth(1).strokeColor(PDF_THEME.gold).stroke();
      d.font(opt.bold ? this.fontBold : this.fontRegular).fontSize(fontSize).fillColor(PDF_THEME.ink);
      let x = MARGIN;
      texts.forEach((t, i) => {
        const w = widths[i] ?? 0;
        const col = columns[i]!;
        d.text(t, x + pad, y + 3, { width: w - 2 * pad, align: align(col) });
        x += w;
      });
      d.moveTo(MARGIN, y + h).lineTo(MARGIN + this.contentWidth, y + h).lineWidth(0.3).strokeColor(PDF_THEME.rule).stroke();
      d.y = y + h;
      d.x = MARGIN;
    };

    this.ensureSpace(40);
    drawHeader();
    if (rows.length === 0) {
      drawRow([opts.emptyText ?? "No rows for the selected filters", ...columns.slice(1).map(() => "")], { zebra: false });
    }
    rows.forEach((row, idx) => drawRow(columns.map((c) => cellText(c, row)), { zebra: idx % 2 === 1 }));
    if (opts.totals) {
      const totals = opts.totals;
      const texts = columns.map((c, i) => {
        const v = totals[c.key];
        if (i === 0 && v === undefined) return "Total";
        if (v === undefined || v === null) return "";
        if (c.money && typeof v === "number") return pdfMoney(v);
        return String(v);
      });
      drawRow(texts, { zebra: false, bold: true, top: true });
    }
    d.y += 8;
    return this;
  }

  /** Boxed "Amount in words: Rupees … Only". */
  amountInWords(paise: number, label = "Amount in words"): this {
    const d = this.doc;
    const words = amountInWords(paise);
    d.font(this.fontItalic).fontSize(9.5);
    const text = `${label}: ${words}`;
    const h = d.heightOfString(text, { width: this.contentWidth - 16 }) + 12;
    this.ensureSpace(h + 6);
    const y = d.y;
    d.rect(MARGIN, y, this.contentWidth, h).lineWidth(0.6).strokeColor(PDF_THEME.gold).stroke();
    d.fillColor(PDF_THEME.ink).text(text, MARGIN + 8, y + 6, { width: this.contentWidth - 16 });
    d.y = y + h + 8;
    d.x = MARGIN;
    return this;
  }

  /** Big highlighted amount box (receipts). */
  amountBox(label: string, paise: number): this {
    const d = this.doc;
    this.ensureSpace(44);
    const y = d.y;
    d.rect(MARGIN, y, this.contentWidth, 36).fill(PDF_THEME.zebra);
    d.font(this.fontRegular).fontSize(9).fillColor(PDF_THEME.muted).text(label, MARGIN + 10, y + 12, { width: this.contentWidth / 2, lineBreak: false });
    d.font(this.fontBold).fontSize(16).fillColor(PDF_THEME.navy).text(pdfMoney(paise), MARGIN + this.contentWidth / 2 - 10, y + 9, { width: this.contentWidth / 2, align: "right", lineBreak: false });
    d.y = y + 44;
    d.x = MARGIN;
    d.fillColor(PDF_THEME.ink);
    return this;
  }

  /** Signature block (right-aligned): "For <company>", space, name/title. */
  signature(forName: string, signatoryName: string | null | undefined, signatoryTitle: string | null | undefined): this {
    const d = this.doc;
    this.ensureSpace(70);
    const w = 200;
    const x = MARGIN + this.contentWidth - w;
    const y = d.y + 10;
    d.font(this.fontBold).fontSize(9).fillColor(PDF_THEME.ink).text(`For ${forName}`, x, y, { width: w, align: "right", lineBreak: false });
    d.moveTo(x + 40, y + 40).lineTo(x + w, y + 40).lineWidth(0.6).strokeColor(PDF_THEME.rule).stroke();
    d.font(this.fontRegular).fontSize(8.5).text(signatoryName ?? "Authorised Signatory", x, y + 43, { width: w, align: "right", lineBreak: false });
    if (signatoryTitle) d.fillColor(PDF_THEME.muted).text(signatoryTitle, x, y + 53, { width: w, align: "right", lineBreak: false });
    d.y = y + 66;
    d.x = MARGIN;
    d.fillColor(PDF_THEME.ink);
    return this;
  }

  /** Stamps the footer on every page (page x of y, generated at IST); called exactly once before the document is ended. */
  private stampFooters(): void {
    const d = this.doc;
    const range = d.bufferedPageRange();
    const generated = `Generated ${pdfDateTimeIST(this.opts.generatedAt ?? new Date())} · ${this.opts.letterhead.name}`;
    for (let i = range.start; i < range.start + range.count; i += 1) {
      d.switchToPage(i);
      // the footer sits inside the bottom margin: lift the margin so the line wrapper never starts a new page while stamping it
      d.page.margins.bottom = 0;
      const y = this.pageHeight - MARGIN - 12;
      d.moveTo(MARGIN, y - 4).lineTo(this.pageWidth - MARGIN, y - 4).lineWidth(0.6).strokeColor(PDF_THEME.gold).stroke();
      d.font(this.fontRegular).fontSize(7.5).fillColor(PDF_THEME.muted);
      d.text(generated, MARGIN, y, { width: this.contentWidth * 0.7, lineBreak: false });
      d.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + this.contentWidth * 0.7, y, { width: this.contentWidth * 0.3, align: "right", lineBreak: false });
    }
  }

  /** Finishes the document and returns the PDF bytes (documents that are stored or re-sent, e.g. portal signed links). */
  finish(): Promise<Buffer> {
    const d = this.doc;
    this.stampFooters();
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      d.on("data", (c: Buffer) => chunks.push(c));
      d.on("end", () => resolve(Buffer.concat(chunks)));
      d.on("error", reject);
      d.end();
    });
  }

  /** Finishes the document and returns it as a readable stream (reports are piped straight to the HTTP reply, never concatenated). */
  finishStream(): Readable {
    this.stampFooters();
    this.doc.end();
    return this.doc as unknown as Readable;
  }
}

function valueText(v: string | number | null | undefined | unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? `${v < 0 ? "-" : ""}${groupIndian(String(Math.abs(v)))}` : String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** True for PNG/JPEG bytes (the only raster formats pdfkit embeds). */
export function isPngOrJpeg(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  return buf[0] === 0xff && buf[1] === 0xd8;
}

/** Column spec for a generic report table. */
export interface ReportTableSpec<T extends Record<string, unknown>> {
  title: string;
  subtitle?: string | null;
  filters?: readonly (readonly [string, string])[];
  columns: readonly PdfColumn<T>[];
  rows: readonly T[];
  totals?: Record<string, unknown> | null;
  /** Extra sections printed after the main table. */
  sections?: readonly { heading: string; columns: readonly PdfColumn<Record<string, unknown>>[]; rows: readonly Record<string, unknown>[]; totals?: Record<string, unknown> | null }[];
  landscape?: boolean;
}

/**
 * Upper bound of table rows rendered into one report PDF (main table and each extra section). Larger result sets are cut here with a
 * visible "first N of M rows" note so a wide-open filter can never turn into a thousand-page document; CSV (`format=csv`) carries the full set.
 */
export const PDF_MAX_ROWS = 2000;

/** Note printed when a table was cut at PDF_MAX_ROWS. */
export function pdfTruncationNote(shown: number, total: number): string {
  return `Showing the first ${groupIndian(String(shown))} of ${groupIndian(String(total))} rows. Narrow the filters or export CSV for the complete set.`;
}

/** Builds (without finishing) the generic report document: title bar, filter block, capped table with totals footer, optional extra sections. */
export function buildReportPdf<T extends Record<string, unknown>>(letterhead: PdfLetterhead, spec: ReportTableSpec<T>): BrandedPdf {
  const pdf = new BrandedPdf({ letterhead, title: spec.title, reference: spec.subtitle ?? null, landscape: spec.landscape ?? spec.columns.length > 7 });
  if (spec.filters && spec.filters.length > 0) {
    pdf.kv([{ title: "Filters", rows: spec.filters.map(([k, v]) => [k, v] as const) }]);
  }
  const rows = spec.rows.length > PDF_MAX_ROWS ? spec.rows.slice(0, PDF_MAX_ROWS) : spec.rows;
  pdf.table(spec.columns, rows, { totals: spec.totals ?? null });
  if (rows.length < spec.rows.length) pdf.note(pdfTruncationNote(rows.length, spec.rows.length));
  for (const s of spec.sections ?? []) {
    pdf.heading(s.heading);
    const sectionRows = s.rows.length > PDF_MAX_ROWS ? s.rows.slice(0, PDF_MAX_ROWS) : s.rows;
    pdf.table(s.columns, sectionRows, { totals: s.totals ?? null });
    if (sectionRows.length < s.rows.length) pdf.note(pdfTruncationNote(sectionRows.length, s.rows.length));
  }
  const totalsNote = spec.rows.length > PDF_MAX_ROWS ? " Totals cover every row, not only those printed." : "";
  pdf.note(`${groupIndian(String(spec.rows.length))} row${spec.rows.length === 1 ? "" : "s"}.${totalsNote} Amounts in Indian Rupees; computer-generated report.`);
  return pdf;
}

/** Generic report PDF as bytes (see buildReportPdf). */
export async function reportPdf<T extends Record<string, unknown>>(letterhead: PdfLetterhead, spec: ReportTableSpec<T>): Promise<Buffer> {
  return buildReportPdf(letterhead, spec).finish();
}

/** Generic report PDF as a readable stream (what the report routes send). */
export function reportPdfStream<T extends Record<string, unknown>>(letterhead: PdfLetterhead, spec: ReportTableSpec<T>): Readable {
  return buildReportPdf(letterhead, spec).finishStream();
}
