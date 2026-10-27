import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MasterCsvImportRequestSchema,
  MasterCsvImportResponseSchema,
  type MasterCsvImportResponse,
  type MasterCsvImportRow,
} from "@kkt/contracts";
import type { Executor } from "@kkt/db";
import { parseCsvObjects } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { createMaster, updateMaster } from "./factory.js";
import { kindDef } from "./kinds.js";
import type { DbRow, MasterKindDef, WriteContext } from "./types.js";

type ZodDef = {
  type: string;
  innerType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  element?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  options?: z.ZodType[];
};

function defOf(schema: z.ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

/** Unwraps optional/nullable/default/pipe wrappers to the schema that describes the value's shape. */
function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (let i = 0; i < 10; i++) {
    const d = defOf(s);
    if (
      (d.type === "optional" ||
        d.type === "nullable" ||
        d.type === "default" ||
        d.type === "nonoptional" ||
        d.type === "readonly" ||
        d.type === "catch") &&
      d.innerType
    ) {
      s = d.innerType;
      continue;
    }
    if (d.type === "pipe" && d.out) {
      s = d.out;
      continue;
    }
    return s;
  }
  return s;
}

/** Returns the object shape of a create schema (object/strictObject, possibly refined). */
function shapeOf(schema: z.ZodType): Record<string, z.ZodType> {
  const s = unwrap(schema);
  const d = defOf(s);
  return d.shape ?? {};
}

/** Coerces one raw CSV cell to the type its schema expects (numbers, booleans, JSON arrays/objects, pipe-separated lists). */
export function coerceCsvValue(schema: z.ZodType, raw: string): unknown {
  const value = raw.trim();
  if (value === "") return undefined;
  const d = defOf(unwrap(schema));
  switch (d.type) {
    case "number": {
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    }
    case "boolean": {
      if (/^(true|yes|y|1)$/i.test(value)) return true;
      if (/^(false|no|n|0)$/i.test(value)) return false;
      return value;
    }
    case "array": {
      if (value.startsWith("[")) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      const inner = d.element ? defOf(unwrap(d.element)).type : "string";
      const parts = value
        .split(/[|;]/)
        .map((p) => p.trim())
        .filter(Boolean);
      return inner === "number" ? parts.map(Number) : parts;
    }
    case "object": {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    default:
      return value;
  }
}

/** Converts one CSV record into a candidate body for the kind's create schema. */
export function csvRecordToInput(def: MasterKindDef, values: Record<string, string>): Record<string, unknown> {
  const shape = shapeOf(def.createSchema);
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(values)) {
    // own keys only: `shape` is a plain object, so `shape["constructor"]` would be Object.prototype.constructor (500 on coercion)
    const field = Object.hasOwn(shape, k) ? shape[k] : undefined;
    if (!field) continue; // unknown columns are ignored (strict schemas would reject them)
    const v = coerceCsvValue(field, raw);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function issues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`);
}

/** True when the field may be left out of a create body (optional or with a default somewhere in its wrapper chain). */
export function isOptionalField(schema: z.ZodType): boolean {
  let s = schema;
  for (let i = 0; i < 10; i++) {
    const d = defOf(s);
    if (d.type === "optional" || d.type === "default") return true;
    if ((d.type === "nullable" || d.type === "readonly" || d.type === "catch") && d.innerType) {
      s = d.innerType;
      continue;
    }
    return false;
  }
  return false;
}

/** Removes optional/default wrappers at the top of a field (an UPDATE row must never receive a create-time default). */
function stripDefaults(field: z.ZodType): z.ZodType {
  let s = field;
  for (let i = 0; i < 10; i++) {
    const d = defOf(s);
    if ((d.type === "optional" || d.type === "default") && d.innerType) s = d.innerType;
    else return s;
  }
  return s;
}

/** The kind's import columns: the create schema's fields in declaration order. */
export function importShape(def: MasterKindDef): Record<string, z.ZodType> {
  return shapeOf(def.createSchema);
}

const partialSchemas = new WeakMap<MasterKindDef, z.ZodType>();
/**
 * Schema for an UPDATE row: every create field optional WITHOUT its default (Zod 4 would otherwise fill `demand_at: MANUAL`,
 * `default_amount_paise: 0`, `spec_item_ids: []` … for every column the CSV leaves out), unknown keys refused.
 */
export function partialImportSchema(def: MasterKindDef): z.ZodType {
  let schema = partialSchemas.get(def);
  if (!schema) {
    const out: Record<string, z.ZodType> = {};
    for (const [k, field] of Object.entries(importShape(def))) out[k] = stripDefaults(field).optional();
    schema = z.strictObject(out);
    partialSchemas.set(def, schema);
  }
  return schema;
}

/** Levenshtein distance (small strings: header names). */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_v, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** The expected column an unknown header most likely means (`default_amount` → `default_amount_paise`), if any is close. */
export function suggestColumn(unknown: string, expected: readonly string[]): string | null {
  const u = unknown
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (expected.includes(u)) return u;
  let best: { name: string; score: number } | null = null;
  for (const e of expected) {
    let score = distance(u, e);
    if (e.startsWith(`${u}_`) || e === `${u}_paise` || e === `${u}_id` || e === `${u}_ids`) score = 0.5;
    if (score <= Math.max(2, Math.floor(e.length / 4)) && (!best || score < best.score)) best = { name: e, score };
  }
  return best?.name ?? null;
}

/**
 * Checks a CSV header against the kind's columns: unknown or misnamed columns are 422 IMPORT_UNKNOWN_COLUMNS listing them with the
 * expected names (they used to be dropped silently, so a mistyped money column imported as "unchanged" or as its default). Export-only
 * columns of the kind's own CSV export (`id`, `version`, `is_active`, looked-up names) are accepted and ignored.
 */
export function checkImportHeader(def: MasterKindDef, headers: readonly string[]): { ignored: string[] } {
  const shape = importShape(def);
  const expected = Object.keys(shape);
  // Object.hasOwn, never `in`: a header named like an Object.prototype member (`constructor`, `toString`, `__proto__`) is unknown
  const known = (h: string): boolean => Object.hasOwn(shape, h);
  const exportOnly = new Set(def.csvColumns.filter((c) => !known(c)));
  const named = headers.filter((h) => h !== "");
  const unknown = named.filter((h) => !known(h) && !exportOnly.has(h));
  if (unknown.length > 0) {
    const suggestions: Record<string, string> = {};
    for (const u of unknown) {
      const g = suggestColumn(u, expected);
      if (g) suggestions[u] = g;
    }
    throw new ApiError(
      422,
      "IMPORT_UNKNOWN_COLUMNS",
      `Unknown column(s) for ${def.path}: ${unknown
        .map((u) => (suggestions[u] ? `${u} (did you mean ${suggestions[u]}?)` : u))
        .join(", ")}. Expected columns: ${expected.join(", ")}`,
      {
        kind: def.kind,
        unknown_columns: unknown,
        suggestions,
        expected_columns: expected,
        required_columns: expected.filter((k) => !isOptionalField(shape[k]!)),
      },
    );
  }
  return { ignored: named.filter((h) => exportOnly.has(h)) };
}

/** Loads the existing rows for a set of business keys in one query (case-insensitive), keyed by lower-cased key. */
async function existingByKeys(
  db: Executor,
  def: MasterKindDef,
  companyId: string,
  keys: readonly string[],
): Promise<Map<string, DbRow>> {
  const out = new Map<string, DbRow>();
  if (keys.length === 0) return out;
  const lowered = [...new Set(keys.map((k) => k.toLowerCase()))];
  const rows = (await db
    .select()
    .from(def.table)
    .where(
      and(
        eq(def.table.companyId, companyId),
        sql`lower(${def.keyColumn}::text) in (${sql.join(
          lowered.map((k) => sql`${k}`),
          sql`, `,
        )})`,
      ),
    )) as DbRow[];
  const camel = def.keyField.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  for (const r of rows) out.set(String(r[camel] ?? "").toLowerCase(), r);
  return out;
}

/** Import request as accepted by the API: the contract body plus `partial` (commit the valid rows even when some rows are in ERROR). */
export const MasterCsvImportBodySchema = MasterCsvImportRequestSchema.extend({ partial: z.boolean().default(false) });
export type MasterCsvImportBody = z.infer<typeof MasterCsvImportBodySchema>;

type PreviewRow = MasterCsvImportRow & { input?: Record<string, unknown>; key?: string };

/** Validates one row for the action it will take: CREATE → the full create schema (defaults apply); UPDATE → the partial schema. */
function validateFor(
  def: MasterKindDef,
  action: "CREATE" | "UPDATE",
  input: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; errors: string[] } {
  const result = (action === "CREATE" ? def.createSchema : partialImportSchema(def)).safeParse(input);
  if (!result.success) return { ok: false, errors: issues(result.error) };
  return { ok: true, data: result.data as Record<string, unknown> };
}

/**
 * Previews (and with commit=true applies, in one transaction) a CSV import for one master kind.
 * The header is checked first (unknown columns → 422 IMPORT_UNKNOWN_COLUMNS). A row whose business key exists is an UPDATE that writes
 * only the columns present in the CSV with a non-empty cell; a new key is a CREATE validated by the create schema (defaults apply).
 * With errors present a commit is refused (422 IMPORT_HAS_ERRORS) unless `partial` is set, in which case only CREATE/UPDATE rows are applied.
 */
export async function importMasterCsv(
  app: FastifyInstance,
  ctx: WriteContext,
  body: MasterCsvImportBody,
): Promise<MasterCsvImportResponse> {
  const def = kindDef(body.kind);
  const parsed = parseCsvObjects(body.csv);
  if (parsed.headers.length === 0) throw ApiError.badRequest("CSV has no header line");
  const { ignored } = checkImportHeader(def, parsed.headers);
  const keySchema = importShape(def)[def.keyField];
  const rows: PreviewRow[] = [];
  const seenKeys = new Map<string, number>();
  for (const rec of parsed.rows) {
    const input = csvRecordToInput(def, rec.values);
    const rawKey = input[def.keyField];
    if (rawKey === undefined || rawKey === "") {
      rows.push({ line: rec.line, action: "ERROR", data: input, errors: [`${def.keyField} is required`] });
      continue;
    }
    const keyResult = keySchema ? keySchema.safeParse(rawKey) : { success: true as const, data: rawKey };
    if (!keyResult.success) {
      rows.push({
        line: rec.line,
        action: "ERROR",
        data: input,
        errors: keyResult.error.issues.map((i) => `${def.keyField}: ${i.message}`),
      });
      continue;
    }
    const key = String(keyResult.data ?? "").trim();
    if (!key) {
      rows.push({ line: rec.line, action: "ERROR", data: input, errors: [`${def.keyField} is required`] });
      continue;
    }
    const dupLine = seenKeys.get(key.toLowerCase());
    if (dupLine !== undefined) {
      rows.push({
        line: rec.line,
        action: "SKIP",
        data: input,
        errors: [`Duplicate ${def.keyField} "${key}" (first seen on line ${dupLine})`],
      });
      continue;
    }
    seenKeys.set(key.toLowerCase(), rec.line);
    rows.push({ line: rec.line, action: "CREATE", data: input, errors: [], input, key });
  }
  const keys = rows.flatMap((r) => (r.key ? [r.key] : []));
  const existing = await existingByKeys(app.db, def, ctx.companyId, keys);
  for (const r of rows) {
    if (!r.input || !r.key) continue;
    const action = existing.has(r.key.toLowerCase()) ? "UPDATE" : "CREATE";
    const v = validateFor(def, action, r.input);
    if (v.ok) Object.assign(r, { action, data: v.data });
    else Object.assign(r, { action: "ERROR", errors: v.errors, input: undefined, key: undefined });
  }
  if (body.commit) {
    const errorLines = rows.filter((r) => r.action === "ERROR").map((r) => r.line);
    if (errorLines.length > 0 && !body.partial)
      throw ApiError.rule(
        "Fix the rows marked ERROR before committing the import (or commit with partial=true to import the valid rows only)",
        "IMPORT_HAS_ERRORS",
        { error_lines: errorLines },
      );
    await app.db.transaction(async (tx) => {
      // Re-resolve inside the transaction so a row created between preview and commit becomes an update instead of a duplicate.
      const live = await existingByKeys(
        tx,
        def,
        ctx.companyId,
        rows.flatMap((r) => (r.key ? [r.key] : [])),
      );
      for (const r of rows) {
        if (!r.input || !r.key || r.action === "ERROR" || r.action === "SKIP") continue;
        const row = live.get(r.key.toLowerCase());
        const action = row ? "UPDATE" : "CREATE";
        const v = action === r.action ? { ok: true as const, data: r.data } : validateFor(def, action, r.input);
        if (!v.ok)
          throw ApiError.rule(
            `Line ${r.line} changed from ${r.action} to ${action} since the preview and is no longer valid: ${v.errors.join("; ")}`,
            "IMPORT_HAS_ERRORS",
            { error_lines: [r.line] },
          );
        r.action = action;
        r.data = v.data;
        if (row) await updateMaster(tx, def, ctx, String(row["id"]), Number(row["version"]), v.data);
        else await createMaster(tx, def, ctx, v.data);
      }
    });
  }
  const summary = { create: 0, update: 0, skip: 0, error: 0 };
  for (const r of rows) summary[r.action.toLowerCase() as keyof typeof summary] += 1;
  return {
    kind: body.kind,
    committed: body.commit,
    rows: rows.map(({ line, action, data, errors }) => ({ line, action, data, errors })),
    summary,
    ...(ignored.length > 0 ? { ignored_columns: ignored } : {}),
  };
}

/** POST /masters/import — CSV import preview and commit (permission master.write). */
export function registerImportRoute(app: FastifyInstance): void {
  route(app, {
    method: "POST",
    url: "/masters/import",
    permission: "master.write",
    idempotent: true,
    schema: {
      body: MasterCsvImportBodySchema,
      response: { 200: MasterCsvImportResponseSchema },
      summary: "Preview or commit a CSV import (partial=true imports the valid rows when some are in error)",
      tags: ["masters"],
    },
    handler: async (req) =>
      importMasterCsv(app, { app, req, user: req.user!, companyId: req.user!.companyId }, req.body),
  });
}
