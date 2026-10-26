import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@kkt/domain";
import {
  blockByCode,
  BOOT_TIMEOUT,
  bookingBody,
  bootAcceptance,
  customerByPhone,
  flatsOf,
  key,
  listAtCr,
  masterByCode,
  projectByCode,
  type Block,
  type ErrorBody,
  type Harness,
  type List,
} from "./harness.js";

/**
 * SPEC §18 scenario 7 (L248): "Plan dropdown shows only plans assigned to the chosen tower; a plan referencing a stage missing from a
 * tower cannot be assigned; percents ≠ 100 rejected."  SPEC L119 validation, L121 assignments and the dropdown.
 */

type Applicable = {
  plans: {
    plan_id: string;
    is_default: boolean;
    installments: { seq: number; percent: number; cumulative_percent: number }[];
  }[];
};
type Plan = { id: string; code: string; name: string };

let h: Harness;
let admin: string;
let sales: string;
let sgh: { id: string };
let ggv: { id: string };
let towerA: Block;
let towerB: Block;
let towerC: Block;
let blockP: Block;
let plans: Record<"STD" | "DP" | "FLEXI" | "VILLA", Plan>;

async function applicable(blockId: string, token = sales): Promise<Applicable> {
  const r = await h.request<Applicable>("GET", `/api/v1/blocks/${blockId}/applicable-plans`, { token });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  sales = (await h.loginAs("sales")).access_token;
  sgh = await projectByCode(h, admin, "SGH");
  ggv = await projectByCode(h, admin, "GGV");
  towerA = await blockByCode(h, admin, sgh.id, "A");
  towerB = await blockByCode(h, admin, sgh.id, "B");
  towerC = await blockByCode(h, admin, sgh.id, "C");
  blockP = await blockByCode(h, admin, ggv.id, "P");
  plans = {
    STD: await masterByCode<Plan>(h, admin, "payment-plans", "STD_CLP"),
    DP: await masterByCode<Plan>(h, admin, "payment-plans", "DP_10_85_5"),
    FLEXI: await masterByCode<Plan>(h, admin, "payment-plans", "FLEXI_10_40_50"),
    VILLA: await masterByCode<Plan>(h, admin, "payment-plans", "VILLA_CLP"),
  };
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 7 — the plan dropdown", () => {
  it("shows exactly the plans assigned to the chosen tower, default first, with a cumulative schedule reaching 100", async () => {
    // SEED.md: Standard CLP is the default of every SGH tower; Down Payment and Flexi are assigned project-wide on SGH; Villa CLP on GGV blocks P/Q
    for (const tower of [towerA, towerB, towerC]) {
      const r = await applicable(tower.id);
      // SPEC L121: "the plan dropdown shows exactly the applicable plans, default first"
      expect(r.plans.map((p) => p.plan_id).sort(), tower.code).toEqual(
        [plans.STD.id, plans.DP.id, plans.FLEXI.id].sort(),
      );
      expect(r.plans[0], tower.code).toMatchObject({ plan_id: plans.STD.id, is_default: true });
      expect(
        r.plans.filter((p) => p.is_default),
        tower.code,
      ).toHaveLength(1);
      for (const p of r.plans) expect(p.installments.at(-1)?.cumulative_percent, tower.code).toBe(100); // SPEC L119 sum = 100.00
    }
    const villa = await applicable(blockP.id, admin);
    expect(villa.plans.map((p) => p.plan_id)).toEqual([plans.VILLA.id]); // the SGH plans never leak into a GGV block
    expect(villa.plans[0]?.is_default).toBe(true);
    // SPEC L121 live preview: the schedule for Tower A on Standard CLP telescopes to the agreed amounts exactly
    const preview = await h.request<
      {
        rows: { cash_paise: number; account_paise: number }[];
        totals: { cash_paise: number; account_paise: number; total_paise: number };
      } & ErrorBody
    >("POST", "/api/v1/bookings/preview-schedule", {
      token: sales,
      body: {
        plan_id: plans.STD.id,
        block_id: towerA.id,
        booking_date: h.today,
        cash_agreed_paise: 33_333_333,
        account_agreed_paise: 66_666_667,
      },
    });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.rows).toHaveLength(11);
    expect(preview.body.rows.reduce((s, r) => s + r.cash_paise, 0)).toBe(33_333_333); // SPEC L147 telescoping rounding
    expect(preview.body.rows.reduce((s, r) => s + r.account_paise, 0)).toBe(66_666_667);
    expect(preview.body.totals.total_paise).toBe(100_000_000);
  });

  it("a plan assigned to one tower only appears in that tower's dropdown; removing the assignment removes it; a non-applicable plan cannot be booked", async () => {
    const created = await h.request<Plan & ErrorBody>("POST", "/api/v1/masters/payment-plans", {
      token: admin,
      headers: { "idempotency-key": key() },
      body: {
        name: "Acceptance Tower-B Plan",
        code: "ACC_TOWER_B",
        plan_type: "TIME_LINKED",
        description: "Only on Tower B",
        installments: [
          { seq: 1, name: "On booking", percent: 50, trigger_type: "ON_BOOKING" },
          { seq: 2, name: "Fixed date", percent: 50, trigger_type: "ON_DATE", trigger_date: addDays(h.today, 90) },
        ],
      },
    });
    expect(created.status, created.text).toBe(201);
    const assignment = await h.request<{ id: string; version: number } & ErrorBody>(
      "POST",
      "/api/v1/payment-plan-assignments",
      {
        token: admin,
        headers: { "idempotency-key": key() },
        body: { plan_id: created.body.id, project_id: sgh.id, block_id: towerB.id },
      },
    );
    expect(assignment.status, assignment.text).toBe(201);
    // SPEC L121: "a plan is linked to a whole project or to specific towers" → visible on B only
    expect((await applicable(towerB.id)).plans.map((p) => p.plan_id)).toContain(created.body.id);
    expect((await applicable(towerA.id)).plans.map((p) => p.plan_id)).not.toContain(created.body.id);
    expect((await applicable(towerC.id)).plans.map((p) => p.plan_id)).not.toContain(created.body.id);
    expect((await applicable(blockP.id, admin)).plans.map((p) => p.plan_id)).not.toContain(created.body.id);
    // Tower A booking on the Tower-B-only plan is refused (SPEC L121 "exactly the applicable plans")
    const flatA = [...(await flatsOf(h, admin, towerA.id)).values()].find((f) => f.status === "AVAILABLE")!;
    await listAtCr(h, admin, [flatA.id]);
    const customer = await customerByPhone(h, admin, "9876543221");
    const notApplicable = await h.request<ErrorBody>("POST", "/api/v1/bookings", {
      token: sales,
      headers: { "idempotency-key": key() },
      body: bookingBody(h, flatA.id, customer.id, { payment_plan_id: created.body.id }),
    });
    expect(notApplicable.status).toBe(409);
    expect(notApplicable.body.error.code).toBe("PLAN_NOT_APPLICABLE");
    // Sales cannot manage assignments (SPEC L30 permission plan.manage)
    expect(
      (
        await h.request("POST", "/api/v1/payment-plan-assignments", {
          token: sales,
          headers: { "idempotency-key": key() },
          body: { plan_id: created.body.id, project_id: sgh.id, block_id: towerA.id },
        })
      ).status,
    ).toBe(403);
    // SPEC L41 soft delete: deactivating the assignment removes the plan from the dropdown
    const removed = await h.request("DELETE", `/api/v1/payment-plan-assignments/${assignment.body.id}`, {
      token: admin,
      headers: { "if-match": `"${assignment.body.version}"` },
    });
    expect(removed.status).toBe(204);
    expect((await applicable(towerB.id)).plans.map((p) => p.plan_id)).not.toContain(created.body.id);
    const list = await h.request<List<{ id: string; is_active: boolean }>>(
      "GET",
      `/api/v1/payment-plan-assignments?project_id=${sgh.id}&include_inactive=true&page_size=100`,
      { token: admin },
    );
    expect(list.body.items.find((a) => a.id === assignment.body.id)?.is_active).toBe(false);
  });

  it("a plan whose ON_STAGE installment names a stage missing from the tower's sequence cannot be assigned (409 PLAN_STAGES_MISSING listing it)", async () => {
    // a brand-new master stage: no existing tower snapshot contains it (SPEC L127 towers snapshot their sequence)
    const stage = await h.request<{ id: string; name: string } & ErrorBody>(
      "POST",
      "/api/v1/masters/construction-stages",
      {
        token: admin,
        headers: { "idempotency-key": key() },
        body: { name: "Landscaping", code: "LANDSCAPING", sort_order: 135 },
      },
    );
    expect(stage.status, stage.text).toBe(201);
    const plan = await h.request<Plan & ErrorBody>("POST", "/api/v1/masters/payment-plans", {
      token: admin,
      headers: { "idempotency-key": key() },
      body: {
        name: "Landscaping CLP",
        code: "LANDSCAPING_CLP",
        plan_type: "CUSTOM",
        installments: [
          { seq: 1, name: "On booking", percent: 60, trigger_type: "ON_BOOKING" },
          { seq: 2, name: "Landscaping", percent: 40, trigger_type: "ON_STAGE", trigger_stage_id: stage.body.id },
        ],
      },
    });
    expect(plan.status, plan.text).toBe(201); // the plan itself is valid: the stage exists in the master (SPEC L119)
    for (const tower of [towerA, blockP]) {
      const r = await h.request<ErrorBody>("POST", "/api/v1/payment-plan-assignments", {
        token: admin,
        headers: { "idempotency-key": key() },
        body: { plan_id: plan.body.id, project_id: tower.project_id, block_id: tower.id },
      });
      // SPEC L121: "can only be assigned to a tower whose stage sequence contains those stages (otherwise reject and list the missing stages)"
      expect(r.status, tower.code).toBe(409);
      expect(r.body.error.code, tower.code).toBe("PLAN_STAGES_MISSING");
      const missing = r.body.error.details?.["missing_stages"] as { id: string; name: string }[];
      expect(missing.map((m) => m.id)).toEqual([stage.body.id]);
      expect(missing[0]?.name).toBe("Landscaping");
      expect((await applicable(tower.id, admin)).plans.map((p) => p.plan_id)).not.toContain(plan.body.id);
    }
    // a project-wide assignment is refused as well when any block lacks the stage
    const projectWide = await h.request<ErrorBody>("POST", "/api/v1/payment-plan-assignments", {
      token: admin,
      headers: { "idempotency-key": key() },
      body: { plan_id: plan.body.id, project_id: sgh.id },
    });
    expect(projectWide.status).toBe(409);
    expect(projectWide.body.error.code).toBe("PLAN_STAGES_MISSING");
  });

  it("installment percents that do not sum to exactly 100.00 are rejected; so are duplicate sequences", async () => {
    const base = { name: "Bad Plan", code: "BAD_PLAN", plan_type: "CUSTOM" };
    for (const [label, installments] of [
      ["99.5", [{ seq: 1, name: "On booking", percent: 99.5, trigger_type: "ON_BOOKING" }]],
      [
        "100.01",
        [
          { seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" },
          { seq: 2, name: "30 days", percent: 90.01, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 30 },
        ],
      ],
      [
        "110",
        [
          { seq: 1, name: "On booking", percent: 50, trigger_type: "ON_BOOKING" },
          { seq: 2, name: "60 days", percent: 60, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 60 },
        ],
      ],
    ] as const) {
      const r = await h.request<ErrorBody>("POST", "/api/v1/masters/payment-plans", {
        token: admin,
        headers: { "idempotency-key": key() },
        body: { ...base, installments },
      });
      // SPEC L119: "percents must sum to exactly 100.00" — refused as 422 BUSINESS_RULE (PAYMENT_PLAN_INVALID, with the total) or 400 VALIDATION_ERROR
      expect([400, 422], label).toContain(r.status);
      expect(["VALIDATION_ERROR", "BUSINESS_RULE"], label).toContain(r.body.error.code);
      if (r.status === 422) expect(r.body.error.details?.["rule"], label).toBe("PAYMENT_PLAN_INVALID");
      expect(r.text, label).toMatch(/100/);
    }
    const dupSeq = await h.request<ErrorBody>("POST", "/api/v1/masters/payment-plans", {
      token: admin,
      headers: { "idempotency-key": key() },
      body: {
        ...base,
        installments: [
          { seq: 1, name: "On booking", percent: 50, trigger_type: "ON_BOOKING" },
          { seq: 1, name: "Later", percent: 50, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 30 },
        ],
      },
    });
    expect([400, 422]).toContain(dupSeq.status); // SPEC L119: sequences unique
    const twoBooking = await h.request<ErrorBody>("POST", "/api/v1/masters/payment-plans", {
      token: admin,
      headers: { "idempotency-key": key() },
      body: {
        ...base,
        installments: [
          { seq: 1, name: "On booking", percent: 50, trigger_type: "ON_BOOKING" },
          { seq: 2, name: "Again", percent: 50, trigger_type: "ON_BOOKING" },
        ],
      },
    });
    expect([400, 422]).toContain(twoBooking.status); // SPEC L114: ON_BOOKING at most one
    const list = await h.request<List<{ code: string }>>("GET", "/api/v1/masters/payment-plans?page_size=100", {
      token: admin,
    });
    expect(list.body.items.some((p) => p.code === "BAD_PLAN")).toBe(false); // nothing was stored
  });
});
