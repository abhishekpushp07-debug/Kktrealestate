/**
 * Companies of the scale seed (docs/SEED.md "Production-size data"): the second tenant (created with the six system roles and a copy of
 * the demo company's masters) and the in-memory context every generator works from — masters, staff, plan snapshots and the per-FY
 * document number series.
 */
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { SYSTEM_ROLES, SYSTEM_ROLE_NAMES, type SystemRoleName } from "@kkt/contracts";
import type { PlanSnapshot } from "@kkt/db";
import {
  DEFAULT_NUMBER_PATTERN,
  financialYear,
  formatNumber,
  type FlatTypeDefinition,
  type FloorPlanTemplate,
  type SlaHours,
} from "@kkt/domain";
import { buildPlanSnapshot, loadPlan } from "../modules/money/index.js";
import type { Rng } from "./scaleData.js";
import type { ModeRef, ScaleModes } from "./scaleMoney.js";

/** The second company the scale seed adds (its slug marks a scaled database). */
export const SCALE_COMPANY = {
  name: "Patliputra Infra Developers",
  slug: "patliputra-infra",
  legalName: "Patliputra Infra Developers Private Limited",
  domain: "pid.in",
  receiptPrefix: "PID/",
} as const;

/** A staff user as the generators need it. */
export interface StaffRef {
  id: string;
  name: string;
  role: SystemRoleName;
  allProjects: boolean;
  projectIds: string[];
}

/** Masters of a company the generators use. */
export interface Masters {
  stages: { id: string; name: string; isPossession: boolean }[];
  towerTypeId: string;
  templates: FloorPlanTemplate[];
  templateIds: { standard: string; premium: string };
  flatTypes: FlatTypeDefinition[];
  flatTypeNames: Map<string, string>;
  /** Plans every new project offers; `weight` = share of bookings, the heaviest is the project default. */
  plans: { id: string; snapshot: PlanSnapshot; weight: number }[];
  modes: ScaleModes;
  bankId: string | null;
  plc: { floorRise: string | null; corner: string | null };
  serviceCategories: { id: string; name: string; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }[];
  amenityIds: string[];
}

/** Everything the generators know about one company. */
export interface CompanyCtx {
  id: string;
  domain: string;
  isDemo: boolean;
  fyStartMonth: number;
  numbering: Record<string, { prefix?: string; format?: string } | undefined>;
  dueDays: number;
  slaHours: SlaHours;
  roles: Record<SystemRoleName, string>;
  masters: Masters;
  staff: StaffRef[];
  /** Last allocated value per `${scope}|${fy}` (starts from the `sequences` table). */
  seq: Map<string, number>;
  /** Sequence keys this run advanced. */
  touched: Set<string>;
}

/**
 * Next document number of a scope in the financial year of `date`, exactly as lib/numbering.ts formats it. Callers allocate in posting
 * order, so every series stays gapless and ordered; the advanced `sequences` rows are written at the end of the load.
 */
export function allocate(c: CompanyCtx, scope: string, date: string, fallbackPrefix: string): string {
  const fy = financialYear(date, c.fyStartMonth).label;
  const key = `${scope}|${fy}`;
  const value = (c.seq.get(key) ?? 0) + 1;
  c.seq.set(key, value);
  c.touched.add(key);
  const cfg = c.numbering[scope];
  return formatNumber(cfg?.prefix ?? fallbackPrefix, fy, value, cfg?.format ?? DEFAULT_NUMBER_PATTERN);
}

/** Staff of a role who may work on a project (all-projects users and users scoped to it). */
export function staffFor(c: CompanyCtx, role: SystemRoleName, projectId: string | null): StaffRef[] {
  return c.staff.filter(
    (s) => s.role === role && (s.allProjects || (projectId !== null && s.projectIds.includes(projectId))),
  );
}

/** Master tables copied from the demo company to the scale company (FK order). */
const MASTER_TABLES = [
  "room_types",
  "area_types",
  "spec_categories",
  "spec_items",
  "flat_types",
  "block_types",
  "floor_plan_templates",
  "amenities",
  "construction_stages",
  "payment_plans",
  "payment_plan_installments",
  "charge_types",
  "payment_modes",
  "bank_accounts",
  "document_types",
  "plc_types",
  "service_categories",
] as const;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Creates the scale company (when missing) with the six system roles and a copy of the demo company's masters: every master row gets a
 * new id and every reference to a copied row — FK columns, uuid arrays, ids inside jsonb such as flat-type rooms or floor-plan positions —
 * is rewritten to the copy, so the two tenants share nothing. Committed on its own, before the bulk load (the money module's loaders read
 * the copied plans through the application pool).
 */
export async function ensureScaleCompany(sql: Sql, rng: Rng, sourceId: string): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`select id from companies where slug = ${SCALE_COMPANY.slug}`;
  if (existing) return existing.id;
  return sql.begin(async (tx) => {
    const companyId = rng.uuid();
    const address = { line1: "Patliputra Tower, Fraser Road", city: "Patna", state: "Bihar", pincode: "800001" };
    const letterhead = {
      tagline: "Homes along the Ganga",
      phone: "+91 612 2300000",
      email: `info@${SCALE_COMPANY.domain}`,
    };
    const numbering = {
      customer: { prefix: "CUST-" },
      booking: { prefix: "BK-" },
      demand: { prefix: "DM-" },
      receipt: { prefix: SCALE_COMPANY.receiptPrefix },
      ticket: { prefix: "SR-" },
      visit: { prefix: "SV-" },
    };
    // like the demo company: published demo logins must work without an authenticator app (docs/SEED.md)
    const settings = {
      demand_due_days: 15,
      default_gst_percent: 5,
      round_robin_enabled: true,
      force_mfa_for_admins: false,
      sla_hours: { LOW: 72, MEDIUM: 48, HIGH: 24, URGENT: 8 },
      booking_hold_hours: 48,
    };
    await tx.unsafe(
      `insert into companies (id, name, slug, legal_name, gstin, phone, email, address, letterhead, fy_start_month, numbering, settings)
       values ($1, $2, $3, $4, '10AACCP4321B1Z2', '6122300000', $5, $6::text::jsonb, $7::text::jsonb, 4, $8::text::jsonb, $9::text::jsonb)`,
      [
        companyId,
        SCALE_COMPANY.name,
        SCALE_COMPANY.slug,
        SCALE_COMPANY.legalName,
        `info@${SCALE_COMPANY.domain}`,
        JSON.stringify(address),
        JSON.stringify(letterhead),
        JSON.stringify(numbering),
        JSON.stringify(settings),
      ],
    );
    for (const name of SYSTEM_ROLE_NAMES) {
      const def = SYSTEM_ROLES[name];
      await tx.unsafe(
        "insert into roles (company_id, name, description, permissions, is_system) values ($1, $2, $3, $4::text[], true)",
        [companyId, name, def.description, `{${def.permissions.map((p) => `"${p}"`).join(",")}}`],
      );
    }
    const rowsByTable = new Map<string, Record<string, unknown>[]>();
    const idMap = new Map<string, string>();
    for (const table of MASTER_TABLES) {
      const rows =
        table === "payment_plan_installments"
          ? await tx.unsafe<{ r: Record<string, unknown> }[]>(
              `select to_jsonb(i) as r from payment_plan_installments i join payment_plans p on p.id = i.plan_id
               where p.company_id = $1 order by i.plan_id, i.seq`,
              [sourceId],
            )
          : await tx.unsafe<{ r: Record<string, unknown> }[]>(
              `select to_jsonb(t) as r from "${table}" t where t.company_id = $1 order by t.created_at, t.id`,
              [sourceId],
            );
      rowsByTable.set(
        table,
        rows.map((x) => x.r),
      );
      for (const { r } of rows) idMap.set(String(r["id"]), rng.uuid());
    }
    for (const table of MASTER_TABLES) {
      const rows = (rowsByTable.get(table) ?? []).map((r) => {
        const copy = JSON.parse(JSON.stringify(r).replace(UUID_RE, (id) => idMap.get(id) ?? id)) as Record<
          string,
          unknown
        >;
        if ("company_id" in copy) copy["company_id"] = companyId;
        if ("created_by" in copy) copy["created_by"] = null;
        return copy;
      });
      if (rows.length === 0) continue;
      await tx.unsafe(
        `insert into "${table}" select * from jsonb_populate_recordset(null::"${table}", $1::text::jsonb)`,
        [JSON.stringify(rows)],
      );
    }
    return companyId;
  });
}

interface FlatTypeJson {
  id: string;
  code: string;
  name: string;
  facing: string | null;
  rooms: {
    room_type_id: string;
    room_type_name: string;
    label: string;
    length_ft: number;
    width_ft: number;
    sqft: number;
  }[];
  areas: { area_type_id: string; area_type_code: string; area_type_name: string; sqft: number }[];
  carpet_sqft: number | string;
  builtup_sqft: number | string;
  super_builtup_sqft: number | string;
  base_rate_per_sqft_paise: number | string | null;
  base_price_paise: number | string | null;
}

/** Flat type row (as jsonb) → domain definition, as the inventory module maps it. */
function flatTypeToDomain(r: FlatTypeJson): FlatTypeDefinition {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    facing: r.facing,
    rooms: r.rooms.map((x) => ({
      roomTypeId: x.room_type_id,
      roomTypeName: x.room_type_name,
      label: x.label,
      lengthFt: Number(x.length_ft),
      widthFt: Number(x.width_ft),
      sqft: Number(x.sqft),
    })),
    areas: r.areas.map((x) => ({
      areaTypeId: x.area_type_id,
      areaTypeCode: x.area_type_code,
      areaTypeName: x.area_type_name,
      sqft: Number(x.sqft),
    })),
    carpetSqft: Number(r.carpet_sqft),
    builtupSqft: Number(r.builtup_sqft),
    superBuiltupSqft: Number(r.super_builtup_sqft),
    baseRatePerSqftPaise: r.base_rate_per_sqft_paise === null ? null : Number(r.base_rate_per_sqft_paise),
    basePricePaise: r.base_price_paise === null ? null : Number(r.base_price_paise),
  };
}

/** Share of bookings per plan code (the heaviest is each new project's default plan). */
const PLAN_WEIGHTS: Record<string, number> = { STD_CLP: 70, DP_10_85_5: 15, FLEXI_10_40_50: 15 };

/** Loads a company's context through the application pool. */
export async function loadCompany(app: FastifyInstance, companyId: string, isDemo: boolean): Promise<CompanyCtx> {
  const sql = app.sql;
  const [company] = await sql<
    {
      fy_start_month: number;
      numbering: Record<string, { prefix?: string; format?: string }>;
      settings: { demand_due_days?: number; sla_hours?: SlaHours };
    }[]
  >`select fy_start_month, numbering, settings from companies where id = ${companyId}`;
  if (!company) throw new Error(`scale seed: company ${companyId} not found`);
  const [
    roleRows,
    stages,
    towers,
    templates,
    flatTypeRows,
    planRows,
    modeRows,
    banks,
    plcRows,
    cats,
    amenities,
    seqRows,
    staffRows,
  ] = await Promise.all([
    sql<{ id: string; name: string }[]>`select id, name from roles where company_id = ${companyId}`,
    sql<{ id: string; name: string; is_possession: boolean }[]>`
        select id, name, is_possession from construction_stages where company_id = ${companyId} and is_active order by sort_order, name`,
    sql<{ id: string }[]>`select id from block_types where company_id = ${companyId} and code = 'TOWER'`,
    sql<
      {
        id: string;
        code: string;
        flats_per_floor: number;
        positions: { position: number; flat_type_id: string; facing?: string | null; is_corner: boolean }[];
      }[]
    >`select id, code, flats_per_floor, positions from floor_plan_templates
        where company_id = ${companyId} and code in ('FP-4', 'FP-4-PREMIUM')`,
    sql<{ r: FlatTypeJson }[]>`select to_jsonb(f) as r from flat_types f where company_id = ${companyId} and is_active`,
    sql<{ id: string; code: string }[]>`
        select id, code from payment_plans where company_id = ${companyId} and is_active and code in ('STD_CLP', 'DP_10_85_5', 'FLEXI_10_40_50')`,
    sql<{ id: string; code: string; is_cash: boolean }[]>`
        select id, code, is_cash from payment_modes where company_id = ${companyId} and is_active`,
    sql<{ id: string }[]>`
        select id from bank_accounts where company_id = ${companyId} and is_active order by is_default desc, created_at limit 1`,
    sql<{ id: string; code: string }[]>`select id, code from plc_types where company_id = ${companyId}`,
    sql<{ id: string; name: string; default_priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }[]>`
        select id, name, default_priority from service_categories where company_id = ${companyId} and is_active order by sort_order`,
    sql<{ id: string }[]>`select id from amenities where company_id = ${companyId} order by name`,
    sql<
      { scope: string; fy: string; value: string | number }[]
    >`select scope, fy, value from sequences where company_id = ${companyId}`,
    sql<{ id: string; name: string; role: SystemRoleName; all_projects: boolean; projects: string[] | null }[]>`
        select u.id, u.name, r.name as role, u.all_projects,
          (select array_agg(s.project_id) from user_project_scopes s where s.user_id = u.id) as projects
        from users u join roles r on r.id = u.role_id where u.company_id = ${companyId} and u.is_active`,
  ]);
  const std = templates.find((t) => t.code === "FP-4");
  const premium = templates.find((t) => t.code === "FP-4-PREMIUM") ?? std;
  const tower = towers[0];
  if (!tower || !std || !premium || stages.length === 0)
    throw new Error("scale seed: the company lacks the TOWER block type, the FP-4 templates or construction stages");
  if (planRows.length === 0)
    throw new Error("scale seed: the company has no STD_CLP / DP_10_85_5 / FLEXI_10_40_50 plan");
  const dueDays = company.settings.demand_due_days ?? 15;
  const plans = await Promise.all(
    planRows.map(async (p) => ({
      id: p.id,
      snapshot: buildPlanSnapshot(await loadPlan(app.db, companyId, p.id), dueDays),
      weight: PLAN_WEIGHTS[p.code] ?? 10,
    })),
  );
  const mode = (code: string): ModeRef => {
    const m = modeRows.find((x) => x.code === code);
    if (!m) throw new Error(`scale seed: payment mode ${code} missing`);
    return { id: m.id, code: m.code, isCash: m.is_cash };
  };
  const flatTypes = flatTypeRows.map(({ r }) => flatTypeToDomain(r));
  return {
    id: companyId,
    domain: isDemo ? "sgb.in" : SCALE_COMPANY.domain,
    isDemo,
    fyStartMonth: company.fy_start_month,
    numbering: company.numbering,
    dueDays,
    slaHours: company.settings.sla_hours ?? { LOW: 72, MEDIUM: 48, HIGH: 24, URGENT: 8 },
    roles: Object.fromEntries(roleRows.map((r) => [r.name, r.id])) as Record<SystemRoleName, string>,
    masters: {
      stages: stages.map((s) => ({ id: s.id, name: s.name, isPossession: s.is_possession })),
      towerTypeId: tower.id,
      templates: templates.map((t) => ({
        id: t.id,
        flatsPerFloor: t.flats_per_floor,
        positions: t.positions.map((p) => ({
          position: p.position,
          flatTypeId: p.flat_type_id,
          facing: p.facing ?? null,
          isCorner: p.is_corner,
        })),
      })),
      templateIds: { standard: std.id, premium: premium.id },
      flatTypes,
      flatTypeNames: new Map(flatTypes.map((f) => [f.id, f.name])),
      plans,
      modes: {
        cash: mode("CASH"),
        upi: mode("UPI"),
        neft: mode("NEFT_RTGS"),
        loan: mode("LOAN_DISBURSEMENT"),
        cheque: mode("CHEQUE"),
      },
      bankId: banks[0]?.id ?? null,
      plc: {
        floorRise: plcRows.find((p) => p.code === "FLOOR_RISE")?.id ?? null,
        corner: plcRows.find((p) => p.code === "CORNER")?.id ?? null,
      },
      serviceCategories: cats.map((c) => ({ id: c.id, name: c.name, priority: c.default_priority })),
      amenityIds: amenities.map((a) => a.id),
    },
    staff: staffRows.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      allProjects: s.all_projects,
      projectIds: s.projects ?? [],
    })),
    seq: new Map(seqRows.map((s) => [`${s.scope}|${s.fy}`, Number(s.value)])),
    touched: new Set(),
  };
}
