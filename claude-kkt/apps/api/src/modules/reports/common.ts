/**
 * Shared helpers of the reports module: export-format resolution (`format=csv|pdf` ≡ `export=CSV|PDF`), project-scope SQL, period keys,
 * the company letterhead (settings/letterhead jsonb + logo through the documents module) and the csv/pdf reply helpers.
 */
import type { Readable } from "node:stream";
import { eq, sql, type SQL } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { ListQuery, ReportFormat } from "@kkt/contracts";
import { companies, type Executor } from "@kkt/db";
import { addDays, dateParts, dayOfWeek, formatDateLabel, makeDateString, todayIST } from "@kkt/domain";
import { sendCsv, type CsvColumn } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging } from "../../lib/list.js";
import type { StaffContext } from "../../lib/scope.js";
import { streamDocument } from "../documents/service.js";
import { isPngOrJpeg, type PdfLetterhead } from "./services/pdf.js";

/** Query fields every report accepts for its export variants. */
export interface ExportQuery {
  export?: "CSV" | "PDF" | undefined;
  format?: ReportFormat | undefined;
}

/** Resolves the requested output: `format=csv|pdf` wins, else `export=CSV|PDF`, else JSON. */
export function wantedFormat(q: ExportQuery): ReportFormat | "json" {
  if (q.format) return q.format;
  if (q.export === "CSV") return "csv";
  if (q.export === "PDF") return "pdf";
  return "json";
}

/** Reports whose `from`/`to` are both optional still reject an inverted range (400, like DateRangeSchema does for required ranges). */
export function assertOptionalRange(q: { from?: string | undefined; to?: string | undefined }): void {
  if (q.from && q.to && q.from > q.to) throw ApiError.badRequest("from must be on or before to", { issues: [{ path: "to", message: "from must be on or before to" }] });
}

/** Today's business date (IST). */
export function today(): string {
  return todayIST();
}

/** Scope condition as raw SQL for a project-id expression (mirrors lib/scope scopeFilter). */
export function scopeSql(user: Pick<StaffContext, "allProjects" | "projectIds">, projectIdExpr: SQL): SQL {
  if (user.allProjects) return sql`true`;
  if (user.projectIds.length === 0) return sql`false`;
  return sql`${projectIdExpr} in (${sql.join(user.projectIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
}

/** "YYYY-MM" of a date. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** First day of the month of a date. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Monday of the ISO week that contains the date. */
export function weekStart(date: string): string {
  const dow = dayOfWeek(date); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** The last `n` month keys ending with the month of `date` (oldest first). */
export function lastMonths(date: string, n: number): string[] {
  const { year, month } = dateParts(date);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = month - i;
    const y = year + Math.floor((m - 1) / 12);
    const mm = ((((m - 1) % 12) + 12) % 12) + 1;
    out.push(makeDateString(y, mm, 1).slice(0, 7));
  }
  return out;
}

/** Human label of a month key: "Oct 2026". */
export function monthLabel(key: string): string {
  return formatDateLabel(`${key}-01`).slice(2).trim();
}

/** The company letterhead for PDFs (name, legal name, address, GSTIN, contact line from settings/letterhead jsonb; logo via the documents module). */
export async function letterheadFor(db: Executor, companyId: string, extra: { reraLine?: string | null } = {}): Promise<PdfLetterhead> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) return { name: "KKT" };
  const lh = c.letterhead;
  const a = c.address;
  const addressLine = a ? [a.line1, a.line2, a.locality, a.city, a.state, a.pincode].filter((p) => p && String(p).trim() !== "").join(", ") : null;
  const contact = [lh.phone ?? c.phone, lh.email ?? c.email, lh.website].filter((x): x is string => !!x).join(" · ");
  let logo: Buffer | null = null;
  if (c.logoDocumentId) {
    try {
      const s = await streamDocument(db, c.logoDocumentId, "original");
      if (s && (s.mime === "image/png" || s.mime === "image/jpeg")) {
        const chunks: Buffer[] = [];
        for await (const chunk of s.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
        const buf = Buffer.concat(chunks);
        if (isPngOrJpeg(buf)) logo = buf;
      }
    } catch {
      logo = null; // a missing or unreadable logo never blocks a document
    }
  }
  return { name: c.name, legalName: c.legalName, tagline: lh.tagline ?? null, addressLine, gstin: c.gstin, reraLine: extra.reraLine ?? null, contactLine: contact || null, logo, signatoryName: lh.signatory_name ?? null, signatoryTitle: lh.signatory_title ?? null };
}

/** Sends a PDF (bytes, or a stream piped straight to the client) as an attachment. */
export function sendPdf(reply: FastifyReply, filename: string, body: Buffer | Readable): FastifyReply {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  reply.header("Content-Type", "application/pdf");
  reply.header("Content-Disposition", `attachment; filename="${safeName}"`);
  if (Buffer.isBuffer(body)) reply.header("Content-Length", String(body.length));
  reply.header("Cache-Control", "no-store");
  return reply.send(body);
}

/**
 * Paging for a paged report: normal paging for JSON, every row (capped at the CSV export limit) for csv/pdf exports. `q` must be the
 * request's own query object (`req.query`): the derived copy is linked back to it (listPaging `origin`), so the CSV response carries the
 * X-Export-Total / X-Export-Rows / X-Export-Truncated headers and the async export job (POST /exports) can page it with X-Export-Cursor.
 */
export function reportPaging(q: Omit<ListQuery, "format"> & ExportQuery): ReturnType<typeof listPaging> {
  const { format: _f, export: _e, ...rest } = q;
  return listPaging({ ...rest, ...(wantedFormat(q) === "json" ? {} : { format: "csv" as const }) }, q);
}

/** CSV columns from a key list (header = key). */
export function csvColumns<T extends Record<string, unknown>>(keys: readonly string[]): CsvColumn<T>[] {
  return keys.map((k) => ({ key: k, header: k }));
}

/** Streams rows as CSV (keys become headers). */
export function sendRowsCsv(reply: FastifyReply, filename: string, keys: readonly string[], rows: readonly Record<string, unknown>[]): FastifyReply {
  return sendCsv(reply, filename, csvColumns(keys), rows);
}

/** Groups rows by key into a Map of arrays. */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

/** Sums a numeric field. */
export function sumBy<T>(rows: readonly T[], f: (row: T) => number): number {
  let s = 0;
  for (const r of rows) s += f(r);
  return s;
}

/** Percent with two decimals, 0 when the base is 0. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

/** Numeric cast for sums coming back from raw SQL (bigint → string). */
export function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

/** Date-range filter labels for the PDF filter block. */
export function rangeFilters(q: { from?: string; to?: string; project_id?: string | undefined; block_id?: string | undefined }, names: { project?: string | null; block?: string | null } = {}): (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  if (q.from && q.to) out.push(["Period", `${formatDateLabel(q.from)} – ${formatDateLabel(q.to)}`]);
  if (q.project_id) out.push(["Project", names.project ?? q.project_id]);
  if (q.block_id) out.push(["Block", names.block ?? q.block_id]);
  return out;
}
