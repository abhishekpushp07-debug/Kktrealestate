/**
 * Canonical CSV import templates (GET /masters/{path}/import-template): the header is the kind's create-schema fields (exactly what
 * POST /masters/import accepts) and the example row is valid for the caller's company — references (room / area / flat type ids, spec
 * categories) are taken from its active masters — so importing the template's example succeeds as is. The ERP builds its template
 * downloads from this endpoint instead of keeping its own column lists (which had drifted: `default_amount` vs `default_amount_paise`).
 */
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import {
  MasterImportTemplateQuerySchema,
  MasterImportTemplateSchema,
  type ImportColumnType,
  type ImportTemplateColumn,
  type MasterImportTemplate,
} from "@kkt/contracts";
import { areaTypes, flatTypes, roomTypes, specCategories, type Executor } from "@kkt/db";
import { csvField } from "../../lib/csv.js";
import { route } from "../../lib/routes.js";
import { importShape, isOptionalField } from "./importer.js";
import type { MasterKindDef } from "./types.js";

type ZodDef = {
  type: string;
  innerType?: z.ZodType;
  out?: z.ZodType;
  element?: z.ZodType;
  entries?: Record<string, string>;
  options?: z.ZodType[];
};
const defOf = (s: z.ZodType): ZodDef => (s as unknown as { _zod: { def: ZodDef } })._zod.def;

function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (let i = 0; i < 10; i++) {
    const d = defOf(s);
    if (["optional", "nullable", "default", "nonoptional", "readonly", "catch"].includes(d.type) && d.innerType)
      s = d.innerType;
    else if (d.type === "pipe" && d.out) s = d.out;
    else return s;
  }
  return s;
}

/** Template column description of one create-schema field. */
export function describeColumn(name: string, field: z.ZodType, keyField: string): ImportTemplateColumn {
  const d = defOf(unwrap(field));
  let type: ImportColumnType = "string";
  let values: string[] | undefined;
  if (d.type === "number" || d.type === "int") type = "number";
  else if (d.type === "boolean") type = "boolean";
  else if (d.type === "enum") {
    type = "enum";
    values = Object.values(d.entries ?? {});
  } else if (d.type === "object" || d.type === "record") type = "json";
  else if (d.type === "array" && d.element) {
    const e = defOf(unwrap(d.element));
    if (e.type === "object") type = "json";
    else {
      type = "list";
      if (e.type === "enum") values = Object.values(e.entries ?? {});
    }
  }
  return { name, required: !isOptionalField(field), type, ...(values ? { values } : {}), key: name === keyField };
}

/** Cell text for a value in a column of the given type (lists `|`-separated, objects as JSON). */
function cellText(type: ImportColumnType, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (type === "list" && Array.isArray(value)) return value.map(String).join("|");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

async function firstActive(
  db: Executor,
  table: typeof roomTypes | typeof flatTypes | typeof specCategories,
  companyId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.companyId, companyId), eq(table.isActive, true)))
    .orderBy(asc(table.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** An example row (wire values) for the kind that the importer accepts for this company; `notes` say what needs editing first. */
export async function exampleRow(
  db: Executor,
  def: MasterKindDef,
  companyId: string,
): Promise<{ values: Record<string, unknown>; notes: string[] }> {
  const notes: string[] = [];
  const ref = (id: string | null, what: string): string => {
    if (id) return id;
    notes.push(`No active ${what} exists yet: create one and put its id in the example before importing it.`);
    return PLACEHOLDER_ID;
  };
  switch (def.kind) {
    case "ROOM_TYPES":
      return { values: { name: "Study Room", code: "STUDY", sort_order: 90 }, notes };
    case "AREA_TYPES":
      return { values: { name: "Balcony Area", code: "BALCONY", sort_order: 90 }, notes };
    case "BLOCK_TYPES":
      return { values: { name: "Row House", code: "ROW_HOUSE", has_floors: false }, notes };
    case "AMENITIES":
      return { values: { name: "Clubhouse", category: "Leisure", icon: "club" }, notes };
    case "CONSTRUCTION_STAGES":
      return { values: { name: "Landscaping", code: "LANDSCAPING", sort_order: 900, is_possession: false }, notes };
    case "CHARGE_TYPES":
      return {
        values: {
          name: "Club Membership",
          code: "CLUB",
          default_amount_paise: 15_000_000,
          is_taxable: true,
          default_gst_percent: 18,
          demand_at: "ON_POSSESSION",
        },
        notes,
      };
    case "PAYMENT_MODES":
      return {
        values: {
          name: "Demand Draft",
          code: "DD",
          requires_instrument: true,
          clears_immediately: false,
          is_cash: false,
          sort_order: 5,
        },
        notes,
      };
    case "BANK_ACCOUNTS":
      return {
        values: {
          bank_name: "State Bank of India",
          branch: "Gandhi Maidan",
          account_name: "Collections Account (example)",
          account_number: "30123456789",
          ifsc: "SBIN0000152",
          is_default: false,
          is_escrow: false,
        },
        notes,
      };
    case "DOCUMENT_TYPES":
      return {
        values: { name: "Allotment Letter", code: "ALLOTMENT", applies_to: ["BOOKING", "CUSTOMER"], is_kyc: false },
        notes,
      };
    case "PLC_TYPES":
      return { values: { name: "Garden Facing", code: "GARDEN_FACING", calc_mode: "PER_SQFT" }, notes };
    case "SPEC_CATEGORIES":
      return { values: { name: "Electrical", sort_order: 90 }, notes };
    case "SERVICE_CATEGORIES":
      return { values: { name: "Lift / Elevator", sort_order: 90, default_priority: "HIGH" }, notes };
    case "SPEC_ITEMS":
      return {
        values: {
          category_id: ref(await firstActive(db, specCategories, companyId), "specification category"),
          name: "Modular switches",
          description: "ISI-marked modular switches in every room",
          sort_order: 90,
        },
        notes,
      };
    case "FLAT_TYPES": {
      const room = ref(await firstActive(db, roomTypes, companyId), "room type");
      const areas = await db
        .select({ id: areaTypes.id, code: areaTypes.code })
        .from(areaTypes)
        .where(and(eq(areaTypes.companyId, companyId), eq(areaTypes.isActive, true)));
      const byCode = new Map(areas.map((a) => [a.code, a.id]));
      const sizes: [string, number][] = [
        ["CARPET", 1050],
        ["BUILT_UP", 1250],
        ["SUPER_BUILT_UP", 1520],
      ];
      return {
        values: {
          name: "3 BHK Example",
          code: "3BHK-EX",
          bhk: 3,
          facing: "East",
          description: "Three bedrooms, two balconies",
          rooms: [{ room_type_id: room, label: "Master Bedroom", length_ft: 12, width_ft: 14 }],
          areas: sizes.map(([code, sqft]) => ({
            area_type_id: ref(byCode.get(code) ?? null, `area type with code ${code}`),
            sqft,
          })),
          base_rate_per_sqft_paise: 550_000,
        },
        notes,
      };
    }
    case "FLOOR_PLAN_TEMPLATES": {
      const ft = ref(await firstActive(db, flatTypes, companyId), "flat type");
      return {
        values: {
          name: "Two per floor (example)",
          code: "FP2-EX",
          positions: [
            { position: 1, flat_type_id: ft, facing: "East", is_corner: true },
            { position: 2, flat_type_id: ft, facing: "West", is_corner: true },
          ],
        },
        notes,
      };
    }
    case "PAYMENT_PLANS":
      return {
        values: {
          name: "Down Payment (example)",
          code: "DP-EX",
          plan_type: "DOWN_PAYMENT",
          description: "10% on booking, 85% within 45 days, 5% on possession",
          grace_days: 7,
          installments: [
            { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING", due_days: 7 },
            { seq: 2, name: "Within 45 days", percent: 85, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 45 },
            { seq: 3, name: "On possession", percent: 5, trigger_type: "ON_POSSESSION" },
          ],
        },
        notes,
      };
  }
}

/** Builds the template for one kind. */
export async function importTemplate(
  db: Executor,
  def: MasterKindDef,
  companyId: string,
): Promise<MasterImportTemplate> {
  const shape = importShape(def);
  const columns = Object.entries(shape).map(([name, field]) => describeColumn(name, field, def.keyField));
  const header = columns.map((c) => c.name);
  const { values, notes } = await exampleRow(db, def, companyId);
  const example: Record<string, string> = {};
  for (const c of columns) example[c.name] = cellText(c.type, values[c.name]);
  const csv = `${header.map(csvField).join(",")}\r\n${header.map((h) => csvField(example[h])).join(",")}\r\n`;
  return { kind: def.kind, path: def.path, key_field: def.keyField, columns, header, example, csv, notes };
}

/** GET /masters/{path}/import-template for one kind (permission master.read). */
export function registerImportTemplateRoute(app: FastifyInstance, def: MasterKindDef): void {
  route(app, {
    method: "GET",
    url: `/masters/${def.path}/import-template`,
    permission: "master.read",
    schema: {
      querystring: MasterImportTemplateQuerySchema,
      response: { 200: MasterImportTemplateSchema },
      summary: `Canonical CSV import template for ${def.path.replace(/-/g, " ")} (header + an example row valid for this company)`,
      tags: ["masters"],
    },
    handler: async (req, reply) => {
      const template = await importTemplate(app.dbReplica, def, req.user!.companyId);
      if (req.query.format === "csv") {
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="${def.path}-import-template.csv"`);
        return reply.send(Buffer.from(template.csv, "utf8"));
      }
      return template;
    },
  });
}
