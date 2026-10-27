/**
 * Phase 7 foundation (docs/hardening/phase7-foundation.md):
 * - database errors map onto client envelopes through real queries (23514 → 422 CONSTRAINT_VIOLATION, 23503 → 409 IN_USE / 422,
 *   23505 → 409 DUPLICATE, 23502 → 422, class 22 → 400 VALIDATION_ERROR, domain MoneyError → 422 INVALID_AMOUNT), including the audit's
 *   500 on regenerating flats that once had a (cancelled) booking;
 * - versions (contract C6): ETag "v<n>" on single resources, If-Match "v<n>" / legacy forms / body expected_version, 428 when missing,
 *   409 with details.current_version when stale, required on state-change POSTs and DELETEs; other-charge line versions;
 * - tenant resolution (contract C4): principal, x-kkt-company slug, Host, the only company, else 400 COMPANY_REQUIRED;
 * - list paging bound (page ≤ 1000) and PLC precision (a 3-decimal percent is 400, never a 500 at pricing time).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ConstraintViolationDetailsSchema, InUseDetailsSchema, VersionConflictDetailsSchema } from "@kkt/contracts";
import { todayIST } from "@kkt/domain";
import { createMoneyWorld, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

const L = 10_000_000;
const CR = 100 * L;

let t: TestContext;
let admin: string;
let w: MoneyWorld;

/** Raw statements run by the test route inside a transaction (the way services hit the database). */
const CASES: Record<string, string> = {
  check: "UPDATE companies SET slug = 'Not A Slug' WHERE id = (SELECT id FROM companies ORDER BY created_at LIMIT 1)",
  fk_missing:
    "INSERT INTO report_presets (company_id, user_id, report_key, name) SELECT id, gen_random_uuid(), 'COLLECTIONS', 'x' FROM companies LIMIT 1",
  in_use: "DELETE FROM roles WHERE id = (SELECT role_id FROM users ORDER BY created_at LIMIT 1)",
  not_null: "INSERT INTO companies (name) VALUES (NULL)",
  unique: "INSERT INTO roles (company_id, name) SELECT company_id, name FROM roles LIMIT 1",
  "22P02": "SELECT 'not-a-uuid'::uuid",
  "22003": "SELECT 2147483648::int",
  "22007": "SELECT 'not-a-date'::date",
  "22008": "SELECT '2025-02-30'::date",
  "22023": "SELECT set_config('statement_timeout', 'soon', true)",
  "2201X": "SELECT 1 OFFSET -1",
  "22012": "SELECT 1 / 0",
};

beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  const { sql } = await import("drizzle-orm");
  const { toBasisPoints } = await import("@kkt/domain");
  t = await buildTestApp({
    extraRoutes: (api) => {
      route(api, {
        method: "POST",
        url: "/_test/pg/:case",
        permission: "master.write",
        schema: { params: z.object({ case: z.string() }), response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async (req) => {
          const statement = CASES[req.params.case];
          if (!statement) throw new Error("unknown case");
          await api.db.transaction(async (tx) => {
            await tx.execute(sql.raw(statement));
          });
          return { ok: true };
        },
      });
      route(api, {
        method: "POST",
        url: "/_test/money",
        permission: "master.write",
        schema: { response: { 200: z.object({ bp: z.number() }) } },
        handler: async () => ({ bp: toBasisPoints("12.345") }),
      });
    },
  });
  admin = (await t.loginAs("admin")).access_token;
});

afterAll(async () => {
  await t?.close();
});

async function pgCase(name: string) {
  return t.request<ErrorBody>("POST", `/api/v1/_test/pg/${name}`, { token: admin });
}

describe("database errors become client errors (never 500)", () => {
  it("23514 check_violation → 422 CONSTRAINT_VIOLATION with the constraint and a readable message", async () => {
    const r = await pgCase("check");
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.code).toBe("CONSTRAINT_VIOLATION");
    expect(r.body.error.message).toBe("A company slug is lowercase letters and digits separated by single hyphens");
    expect(ConstraintViolationDetailsSchema.parse(r.body.error.details)).toMatchObject({
      kind: "check",
      constraint: "companies_slug_format_chk",
      table: "companies",
    });
  });

  it("23503 on an insert naming a missing row → 422 CONSTRAINT_VIOLATION (kind foreign_key, the referenced table)", async () => {
    const r = await pgCase("fk_missing");
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.code).toBe("CONSTRAINT_VIOLATION");
    expect(r.body.error.details).toMatchObject({ kind: "foreign_key", table: "report_presets", references: "users" });
  });

  it("23503 on deleting a referenced row → 409 IN_USE naming the constraint, the referencing table and how many rows use it", async () => {
    const r = await pgCase("in_use");
    expect(r.status, r.text).toBe(409);
    expect(r.body.error.code).toBe("IN_USE");
    const details = InUseDetailsSchema.parse(r.body.error.details);
    expect(details.referenced_by).toBe("users");
    expect(details.constraint).toBe("users_role_id_roles_id_fk");
    const [n] = await t.app.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM users WHERE role_id = (SELECT role_id FROM users ORDER BY created_at LIMIT 1)`;
    expect(details.usage_count).toBe(n!.n);
  });

  it("23502 → 422 CONSTRAINT_VIOLATION naming the column; an untranslated 23505 → 409 DUPLICATE", async () => {
    const nn = await pgCase("not_null");
    expect(nn.status, nn.text).toBe(422);
    expect(nn.body.error.details).toMatchObject({ kind: "not_null", column: "name", table: "companies" });
    const dup = await pgCase("unique");
    expect(dup.status, dup.text).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
    expect(dup.body.error.details).toMatchObject({ constraint: "roles_company_name_uq" });
  });

  it("every class-22 data exception → 400 VALIDATION_ERROR with details.issues and the SQLSTATE", async () => {
    for (const code of ["22P02", "22003", "22007", "22008", "22023", "2201X", "22012"]) {
      const r = await pgCase(code);
      expect(r.status, `${code}: ${r.text}`).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
      expect(r.body.error.details?.["sqlstate"], code).toBe(code);
      const issues = r.body.error.details?.["issues"] as { path: string; message: string; code: string }[];
      expect(issues[0]).toMatchObject({ path: "", code: `sqlstate_${code}` });
    }
  });

  it("a domain MoneyError (percent with 3 decimals at pricing time) → 422 INVALID_AMOUNT with issues", async () => {
    const r = await t.request<ErrorBody>("POST", "/api/v1/_test/money", { token: admin });
    expect(r.status, r.text).toBe(422);
    expect(r.body.error.code).toBe("INVALID_AMOUNT");
    expect(r.body.error.message).toMatch(/more than 2 decimal places/);
    expect(r.body.error.details?.["issues"]).toEqual([expect.objectContaining({ code: "money" })]);
  });

  it("every CHECK constraint of the schema has a readable message", async () => {
    const { CONSTRAINT_MESSAGES } = await import("../../src/lib/pgErrors.js");
    const rows = await t.app.sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY 1`;
    expect(rows.map((r) => r.conname).filter((c) => !CONSTRAINT_MESSAGES[c])).toEqual([]);
  });
});

describe("contract hardening on the wire", () => {
  it("page above 1000 is 400 naming cursor mode", async () => {
    const r = await t.request<ErrorBody>("GET", "/api/v1/masters/room-types?page=1001", { token: admin });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    expect(r.body.error.message).toMatch(/cursor/);
    expect((await t.request("GET", "/api/v1/masters/room-types?page=1000", { token: admin })).status).toBe(200);
  });

  it("a PERCENT PLC with 3 decimals or a fractional FIXED amount is 400 at input (the pricing engine never sees it)", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const base = {
      project_id: id,
      name: "Card",
      effective_from: "2026-01-01",
      rates: [{ flat_type_id: id, rate_per_sqft_paise: 500000 }],
    };
    for (const rule of [
      { plc_type_id: id, calc_mode: "PERCENT", value: 2.125, applies_to: "ALL" },
      { plc_type_id: id, calc_mode: "FIXED", value: 1000.5, applies_to: "ALL" },
    ]) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/rate-cards", {
        token: admin,
        body: { ...base, plc_rules: [rule] },
      });
      expect(r.status, r.text).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
      expect((r.body.error.details?.["issues"] as { path: string }[])[0]?.path).toBe("plc_rules.0.value");
    }
  });
});

describe("versions (contract C6)", () => {
  let id: string;

  it('a create answers ETag "v1"; a single-resource GET the same tag, never a 304 for it; lists keep body-hash ETags + 304', async () => {
    const c = await t.request<{ id: string; version: number }>("POST", "/api/v1/masters/room-types", {
      token: admin,
      body: { name: "Study", code: "STUDY" },
    });
    expect(c.status, c.text).toBe(201);
    expect(c.headers["etag"]).toBe('"v1"');
    id = c.body.id;
    const g = await t.request("GET", `/api/v1/masters/room-types/${id}`, { token: admin });
    expect(g.headers["etag"]).toBe('"v1"');
    const again = await t.request("GET", `/api/v1/masters/room-types/${id}`, {
      token: admin,
      headers: { "if-none-match": '"v1"' },
    });
    expect(again.status).toBe(200);
    const list = await t.request("GET", "/api/v1/masters/room-types", { token: admin });
    const tag = String(list.headers["etag"]);
    expect(tag).toMatch(/^"[A-Za-z0-9+/=]+"$/);
    expect(tag).not.toMatch(/^"v\d+"$/);
    const cached = await t.request("GET", "/api/v1/masters/room-types", {
      token: admin,
      headers: { "if-none-match": tag },
    });
    expect(cached.status).toBe(304);
  });

  it('PATCH: 428 without a version, If-Match "v<n>" round-trips, stale is 409 with details.current_version, body expected_version works', async () => {
    const none = await t.request<ErrorBody>("PATCH", `/api/v1/masters/room-types/${id}`, {
      token: admin,
      body: { name: "Study room" },
    });
    expect(none.status).toBe(428);
    expect(none.body.error.code).toBe("VERSION_REQUIRED");
    expect((none.body.error.details?.["issues"] as { path: string }[])[0]?.path).toBe("version");
    const star = await t.request<ErrorBody>("PATCH", `/api/v1/masters/room-types/${id}`, {
      token: admin,
      body: { name: "Study room" },
      headers: { "if-match": "*" },
    });
    expect(star.status).toBe(428);
    const ok = await t.request<{ version: number }>("PATCH", `/api/v1/masters/room-types/${id}`, {
      token: admin,
      body: { name: "Study room" },
      headers: { "if-match": '"v1"' },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.version).toBe(2);
    expect(ok.headers["etag"]).toBe('"v2"');
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/masters/room-types/${id}`, {
      token: admin,
      body: { name: "Den" },
      headers: { "if-match": 'W/"v1"' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(VersionConflictDetailsSchema.parse(stale.body.error.details)).toMatchObject({
      current: 2,
      current_version: 2,
    });
    const viaBody = await t.request<{ version: number }>("PATCH", `/api/v1/masters/room-types/${id}`, {
      token: admin,
      body: { name: "Den", expected_version: 2 },
    });
    expect(viaBody.status, viaBody.text).toBe(200);
    expect(viaBody.body.version).toBe(3);
    const legacy = await t.request<{ version: number }>("PATCH", `/api/v1/masters/room-types/${id}`, {
      token: admin,
      body: { name: "Den 2" },
      headers: { "if-match": '"3"' },
    });
    expect(legacy.status, legacy.text).toBe(200);
    const badBody = await t.request<ErrorBody>("PATCH", `/api/v1/masters/room-types/${id}`, {
      token: admin,
      body: { name: "Den 3", expected_version: "four" },
    });
    expect(badBody.status).toBe(400);
  });

  it("state-change POSTs require the version (428 without), and accept If-Match", async () => {
    const none = await t.request<ErrorBody>("POST", `/api/v1/masters/room-types/${id}/deactivate`, {
      token: admin,
      body: {},
    });
    expect(none.status).toBe(428);
    const done = await t.request<{ is_active: boolean; version: number }>(
      "POST",
      `/api/v1/masters/room-types/${id}/deactivate`,
      { token: admin, body: {}, headers: { "if-match": '"v4"' } },
    );
    expect(done.status, done.text).toBe(200);
    expect(done.body.is_active).toBe(false);
  });

  it("DELETE of a versioned resource requires If-Match (428), refuses a stale one (409) and deletes with the current one", async () => {
    const p = await t.request<{ id: string; version: number }>("POST", "/api/v1/reports/presets", {
      token: admin,
      body: { report_key: "COLLECTIONS", name: "Versioned preset", params: {} },
    });
    expect(p.status, p.text).toBe(201);
    expect(p.body.version).toBe(1);
    expect(p.headers["etag"]).toBe('"v1"');
    const none = await t.request<ErrorBody>("DELETE", `/api/v1/reports/presets/${p.body.id}`, { token: admin });
    expect(none.status).toBe(428);
    const stale = await t.request<ErrorBody>("DELETE", `/api/v1/reports/presets/${p.body.id}`, {
      token: admin,
      headers: { "if-match": '"v7"' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details?.["current_version"]).toBe(1);
    const gone = await t.request("DELETE", `/api/v1/reports/presets/${p.body.id}`, {
      token: admin,
      headers: { "if-match": '"v1"' },
    });
    expect(gone.status).toBe(204);
    // sessions carry no version and stay exempt
    expect((await t.request("DELETE", "/api/v1/auth/sessions", { token: admin })).status).toBe(200);
    admin = (await t.loginAs("admin")).access_token;
  });
});

describe("money world: flats regeneration after a cancelled booking, other-charge line versions, bucket-cap details", () => {
  let today: string;
  let bookingId: string;
  const key = (() => {
    let n = 0;
    return () => `foundation-${Date.now()}-${++n}`;
  })();

  beforeAll(async () => {
    today = todayIST();
    w = await createMoneyWorld(t, admin);
  }, 120_000);

  it("demand and other-charge rows carry a version; a stale line_version is 409 and the current one raises the demand", async () => {
    const flat = w.ggv.flats.get("G-101")!;
    const b = await t.request<{ id: string; version: number }>("POST", "/api/v1/bookings", {
      token: admin,
      headers: { "idempotency-key": key() },
      body: {
        flat_id: flat.id,
        customer_id: w.customers[0]!,
        booking_date: today,
        agreement_value_paise: CR,
        cash_agreed_paise: 60 * L,
        account_agreed_paise: 40 * L,
        plan_acceptance_mode: "IN_PERSON",
        plan_accepted_on: today,
      },
    });
    expect(b.status, b.text).toBe(201);
    bookingId = b.body.id;
    const added = await t.request<{ version: number; other_charges: { id: string; version: number }[] }>(
      "POST",
      `/api/v1/bookings/${bookingId}/other-charges`,
      {
        token: admin,
        headers: { "idempotency-key": key(), "if-match": `"v${b.body.version}"` },
        body: { charge_type_id: w.charges.LEGAL, amount_paise: 50_000_00, gst_percent: 0, demand_at: "MANUAL" },
      },
    );
    expect(added.status, added.text).toBe(201);
    const line = added.body.other_charges[0]!;
    expect(line.version).toBe(1);
    const stale = await t.request<ErrorBody>("POST", `/api/v1/bookings/${bookingId}/other-charges/${line.id}/demand`, {
      token: admin,
      body: { version: added.body.version, line_version: 2 },
    });
    expect(stale.status, stale.text).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const ok = await t.request<{ other_charges: { id: string; version: number; demanded_at: string | null }[] }>(
      "POST",
      `/api/v1/bookings/${bookingId}/other-charges/${line.id}/demand`,
      { token: admin, body: { version: added.body.version, line_version: 1 } },
    );
    expect(ok.status, ok.text).toBe(200);
    const after = ok.body.other_charges.find((c) => c.id === line.id)!;
    expect(after.demanded_at).not.toBeNull();
    expect(after.version).toBeGreaterThan(1); // every UPDATE of a versioned child row bumps it (bump_version trigger)
    const demands = await t.request<{ items: { version: number }[] }>(
      "GET",
      `/api/v1/bookings/${bookingId}/demands?include_inactive=true`,
      { token: admin },
    );
    expect(demands.body.items.length).toBeGreaterThan(0);
    expect(demands.body.items.every((d) => Number.isInteger(d.version) && d.version >= 1)).toBe(true);
  });

  it("cancelling writes the refund/deduction money columns; regenerating the tower afterwards keeps that flat in place (was 500)", async () => {
    const cur = await t.request<{ version: number }>("GET", `/api/v1/bookings/${bookingId}`, { token: admin });
    const cancel = await t.request("POST", `/api/v1/bookings/${bookingId}/cancel`, {
      token: admin,
      body: { version: cur.body.version, reason: "Customer withdrew the booking" },
    });
    expect(cancel.status, cancel.text).toBe(200);
    const [row] = await t.app.sql<{ r: number; d: number }[]>`
      SELECT cancellation_refund_paise AS r, cancellation_deduction_paise AS d FROM bookings WHERE id = ${bookingId}`;
    expect(row).toEqual({ r: 0, d: 0 });
    const block = await t.request<{ version: number }>("GET", `/api/v1/blocks/${w.ggv.towerId}`, { token: admin });
    const regen = await t.request<{ flats_preserved: number }>(
      "POST",
      `/api/v1/blocks/${w.ggv.towerId}/generate-flats`,
      { token: admin, body: { version: block.body.version, regenerate: true } },
    );
    // phase 7 domain track: the flat with booking history is regenerated in place (same id); a change that would delete it is 409
    // FLAT_HAS_BOOKING_HISTORY (inventory-phase7.test.ts)
    expect(regen.status, regen.text).toBe(200);
    expect(regen.body.flats_preserved).toBe(1);
  });
});

describe("tenant resolution (contract C4)", () => {
  type Req = Parameters<typeof import("../../src/lib/tenant.js").resolveCompanyId>[1];
  const req = (headers: Record<string, string> = {}, hostname = "api.example.test", extra: Partial<Req> = {}): Req =>
    ({ headers, hostname, ...extra }) as Req;

  it("single company: every unauthenticated request resolves to it; the principal's company always wins", async () => {
    const { resolveCompanyId, clearTenantCache } = await import("../../src/lib/tenant.js");
    clearTenantCache();
    expect(await resolveCompanyId(t.app, req())).toBe(t.companyId);
    expect(await resolveCompanyId(t.app, req({}, "x", { user: { companyId: "c-user" } } as Partial<Req>))).toBe(
      "c-user",
    );
    expect(await resolveCompanyId(t.app, req({}, "x", { customer: { companyId: "c-cust" } } as Partial<Req>))).toBe(
      "c-cust",
    );
  });

  it("several companies: slug header, then Host; ambiguity and unknown slugs are 400 COMPANY_REQUIRED", async () => {
    const { resolveCompanyId, clearTenantCache } = await import("../../src/lib/tenant.js");
    const [second] = await t.app.sql<{ id: string; slug: string }[]>`
      INSERT INTO companies (name, hosts) VALUES ('Second Builders', ARRAY['www.second.example', 'my.second.example']) RETURNING id, slug`;
    clearTenantCache();
    try {
      expect(second!.slug).toBe("second-builders");
      const [first] = await t.app.sql<{ slug: string }[]>`SELECT slug FROM companies WHERE id = ${t.companyId}`;
      expect(await resolveCompanyId(t.app, req({ "x-kkt-company": first!.slug }))).toBe(t.companyId);
      expect(await resolveCompanyId(t.app, req({ "x-kkt-company": "second-builders" }))).toBe(second!.id);
      expect(await resolveCompanyId(t.app, req({}, "MY.Second.Example."))).toBe(second!.id);
      expect(await resolveCompanyId(t.app, req({}, "www.second.example:8443"))).toBe(second!.id);
      // a body slug (login `company`) wins over the header
      expect(await resolveCompanyId(t.app, req({ "x-kkt-company": "second-builders" }), first!.slug)).toBe(t.companyId);
      await expect(resolveCompanyId(t.app, req())).rejects.toMatchObject({ statusCode: 400, code: "COMPANY_REQUIRED" });
      await expect(resolveCompanyId(t.app, req({ "x-kkt-company": "nobody" }))).rejects.toMatchObject({
        statusCode: 400,
        code: "COMPANY_REQUIRED",
      });
      // an unknown slug never falls back to the host's company
      await expect(
        resolveCompanyId(t.app, req({ "x-kkt-company": "nobody" }, "www.second.example")),
      ).rejects.toMatchObject({ code: "COMPANY_REQUIRED" });
    } finally {
      // remove the second tenant so later tests see one company again (no rows reference it)
      await t.app.sql`DELETE FROM companies WHERE id = ${second!.id}`;
      clearTenantCache();
    }
  });
});
