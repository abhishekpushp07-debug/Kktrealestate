import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BOOT_TIMEOUT, bookingBody, bookingBySeq, bootAcceptance, completeStage, construction, CR, customerByPhone, defaultBankAccount, flatsOf, getBooking, getFlat, key, L, ledgerOf, masterByCode, paymentBody, paymentModes, projectByCode, stagesByName,
  type Block, type Booking, type ErrorBody, type Harness, type PostPaymentResponse,
} from "./harness.js";

/**
 * SPEC §18 scenario 4 (L245): "The worked ledger example reproduces all 10 rows to the rupee; final due ₹0; booking Completed; flat Sold."
 * Asserted on the seeded booking #1 (GGV P1, docs/SEED.md) AND by replaying the whole scenario on a fresh villa block created here.
 */

/** SPEC L170–L180: after each payment → cash due | account due | total due (paise). */
const WORKED: { stage: string | null; bucket: "CASH" | "ACCOUNT"; amount: number; cash: number; account: number; total: number }[] = [
  { stage: null, bucket: "ACCOUNT", amount: 4 * L, cash: 6 * L, account: 0, total: 6 * L }, // L171 #1 10%
  { stage: "Excavation", bucket: "CASH", amount: 8 * L, cash: 1 * L, account: 2 * L, total: 3 * L }, // L172 #2 15%
  { stage: "Foundation", bucket: "ACCOUNT", amount: 12 * L, cash: 7 * L, account: -6 * L, total: 1 * L }, // L173 #3 25%
  { stage: "Plinth", bucket: "CASH", amount: 5 * L, cash: 5 * L, account: -4 * L, total: 1 * L }, // L174 #4 30%
  { stage: "1st Slab", bucket: "CASH", amount: 10 * L, cash: 1 * L, account: 0, total: 1 * L }, // L175 #5 40%
  { stage: "Top Slab", bucket: "ACCOUNT", amount: 15 * L, cash: 7 * L, account: -11 * L, total: -4 * L }, // L176 #6 50%
  { stage: "Brickwork", bucket: "CASH", amount: 7 * L, cash: 6 * L, account: -7 * L, total: -1 * L }, // L177 #7 60%
  { stage: "Plastering", bucket: "CASH", amount: 20 * L, cash: -5 * L, account: -1 * L, total: -6 * L }, // L178 #8 75%
  { stage: "Flooring", bucket: "ACCOUNT", amount: 9 * L, cash: 1 * L, account: -6 * L, total: -5 * L }, // L179 #9 85%
  { stage: "Possession/Handover", bucket: "CASH", amount: 10 * L, cash: 0, account: 0, total: 0 }, // L180 #10 100%
];

let h: Harness;
let admin: string;
let accounts: string;
let sales: string;

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  accounts = (await h.loginAs("accounts")).access_token;
  sales = (await h.loginAs("sales")).access_token;
}, BOOT_TIMEOUT);
afterAll(async () => { await h?.close(); });

describe("scenario 4 — the seeded worked example (booking #1, GGV P1)", () => {
  it("its ledger carries the ten PAYMENT rows of SPEC §11 to the rupee, the final due is ₹0, the booking is COMPLETED and P1 is SOLD", async () => {
    const b = await bookingBySeq(h, admin, 1);
    // SPEC L170: flat ₹1,00,00,000, cash agreed ₹60,00,000, account agreed ₹40,00,000
    expect(b.agreement_value_paise).toBe(CR);
    expect(b.cash_agreed_paise).toBe(60 * L);
    expect(b.account_agreed_paise).toBe(40 * L);
    expect(b.plan_snapshot.name).toBe("Villa CLP"); // SEED.md: cumulative 10/15/25/30/40/50/60/75/85/100
    const ledger = await ledgerOf(h, admin, b.id);
    const payments = ledger.filter((r) => r.event === "PAYMENT");
    expect(payments).toHaveLength(10);
    for (const [i, row] of WORKED.entries()) {
      // SPEC L171–L180: row #i+1 — bucket, amount and the three running dues
      expect(payments[i], `row #${i + 1}`).toMatchObject({ bucket: row.bucket, amount_paise: row.amount, cash_due_paise: row.cash, account_due_paise: row.account, total_due_paise: row.total });
    }
    expect(ledger.filter((r) => r.event === "DEMAND")).toHaveLength(10); // one DEMAND row per installment (SPEC L149)
    // SPEC L180 / L245: final due ₹0; SPEC L194: Completed when possession done and nothing due
    expect(b.summary.total_due_paise).toBe(0);
    expect(b.summary.cash).toMatchObject({ order_raised_paise: 60 * L, paid_paise: 60 * L, due_paise: 0 });
    expect(b.summary.account).toMatchObject({ order_raised_paise: 40 * L, paid_paise: 40 * L, due_paise: 0 });
    expect(b.summary.raised_percent).toBe(100);
    expect(b.summary.other_charges_due_paise).toBe(0);
    expect(b.status).toBe("COMPLETED");
    expect(b.completed_at).toBeTruthy();
    const flat = await getFlat(h, admin, b.flat_id);
    expect(flat.flat_number).toBe("P1");
    expect(flat.status).toBe("SOLD"); // SPEC L194: "booking Completed, flat Sold"
    expect(b.schedule.every((r) => r.status === "PAID")).toBe(true);
  });
});

describe("scenario 4 — replayed on a fresh villa flat", () => {
  it("a new villa block on Villa CLP reproduces the ten rows as the stages complete, ends at due ₹0, completes and sells the flat", async () => {
    const ggv = await projectByCode(h, admin, "GGV");
    const villaType = await masterByCode<{ id: string; code: string }>(h, admin, "block-types", "VILLA");
    const fpVilla = await masterByCode<{ id: string; code: string }>(h, admin, "floor-plan-templates", "FP-VILLA");
    const villaPlan = await masterByCode<{ id: string; code: string }>(h, admin, "payment-plans", "VILLA_CLP");
    // a villa block whose every stage is still pending (SPEC L74 generation; SEED.md numbering {block}{seq})
    const created = await h.request<Block & ErrorBody>("POST", "/api/v1/blocks", { token: admin, headers: { "idempotency-key": key() }, body: {
      project_id: ggv.id, block_type_id: villaType.id, name: "Block R – Acceptance Villas", code: "R", floors: 2, floor_start: 1,
      floor_plans: [{ from_floor: 1, to_floor: 2, floor_plan_template_id: fpVilla.id }], numbering_pattern: "{block}{seq}", status: "UNDER_CONSTRUCTION",
    } });
    expect(created.status, created.text).toBe(201);
    const blockId = created.body.id;
    // SPEC L121: the plan is linked to the tower (Villa CLP's ON_STAGE installments all exist in the block's stage sequence)
    const assign = await h.request<ErrorBody>("POST", "/api/v1/payment-plan-assignments", { token: admin, headers: { "idempotency-key": key() }, body: { plan_id: villaPlan.id, project_id: ggv.id, block_id: blockId, is_default: true } });
    expect(assign.status, assign.text).toBe(201);
    const flat = (await flatsOf(h, admin, blockId)).get("R1")!;
    expect(flat.price_paise).toBe(CR); // SEED.md GGV rate card: 4BHK Villa lump sum ₹1,00,00,000
    const stages = await stagesByName(h, admin);
    const modes = await paymentModes(h, admin);
    const bank = await defaultBankAccount(h, admin);
    const customer = await customerByPhone(h, admin, "9876543221"); // Kavita Roy — no booking yet

    // SPEC L170 inputs: ₹1 Cr agreement, 60 L cash / 40 L account on Villa CLP
    const bk = await h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", { token: sales, headers: { "idempotency-key": key() }, body: bookingBody(h, flat.id, customer.id, { payment_plan_id: villaPlan.id }) });
    expect(bk.status, bk.text).toBe(201);
    const bookingId = bk.body.id;
    expect(bk.body.summary.raised_percent).toBe(10); // SPEC L140: ON_BOOKING satisfied at booking date
    expect(bk.body.summary).toMatchObject({ total_due_paise: 10 * L });
    expect(bk.body.summary.cash).toMatchObject({ order_raised_paise: 6 * L, due_paise: 6 * L });
    expect(bk.body.summary.account).toMatchObject({ order_raised_paise: 4 * L, due_paise: 4 * L });

    for (const [i, row] of WORKED.entries()) {
      if (row.stage) {
        // SPEC L129: completing the stage runs the dues engine for the booking; SPEC L143 ON_STAGE trigger date = completion date
        const done = await completeStage(h, admin, blockId, stages.get(row.stage)!, h.today);
        expect(done.demands_raised, `stage ${row.stage}`).toBe(1); // exactly the one installment of this stage (SPEC L151 unique per (booking, seq))
        const stageRow = (await construction(h, admin, blockId)).stages.find((s) => s.stage_id === stages.get(row.stage!))!;
        expect(stageRow.status).toBe("COMPLETED");
      }
      const body = paymentBody(h, bookingId, modes, bank.id, { bucket: row.bucket, amount: row.amount, mode: row.bucket === "CASH" ? "CASH" : "NEFT_RTGS", instrument: row.bucket === "CASH" ? undefined : { number: `UTR-ACC-${i + 1}` } });
      const r = await h.request<PostPaymentResponse & ErrorBody>("POST", "/api/v1/payments", { token: accounts, body, headers: { "idempotency-key": key() } });
      expect(r.status, `payment #${i + 1}: ${r.text}`).toBe(201);
      // SPEC L171–L180: the three running dues right after payment #i+1
      expect(r.body.summary, `row #${i + 1}`).toMatchObject({ cash_due_paise: row.cash, account_due_paise: row.account, total_due_paise: row.total });
      // SPEC L169: the PAYMENT ledger row carries the same running balances
      const ledgerRow = (await ledgerOf(h, admin, bookingId)).find((l) => l.ref_number === r.body.payment.receipt_number)!;
      expect(ledgerRow, `ledger row #${i + 1}`).toMatchObject({ event: "PAYMENT", bucket: row.bucket, amount_paise: row.amount, cash_due_paise: row.cash, account_due_paise: row.account, total_due_paise: row.total });
      expect(r.body.payment.status).toBe("CLEARED"); // SPEC L166: Cash / NEFT clear immediately
    }

    let b = await getBooking(h, admin, bookingId);
    // SPEC L180 + L245: final due ₹0 in both buckets, 100 % raised, every installment PAID
    expect(b.summary).toMatchObject({ raised_percent: 100, total_due_paise: 0, total_paid_paise: CR });
    expect(b.summary.cash).toMatchObject({ order_raised_paise: 60 * L, paid_paise: 60 * L, due_paise: 0 });
    expect(b.summary.account).toMatchObject({ order_raised_paise: 40 * L, paid_paise: 40 * L, due_paise: 0 });
    expect(b.schedule.every((r) => r.status === "PAID")).toBe(true);
    expect((await ledgerOf(h, admin, bookingId)).filter((r) => r.event === "DEMAND")).toHaveLength(10);
    // SPEC L147 telescoping: the ten demands sum to the agreed amounts exactly
    const demands = await h.request<{ items: { cash_demand_paise: number; account_demand_paise: number; status: string }[] }>("GET", `/api/v1/bookings/${bookingId}/demands?page_size=50`, { token: admin });
    const live = demands.body.items.filter((d) => d.status !== "VOID");
    expect(live.reduce((s, d) => s + d.cash_demand_paise, 0)).toBe(60 * L);
    expect(live.reduce((s, d) => s + d.account_demand_paise, 0)).toBe(40 * L);
    // SPEC L194: possession complete, total due ≤ 0, other charges due ≤ 0 → Completed; flat → Sold
    const salesComplete = await h.request<ErrorBody>("POST", `/api/v1/bookings/${bookingId}/complete`, { token: sales, body: { version: b.version } });
    expect(salesComplete.status).toBe(403); // Sales holds no booking.complete (SPEC L30)
    const done = await h.request<Booking & ErrorBody>("POST", `/api/v1/bookings/${bookingId}/complete`, { token: admin, body: { version: b.version, completion_notes: "Keys handed over (acceptance replay)" } });
    expect(done.status, done.text).toBe(200);
    expect(done.body.status).toBe("COMPLETED");
    expect(done.body.completed_at).toBeTruthy();
    expect((await getFlat(h, admin, flat.id)).status).toBe("SOLD");
    b = await getBooking(h, admin, bookingId);
    expect(b.status).toBe("COMPLETED");
    // SPEC L153: the integrity report sees nothing wrong with the replayed booking
    const integrity = await h.request<{ ok: boolean; findings: unknown[] }>("GET", `/api/v1/dues/integrity?booking_id=${bookingId}`, { token: admin });
    expect(integrity.status).toBe(200);
    expect(integrity.body.findings).toEqual([]);
    expect(integrity.body.ok).toBe(true);
  });
});
