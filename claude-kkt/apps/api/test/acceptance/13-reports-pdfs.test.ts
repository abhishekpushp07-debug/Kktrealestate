import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@kkt/domain";
import {
  BOOT_TIMEOUT,
  bookingBySeq,
  bootAcceptance,
  fetchPdf,
  projectByCode,
  type Booking,
  type ErrorBody,
  type Harness,
  type List,
  type Payment,
} from "./harness.js";

/**
 * SPEC §18 scenario 13 (L254): "Reports reconcile with the ledger (collections = Σ cleared payments; outstanding = Σ booking dues); PDFs
 * download for receipt, demand letter, allotment letter, statement."  SPEC L161–L164 derived figures, L210 reports, L211 branded A4 PDFs.
 */

type Summary = { cash: { due_paise: number }; account: { due_paise: number }; total_due_paise: number };
type BookingRow = { id: string; booking_number: string; status: string; project_id: string; summary: Summary };

let h: Harness;
let admin: string;
let accounts: string;
let sales: string;
let payments: Payment[];
let bookings: BookingRow[];

async function json<T>(url: string, token = admin): Promise<T> {
  const r = await h.request<T & ErrorBody>("GET", url, { token });
  expect(r.status, `${url}: ${r.text}`).toBe(200);
  return r.body;
}

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  accounts = (await h.loginAs("accounts")).access_token;
  sales = (await h.loginAs("sales")).access_token;
  payments = (await json<List<Payment>>("/api/v1/payments?page_size=200")).items;
  bookings = (await json<List<BookingRow>>("/api/v1/bookings?page_size=100")).items;
  if (payments.length < 30 || bookings.length !== 10)
    throw new Error(`unexpected seed: ${payments.length} payments, ${bookings.length} bookings`);
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 13 — reports reconcile with the ledger", () => {
  const from = () => addDays(h.today, -400);

  it("collections total = Σ CLEARED payments in the range; pending, bounced and reversed receipts never count", async () => {
    const r = await json<{
      rows: {
        total_paise: number;
        cash_paise: number;
        account_paise: number;
        other_paise: number;
        by_mode: { amount_paise: number }[];
      }[];
      totals: { total_paise: number; count: number };
    }>(`/api/v1/reports/collections?from=${from()}&to=${h.today}`);
    const cleared = payments.filter(
      (p) => p.status === "CLEARED" && p.payment_date >= from() && p.payment_date <= h.today,
    );
    // SPEC L163: paid = Σ CLEARED payments (the seed has a pending cheque, a bounced cheque and a reversal — SEED.md #2/#3/#4)
    expect(r.totals.total_paise).toBe(cleared.reduce((s, p) => s + p.amount_paise, 0));
    expect(r.totals.count).toBe(cleared.length);
    expect(payments.some((p) => p.status === "PENDING")).toBe(true);
    expect(payments.some((p) => p.status === "BOUNCED")).toBe(true);
    expect(payments.some((p) => p.status === "REVERSED")).toBe(true);
    expect(payments.reduce((s, p) => s + p.amount_paise, 0)).toBeGreaterThan(r.totals.total_paise);
    for (const row of r.rows) {
      expect(row.cash_paise + row.account_paise + row.other_paise).toBe(row.total_paise); // SPEC L210 category split adds up
      expect(row.by_mode.reduce((s, m) => s + m.amount_paise, 0)).toBe(row.total_paise); // by mode adds up
    }
    expect(r.rows.reduce((s, row) => s + row.total_paise, 0)).toBe(r.totals.total_paise);
    // narrowing to one booking day still reconciles
    const day = cleared[0]!.payment_date;
    const one = await json<{ totals: { total_paise: number } }>(`/api/v1/reports/collections?from=${day}&to=${day}`);
    expect(one.totals.total_paise).toBe(
      cleared.filter((p) => p.payment_date === day).reduce((s, p) => s + p.amount_paise, 0),
    );
  });

  it("outstanding = Σ positive bucket dues of ACTIVE bookings; advances = Σ negative parts; ageing buckets sum to the outstanding", async () => {
    const active = bookings.filter((b) => b.status === "ACTIVE");
    const expectedDue = active.reduce(
      (s, b) => s + Math.max(0, b.summary.cash.due_paise) + Math.max(0, b.summary.account.due_paise),
      0,
    );
    const expectedAdv = active.reduce(
      (s, b) => s + Math.max(0, -b.summary.cash.due_paise) + Math.max(0, -b.summary.account.due_paise),
      0,
    );
    const out = await json<{
      rows: { label: string; total_due_paise: number; ageing: Record<string, number> }[];
      totals: {
        cash_due_paise: number;
        account_due_paise: number;
        total_due_paise: number;
        ageing: Record<string, number>;
      };
    }>("/api/v1/reports/outstanding-ageing");
    // SPEC L164 cash_due / account_due per booking; SPEC L254 "outstanding = Σ booking dues"
    expect(out.totals.total_due_paise).toBe(expectedDue);
    expect(out.totals.cash_due_paise).toBe(active.reduce((s, b) => s + Math.max(0, b.summary.cash.due_paise), 0));
    expect(out.totals.account_due_paise).toBe(active.reduce((s, b) => s + Math.max(0, b.summary.account.due_paise), 0));
    expect(Object.values(out.totals.ageing).reduce((s, v) => s + v, 0)).toBe(out.totals.total_due_paise); // SPEC L210 ageing by due date
    for (const row of out.rows) expect(Object.values(row.ageing).reduce((s, v) => s + v, 0)).toBe(row.total_due_paise);
    expect(out.rows.reduce((s, row) => s + row.total_due_paise, 0)).toBe(out.totals.total_due_paise);
    expect(bookings.some((b) => b.status === "CANCELLED")).toBe(true); // SEED.md #6 — excluded above
    expect(bookings.some((b) => b.status === "COMPLETED")).toBe(true); // SEED.md #1 — excluded above
    const adv = await json<{ totals: { total_advance_paise: number } }>("/api/v1/reports/advances");
    expect(adv.totals.total_advance_paise).toBe(expectedAdv); // SPEC L164 NEGATIVE = advance (SEED.md #9 account advance)
    expect(expectedAdv).toBeGreaterThan(0);
  });

  it("demand vs collection reconciles with the demands; cheques in hand reconcile with pending receipts; the statement reconciles with the booking", async () => {
    const sgh = await projectByCode(h, admin, "SGH");
    const demands = (
      await json<
        List<{
          status: string;
          total_demand_paise: number;
          paid_paise: number;
          cash_demand_paise: number;
          account_demand_paise: number;
        }>
      >(`/api/v1/demands?project_id=${sgh.id}&page_size=200`)
    ).items;
    const live = demands.filter((d) => ["OPEN", "PARTIALLY_PAID", "PAID"].includes(d.status));
    const dvc = await json<{ totals: { demanded_paise: number; collected_paise: number; outstanding_paise: number } }>(
      `/api/v1/reports/demand-vs-collection?project_id=${sgh.id}`,
    );
    // SPEC L162: order raised = Σ demands raised; collected = what was applied to them
    expect(dvc.totals.demanded_paise).toBe(
      live.reduce((s, d) => s + (d.total_demand_paise ?? d.cash_demand_paise + d.account_demand_paise), 0),
    );
    expect(dvc.totals.collected_paise).toBe(live.reduce((s, d) => s + d.paid_paise, 0));
    expect(dvc.totals.outstanding_paise).toBe(dvc.totals.demanded_paise - dvc.totals.collected_paise);
    const cheques = await json<{ totals: { count: number; amount_paise: number } }>("/api/v1/reports/cheques");
    const pending = payments.filter((p) => p.status === "PENDING");
    expect(cheques.totals).toEqual({
      count: pending.length,
      amount_paise: pending.reduce((s, p) => s + p.amount_paise, 0),
    }); // SPEC L166 "cheques in hand"
    const b2 = await bookingBySeq(h, admin, 2);
    const st = await json<{
      booking: { booking_number: string };
      ledger: { total_due_paise: number }[];
      summary: { total_due_paise: number; pending_cheques_paise: number };
      pending_cheques: { receipt_number: string }[];
    }>(`/api/v1/reports/customer-statement?booking_id=${b2.id}`);
    expect(st.booking.booking_number).toBe(b2.booking_number);
    expect(st.summary.total_due_paise).toBe(b2.summary.total_due_paise);
    expect(st.ledger.at(-1)?.total_due_paise).toBe(b2.summary.total_due_paise); // SPEC L169 the ledger's last running balance is the due
    expect(st.summary.pending_cheques_paise).toBe(b2.summary.pending_cheques_paise);
    expect(st.pending_cheques).toHaveLength(1); // SEED.md #2 pending cheque ₹5,00,000
  });
});

describe("scenario 13 — PDFs download", () => {
  let b2: Booking;

  it("receipt, demand letter, allotment letter and customer statement are real PDFs (application/pdf, %PDF header, attachment)", async () => {
    b2 = await bookingBySeq(h, admin, 2);
    const cleared =
      payments.find((p) => p.booking_id === b2.id && p.status === "CLEARED") ??
      (await json<List<Payment>>(`/api/v1/bookings/${b2.id}/payments?page_size=50`)).items.find(
        (p) => p.status === "CLEARED",
      )!;
    const demand = (await json<List<{ id: string }>>(`/api/v1/bookings/${b2.id}/demands?page_size=50`)).items[0]!;
    // SPEC L211: "Branded A4 PDFs: receipt, demand letter, allotment letter, customer statement"; SPEC L181 / L182
    const receipt = await fetchPdf(h, `/api/v1/payments/${cleared.id}/receipt.pdf`, accounts);
    expect(receipt.length).toBeGreaterThan(1000);
    const letter = await fetchPdf(h, `/api/v1/bookings/${b2.id}/demands/${demand.id}/letter.pdf`, accounts);
    expect(letter.length).toBeGreaterThan(1000);
    const allotment = await fetchPdf(h, `/api/v1/bookings/${b2.id}/allotment-letter.pdf`, sales);
    expect(allotment.length).toBeGreaterThan(1000);
    const statement = await fetchPdf(h, `/api/v1/bookings/${b2.id}/statement.pdf`, sales);
    expect(statement.length).toBeGreaterThan(1000);
    for (const url of [`/api/v1/payments/${cleared.id}/receipt.pdf`, `/api/v1/bookings/${b2.id}/statement.pdf`]) {
      const r = await h.request("GET", url, { token: admin });
      expect(r.headers["content-disposition"], url).toContain("attachment");
    }
    // a reversed receipt and a pending cheque receipt still render (cancelled watermark / subject to realisation — SPEC L181)
    const reversed = payments.find((p) => p.status === "REVERSED")!;
    expect((await fetchPdf(h, `/api/v1/payments/${reversed.id}/receipt.pdf`, accounts)).length).toBeGreaterThan(1000);
    const pending = payments.find((p) => p.status === "PENDING")!;
    expect((await fetchPdf(h, `/api/v1/payments/${pending.id}/receipt.pdf`, accounts)).length).toBeGreaterThan(1000);
    // every report answers as a PDF as well (SPEC L210 "CSV + PDF export")
    for (const url of [
      `/api/v1/reports/collections?from=${addDays(h.today, -400)}&to=${h.today}`,
      "/api/v1/reports/outstanding-ageing",
      `/api/v1/reports/allotment-letter?booking_id=${b2.id}`,
      `/api/v1/reports/customer-statement?booking_id=${b2.id}`,
    ]) {
      const sep = url.includes("?") ? "&" : "?";
      expect((await fetchPdf(h, `${url}${sep}format=pdf`, admin)).length, url).toBeGreaterThan(1000);
    }
  });

  it("the buyer gets the same documents through signed portal links; Sales cannot print receipts; unknown ids are 404", async () => {
    const buyer = (await h.portalLogin("9876543211")).access_token; // Priya Verma, booking #2
    const link = await h.request<{ download_url: string }>("GET", `/api/v1/portal/bookings/${b2.id}/statement.pdf`, {
      token: buyer,
    });
    expect(link.status, link.text).toBe(200);
    const u = new URL(link.body.download_url);
    const pdf = await fetchPdf(h, u.pathname + u.search, null); // SPEC L185 Appendix C: signed 15-min URL streams the PDF
    expect(pdf.length).toBeGreaterThan(1000);
    const receipts = await json<List<{ payment_id: string }>>(`/api/v1/portal/bookings/${b2.id}/receipts`, buyer);
    const rl = await h.request<{ download_url: string }>(
      "GET",
      `/api/v1/portal/bookings/${b2.id}/receipts/${receipts.items[0]!.payment_id}/pdf`,
      { token: buyer },
    );
    expect(rl.status, rl.text).toBe(200);
    const ru = new URL(rl.body.download_url);
    expect((await fetchPdf(h, ru.pathname + ru.search, null)).length).toBeGreaterThan(1000);
    // SPEC L30: receipt.print guards the staff receipt routes (Sales has none)
    const cleared = (await json<List<Payment>>(`/api/v1/bookings/${b2.id}/payments?page_size=50`)).items.find(
      (p) => p.status === "CLEARED",
    )!;
    expect((await h.request("GET", `/api/v1/payments/${cleared.id}/receipt.pdf`, { token: sales })).status).toBe(403);
    expect(
      (await h.request("GET", `/api/v1/payments/00000000-0000-4000-8000-000000000000/receipt.pdf`, { token: accounts }))
        .status,
    ).toBe(404);
    expect(
      (await h.request("GET", `/api/v1/bookings/00000000-0000-4000-8000-000000000000/statement.pdf`, { token: admin }))
        .status,
    ).toBe(404);
  });
});
