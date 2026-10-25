import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_ROLES, type SystemRoleName } from "@kkt/contracts";
import { BOOT_TIMEOUT, bookingBySeq, bootAcceptance, CREDS, key, projectByCode, type ErrorBody, type Harness, type List, type RoleKey } from "./harness.js";

/**
 * SPEC §18 scenario 1 (L242): "Each role sees only permitted menus and APIs; a project-scoped user cannot discover other projects."
 * Menus in the ERP are derived from the permission bundle `/auth/me` returns, so the API-level proof is: each seeded role carries exactly
 * its SPEC §1 bundle, representative endpoints answer 200/403 according to that bundle, and the Project Admin scoped to SGH gets 404
 * (never 403) on GGV ids while GGV is absent from every list and from search.
 */

const ROLE_OF: Record<RoleKey, SystemRoleName> = { admin: "Super Admin", projects: "Project Admin", accounts: "Accounts", sales: "Sales", marketing: "Marketing", employee: "Employee" };

/** Representative staff endpoints and the permission that guards each (API-CONVENTIONS "Permissions"). */
const PROBES: { url: string; permission: string }[] = [
  { url: "/api/v1/projects", permission: "project.read" },
  { url: "/api/v1/users", permission: "users.manage" },
  { url: "/api/v1/roles", permission: "roles.manage" },
  { url: "/api/v1/customers", permission: "customer.read" },
  { url: "/api/v1/leads", permission: "lead.read" },
  { url: "/api/v1/enquiries", permission: "lead.read" },
  { url: "/api/v1/bookings", permission: "booking.read" },
  { url: "/api/v1/payments", permission: "payment.read" },
  { url: "/api/v1/demands", permission: "payment.read" },
  { url: "/api/v1/site-visits", permission: "visit.read" },
  { url: "/api/v1/service-requests", permission: "service.read" },
  { url: "/api/v1/documents", permission: "document.read" },
  { url: "/api/v1/cms/site", permission: "cms.read" },
  { url: "/api/v1/reports", permission: "report.view" },
  { url: "/api/v1/audit-logs", permission: "audit.view" },
  { url: "/api/v1/dues/integrity", permission: "admin.tools" },
  { url: "/api/v1/settings/company", permission: "settings.manage" },
  { url: "/api/v1/payment-plan-assignments", permission: "plan.manage" },
  { url: "/api/v1/dashboard", permission: "dashboard.view" },
];

let h: Harness;
const tokens = {} as Record<RoleKey, string>;
const users = {} as Record<RoleKey, { permissions: string[]; all_projects: boolean; project_ids: string[] }>;

beforeAll(async () => {
  h = await bootAcceptance();
  for (const role of Object.keys(CREDS) as RoleKey[]) {
    const login = await h.loginAs(role);
    tokens[role] = login.access_token;
    users[role] = login.user;
  }
}, BOOT_TIMEOUT);
afterAll(async () => { await h?.close(); });

describe("scenario 1 — roles see only their permitted menus and APIs", () => {
  it("each seeded role carries exactly the SPEC §1 permission bundle of its system role", async () => {
    for (const role of Object.keys(CREDS) as RoleKey[]) {
      const me = await h.request<{ user: { role_name: string; permissions: string[] } }>("GET", "/api/v1/auth/me", { token: tokens[role] });
      expect(me.status, role).toBe(200);
      // SPEC L22–L29: the six system roles with their fixed bundles (menus are rendered from this list)
      expect(me.body.user.role_name, role).toBe(ROLE_OF[role]);
      expect([...me.body.user.permissions].sort(), role).toEqual([...SYSTEM_ROLES[ROLE_OF[role]].permissions].sort());
    }
    // SPEC L23: Super Admin has everything; SPEC L29/L28: Employee is read-only (no write permission at all)
    expect(users.admin.permissions.length).toBeGreaterThan(users.employee.permissions.length);
    expect(users.employee.permissions.some((p) => /\.(write|create|post|manage|update|undo|reverse|clear|cancel|assign|edit)$/.test(p))).toBe(false);
  });

  it("representative endpoints answer 200 exactly when the role holds the guarding permission and 403 FORBIDDEN otherwise", async () => {
    for (const role of Object.keys(CREDS) as RoleKey[]) {
      const allowed = new Set(users[role].permissions);
      for (const probe of PROBES) {
        const r = await h.request<ErrorBody>("GET", probe.url, { token: tokens[role] });
        if (allowed.has(probe.permission)) {
          // SPEC L30: every API endpoint is guarded by a permission → a holder gets through
          expect(r.status, `${role} ${probe.url}`).toBe(200);
        } else {
          // SPEC L30: a non-holder is refused with 403 (API-CONVENTIONS: 403 FORBIDDEN with details.permission)
          expect(r.status, `${role} ${probe.url}`).toBe(403);
          expect(r.body.error.code, `${role} ${probe.url}`).toBe("FORBIDDEN");
          expect(String(r.body.error.details?.["permission"] ?? ""), `${role} ${probe.url}`).toContain(probe.permission);
        }
      }
    }
    // SPEC L242: unauthenticated callers never reach a staff API
    expect((await h.request("GET", "/api/v1/projects")).status).toBe(401);
  });

  it("Sales cannot post payments (403) and Marketing cannot create or read bookings (403)", async () => {
    const admin = tokens.admin;
    const bk = await bookingBySeq(h, admin, 2);
    const modes = await h.request<List<{ id: string; code: string }>>("GET", "/api/v1/masters/payment-modes", { token: admin });
    const cash = modes.body.items.find((m) => m.code === "CASH")!;
    const payment = { booking_id: bk.id, against: "FLAT_VALUE", bucket: "CASH", amount_paise: 100_00, payment_date: h.today, payment_mode_id: cash.id };
    const sales = await h.request<ErrorBody>("POST", "/api/v1/payments", { token: tokens.sales, body: payment, headers: { "idempotency-key": key() } });
    // SPEC L26: Sales "cannot post payments"
    expect(sales.status).toBe(403);
    expect(sales.body.error.code).toBe("FORBIDDEN");
    expect(sales.body.error.details?.["permission"]).toBe("payment.post");
    const before = await h.request<List<unknown>>("GET", `/api/v1/bookings/${bk.id}/payments?page_size=1`, { token: admin });
    const after = await h.request<List<unknown>>("GET", `/api/v1/bookings/${bk.id}/payments?page_size=1`, { token: admin });
    expect(after.body.total).toBe(before.body.total); // nothing was posted
    // SPEC L27: Marketing = CMS + enquiries inbox only → bookings are off limits
    const mkCreate = await h.request<ErrorBody>("POST", "/api/v1/bookings", { token: tokens.marketing, body: { flat_id: bk.flat_id, customer_id: bk.customer_id, booking_date: h.today, agreement_value_paise: 1, cash_agreed_paise: 1, account_agreed_paise: 0 }, headers: { "idempotency-key": key() } });
    expect(mkCreate.status).toBe(403);
    expect(mkCreate.body.error.details?.["permission"]).toBe("booking.create");
    expect((await h.request("GET", "/api/v1/bookings", { token: tokens.marketing })).status).toBe(403);
    expect((await h.request("GET", `/api/v1/bookings/${bk.id}`, { token: tokens.marketing })).status).toBe(403);
    // and the Marketing inbox works (SPEC L27 "enquiries inbox")
    expect((await h.request("GET", "/api/v1/enquiries", { token: tokens.marketing })).status).toBe(200);
  });
});

describe("scenario 1 — a project-scoped user cannot discover other projects", () => {
  it("the Project Admin scoped to SGH sees only SGH in lists and search, and gets 404 NOT_FOUND (never 403) on direct GGV ids", async () => {
    const admin = tokens.admin;
    const pa = tokens.projects;
    const sgh = await projectByCode(h, admin, "SGH");
    const ggv = await projectByCode(h, admin, "GGV");
    // SPEC L9 (SEED.md): projects@sgb.in is scoped to SGH only
    expect(users.projects.all_projects).toBe(false);
    expect(users.projects.project_ids).toEqual([sgh.id]);

    // absence from lists — SPEC L30: "scoped users must not even learn that other projects exist"
    const projects = await h.request<List<{ id: string; code: string }>>("GET", "/api/v1/projects?page_size=50", { token: pa });
    expect(projects.status).toBe(200);
    expect(projects.body.items.map((p) => p.code)).toEqual(["SGH"]);
    const blocks = await h.request<List<{ project_id: string }>>("GET", "/api/v1/blocks?page_size=100", { token: pa });
    expect(blocks.body.items.every((b) => b.project_id === sgh.id)).toBe(true);
    expect(blocks.body.items.length).toBe(3); // towers A, B, C
    const flats = await h.request<List<{ project_id?: string; flat_number: string }>>("GET", "/api/v1/flats?page_size=200", { token: pa });
    expect(flats.body.total).toBe(32 + 32 + 52); // SEED.md tower sizes; no villa (P/Q) flats
    expect(flats.body.items.some((f) => /^[PQ]\d/.test(f.flat_number))).toBe(false);
    const bookings = await h.request<List<{ project_id: string; flat_number: string }>>("GET", "/api/v1/bookings?page_size=100", { token: pa });
    expect(bookings.body.items.length).toBeGreaterThan(0);
    expect(bookings.body.items.every((b) => b.project_id === sgh.id)).toBe(true);
    expect(bookings.body.items.some((b) => /^[PQ]\d/.test(b.flat_number))).toBe(false);
    const ggvBookings = await h.request<List<unknown>>("GET", `/api/v1/bookings?project_id=${ggv.id}`, { token: pa });
    expect([200, 404]).toContain(ggvBookings.status);
    if (ggvBookings.status === 200) expect(ggvBookings.body.total).toBe(0);
    const search = await h.request<{ results: { type: string; id: string; label?: string }[] }>("GET", "/api/v1/search?q=Ganesh", { token: pa });
    expect(search.status).toBe(200);
    expect(search.body.results.some((r) => r.id === ggv.id)).toBe(false);
    expect(search.body.results.some((r) => r.id === sgh.id)).toBe(true);
    const villaSearch = await h.request<{ results: { label?: string; title?: string }[] }>("GET", "/api/v1/search?q=Villa", { token: pa });
    expect(JSON.stringify(villaSearch.body)).not.toContain(ggv.id);

    // 404 on direct ids — SPEC L30 "(return not-found, not forbidden)"; API-CONVENTIONS: 404 NOT_FOUND also for out-of-scope
    const ggvBlock = (await h.request<List<{ id: string }>>("GET", `/api/v1/blocks?project_id=${ggv.id}&page_size=10`, { token: admin })).body.items[0]!;
    const ggvFlat = (await h.request<List<{ id: string }>>("GET", `/api/v1/flats?block_id=${ggvBlock.id}&page_size=1`, { token: admin })).body.items[0]!;
    const worked = await bookingBySeq(h, admin, 1); // GGV P1
    const ggvPayment = (await h.request<List<{ id: string }>>("GET", `/api/v1/bookings/${worked.id}/payments?page_size=1`, { token: admin })).body.items[0]!;
    for (const url of [
      `/api/v1/projects/${ggv.id}`, `/api/v1/projects/${ggv.id}/website`, `/api/v1/projects/${ggv.id}/construction`, `/api/v1/projects/${ggv.id}/parking`, `/api/v1/projects/${ggv.id}/visit-settings`,
      `/api/v1/blocks/${ggvBlock.id}`, `/api/v1/blocks/${ggvBlock.id}/grid`, `/api/v1/blocks/${ggvBlock.id}/construction`, `/api/v1/blocks/${ggvBlock.id}/applicable-plans`,
      `/api/v1/flats/${ggvFlat.id}`, `/api/v1/bookings/${worked.id}`, `/api/v1/bookings/${worked.id}/ledger`, `/api/v1/bookings/${worked.id}/statement.pdf`, `/api/v1/payments/${ggvPayment.id}`,
    ]) {
      const r = await h.request<ErrorBody>("GET", url, { token: pa });
      expect(r.status, url).toBe(404);
      expect(r.body.error.code, url).toBe("NOT_FOUND");
    }
    // the same ids work for the unscoped admin, so the 404 is scope, not absence
    expect((await h.request("GET", `/api/v1/projects/${ggv.id}`, { token: admin })).status).toBe(200);
    expect((await h.request("GET", `/api/v1/bookings/${worked.id}`, { token: admin })).status).toBe(200);
    // writes outside the scope are 404 too (not 403): the user holds flat.status but cannot discover the flat
    const write = await h.request<ErrorBody>("POST", `/api/v1/flats/${ggvFlat.id}/status`, { token: pa, body: { version: 1, status: "HOLD" } });
    expect(write.status).toBe(404);
    // and inside the scope the same role works
    const sghBlocks = await h.request<List<{ id: string }>>("GET", `/api/v1/blocks?project_id=${sgh.id}`, { token: pa });
    expect(sghBlocks.status).toBe(200);
    expect((await h.request("GET", `/api/v1/blocks/${sghBlocks.body.items[0]!.id}/construction`, { token: pa })).status).toBe(200);
  });
});
