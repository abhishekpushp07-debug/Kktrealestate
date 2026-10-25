import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  blockByCode, BOOT_TIMEOUT, bookingBody, bootAcceptance, CR, createCustomer, defaultBankAccount, demandsOf, flatsOf, getBooking, key, L, ledgerOf, paymentBody, paymentModes, projectByCode,
  type Booking, type ErrorBody, type Harness, type List, type PostPaymentResponse,
} from "./harness.js";

/**
 * SPEC §18 scenario 5 (L246): "Payment above a bucket's agreed amount → rejected with the explanatory message; after an audited agreement
 * revision the same payment succeeds; Sales cannot revise."  SPEC L167 BUCKET CAP RULE, L192 agreement revision.
 */

let h: Harness;
let admin: string;
let accounts: string;
let sales: string;
let booking: Booking;
let modes: Record<string, string>;
let bankId: string;

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  accounts = (await h.loginAs("accounts")).access_token;
  sales = (await h.loginAs("sales")).access_token;
  modes = await paymentModes(h, admin);
  bankId = (await defaultBankAccount(h, admin)).id;
  const sgh = await projectByCode(h, admin, "SGH");
  const towerC = await blockByCode(h, admin, sgh.id, "C");
  const flat = (await flatsOf(h, admin, towerC.id)).get("C-1101")!;
  const customer = await createCustomer(h, sales, "Acceptance Buyer Five", "9898000005");
  const r = await h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", { token: sales, body: bookingBody(h, flat.id, customer.id), headers: { "idempotency-key": key() } });
  if (r.status !== 201) throw new Error(r.text);
  booking = r.body;
}, BOOT_TIMEOUT);
afterAll(async () => { await h?.close(); });

describe("scenario 5 — bucket cap, audited revision, Sales cannot revise", () => {
  const over = () => paymentBody(h, booking.id, modes, bankId, { bucket: "ACCOUNT", amount: 36 * L, mode: "NEFT_RTGS", instrument: { number: "UTR-CAP-36L" } });

  it("a payment that would push the Account bucket above its agreed ₹40,00,000 is rejected with the explanatory message", async () => {
    // SPEC L159: cash_agreed + account_agreed = agreement value (60 L + 40 L = ₹1 Cr)
    expect(booking.cash_agreed_paise + booking.account_agreed_paise).toBe(booking.agreement_value_paise);
    expect(booking.account_agreed_paise).toBe(40 * L);
    const first = await h.request<PostPaymentResponse & ErrorBody>("POST", "/api/v1/payments", { token: accounts, body: paymentBody(h, booking.id, modes, bankId, { bucket: "ACCOUNT", amount: 5 * L, mode: "NEFT_RTGS", instrument: { number: "UTR-CAP-5L" } }), headers: { "idempotency-key": key() } });
    expect(first.status, first.text).toBe(201);
    // Tower C is past Excavation (SEED.md) → 15 % raised: 6 L on Account; 5 L received → ₹1 L still due (SPEC L164 account_due = raised − paid)
    expect(first.body.summary.account_due_paise).toBe(6 * L - 5 * L);
    const rejected = await h.request<ErrorBody>("POST", "/api/v1/payments", { token: accounts, body: over(), headers: { "idempotency-key": key() } });
    // SPEC L167 BUCKET CAP RULE: bucket_paid + amount > bucket_agreed → reject with the explanatory message, applied at posting
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("BUCKET_CAP_EXCEEDED");
    expect(rejected.body.error.message).toBe("Account agreed ₹40,00,000; already received ₹5,00,000; cannot accept ₹36,00,000 – revise the agreement first");
    expect(rejected.body.error.details).toMatchObject({ bucket: "ACCOUNT", agreed_paise: 40 * L, paid_paise: 5 * L, amount_paise: 36 * L });
    // nothing was posted (SPEC L168 atomic unit of work)
    const b = await getBooking(h, admin, booking.id);
    expect(b.summary.account.paid_paise).toBe(5 * L);
    const list = await h.request<List<unknown>>("GET", `/api/v1/bookings/${booking.id}/payments?page_size=1`, { token: admin });
    expect(list.body.total).toBe(1);
  });

  it("Sales cannot revise the agreement (403); invalid revisions are refused; the admin revision is stored with before/after and audited", async () => {
    let b = await getBooking(h, admin, booking.id);
    const revision = { version: b.version, agreement_value_paise: CR, cash_agreed_paise: 55 * L, account_agreed_paise: 45 * L, reason: "Loan sanctioned higher by the bank" };
    const salesRevise = await h.request<ErrorBody>("POST", `/api/v1/bookings/${booking.id}/agreement-revisions`, { token: sales, body: revision, headers: { "idempotency-key": key() } });
    // SPEC L192: agreement revision needs permission agreement.edit, which Sales does not hold (SPEC L26, L246)
    expect(salesRevise.status).toBe(403);
    expect(salesRevise.body.error.code).toBe("FORBIDDEN");
    expect(salesRevise.body.error.details?.["permission"]).toBe("agreement.edit");
    // SPEC L192: reason is mandatory
    const noReason = await h.request<ErrorBody>("POST", `/api/v1/bookings/${booking.id}/agreement-revisions`, { token: admin, body: { ...revision, reason: "" }, headers: { "idempotency-key": key() } });
    expect(noReason.status).toBe(400);
    // SPEC L192: "each bucket's new agreed value must be ≥ that bucket's paid amount" (Account has 5 L received)
    const belowPaid = await h.request<ErrorBody>("POST", `/api/v1/bookings/${booking.id}/agreement-revisions`, { token: admin, body: { ...revision, cash_agreed_paise: 96 * L, account_agreed_paise: 4 * L }, headers: { "idempotency-key": key() } });
    expect(belowPaid.status).toBe(409);
    expect(belowPaid.body.error.code).toBe("BELOW_PAID");
    // SPEC L189 / L192: the split must sum exactly to the agreement value
    const badSum = await h.request<ErrorBody>("POST", `/api/v1/bookings/${booking.id}/agreement-revisions`, { token: admin, body: { ...revision, cash_agreed_paise: 50 * L }, headers: { "idempotency-key": key() } });
    expect(badSum.status).toBe(400);
    // SPEC L40: stale version → 409 VERSION_CONFLICT
    const stale = await h.request<ErrorBody>("POST", `/api/v1/bookings/${booking.id}/agreement-revisions`, { token: admin, body: { ...revision, version: b.version + 7 }, headers: { "idempotency-key": key() } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");

    const revised = await h.request<Booking & ErrorBody>("POST", `/api/v1/bookings/${booking.id}/agreement-revisions`, { token: admin, body: revision, headers: { "idempotency-key": key() } });
    expect(revised.status, revised.text).toBe(201);
    expect(revised.body.version).toBe(b.version + 1);
    // SPEC L192: stored as a revision with before/after; order raised and dues recomputed; AGREEMENT_CHANGE ledger row
    expect(revised.body.agreement_revisions).toHaveLength(1);
    expect(revised.body.agreement_revisions?.[0]?.reason).toBe("Loan sanctioned higher by the bank");
    expect(revised.body.summary.cash).toMatchObject({ agreed_paise: 55 * L, order_raised_paise: 55 * L * 15 / 100 });
    expect(revised.body.summary.account).toMatchObject({ agreed_paise: 45 * L, order_raised_paise: 45 * L * 15 / 100, paid_paise: 5 * L });
    const demands = (await demandsOf(h, admin, booking.id, false));
    expect(demands.find((d) => d.installment_seq === 1)).toMatchObject({ cash_demand_paise: 5_50_000_00, account_demand_paise: 4_50_000_00 });
    const ledger = await ledgerOf(h, admin, booking.id);
    const change = ledger.find((r) => r.event === "AGREEMENT_CHANGE");
    expect(change).toBeDefined();
    expect(ledger.at(-1)?.total_due_paise).toBe(revised.body.summary.total_due_paise);
    // SPEC L38: immutable audit entry with actor and after snapshot; SPEC L246 "audited agreement revision"
    const audit = await h.request<List<{ action: string; actor_name?: string | null; after: Record<string, unknown> | null }>>("GET", `/api/v1/audit-logs/entity/booking/${booking.id}?page_size=100`, { token: admin });
    expect(audit.status, audit.text).toBe(200);
    const rows = audit.body.items.filter((a) => a.action === "booking.agreement_revise");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toMatchObject({ cash_agreed_paise: 55 * L, account_agreed_paise: 45 * L, reason: "Loan sanctioned higher by the bank" });
    expect(rows[0]?.actor_name).toBeTruthy();
    b = revised.body;
  });

  it("after the revision the very same payment succeeds and lands as an Account advance", async () => {
    const ok = await h.request<PostPaymentResponse & ErrorBody>("POST", "/api/v1/payments", { token: accounts, body: over(), headers: { "idempotency-key": key() } });
    // SPEC L246: "after an audited agreement revision the same payment succeeds"
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.payment.status).toBe("CLEARED");
    expect(ok.body.payment.amount_paise).toBe(36 * L);
    const b = await getBooking(h, admin, booking.id);
    // SPEC L163–L164: account_paid = Σ cleared account payments (5 + 36 = 41 L ≤ 45 L agreed); due negative = advance
    expect(b.summary.account.paid_paise).toBe(41 * L);
    expect(b.summary.account.due_paise).toBe(45 * L * 15 / 100 - 41 * L);
    expect(b.summary.account.advance_paise).toBe(41 * L - 45 * L * 15 / 100);
    // the cap still holds at the new ceiling: 4 L more would exceed ₹45,00,000
    const again = await h.request<ErrorBody>("POST", "/api/v1/payments", { token: accounts, body: paymentBody(h, booking.id, modes, bankId, { bucket: "ACCOUNT", amount: 4 * L + 1, mode: "UPI" }), headers: { "idempotency-key": key() } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("BUCKET_CAP_EXCEEDED");
    expect(again.body.error.message).toBe("Account agreed ₹45,00,000; already received ₹41,00,000; cannot accept ₹4,00,000.01 – revise the agreement first");
    const integrity = await h.request<{ ok: boolean; findings: unknown[] }>("GET", `/api/v1/dues/integrity?booking_id=${booking.id}`, { token: admin });
    expect(integrity.body.findings).toEqual([]); // SPEC L153 (e): stored totals match recomputation after the revision
  });
});
