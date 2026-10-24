/** camelCase → snake_case for one key. */
export function snakeKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Converts a value for the wire: Dates → ISO strings, nested arrays/objects recursed only at the top level of a row. */
function wireValue(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

/** Converts a Drizzle row (camelCase, Date objects) into its wire shape (snake_case keys, ISO timestamps). */
export function snakeRow<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeKey(k)] = wireValue(v);
  return out as T;
}

/** snake_case → camelCase for one key. */
export function camelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** Converts wire input (snake_case) into Drizzle column properties (camelCase). */
export function camelRow(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[camelKey(k)] = v;
  return out;
}
