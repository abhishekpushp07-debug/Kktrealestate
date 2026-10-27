import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialYear, parseNumber, todayIST } from "@kkt/domain";
import { buildTestApp, type TestContext } from "./helpers.js";

/**
 * `pnpm --filter @kkt/api seed:scale` (docs/SEED.md "Production-size data") at a small factor on the test database: it runs the demo seed
 * on the empty database, adds the scale company and the generated volume, comes out integrity-clean for both companies, and leaves a
 * database the API keeps working on — the generated logins sign in with the right scope and tenant, a buyer's portal sees their own
 * booking and ledger, and new payments, bookings and tickets continue every number series without a collision.
 */
type List<T> = { items: T[]; total?: number | null };
type ScaleModule = typeof import("../../src/seed/scale.js");

let t: TestContext;
let scale: ScaleModule;
let result: Awaited<ReturnType<ScaleModule["seedScale"]>>;
let scaleCompanyId: string;

beforeAll(async () => {
  t = await buildTestApp();
  scale = await import("../../src/seed/scale.js");
  result = await scale.seedScale(t.app, { factor: 0.01, log: () => undefined });
  const [c] = await t.app.sql<{ id: string }[]>`select id from companies where slug = ${scale.SCALE_COMPANY.slug}`;
  scaleCompanyId = c!.id;
}, 15 * 60_000);

afterAll(async () => {
  await t?.close();
});

async function count(query: string, ...params: unknown[]): Promise<number> {
  const rows = await t.app.sql.unsafe<{ n: number }[]>(query, params as never[]);
  return Number(rows[0]?.n ?? 0);
}

describe("scale seed", () => {
  it("adds the second company and the volume, integrity-clean for both companies", async () => {
    expect(result.skipped).toBe(false);
    expect(result.integrity).toHaveLength(2);
    for (const r of result.integrity) {
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.findings).toBe(0);
      expect(r.bookings_checked).toBeGreaterThan(0);
    }
    expect(result.totals["companies"]).toBe(2);
    expect(result.totals["projects"]).toBe(20);
    const v = scale.scaleVolumes(0.01);
    expect(result.totals["bookings"]).toBe(10 + v.bookings);
    expect(result.totals["customers"]).toBeGreaterThanOrEqual(12 + v.customers - 1);
    expect(result.totals["portal_users"]).toBe(result.totals["customers"]);
    expect(result.totals["payments"]!).toBeGreaterThan(5 * v.bookings);
    // a fresh report through the integrity endpoint agrees
    const admin = (await t.loginAs("admin")).access_token;
    const report = await t.request<{ ok: boolean; findings: unknown[] }>("GET", "/api/v1/dues/integrity", {
      token: admin,
    });
    expect(report.status, report.text).toBe(200);
    expect(report.body.ok, report.text).toBe(true);
    // no tenant shares a master row with the other
    expect(
      await count(
        `select count(*)::int as n from flats f join flat_types ft on ft.id = f.flat_type_id where ft.company_id <> f.company_id`,
      ),
    ).toBe(0);
    expect(
      await count(
        `select count(*)::int as n from bookings b join payment_plans p on p.id = b.payment_plan_id where p.company_id <> b.company_id`,
      ),
    ).toBe(0);
  });

  it("every staff and portal read of the generated rows passes its response schema", async () => {
    const admin = (await t.loginAs("admin")).access_token;
    const pid = (await t.login("admin@pid.in", scale.SCALE_STAFF_PASSWORD)).access_token;
    for (const token of [admin, pid]) {
      const lists = [
        "/projects",
        "/blocks",
        "/flats",
        "/customers",
        "/customers?search=kumar",
        "/leads",
        "/bookings",
        "/bookings?view=full",
        "/payments",
        "/demands",
        "/service-requests",
        "/users",
        "/audit-logs",
      ];
      for (const path of lists) {
        const r = await t.request<List<{ id: string }>>(
          "GET",
          `/api/v1${path}${path.includes("?") ? "&" : "?"}page_size=200`,
          {
            token,
          },
        );
        expect(r.status, `${path}: ${r.text.slice(0, 300)}`).toBe(200);
      }
      const bookings = await t.request<List<{ id: string }>>("GET", "/api/v1/bookings?page_size=5", { token });
      for (const b of bookings.body.items)
        for (const suffix of ["", "/ledger", "/demands", "/payments", "/schedule"]) {
          const r = await t.request("GET", `/api/v1/bookings/${b.id}${suffix}`, { token });
          expect(r.status, `${b.id}${suffix}: ${r.text.slice(0, 300)}`).toBe(200);
        }
      const customers = await t.request<List<{ id: string }>>("GET", "/api/v1/customers?page_size=3", { token });
      for (const c of customers.body.items) {
        const r = await t.request("GET", `/api/v1/customers/${c.id}`, { token });
        expect(r.status, r.text.slice(0, 300)).toBe(200);
      }
      const tickets = await t.request<List<{ id: string }>>("GET", "/api/v1/service-requests?page_size=3", { token });
      for (const x of tickets.body.items) {
        const r = await t.request("GET", `/api/v1/service-requests/${x.id}`, { token });
        expect(r.status, r.text.slice(0, 300)).toBe(200);
      }
      const leads = await t.request<List<{ id: string }>>("GET", "/api/v1/leads?page_size=3", { token });
      for (const x of leads.body.items) {
        const r = await t.request("GET", `/api/v1/leads/${x.id}`, { token });
        expect(r.status, r.text.slice(0, 300)).toBe(200);
      }
      const dash = await t.request("GET", "/api/v1/dashboard", { token });
      expect(dash.status, dash.text.slice(0, 300)).toBe(200);
    }
  });

  it("is idempotent: a second run is skipped", async () => {
    const again = await scale.seedScale(t.app, { factor: 0.01, log: () => undefined });
    expect(again.skipped).toBe(true);
  });

  it("generated staff sign in with their role and project scope; the second tenant sees only its own data", async () => {
    const [scoped] = await t.app.sql<{ email: string; projects: string[] }[]>`
      select u.email, array_agg(s.project_id::text) as projects from users u join user_project_scopes s on s.user_id = u.id
      join roles r on r.id = u.role_id where r.name = 'Sales' and u.email like 'sales.%@sgb.in' group by u.email limit 1`;
    expect(scoped).toBeDefined();
    const sales = await t.login(scoped!.email, scale.SCALE_STAFF_PASSWORD);
    const projects = await t.request<List<{ id: string }>>("GET", "/api/v1/projects?page_size=100", {
      token: sales.access_token,
    });
    expect(projects.status, projects.text).toBe(200);
    expect(projects.body.items.map((p) => p.id).sort()).toEqual([...scoped!.projects].sort());

    const pidAdmin = await t.login("admin@pid.in", scale.SCALE_STAFF_PASSWORD);
    const bookings = await t.request<List<{ id: string; booking_number: string }>>(
      "GET",
      "/api/v1/bookings?page_size=100",
      {
        token: pidAdmin.access_token,
      },
    );
    expect(bookings.status, bookings.text).toBe(200);
    const own = await count("select count(*)::int as n from bookings where company_id = $1", scaleCompanyId);
    expect(own).toBeGreaterThan(0);
    expect(bookings.body.items.length).toBe(Math.min(100, own));
    const ids = bookings.body.items.map((b) => b.id);
    expect(
      await count(
        "select count(*)::int as n from bookings where id = any($1::uuid[]) and company_id <> $2",
        ids,
        scaleCompanyId,
      ),
    ).toBe(0);
  });

  it("a generated buyer's portal shows their booking and a ledger that matches the stored summary", async () => {
    const [b] = await t.app.sql<
      { id: string; phone: string; cash_due: number; account_due: number; company_slug: string }[]
    >`select b.id, c.phone, (b.cash_order_raised_paise - b.cash_paid_paise)::bigint as cash_due,
        (b.account_order_raised_paise - b.account_paid_paise)::bigint as account_due, co.slug as company_slug
      from bookings b join customers c on c.id = b.customer_id join companies co on co.id = b.company_id
      where co.slug = ${scale.SCALE_COMPANY.slug} and b.cash_paid_paise > 0 order by b.booking_number limit 1`;
    expect(b).toBeDefined();
    const login = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: b!.phone, password: scale.SCALE_PORTAL_PASSWORD },
    });
    expect(login.status, login.text).toBe(200);
    const token = login.body.access_token;
    const mine = await t.request<{ booking_id: string }[]>("GET", "/api/v1/portal/bookings", { token });
    expect(mine.status, mine.text).toBe(200);
    expect(mine.body.map((x) => x.booking_id)).toEqual([b!.id]);
    const ledger = await t.request<{ summary: { cash_due_paise: number; account_due_paise: number } }>(
      "GET",
      `/api/v1/portal/bookings/${b!.id}/ledger`,
      { token },
    );
    expect(ledger.status, ledger.text).toBe(200);
    expect(ledger.body.summary.cash_due_paise).toBe(Number(b!.cash_due));
    expect(ledger.body.summary.account_due_paise).toBe(Number(b!.account_due));
    for (const suffix of ["home", "flat", "receipts", "demands", "schedule", "construction", "documents"]) {
      const r = await t.request("GET", `/api/v1/portal/bookings/${b!.id}/${suffix}`, { token });
      expect(r.status, `${suffix}: ${r.text.slice(0, 300)}`).toBe(200);
    }
    const requests = await t.request("GET", "/api/v1/portal/requests", { token });
    expect(requests.status, requests.text.slice(0, 300)).toBe(200);
  });

  it("the API continues every number series after the generated rows (payment, booking, ticket)", async () => {
    const accounts = (await t.loginAs("accounts")).access_token;
    const admin = (await t.loginAs("admin")).access_token;
    const fy = financialYear(todayIST()).label;
    const [target] = await t.app.sql<{ id: string; headroom: number }[]>`
      select b.id, (b.account_agreed_paise - b.account_paid_paise - b.pending_cheques_paise)::bigint as headroom
      from bookings b where b.company_id = ${t.companyId} and b.status = 'ACTIVE' and b.booking_number not like '%/000%'
      order by headroom desc limit 1`;
    const [mode] = await t.app.sql<{ id: string }[]>`
      select id from payment_modes where company_id = ${t.companyId} and code = 'NEFT_RTGS'`;
    const [bank] = await t.app.sql<{ id: string }[]>`
      select id from bank_accounts where company_id = ${t.companyId} order by is_default desc limit 1`;
    const maxSeq = async (table: string, column: string, prefix: string): Promise<number> => {
      const rows = await t.app.sql.unsafe<{ v: string }[]>(
        `select ${column} as v from ${table} where company_id = $1 and ${column} like $2`,
        [t.companyId, `${prefix}${fy}/%`],
      );
      return Math.max(0, ...rows.map((r) => parseNumber(r.v)?.seq ?? 0));
    };
    const receiptsBefore = await maxSeq("payments", "receipt_number", "SGB/");
    const pay = await t.request<{ payment: { receipt_number: string } }>("POST", "/api/v1/payments", {
      token: accounts,
      headers: { "idempotency-key": `scale-${Date.now()}` },
      body: {
        booking_id: target!.id,
        against: "FLAT_VALUE",
        bucket: "ACCOUNT",
        amount_paise: 1_000_00,
        payment_date: todayIST(),
        payment_mode_id: mode!.id,
        bank_account_id: bank!.id,
        instrument: { number: "UTR-SCALE-TEST-1" },
      },
    });
    expect(pay.status, pay.text).toBe(201);
    expect(parseNumber(pay.body.payment.receipt_number)?.seq).toBe(receiptsBefore + 1);

    const [flat] = await t.app.sql<{ id: string; price: number }[]>`
      select f.id, f.price_paise::bigint as price from flats f join projects p on p.id = f.project_id
      where f.company_id = ${t.companyId} and f.status = 'AVAILABLE' and p.code like 'SGB%' order by f.flat_number limit 1`;
    const [customer] = await t.app.sql<{ id: string }[]>`
      select c.id from customers c where c.company_id = ${t.companyId}
        and not exists (select 1 from bookings b where b.customer_id = c.id) order by c.customer_code limit 1`;
    const bookingsBefore = await maxSeq("bookings", "booking_number", "BK-");
    const sales = (await t.loginAs("sales")).access_token;
    const price = Number(flat!.price);
    const created = await t.request<{ booking_number: string }>("POST", "/api/v1/bookings", {
      token: sales,
      headers: { "idempotency-key": `scale-bk-${Date.now()}` },
      body: {
        flat_id: flat!.id,
        customer_id: customer!.id,
        booking_date: todayIST(),
        agreement_value_paise: price,
        cash_agreed_paise: 0,
        account_agreed_paise: price,
        plan_accepted_on: todayIST(),
        plan_acceptance_mode: "IN_PERSON",
      },
    });
    expect(created.status, created.text).toBe(201);
    expect(parseNumber(created.body.booking_number)?.seq).toBe(bookingsBefore + 1);

    const ticketsBefore = await maxSeq("service_requests", "ticket_number", "SR-");
    const [category] = await t.app.sql<{ id: string }[]>`
      select id from service_categories where company_id = ${t.companyId} order by sort_order limit 1`;
    const ticket = await t.request<{ ticket_number: string }>("POST", "/api/v1/service-requests", {
      token: admin,
      headers: { "idempotency-key": `scale-sr-${Date.now()}` },
      body: {
        customer_id: customer!.id,
        category_id: category!.id,
        subject: "Scale seed follow-up",
        description: "Ticket raised after the scale seed",
      },
    });
    expect(ticket.status, ticket.text).toBe(201);
    expect(parseNumber(ticket.body.ticket_number)?.seq).toBe(ticketsBefore + 1);

    const report = await t.request<{ ok: boolean }>("GET", "/api/v1/dues/integrity", { token: admin });
    expect(report.status, report.text).toBe(200);
    expect(report.body.ok, report.text).toBe(true);
  });
});
