import type { TestContext } from "../helpers.js";
import { createInventoryBasics, post, projectBody, towerCBody, type InventoryBasics } from "./inventory.js";

/** Everything the money tests build on: two projects (SGH, GGV), one tower each, modes, a bank account, charge types, plans and customers. */
export interface MoneyWorld {
  basics: InventoryBasics;
  /** Stage ids in master order: Excavation, Foundation, Plinth, 1st Slab, Top Slab, Brickwork, Plastering, Flooring, Possession. */
  stages: Record<
    | "EXCAVATION"
    | "FOUNDATION"
    | "PLINTH"
    | "FIRST_SLAB"
    | "TOP_SLAB"
    | "BRICKWORK"
    | "PLASTERING"
    | "FLOORING"
    | "POSSESSION",
    string
  >;
  /** A stage created after the projects, so no tower's stage sequence contains it. */
  alienStageId: string;
  sgh: {
    id: string;
    towerId: string;
    flats: Map<string, Flat>;
    towerUId: string;
    flatsU: Map<string, Flat>;
    parkingIds: string[];
  };
  ggv: { id: string; towerId: string; flats: Map<string, Flat> };
  modes: Record<"CASH" | "CHEQUE" | "NEFT" | "UPI", string>;
  bankAccountId: string;
  bankAccountNumber: string;
  charges: Record<"PARKING" | "REGISTRY" | "LEGAL", string>;
  plans: Record<"VILLA_CLP" | "FLEXI" | "DP", string>;
  customers: string[];
}

export interface Flat {
  id: string;
  flat_number: string;
  status: string;
  version: number;
  price_paise: number;
}

/** List price of every flat of the money world (₹1 Cr, the SPEC §11 worked example). */
export const LIST_PRICE_PAISE = 1_000_000_000;

/** Villa CLP cumulative 10/15/25/30/40/50/60/75/85/100 (SPEC §11 worked example). */
export function villaClpInstallments(s: MoneyWorld["stages"]) {
  return [
    { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
    { seq: 2, name: "Excavation", percent: 5, trigger_type: "ON_STAGE", trigger_stage_id: s.EXCAVATION },
    { seq: 3, name: "Foundation", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s.FOUNDATION },
    { seq: 4, name: "Plinth", percent: 5, trigger_type: "ON_STAGE", trigger_stage_id: s.PLINTH },
    { seq: 5, name: "1st Slab", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s.FIRST_SLAB },
    { seq: 6, name: "Top Slab", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s.TOP_SLAB },
    { seq: 7, name: "Brickwork", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s.BRICKWORK },
    { seq: 8, name: "Plastering", percent: 15, trigger_type: "ON_STAGE", trigger_stage_id: s.PLASTERING },
    { seq: 9, name: "Flooring", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s.FLOORING },
    { seq: 10, name: "Possession", percent: 15, trigger_type: "ON_POSSESSION" },
  ];
}

async function loadFlats(t: TestContext, token: string, blockId: string): Promise<Map<string, Flat>> {
  const r = await t.request<{ items: Flat[] }>(
    "GET",
    `/api/v1/flats?block_id=${blockId}&page_size=200&sort=flat_number`,
    { token },
  );
  if (r.status !== 200) throw new Error(`flats: ${r.text}`);
  return new Map(r.body.items.map((f) => [f.flat_number, f]));
}

let customerSeq = 0;
/** Inserts a customer row directly (the CRM module is built separately). */
export async function createCustomer(t: TestContext, name: string): Promise<string> {
  customerSeq += 1;
  const [row] = await t.app.sql<
    { id: string }[]
  >`insert into customers (company_id, customer_code, full_name, phone, address_current)
    values (${t.companyId}, ${`CUST-T/${String(customerSeq).padStart(4, "0")}`}, ${name}, ${`98765${String(10000 + customerSeq).slice(-5)}`}, ${JSON.stringify({ line1: "12 Boring Road", city: "Patna", state: "Bihar", pincode: "800001" })}::jsonb) returning id`;
  return row!.id;
}

/** Marks a tower stage COMPLETED on a date directly in block_stages (the construction module is built separately). */
export async function completeStage(
  t: TestContext,
  blockId: string,
  stageId: string,
  completedOn: string,
): Promise<void> {
  await t.app
    .sql`update block_stages set status = 'COMPLETED', completed_on = ${completedOn}, completed_at = now(), version = version + 1 where block_id = ${blockId} and stage_id = ${stageId}`;
}

/** Puts a tower stage back to PENDING (what the construction module does after a successful undo). */
export async function resetStage(t: TestContext, blockId: string, stageId: string): Promise<void> {
  await t.app
    .sql`update block_stages set status = 'PENDING', completed_on = null, completed_at = null, version = version + 1 where block_id = ${blockId} and stage_id = ${stageId}`;
}

export async function createMoneyWorld(t: TestContext, admin: string): Promise<MoneyWorld> {
  const basics = await createInventoryBasics(t, admin);
  const [excavation, foundation, plinth, topSlab] = basics.stageIds as [string, string, string, string, string];
  const extra: Record<string, string> = {};
  for (const [name, sort] of [
    ["1st Slab", 35],
    ["Brickwork", 50],
    ["Plastering", 60],
    ["Flooring", 70],
  ] as const) {
    extra[name] = (
      await post<{ id: string }>(t, admin, "/api/v1/masters/construction-stages", {
        name,
        code: name.toUpperCase().replace(/ /g, "_"),
        sort_order: sort,
      })
    ).id;
  }
  const stages: MoneyWorld["stages"] = {
    EXCAVATION: excavation,
    FOUNDATION: foundation,
    PLINTH: plinth,
    FIRST_SLAB: extra["1st Slab"]!,
    TOP_SLAB: topSlab,
    BRICKWORK: extra["Brickwork"]!,
    PLASTERING: extra["Plastering"]!,
    FLOORING: extra["Flooring"]!,
    POSSESSION: basics.possessionStageId,
  };

  const sgh = await post<{ id: string }>(t, admin, "/api/v1/projects", projectBody("Shree Ganesh Heights", "SGH"));
  const ggv = await post<{ id: string }>(t, admin, "/api/v1/projects", projectBody("Ganesh Green Villas", "GGV"));
  const towerA = await post<{ id: string }>(
    t,
    admin,
    "/api/v1/blocks",
    towerCBody(sgh.id, basics, {
      name: "Tower A",
      code: "A",
      floors: 3,
      skip_floors: [],
      refuge_floors: [],
      floor_plans: [{ from_floor: 1, to_floor: 3, floor_plan_template_id: basics.templates.FP4 }],
    }),
  );
  const towerU = await post<{ id: string }>(
    t,
    admin,
    "/api/v1/blocks",
    towerCBody(sgh.id, basics, {
      name: "Tower U",
      code: "U",
      floors: 2,
      skip_floors: [],
      refuge_floors: [],
      floor_plans: [{ from_floor: 1, to_floor: 2, floor_plan_template_id: basics.templates.FP4 }],
    }),
  );
  const towerG = await post<{ id: string }>(
    t,
    admin,
    "/api/v1/blocks",
    towerCBody(ggv.id, basics, {
      name: "Tower G",
      code: "G",
      floors: 2,
      skip_floors: [],
      refuge_floors: [],
      floor_plans: [{ from_floor: 1, to_floor: 2, floor_plan_template_id: basics.templates.FP4 }],
    }),
  );
  // Every money-world flat is listed at exactly ₹1 Cr so the tests' ₹1 Cr agreements are at list price (the agreement value guard of
  // POST /bookings rejects a deviation without agreement.edit + price_deviation_reason).
  await t.app
    .sql`update flats set price_paise = ${LIST_PRICE_PAISE}, rate_card_id = null, price_breakup = ${JSON.stringify([{ label: "Base price", amount_paise: LIST_PRICE_PAISE }])}::jsonb where project_id in (${sgh.id}, ${ggv.id})`;
  // created after the towers: no stage sequence contains it
  const alien = await post<{ id: string }>(t, admin, "/api/v1/masters/construction-stages", {
    name: "Landscaping",
    code: "LANDSCAPING",
    sort_order: 80,
  });

  await post(t, admin, `/api/v1/projects/${sgh.id}/parking/bulk-generate`, {
    project_id: sgh.id,
    prefix: "B1-",
    from_number: 1,
    to_number: 3,
    pad: 2,
    slot_type: "COVERED",
    level: "B1",
    price_paise: 30_000_000,
  });
  const parking = await t.request<{ items: { id: string; number: string }[] }>(
    "GET",
    `/api/v1/projects/${sgh.id}/parking?page_size=50&sort=number`,
    { token: admin },
  );
  if (parking.status !== 200) throw new Error(`parking: ${parking.text}`);

  const modes = {
    CASH: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/payment-modes", {
        name: "Cash",
        code: "CASH",
        is_cash: true,
        sort_order: 1,
      })
    ).id,
    CHEQUE: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/payment-modes", {
        name: "Cheque",
        code: "CHEQUE",
        requires_instrument: true,
        clears_immediately: false,
        sort_order: 2,
      })
    ).id,
    NEFT: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/payment-modes", {
        name: "NEFT/RTGS",
        code: "NEFT_RTGS",
        requires_instrument: true,
        sort_order: 3,
      })
    ).id,
    UPI: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/payment-modes", { name: "UPI", code: "UPI", sort_order: 4 })
    ).id,
  };
  const bankAccountNumber = "50100123456789";
  const bank = await post<{ id: string }>(t, admin, "/api/v1/masters/bank-accounts", {
    bank_name: "HDFC Bank",
    branch: "Boring Road",
    account_name: "Shree Ganesh Builders",
    account_number: bankAccountNumber,
    ifsc: "HDFC0000123",
    is_default: true,
  });
  const charges = {
    PARKING: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/charge-types", {
        name: "Car Parking",
        code: "PARKING",
        default_amount_paise: 30_000_000,
        is_taxable: true,
        default_gst_percent: 5,
        demand_at: "ON_BOOKING",
      })
    ).id,
    REGISTRY: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/charge-types", {
        name: "Registry & Stamp Duty",
        code: "REGISTRY",
        default_amount_paise: 25_000_000,
        demand_at: "ON_POSSESSION",
      })
    ).id,
    LEGAL: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/charge-types", {
        name: "Legal Charges",
        code: "LEGAL",
        default_amount_paise: 2_500_000,
        is_taxable: true,
        default_gst_percent: 18,
        demand_at: "MANUAL",
      })
    ).id,
  };
  const plans = {
    VILLA_CLP: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/payment-plans", {
        name: "Villa CLP",
        code: "VILLA_CLP",
        plan_type: "CONSTRUCTION_LINKED",
        installments: villaClpInstallments(stages),
      })
    ).id,
    FLEXI: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/payment-plans", {
        name: "Flexi 10:40:50",
        code: "FLEXI",
        plan_type: "FLEXI",
        installments: [
          { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
          { seq: 2, name: "60 days", percent: 40, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 60 },
          { seq: 3, name: "Top Slab", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: stages.TOP_SLAB },
          { seq: 4, name: "Brickwork", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: stages.BRICKWORK },
          { seq: 5, name: "Plastering", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: stages.PLASTERING },
          { seq: 6, name: "Flooring", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: stages.FLOORING },
          { seq: 7, name: "Possession", percent: 10, trigger_type: "ON_POSSESSION" },
        ],
      })
    ).id,
    DP: (
      await post<{ id: string }>(t, admin, "/api/v1/masters/payment-plans", {
        name: "Down Payment 10:85:5",
        code: "DP_10_85_5",
        plan_type: "DOWN_PAYMENT",
        installments: [
          { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
          { seq: 2, name: "30 days", percent: 85, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 30 },
          { seq: 3, name: "Possession", percent: 5, trigger_type: "ON_POSSESSION" },
        ],
      })
    ).id,
  };
  // assignments: Villa CLP is the default of both projects; Flexi and DP are also applicable on SGH
  await post(t, admin, "/api/v1/payment-plan-assignments", {
    plan_id: plans.VILLA_CLP,
    project_id: sgh.id,
    is_default: true,
  });
  await post(t, admin, "/api/v1/payment-plan-assignments", { plan_id: plans.FLEXI, project_id: sgh.id });
  await post(t, admin, "/api/v1/payment-plan-assignments", { plan_id: plans.DP, project_id: sgh.id });
  await post(t, admin, "/api/v1/payment-plan-assignments", {
    plan_id: plans.VILLA_CLP,
    project_id: ggv.id,
    is_default: true,
  });

  const customers: string[] = [];
  for (const name of [
    "Rajesh Kumar Sinha",
    "Priya Verma",
    "Amit Kumar",
    "Sunita Devi",
    "Vikram Singh",
    "Neha Gupta",
    "Manoj Prasad",
    "Anjali Sharma",
  ])
    customers.push(await createCustomer(t, name));

  return {
    basics,
    stages,
    alienStageId: alien.id,
    sgh: {
      id: sgh.id,
      towerId: towerA.id,
      flats: await loadFlats(t, admin, towerA.id),
      towerUId: towerU.id,
      flatsU: await loadFlats(t, admin, towerU.id),
      parkingIds: parking.body.items.map((p) => p.id),
    },
    ggv: { id: ggv.id, towerId: towerG.id, flats: await loadFlats(t, admin, towerG.id) },
    modes,
    bankAccountId: bank.id,
    bankAccountNumber,
    charges,
    plans,
    customers,
  };
}
