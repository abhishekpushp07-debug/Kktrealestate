import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@kkt/domain";
import {
  blockByCode,
  BOOT_TIMEOUT,
  bookingBody,
  bookingBySeq,
  bootAcceptance,
  construction,
  createCustomer,
  defaultBankAccount,
  demandsOf,
  flatsOf,
  getBooking,
  key,
  listAtCr,
  ledgerOf,
  masterByCode,
  paymentBody,
  paymentModes,
  projectByCode,
  stagesByName,
  type Booking,
  type Demand,
  type ErrorBody,
  type Harness,
  type List,
  type PostPaymentResponse,
} from "./harness.js";

/**
 * SPEC §18 scenario 9 (L250): "Jumping a tower two stages ahead marks both, raises the right installments for every active booking on plans
 * that have them (amount = % × agreed per bucket), notifies the buyers; undo is blocked once a payment dated after the demand exists,
 * otherwise voids demands and withdraws notifications; integrity report shows zero findings on clean data and flags/repairs manufactured anomalies."
 * Tower B (SEED.md: completed through Foundation) is jumped to 1st Slab (Plinth + 1st Slab).
 */

type Integrity = {
  ok: boolean;
  findings: { type: string; booking_id: string; demand_number?: string | null }[];
  counts?: Record<string, number>;
  bookings_checked?: number;
};
type Status = {
  completed_stage_ids: string[];
  demands_raised: number;
  demand_numbers: string[];
  buyers_notified: number;
  construction_percent: number;
  version: number;
};
type Undo = {
  stage_id: string;
  voided_demand_numbers: string[];
  withdrawn_notifications: number;
  construction_percent: number;
  version: number;
};
type PortalNote = { id: string; type: string; entity_id: string | null; is_read: boolean };

let h: Harness;
let admin: string;
let accounts: string;
let sales: string;
let towerB: { id: string; code: string };
let sghId: string;
let stages: Map<string, string>;
let b5: Booking; // seeded #5 (B-201, Standard CLP, revised agreement)
let bStd: Booking; // fresh Standard CLP booking in Tower B
let bFlexi: Booking; // fresh Flexi booking in Tower B (no Plinth / 1st Slab installment)
let vikram: string; // portal token of booking #5's buyer

/** Telescoping share of an installment (SPEC L147): cumulative(new) − cumulative(old) of the agreed amount. */
function share(agreed: number, cumOld: number, cumNew: number): number {
  return Math.round((agreed * cumNew) / 100) - Math.round((agreed * cumOld) / 100);
}

async function integrity(query = ""): Promise<Integrity> {
  const r = await h.request<Integrity & ErrorBody>("GET", `/api/v1/dues/integrity${query}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function portalNotes(token: string): Promise<PortalNote[]> {
  const r = await h.request<List<PortalNote>>("GET", "/api/v1/portal/notifications?page_size=200", { token });
  expect(r.status, r.text).toBe(200);
  return r.body.items;
}

async function status(
  body: Record<string, unknown>,
): Promise<{ status: number; body: Status & ErrorBody; text: string }> {
  const c = await construction(h, admin, towerB.id);
  const r = await h.request<Status & ErrorBody>("POST", `/api/v1/blocks/${towerB.id}/construction/status`, {
    token: admin,
    body: { version: c.version, notify_buyers: true, ...body },
    headers: { "idempotency-key": key("st") },
  });
  return { status: r.status, body: r.body, text: r.text };
}

async function undo(
  stageId: string,
  reason: string,
): Promise<{ status: number; body: Undo & ErrorBody; text: string }> {
  const c = await construction(h, admin, towerB.id);
  const r = await h.request<Undo & ErrorBody>("POST", `/api/v1/blocks/${towerB.id}/construction/undo`, {
    token: admin,
    body: { version: c.version, stage_id: stageId, reason },
  });
  return { status: r.status, body: r.body, text: r.text };
}

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  accounts = (await h.loginAs("accounts")).access_token;
  sales = (await h.loginAs("sales")).access_token;
  sghId = (await projectByCode(h, admin, "SGH")).id;
  towerB = await blockByCode(h, admin, sghId, "B");
  stages = await stagesByName(h, admin);
  b5 = await bookingBySeq(h, admin, 5);
  const flats = await flatsOf(h, admin, towerB.id);
  await listAtCr(h, admin, [flats.get("B-401")!.id, flats.get("B-402")!.id]);
  const flexi = await masterByCode<{ id: string; code: string }>(h, admin, "payment-plans", "FLEXI_10_40_50");
  const cA = await createCustomer(h, sales, "Acceptance Buyer Nine A", "9898000091");
  const cB = await createCustomer(h, sales, "Acceptance Buyer Nine B", "9898000092");
  const r1 = await h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", {
    token: sales,
    headers: { "idempotency-key": key() },
    body: bookingBody(h, flats.get("B-401")!.id, cA.id),
  });
  if (r1.status !== 201) throw new Error(r1.text);
  bStd = r1.body;
  const r2 = await h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", {
    token: sales,
    headers: { "idempotency-key": key() },
    body: bookingBody(h, flats.get("B-402")!.id, cB.id, { payment_plan_id: flexi.id }),
  });
  if (r2.status !== 201) throw new Error(r2.text);
  bFlexi = r2.body;
  vikram = (await h.portalLogin("9876543214")).access_token;
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 9 — integrity on clean data", () => {
  it("the integrity report shows zero findings on the seeded data plus the two fresh bookings", async () => {
    const r = await integrity();
    // SPEC L153 / L237: zero findings on coherent data
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.bookings_checked ?? 1).toBeGreaterThan(0);
  });
});

describe("scenario 9 — jump two stages ahead", () => {
  let plinthDemands: Demand[];
  let slabDemands: Demand[];

  it("Tower B is at Foundation; the fresh bookings caught up: Standard CLP 25 %, Flexi 10 %", async () => {
    const c = await construction(h, admin, towerB.id);
    expect(c.stages.filter((s) => s.status === "COMPLETED").map((s) => s.name)).toEqual(["Excavation", "Foundation"]); // SEED.md
    expect(c.next_stage_id).toBe(stages.get("Plinth"));
    expect(bStd.summary.raised_percent).toBe(25); // SPEC L191 catch-up: 10 + 5 + 10
    expect(bFlexi.summary.raised_percent).toBe(10); // Flexi has nothing on Excavation / Foundation
    expect(b5.summary.raised_percent).toBe(25);
    expect(b5.agreement_revisions).toHaveLength(1); // SEED.md #5: account 45 L → 55 L
  });

  it("marking 1st Slab completes Plinth too, raises Plinth (5 %) and 1st Slab (10 %) for every active Standard CLP booking, nothing for the Flexi booking, and rings the buyers' bells", async () => {
    const notesBefore = await portalNotes(vikram);
    const r = await status({
      stage_id: stages.get("1st Slab"),
      completed_on: h.today,
      intermediate_dates: { [stages.get("Plinth")!]: addDays(h.today, -1) },
      notes: "Slab cast (acceptance)",
    });
    expect(r.status, r.text).toBe(200);
    // SPEC L128: picking a stage further ahead marks all intermediate stages Completed too (with the given dates)
    expect(r.body.completed_stage_ids).toEqual([stages.get("Plinth"), stages.get("1st Slab")]);
    // SPEC L129: every Active booking in the tower whose plan has installments on those stages: #5, B-401 (× 2 stages); the cancelled #6 and the Flexi booking get nothing
    expect(r.body.demands_raised).toBe(4);
    expect(r.body.demand_numbers).toHaveLength(4);
    const c = await construction(h, admin, towerB.id);
    const byName = new Map(c.stages.map((s) => [s.name, s]));
    expect(byName.get("Plinth")).toMatchObject({
      status: "COMPLETED",
      completed_on: addDays(h.today, -1),
      demands_raised: 2,
      can_undo: false,
    });
    expect(byName.get("1st Slab")).toMatchObject({
      status: "COMPLETED",
      completed_on: h.today,
      demands_raised: 2,
      can_undo: true,
    });
    expect(c.construction_percent).toBe(28.57); // 4 / 14 (SPEC L128 display only)
    for (const [label, bk] of [
      ["#5", b5],
      ["B-401", bStd],
    ] as const) {
      const ds = await demandsOf(h, admin, bk.id, false);
      const plinth = ds.find((d) => d.installment_seq === 4)!;
      const slab = ds.find((d) => d.installment_seq === 5)!;
      // SPEC L146: cash_demand = cash_agreed × percent / 100 (telescoped, SPEC L147); account likewise — "% × agreed per bucket"
      expect(plinth, `${label} plinth`).toMatchObject({
        cash_demand_paise: share(bk.cash_agreed_paise, 25, 30),
        account_demand_paise: share(bk.account_agreed_paise, 25, 30),
        trigger_stage_id: stages.get("Plinth"),
        demand_date: addDays(h.today, -1),
        status: "OPEN",
      });
      expect(slab, `${label} slab`).toMatchObject({
        cash_demand_paise: share(bk.cash_agreed_paise, 30, 40),
        account_demand_paise: share(bk.account_agreed_paise, 30, 40),
        trigger_stage_id: stages.get("1st Slab"),
        demand_date: h.today,
        status: "OPEN",
      });
      expect(ds.map((d) => d.installment_seq)).toEqual([1, 2, 3, 4, 5]);
      const after = await getBooking(h, admin, bk.id);
      expect(after.summary.raised_percent, label).toBe(40);
      expect(after.summary.cash.order_raised_paise, label).toBe(Math.round((bk.cash_agreed_paise * 40) / 100));
      expect(after.summary.account.order_raised_paise, label).toBe(Math.round((bk.account_agreed_paise * 40) / 100));
    }
    expect((await demandsOf(h, admin, bFlexi.id, false)).map((d) => d.installment_seq)).toEqual([1]); // SPEC L250 "on plans that have them"
    expect((await getBooking(h, admin, bFlexi.id)).summary.raised_percent).toBe(10);
    plinthDemands = [b5, bStd].map((bk) => bk.id).length
      ? await Promise.all(
          [b5, bStd].map(async (bk) => (await demandsOf(h, admin, bk.id, false)).find((d) => d.installment_seq === 4)!),
        )
      : [];
    slabDemands = await Promise.all(
      [b5, bStd].map(async (bk) => (await demandsOf(h, admin, bk.id, false)).find((d) => d.installment_seq === 5)!),
    );
    // SPEC L129 / L204: the buyer is notified of each installment demand raised (portal bell)
    const notesAfter = await portalNotes(vikram);
    const fresh = notesAfter.filter((n) => !notesBefore.some((o) => o.id === n.id));
    const raisedBells = fresh.filter((n) => n.type === "DEMAND_RAISED").map((n) => n.entity_id);
    expect(raisedBells).toEqual(expect.arrayContaining([plinthDemands[0]!.id, slabDemands[0]!.id]));
    const unread = await h.request<{ count: number }>("GET", "/api/v1/portal/notifications/unread-count", {
      token: vikram,
    });
    expect(unread.body.count).toBeGreaterThanOrEqual(2);
    // the ledger of each booking carries a DEMAND row per new demand (SPEC L149)
    const ledger = await ledgerOf(h, admin, bStd.id);
    expect(ledger.filter((row) => row.event === "DEMAND").map((row) => row.ref_number)).toEqual(
      expect.arrayContaining([plinthDemands[1]!.demand_number, slabDemands[1]!.demand_number]),
    );
  });

  it("only the latest completed stage can be undone; undoing 1st Slab (no payments) voids its demands, rebuilds ledgers and withdraws the bells", async () => {
    const notLatest = await undo(stages.get("Plinth")!, "Plinth was recorded by mistake");
    // SPEC L130: "only the latest completed stage can be undone"
    expect(notLatest.status).toBe(409);
    expect(notLatest.body.error.code).toBe("UNDO_NOT_LATEST");
    expect(
      (
        await h.request("POST", `/api/v1/blocks/${towerB.id}/construction/undo`, {
          token: sales,
          body: { version: 1, stage_id: stages.get("1st Slab"), reason: "Sales cannot undo stages" },
        })
      ).status,
    ).toBe(403); // SPEC L30 construction.undo
    // mark one bell read so both retraction paths are exercised (SPEC L205: unread deleted, read ones marked withdrawn)
    const slabBell = (await portalNotes(vikram)).find(
      (n) => n.type === "DEMAND_RAISED" && n.entity_id === slabDemands[0]!.id,
    )!;
    expect(slabBell).toBeDefined();
    expect(
      (
        await h.request("POST", "/api/v1/portal/notifications/mark-read", {
          token: vikram,
          body: { ids: [slabBell.id] },
        })
      ).status,
    ).toBe(200);

    const r = await undo(stages.get("1st Slab")!, "Slab certification still pending from the structural engineer");
    expect(r.status, r.text).toBe(200);
    // SPEC L130: "Undo voids those demands, recomputes ledgers, clears the stage's completion data and withdraws related notifications"
    expect([...r.body.voided_demand_numbers].sort()).toEqual(slabDemands.map((d) => d.demand_number).sort());
    expect(r.body.withdrawn_notifications).toBeGreaterThanOrEqual(1); // the stage bells (staff); the demand bells are withdrawn by the money engine and checked on the portal below
    expect(r.body.construction_percent).toBe(21.43);
    const c = await construction(h, admin, towerB.id);
    expect(c.stages.find((s) => s.name === "1st Slab")).toMatchObject({
      status: "PENDING",
      completed_on: null,
      demands_raised: 0,
      can_undo: false,
    });
    expect(c.stages.find((s) => s.name === "Plinth")?.can_undo).toBe(true);
    for (const [i, bk] of [b5, bStd].entries()) {
      const ds = await demandsOf(h, admin, bk.id, true);
      expect(ds.find((d) => d.id === slabDemands[i]!.id)?.status).toBe("VOID");
      expect(ds.filter((d) => d.status !== "VOID").map((d) => d.installment_seq)).toEqual([1, 2, 3, 4]);
      const after = await getBooking(h, admin, bk.id);
      expect(after.summary.raised_percent).toBe(30);
      // contract C7: the ledger is a book of record — the voided demand keeps its DEMAND row and a DEMAND_VOIDED row takes it back out
      const slabRows = (await ledgerOf(h, admin, bk.id)).filter(
        (row) => row.ref_number === slabDemands[i]!.demand_number,
      );
      expect(slabRows.map((row) => row.event)).toEqual(["DEMAND", "DEMAND_VOIDED"]);
    }
    // SPEC L205 retraction: the buyer's bell no longer shows the slab demand (read → withdrawn, unread → deleted); counts exclude withdrawn
    const notes = await portalNotes(vikram);
    expect(notes.some((n) => n.type === "DEMAND_RAISED" && n.entity_id === slabDemands[0]!.id)).toBe(false);
    expect(notes.some((n) => n.type === "DEMAND_RAISED" && n.entity_id === plinthDemands[0]!.id)).toBe(true); // the Plinth bell is untouched
    expect((await integrity(`?project_id=${sghId}`)).findings).toEqual([]); // clean again
  });

  it("undo is blocked once a demand the stage raised has been paid by a payment dated on/after the demand (409 UNDO_BLOCKED)", async () => {
    const again = await status({ stage_id: stages.get("1st Slab"), completed_on: h.today });
    expect(again.status, again.text).toBe(200);
    expect(again.body.demands_raised).toBe(2);
    const modes = await paymentModes(h, admin);
    const bank = await defaultBankAccount(h, admin);
    const before = await getBooking(h, admin, b5.id);
    const slab = (await demandsOf(h, admin, b5.id, false)).find((d) => d.installment_seq === 5)!;
    // a receipt dated today (≥ the demand) that settles every open cash due, the slab installment included (FIFO per bucket)
    const pay = await h.request<PostPaymentResponse & ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: paymentBody(h, b5.id, modes, bank.id, {
        bucket: "CASH",
        amount: before.summary.cash.due_paise,
        mode: "UPI",
      }),
    });
    expect(pay.status, pay.text).toBe(201);
    expect(pay.body.summary.cash_due_paise).toBe(0);
    expect((await demandsOf(h, admin, b5.id, false)).find((d) => d.id === slab.id)?.paid_paise).toBeGreaterThan(0);
    const blocked = await undo(stages.get("1st Slab")!, "Trying to roll back after collection");
    // SPEC L130: "only if no demand raised by it has been paid by a payment dated on/after the demand"
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("UNDO_BLOCKED");
    const details = blocked.body.error.details as {
      reasons: string[];
      blocking_payments: { receipt_number: string; demand_number: string; payment_date: string }[];
    };
    expect(details.reasons.join(" ")).toContain(slab.demand_number);
    expect(
      details.blocking_payments.some(
        (p) => p.receipt_number === pay.body.payment.receipt_number && p.demand_number === slab.demand_number,
      ),
    ).toBe(true);
    // nothing changed
    expect((await construction(h, admin, towerB.id)).stages.find((s) => s.name === "1st Slab")?.status).toBe(
      "COMPLETED",
    );
    expect((await demandsOf(h, admin, b5.id, false)).some((d) => d.installment_seq === 5)).toBe(true);
    expect((await demandsOf(h, admin, bStd.id, false)).some((d) => d.installment_seq === 5)).toBe(true);
    expect((await integrity(`?project_id=${sghId}`)).findings).toEqual([]);
  });
});

describe("scenario 9 — integrity report flags and repairs manufactured anomalies", () => {
  it("a tampered summary and an unsatisfied demand are reported; REPAIR voids the bad demand, fixes the summary and the report is clean again", async (ctx) => {
    if (!h.sql) ctx.skip(); // remote mode without ACCEPTANCE_DATABASE_URL: anomalies cannot be manufactured through the API
    const sql = h.sql!;
    const me = await h.request<{ company: { id: string } }>("GET", "/api/v1/auth/me", { token: admin });
    const companyId = me.body.company.id;
    expect((await integrity(`?booking_id=${bFlexi.id}`)).findings).toEqual([]);
    // (e) stored total ≠ recomputation
    await sql`update bookings set cash_paid_paise = cash_paid_paise + 1 where id = ${bFlexi.id}`;
    const mismatch = await integrity(`?booking_id=${bFlexi.id}`);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.findings.map((f) => f.type)).toEqual(["SUMMARY_MISMATCH"]); // SPEC L153 (e)
    // (a) a demand whose trigger is NOT satisfied: Flexi seq 3 (Brickwork) while Tower B is nowhere near Brickwork
    await sql`insert into demands (company_id, booking_id, project_id, block_id, customer_id, demand_number, installment_seq, installment_name, trigger_type, trigger_stage_id, percent, cumulative_percent, cash_demand_paise, account_demand_paise, total_demand_paise, demand_date, due_date)
      values (${companyId}, ${bFlexi.id}, ${sghId}, ${towerB.id}, ${bFlexi.customer_id}, 'DM-FAKE/0001', 3, 'Brickwork', 'ON_STAGE', ${stages.get("Brickwork")!}, 10, 60, ${6_000_000_00}, ${4_000_000_00}, ${10_000_000_00}, ${h.today}, ${h.today})`;
    const flagged = await integrity(`?booking_id=${bFlexi.id}`);
    expect(flagged.ok).toBe(false);
    expect(flagged.findings.map((f) => f.type).sort()).toEqual(["SUMMARY_MISMATCH", "UNSATISFIED_DEMAND"]); // SPEC L153 (a) + (e)
    expect(flagged.findings.find((f) => f.type === "UNSATISFIED_DEMAND")?.demand_number).toBe("DM-FAKE/0001");
    const company = await integrity();
    expect(company.ok).toBe(false);
    expect(company.findings.filter((f) => f.booking_id === bFlexi.id)).toHaveLength(2);
    // SPEC L153 REPAIR (admin-confirmed): void unsatisfied demands without payments, rebuild ledgers / summaries
    expect(
      (await h.request("POST", "/api/v1/dues/integrity/repair", { token: sales, body: { confirm: "REPAIR" } })).status,
    ).toBe(403);
    expect(
      (await h.request("POST", "/api/v1/dues/integrity/repair", { token: admin, body: { confirm: "no" } })).status,
    ).toBe(400);
    const repaired = await h.request<
      { demands_voided: number; summaries_fixed: number; report_after: Integrity } & ErrorBody
    >("POST", "/api/v1/dues/integrity/repair", { token: admin, body: { confirm: "REPAIR", booking_ids: [bFlexi.id] } });
    expect(repaired.status, repaired.text).toBe(200);
    expect(repaired.body.demands_voided).toBe(1);
    expect(repaired.body.summaries_fixed).toBeGreaterThanOrEqual(1);
    expect(repaired.body.report_after.findings.filter((f) => f.booking_id === bFlexi.id)).toHaveLength(0);
    expect((await demandsOf(h, admin, bFlexi.id, true)).find((d) => d.demand_number === "DM-FAKE/0001")?.status).toBe(
      "VOID",
    ); // voided, never deleted (SPEC L41)
    expect((await getBooking(h, admin, bFlexi.id)).summary.cash.paid_paise).toBe(0);
    const clean = await integrity();
    expect(clean.findings).toEqual([]);
    expect(clean.ok).toBe(true);
  });
});
