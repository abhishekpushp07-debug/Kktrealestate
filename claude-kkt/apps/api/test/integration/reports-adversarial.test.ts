import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIST } from "@kkt/domain";
import { parseCsv } from "../../src/lib/csv.js";
import type { StaffContext } from "../../src/lib/scope.js";
import { dashboardCacheKey, PDF_MAX_ROWS, REPORT_CATALOG, reportPdf } from "../../src/modules/reports/index.js";
import { post, towerCBody } from "./fixtures/inventory.js";
import { completeStage, createMoneyWorld, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Adversarial review of the reports module: other-charge receipts and reversals vs flat-value collections, ageing on REMAINING demand
 * amounts, "overdue" ≡ "not in the NOT_DUE bucket", PDF row cap + streaming, RFC 4180 escaping of hostile names, strict query parameters on
 * every route (including those without parameters), audit data behind `audit.view` (never the project-scoped `report.view`), preset params
 * validated against the catalogue, dashboard cache keys per user + scope, numeric floor ordering.
 */

const L = 10_000_000; // ₹1,00,000 in paise
const CR = 100 * L;

type BookingDetail = { id: string; version: number; booking_number: string; customer_id: string; other_charges: { id: string; total_paise: number; gst_paise: number; due_paise: number }[] };
type Payment = { id: string; version: number; receipt_number: string; status: string; amount_paise: number };

let t: TestContext;
let admin: string;
let accounts: string;
let sales: string;
let projectsTok: string;
let w: MoneyWorld;
let today: string;
let keyCounter = 0;
const key = () => `reports-adv-${Date.now()}-${++keyCounter}`;

let bA: BookingDetail; // GGV: Villa CLP, parking charge 3L + 5% GST demanded on booking; 2L cash in the Cash bucket; 1.05L other-charge cash; 1L other-charge UPI reversed
let bB: BookingDetail; // SGH Tower A: Villa CLP; Excavation completed 100 days ago (5% = 3L/2L, due 85 days ago); 8L cash → Excavation partially paid (2L of 3L cash)
let towerHId: string; // GGV tower with 12 floors (floor ordering)

async function createBooking(flatId: string, customerId: string, extra: Record<string, unknown> = {}): Promise<BookingDetail> {
  const body = { flat_id: flatId, customer_id: customerId, booking_date: today, agreement_value_paise: CR, cash_agreed_paise: 60 * L, account_agreed_paise: 40 * L, plan_acceptance_mode: "IN_PERSON", plan_accepted_on: today, ...extra };
  const r = await t.request<{ id: string }>("POST", "/api/v1/bookings", { token: sales, body, headers: { "idempotency-key": key() } });
  expect(r.status, r.text).toBe(201);
  const d = await t.request<BookingDetail>("GET", `/api/v1/bookings/${r.body.id}`, { token: admin });
  expect(d.status, d.text).toBe(200);
  return d.body;
}

async function pay(body: Record<string, unknown>): Promise<Payment> {
  const r = await t.request<{ payment: Payment }>("POST", "/api/v1/payments", { token: accounts, body: { payment_date: today, ...body }, headers: { "idempotency-key": key() } });
  expect(r.status, r.text).toBe(201);
  return r.body.payment;
}

async function sum(query: string): Promise<number> {
  const rows = await t.app.sql.unsafe<{ n: string | number | null }[]>(query);
  return Number(rows[0]?.n ?? 0);
}

async function json<T = Record<string, unknown>>(url: string, token = admin): Promise<T> {
  const r = await t.request<T>("GET", url, { token });
  expect(r.status, `${url}: ${r.text}`).toBe(200);
  return r.body;
}

/** Text of a pdfkit PDF: inflates every content stream and decodes the WinAnsi hex strings of the TJ operators. */
function pdfText(buf: Buffer): string {
  const latin = buf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    const raw = Buffer.from(m[1]!, "latin1");
    let content: string;
    try { content = inflateSync(raw).toString("latin1"); } catch { content = raw.toString("latin1"); }
    for (const tj of content.matchAll(/\[((?:<[0-9A-Fa-f]*>\s*-?[\d.]*\s*)+)\]\s*TJ/g)) {
      const hex = [...tj[1]!.matchAll(/<([0-9A-Fa-f]*)>/g)].map((h) => h[1]!).join("");
      out.push(Buffer.from(hex, "hex").toString("latin1"));
    }
  }
  return out.join("\n");
}

beforeAll(async () => {
  t = await buildTestApp();
  today = todayIST();
  admin = (await t.loginAs("admin")).access_token;
  accounts = (await t.loginAs("accounts")).access_token;
  sales = (await t.loginAs("sales")).access_token;
  projectsTok = (await t.loginAs("projects")).access_token;
  w = await createMoneyWorld(t, admin);
  const flatsA = [...w.sgh.flats.values()];
  const flatsG = [...w.ggv.flats.values()];

  // a 12-floor tower in GGV (floor ordering must be numeric, not "Floor 10" < "Floor 2")
  towerHId = (await post<{ id: string }>(t, admin, "/api/v1/blocks", towerCBody(w.ggv.id, w.basics, { name: "Tower H", code: "H", floors: 12, skip_floors: [], refuge_floors: [], floor_plans: [{ from_floor: 1, to_floor: 12, floor_plan_template_id: w.basics.templates.FP4 }] }))).id;

  // bA (GGV): other charge demanded on booking; flat-value cash 2L; other-charge receipts 1.05L (cash) and 1L (UPI, then reversed)
  bA = await createBooking(flatsG[0]!.id, w.customers[0]!, { other_charges: [{ charge_type_id: w.charges.PARKING, amount_paise: 3 * L, gst_percent: 5, demand_at: "ON_BOOKING" }] });
  expect(bA.other_charges).toHaveLength(1);
  expect(bA.other_charges[0]!.total_paise).toBe(3 * L + 15_000_00);
  await pay({ booking_id: bA.id, against: "FLAT_VALUE", bucket: "CASH", amount_paise: 2 * L, payment_mode_id: w.modes.CASH });
  await pay({ booking_id: bA.id, against: "OTHER_CHARGE", other_charge_id: bA.other_charges[0]!.id, amount_paise: 1_05_000_00, payment_mode_id: w.modes.CASH });
  const ocUpi = await pay({ booking_id: bA.id, against: "OTHER_CHARGE", other_charge_id: bA.other_charges[0]!.id, amount_paise: 1 * L, payment_mode_id: w.modes.UPI, instrument: { number: "UPI-OC-1" }, bank_account_id: w.bankAccountId });
  const rev = await t.request<Payment>("POST", `/api/v1/payments/${ocUpi.id}/reverse`, { token: accounts, body: { version: ocUpi.version, reason: "Duplicate entry" } });
  expect(rev.status, rev.text).toBe(200);

  // bB (SGH Tower A): Excavation done 100 days ago → 5% raised (3L cash / 2L account) due 85 days ago; 8L cash pays ON_BOOKING cash 6L + 2L of Excavation cash
  bB = await createBooking(flatsA[0]!.id, w.customers[1]!);
  await completeStage(t, w.sgh.towerId, w.stages.EXCAVATION, addDays(today, -100));
  const run = await t.request("POST", "/api/v1/dues/run", { token: admin, body: { block_id: w.sgh.towerId } });
  expect(run.status, run.text).toBe(200);
  await pay({ booking_id: bB.id, against: "FLAT_VALUE", bucket: "CASH", amount_paise: 8 * L, payment_mode_id: w.modes.CASH });

  // the Project Admin is scoped to SGH only
  const [pa] = await t.app.sql<{ id: string }[]>`select id from users where email = 'projects@sgb.in'`;
  await t.app.sql`insert into user_project_scopes (user_id, project_id) values (${pa!.id}, ${w.sgh.id})`;
  await t.app.redis.incr("perm:version");
}, 180_000);
afterAll(async () => { await t?.close(); });

// ---------------------------------------------------------------------------
describe("other charges vs flat value (SPEC §11: a separate third ledger)", () => {
  it("other-charge receipts land in other_paise (with pro-rata GST) and never in the Cash/Account buckets; a reversed receipt counts nowhere; category filters isolate each ledger", async () => {
    type Coll = { rows: { cash_paise: number; account_paise: number; other_paise: number; gst_paise: number; total_paise: number; count: number; by_mode: { mode_code: string; amount_paise: number }[] }[]; totals: { cash_paise: number; account_paise: number; other_paise: number; gst_paise: number; total_paise: number; count: number } };
    const all = await json<Coll>(`/api/v1/reports/collections?from=${today}&to=${today}`);
    expect(all.totals).toEqual({ cash_paise: 10 * L, account_paise: 0, other_paise: 1_05_000_00, gst_paise: 5_000_00, total_paise: 11_05_000_00, count: 3 });
    expect(all.totals.total_paise).toBe(await sum("select coalesce(sum(amount_paise), 0) as n from payments where status = 'CLEARED'"));
    expect(all.totals.cash_paise).toBe(await sum("select coalesce(sum(amount_paise), 0) as n from payments where status = 'CLEARED' and against = 'FLAT_VALUE' and bucket = 'CASH'"));
    expect(all.totals.other_paise).toBe(await sum("select coalesce(sum(amount_paise), 0) as n from payments where status = 'CLEARED' and against = 'OTHER_CHARGE'"));
    for (const row of all.rows) expect(row.by_mode.reduce((s, m) => s + m.amount_paise, 0)).toBe(row.total_paise);

    const cash = await json<Coll>(`/api/v1/reports/collections?from=${today}&to=${today}&category=CASH`);
    expect(cash.totals).toMatchObject({ cash_paise: 10 * L, account_paise: 0, other_paise: 0, gst_paise: 0, total_paise: 10 * L, count: 2 });
    const account = await json<Coll>(`/api/v1/reports/collections?from=${today}&to=${today}&category=ACCOUNT`);
    expect(account.totals.total_paise).toBe(0);
    expect(account.rows).toHaveLength(0);
    const other = await json<Coll>(`/api/v1/reports/collections?from=${today}&to=${today}&category=OTHER`);
    expect(other.totals).toMatchObject({ cash_paise: 0, account_paise: 0, other_paise: 1_05_000_00, gst_paise: 5_000_00, total_paise: 1_05_000_00, count: 1 });
    const reversed = await json<Coll>(`/api/v1/reports/collections?from=${today}&to=${today}&status=REVERSED`);
    expect(reversed.totals).toMatchObject({ other_paise: 1 * L, total_paise: 1 * L, count: 1, cash_paise: 0 });

    // bank-wise: the reversed UPI is not a receipt any more; the only bank-account receipt would have been that UPI
    const bank = await json<{ rows: { bank_account_id: string | null; amount_paise: number }[]; totals: { amount_paise: number } }>(`/api/v1/reports/bankwise-receipts?from=${today}&to=${today}`);
    expect(bank.totals.amount_paise).toBe(11_05_000_00);
    expect(bank.rows.find((r) => r.bank_account_id === w.bankAccountId)).toBeUndefined();

    // the Accounts dashboard splits the same money by category
    const dash = await json<{ data: { today: { amount_paise: number; count: number }; this_month: { by_category: { category: string; amount_paise: number }[] } } }>("/api/v1/dashboard", accounts);
    expect(dash.data.today).toEqual({ count: 3, amount_paise: 11_05_000_00 });
    expect(dash.data.this_month.by_category.find((c) => c.category === "OTHER")?.amount_paise).toBe(1_05_000_00);
    expect(dash.data.this_month.by_category.find((c) => c.category === "CASH")?.amount_paise).toBe(10 * L);
    expect(dash.data.this_month.by_category.find((c) => c.category === "ACCOUNT")).toBeUndefined();
  });

  it("outstanding, advances and ageing cover flat-value dues only; the other-charge due lives in the statement's own figure", async () => {
    const out = await json<{ totals: { cash_due_paise: number; account_due_paise: number; total_due_paise: number; bookings: number; ageing: Record<string, number> } }>("/api/v1/reports/outstanding-ageing");
    // bA: cash 6L−2L, account 4L · bB: cash 9L−8L, account 6L
    expect(out.totals).toMatchObject({ bookings: 2, cash_due_paise: 4 * L + 1 * L, account_due_paise: 4 * L + 6 * L, total_due_paise: 15 * L });
    expect(Object.values(out.totals.ageing).reduce((s, v) => s + v, 0)).toBe(15 * L);
    const st = await json<{ summary: { total_due_paise: number; other_charges_due_paise: number }; other_charges: { paid_paise: number; due_paise: number }[] }>(`/api/v1/reports/customer-statement?booking_id=${bA.id}`);
    expect(st.summary.total_due_paise).toBe(8 * L);
    expect(st.summary.other_charges_due_paise).toBe(3 * L + 15_000_00 - 1_05_000_00); // the reversed 1L was given back
    expect(st.other_charges[0]).toMatchObject({ paid_paise: 1_05_000_00, due_paise: 3 * L + 15_000_00 - 1_05_000_00 });
    const adv = await json<{ totals: { total_advance_paise: number; count: number } }>("/api/v1/reports/advances");
    expect(adv.totals).toEqual({ cash_advance_paise: 0, account_advance_paise: 0, total_advance_paise: 0, count: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("ageing and overdue use remaining amounts (SPEC §14)", () => {
  it("a partially paid demand ages by its remaining amount, top_overdue reconciles with the non-NOT_DUE buckets, and demand-vs-collection shows the partial collection", async () => {
    type Out = { totals: { total_due_paise: number; ageing: Record<string, number> }; top_overdue: { booking_number: string; overdue_paise: number; days_overdue: number; bucket: string; oldest_due_date: string }[] };
    const r = await json<Out>("/api/v1/reports/outstanding-ageing?top_n=100");
    const excavation = await t.app.sql<{ total: number; paid: number; status: string; due_date: string }[]>`select total_demand_paise as total, paid_paise as paid, status, due_date from demands where booking_id = ${bB.id} and installment_seq = 2`;
    expect(excavation[0]).toMatchObject({ total: 5 * L, paid: 2 * L, status: "PARTIALLY_PAID", due_date: addDays(today, -85) });
    const remaining61to90 = await sum(`select coalesce(sum(greatest(0, total_demand_paise - paid_paise)), 0) as n from demands where status in ('OPEN', 'PARTIALLY_PAID') and due_date between '${addDays(today, -90)}' and '${addDays(today, -61)}'`);
    expect(r.totals.ageing["D61_90"]).toBe(3 * L); // 5L demand − 2L paid, never the 5L total
    expect(r.totals.ageing["D61_90"]).toBe(remaining61to90);
    expect(r.totals.ageing["NOT_DUE"]).toBe(12 * L); // bA on-booking 8L + bB on-booking remaining 4L (account)
    expect((r.totals.ageing["D0_30"] ?? 0) + (r.totals.ageing["D31_60"] ?? 0) + (r.totals.ageing["D90_PLUS"] ?? 0)).toBe(0);
    const overdueBuckets = Object.entries(r.totals.ageing).filter(([k]) => k !== "NOT_DUE").reduce((s, [, v]) => s + v, 0);
    expect(r.top_overdue.reduce((s, x) => s + x.overdue_paise, 0)).toBe(overdueBuckets);
    expect(r.top_overdue).toHaveLength(1);
    expect(r.top_overdue[0]).toMatchObject({ booking_number: bB.booking_number, overdue_paise: 3 * L, days_overdue: 85, bucket: "D61_90", oldest_due_date: addDays(today, -85) });

    // as_of 90 days ago (before the Excavation demand fell due): nothing is overdue, everything is NOT_DUE
    const past = await json<Out>(`/api/v1/reports/outstanding-ageing?as_of=${addDays(today, -90)}`);
    expect(past.top_overdue).toHaveLength(0);
    expect(past.totals.ageing["NOT_DUE"]).toBe(past.totals.total_due_paise);
    // as_of = the due date itself: 0 days overdue → the D0_30 bucket, and the same demand is listed as overdue (buckets and the list agree)
    const onDue = await json<Out>(`/api/v1/reports/outstanding-ageing?as_of=${addDays(today, -85)}`);
    expect(onDue.totals.ageing["D0_30"]).toBe(3 * L);
    expect(onDue.top_overdue[0]).toMatchObject({ overdue_paise: 3 * L, days_overdue: 0, bucket: "D0_30" });

    const dvc = await json<{ rows: { label: string; demanded_paise: number; collected_paise: number; outstanding_paise: number; collection_percent: number }[] }>(`/api/v1/reports/demand-vs-collection?project_id=${w.sgh.id}`);
    expect(dvc.rows.find((x) => x.label === "Excavation")).toMatchObject({ demanded_paise: 5 * L, collected_paise: 2 * L, outstanding_paise: 3 * L, collection_percent: 40 });
    expect(dvc.rows.find((x) => x.label === "On booking")).toMatchObject({ demanded_paise: 10 * L, collected_paise: 6 * L, outstanding_paise: 4 * L, collection_percent: 60 });

    const dash = await json<{ data: { overdue_demands: { total_demand_paise: number; paid_paise: number; days_overdue: number }[] } }>("/api/v1/dashboard", accounts);
    expect(dash.data.overdue_demands).toHaveLength(1);
    expect(dash.data.overdue_demands[0]).toMatchObject({ total_demand_paise: 5 * L, paid_paise: 2 * L, days_overdue: 85 });
  });
});

// ---------------------------------------------------------------------------
describe("PDF generation is bounded and streamed", () => {
  it(`cuts the table at PDF_MAX_ROWS (${PDF_MAX_ROWS}) with a visible note, keeps totals over every row and stays well under a page per row`, async () => {
    const total = PDF_MAX_ROWS + 100;
    const rows = Array.from({ length: total }, (_, i) => ({ n: `Row ${i + 1}`, v: (i + 1) * 100 }));
    const bytes = await reportPdf({ name: "Cap Test Builders" }, { title: "Cap test", columns: [{ key: "n", header: "Name", width: 3 }, { key: "v", header: "Amount", money: true }], rows, totals: { n: "Total", v: rows.reduce((s, r) => s + r.v, 0) } });
    const text = pdfText(bytes);
    expect(text).toContain("Row 2000");
    expect(text).not.toContain("Row 2001");
    expect(text).toContain(`first 2,000 of ${total.toLocaleString("en-IN")}`);
    expect(text).toContain("Totals cover every row");
    const pages = Number(/Page 1 of (\d+)/.exec(text)?.[1]);
    expect(pages).toBeGreaterThan(10);
    expect(pages).toBeLessThan(80);
    const small = pdfText(await reportPdf({ name: "Cap Test Builders" }, { title: "Small", columns: [{ key: "n", header: "Name" }], rows: rows.slice(0, 3) }));
    expect(small).not.toContain("Showing the first");
    expect(small).toContain("3 rows.");
  }, 60_000);

  it("report PDFs are streamed (no Content-Length, chunked) while receipts keep an exact length; both are valid PDFs", async () => {
    const report = await t.app.inject({ method: "GET", url: "/api/v1/reports/outstanding-ageing?format=pdf", headers: { authorization: `Bearer ${admin}` } });
    expect(report.statusCode, report.body.slice(0, 200)).toBe(200);
    expect(String(report.headers["content-type"])).toContain("application/pdf");
    expect(report.headers["content-length"]).toBeUndefined();
    expect(report.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(report.rawPayload.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdfText(report.rawPayload)).toContain("OUTSTANDING & AGEING");
    const [receipt] = await t.app.sql<{ id: string }[]>`select id from payments where booking_id = ${bB.id} limit 1`;
    const rec = await t.app.inject({ method: "GET", url: `/api/v1/payments/${receipt!.id}/receipt.pdf`, headers: { authorization: `Bearer ${accounts}` } });
    expect(rec.statusCode).toBe(200);
    expect(Number(rec.headers["content-length"])).toBe(rec.rawPayload.length);
  });
});

// ---------------------------------------------------------------------------
describe("CSV escaping (RFC 4180)", () => {
  it("names with commas, quotes and newlines survive a CSV round trip in the outstanding-by-customer and advances exports", async () => {
    const hostile = 'Rao, "Venkat"\nJr';
    await t.app.sql`update customers set full_name = ${hostile} where id = ${bA.customer_id}`;
    const r = await t.request("GET", "/api/v1/reports/outstanding-ageing?group_by=CUSTOMER&format=csv", { token: admin });
    expect(r.status).toBe(200);
    expect(r.text).toContain('"Rao, ""Venkat""\nJr"');
    const rows = parseCsv(r.text);
    expect(rows[0]).toEqual(["label", "bookings", "cash_due_paise", "account_due_paise", "total_due_paise", "NOT_DUE", "D0_30", "D31_60", "D61_90", "D90_PLUS"]);
    expect(rows).toHaveLength(3);
    const mine = rows.find((row) => row[0] === hostile)!;
    expect(mine).toBeDefined();
    expect(mine.slice(1)).toEqual(["1", String(4 * L), String(4 * L), String(8 * L), String(8 * L), "0", "0", "0", "0"]);
    const upcoming = await t.request("GET", `/api/v1/reports/upcoming-dues?from=${today}&to=${addDays(today, 400)}&format=csv`, { token: admin });
    expect(upcoming.status).toBe(200);
    for (const row of parseCsv(upcoming.text).slice(1)) if (row[2] === hostile) expect(row).toHaveLength(13);
    await t.app.sql`update customers set full_name = 'Customer A' where id = ${bA.customer_id}`;
  });
});

// ---------------------------------------------------------------------------
describe("strict queries and permissions on every route", () => {
  it("every catalogue report, the catalogue itself, the document PDFs, presets and the dashboard reject unknown query keys with 400 VALIDATION_ERROR", async () => {
    const [paymentRow] = await t.app.sql<{ id: string }[]>`select id from payments where booking_id = ${bB.id} limit 1`;
    const required: Record<string, string> = { from: today, to: today, project_id: w.sgh.id, booking_id: bB.id };
    const urls = REPORT_CATALOG.map((e) => `/api/v1${e.path}?${[...e.required_params.map((p) => `${p}=${encodeURIComponent(required[p]!)}`), "unexpected=1"].join("&")}`);
    urls.push("/api/v1/reports?x=1", "/api/v1/reports/presets?x=1", "/api/v1/dashboard?x=1", `/api/v1/payments/${paymentRow!.id}/receipt.pdf?x=1`, `/api/v1/bookings/${bB.id}/statement.pdf?x=1`, `/api/v1/bookings/${bB.id}/allotment-letter.pdf?x=1`);
    for (const url of urls) {
      const r = await t.request<ErrorBody>("GET", url, { token: admin });
      expect(r.status, url).toBe(400);
      expect(r.body.error.code, url).toBe("VALIDATION_ERROR");
    }
    // inverted optional ranges are 400 too
    for (const url of [`/api/v1/reports/inventory?from=${today}&to=${addDays(today, -1)}`, `/api/v1/reports/cheques?from=${today}&to=${addDays(today, -1)}`, `/api/v1/reports/activity?from=${today}&to=${addDays(today, -1)}`]) {
      const r = await t.request<ErrorBody>("GET", url, { token: admin });
      expect(r.status, url).toBe(400);
    }
  });

  it("the activity report (audit log, logins, failed logins) needs audit.view: Accounts yes, a Project Admin or Sales with report.view no", async () => {
    const ok = await t.request<{ total: number }>("GET", "/api/v1/reports/activity?kind=LOGIN", { token: accounts });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.total).toBeGreaterThan(0);
    for (const token of [projectsTok, sales]) {
      for (const kind of ["AUDIT", "LOGIN", "FAILED_LOGIN"]) {
        const r = await t.request<ErrorBody>("GET", `/api/v1/reports/activity?kind=${kind}`, { token });
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe("FORBIDDEN");
      }
    }
    const registry = t.app.routeRegistry.filter((r) => r.url.startsWith("/api/v1/reports") || r.url === "/api/v1/dashboard" || r.url.endsWith(".pdf"));
    expect(registry.length).toBeGreaterThanOrEqual(22);
    for (const r of registry) expect(r.permission, `${r.method} ${r.url}`).toBeTruthy();
    expect(registry.find((r) => r.url === "/api/v1/reports/activity")?.permission).toBe("audit.view");
    expect(registry.find((r) => r.url === "/api/v1/payments/:id/receipt.pdf")?.permission).toBe("receipt.print");
    expect(registry.find((r) => r.url === "/api/v1/dashboard")?.permission).toBe("dashboard.view");
  });

  it("preset params are validated against the report's own parameters; valid presets replay idempotently", async () => {
    const bad = await t.request<ErrorBody>("POST", "/api/v1/reports/presets", { token: accounts, body: { report_key: "COLLECTIONS", name: "Bad", params: { group_by: "DAY", bogus: 1 } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(bad.body.error.details?.["unknown"]).toEqual(["bogus"]);
    const extraBody = await t.request<ErrorBody>("POST", "/api/v1/reports/presets", { token: accounts, body: { report_key: "COLLECTIONS", name: "Bad", params: {}, colour: "gold" } });
    expect(extraBody.status).toBe(400);
    const k = key();
    const ok = await t.request<{ id: string }>("POST", "/api/v1/reports/presets", { token: accounts, body: { report_key: "INVENTORY", name: "Tower view", params: { project_id: w.ggv.id, format: "pdf" } }, headers: { "idempotency-key": k } });
    expect(ok.status, ok.text).toBe(201);
    const replay = await t.request<{ id: string }>("POST", "/api/v1/reports/presets", { token: accounts, body: { report_key: "INVENTORY", name: "Tower view", params: { project_id: w.ggv.id, format: "pdf" } }, headers: { "idempotency-key": k } });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(ok.body.id);
    expect(String(replay.headers["idempotent-replayed"])).toBe("true");
    const audits = await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs where entity_type = 'report_preset' and entity_id = ${ok.body.id}`;
    expect(audits[0]!.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("dashboard cache and scope", () => {
  it("cache keys differ per user, per scope and per project filter, so a scoped Project Admin never reads another user's cached payload", () => {
    const base = { companyId: "c1", name: "x", email: "x", roleId: "r", roleName: "Project Admin", isSystemRole: true, permissions: new Set<string>(), mustChangePassword: false, mfaEnabled: false, sessionId: "s" };
    const a: StaffContext = { ...base, id: "u1", allProjects: false, projectIds: ["p1"] };
    const b: StaffContext = { ...base, id: "u2", allProjects: false, projectIds: ["p1", "p2"] };
    const c: StaffContext = { ...base, id: "u1", allProjects: false, projectIds: ["p2", "p1"] };
    expect(dashboardCacheKey(a, "PROJECT_ADMIN", {})).not.toBe(dashboardCacheKey(b, "PROJECT_ADMIN", {}));
    expect(dashboardCacheKey(a, "PROJECT_ADMIN", {})).not.toBe(dashboardCacheKey(c, "PROJECT_ADMIN", {}));
    expect(dashboardCacheKey(a, "PROJECT_ADMIN", {})).not.toBe(dashboardCacheKey(a, "PROJECT_ADMIN", { project_id: "p1" }));
    expect(dashboardCacheKey(a, "PROJECT_ADMIN", {})).not.toBe(dashboardCacheKey(a, "OWNER", {}));
    expect(dashboardCacheKey(c, "OWNER", {})).toBe(dashboardCacheKey({ ...c, projectIds: ["p1", "p2"] }, "OWNER", {}));
  });

  it("a scoped Project Admin's dashboard shows only SGH even right after the Owner's dashboard was cached; out-of-scope project filters are 404", async () => {
    const owner = await json<{ role: string; data: { inventory_by_project: { project_name: string }[] } }>("/api/v1/dashboard", admin);
    expect(owner.data.inventory_by_project.map((p) => p.project_name).sort()).toEqual(["Ganesh Green Villas", "Shree Ganesh Heights"]);
    const scoped = await json<{ role: string; data: { projects: { project_name: string }[]; construction: { block_name: string }[] } }>("/api/v1/dashboard", projectsTok);
    expect(scoped.role).toBe("PROJECT_ADMIN");
    expect(scoped.data.projects.map((p) => p.project_name)).toEqual(["Shree Ganesh Heights"]);
    expect(scoped.data.construction.every((b) => b.block_name !== "Tower H")).toBe(true);
    const out = await t.request<ErrorBody>("GET", `/api/v1/dashboard?project_id=${w.ggv.id}`, { token: projectsTok });
    expect(out.status).toBe(404);
    const keys = await t.app.redis.keys("dash:*");
    expect(keys.some((k) => k.includes(":OWNER:"))).toBe(true);
    expect(keys.some((k) => k.includes(":PROJECT_ADMIN:") && k.includes(w.sgh.id))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("inventory ordering", () => {
  it("floors sort numerically within a block (1 … 12), not lexicographically", async () => {
    const r = await json<{ by_floor: { block_id: string; floor: number; total: number }[] }>(`/api/v1/reports/inventory?block_id=${towerHId}`);
    expect(r.by_floor.map((f) => f.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.by_floor.every((f) => f.block_id === towerHId && f.total === 4)).toBe(true);
    const all = await json<{ by_floor: { block_id: string; floor: number }[] }>(`/api/v1/reports/inventory?project_id=${w.ggv.id}`);
    const byBlock = new Map<string, number[]>();
    for (const f of all.by_floor) byBlock.set(f.block_id, [...(byBlock.get(f.block_id) ?? []), f.floor]);
    for (const floors of byBlock.values()) expect(floors).toEqual([...floors].sort((a, b) => a - b));
  });
});
