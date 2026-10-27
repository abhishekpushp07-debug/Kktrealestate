import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { actorFromRequest, writeAudit } from "./audit.js";
import { EXPORT_CURSOR_HEADER } from "./list.js";

/** Parses RFC 4180 CSV text (quoted fields, doubled quotes, embedded newlines, CRLF) into rows of strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Parses CSV text with a header line into objects keyed by trimmed header names; `line` is the 1-based source line. */
export function parseCsvObjects(text: string): {
  headers: string[];
  rows: { line: number; values: Record<string, string> }[];
} {
  const all = parseCsv(text);
  const headers = (all[0] ?? []).map((h) => h.trim());
  const rows = all.slice(1).map((r, idx) => {
    const values: Record<string, string> = {};
    headers.forEach((h, c) => {
      if (h) values[h] = (r[c] ?? "").trim();
    });
    return { line: idx + 2, values };
  });
  return { headers, rows };
}

/** Characters that make a spreadsheet (Excel, LibreOffice, Google Sheets) treat a cell as a formula or a DDE command. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
/** A plain number ("-1250", "+91", "-0.5", "1e3" excluded): safe to keep as a number even though it starts with - or +. */
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Neutralises spreadsheet formula injection (OWASP "CSV injection"): a text cell starting with = + - @ TAB or CR gets a leading single
 * quote so the spreadsheet shows it as text instead of evaluating it (`=HYPERLINK(...)` from a website enquiry name, `@SUM(...)`, DDE).
 * JavaScript numbers and plain numeric strings ("-1250.50") are left alone so amounts stay numeric.
 */
export function neutraliseFormula(value: string): string {
  if (!FORMULA_TRIGGER.test(value) || PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}

/** Quotes one CSV field per RFC 4180 (quotes when it contains a comma, quote, CR or LF); text cells are formula-neutralised first. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  const raw =
    value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  const s = neutraliseFormula(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Column definition for CSV export. */
export interface CsvColumn<T> {
  key: string;
  header: string;
  value?: (row: T) => unknown;
}

/** Query keys of a list request that are paging/format mechanics rather than filters (left out of the export audit row). */
const NON_FILTER_KEYS = new Set(["format", "export", "page", "page_size", "limit", "cursor", "exact"]);

/** The entity an export is about: the first static segment of the route after /api/v1 (e.g. `customers`, `reports`). */
function exportEntity(url: string): string {
  const seg = url
    .replace(/^\/api\/v1\//, "")
    .split("/")
    .find((x) => x && !x.startsWith(":"));
  return (seg ?? "export").slice(0, 60);
}

/**
 * Writes the `export.csv` audit row of a CSV export (audit D: bulk PII reads left no trail): actor, the list route, its filters, the row
 * count, and whether it is a page of an asynchronous export (X-Export-Cursor). The continuation pages of a keyset export are not
 * recorded again (the first page and POST /exports are). Unauthenticated requests write nothing (there is no tenant).
 */
export async function auditCsvExport(req: FastifyRequest, filename: string, rowCount: number): Promise<void> {
  const companyId = req.user?.companyId ?? req.customer?.companyId;
  if (!companyId) return;
  const cursor = req.headers[EXPORT_CURSOR_HEADER];
  if (typeof cursor === "string" && cursor !== "start") return;
  const url = req.routeOptions.url ?? req.url.split("?")[0] ?? "";
  const query = (req.query ?? {}) as Record<string, unknown>;
  const filters: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) if (!NON_FILTER_KEYS.has(k) && v !== undefined) filters[k] = v;
  const params = (req.params ?? {}) as Record<string, unknown>;
  const db = (req.server as FastifyInstance).db;
  await writeAudit(db, {
    companyId,
    actor: actorFromRequest(req),
    action: "export.csv",
    entityType: exportEntity(url),
    entityId: null,
    after: {
      route: url,
      file_name: filename,
      filters,
      ...(Object.keys(params).length > 0 ? { params } : {}),
      row_count: rowCount,
      async_export: typeof cursor === "string",
    },
    ip: req.clientIp ?? null,
    requestId: req.id,
  });
}

/**
 * Streams rows as `text/csv` with RFC 4180 quoting and a `Content-Disposition: attachment` header. Every export is audited first
 * (auditCsvExport): the audit row is committed before the first byte of data is produced, so no CSV leaves the API without its trail
 * (when the audit write fails the stream errors before any row).
 */
export function sendCsv<T extends Record<string, unknown>>(
  reply: FastifyReply,
  filename: string,
  columns: readonly CsvColumn<T>[],
  rows: Iterable<T>,
): FastifyReply {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const list = Array.isArray(rows) ? (rows as readonly T[]) : [...rows];
  const req = reply.request;
  async function* lines(): AsyncGenerator<string> {
    await auditCsvExport(req, safeName, list.length);
    yield `${columns.map((c) => csvField(c.header)).join(",")}\r\n`;
    for (const row of list) yield `${columns.map((c) => csvField(c.value ? c.value(row) : row[c.key])).join(",")}\r\n`;
  }
  reply.header("Content-Type", "text/csv; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="${safeName}"`);
  reply.header("Cache-Control", "no-store");
  return reply.send(Readable.from(lines()));
}
