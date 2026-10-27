import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, CREDS, type ErrorBody, type TestContext } from "./helpers.js";
import { csvExportLimits } from "../../src/lib/list.js";
import { clearTenantCache } from "../../src/lib/tenant.js";

/**
 * Adversarial review of the phase 7 security track (docs/hardening/phase7-review-security.md). Each test fails on the code as the track
 * left it:
 * 1. X-Export-Cursor from a network client paged a whole table as unaudited, export-budget-free CSV pages;
 * 2. dues / integrity / hold-expiry job results (keyed by company id, or arrays of booking and flat numbers) reached every tenant's admin;
 * 3. a transient failure of a cookie refresh cleared the session cookie (signed the user out);
 * 4. AUDIT_SEAL sealed past a still-open transaction, whose rows then made verify report tampering;
 * 5. erasure scrubbed names inside longer names ("Ravi Kumar" inside "Ravi Kumaran") in other customers' notifications.
 */
let t: TestContext;
let admin: string;
let base: string;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const addr = t.app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await t?.close();
});

async function newCustomer(name: string, phone: string): Promise<{ id: string }> {
  const r = await t.request<{ id: string }>("POST", "/api/v1/customers", {
    token: admin,
    body: { full_name: name, phone, co_applicants: [] },
  });
  if (r.status !== 201) throw new Error(`customer create failed: ${r.text}`);
  return r.body;
}

async function exportAudits(): Promise<{ async_export: boolean; row_count: number }[]> {
  return t.app.sql<{ async_export: boolean; row_count: number }[]>`
    select (after->>'async_export')::boolean as async_export, (after->>'row_count')::int as row_count
    from audit_logs where action = 'export.csv' and entity_type = 'customers' order by created_at, id`;
}

describe("1. X-Export-Cursor is honoured for the in-process export job only", () => {
  it("a network client sending it gets an ordinary, audited CSV export; the job's in-process pages still keyset-page", async () => {
    for (let i = 0; i < 3; i++) await newCustomer(`Cursor Customer ${i}`, `970001000${i}`);
    const pageRows = csvExportLimits.pageRows;
    csvExportLimits.pageRows = 1;
    try {
      // in-process (the EXPORT_CSV job's path): one row per page and a next cursor
      const job = await t.request("GET", "/api/v1/customers?format=csv", {
        token: admin,
        headers: { "x-export-cursor": "start" },
      });
      expect(job.status, job.text).toBe(200);
      const next = job.headers["x-export-next-cursor"];
      expect(typeof next).toBe("string");
      const before = (await exportAudits()).length;

      // the same header over the network: ignored — the whole list, no cursor, an export.csv row with async_export=false
      const start = await fetch(`${base}/api/v1/customers?format=csv`, {
        headers: { authorization: `Bearer ${admin}`, "x-export-cursor": "start" },
      });
      expect(start.status).toBe(200);
      expect(start.headers.get("x-export-next-cursor")).toBeNull();
      const lines = (await start.text()).trim().split("\r\n");
      expect(lines.length - 1).toBeGreaterThanOrEqual(3);

      // a continuation cursor over the network used to return a page with NO audit row and no export budget
      const cont = await fetch(`${base}/api/v1/customers?format=csv`, {
        headers: { authorization: `Bearer ${admin}`, "x-export-cursor": String(next) },
      });
      expect(cont.status).toBe(200);
      expect(cont.headers.get("x-export-next-cursor")).toBeNull();
      await cont.text();
      const after = await exportAudits();
      expect(after.length).toBe(before + 2);
      expect(after.slice(-2).map((a) => a.async_export)).toEqual([false, false]);
      expect(after.slice(-1)[0]!.row_count).toBeGreaterThanOrEqual(3);
    } finally {
      csvExportLimits.pageRows = pageRows;
    }
  });

  it("over the network the header does not dodge the export budget; the job's own pages never spend it", async () => {
    const { config } = await import("../../src/config.js");
    const cfg = config as { EXPORT_RATE_LIMIT_PER_MIN: number };
    const limit = cfg.EXPORT_RATE_LIMIT_PER_MIN;
    const sales = (await t.loginAs("sales")).access_token;
    try {
      cfg.EXPORT_RATE_LIMIT_PER_MIN = 1;
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await fetch(`${base}/api/v1/customers?format=csv`, {
          headers: { authorization: `Bearer ${sales}`, "x-export-cursor": "not-the-first-page" },
        });
        statuses.push(r.status);
        await r.text();
      }
      expect(statuses).toContain(429);
      // in-process job pages (admin has exported over the network this minute already): not counted, however many
      for (let i = 0; i < 3; i++) {
        const r = await t.request("GET", "/api/v1/customers?format=csv", {
          token: admin,
          headers: { "x-export-cursor": "start" },
        });
        expect(r.status, r.text).toBe(200);
      }
    } finally {
      cfg.EXPORT_RATE_LIMIT_PER_MIN = limit;
    }
  });
});

describe("2. job results never show one tenant another tenant's data", () => {
  let companyB: string;
  let bAdmin: string;

  beforeAll(async () => {
    const [c] = await t.app.sql<{ id: string }[]>`
      insert into companies (name, slug, fy_start_month, numbering, settings)
      select 'Review Builders B', 'review-builders-b', fy_start_month, numbering, settings
      from companies where id = ${t.companyId} returning id`;
    companyB = c!.id;
    clearTenantCache();
    const { hashPassword } = await import("../../src/lib/password.js");
    const [roleB] = await t.app.sql<{ id: string }[]>`
      insert into roles (company_id, name, description, permissions, is_system)
      select ${companyB}, name, description, permissions, is_system from roles where company_id = ${t.companyId} and name = 'Super Admin' returning id`;
    await t.app.sql`insert into users (company_id, name, email, role_id, password_hash, must_change_password)
      values (${companyB}, 'Review B Admin', 'review.b@second.in', ${roleB!.id}, ${await hashPassword("Review-B-12345")}, false)`;
    const login = await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", {
      body: { email: "review.b@second.in", password: "Review-B-12345", company: "review-builders-b" },
    });
    expect(login.status, login.text).toBe(200);
    bAdmin = login.body.access_token;
  });
  afterAll(() => clearTenantCache());

  it("dues results keyed by company id, and cross-company arrays (flat numbers, failures), are hidden from the other tenant", async () => {
    const dues = {
      as_of: "2026-10-27",
      bookings_failed: 1,
      [t.companyId]: {
        bookings_checked: 4,
        demand_numbers: ["DEM-A-0001"],
        failures: [{ booking_id: "x", booking_number: "BK-A-0042", code: "INTERNAL" }],
      },
      [companyB]: { bookings_checked: 0, demand_numbers: [], failures: [] },
    };
    const holds = { released: 2, checked: 2, flat_numbers: ["A-101", "A-102"] };
    const ids: string[] = [];
    for (const [job, result] of [
      ["DAILY_DUES", dues],
      ["HOLD_EXPIRY", holds],
    ] as const) {
      const [run] = await t.app.sql<{ id: string }[]>`
        insert into job_runs (job_name, status, result, finished_at) values (${job}, 'OK', ${JSON.stringify(result)}::jsonb, now()) returning id`;
      ids.push(run!.id);
    }
    const [duesRun, holdRun] = ids as [string, string];

    const seenB = await t.request<{ result: Record<string, unknown> }>("GET", `/api/v1/admin/jobs/runs/${duesRun}`, {
      token: bAdmin,
    });
    expect(seenB.status, seenB.text).toBe(200);
    expect(JSON.stringify(seenB.body.result)).not.toContain("BK-A-0042");
    expect(JSON.stringify(seenB.body.result)).not.toContain("DEM-A-0001");
    expect(JSON.stringify(seenB.body.result)).not.toContain(t.companyId);
    expect(seenB.body.result).toMatchObject({ as_of: "2026-10-27", [companyB]: { bookings_checked: 0 } });
    const holdB = await t.request<{ result: Record<string, unknown> }>("GET", `/api/v1/admin/jobs/runs/${holdRun}`, {
      token: bAdmin,
    });
    expect(holdB.body.result).toEqual({ released: 2, checked: 2 });

    // the lists and the jobs overview apply the same rule
    const list = await t.request<{ items: { id: string; result: unknown }[] }>(
      "GET",
      "/api/v1/admin/jobs/runs?page_size=100",
      { token: bAdmin },
    );
    expect(list.status, list.text).toBe(200);
    const listed = JSON.stringify(list.body.items.filter((i) => ids.includes(i.id)));
    expect(listed).not.toContain("BK-A-0042");
    expect(listed).not.toContain("A-101");
    const overview = await t.request("GET", "/api/v1/admin/jobs", { token: bAdmin });
    expect(overview.status, overview.text).toBe(200);
    expect(overview.text).not.toContain("BK-A-0042");
    expect(overview.text).not.toContain("A-101");
    const system = await t.request("GET", "/api/v1/admin/system", { token: bAdmin });
    expect(system.status, system.text).toBe(200);
    expect(system.text).not.toContain("BK-A-0042");

    // company A still sees its own entry
    const seenA = await t.request<{ result: Record<string, unknown> }>("GET", `/api/v1/admin/jobs/runs/${duesRun}`, {
      token: admin,
    });
    expect(JSON.stringify(seenA.body.result)).toContain("BK-A-0042");
    expect(JSON.stringify(seenA.body.result)).not.toContain(companyB);
  });

  it("companyJobResult: a sole tenant sees everything; a result naming a company_id is shown to that company only", async () => {
    const { companyJobResult } = await import("../../src/modules/admin/tools.js");
    const r = { released: 1, flat_numbers: ["A-1"] };
    expect(companyJobResult(r, { companyId: t.companyId, soleTenant: true })).toEqual(r);
    expect(companyJobResult(r, { companyId: t.companyId, soleTenant: false })).toEqual({ released: 1 });
    const own = { company_id: companyB, rows: 3, detail: ["x"] };
    expect(companyJobResult(own, { companyId: companyB, soleTenant: false })).toEqual(own);
    expect(companyJobResult(own, { companyId: t.companyId, soleTenant: false })).toBeNull();
    const per = { companies: 2, by_company: { [companyB]: { bookings_checked: 3 }, [t.companyId]: { x: 1 } } };
    expect(companyJobResult(per, { companyId: companyB, soleTenant: false })).toEqual({
      companies: 2,
      bookings_checked: 3,
    });
  });
});

describe("3. a transient refresh failure keeps the session cookie", () => {
  it("a lock timeout while rotating answers an error but does not clear kkt_rt; the same cookie refreshes afterwards", async () => {
    const login = await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", {
      body: CREDS.marketing,
      headers: { "x-kkt-session": "cookie" },
    });
    expect(login.status, login.text).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie : [String(setCookie)]).find((c) => c.startsWith("kkt_rt="))!;
    const value = cookie.split(";")[0]!.slice("kkt_rt=".length);
    const { sha256 } = await import("../../src/lib/crypto.js");
    const tokenHash = sha256(decodeURIComponent(value));
    const headers = { cookie: `kkt_rt=${value}`, "x-kkt-session": "cookie" };

    const failed = await t.app.sql.begin(async (tx) => {
      await tx`select id from refresh_tokens where token_hash = ${tokenHash} for update`;
      return t.request<ErrorBody>("POST", "/api/v1/auth/refresh", { headers });
    });
    expect(failed.status, failed.text).not.toBe(200);
    expect(failed.status).not.toBe(401);
    const cleared = failed.headers["set-cookie"];
    expect(String(cleared ?? "")).not.toMatch(/kkt_rt=;/);

    const ok = await t.request<{ access_token: string }>("POST", "/api/v1/auth/refresh", { headers });
    expect(ok.status, ok.text).toBe(200);
  }, 20_000);

  it("a dead session (401) still clears the cookie", async () => {
    const r = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      headers: { cookie: "kkt_rt=rt_not-a-real-token-at-all", "x-kkt-session": "cookie" },
    });
    expect(r.status).toBe(401);
    expect(String(r.headers["set-cookie"] ?? "")).toMatch(/kkt_rt=;.*Max-Age=0/);
  });
});

describe("4. AUDIT_SEAL never seals past a transaction that is still open", () => {
  it("rows of a long transaction committing after later rows are sealed in order; verify stays clean", async () => {
    const { sealAuditLog, verifyAuditChain } = await import("../../src/modules/audit/seal.js");
    await sealAuditLog(t.app.db, { lagSeconds: 0 });
    const conn = await t.app.sql.reserve();
    try {
      await conn`begin`;
      // created_at = now() = the start of this transaction, which commits only after the rows below
      await conn`insert into audit_logs (company_id, actor_type, action, entity_type)
        values (${t.companyId}, 'SYSTEM', 'review.long_tx', 'x')`;
      for (let i = 0; i < 3; i++) await t.loginAs("employee"); // later rows, committed at once
      const first = await sealAuditLog(t.app.db, { lagSeconds: 0 });
      expect(first.rows_sealed).toBe(0); // everything newer than the open transaction waits
      await conn`commit`;
    } finally {
      conn.release();
    }
    const second = await sealAuditLog(t.app.db, { lagSeconds: 0 });
    expect(second.rows_sealed).toBeGreaterThanOrEqual(4);
    const v = await verifyAuditChain(t.app.db, t.companyId);
    expect(v.first_mismatch, JSON.stringify(v)).toBeNull();
    expect(v.ok).toBe(true);
    expect(v.unsealed_rows).toBe(0);
  });
});

describe("5. erasure scrubs whole names, phones and e-mails only", () => {
  it("erasing Ravi Kumar leaves a notification about Ravi Kumaran (and a longer e-mail) untouched", async () => {
    const cust = await t.request<{ id: string }>("POST", "/api/v1/customers", {
      token: admin,
      body: { full_name: "Ravi Kumar", phone: "9700020001", email: "ravi@kkt.example.in", co_applicants: [] },
    });
    expect(cust.status, cust.text).toBe(201);
    const [adminUser] = await t.app.sql<{ id: string }[]>`select id from users where email = ${CREDS.admin.email}`;
    await t.app.sql`insert into notifications (company_id, recipient_type, recipient_id, type, title, body) values
      (${t.companyId}, 'STAFF', ${adminUser!.id}, 'LEAD_ASSIGNED', 'Call Ravi Kumaran today', 'mail xravi@kkt.example.in'),
      (${t.companyId}, 'STAFF', ${adminUser!.id}, 'LEAD_ASSIGNED', 'Call Ravi Kumar today', 'mail ravi@kkt.example.in')`;
    const [other] = await t.app.sql<{ id: string }[]>`
      insert into booking_drafts (company_id, user_id, payload) values (${t.companyId}, ${adminUser!.id},
        ${JSON.stringify({ customer: { full_name: "Other", email: "xravi@kkt.example.in" } })}::jsonb) returning id`;
    const r = await t.request<{ anonymised: Record<string, number | boolean> }>(
      "POST",
      `/api/v1/admin/customers/${cust.body.id}/erase`,
      { token: admin, body: { confirm: "ERASE" }, headers: { "idempotency-key": "review-erase-tokens" } },
    );
    expect(r.status, r.text).toBe(200);
    const notes = await t.app.sql<{ title: string; body: string }[]>`
      select title, body from notifications where company_id = ${t.companyId} and title like 'Call %today' order by title`;
    expect(notes.find((n) => n.title.includes("Kumaran"))).toEqual({
      title: "Call Ravi Kumaran today",
      body: "mail xravi@kkt.example.in",
    });
    const scrubbed = notes.find((n) => !n.title.includes("Kumaran"))!;
    expect(scrubbed.title).not.toContain("Ravi Kumar");
    expect(scrubbed.body).not.toContain("ravi@kkt.example.in");
    const [d] = await t.app.sql<{ payload: unknown }[]>`select payload from booking_drafts where id = ${other!.id}`;
    expect(JSON.stringify(d!.payload)).toContain("xravi@kkt.example.in");
  });
});
