/** Default numbering format per API-CONVENTIONS: `{prefix}{fy}/{seq:4}`. */
export const DEFAULT_NUMBER_FORMAT = "{prefix}{fy}/{seq:4}";

/** Financial-year code for a date: Apr 2025–Mar 2026 → "2526" (start month configurable). */
export function financialYearCode(date: Date, fyStartMonth: number): string {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const startYear = month >= fyStartMonth ? year : year - 1;
  const two = (value: number) => String(value % 100).padStart(2, "0");
  return `${two(startYear)}${two(startYear + 1)}`;
}

/** Renders a number from the format tokens `{prefix}`, `{fy}`, `{seq}` / `{seq:N}`. */
export function renderNumber(prefix: string, format: string | null | undefined, fy: string, seq: number): string {
  const template = format && format.trim() ? format : DEFAULT_NUMBER_FORMAT;
  return template
    .replace(/\{prefix\}/g, prefix)
    .replace(/\{fy\}/g, fy)
    .replace(/\{seq(?::(\d+))?\}/g, (_match, width: string | undefined) =>
      String(seq).padStart(width ? Number(width) : 0, "0"),
    );
}
