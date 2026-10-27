/**
 * Generators of the scale seed (docs/SEED.md "Production-size data"). Each section builds its rows in memory from the company context
 * and inserts them in batches (scaleLoad.ts) inside the caller's transaction, in FK order: staff → projects / towers / stages / rate cards / flats →
 * customers + portal logins → leads → bookings + demands + payments + ledgers → service requests → audit rows → sequences.
 */
import type { Sql } from "postgres";
import type { SystemRoleName } from "@kkt/contracts";
import type { PlanSnapshot } from "@kkt/db";
import {
  addDays,
  generateFlats,
  priceFlat,
  slaDueAt,
  slugify,
  toISTDateString,
  type FlatDraft,
  type RateCard,
  type TowerStage,
} from "@kkt/domain";
import { encryptField, keyedHash } from "../lib/crypto.js";
import { allocate, staffFor, type CompanyCtx, type StaffRef } from "./scaleCompany.js";
import { insertObjects, type LoadRow } from "./scaleLoad.js";
import {
  LOCALITIES,
  OCCUPATIONS,
  Rng,
  dateBetween,
  istAt,
  minDate,
  officeInstant,
  personName,
  seriesAadhaar,
  seriesPan,
  seriesPhone,
} from "./scaleData.js";
import {
  bookBooks,
  planDemands,
  planPayments,
  type ScaleBookingInput,
  type ScaleDemand,
  type ScalePayment,
} from "./scaleMoney.js";

/** Shared state of one load. */
export interface GenState {
  tx: Sql;
  rng: Rng;
  today: string;
  now: Date;
  /** Rows written per table. */
  written: Record<string, number>;
  /** Audit rows collected by every section, written last. */
  audit: LoadRow[];
  /** Back-dated audit rows are only written while no seal covers them (audit/seal.ts). */
  historicalAudit: boolean;
  log: (msg: string) => void;
}

/** Inserts object rows and records the count. */
export async function load(st: GenState, table: string, rows: readonly LoadRow[]): Promise<void> {
  if (rows.length === 0) return;
  st.written[table] = (st.written[table] ?? 0) + (await insertObjects(st.tx, table, rows));
}

/** Queues one audit row (same columns as lib/audit.ts writes; PII never in `after`). */
function audit(
  st: GenState,
  c: CompanyCtx,
  actor: { type: "STAFF" | "SYSTEM" | "CUSTOMER"; id: string | null; name: string },
  action: string,
  entity: { type: string; id: string },
  after: Record<string, unknown>,
  at: Date,
): void {
  st.audit.push({
    id: st.rng.uuid(),
    company_id: c.id,
    actor_type: actor.type,
    actor_id: actor.id,
    actor_name: actor.name,
    action,
    entity_type: entity.type,
    entity_id: entity.id,
    after,
    created_at: st.historicalAudit ? at : st.now,
  });
}

function pick<T>(rng: Rng, list: readonly T[], fallback: T): T {
  return list.length > 0 ? rng.pick(list) : fallback;
}

function byTime<T>(items: T[], at: (x: T) => Date): T[] {
  return items.sort((a, b) => at(a).getTime() - at(b).getTime());
}

function superAdmin(c: CompanyCtx): StaffRef {
  const a = c.staff.find((s) => s.role === "Super Admin");
  if (!a) throw new Error("scale seed: the company has no Super Admin");
  return a;
}

const roomsJson = (d: FlatDraft) =>
  d.roomsSnapshot.map((r) => ({
    room_type_id: r.roomTypeId,
    room_type_name: r.roomTypeName,
    label: r.label,
    length_ft: r.lengthFt,
    width_ft: r.widthFt,
    sqft: r.sqft,
  }));
const areasJson = (d: FlatDraft) =>
  d.areasSnapshot.map((a) => ({
    area_type_id: a.areaTypeId,
    area_type_code: a.areaTypeCode,
    area_type_name: a.areaTypeName,
    sqft: a.sqft,
  }));
const breakupJson = (d: FlatDraft) => d.priceBreakup.map((l) => ({ label: l.label, amount_paise: l.amountPaise }));

// ---------------------------------------------------------------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------------------------------------------------------------

const ROLE_MIX: readonly (readonly [SystemRoleName, number])[] = [
  ["Super Admin", 2],
  ["Project Admin", 12],
  ["Accounts", 15],
  ["Sales", 40],
  ["Marketing", 6],
  ["Employee", 25],
];
/** Share of each role scoped to 1–3 projects (the rest work on every project). */
const ROLE_SCOPED: Record<SystemRoleName, number> = {
  "Super Admin": 0,
  "Project Admin": 1,
  Accounts: 0.3,
  Sales: 0.6,
  Marketing: 0,
  Employee: 0.5,
};

/**
 * `count` staff logins (every role at least once, then the mix above), password SCALE_STAFF_PASSWORD, e-mails `<role>.<nnn>@<domain>`
 * (the scale company's first Super Admin is `admin@pid.in`); scoped users get 1–3 of the company's new projects. Returns the
 * user_project_scopes rows, loaded once the projects exist.
 */
export async function genStaff(
  st: GenState,
  c: CompanyCtx,
  count: number,
  projectIds: readonly string[],
  passwordHash: string,
): Promise<LoadRow[]> {
  const rng = st.rng.fork(`staff-${c.key}`);
  const roles: SystemRoleName[] = ROLE_MIX.map(([r]) => r);
  while (roles.length < count) roles.push(rng.weighted(ROLE_MIX));
  const perRole = new Map<SystemRoleName, number>();
  const users: LoadRow[] = [];
  const scopes: LoadRow[] = [];
  for (const role of roles) {
    const n = (perRole.get(role) ?? 0) + 1;
    perRole.set(role, n);
    const id = rng.uuid();
    const p = personName(rng);
    const name = `${p.first} ${p.last}`;
    const local = role.toLowerCase().replace(/[^a-z]+/g, "");
    const email =
      !c.isDemo && role === "Super Admin" && n === 1
        ? `admin@${c.domain}`
        : `${local}.${String(n).padStart(3, "0")}@${c.domain}`;
    const scoped = projectIds.length > 0 && rng.chance(ROLE_SCOPED[role]);
    const mine = scoped ? [...new Set(Array.from({ length: rng.int(1, 3) }, () => rng.pick(projectIds)))] : [];
    const created = new Date(st.now.getTime() - rng.int(30, 900) * 86_400_000);
    users.push({
      id,
      company_id: c.id,
      name,
      email,
      password_hash: passwordHash,
      role_id: c.roles[role],
      all_projects: !scoped,
      must_change_password: false,
      password_changed_at: created,
      created_at: created,
      updated_at: created,
    });
    for (const projectId of mine) scopes.push({ user_id: id, project_id: projectId, created_at: created });
    c.staff.push({ id, name, role, allProjects: !scoped, projectIds: mine });
  }
  await load(st, "users", users);
  return scopes;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Projects, towers, stages, rate cards, flats
// ---------------------------------------------------------------------------------------------------------------------------------

/** A generated project. */
export interface ProjectGen {
  id: string;
  code: string;
  name: string;
  launch: string;
  /** Days between two stage completions of a tower. */
  intervalDays: number;
  rateCard: RateCard;
  rateCardId: string;
  blocks: BlockGen[];
}

/** A generated tower. */
export interface BlockGen {
  id: string;
  code: string;
  floors: number;
  /** First floor of the FP-4-PREMIUM range (> floors: none). */
  premiumFrom: number;
  start: string;
  stagesDone: number;
  towerStages: TowerStage[];
  stageCompletedAt: Map<string, Date>;
  flats: FlatGen[];
}

/** A generated flat (the booking engine sets bookingId). */
export interface FlatGen {
  id: string;
  draft: FlatDraft;
  bookingId: string | null;
  bookedAt: Date | null;
  bookedBy: string | null;
}

/** Projects and towers of a company, in memory: stage progress by age, flats generated and priced by the domain engines. */
export function genProjects(
  st: GenState,
  c: CompanyCtx,
  names: readonly string[],
  codePrefix: string,
  blocksPerProject: number,
): ProjectGen[] {
  const rng = st.rng.fork(`projects-${c.key}`);
  const m = c.masters;
  return names.map((name, pi) => {
    const launch = addDays(st.today, -rng.int(150, 1650));
    const rateCard: RateCard = {
      rates: m.flatTypes.map((f) => ({
        flatTypeId: f.id,
        ratePerSqftPaise: (4_200 + rng.int(0, 30) * 100 + (f.code.startsWith("3") ? 400 : 0)) * 100,
        lumpSumPaise: null,
      })),
      plcRules: [
        ...(m.plc.floorRise
          ? [
              {
                plcTypeId: m.plc.floorRise,
                name: "Floor Rise",
                calcMode: "FLOOR_RISE" as const,
                value: 2_000,
                appliesTo: "ALL" as const,
              },
            ]
          : []),
        ...(m.plc.corner
          ? [
              {
                plcTypeId: m.plc.corner,
                name: "Corner",
                calcMode: "PER_SQFT" as const,
                value: 10_000,
                appliesTo: "CORNER" as const,
              },
            ]
          : []),
      ],
    };
    const project: ProjectGen = {
      id: rng.uuid(),
      code: `${codePrefix}${String(pi + 1).padStart(2, "0")}`,
      name,
      launch,
      intervalDays: rng.int(60, 110),
      rateCard,
      rateCardId: rng.uuid(),
      blocks: [],
    };
    for (let bi = 0; bi < blocksPerProject; bi++) project.blocks.push(genTower(rng, c, project, bi, pi, st.today));
    return project;
  });
}

function genTower(rng: Rng, c: CompanyCtx, p: ProjectGen, bi: number, pi: number, today: string): BlockGen {
  const m = c.masters;
  const code = `T${String(bi + 1).padStart(2, "0")}`;
  const floors = 24 + ((bi + pi) % 5);
  // phases of six towers, six months apart; a tower completes one stage every `intervalDays`
  const planned = addDays(p.launch, Math.floor(bi / 6) * 180 + rng.int(0, 40));
  const start = planned < today ? planned : addDays(today, -1);
  const elapsed = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  const stagesDone = Math.min(m.stages.length, Math.floor(Math.max(0, elapsed) / p.intervalDays));
  const towerStages: TowerStage[] = [];
  const stageCompletedAt = new Map<string, Date>();
  m.stages.forEach((s, i) => {
    const done = i < stagesDone;
    const completedOn = done ? addDays(start, (i + 1) * p.intervalDays) : null;
    towerStages.push({
      stageId: s.id,
      name: s.name,
      isPossession: s.isPossession,
      status: done ? "COMPLETED" : i === stagesDone ? "IN_PROGRESS" : "PENDING",
      completedOn,
    });
    if (completedOn) stageCompletedAt.set(s.id, istAt(completedOn, 17, rng.int(0, 59), rng.int(0, 59)));
  });
  const premiumFrom = bi % 3 === 0 ? floors - 3 : floors + 1;
  const drafts = generateFlats(
    {
      code,
      floors,
      floorStart: 1,
      skipFloors: [],
      refugeFloors: [],
      podiumFloors: [],
      floorPlans: [
        { fromFloor: 1, toFloor: Math.min(floors, premiumFrom - 1), floorPlanTemplateId: m.templateIds.standard },
        ...(premiumFrom <= floors
          ? [{ fromFloor: premiumFrom, toFloor: floors, floorPlanTemplateId: m.templateIds.premium }]
          : []),
      ],
      numberingPattern: "{block}-{floor}{pos2}",
    },
    m.templates,
    m.flatTypes,
    (ctx) =>
      priceFlat({
        flat: {
          floor: ctx.floor,
          floorStart: ctx.floorStart,
          superBuiltupSqft: ctx.flatType.superBuiltupSqft,
          isCorner: ctx.isCorner,
          facing: ctx.facing,
          flatTypeId: ctx.flatType.id,
        },
        rateCard: p.rateCard,
      }),
  );
  return {
    id: rng.uuid(),
    code,
    floors,
    premiumFrom,
    start,
    stagesDone,
    towerStages,
    stageCompletedAt,
    flats: drafts.map((draft) => ({ id: rng.uuid(), draft, bookingId: null, bookedAt: null, bookedBy: null })),
  };
}

/** Loads projects (+ website / visit settings, amenities, plan assignments, rate cards) and towers (+ stages). */
export async function loadProjects(st: GenState, c: CompanyCtx, projects: readonly ProjectGen[]): Promise<void> {
  const rng = st.rng.fork(`project-rows-${c.key}`);
  const admin = superAdmin(c);
  const m = c.masters;
  const rows: Record<string, LoadRow[]> = {
    projects: [],
    project_website_settings: [],
    project_visit_settings: [],
    project_amenities: [],
    rate_cards: [],
    rate_card_rates: [],
    rate_card_plc_rules: [],
    payment_plan_assignments: [],
    blocks: [],
    block_stages: [],
  };
  const defaultPlan = [...m.plans].sort((a, b) => b.weight - a.weight)[0]?.id;
  for (const p of projects) {
    const created = istAt(addDays(p.launch, -30), 11);
    const ready = p.blocks.every((b) => b.stagesDone === m.stages.length);
    rows["projects"]!.push({
      id: p.id,
      company_id: c.id,
      name: p.name,
      code: p.code,
      project_type: "RESIDENTIAL",
      status: ready ? "READY" : "UNDER_CONSTRUCTION",
      description: `${p.name}: ${p.blocks.length} towers of 2 and 3 BHK homes, Patna.`,
      address: {
        line1: `${p.name}, ${rng.pick(LOCALITIES)}`,
        city: "Patna",
        state: "Bihar",
        pincode: `8000${rng.int(10, 30)}`,
      },
      city: "Patna",
      rera_number: `BRERAP${rng.int(10_000, 99_999)}-${rng.int(1, 9)}/${p.launch.slice(2, 4)}`,
      launch_date: p.launch,
      possession_date: addDays(p.launch, p.intervalDays * m.stages.length + 200),
      escrow_bank_account_id: m.bankId,
      stage_sequence: m.stages.map((s) => s.id),
      block_count: p.blocks.length,
      created_by: admin.id,
      created_at: created,
      updated_at: created,
    });
    if (c.isDemo) {
      rows["project_website_settings"]!.push({
        project_id: p.id,
        is_published: true,
        slug: slugify(p.name),
        show_prices: true,
        show_availability: true,
        show_progress: true,
        highlights: ["Earthquake-resistant RCC frame", "24×7 power backup", "Clubhouse and pool"],
        published_at: istAt(p.launch, 10),
        created_by: admin.id,
        created_at: created,
        updated_at: created,
      });
      rows["project_visit_settings"]!.push({
        project_id: p.id,
        enabled: true,
        created_by: admin.id,
        created_at: created,
        updated_at: created,
      });
    }
    for (const amenityId of m.amenityIds.slice(0, 6))
      rows["project_amenities"]!.push({ project_id: p.id, amenity_id: amenityId, created_at: created });
    rows["rate_cards"]!.push({
      id: p.rateCardId,
      company_id: c.id,
      project_id: p.id,
      name: `${p.code} launch rates`,
      effective_from: p.launch,
      status: "ACTIVE",
      activated_at: created,
      created_by: admin.id,
      created_at: created,
      updated_at: created,
    });
    for (const r of p.rateCard.rates)
      rows["rate_card_rates"]!.push({
        id: rng.uuid(),
        rate_card_id: p.rateCardId,
        flat_type_id: r.flatTypeId,
        rate_per_sqft_paise: r.ratePerSqftPaise,
        created_at: created,
        updated_at: created,
      });
    p.rateCard.plcRules.forEach((r, i) =>
      rows["rate_card_plc_rules"]!.push({
        id: rng.uuid(),
        rate_card_id: p.rateCardId,
        plc_type_id: r.plcTypeId,
        calc_mode: r.calcMode,
        value: r.value,
        applies_to: r.appliesTo,
        sort_order: i + 1,
        created_at: created,
        updated_at: created,
      }),
    );
    for (const plan of m.plans)
      rows["payment_plan_assignments"]!.push({
        id: rng.uuid(),
        company_id: c.id,
        plan_id: plan.id,
        project_id: p.id,
        is_default: plan.id === defaultPlan,
        is_active: true,
        created_by: admin.id,
        created_at: created,
        updated_at: created,
      });
    p.blocks.forEach((b, bi) => {
      const complete = b.stagesDone === m.stages.length;
      rows["blocks"]!.push({
        id: b.id,
        company_id: c.id,
        project_id: p.id,
        block_type_id: m.towerTypeId,
        name: `Tower ${b.code}`,
        code: b.code,
        floors: b.floors,
        floor_start: 1,
        floor_plans: [
          {
            from_floor: 1,
            to_floor: Math.min(b.floors, b.premiumFrom - 1),
            floor_plan_template_id: m.templateIds.standard,
          },
          ...(b.premiumFrom <= b.floors
            ? [{ from_floor: b.premiumFrom, to_floor: b.floors, floor_plan_template_id: m.templateIds.premium }]
            : []),
        ],
        numbering_pattern: "{block}-{floor}{pos2}",
        stage_sequence: m.stages.map((s) => s.id),
        construction_percent: Math.round((b.stagesDone / m.stages.length) * 10_000) / 100,
        status: complete ? "READY" : b.stagesDone > 0 ? "UNDER_CONSTRUCTION" : "PLANNING",
        sort_order: bi + 1,
        created_by: admin.id,
        created_at: created,
        updated_at: created,
      });
      b.towerStages.forEach((s, i) => {
        const completedAt = b.stageCompletedAt.get(s.stageId) ?? null;
        const startedOn =
          s.status === "PENDING"
            ? null
            : minDate(
                s.completedOn ? addDays(s.completedOn, 5 - p.intervalDays) : addDays(b.start, i * p.intervalDays + 5),
                st.today,
              );
        rows["block_stages"]!.push({
          id: rng.uuid(),
          company_id: c.id,
          block_id: b.id,
          stage_id: s.stageId,
          sort_order: (i + 1) * 10,
          name: s.name,
          is_possession: s.isPossession,
          status: s.status,
          started_on: startedOn,
          completed_on: s.completedOn,
          completed_by: completedAt ? admin.id : null,
          completed_at: completedAt,
          created_at: created,
          updated_at: created,
        });
      });
    });
  }
  for (const [table, list] of Object.entries(rows)) await load(st, table, list);
}

/** Loads every flat (booked ones carry their booking) and refreshes the unit counts of the company's towers and projects. */
export async function loadFlats(st: GenState, c: CompanyCtx, projects: readonly ProjectGen[]): Promise<void> {
  const admin = superAdmin(c);
  const rows: LoadRow[] = [];
  for (const p of projects)
    for (const b of p.blocks)
      for (const f of b.flats) {
        const d = f.draft;
        const created = istAt(b.start, 12);
        rows.push({
          id: f.id,
          company_id: c.id,
          project_id: p.id,
          block_id: b.id,
          flat_number: d.flatNumber,
          floor: d.floor,
          floor_label: d.floorLabel,
          position: d.position,
          flat_type_id: d.flatTypeId,
          flat_type_code: d.flatTypeCode,
          facing: d.facing,
          is_corner: d.isCorner,
          status: f.bookingId ? "BOOKED" : "AVAILABLE",
          rooms_snapshot: roomsJson(d),
          areas_snapshot: areasJson(d),
          carpet_sqft: d.carpetSqft,
          builtup_sqft: d.builtupSqft,
          super_builtup_sqft: d.superBuiltupSqft,
          rate_per_sqft_paise: d.ratePerSqftPaise,
          price_paise: d.pricePaise,
          price_breakup: breakupJson(d),
          rate_card_id: p.rateCardId,
          booking_id: f.bookingId,
          status_changed_at: f.bookedAt,
          status_changed_by: f.bookedBy,
          created_by: admin.id,
          created_at: created,
          updated_at: f.bookedAt ?? created,
        });
      }
  await load(st, "flats", rows);
  const counts = (key: string) => `
    select ${key}, jsonb_build_object('available', count(*) filter (where status = 'AVAILABLE'), 'hold', count(*) filter (where status = 'HOLD'),
      'blocked', count(*) filter (where status = 'BLOCKED'), 'booked', count(*) filter (where status = 'BOOKED'),
      'sold', count(*) filter (where status = 'SOLD'), 'total', count(*)) as j
    from flats where company_id = $1 group by ${key}`;
  await st.tx.unsafe(`update blocks b set unit_counts = c.j from (${counts("block_id")}) c where c.block_id = b.id`, [
    c.id,
  ]);
  await st.tx.unsafe(
    `update projects p set unit_counts = c.j from (${counts("project_id")}) c where c.project_id = p.id`,
    [c.id],
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Customers and bookings (in memory), then their money
// ---------------------------------------------------------------------------------------------------------------------------------

/** A generated customer. */
export interface CustomerGen {
  id: string;
  company: CompanyCtx;
  /** Global index: phone, PAN and Aadhaar series position (unique across companies). */
  index: number;
  code: string;
  name: ReturnType<typeof personName>;
  phone: string;
  createdAt: Date;
  /** Relationship manager (a Sales user), also the creator. */
  rm: StaffRef;
  kyc: "PENDING" | "SUBMITTED" | "VERIFIED";
}

/** A generated booking with its money. */
export interface BookingGen {
  id: string;
  company: CompanyCtx;
  project: ProjectGen;
  block: BlockGen;
  flat: FlatGen;
  customer: CustomerGen;
  number: string;
  bookingDate: string;
  createdAt: Date;
  sales: StaffRef;
  plan: { id: string; snapshot: PlanSnapshot };
  cashAgreed: number;
  accountAgreed: number;
  leadId: string | null;
  demands: ScaleDemand[];
  payments: ScalePayment[];
}

/** Global customer counter (phone / PAN / Aadhaar series). */
export interface Counter {
  next: number;
}

function genCustomer(
  rng: Rng,
  c: CompanyCtx,
  counter: Counter,
  createdAt: Date,
  projectId: string | null,
): CustomerGen {
  const rm = pick(rng, staffFor(c, "Sales", projectId), superAdmin(c));
  const index = counter.next++;
  return {
    id: rng.uuid(),
    company: c,
    index,
    code: "",
    name: personName(rng),
    phone: seriesPhone("customer", index),
    createdAt,
    rm,
    kyc: rng.weighted([
      ["VERIFIED", 60],
      ["SUBMITTED", 15],
      ["PENDING", 25],
    ] as const),
  };
}

/**
 * Bookings of a company: `count` flats spread over the towers (older towers sell more), each booked by a new customer created shortly
 * before, on the project's plans by weight, agreement = list price split into Cash (0–30 %, whole ₹10,000) and Account. Then the money:
 * demands from the dues engine and payments against them (scaleMoney.ts). Customer, booking, demand and receipt numbers are allocated
 * in posting order. Returns the bookings and every customer of the company (bookers + `prospects` without a booking).
 */
export function genBookings(
  st: GenState,
  c: CompanyCtx,
  projects: readonly ProjectGen[],
  count: number,
  prospects: number,
  counter: Counter,
): { bookings: BookingGen[]; customers: CustomerGen[] } {
  const rng = st.rng.fork(`bookings-${c.key}`);
  const towers = projects.flatMap((p) =>
    p.blocks.map((b) => ({ p, b, w: (0.5 + rng.next()) * (1 + b.stagesDone / 7) })),
  );
  const totalWeight = towers.reduce((s, x) => s + x.w, 0);
  const quotas = towers.map((x) => ({ ...x, q: Math.min(x.b.flats.length, Math.round((count * x.w) / totalWeight)) }));
  let remaining = count - quotas.reduce((s, x) => s + x.q, 0);
  for (let i = 0; remaining !== 0 && i < quotas.length * 50; i++) {
    const x = quotas[i % quotas.length]!;
    if (remaining > 0 && x.q < x.b.flats.length) {
      x.q += 1;
      remaining -= 1;
    } else if (remaining < 0 && x.q > 0) {
      x.q -= 1;
      remaining += 1;
    }
  }
  const bookings: BookingGen[] = [];
  for (const { p, b, q } of quotas)
    for (const flat of rng.shuffle([...b.flats]).slice(0, q)) {
      const bookingDate = dateBetween(rng, b.start, addDays(st.today, -2));
      const createdAt = officeInstant(rng, bookingDate);
      const sales = pick(rng, staffFor(c, "Sales", p.id), superAdmin(c));
      const plan = rng.weighted(c.masters.plans.map((x) => [x, x.weight] as const));
      const price = flat.draft.pricePaise;
      const cashAgreed = Math.round((price * rng.pick([0, 0.1, 0.15, 0.2, 0.25, 0.3])) / 10_000_00) * 10_000_00;
      const customer = genCustomer(rng, c, counter, officeInstant(rng, addDays(bookingDate, -rng.int(1, 25))), p.id);
      const id = rng.uuid();
      flat.bookingId = id;
      flat.bookedAt = createdAt;
      flat.bookedBy = sales.id;
      bookings.push({
        id,
        company: c,
        project: p,
        block: b,
        flat,
        customer,
        number: "",
        bookingDate,
        createdAt,
        sales,
        plan: { id: plan.id, snapshot: plan.snapshot },
        cashAgreed,
        accountAgreed: price - cashAgreed,
        leadId: null,
        demands: [],
        payments: [],
      });
    }
  const customers = bookings.map((b) => b.customer);
  for (let i = 0; i < prospects; i++)
    customers.push(genCustomer(rng, c, counter, officeInstant(rng, addDays(st.today, -rng.int(1, 1100))), null));
  for (const cu of byTime([...customers], (x) => x.createdAt))
    cu.code = allocate(c, "customer", toISTDateString(cu.createdAt), "CUST-");
  for (const bk of byTime([...bookings], (x) => x.createdAt)) bk.number = allocate(c, "booking", bk.bookingDate, "BK-");
  const mrng = st.rng.fork(`money-${c.key}`);
  for (const bk of bookings) {
    const input: ScaleBookingInput = {
      id: bk.id,
      bookingDate: bk.bookingDate,
      createdAt: bk.createdAt,
      cashAgreedPaise: bk.cashAgreed,
      accountAgreedPaise: bk.accountAgreed,
      planSnapshot: bk.plan.snapshot,
      towerStages: bk.block.towerStages,
      stageCompletedAt: bk.block.stageCompletedAt,
      today: st.today,
      now: st.now,
      defaultDueDays: c.dueDays,
    };
    bk.demands = planDemands(mrng, input);
    bk.payments = planPayments(mrng, input, bk.demands, c.masters.modes);
  }
  for (const d of byTime(
    bookings.flatMap((bk) => bk.demands),
    (x) => x.postedAt,
  ))
    d.demandNumber = allocate(c, "demand", d.raisedOn, "DM-");
  for (const pay of byTime(
    bookings.flatMap((bk) => bk.payments),
    (x) => x.postedAt,
  ))
    pay.receiptNumber = allocate(c, "receipt", pay.paymentDate, "RCPT/");
  return { bookings, customers };
}

/** Loads customers (KYC encrypted + keyed hashes, as crm/customerService.ts stores them) and one portal login each. */
export async function loadCustomers(
  st: GenState,
  customers: readonly CustomerGen[],
  portalHash: string,
): Promise<void> {
  const rng = st.rng.fork("customers");
  const rows: LoadRow[] = [];
  const portal: LoadRow[] = [];
  for (const cu of customers) {
    const c = cu.company;
    const n = cu.name;
    const withKyc = cu.kyc !== "PENDING";
    const pan = withKyc ? seriesPan(cu.index, n.last[0] ?? "K") : null;
    const aadhaar = withKyc ? seriesAadhaar(cu.index) : null;
    const verifier = superAdmin(c);
    const verifiedAt = cu.kyc === "VERIFIED" ? new Date(cu.createdAt.getTime() + 86_400_000) : null;
    rows.push({
      id: cu.id,
      company_id: c.id,
      customer_code: cu.code,
      salutation: n.salutation,
      full_name: `${n.first} ${n.last}`,
      father_or_spouse_name: `${rng.pick(["Ramesh", "Shyam", "Mohan", "Hari", "Gopal"])} ${n.last}`,
      dob: `${rng.int(1960, 1995)}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
      gender: n.gender,
      phone: cu.phone,
      email: `${n.first.toLowerCase()}.${n.last.toLowerCase()}.${cu.index}@example.in`,
      address_current: {
        line1: `House ${rng.int(1, 400)}, ${rng.pick(LOCALITIES)}`,
        city: "Patna",
        state: "Bihar",
        pincode: `8000${rng.int(10, 30)}`,
      },
      same_as_current: true,
      occupation: rng.pick(OCCUPATIONS),
      source: rng.pick(["WALK_IN", "WEBSITE", "REFERRAL", "BROKER", "CAMPAIGN"] as const),
      relationship_manager_id: cu.rm.id,
      pan_enc: pan ? encryptField(pan) : null,
      pan_hash: pan ? keyedHash(pan) : null,
      pan_last4: pan ? pan.slice(-4) : null,
      aadhaar_enc: aadhaar ? encryptField(aadhaar) : null,
      aadhaar_hash: aadhaar ? keyedHash(aadhaar) : null,
      aadhaar_last4: aadhaar ? aadhaar.slice(-4) : null,
      kyc_status: cu.kyc,
      kyc_submitted_by: withKyc ? cu.rm.id : null,
      kyc_submitted_at: withKyc ? new Date(cu.createdAt.getTime() + 3_600_000) : null,
      kyc_verified_by: verifiedAt ? verifier.id : null,
      kyc_verified_at: verifiedAt,
      created_by: cu.rm.id,
      created_at: cu.createdAt,
      updated_at: verifiedAt ?? cu.createdAt,
    });
    portal.push({
      id: rng.uuid(),
      company_id: c.id,
      customer_id: cu.id,
      phone: cu.phone,
      password_hash: portalHash,
      must_change_password: false,
      is_enabled: true,
      enabled_by: verifier.id,
      enabled_at: cu.createdAt,
      created_at: cu.createdAt,
      updated_at: cu.createdAt,
    });
    audit(
      st,
      c,
      { type: "STAFF", id: cu.rm.id, name: cu.rm.name },
      "customer.create",
      { type: "customer", id: cu.id },
      { customer_code: cu.code },
      cu.createdAt,
    );
  }
  await load(st, "customers", rows);
  await load(st, "portal_users", portal);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------------------------------------------------------------

const LOST_REASONS = [
  "Budget mismatch",
  "Bought elsewhere",
  "Location not suitable",
  "Not reachable",
  "Plan postponed",
];
const LEAD_SOURCES = ["WALK_IN", "WEBSITE", "BROCHURE", "SITE_VISIT", "REFERRAL", "BROKER", "CAMPAIGN"] as const;

/** Global lead phone counter. */
export const leadPhones: Counter = { next: 0 };

/**
 * `count` leads of a company: up to 40 % of its bookings came from a lead (CONVERTED, linked to the customer and the booking — the
 * booking's lead_id is set here, before the bookings are written), the rest open or lost across the pipeline stages; one stage-history
 * row per stage change.
 */
export async function loadLeads(
  st: GenState,
  c: CompanyCtx,
  projects: readonly ProjectGen[],
  bookings: readonly BookingGen[],
  count: number,
): Promise<void> {
  const rng = st.rng.fork(`leads-${c.key}`);
  interface LeadGen {
    id: string;
    createdAt: Date;
    stage: string;
    projectId: string | null;
    name: string;
    phone: string;
    source: string;
    assigned: StaffRef;
    customerId: string | null;
    bookingId: string | null;
    lastActivity: Date;
  }
  const leads: LeadGen[] = [];
  for (const bk of bookings) {
    if (leads.length >= Math.floor(count / 2) || !rng.chance(0.4)) continue;
    const id = rng.uuid();
    bk.leadId = id;
    leads.push({
      id,
      createdAt: new Date(bk.customer.createdAt.getTime() - rng.int(5, 60) * 86_400_000),
      stage: "CONVERTED",
      projectId: bk.project.id,
      name: `${bk.customer.name.first} ${bk.customer.name.last}`,
      phone: bk.customer.phone,
      source: rng.pick(["WALK_IN", "WEBSITE", "REFERRAL", "BROKER", "SITE_VISIT"]),
      assigned: bk.sales,
      customerId: bk.customer.id,
      bookingId: bk.id,
      lastActivity: bk.createdAt,
    });
  }
  while (leads.length < count) {
    const project = projects.length > 0 && rng.chance(0.9) ? rng.pick(projects) : null;
    const stage = rng.weighted([
      ["NEW", 18],
      ["CONTACTED", 22],
      ["SITE_VISIT_SCHEDULED", 6],
      ["SITE_VISIT_DONE", 10],
      ["NEGOTIATION", 6],
      ["LOST", 38],
    ] as const);
    const createdAt = officeInstant(rng, addDays(st.today, stage === "NEW" ? -rng.int(0, 45) : -rng.int(10, 730)));
    const p = personName(rng);
    leads.push({
      id: rng.uuid(),
      createdAt,
      stage,
      projectId: project?.id ?? null,
      name: `${p.first} ${p.last}`,
      phone: seriesPhone("lead", leadPhones.next++),
      source: rng.pick(LEAD_SOURCES),
      assigned: pick(rng, staffFor(c, "Sales", project?.id ?? null), superAdmin(c)),
      customerId: null,
      bookingId: null,
      lastActivity:
        stage === "NEW"
          ? createdAt
          : new Date(Math.min(st.now.getTime(), createdAt.getTime() + rng.int(1, 40) * 86_400_000)),
    });
  }
  const rows: LoadRow[] = [];
  const history: LoadRow[] = [];
  for (const l of byTime(leads, (x) => x.createdAt)) {
    const number = allocate(c, "lead", toISTDateString(l.createdAt), "LD-");
    const open = l.stage !== "CONVERTED" && l.stage !== "LOST";
    rows.push({
      id: l.id,
      company_id: c.id,
      lead_number: number,
      full_name: l.name,
      phone: l.phone,
      project_id: l.projectId,
      source: l.source,
      stage: l.stage,
      previous_stage: l.stage === "LOST" ? rng.pick(["CONTACTED", "SITE_VISIT_DONE", "NEGOTIATION"]) : null,
      lost_reason: l.stage === "LOST" ? rng.pick(LOST_REASONS) : null,
      assigned_user_id: l.assigned.id,
      customer_id: l.customerId,
      booking_id: l.bookingId,
      utm: l.source === "CAMPAIGN" ? { utm_source: "facebook", utm_campaign: "festive-offer" } : null,
      next_follow_up_at: open && rng.chance(0.5) ? new Date(st.now.getTime() + rng.int(1, 14) * 86_400_000) : null,
      is_read: l.stage !== "NEW" || rng.chance(0.5),
      consent: l.source === "WEBSITE" || l.source === "BROCHURE",
      last_activity_at: l.lastActivity,
      created_by: l.assigned.id,
      created_at: l.createdAt,
      updated_at: l.lastActivity,
    });
    history.push({
      id: rng.uuid(),
      lead_id: l.id,
      from_stage: null,
      to_stage: "NEW",
      by_user_id: l.assigned.id,
      at: l.createdAt,
    });
    if (l.stage !== "NEW")
      history.push({
        id: rng.uuid(),
        lead_id: l.id,
        from_stage: "NEW",
        to_stage: l.stage,
        by_user_id: l.assigned.id,
        at: l.lastActivity,
      });
    audit(
      st,
      c,
      { type: "STAFF", id: l.assigned.id, name: l.assigned.name },
      "lead.create",
      { type: "lead", id: l.id },
      { lead_number: number, source: l.source },
      l.createdAt,
    );
  }
  await load(st, "leads", rows);
  await load(st, "lead_stage_history", history);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Books: bookings, demands, payments, ledger rows
// ---------------------------------------------------------------------------------------------------------------------------------

/** Writes the bookings with the books the ledger engine derives for them (scaleMoney.bookBooks). */
export async function loadBooks(st: GenState, bookings: readonly BookingGen[]): Promise<void> {
  const rng = st.rng.fork("books");
  const rows: Record<"bookings" | "demands" | "payments" | "ledger_entries", LoadRow[]> = {
    bookings: [],
    demands: [],
    payments: [],
    ledger_entries: [],
  };
  for (const bk of bookings) {
    const c = bk.company;
    const books = bookBooks(
      { cashAgreedPaise: bk.cashAgreed, accountAgreedPaise: bk.accountAgreed },
      bk.demands,
      bk.payments,
    );
    const s = books.summary;
    const d = bk.flat.draft;
    rows.bookings.push({
      id: bk.id,
      company_id: c.id,
      booking_number: bk.number,
      project_id: bk.project.id,
      block_id: bk.block.id,
      flat_id: bk.flat.id,
      customer_id: bk.customer.id,
      booking_date: bk.bookingDate,
      status: "ACTIVE",
      agreement_value_paise: d.pricePaise,
      cash_agreed_paise: bk.cashAgreed,
      account_agreed_paise: bk.accountAgreed,
      list_price_paise: d.pricePaise,
      // the snapshot createBooking takes (money/services/bookings.ts)
      flat_snapshot: {
        flat_number: d.flatNumber,
        floor: d.floor,
        floor_label: d.floorLabel,
        flat_type_id: d.flatTypeId,
        flat_type_code: d.flatTypeCode,
        flat_type_name: c.masters.flatTypeNames.get(d.flatTypeId) ?? d.flatTypeCode,
        facing: d.facing,
        carpet_sqft: d.carpetSqft,
        builtup_sqft: d.builtupSqft,
        super_builtup_sqft: d.superBuiltupSqft,
        price_paise: d.pricePaise,
        price_breakup: breakupJson(d),
        rooms: roomsJson(d),
        areas: areasJson(d),
      },
      rate_per_sqft_paise: d.ratePerSqftPaise,
      payment_plan_id: bk.plan.id,
      plan_snapshot: bk.plan.snapshot,
      plan_accepted_on: bk.bookingDate,
      plan_acceptance_mode: "IN_PERSON",
      sales_user_id: bk.sales.id,
      lead_id: bk.leadId,
      raised_percent: books.raisedPercent,
      cash_order_raised_paise: s.cashOrderRaisedPaise,
      account_order_raised_paise: s.accountOrderRaisedPaise,
      cash_paid_paise: s.cashPaidPaise,
      account_paid_paise: s.accountPaidPaise,
      other_charges_demanded_paise: s.otherChargesDemandedPaise,
      other_charges_paid_paise: s.otherChargesPaidPaise,
      pending_cheques_paise: books.pendingChequesPaise,
      last_payment_at: books.lastPaymentAt,
      ledger_epoch: 1,
      created_by: bk.sales.id,
      created_at: bk.createdAt,
      updated_at: books.lastPaymentAt ?? bk.createdAt,
    });
    audit(
      st,
      c,
      { type: "STAFF", id: bk.sales.id, name: bk.sales.name },
      "booking.create",
      { type: "booking", id: bk.id },
      {
        booking_number: bk.number,
        flat_id: bk.flat.id,
        flat_number: d.flatNumber,
        customer_id: bk.customer.id,
        agreement_value_paise: d.pricePaise,
        cash_agreed_paise: bk.cashAgreed,
        account_agreed_paise: bk.accountAgreed,
        payment_plan_id: bk.plan.id,
      },
      bk.createdAt,
    );
    bk.demands.forEach((dm, i) => {
      const status = books.demandStatus[i]!;
      rows.demands.push({
        id: dm.id,
        company_id: c.id,
        booking_id: bk.id,
        project_id: bk.project.id,
        block_id: bk.block.id,
        customer_id: bk.customer.id,
        demand_number: dm.demandNumber,
        installment_seq: dm.seq,
        installment_name: dm.name,
        trigger_type: dm.triggerType,
        trigger_label: dm.triggerLabel,
        trigger_stage_id: dm.triggerStageId,
        percent: dm.percent,
        cumulative_percent: dm.cumulativePercent,
        cash_demand_paise: dm.cashPaise,
        account_demand_paise: dm.accountPaise,
        total_demand_paise: dm.totalPaise,
        demand_date: dm.demandDate,
        due_date: dm.dueDate,
        status: status.status,
        paid_paise: status.paidPaise,
        posted_at: dm.postedAt,
        created_at: dm.postedAt,
        updated_at: dm.postedAt,
      });
      audit(
        st,
        c,
        { type: "SYSTEM", id: null, name: "dues" },
        "demand.raise",
        { type: "demand", id: dm.id },
        {
          demand_number: dm.demandNumber,
          booking_id: bk.id,
          installment_seq: dm.seq,
          cash_demand_paise: dm.cashPaise,
          account_demand_paise: dm.accountPaise,
          due_date: dm.dueDate,
        },
        dm.postedAt,
      );
    });
    const accounts = staffFor(c, "Accounts", bk.project.id);
    for (const p of bk.payments) {
      const by = pick(rng, accounts, bk.sales);
      rows.payments.push({
        id: p.id,
        company_id: c.id,
        booking_id: bk.id,
        project_id: bk.project.id,
        block_id: bk.block.id,
        customer_id: bk.customer.id,
        receipt_number: p.receiptNumber,
        against: "FLAT_VALUE",
        bucket: p.bucket,
        amount_paise: p.amountPaise,
        payment_date: p.paymentDate,
        payment_mode_id: p.mode.id,
        mode_code: p.mode.code,
        instrument: p.instrument,
        bank_account_id: p.mode.isCash ? null : c.masters.bankId,
        received_by: by.id,
        status: p.status,
        cleared_at: p.clearedAt,
        cleared_by: p.clearedAt ? by.id : null,
        bounced_at: p.bouncedAt,
        bounced_by: p.bouncedAt ? by.id : null,
        bounce_reason: p.bounceReason,
        posted_at: p.postedAt,
        created_by: by.id,
        created_at: p.postedAt,
        updated_at: p.clearedAt ?? p.bouncedAt ?? p.postedAt,
      });
      const actor = { type: "STAFF" as const, id: by.id, name: by.name };
      const ref = { type: "payment", id: p.id };
      audit(
        st,
        c,
        actor,
        "payment.post",
        ref,
        {
          receipt_number: p.receiptNumber,
          booking_id: bk.id,
          against: "FLAT_VALUE",
          bucket: p.bucket,
          amount_paise: p.amountPaise,
          payment_date: p.paymentDate,
          mode_code: p.mode.code,
          status: p.mode.code === "CHEQUE" ? "PENDING" : "CLEARED",
        },
        p.postedAt,
      );
      if (p.mode.code === "CHEQUE" && p.clearedAt)
        audit(st, c, actor, "payment.clear", ref, { receipt_number: p.receiptNumber, status: "CLEARED" }, p.clearedAt);
      if (p.bouncedAt)
        audit(
          st,
          c,
          actor,
          "payment.bounce",
          ref,
          { receipt_number: p.receiptNumber, status: "BOUNCED", reason: p.bounceReason },
          p.bouncedAt,
        );
    }
    for (const r of books.rows)
      rows.ledger_entries.push({
        id: rng.uuid(),
        company_id: c.id,
        booking_id: bk.id,
        epoch: 1,
        seq: r.seq,
        at: new Date(r.at),
        entry_date: r.entryDate,
        event: r.event,
        label: r.label,
        bucket: r.bucket,
        amount_paise: r.amountPaise,
        cash_paid_cum_paise: r.cashPaidCumPaise,
        account_paid_cum_paise: r.accountPaidCumPaise,
        cash_order_raised_paise: r.cashOrderRaisedPaise,
        account_order_raised_paise: r.accountOrderRaisedPaise,
        cash_due_paise: r.cashDuePaise,
        account_due_paise: r.accountDuePaise,
        total_due_paise: r.totalDuePaise,
        other_charges_due_paise: r.otherChargesDuePaise,
        ref_number: r.refNumber,
        ref_id: r.refId,
        note: r.note,
        created_at: new Date(r.at),
      });
  }
  await load(st, "bookings", rows.bookings);
  await load(st, "demands", rows.demands);
  await load(st, "payments", rows.payments);
  await load(st, "ledger_entries", rows.ledger_entries);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Service requests
// ---------------------------------------------------------------------------------------------------------------------------------

const SUBJECTS = [
  "Need a copy of the latest demand letter",
  "Receipt not received for last payment",
  "Construction progress photos for my tower",
  "Request to update my e-mail address",
  "Seepage in balcony after rain",
  "When is the next slab due?",
  "Bank loan disbursement letter required",
  "Possession date confirmation",
  "Agreement copy for bank",
  "Parking allotment query",
] as const;

type TicketStatus = "NEW" | "IN_PROGRESS" | "AWAITING_CUSTOMER" | "RESOLVED" | "CLOSED";

/**
 * `count` service requests of a company's buyers (a quarter raised in the last 30 days), status by age, SLA as ticketService sets it:
 * due = created + the priority's hours (domain slaDueAt), breached when an open ticket — or one resolved late — passed the deadline,
 * paused while AWAITING_CUSTOMER; an opening message (70 % from the portal), a staff reply and a resolution message.
 */
export async function loadTickets(
  st: GenState,
  c: CompanyCtx,
  bookings: readonly BookingGen[],
  count: number,
): Promise<void> {
  if (bookings.length === 0 || c.masters.serviceCategories.length === 0) return;
  const rng = st.rng.fork(`tickets-${c.key}`);
  const now = st.now.getTime();
  const created: { id: string; bk: BookingGen; at: Date }[] = [];
  for (let i = 0; i < count; i++) {
    const bk = rng.pick(bookings);
    const from = bk.createdAt.getTime() + 60_000;
    const ms = rng.chance(0.25) ? now - rng.int(1, 30 * 24) * 3_600_000 : from + rng.next() * (now - from);
    created.push({ id: rng.uuid(), bk, at: new Date(Math.max(from, Math.min(ms, now - 60_000))) });
  }
  const rows: LoadRow[] = [];
  const messages: LoadRow[] = [];
  for (const t of byTime(created, (x) => x.at)) {
    const number = allocate(c, "ticket", toISTDateString(t.at), "SR-");
    const cat = rng.pick(c.masters.serviceCategories);
    const priority = rng.chance(0.15) ? rng.pick(["HIGH", "URGENT", "LOW"] as const) : cat.priority;
    const ageHours = (now - t.at.getTime()) / 3_600_000;
    const status: TicketStatus =
      ageHours < 72
        ? rng.weighted<TicketStatus>([
            ["NEW", 40],
            ["IN_PROGRESS", 35],
            ["AWAITING_CUSTOMER", 10],
            ["RESOLVED", 15],
          ])
        : ageHours < 24 * 30
          ? rng.weighted<TicketStatus>([
              ["NEW", 5],
              ["IN_PROGRESS", 20],
              ["AWAITING_CUSTOMER", 10],
              ["RESOLVED", 30],
              ["CLOSED", 35],
            ])
          : rng.weighted<TicketStatus>([
              ["IN_PROGRESS", 2],
              ["RESOLVED", 8],
              ["CLOSED", 90],
            ]);
    const due = new Date(slaDueAt(t.at, priority, c.slaHours));
    const assignee = status === "NEW" ? null : pick(rng, staffFor(c, "Employee", t.bk.project.id), t.bk.sales);
    const fromPortal = rng.chance(0.7);
    const reply = new Date(Math.min(now - 90_000, t.at.getTime() + rng.int(1, 30) * 3_600_000));
    const resolvedAt =
      status === "RESOLVED" || status === "CLOSED"
        ? new Date(
            Math.max(reply.getTime() + 1_000, Math.min(now - 60_000, t.at.getTime() + rng.int(2, 120) * 3_600_000)),
          )
        : null;
    const closedAt =
      status === "CLOSED" && resolvedAt
        ? new Date(Math.min(now - 30_000, resolvedAt.getTime() + rng.int(1, 72) * 3_600_000))
        : null;
    const pausedAt =
      status === "AWAITING_CUSTOMER" ? new Date(Math.min(reply.getTime(), due.getTime() - 60_000)) : null;
    const breached =
      ((status === "NEW" || status === "IN_PROGRESS") && due.getTime() < now) ||
      (resolvedAt !== null && resolvedAt.getTime() > due.getTime()) ||
      (pausedAt !== null && pausedAt.getTime() > due.getTime());
    const subject = rng.pick(SUBJECTS);
    const body = `${subject}. Booking ${t.bk.number}, flat ${t.bk.flat.draft.flatNumber}.`;
    const customerName = `${t.bk.customer.name.first} ${t.bk.customer.name.last}`;
    const opener = fromPortal
      ? { type: "CUSTOMER" as const, id: t.bk.customer.id, name: customerName }
      : { type: "STAFF" as const, id: t.bk.sales.id, name: t.bk.sales.name };
    const thread: {
      author: { type: "STAFF" | "CUSTOMER"; id: string | null; name: string };
      body: string;
      at: Date;
    }[] = [{ author: opener, body, at: t.at }];
    if (assignee && reply.getTime() > t.at.getTime())
      thread.push({
        author: { type: "STAFF", id: assignee.id, name: assignee.name },
        body:
          status === "AWAITING_CUSTOMER"
            ? "Could you please share your booking documents so we can proceed?"
            : "Thank you, we are looking into this.",
        at: pausedAt ?? reply,
      });
    if (resolvedAt)
      thread.push({
        author: { type: "STAFF", id: assignee?.id ?? null, name: assignee?.name ?? "Support" },
        body: "This has been resolved. Please let us know if anything else is needed.",
        at: resolvedAt,
      });
    const last = thread[thread.length - 1]!.at;
    rows.push({
      id: t.id,
      company_id: c.id,
      ticket_number: number,
      customer_id: t.bk.customer.id,
      booking_id: t.bk.id,
      category_id: cat.id,
      priority,
      subject,
      description: body,
      status,
      assignee_user_id: assignee?.id ?? null,
      sla_due_at: due,
      sla_breached_at: breached ? new Date(due.getTime() + 5 * 60_000) : null,
      sla_paused_at: pausedAt,
      resolved_at: resolvedAt,
      closed_at: closedAt,
      rating: status === "CLOSED" && rng.chance(0.6) ? rng.int(3, 5) : null,
      last_message_at: last,
      created_by: fromPortal ? null : t.bk.sales.id,
      created_at: t.at,
      updated_at: closedAt ?? last,
    });
    for (const m of thread)
      messages.push({
        id: rng.uuid(),
        ticket_id: t.id,
        author_type: m.author.type,
        author_id: m.author.id,
        author_name: m.author.name,
        body: m.body,
        is_internal: false,
        created_at: m.at,
      });
    audit(
      st,
      c,
      opener,
      "service_request.create",
      { type: "service_request", id: t.id },
      { ticket_number: number, status: "NEW", priority },
      t.at,
    );
  }
  await load(st, "service_requests", rows);
  await load(st, "service_request_messages", messages);
}

/** Writes the queued audit rows (in time order) and advances every sequence the load allocated from. */
export async function finish(st: GenState, companies: readonly CompanyCtx[]): Promise<void> {
  await load(
    st,
    "audit_logs",
    byTime(st.audit, (r) => r["created_at"] as Date),
  );
  for (const c of companies)
    for (const key of c.touched) {
      const [scope, fy] = key.split("|") as [string, string];
      await st.tx.unsafe(
        `insert into sequences (company_id, scope, fy, value) values ($1, $2, $3, $4)
         on conflict (company_id, scope, fy) do update set value = greatest(sequences.value, excluded.value)`,
        [c.id, scope, fy, c.seq.get(key) ?? 0],
      );
    }
}
