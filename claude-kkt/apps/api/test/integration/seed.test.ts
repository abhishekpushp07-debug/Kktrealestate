import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialYear } from "@kkt/domain";

/**
 * Demo seed (docs/SEED.md, SPEC §17): the real API is driven in-process to the exact demo state, validated through the API,
 * idempotent, and restorable through reseed() / POST /admin/reseed. Runs on its own database (kkt_seed_test) and Redis db 11
 * with every module loaded (KKT_MODULES unset).
 */
process.env["TEST_DATABASE_URL"] = process.env["SEED_TEST_DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/kkt_seed_test";
process.env["TEST_REDIS_URL"] = process.env["SEED_TEST_REDIS_URL"] ?? "redis://localhost:6379/11";
delete process.env["KKT_MODULES"];

const { buildTestApp } = await import("./helpers.js");
type TestContext = Awaited<ReturnType<typeof buildTestApp>>;

const SEED_TIMEOUT = 15 * 60_000;
const L = 10_000_000;

type List<T> = { items: T[]; total: number };
type Payment = { id: string; receipt_number: string; payment_date: string; status: string; posted_at?: string; created_at: string };
type Booking = { id: string; booking_number: string; booking_date: string; status: string; customer_name?: string };
type LedgerRow = { event: string; bucket: string | null; amount_paise: number; cash_due_paise: number; account_due_paise: number; total_due_paise: number };

let t: TestContext;
let admin: string;
let seedDemo: typeof import("../../src/seed/run.js")["seedDemo"];
let reseed: typeof import("../../src/seed/run.js")["reseed"];
let firstCounts: Record<string, number>;

const WORKED = [
  ["ACCOUNT", 4 * L, 6 * L, 0, 6 * L], ["CASH", 8 * L, 1 * L, 2 * L, 3 * L], ["ACCOUNT", 12 * L, 7 * L, -6 * L, 1 * L], ["CASH", 5 * L, 5 * L, -4 * L, 1 * L], ["CASH", 10 * L, 1 * L, 0, 1 * L],
  ["ACCOUNT", 15 * L, 7 * L, -11 * L, -4 * L], ["CASH", 7 * L, 6 * L, -7 * L, -1 * L], ["CASH", 20 * L, -5 * L, -1 * L, -6 * L], ["ACCOUNT", 9 * L, 1 * L, -6 * L, -5 * L], ["CASH", 10 * L, 0, 0, 0],
] as const;

async function total(url: string): Promise<number> {
  const r = await t.request<List<unknown>>("GET", url, { token: admin });
  expect(r.status, `${url}: ${r.text}`).toBe(200);
  return r.body.total;
}

async function snapshotCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [k, url] of Object.entries({
    customers: "/api/v1/customers?page_size=1&exact=true", leads: "/api/v1/leads?page_size=1&exact=true", bookings: "/api/v1/bookings?page_size=1&exact=true", visits: "/api/v1/site-visits?page_size=1&exact=true",
    tickets: "/api/v1/service-requests?page_size=1&exact=true", notices: "/api/v1/notices?page_size=1&exact=true", posts: "/api/v1/cms/posts?page_size=1&exact=true", payments: "/api/v1/payments?page_size=1&exact=true",
    demands: "/api/v1/demands?page_size=1&exact=true", flats: "/api/v1/flats?page_size=1&exact=true", documents: "/api/v1/documents?page_size=1&exact=true", gallery: "/api/v1/cms/gallery?page_size=1&exact=true",
  })) out[k] = await total(url);
  return out;
}

async function receiptNumbers(): Promise<string[]> {
  const r = await t.request<List<Payment>>("GET", "/api/v1/payments?page_size=200&sort=receipt_number", { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body.items.map((p) => p.receipt_number).sort();
}

/** Receipt numbers must be `SGB/<fy of payment date>/<seq>` with seq 0001… in posting order within each FY. */
async function assertReceiptSequence(): Promise<void> {
  const rows = await t.app.sql<{ receipt_number: string; payment_date: string }[]>`select receipt_number, payment_date::text from payments order by posted_at, created_at`;
  const next = new Map<string, number>();
  for (const r of rows) {
    const fy = financialYear(r.payment_date, 4).label;
    const seq = (next.get(fy) ?? 0) + 1;
    next.set(fy, seq);
    expect(r.receipt_number).toBe(`SGB/${fy}/${String(seq).padStart(4, "0")}`);
  }
  expect(rows.length).toBeGreaterThan(30);
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  ({ seedDemo, reseed } = await import("../../src/seed/run.js"));
}, SEED_TIMEOUT);
afterAll(async () => { await t?.close(); });

describe("seedDemo", () => {
  it("builds the docs/SEED.md state through the API and its own validation passes", async () => {
    const result = await seedDemo(t.app, { log: () => undefined });
    expect(result.skipped).toBe(false);
    expect(result.integrity?.ok).toBe(true);
    firstCounts = await snapshotCounts();
    expect(firstCounts).toMatchObject({ customers: 12, leads: 8, bookings: 10, visits: 10, tickets: 5, notices: 2, posts: 5, flats: 130 });
  }, SEED_TIMEOUT);

  it("integrity report has zero findings; worked example reproduces SPEC §11 exactly; booking #1 COMPLETED and P1 SOLD", async () => {
    const integrity = await t.request<{ ok: boolean; findings: unknown[]; bookings_checked: number }>("GET", "/api/v1/dues/integrity", { token: admin });
    expect(integrity.status, integrity.text).toBe(200);
    expect(integrity.body.findings).toEqual([]);
    expect(integrity.body.ok).toBe(true);
    const bookings = await t.request<List<Booking>>("GET", "/api/v1/bookings?page_size=50&sort=booking_number", { token: admin });
    const byNumber = [...bookings.body.items].sort((a, b) => a.booking_number.localeCompare(b.booking_number));
    const b1 = byNumber[0]!;
    expect(b1.booking_number).toBe(`BK-${financialYear(b1.booking_date, 4).label}/0001`);
    expect(b1.status).toBe("COMPLETED");
    const ledger = await t.request<List<LedgerRow>>("GET", `/api/v1/bookings/${b1.id}/ledger?page_size=200`, { token: admin });
    const payments = ledger.body.items.filter((r) => r.event === "PAYMENT");
    expect(payments).toHaveLength(10);
    for (const [i, [bucket, amount, cash, account, totalDue]] of WORKED.entries()) {
      expect(payments[i], `row #${i + 1}`).toMatchObject({ bucket, amount_paise: amount, cash_due_paise: cash, account_due_paise: account, total_due_paise: totalDue });
    }
    const [flat] = await t.app.sql<{ status: string; flat_number: string }[]>`select f.status, f.flat_number from bookings b join flats f on f.id = b.flat_id where b.id = ${b1.id}`;
    expect(flat).toEqual({ status: "SOLD", flat_number: "P1" });
    // booking numbers are sequential in creation order
    const numbers = byNumber.map((b) => b.booking_number);
    expect(new Set(numbers).size).toBe(10);
    const statuses = bookings.body.items.map((b) => b.status).sort();
    expect(statuses.filter((s) => s === "CANCELLED")).toHaveLength(1);
    expect(statuses.filter((s) => s === "COMPLETED")).toHaveLength(1);
    await assertReceiptSequence();
  });

  it("Tower C has 52 flats with no 13th floor and no refuge-floor units; the scenario rows exist", async () => {
    const [c] = await t.app.sql<{ id: string }[]>`select id from blocks where code = 'C'`;
    const flats = await t.request<List<{ flat_number: string; floor: number }>>("GET", `/api/v1/flats?block_id=${c!.id}&page_size=200`, { token: admin });
    expect(flats.body.total).toBe(52);
    expect(flats.body.items.some((f) => f.floor === 13 || f.floor === 7 || /^C-13\d\d$/.test(f.flat_number) || /^C-7\d\d$/.test(f.flat_number))).toBe(false);
    const pending = await t.request<List<{ status: string; amount_paise: number }>>("GET", "/api/v1/payments/cheques", { token: admin });
    expect(pending.body.items.some((p) => p.status === "PENDING" && p.amount_paise === 5 * L)).toBe(true);
    const bounced = await t.request<List<{ status: string }>>("GET", "/api/v1/payments/cheques?status=BOUNCED", { token: admin });
    expect(bounced.body.total).toBe(1);
    const reversed = await t.request<List<{ status: string }>>("GET", "/api/v1/payments?status=REVERSED", { token: admin });
    expect(reversed.body.total).toBe(1);
    const [rev] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from agreement_revisions`;
    expect(rev!.n).toBe(1);
    const [contra] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from contra_entries`;
    expect(contra!.n).toBe(1);
    const [stages] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from block_stages bs join blocks b on b.id = bs.block_id where b.code = 'P' and bs.status = 'COMPLETED'`;
    expect(stages!.n).toBe(14);
    const [photos] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from stage_photos where visible_to_buyers and show_on_website`;
    expect(photos!.n).toBe(2 * (14 + 10 + 6 + 2 + 1));
    const visits = await t.app.sql<{ status: string; n: number }[]>`select status, count(*)::int as n from site_visits group by status`;
    expect(Object.fromEntries(visits.map((v) => [v.status, v.n]))).toEqual({ CONFIRMED: 3, RESCHEDULED: 1, COMPLETED: 3, NO_SHOW: 2, CANCELLED: 1 });
    const tickets = await t.app.sql<{ status: string }[]>`select status from service_requests order by status`;
    expect(tickets.map((x) => x.status).sort()).toEqual(["AWAITING_CUSTOMER", "CLOSED", "IN_PROGRESS", "NEW", "RESOLVED"]);
    const [internal] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from service_request_messages where is_internal`;
    expect(internal!.n).toBeGreaterThanOrEqual(1);
    const leads = await t.app.sql<{ stage: string }[]>`select stage from leads`;
    expect(leads.map((l) => l.stage).sort()).toEqual(["CONTACTED", "CONVERTED", "LOST", "NEGOTIATION", "NEW", "NEW", "SITE_VISIT_DONE", "SITE_VISIT_SCHEDULED"]);
    const [downloads] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from brochure_downloads where downloaded_at is not null`;
    expect(downloads!.n).toBe(17);
  });

  it("every customer logs into the portal with Welcome@123 and sees only their own bookings; KYC is masked", async () => {
    const customers = await t.app.sql<{ id: string; phone: string; full_name: string }[]>`select id, phone, full_name from customers order by customer_code`;
    expect(customers).toHaveLength(12);
    for (const c of customers) {
      const login = await t.request<{ access_token: string; user: { must_change_password: boolean } }>("POST", "/api/v1/portal/auth/login", { body: { phone: c.phone, password: "Welcome@123" } });
      expect(login.status, `${c.phone}: ${login.text}`).toBe(200);
      expect(login.body.user.must_change_password).toBe(false);
      const mine = await t.request<{ booking_id: string; booking_number: string }[]>("GET", "/api/v1/portal/bookings", { token: login.body.access_token });
      expect(mine.status).toBe(200);
      const expected = await t.app.sql<{ booking_number: string }[]>`select booking_number from bookings b where b.customer_id = ${c.id} or exists (select 1 from booking_co_applicants ca where ca.booking_id = b.id and ca.customer_id = ${c.id})`;
      expect(mine.body.map((b) => b.booking_number).sort()).toEqual(expected.map((b) => b.booking_number).sort());
      for (const b of mine.body) {
        const home = await t.request<Record<string, unknown>>("GET", `/api/v1/portal/bookings/${b.booking_id}/home`, { token: login.body.access_token });
        expect(home.status, home.text).toBe(200);
        expect(JSON.stringify(home.body)).not.toMatch(/[A-Z]{5}[0-9]{4}[A-Z]/);
      }
    }
    const rajesh = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", { body: { phone: "9876543210", password: "Welcome@123" } });
    const foreign = await t.app.sql<{ id: string }[]>`select id from bookings where customer_id <> (select id from customers where phone = '9876543210') limit 1`;
    expect((await t.request("GET", `/api/v1/portal/bookings/${foreign[0]!.id}/home`, { token: rajesh.body.access_token })).status).toBe(404);
  });

  it("the public website sees both published projects, availability without hold/booked distinctions and GGV without prices", async () => {
    const cards = await t.request<{ slug: string; starting_price_paise: number | null }[]>("GET", "/api/v1/public/projects");
    expect(cards.status, cards.text).toBe(200);
    expect(cards.body.map((c) => c.slug).sort()).toEqual(["ganesh-green-villas", "shree-ganesh-heights"]);
    expect(cards.body.find((c) => c.slug === "ganesh-green-villas")?.starting_price_paise).toBeNull();
    expect(cards.body.find((c) => c.slug === "shree-ganesh-heights")?.starting_price_paise).toBeGreaterThan(0);
    const site = await t.request<{ banners: unknown[]; testimonials: unknown[]; latest_posts: unknown[]; home_sections: unknown[] }>("GET", "/api/v1/public/site");
    expect(site.body.banners).toHaveLength(3);
    expect(site.body.testimonials.length).toBeGreaterThanOrEqual(6);
    expect(site.body.home_sections).toHaveLength(5);
    expect(site.body.latest_posts.length).toBeGreaterThan(0);
  });

  it("seedDemo is idempotent: a second run is skipped and changes nothing", async () => {
    const again = await seedDemo(t.app, { log: () => undefined });
    expect(again.skipped).toBe(true);
    expect(await snapshotCounts()).toEqual(firstCounts);
  });

  it("reseed() restores identical counts and the same receipt numbers; audit_logs keep growing", async () => {
    const receiptsBefore = await receiptNumbers();
    const [auditBefore] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs`;
    await t.app.sql`update customers set notes = 'tampered' where phone = '9876543210'`;
    const r = await reseed(t.app.db, { app: t.app, log: () => undefined });
    expect(r.integrity?.ok).toBe(true);
    expect(r.truncated).toContain("bookings");
    expect(r.truncated).not.toContain("users");
    expect(r.truncated).not.toContain("audit_logs");
    expect(await snapshotCounts()).toEqual(firstCounts);
    expect(await receiptNumbers()).toEqual(receiptsBefore);
    await assertReceiptSequence();
    const [tampered] = await t.app.sql<{ notes: string | null }[]>`select notes from customers where phone = '9876543210'`;
    expect(tampered!.notes).not.toBe("tampered");
    const [auditAfter] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs`;
    expect(auditAfter!.n).toBeGreaterThan(auditBefore!.n);
    const [reseedRows] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs where action = 'admin.reseed'`;
    expect(reseedRows!.n).toBeGreaterThanOrEqual(1);
    // the staff login still works and the booking numbers start again at 0001
    admin = (await t.loginAs("admin")).access_token;
    const bookings = await t.request<List<Booking>>("GET", "/api/v1/bookings?page_size=50", { token: admin });
    expect(bookings.body.items.some((b) => /\/0001$/.test(b.booking_number))).toBe(true);
  }, SEED_TIMEOUT);

  it("POST /admin/reseed with confirm RESEED works for the Super Admin and reports zero integrity findings", async () => {
    const forbidden = await t.request<{ error: { code: string } }>("POST", "/api/v1/admin/reseed", { token: (await t.loginAs("accounts")).access_token, body: { confirm: "RESEED" } });
    expect(forbidden.status).toBe(403);
    const r = await t.request<{ counts: Record<string, number>; integrity: { ok: boolean; findings: unknown[] } }>("POST", "/api/v1/admin/reseed", { token: admin, body: { confirm: "RESEED" }, headers: { "idempotency-key": `reseed-${Date.now()}` } });
    expect(r.status, r.text).toBe(200);
    expect(r.body.integrity.ok).toBe(true);
    expect(r.body.integrity.findings).toEqual([]);
    expect(r.body.counts).toMatchObject({ customers: 12, leads: 8, bookings: 10, site_visits: 10, service_requests: 5, notices: 2, posts_published: 4, posts_draft: 1 });
    expect(await snapshotCounts()).toEqual(firstCounts);
    expect((await t.request("GET", "/api/v1/auth/me", { token: admin })).status).toBe(200);
  }, SEED_TIMEOUT);
});
