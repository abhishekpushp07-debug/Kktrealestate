/** Step 3 — the four payment plans (docs/SEED.md) and their tower/project assignments. */
import type { SeedContext } from "./context.js";

export async function seedPlans(ctx: SeedContext): Promise<void> {
  ctx.log("payment plans: Standard CLP, Down Payment 10:85:5, Flexi 10:40:50, Villa CLP + assignments");
  const st = (name: string) => ctx.stages[name]!;
  const stage = (seq: number, name: string, percent: number) => ({
    seq,
    name,
    percent,
    trigger_type: "ON_STAGE",
    trigger_stage_id: st(name),
  });

  const standard = await ctx.post<{ id: string }>("/api/v1/masters/payment-plans", {
    name: "Standard CLP",
    code: "STD_CLP",
    plan_type: "CONSTRUCTION_LINKED",
    description: "10% on booking, then construction-linked tranches to 100%.",
    grace_days: 7,
    installments: [
      { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
      stage(2, "Excavation", 5),
      stage(3, "Foundation", 10),
      stage(4, "Plinth", 5),
      stage(5, "1st Slab", 10),
      stage(6, "2nd Slab", 10),
      stage(7, "3rd Slab", 10),
      stage(8, "Top Slab", 15),
      stage(9, "Brickwork", 10),
      stage(10, "Flooring", 10),
      { seq: 11, name: "Possession", percent: 5, trigger_type: "ON_POSSESSION" },
    ],
  });
  const dp = await ctx.post<{ id: string }>("/api/v1/masters/payment-plans", {
    name: "Down Payment 10:85:5",
    code: "DP_10_85_5",
    plan_type: "DOWN_PAYMENT",
    description: "10% on booking, 85% within 30 days, 5% on possession.",
    grace_days: 0,
    installments: [
      { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
      { seq: 2, name: "30 days after booking", percent: 85, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 30 },
      { seq: 3, name: "Possession", percent: 5, trigger_type: "ON_POSSESSION" },
    ],
  });
  const flexi = await ctx.post<{ id: string }>("/api/v1/masters/payment-plans", {
    name: "Flexi 10:40:50",
    code: "FLEXI_10_40_50",
    plan_type: "FLEXI",
    description: "10% on booking, 40% at 60 days, 50% spread over the last five stages.",
    grace_days: 7,
    installments: [
      { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
      { seq: 2, name: "60 days after booking", percent: 40, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 60 },
      stage(3, "Brickwork", 10),
      stage(4, "Plastering", 10),
      stage(5, "Flooring", 10),
      stage(6, "Finishing", 10),
      { seq: 7, name: "Possession", percent: 10, trigger_type: "ON_POSSESSION" },
    ],
  });
  const villa = await ctx.post<{ id: string }>("/api/v1/masters/payment-plans", {
    name: "Villa CLP",
    code: "VILLA_CLP",
    plan_type: "CONSTRUCTION_LINKED",
    description: "Cumulative 10/15/25/30/40/50/60/75/85/100 (the SPEC §11 worked example).",
    grace_days: 7,
    installments: [
      { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
      stage(2, "Excavation", 5),
      stage(3, "Foundation", 10),
      stage(4, "Plinth", 5),
      stage(5, "1st Slab", 10),
      stage(6, "Top Slab", 10),
      stage(7, "Brickwork", 10),
      stage(8, "Plastering", 15),
      stage(9, "Flooring", 10),
      { seq: 10, name: "Possession", percent: 15, trigger_type: "ON_POSSESSION" },
    ],
  });
  ctx.ids["plan:STD"] = standard.id;
  ctx.ids["plan:DP"] = dp.id;
  ctx.ids["plan:FLEXI"] = flexi.id;
  ctx.ids["plan:VILLA"] = villa.id;

  const sgh = ctx.project("SGH");
  const ggv = ctx.project("GGV");
  // Standard CLP is the default of every SGH tower; Down Payment and Flexi are also applicable on SGH; Villa CLP is the default of the GGV blocks
  for (const code of ["A", "B", "C"])
    await ctx.post("/api/v1/payment-plan-assignments", {
      plan_id: standard.id,
      project_id: sgh.id,
      block_id: sgh.blocks[code]!.id,
      is_default: true,
    });
  await ctx.post("/api/v1/payment-plan-assignments", { plan_id: dp.id, project_id: sgh.id });
  await ctx.post("/api/v1/payment-plan-assignments", { plan_id: flexi.id, project_id: sgh.id });
  for (const code of ["P", "Q"])
    await ctx.post("/api/v1/payment-plan-assignments", {
      plan_id: villa.id,
      project_id: ggv.id,
      block_id: ggv.blocks[code]!.id,
      is_default: true,
    });
}
