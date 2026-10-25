import type { TestContext } from "../helpers.js";
import { createInventoryBasics, post, projectBody, towerCBody, type InventoryBasics } from "./inventory.js";
import { createCustomer, type Flat } from "./money.js";

/** The 14 seed stages (docs/SEED.md) in master order. */
export const STAGE_NAMES = ["Excavation", "Foundation", "Plinth", "1st Slab", "2nd Slab", "3rd Slab", "4th Slab", "Top Slab", "Brickwork", "Plastering", "Flooring", "Finishing", "External Development", "Possession"] as const;
export type StageName = (typeof STAGE_NAMES)[number];

/** Everything the construction tests build on: two projects with one 14-stage tower each, a Standard CLP plan, a UPI mode, a bank account and customers. */
export interface ConstructionWorld {
  basics: InventoryBasics;
  /** Master stage ids by name. */
  stages: Record<StageName, string>;
  /** Master order of the 14 stage ids. */
  stageOrder: string[];
  sgh: { id: string; towerId: string; flats: Map<string, Flat> };
  ggv: { id: string; towerId: string; flats: Map<string, Flat> };
  upiModeId: string;
  bankAccountId: string;
  planId: string;
  customers: string[];
}

/** Standard CLP (docs/SEED.md): 10% booking; 5% Excavation; 10% Foundation; 5% Plinth; 10% 1st/2nd/3rd Slab; 15% Top Slab; 10% Brickwork; 10% Flooring; 5% Possession. */
export function standardClpInstallments(s: ConstructionWorld["stages"]) {
  return [
    { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
    { seq: 2, name: "Excavation", percent: 5, trigger_type: "ON_STAGE", trigger_stage_id: s.Excavation },
    { seq: 3, name: "Foundation", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s.Foundation },
    { seq: 4, name: "Plinth", percent: 5, trigger_type: "ON_STAGE", trigger_stage_id: s.Plinth },
    { seq: 5, name: "1st Slab", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s["1st Slab"] },
    { seq: 6, name: "2nd Slab", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s["2nd Slab"] },
    { seq: 7, name: "3rd Slab", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s["3rd Slab"] },
    { seq: 8, name: "Top Slab", percent: 15, trigger_type: "ON_STAGE", trigger_stage_id: s["Top Slab"] },
    { seq: 9, name: "Brickwork", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s.Brickwork },
    { seq: 10, name: "Flooring", percent: 10, trigger_type: "ON_STAGE", trigger_stage_id: s.Flooring },
    { seq: 11, name: "Possession", percent: 5, trigger_type: "ON_POSSESSION" },
  ];
}

async function loadFlats(t: TestContext, token: string, blockId: string): Promise<Map<string, Flat>> {
  const r = await t.request<{ items: Flat[] }>("GET", `/api/v1/flats?block_id=${blockId}&page_size=200&sort=flat_number`, { token });
  if (r.status !== 200) throw new Error(`flats: ${r.text}`);
  return new Map(r.body.items.map((f) => [f.flat_number, f]));
}

export async function createConstructionWorld(t: TestContext, admin: string): Promise<ConstructionWorld> {
  const basics = await createInventoryBasics(t, admin);
  // basics made Excavation(10) Foundation(20) Plinth(30) Top Slab(40) Possession(140); add the other nine BEFORE any project so every tower snapshots all 14
  const [excavation, foundation, plinth, topSlab] = basics.stageIds as [string, string, string, string, string];
  const extra: Partial<Record<StageName, string>> = {};
  for (const [name, sort] of [["1st Slab", 32], ["2nd Slab", 34], ["3rd Slab", 36], ["4th Slab", 38], ["Brickwork", 50], ["Plastering", 60], ["Flooring", 70], ["Finishing", 80], ["External Development", 90]] as const) {
    extra[name] = (await post<{ id: string }>(t, admin, "/api/v1/masters/construction-stages", { name, code: name.toUpperCase().replace(/ /g, "_"), sort_order: sort })).id;
  }
  const stages: ConstructionWorld["stages"] = {
    Excavation: excavation, Foundation: foundation, Plinth: plinth, "1st Slab": extra["1st Slab"]!, "2nd Slab": extra["2nd Slab"]!, "3rd Slab": extra["3rd Slab"]!, "4th Slab": extra["4th Slab"]!,
    "Top Slab": topSlab, Brickwork: extra.Brickwork!, Plastering: extra.Plastering!, Flooring: extra.Flooring!, Finishing: extra.Finishing!, "External Development": extra["External Development"]!, Possession: basics.possessionStageId,
  };
  const stageOrder = STAGE_NAMES.map((n) => stages[n]);

  const sgh = await post<{ id: string }>(t, admin, "/api/v1/projects", projectBody("Shree Ganesh Heights", "SGH"));
  const ggv = await post<{ id: string }>(t, admin, "/api/v1/projects", projectBody("Ganesh Green Villas", "GGV"));
  const towerA = await post<{ id: string }>(t, admin, "/api/v1/blocks", towerCBody(sgh.id, basics, { name: "Tower A", code: "A", floors: 3, skip_floors: [], refuge_floors: [], floor_plans: [{ from_floor: 1, to_floor: 3, floor_plan_template_id: basics.templates.FP4 }] }));
  const towerG = await post<{ id: string }>(t, admin, "/api/v1/blocks", towerCBody(ggv.id, basics, { name: "Tower G", code: "G", floors: 2, skip_floors: [], refuge_floors: [], floor_plans: [{ from_floor: 1, to_floor: 2, floor_plan_template_id: basics.templates.FP4 }] }));

  const upi = await post<{ id: string }>(t, admin, "/api/v1/masters/payment-modes", { name: "UPI", code: "UPI", sort_order: 1 });
  const bank = await post<{ id: string }>(t, admin, "/api/v1/masters/bank-accounts", { bank_name: "HDFC Bank", branch: "Boring Road", account_name: "Shree Ganesh Builders", account_number: "50100123456789", ifsc: "HDFC0000123", is_default: true });
  const plan = await post<{ id: string }>(t, admin, "/api/v1/masters/payment-plans", { name: "Standard CLP", code: "STD_CLP", plan_type: "CONSTRUCTION_LINKED", installments: standardClpInstallments(stages) });
  await post(t, admin, "/api/v1/payment-plan-assignments", { plan_id: plan.id, project_id: sgh.id, is_default: true });
  await post(t, admin, "/api/v1/payment-plan-assignments", { plan_id: plan.id, project_id: ggv.id, is_default: true });

  const customers: string[] = [];
  for (const name of ["Rajesh Kumar Sinha", "Priya Verma", "Amit Kumar", "Sunita Devi"]) customers.push(await createCustomer(t, name));

  return {
    basics, stages, stageOrder,
    sgh: { id: sgh.id, towerId: towerA.id, flats: await loadFlats(t, admin, towerA.id) },
    ggv: { id: ggv.id, towerId: towerG.id, flats: await loadFlats(t, admin, towerG.id) },
    upiModeId: upi.id, bankAccountId: bank.id, planId: plan.id, customers,
  };
}

/** Inserts a (fake, already-stored) image document row directly; `withVariants` gives it thumb/medium renditions like a real upload. */
export async function insertImageDocument(t: TestContext, entityType: "STAGE" | "BLOCK" | "PROJECT" | "CUSTOMER", entityId: string, opts: { withVariants?: boolean; mime?: string; sensitive?: boolean } = {}): Promise<string> {
  const n = Math.floor(Math.random() * 1e9);
  const variants = opts.withVariants === false ? null : JSON.stringify({ thumb_key: `t/${n}_thumb.webp`, medium_key: `t/${n}_medium.webp`, width: 1600, height: 1200 });
  const [row] = await t.app.sql<{ id: string }[]>`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, variants, uploaded_by_type, is_sensitive)
    values (${t.companyId}, ${entityType}, ${entityId}, ${`photo-${n}.jpg`}, ${opts.mime ?? "image/jpeg"}, 12345, ${`sha-${n}`}, ${`t/${n}.jpg`}, ${variants}::jsonb, 'SYSTEM', ${opts.sensitive ?? false}) returning id`;
  return row!.id;
}
