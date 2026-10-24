import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MasterCsvImportRequestSchema, MasterCsvImportResponseSchema, type MasterCsvImportResponse, type MasterCsvImportRow } from "@kkt/contracts";
import type { Executor } from "@kkt/db";
import { parseCsvObjects } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { createMaster, updateMaster } from "./factory.js";
import { kindDef } from "./kinds.js";
import type { DbRow, MasterKindDef, WriteContext } from "./types.js";

type ZodDef = { type: string; innerType?: z.ZodType; in?: z.ZodType; out?: z.ZodType; element?: z.ZodType; shape?: Record<string, z.ZodType>; options?: z.ZodType[] };

function defOf(schema: z.ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

/** Unwraps optional/nullable/default/pipe wrappers to the schema that describes the value's shape. */
function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (let i = 0; i < 10; i++) {
    const d = defOf(s);
    if ((d.type === "optional" || d.type === "nullable" || d.type === "default" || d.type === "nonoptional" || d.type === "readonly" || d.type === "catch") && d.innerType) { s = d.innerType; continue; }
    if (d.type === "pipe" && d.out) { s = d.out; continue; }
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
    case "number": { const n = Number(value); return Number.isNaN(n) ? value : n; }
    case "boolean": {
      if (/^(true|yes|y|1)$/i.test(value)) return true;
      if (/^(false|no|n|0)$/i.test(value)) return false;
      return value;
    }
    case "array": {
      if (value.startsWith("[")) { try { return JSON.parse(value); } catch { return value; } }
      const inner = d.element ? defOf(unwrap(d.element)).type : "string";
      const parts = value.split(/[|;]/).map((p) => p.trim()).filter(Boolean);
      return inner === "number" ? parts.map(Number) : parts;
    }
    case "object": { try { return JSON.parse(value); } catch { return value; } }
    default: return value;
  }
}

/** Converts one CSV record into a candidate body for the kind's create schema. */
export function csvRecordToInput(def: MasterKindDef, values: Record<string, string>): Record<string, unknown> {
  const shape = shapeOf(def.createSchema);
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(values)) {
    const field = shape[k];
    if (!field) continue; // unknown columns are ignored (strict schemas would reject them)
    const v = coerceCsvValue(field, raw);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function issues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`);
}

/** Loads the existing rows for a set of business keys in one query (case-insensitive), keyed by lower-cased key. */
async function existingByKeys(db: Executor, def: MasterKindDef, companyId: string, keys: readonly string[]): Promise<Map<string, DbRow>> {
  const out = new Map<string, DbRow>();
  if (keys.length === 0) return out;
  const lowered = [...new Set(keys.map((k) => k.toLowerCase()))];
  const rows = (await db.select().from(def.table).where(and(eq(def.table.companyId, companyId), sql`lower(${def.keyColumn}::text) in (${sql.join(lowered.map((k) => sql`${k}`), sql`, `)})`))) as DbRow[];
  const camel = def.keyField.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  for (const r of rows) out.set(String(r[camel] ?? "").toLowerCase(), r);
  return out;
}

/** Import request as accepted by the API: the contract body plus `partial` (commit the valid rows even when some rows are in ERROR). */
export const MasterCsvImportBodySchema = MasterCsvImportRequestSchema.extend({ partial: z.boolean().default(false) });
export type MasterCsvImportBody = z.infer<typeof MasterCsvImportBodySchema>;

/**
 * Previews (and with commit=true applies, in one transaction) a CSV import for one master kind.
 * With errors present a commit is refused (422 IMPORT_HAS_ERRORS) unless `partial` is set, in which case only CREATE/UPDATE rows are applied.
 */
export async function importMasterCsv(app: FastifyInstance, ctx: WriteContext, body: MasterCsvImportBody): Promise<MasterCsvImportResponse> {
  const def = kindDef(body.kind);
  const parsed = parseCsvObjects(body.csv);
  if (parsed.headers.length === 0) throw ApiError.badRequest("CSV has no header line");
  const rows: (MasterCsvImportRow & { input?: Record<string, unknown>; key?: string })[] = [];
  const seenKeys = new Map<string, number>();
  for (const rec of parsed.rows) {
    const input = csvRecordToInput(def, rec.values);
    const result = def.createSchema.safeParse(input);
    if (!result.success) { rows.push({ line: rec.line, action: "ERROR", data: input, errors: issues(result.error) }); continue; }
    const data = result.data as Record<string, unknown>;
    const key = String(data[def.keyField] ?? "").trim();
    if (!key) { rows.push({ line: rec.line, action: "ERROR", data, errors: [`${def.keyField} is required`] }); continue; }
    const dupLine = seenKeys.get(key.toLowerCase());
    if (dupLine !== undefined) { rows.push({ line: rec.line, action: "SKIP", data, errors: [`Duplicate ${def.keyField} "${key}" (first seen on line ${dupLine})`] }); continue; }
    seenKeys.set(key.toLowerCase(), rec.line);
    rows.push({ line: rec.line, action: "CREATE", data, errors: [], input: data, key });
  }
  const existing = await existingByKeys(app.db, def, ctx.companyId, rows.flatMap((r) => (r.key ? [r.key] : [])));
  for (const r of rows) if (r.key && existing.has(r.key.toLowerCase())) r.action = "UPDATE";
  if (body.commit) {
    const errorLines = rows.filter((r) => r.action === "ERROR").map((r) => r.line);
    if (errorLines.length > 0 && !body.partial) throw ApiError.rule("Fix the rows marked ERROR before committing the import (or commit with partial=true to import the valid rows only)", "IMPORT_HAS_ERRORS", { error_lines: errorLines });
    await app.db.transaction(async (tx) => {
      // Re-resolve inside the transaction so a row created between preview and commit becomes an update instead of a duplicate.
      const live = await existingByKeys(tx, def, ctx.companyId, rows.flatMap((r) => (r.key ? [r.key] : [])));
      for (const r of rows) {
        if (!r.input || !r.key || r.action === "ERROR" || r.action === "SKIP") continue;
        const row = live.get(r.key.toLowerCase());
        if (row) { r.action = "UPDATE"; await updateMaster(tx, def, ctx, String(row["id"]), Number(row["version"]), r.input); }
        else { r.action = "CREATE"; await createMaster(tx, def, ctx, r.input); }
      }
    });
  }
  const summary = { create: 0, update: 0, skip: 0, error: 0 };
  for (const r of rows) summary[r.action.toLowerCase() as keyof typeof summary] += 1;
  return { kind: body.kind, committed: body.commit, rows: rows.map(({ line, action, data, errors }) => ({ line, action, data, errors })), summary };
}

/** POST /masters/import — CSV import preview and commit (permission master.write). */
export function registerImportRoute(app: FastifyInstance): void {
  route(app, {
    method: "POST", url: "/masters/import", permission: "master.write", idempotent: true,
    schema: { body: MasterCsvImportBodySchema, response: { 200: MasterCsvImportResponseSchema }, summary: "Preview or commit a CSV import (partial=true imports the valid rows when some are in error)", tags: ["masters"] },
    handler: async (req) => importMasterCsv(app, { app, req, user: req.user!, companyId: req.user!.companyId }, req.body),
  });
}
