import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  blockByCode,
  BOOT_TIMEOUT,
  bookingBody,
  bootAcceptance,
  createCustomer,
  defaultBankAccount,
  flatsOf,
  getBooking,
  key,
  listAtCr,
  L,
  ledgerOf,
  paymentBody,
  paymentModes,
  projectByCode,
  type Booking,
  type ErrorBody,
  type Harness,
  type List,
  type Payment,
  type PostPaymentResponse,
} from "./harness.js";

/**
 * SPEC §18 scenario 6 (L247): "Cheque payments are Pending and excluded until cleared; bounced never count; reversal creates a negative
 * ledger row and a cancelled receipt; posting without an Idempotency-Key is rejected; replay returns the identical response and creates nothing."
 * SPEC L166 clearing rule, L168 posting algorithm / reversal, L39 idempotency.
 */

let h: Harness;
let admin: string;
let accounts: string;
let booking: Booking;
let modes: Record<string, string>;
let bankId: string;

async function paymentsTotal(): Promise<number> {
  const r = await h.request<List<unknown>>("GET", `/api/v1/bookings/${booking.id}/payments?page_size=1`, {
    token: admin,
  });
  expect(r.status).toBe(200);
  return r.body.total;
}

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  accounts = (await h.loginAs("accounts")).access_token;
  const sales = (await h.loginAs("sales")).access_token;
  modes = await paymentModes(h, admin);
  bankId = (await defaultBankAccount(h, admin)).id;
  const sgh = await projectByCode(h, admin, "SGH");
  const towerC = await blockByCode(h, admin, sgh.id, "C");
  const flat = (await flatsOf(h, admin, towerC.id)).get("C-1102")!;
  await listAtCr(h, admin, [flat.id]);
  const customer = await createCustomer(h, sales, "Acceptance Buyer Six", "9898000006");
  const r = await h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", {
    token: sales,
    body: bookingBody(h, flat.id, customer.id),
    headers: { "idempotency-key": key() },
  });
  if (r.status !== 201) throw new Error(r.text);
  booking = r.body; // Standard CLP on Tower C (past Excavation): 15 % raised → cash 9 L / account 6 L due
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 6 — cheques, bounces, reversals and idempotency", () => {
  let cheque: Payment;

  it("a cheque is PENDING: it appears in cheques in hand, is excluded from paid/due, and its receipt says subject to realisation", async () => {
    const before = await getBooking(h, admin, booking.id);
    expect(before.summary.cash.due_paise).toBe(9 * L);
    const r = await h.request<PostPaymentResponse & ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: paymentBody(h, booking.id, modes, bankId, {
        bucket: "CASH",
        amount: 5 * L,
        mode: "CHEQUE",
        instrument: { number: "CHQ-ACC-001", date: h.today, bank_name: "State Bank of India" },
      }),
    });
    expect(r.status, r.text).toBe(201);
    cheque = r.body.payment;
    // SPEC L166: Cheque/DD → Pending until staff marks Cleared or Bounced
    expect(cheque.status).toBe("PENDING");
    expect(r.body.ledger_seq).toBeNull(); // no PAYMENT ledger row yet
    expect(r.body.summary.cash_due_paise).toBe(9 * L); // SPEC L166: ONLY Cleared payments count toward paid/due
    const b = await getBooking(h, admin, booking.id);
    expect(b.summary.cash).toMatchObject({ paid_paise: 0, pending_paise: 5 * L, due_paise: 9 * L });
    expect(b.summary.pending_cheques_paise).toBe(5 * L); // "Pending appears as cheques in hand"
    expect((await ledgerOf(h, admin, booking.id)).some((row) => row.ref_number === cheque.receipt_number)).toBe(false);
    const inHand = await h.request<List<{ id: string; status: string }>>(
      "GET",
      `/api/v1/payments/cheques?booking_id=${booking.id}`,
      { token: accounts },
    );
    expect(inHand.status, inHand.text).toBe(200);
    expect(inHand.body.items.map((c) => c.id)).toContain(cheque.id);
    // SPEC L181: receipt carries "subject to realisation" for pending cheques
    const receipt = await h.request<{ subject_to_realisation: boolean; is_cancelled: boolean; receipt_number: string }>(
      "GET",
      `/api/v1/payments/${cheque.id}/receipt`,
      { token: accounts },
    );
    expect(receipt.status, receipt.text).toBe(200);
    expect(receipt.body.subject_to_realisation).toBe(true);
    expect(receipt.body.is_cancelled).toBe(false);
  });

  it("clearing the cheque applies it: CLEARED, a PAYMENT ledger row with running balances, paid/due updated", async () => {
    const cleared = await h.request<Payment & ErrorBody>("POST", `/api/v1/payments/${cheque.id}/clear`, {
      token: accounts,
      body: {},
      headers: { "if-match": `"${cheque.version}"` },
    });
    expect(cleared.status, cleared.text).toBe(200);
    expect(cleared.body.status).toBe("CLEARED"); // SPEC L166
    const b = await getBooking(h, admin, booking.id);
    expect(b.summary.cash).toMatchObject({ paid_paise: 5 * L, pending_paise: 0, due_paise: 4 * L }); // SPEC L163–L164
    expect(b.summary.pending_cheques_paise).toBe(0);
    const row = (await ledgerOf(h, admin, booking.id)).find((l) => l.ref_number === cheque.receipt_number);
    expect(row).toMatchObject({
      event: "PAYMENT",
      bucket: "CASH",
      amount_paise: 5 * L,
      cash_due_paise: 4 * L,
      account_due_paise: 6 * L,
      total_due_paise: 10 * L,
    }); // SPEC L169 ledger columns
    const again = await h.request<ErrorBody>("POST", `/api/v1/payments/${cheque.id}/clear`, {
      token: accounts,
      body: { version: cleared.body.version },
    });
    expect(again.status).toBe(409); // already cleared: never applied twice
  });

  it("a bounced cheque never counts anywhere: BOUNCED, receipt cancelled, no ledger row, excluded from paid", async () => {
    const r = await h.request<PostPaymentResponse & ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: paymentBody(h, booking.id, modes, bankId, {
        bucket: "ACCOUNT",
        amount: 3 * L,
        mode: "CHEQUE",
        instrument: { number: "CHQ-ACC-002", date: h.today, bank_name: "ICICI Bank" },
      }),
    });
    expect(r.status, r.text).toBe(201);
    const bad = r.body.payment;
    expect(bad.status).toBe("PENDING");
    const bounced = await h.request<Payment & ErrorBody>("POST", `/api/v1/payments/${bad.id}/bounce`, {
      token: accounts,
      body: { version: bad.version, reason: "Insufficient funds – returned by ICICI Bank" },
    });
    expect(bounced.status, bounced.text).toBe(200);
    // SPEC L247: "bounced never count"; SPEC L166 only Cleared payments count
    expect(bounced.body.status).toBe("BOUNCED");
    expect(bounced.body.receipt_cancelled).toBe(true);
    const b = await getBooking(h, admin, booking.id);
    expect(b.summary.account).toMatchObject({ paid_paise: 0, pending_paise: 0, due_paise: 6 * L });
    expect(b.summary.pending_cheques_paise).toBe(0);
    expect((await ledgerOf(h, admin, booking.id)).some((l) => l.ref_number === bad.receipt_number)).toBe(false);
    const bouncedList = await h.request<List<{ id: string }>>(
      "GET",
      `/api/v1/payments/cheques?status=BOUNCED&booking_id=${booking.id}`,
      { token: accounts },
    );
    expect(bouncedList.body.items.map((c) => c.id)).toEqual([bad.id]);
    // a bounced cheque can neither be cleared nor reversed
    expect(
      (
        await h.request("POST", `/api/v1/payments/${bad.id}/clear`, {
          token: accounts,
          body: { version: bounced.body.version },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.request("POST", `/api/v1/payments/${bad.id}/reverse`, {
          token: accounts,
          body: { version: bounced.body.version, reason: "Wrong entry made" },
        })
      ).status,
    ).toBe(409);
  });

  it("reversal: original REVERSED, a REVERSAL ledger row with a negative amount, summary decremented, receipt cancelled (never deleted)", async () => {
    const r = await h.request<PostPaymentResponse & ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": key() },
      body: paymentBody(h, booking.id, modes, bankId, { bucket: "ACCOUNT", amount: 2 * L, mode: "UPI" }),
    });
    expect(r.status, r.text).toBe(201);
    const upi = r.body.payment;
    expect(upi.status).toBe("CLEARED"); // SPEC L166: UPI clears immediately
    expect((await getBooking(h, admin, booking.id)).summary.account.paid_paise).toBe(2 * L);
    const noReason = await h.request<ErrorBody>("POST", `/api/v1/payments/${upi.id}/reverse`, {
      token: accounts,
      body: { version: upi.version },
    });
    expect(noReason.status).toBe(400); // SPEC L168: reason mandatory
    const reversed = await h.request<Payment & ErrorBody>("POST", `/api/v1/payments/${upi.id}/reverse`, {
      token: accounts,
      body: { version: upi.version, reason: "Posted against the wrong booking" },
    });
    expect(reversed.status, reversed.text).toBe(200);
    // SPEC L168: original marked Reversed, REVERSAL row with negative amount, summary decremented, receipt marked cancelled
    expect(reversed.body.status).toBe("REVERSED");
    expect(reversed.body.receipt_cancelled).toBe(true);
    const ledger = await ledgerOf(h, admin, booking.id);
    const rev = ledger.find((l) => l.event === "REVERSAL");
    expect(rev).toMatchObject({
      bucket: "ACCOUNT",
      amount_paise: -2 * L,
      ref_number: upi.receipt_number,
      account_due_paise: 6 * L,
    });
    expect(ledger.filter((l) => l.event === "PAYMENT" && l.ref_number === upi.receipt_number)).toHaveLength(1); // the original row stays (append-only)
    const b = await getBooking(h, admin, booking.id);
    expect(b.summary.account).toMatchObject({ paid_paise: 0, due_paise: 6 * L });
    const receipt = await h.request<{ is_cancelled: boolean }>("GET", `/api/v1/payments/${upi.id}/receipt`, {
      token: accounts,
    });
    expect(receipt.body.is_cancelled).toBe(true); // SPEC L181: CANCELLED watermark for reversed
    expect((await h.request("GET", `/api/v1/payments/${upi.id}`, { token: accounts })).status).toBe(200); // SPEC L41: financial records are never deleted
    const twice = await h.request<ErrorBody>("POST", `/api/v1/payments/${upi.id}/reverse`, {
      token: accounts,
      body: { version: reversed.body.version, reason: "Again by mistake" },
    });
    expect(twice.status).toBe(409);
  });

  it("POST /payments without an Idempotency-Key is 400 IDEMPOTENCY_KEY_REQUIRED and creates nothing", async () => {
    const before = await paymentsTotal();
    const r = await h.request<ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      body: paymentBody(h, booking.id, modes, bankId, { bucket: "CASH", amount: 1000_00, mode: "CASH" }),
    });
    // SPEC L39: payment posting REQUIRES an Idempotency-Key
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(await paymentsTotal()).toBe(before);
  });

  it("replaying the same key + body returns the identical response with Idempotent-Replayed and creates nothing; a different body is 422", async () => {
    const before = await paymentsTotal();
    const k = key("replay");
    const body = paymentBody(h, booking.id, modes, bankId, {
      bucket: "CASH",
      amount: 1 * L,
      mode: "CASH",
      remarks: "Idempotency replay",
    });
    const first = await h.request<PostPaymentResponse & ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      body,
      headers: { "idempotency-key": k },
    });
    expect(first.status, first.text).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const replay = await h.request<PostPaymentResponse>("POST", "/api/v1/payments", {
      token: accounts,
      body,
      headers: { "idempotency-key": k },
    });
    // SPEC L39: "replaying the same key returns the original response and creates nothing"
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body).toEqual(first.body);
    expect(await paymentsTotal()).toBe(before + 1);
    const b = await getBooking(h, admin, booking.id);
    expect(b.summary.cash.paid_paise).toBe(6 * L); // 5 L cheque + 1 L cash, not 7 L
    expect(
      (await ledgerOf(h, admin, booking.id)).filter((l) => l.ref_number === first.body.payment.receipt_number),
    ).toHaveLength(1);
    // API-CONVENTIONS: same key + different body → 422 IDEMPOTENCY_MISMATCH
    const mismatch = await h.request<ErrorBody>("POST", "/api/v1/payments", {
      token: accounts,
      body: { ...body, amount_paise: 2 * L },
      headers: { "idempotency-key": k },
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    expect(await paymentsTotal()).toBe(before + 1);
  });
});
