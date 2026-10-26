import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";

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

/** Streams rows as `text/csv` with RFC 4180 quoting and a `Content-Disposition: attachment` header. */
export function sendCsv<T extends Record<string, unknown>>(
  reply: FastifyReply,
  filename: string,
  columns: readonly CsvColumn<T>[],
  rows: Iterable<T>,
): FastifyReply {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  async function* lines(): AsyncGenerator<string> {
    yield `${columns.map((c) => csvField(c.header)).join(",")}\r\n`;
    for (const row of rows) yield `${columns.map((c) => csvField(c.value ? c.value(row) : row[c.key])).join(",")}\r\n`;
  }
  reply.header("Content-Type", "text/csv; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="${safeName}"`);
  reply.header("Cache-Control", "no-store");
  return reply.send(Readable.from(lines()));
}
