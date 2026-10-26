/**
 * Branded A4 PDF generator (SPEC §14 "Branded A4 PDFs"): letterhead (company, legal name, address, GSTIN, RERA line, logo), gold rule,
 * navy title bar, two-column key/value blocks, tables with Indian number formatting right-aligned, "Page x of y", generated-at footer in IST,
 * optional diagonal watermark and the amount-in-words line.
 *
 * Two halves: `BrandedPdf` (this file) RECORDS the document on the request's thread — every value is formatted here (₹ with Indian
 * grouping, amount in words, IST dates) — and the worker pool (services/pdfPool.ts) RENDERS it with pdfkit in a worker thread
 * (services/pdfRender.ts), so pdfkit never runs on the event loop. Fonts: DejaVu Sans (regular/bold/oblique) embedded and subset into
 * every PDF, so amounts print with the rupee sign "₹".
 */
import type { Readable } from "node:stream";
import { amountInWords, formatINR, groupIndian, istParts, formatDateLabel } from "@kkt/domain";
import { renderPdfBuffer, renderPdfStream } from "./pdfPool.js";
import { PDF_THEME, resolvePdfFonts, type PdfOp, type PdfRenderTask, type RenderColumn } from "./pdfRender.js";

export { PDF_THEME };

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

/** Path of the embedded regular face (DejaVu Sans), or null when it cannot be found. */
export function findRupeeFont(): string | null {
  try {
    return resolvePdfFonts().regular;
  } catch {
    return null;
  }
}

/** Currency prefix used on every PDF (the embedded DejaVu Sans has the rupee glyph). */
export const PDF_CURRENCY_PREFIX = "₹";

/** Money for PDFs: "₹1,00,00,000" / "-₹1,000" (Indian grouping; paise shown only when non-zero). */
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

/**
 * A branded document. Build it with the content methods (kv, table, paragraph, amountInWords …) then `finish()` for the bytes or
 * `finishStream()` for a stream. The methods only record formatted layout operations; rendering happens in the PDF worker pool, where
 * page headers/watermarks are drawn on every page and footers (page x of y, generated at) are stamped once the page count is known.
 */
export class BrandedPdf {
  private readonly opts: PdfOptions;
  private readonly ops: PdfOp[] = [];

  constructor(opts: PdfOptions) {
    this.opts = opts;
  }

  /** Starts a new page when fewer than `needed` points remain. */
  ensureSpace(needed: number): this {
    this.ops.push({ op: "ensureSpace", needed });
    return this;
  }

  /** Adds vertical space. */
  spacer(h = 8): this {
    this.ops.push({ op: "spacer", h });
    return this;
  }

  /** Section heading (navy) with a thin gold underline. */
  heading(text: string): this {
    this.ops.push({ op: "heading", text });
    return this;
  }

  /** Body paragraph. */
  paragraph(text: string, opts: { size?: number; italic?: boolean; color?: string; align?: "left" | "right" | "center" | "justify" } = {}): this {
    this.ops.push({ op: "paragraph", text, size: opts.size ?? 9.5, italic: opts.italic === true, color: opts.color ?? PDF_THEME.ink, align: opts.align ?? "left" });
    return this;
  }

  /** Small muted note. */
  note(text: string): this {
    return this.paragraph(text, { size: 8, italic: true, color: PDF_THEME.muted });
  }

  /** Key/value blocks laid out two per row (label muted, value bold). */
  kv(blocks: readonly KvBlock[]): this {
    this.ops.push({ op: "kv", blocks: blocks.map((b) => ({ title: b.title ?? null, rows: b.rows.map(([k, v]) => [k, valueText(v)] as [string, string]) })) });
    return this;
  }

  /**
   * Table with a navy header, zebra rows, right-aligned Indian-formatted money and an optional bold totals row; breaks across pages
   * (header repeated). Cells are formatted here (money → "₹1,00,000", custom renderers) and only strings travel to the renderer.
   */
  table<T extends Record<string, unknown>>(columns: readonly PdfColumn<T>[], rows: readonly T[], opts: { totals?: Record<string, unknown> | null; emptyText?: string; fontSize?: number } = {}): this {
    const cellText = (col: PdfColumn<T>, row: T): string => {
      if (col.render) return col.render(row);
      const v = row[col.key];
      if (col.money) return typeof v === "number" ? pdfMoney(v) : v == null ? "" : String(v);
      return valueText(v as string | number | null | undefined);
    };
    const rendered: RenderColumn[] = columns.map((c) => ({ header: c.header, width: c.width ?? 1, align: c.align ?? (c.money ? "right" : "left") }));
    let totals: string[] | null = null;
    if (opts.totals) {
      const t = opts.totals;
      totals = columns.map((c, i) => {
        const v = t[c.key];
        if (i === 0 && v === undefined) return "Total";
        if (v === undefined || v === null) return "";
        if (c.money && typeof v === "number") return pdfMoney(v);
        return String(v);
      });
    }
    this.ops.push({
      op: "table",
      columns: rendered,
      rows: rows.map((row) => columns.map((c) => cellText(c, row))),
      totals,
      emptyText: opts.emptyText ?? "No rows for the selected filters",
      fontSize: opts.fontSize ?? 8.5,
    });
    return this;
  }

  /** Boxed "Amount in words: Rupees … Only". */
  amountInWords(paise: number, label = "Amount in words"): this {
    this.ops.push({ op: "boxedText", text: `${label}: ${amountInWords(paise)}` });
    return this;
  }

  /** Big highlighted amount box (receipts). */
  amountBox(label: string, paise: number): this {
    this.ops.push({ op: "amountBox", label, amount: pdfMoney(paise) });
    return this;
  }

  /** Signature block (right-aligned): "For <company>", space, name/title. */
  signature(forName: string, signatoryName: string | null | undefined, signatoryTitle: string | null | undefined): this {
    this.ops.push({ op: "signature", forName, name: signatoryName ?? "Authorised Signatory", title: signatoryTitle ?? null });
    return this;
  }

  /** The serialisable render task (letterhead strings, options and the recorded operations). */
  toTask(): PdfRenderTask {
    const o = this.opts;
    const lh = o.letterhead;
    const sub: string[] = [];
    if (lh.legalName && lh.legalName !== lh.name) sub.push(lh.legalName);
    if (lh.tagline) sub.push(lh.tagline);
    const lines: string[] = [];
    if (lh.addressLine) lines.push(lh.addressLine);
    const regs = [lh.gstin ? `GSTIN ${lh.gstin}` : null, lh.reraLine ?? null, lh.contactLine ?? null].filter((x): x is string => !!x);
    if (regs.length > 0) lines.push(regs.join("  ·  "));
    const logo = lh.logo && isPngOrJpeg(lh.logo) ? new Uint8Array(lh.logo) : null;
    return {
      options: {
        letterhead: { name: lh.name, subLine: sub.length > 0 ? sub.join(" · ") : null, lines, logo },
        title: o.title,
        reference: o.reference ?? null,
        watermark: o.watermark ?? null,
        landscape: o.landscape === true,
        metaTitle: o.metaTitle ?? o.title,
        author: o.author ?? lh.name,
        footer: `Generated ${pdfDateTimeIST(o.generatedAt ?? new Date())} · ${lh.name}`,
      },
      ops: this.ops.slice(),
    };
  }

  /** Renders the document in the worker pool and returns the PDF bytes (documents that are stored or re-sent, e.g. portal signed links). */
  finish(): Promise<Buffer> {
    return renderPdfBuffer(this.toTask());
  }

  /** Renders the document in the worker pool as a stream (reports are piped straight to the HTTP reply, never concatenated). */
  finishStream(): Promise<Readable> {
    return renderPdfStream(this.toTask());
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

/** Generic report PDF as a readable stream (what the report routes send); resolves once the worker has produced the first bytes. */
export function reportPdfStream<T extends Record<string, unknown>>(letterhead: PdfLetterhead, spec: ReportTableSpec<T>): Promise<Readable> {
  return buildReportPdf(letterhead, spec).finishStream();
}
