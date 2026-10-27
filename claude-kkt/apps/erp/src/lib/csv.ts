/**
 * Client-side CSV for data the server hands out exactly once (e.g. bulk portal credentials). Same rules as the API's lib/csv.ts:
 * RFC 4180 quoting, CRLF rows, a UTF-8 BOM for Excel, and formula neutralisation (a cell starting with = + - @ TAB or CR gets a
 * leading apostrophe unless it is a plain number).
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
