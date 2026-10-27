import { authenticator } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPortalCustomer, createProject } from "./fixtures.js";
import { createActiveBooking } from "./fixtures/crm.js";
import { buildTestApp, CREDS, type ErrorBody, type TestContext } from "./helpers.js";
import { config } from "../../src/config.js";
import { clearTenantCache } from "../../src/lib/tenant.js";
import { authVersionKey, PERM_VERSION_KEY } from "../../src/lib/cache.js";

/**
 * Phase 7 security track (docs/hardening/phase7-security.md): admin MFA by permission + TOTP replay, customer project scope, tenant-aware
 * sign-in and job results, cookie sessions with an absolute lifetime (contract C1), per-subject auth cache versions, per-subject read /
 * export limits, export + reveal audit, the audit hash chain, public rate-limit groups behind the website (contract C3), DPDP erasure of
 * every copy, audit PII masking and the deprecated duplicate routes.
 */
let t: TestContext;
let admin: string;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
});
afterAll(async () => {
  await t?.close();
});

async function roleId(name: string): Promise<string> {
  const [r] = await t.app.sql<
    { id: string }[]
  >`select id from roles where name = ${name} and company_id = ${t.companyId}`;
  return r!.id;
}

async function customRole(name: string, permissions: string[]): Promise<string> {
  const r = await t.request<{ id: string }>("POST", "/api/v1/roles", {
    token: admin,
    body: { name, description: name, permissions: ["dashboard.view", ...permissions] },
  });
  if (r.status !== 201) throw new Error(`role create failed: ${r.text}`);
  return r.body.id;
}

async function newStaff(
  email: string,
  password: string,
  role: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const r = await t.request<{ id: string; version: number }>("POST", "/api/v1/users", {
    token: admin,
    body: { name: email.split("@")[0], email, role_id: role, password, must_change_password: false, ...extra },
  });
  if (r.status !== 201) throw new Error(`user create failed: ${r.text}`);
  return r.body;
}

async function newCustomer(token: string, name: string, phone: string): Promise<{ id: string; version: number }> {
  const r = await t.request<{ id: string; version: number }>("POST", "/api/v1/customers", {
    token,
    body: { full_name: name, phone, co_applicants: [] },
  });
  if (r.status !== 201) throw new Error(`customer create failed: ${r.text}`);
  return r.body;
}

async function setCompanySetting(key: string, value: unknown): Promise<void> {
  await t.app
    .sql`update companies set settings = settings || ${JSON.stringify({ [key]: value })}::jsonb where id = ${t.companyId}`;
  await t.app.redis.del(`company:${t.companyId}`);
}

// ---------------------------------------------------------------------------
// 1. Admin MFA
// ---------------------------------------------------------------------------
describe("admin MFA is decided by permissions, and TOTP codes cannot be replayed", () => {
  it("defaults: the contract and a production bootstrap force admin MFA; the demo seed turns it off explicitly", async () => {
    const { CompanySettingsValuesSchema } = await import("@kkt/contracts");
    const parsed = CompanySettingsValuesSchema.parse({ sla_hours: {} });
    expect(parsed.force_mfa_for_admins).toBe(true);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../src/seed/bootstrap.ts", import.meta.url), "utf8");
    expect(src).toMatch(/const DEFAULT_SETTINGS = \{[^}]*force_mfa_for_admins: true/s);
    expect(src).toMatch(/DEMO_SETTINGS = \{ \.\.\.DEFAULT_SETTINGS, force_mfa_for_admins: false \}/);
    // the demo company of the tests runs without forced MFA (published demo logins)
    const [c] = await t.app.sql<
      { v: boolean }[]
    >`select (settings->>'force_mfa_for_admins')::boolean as v from companies where id = ${t.companyId}`;
    expect(c!.v).toBe(false);
  });

  it("a custom role holding users.manage needs MFA; a role merely NAMED like an admin without those permissions does not", async () => {
    const managerRole = await customRole("Team Lead (users)", ["users.manage", "customer.read"]);
    const fakeAdminRole = await customRole("Chief Admin", ["customer.read"]);
    await newStaff("lead.mfa@sgb.in", "Lead-Mfa-12345", managerRole);
    await newStaff("chief.mfa@sgb.in", "Chief-Mfa-12345", fakeAdminRole);
    await setCompanySetting("force_mfa_for_admins", true);
    try {
      const lead = (await t.login("lead.mfa@sgb.in", "Lead-Mfa-12345")).access_token;
      const blocked = await t.request<ErrorBody>("GET", "/api/v1/users", { token: lead });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe("MFA_REQUIRED");
      // self-service enrolment stays open
      expect((await t.request("GET", "/api/v1/auth/me", { token: lead })).status).toBe(200);
      const chief = (await t.login("chief.mfa@sgb.in", "Chief-Mfa-12345")).access_token;
      expect((await t.request("GET", "/api/v1/customers", { token: chief })).status).toBe(200);
      // Project Admin holds none of settings/users/roles/admin tools: not forced
      const projects = (await t.loginAs("projects")).access_token;
      expect((await t.request("GET", "/api/v1/customers", { token: projects })).status).toBe(200);
      // the Super Admin system role always is
      const sa = (await t.loginAs("admin")).access_token;
      expect((await t.request<ErrorBody>("GET", "/api/v1/users", { token: sa })).body.error.code).toBe("MFA_REQUIRED");
    } finally {
      await setCompanySetting("force_mfa_for_admins", false);
    }
  });

  it("a TOTP step is accepted once: the same code (or an older one) is refused afterwards, for login and for disabling", async () => {
    const accounts = await t.loginAs("accounts");
    const enroll = await t.request<{ secret: string }>("POST", "/api/v1/auth/mfa/enroll", {
      token: accounts.access_token,
    });
    const secret = enroll.body.secret;
    const at = (offsetSteps: number) =>
      authenticator.clone({ epoch: Date.now() + offsetSteps * 30_000 }).generate(secret);
    expect(
      (await t.request("POST", "/api/v1/auth/mfa/verify", { token: accounts.access_token, body: { code: at(-1) } }))
        .status,
    ).toBe(200);
    const first = await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", {
      body: { ...CREDS.accounts, mfa_code: at(0) },
    });
    expect(first.status, first.text).toBe(200);
    // replay of the same code: refused like a wrong code
    const replay = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { ...CREDS.accounts, mfa_code: at(0) },
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("INVALID_CREDENTIALS");
    // an older (still in-window) step after a newer one was used: refused too
    const older = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { ...CREDS.accounts, mfa_code: at(-1) },
    });
    expect(older.status).toBe(401);
    const [u] = await t.app.sql<
      { step: string }[]
    >`select totp_last_step::text as step from users where email = ${CREDS.accounts.email}`;
    expect(Number(u!.step)).toBe(Math.floor(Date.now() / 30_000));
    // the next step works once — for disable as well
    const dis = await t.request("POST", "/api/v1/auth/mfa/disable", {
      token: first.body.access_token,
      body: { password: CREDS.accounts.password, code: at(1) },
    });
    expect(dis.status, dis.text).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 2. Customer project scope
// ---------------------------------------------------------------------------
describe("customers follow the caller's project scope", () => {
  let projectA: string;
  let projectB: string;
  let scoped: string; // Project Admin scoped to A (with a KYC-reveal custom role variant below)
  let kycScoped: string;
  let inA: string;
  let inB: string;
  let leadA: string;
  let visitA: string;
  let own: string;
  let docB: string;

  beforeAll(async () => {
    projectA = await createProject(t, "Scope Tower A", "SCA");
    projectB = await createProject(t, "Scope Tower B", "SCB");
    await newStaff("scope.pa@sgb.in", "Scope-Pa-12345", await roleId("Project Admin"), {
      all_projects: false,
      project_ids: [projectA],
    });
    const kycRole = await customRole("KYC desk", [
      "customer.read",
      "customer.write",
      "customer.kyc_view",
      "document.read",
      "customer.portal_manage",
    ]);
    await newStaff("scope.kyc@sgb.in", "Scope-Kyc-12345", kycRole, { all_projects: false, project_ids: [projectA] });
    scoped = (await t.login("scope.pa@sgb.in", "Scope-Pa-12345")).access_token;
    kycScoped = (await t.login("scope.kyc@sgb.in", "Scope-Kyc-12345")).access_token;
    inA = (await newCustomer(admin, "Asha In A", "9700000001")).id;
    inB = (await newCustomer(admin, "Bharat In B", "9700000002")).id;
    leadA = (await newCustomer(admin, "Leela Lead A", "9700000003")).id;
    visitA = (await newCustomer(admin, "Vikram Visit A", "9700000004")).id;
    await createActiveBooking(t, inA, projectA);
    await createActiveBooking(t, inB, projectB);
    await t.app
      .sql`insert into leads (company_id, lead_number, full_name, phone, customer_id, project_id, stage) values (${t.companyId}, 'LD-SCOPE/0001', 'Leela Lead A', '9700000003', ${leadA}, ${projectA}, 'NEW')`;
    await t.app
      .sql`insert into site_visits (company_id, visit_number, project_id, customer_id, name, phone, visit_date, slot_start, slot_end)
      values (${t.companyId}, 'SV-SCOPE/0001', ${projectA}, ${visitA}, 'Vikram Visit A', '9700000004', current_date + 3, '10:00', '11:00')`;
    own = (await newCustomer(scoped, "Own Unlinked", "9700000005")).id;
    const [d] = await t.app.sql<
      { id: string }[]
    >`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, is_sensitive)
      values (${t.companyId}, 'CUSTOMER', ${inB}, 'pan-b.pdf', 'application/pdf', 13, 'beef', 'documents/test/scope-b.pdf', 'STAFF', true) returning id`;
    docB = d!.id;
  });

  it("lists, exports and opens only customers linked to the caller's projects (booking, lead, site visit) or their own unlinked records", async () => {
    const list = await t.request<{ items: { id: string }[]; total: number }>("GET", "/api/v1/customers?page_size=200", {
      token: scoped,
    });
    expect(list.status).toBe(200);
    expect(new Set(list.body.items.map((c) => c.id))).toEqual(new Set([inA, leadA, visitA, own]));
    const csv = await t.request("GET", "/api/v1/customers?format=csv", { token: scoped });
    expect(csv.text).toContain("Asha In A");
    expect(csv.text).not.toContain("Bharat In B");
    for (const id of [inA, leadA, visitA, own])
      expect((await t.request("GET", `/api/v1/customers/${id}`, { token: scoped })).status, id).toBe(200);
    for (const url of [
      `/api/v1/customers/${inB}`,
      `/api/v1/customers/${inB}/360`,
      `/api/v1/customers/${inB}/co-applicants`,
    ]) {
      const r = await t.request<ErrorBody>("GET", url, { token: scoped });
      expect(r.status, url).toBe(404);
    }
    const patch = await t.request("PATCH", `/api/v1/customers/${inB}`, {
      token: scoped,
      body: { notes: "nope", version: 1 },
    });
    expect(patch.status).toBe(404);
    // once the scoped user's own record is booked in another project, it leaves their scope
    await createActiveBooking(t, own, projectB);
    expect((await t.request("GET", `/api/v1/customers/${own}`, { token: scoped })).status).toBe(404);
  });

  it("?reveal=true (PAN, Aadhaar, bank) and customer documents incl. KYC scans honour the scope even with customer.kyc_view", async () => {
    const reveal = await t.request<ErrorBody>("GET", `/api/v1/customers/${inB}?reveal=true`, { token: kycScoped });
    expect(reveal.status).toBe(404);
    const ok = await t.request<{ pan: string | null; revealed_at: string }>(
      "GET",
      `/api/v1/customers/${inA}?reveal=true`,
      {
        token: kycScoped,
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.revealed_at).toBeTruthy();
    const [audit] = await t.app.sql<{ after: Record<string, unknown> }[]>`
      select after from audit_logs where action = 'customer.kyc_reveal' and entity_id = ${inA} order by created_at desc limit 1`;
    expect(audit!.after).toMatchObject({ row_count: 1, filters: { customer_id: inA, reveal: true } });
    expect((await t.request("GET", `/api/v1/documents/${docB}`, { token: kycScoped })).status).toBe(404);
    expect(
      (await t.request("GET", `/api/v1/documents?entity_type=CUSTOMER&entity_id=${inB}`, { token: kycScoped })).status,
    ).toBe(404);
    const all = await t.request<{ items: { id: string }[] }>("GET", "/api/v1/documents?page_size=200", {
      token: kycScoped,
    });
    expect(all.status).toBe(200);
    expect(all.body.items.map((d) => d.id)).not.toContain(docB);
    // an all-projects admin still sees it
    expect((await t.request("GET", `/api/v1/documents/${docB}`, { token: admin })).status).toBe(200);
  });

  it("the customer 360 of an in-scope customer shows only in-scope bookings, payments, leads and tickets", async () => {
    const [b] = await t.app.sql<{ id: string }[]>`select id from bookings where customer_id = ${inA} limit 1`;
    await createActiveBooking(t, inA, projectB, {}); // a second booking of the same customer in a foreign project
    const r = await t.request<{ bookings: { booking_id: string }[]; payments_count: number }>(
      "GET",
      `/api/v1/customers/${inA}/360`,
      { token: scoped },
    );
    expect(r.status).toBe(200);
    expect(r.body.bookings.map((x) => x.booking_id)).toEqual([b!.id]);
    const full = await t.request<{ bookings: unknown[] }>("GET", `/api/v1/customers/${inA}/360`, { token: admin });
    expect(full.body.bookings).toHaveLength(2);
  });

  it("duplicate checks still find another project's customer, without naming them to a scoped caller", async () => {
    const r = await t.request<{ matches: { customer_id: string; full_name: string; phone: string }[] }>(
      "POST",
      "/api/v1/customers/duplicate-check",
      { token: scoped, body: { phone: "9700000002" } },
    );
    expect(r.status).toBe(200);
    expect(r.body.matches).toHaveLength(1);
    expect(r.body.matches[0]!.full_name).not.toContain("Bharat");
    expect(r.body.matches[0]!.phone).toBe("******0002");
  });

  it("bulk portal enable works for a scoped user on their own project (audit G: it answered 500 for every scoped user)", async () => {
    const dry = await t.request<{ enabled: number }>("POST", "/api/v1/customers/portal/bulk-enable", {
      token: kycScoped,
      body: { project_id: projectA, dry_run: true },
    });
    expect(dry.status, dry.text).toBe(200);
    expect(dry.body.enabled).toBe(1);
    const all = await t.request<{ enabled: number; credentials: { customer_id: string }[] }>(
      "POST",
      "/api/v1/customers/portal/bulk-enable",
      { token: kycScoped, body: {} },
    );
    expect(all.status, all.text).toBe(200);
    // every candidate lies in project A: the B customer is never enabled by the A-scoped user
    expect(all.body.credentials.map((c) => c.customer_id)).toEqual([inA]);
  });
});

// ---------------------------------------------------------------------------
// 3. Tenancy
// ---------------------------------------------------------------------------
describe("sign-in resolves the tenant first (contract C4); job results stay per company", () => {
  let companyB: string;
  const twinEmail = "twin.tenant@sgb.in";
  const twinPhone = "9700000099";

  beforeAll(async () => {
    const [c] = await t.app.sql<{ id: string }[]>`
      insert into companies (name, slug, fy_start_month, numbering, settings)
      select 'Second Builders', 'second-builders', fy_start_month, numbering, settings || '{"force_mfa_for_admins": false}'::jsonb
      from companies where id = ${t.companyId} returning id`;
    companyB = c!.id;
    clearTenantCache();
    const { hashPassword } = await import("../../src/lib/password.js");
    const hash = await hashPassword("Twin-Pass-12345");
    const [roleB] = await t.app.sql<{ id: string }[]>`
      insert into roles (company_id, name, description, permissions, is_system)
      select ${companyB}, name, description, permissions, is_system from roles where company_id = ${t.companyId} and name = 'Super Admin' returning id`;
    // the same e-mail in both companies, and one e-mail only in company B
    await newStaff(twinEmail, "Twin-Pass-12345", await roleId("Sales"));
    await t.app.sql`insert into users (company_id, name, email, role_id, password_hash, must_change_password)
      values (${companyB}, 'Twin B', ${twinEmail}, ${roleB!.id}, ${hash}, false),
             (${companyB}, 'Only B', 'only.b@second.in', ${roleB!.id}, ${hash}, false)`;
    // portal: the same phone in both companies
    await createPortalCustomer(t, { phone: twinPhone, password: "Twin-Pass-12345" });
    const [cb] = await t.app.sql<{ id: string }[]>`
      insert into customers (company_id, customer_code, full_name, phone) values (${companyB}, 'CUST-B-0001', 'Twin Customer B', ${twinPhone}) returning id`;
    await t.app.sql`insert into portal_users (company_id, customer_id, phone, password_hash, must_change_password)
      values (${companyB}, ${cb!.id}, ${twinPhone}, ${hash}, false)`;
  });
  afterAll(() => clearTenantCache());

  it("staff: an e-mail in two companies needs the company (400 COMPANY_REQUIRED); body slug or x-kkt-company picks it", async () => {
    const ambiguous = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { email: twinEmail, password: "Twin-Pass-12345" },
    });
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error.code).toBe("COMPANY_REQUIRED");
    const [slugA] = await t.app.sql<{ slug: string }[]>`select slug from companies where id = ${t.companyId}`;
    const a = await t.request<{ access_token: string; user: { id: string } }>("POST", "/api/v1/auth/login", {
      body: { email: twinEmail, password: "Twin-Pass-12345", company: slugA!.slug },
    });
    expect(a.status, a.text).toBe(200);
    const b = await t.request<{ access_token: string; user: { name: string } }>("POST", "/api/v1/auth/login", {
      body: { email: twinEmail, password: "Twin-Pass-12345" },
      headers: { "x-kkt-company": "second-builders" },
    });
    expect(b.status, b.text).toBe(200);
    expect(b.body.user.name).toBe("Twin B");
    const unknownSlug = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { email: twinEmail, password: "Twin-Pass-12345", company: "no-such-builder" },
    });
    expect(unknownSlug.status).toBe(400);
    expect(unknownSlug.body.error.code).toBe("COMPANY_REQUIRED");
  });

  it("without a company an unknown identifier answers exactly like a wrong password (no enumeration); a unique one signs in", async () => {
    const unknown = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { email: "nobody.anywhere@sgb.in", password: "Whatever-12345" },
    });
    const wrong = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { email: "only.b@second.in", password: "Wrong-Pass-12345" },
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toEqual({ ...wrong.body.error, request_id: unknown.body.error.request_id });
    const only = await t.request<{ user: { name: string } }>("POST", "/api/v1/auth/login", {
      body: { email: "only.b@second.in", password: "Twin-Pass-12345" },
    });
    expect(only.status).toBe(200);
    expect(only.body.user.name).toBe("Only B");
  });

  it("portal: a phone in two companies needs the company; with it each customer reaches their own account", async () => {
    const amb = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
      body: { phone: twinPhone, password: "Twin-Pass-12345" },
    });
    expect(amb.status).toBe(400);
    expect(amb.body.error.code).toBe("COMPANY_REQUIRED");
    const b = await t.request<{ user: { full_name: string } }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: twinPhone, password: "Twin-Pass-12345", company: "second-builders" },
    });
    expect(b.status, b.text).toBe(200);
    expect(b.body.user.full_name).toBe("Twin Customer B");
  });

  it("login events and job results are company-scoped: company B's admin sees neither company A's sign-ins nor its reconciliation", async () => {
    const bAdmin = (
      await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", {
        body: { email: twinEmail, password: "Twin-Pass-12345", company: "second-builders" },
      })
    ).body.access_token;
    const events = await t.request<{ items: { identifier: string }[] }>(
      "GET",
      "/api/v1/audit-logs/login-events?page_size=200",
      { token: bAdmin },
    );
    expect(events.status).toBe(200);
    expect(events.body.items.map((e) => e.identifier)).not.toContain(CREDS.admin.email);
    const { reconciliationJob } = await import("../../src/modules/admin/tools.js");
    const result = await reconciliationJob(t.app.db);
    expect(Object.keys(result["by_company"] as object).sort()).toEqual([t.companyId, companyB].sort());
    const [run] = await t.app.sql<{ id: string }[]>`
      insert into job_runs (job_name, status, result, finished_at) values ('STARTUP_RECONCILIATION', 'OK', ${JSON.stringify(result)}::jsonb, now()) returning id`;
    const seenB = await t.request<{ result: Record<string, unknown> }>("GET", `/api/v1/admin/jobs/runs/${run!.id}`, {
      token: bAdmin,
    });
    expect(seenB.status).toBe(200);
    expect(seenB.body.result).toMatchObject({ companies: 2, bookings_checked: 0 });
    expect(JSON.stringify(seenB.body.result)).not.toContain(t.companyId);
    const seenA = await t.request<{ result: Record<string, unknown> }>("GET", `/api/v1/admin/jobs/runs/${run!.id}`, {
      token: admin,
    });
    expect(Number(seenA.body.result["bookings_checked"])).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. HASH_KEYS rotation (contract C9)
// ---------------------------------------------------------------------------
describe("HASH_KEYS rotation keeps duplicate detection working and REENCRYPT_FIELDS rehashes to the active key", () => {
  it("a PAN hashed under the old key is still a duplicate after the rotation, and after the rehash under the new key alone", async () => {
    const before = config.HASH_KEY_RING;
    const H2 = { kid: "h2", secret: "rotated-hash-key-for-tests-0123456789abcdef" };
    const setRing = (ring: { kid: string; secret: string }[]) =>
      ((config as { HASH_KEY_RING: { kid: string; secret: string }[] }).HASH_KEY_RING = ring);
    try {
      const first = await t.request<{ id: string }>("POST", "/api/v1/customers", {
        token: admin,
        body: { full_name: "Hash Rotation One", phone: "9700007001", pan: "QWERT1234Y", co_applicants: [] },
      });
      expect(first.status, first.text).toBe(201);
      const [old] = await t.app.sql<{ pan_hash: string }[]>`select pan_hash from customers where id = ${first.body.id}`;
      setRing([H2, ...before]);
      const dup = await t.request<ErrorBody>("POST", "/api/v1/customers", {
        token: admin,
        body: { full_name: "Hash Rotation Two", phone: "9700007002", pan: "QWERT1234Y", co_applicants: [] },
      });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe("DUPLICATE_CUSTOMER");
      const check = await t.request<{ matches: { customer_id: string }[] }>(
        "POST",
        "/api/v1/customers/duplicate-check",
        {
          token: admin,
          body: { pan: "QWERT1234Y" },
        },
      );
      expect(check.body.matches.map((m) => m.customer_id)).toEqual([first.body.id]);
      const { reencryptFields } = await import("../../src/modules/auth/reencrypt.js");
      const r = await reencryptFields(t.app.db);
      expect(r.hash_kid).toBe("h2");
      expect(r.rehashed["customers"]).toBeGreaterThanOrEqual(1);
      const [fresh] = await t.app.sql<
        { pan_hash: string }[]
      >`select pan_hash from customers where id = ${first.body.id}`;
      expect(fresh!.pan_hash).not.toBe(old!.pan_hash);
      const { keyedHash } = await import("../../src/lib/crypto.js");
      expect(fresh!.pan_hash).toBe(keyedHash("QWERT1234Y"));
      // the old key retired: still a duplicate
      setRing([H2]);
      const again = await t.request<ErrorBody>("POST", "/api/v1/customers", {
        token: admin,
        body: { full_name: "Hash Rotation Three", phone: "9700007003", pan: "QWERT1234Y", co_applicants: [] },
      });
      expect(again.status).toBe(409);
    } finally {
      setRing(before);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Bulk PII: export audit, per-subject read/export limits, audit seal
// ---------------------------------------------------------------------------
describe("bulk reads leave a trail and are rate limited; the audit log is hash-chained", () => {
  it("every CSV export writes export.csv with the route, filters and row count", async () => {
    const r = await t.request("GET", "/api/v1/customers?format=csv&kyc_status=PENDING", { token: admin });
    expect(r.status).toBe(200);
    const rows = r.text.trim().split("\r\n").length - 1;
    const [a] = await t.app.sql<{ entity_type: string; after: Record<string, unknown> }[]>`
      select entity_type, after from audit_logs where action = 'export.csv' order by created_at desc limit 1`;
    expect(a!.entity_type).toBe("customers");
    expect(a!.after).toMatchObject({
      route: "/api/v1/customers",
      file_name: "customers.csv",
      filters: { kyc_status: "PENDING" },
      row_count: rows,
      async_export: false,
    });
  });

  it("authenticated reads and exports have per-user budgets: 429 RATE_LIMITED with Retry-After beyond them", async () => {
    const sales = (await t.loginAs("sales")).access_token;
    const read = config.READ_RATE_LIMIT_PER_MIN;
    const exp = config.EXPORT_RATE_LIMIT_PER_MIN;
    try {
      (config as { EXPORT_RATE_LIMIT_PER_MIN: number }).EXPORT_RATE_LIMIT_PER_MIN = 2;
      const first = await t.request("GET", "/api/v1/customers?format=csv", { token: sales });
      expect(first.status, first.text).toBe(200);
      const second = await t.request("GET", "/api/v1/customers?format=csv", { token: sales });
      expect(second.status, second.text).toBe(200);
      const third = await t.request<ErrorBody>("GET", "/api/v1/customers?format=csv", { token: sales });
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe("RATE_LIMITED");
      expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
      // plain reads still pass: the export budget is separate
      expect((await t.request("GET", "/api/v1/customers", { token: sales })).status).toBe(200);
      (config as { READ_RATE_LIMIT_PER_MIN: number }).READ_RATE_LIMIT_PER_MIN = 3;
      const marketing = (await t.loginAs("marketing")).access_token;
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await t.request("GET", "/api/v1/auth/me", { token: marketing })).status);
      expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
      // another user (who has not read anything this minute) is unaffected
      const employee = (await t.loginAs("employee")).access_token;
      expect((await t.request("GET", "/api/v1/auth/me", { token: employee })).status).toBe(200);
    } finally {
      (config as { READ_RATE_LIMIT_PER_MIN: number }).READ_RATE_LIMIT_PER_MIN = read;
      (config as { EXPORT_RATE_LIMIT_PER_MIN: number }).EXPORT_RATE_LIMIT_PER_MIN = exp;
    }
  });

  it("AUDIT_SEAL chains the rows; GET /admin/audit/verify finds a changed row, a back-dated row and a removed seal", async () => {
    const { sealAuditLog } = await import("../../src/modules/audit/seal.js");
    const { registeredJobs } = await import("../../src/jobs/index.js");
    expect(registeredJobs()).toContain("AUDIT_SEAL");
    // enough audited activity for several seals (each sign-in writes an auth.login row)
    for (let i = 0; i < 12; i++) await t.loginAs("marketing");
    const sealed = await sealAuditLog(t.app.db, { lagSeconds: 0, batchSize: 5 });
    expect(sealed.rows_sealed).toBeGreaterThan(0);
    expect(sealed.seals_written).toBeGreaterThan(1); // batches of 5
    const ok = await t.request<{ ok: boolean; seals_checked: number; rows_checked: number; first_mismatch: unknown }>(
      "GET",
      "/api/v1/admin/audit/verify",
      { token: admin },
    );
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, first_mismatch: null });
    expect(ok.body.rows_checked).toBeGreaterThan(0);
    // a second run seals only what is new (nothing yet beyond the verify itself, which writes no audit row)
    expect((await sealAuditLog(t.app.db, { lagSeconds: 0 })).rows_sealed).toBe(0);

    // tamper (as the database owner, bypassing the append-only trigger the way an attacker with DB access would)
    const [victim] = await t.app.sql<{ id: string; action: string }[]>`
      select id, action from audit_logs where company_id = ${t.companyId} order by created_at, id offset 3 limit 1`;
    const tamper = async (q: string) =>
      t.app.sql.begin(async (tx) => {
        await tx.unsafe("set local session_replication_role = replica");
        await tx.unsafe(q);
      });
    await tamper(`update audit_logs set action = 'tampered' where id = '${victim!.id}'`);
    const broken = await t.request<{ ok: boolean; first_mismatch: { reason: string; seal_id: number } }>(
      "GET",
      "/api/v1/admin/audit/verify",
      { token: admin },
    );
    expect(broken.body.ok, JSON.stringify(broken.body)).toBe(false);
    expect(broken.body.first_mismatch.reason).toBe("HASH_MISMATCH");
    await tamper(`update audit_logs set action = '${victim!.action}' where id = '${victim!.id}'`);
    expect((await t.request<{ ok: boolean }>("GET", "/api/v1/admin/audit/verify", { token: admin })).body.ok).toBe(
      true,
    );

    // a row inserted with an old timestamp lands inside a sealed range: the count no longer matches
    await tamper(`insert into audit_logs (company_id, actor_type, action, entity_type, created_at)
      select company_id, 'SYSTEM', 'backdated', 'x', created_at + interval '1 microsecond' from audit_logs where id = '${victim!.id}'`);
    const backdated = await t.request<{ first_mismatch: { reason: string } }>("GET", "/api/v1/admin/audit/verify", {
      token: admin,
    });
    expect(backdated.body.first_mismatch.reason).toBe("ROW_COUNT");
    await tamper(`delete from audit_logs where action = 'backdated'`);

    // removing a seal breaks the chain at the next one
    await tamper(
      `delete from audit_seals where id = (select min(id) + 1 from audit_seals where company_id = '${t.companyId}')`,
    );
    const gap = await t.request<{ first_mismatch: { reason: string } }>("GET", "/api/v1/admin/audit/verify", {
      token: admin,
    });
    expect(gap.body.first_mismatch.reason).toBe("CHAIN_BROKEN");
  });
});

// ---------------------------------------------------------------------------
// 6. Sessions (contract C1)
// ---------------------------------------------------------------------------
describe("cookie sessions (contract C1) with an absolute family lifetime", () => {
  const cookieOf = (h: Record<string, string | string[] | undefined>, name: string): string | null => {
    const raw = h["set-cookie"];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.find((c) => c.startsWith(`${name}=`)) ?? null;
  };
  const valueOf = (cookie: string) => cookie.split(";")[0]!.split("=").slice(1).join("=");

  it("staff: login with X-KKT-Session: cookie sets kkt_rt (HttpOnly, SameSite=Strict, Path=/api/v1/auth) and leaves refresh_token out of the body", async () => {
    const login = await t.request<{ access_token: string; refresh_token?: string }>("POST", "/api/v1/auth/login", {
      body: CREDS.sales,
      headers: { "x-kkt-session": "cookie" },
    });
    expect(login.status).toBe(200);
    expect(login.body.refresh_token).toBeUndefined();
    const c = cookieOf(login.headers, "kkt_rt")!;
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Path=\/api\/v1\/auth/);
    expect(c).not.toMatch(/Secure/); // NODE_ENV=test
    const maxAge = Number(/Max-Age=(\d+)/.exec(c)![1]);
    expect(maxAge).toBeGreaterThan(29 * 86_400);
    expect(maxAge).toBeLessThanOrEqual(30 * 86_400);

    // refresh with the cookie needs the header (CSRF guard)
    const noHeader = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      headers: { cookie: `kkt_rt=${valueOf(c)}` },
    });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.details).toMatchObject({ reason: "SESSION_HEADER_REQUIRED" });
    const refreshed = await t.request<{ access_token: string; refresh_token?: string }>(
      "POST",
      "/api/v1/auth/refresh",
      {
        headers: { cookie: `kkt_rt=${valueOf(c)}`, "x-kkt-session": "cookie" },
      },
    );
    expect(refreshed.status, refreshed.text).toBe(200);
    expect(refreshed.body.refresh_token).toBeUndefined();
    const c2 = cookieOf(refreshed.headers, "kkt_rt")!;
    expect(valueOf(c2)).not.toBe(valueOf(c));
    // rotation never extends the family: the new cookie's Max-Age is not longer than the first one
    expect(Number(/Max-Age=(\d+)/.exec(c2)![1])).toBeLessThanOrEqual(maxAge);

    // presenting the old cookie again is reuse: the whole family dies, the newest cookie too
    const reuse = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      headers: { cookie: `kkt_rt=${valueOf(c)}`, "x-kkt-session": "cookie" },
    });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("TOKEN_REUSED");
    expect(cookieOf(reuse.headers, "kkt_rt")).toMatch(/Max-Age=0/);
    const after = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      headers: { cookie: `kkt_rt=${valueOf(c2)}`, "x-kkt-session": "cookie" },
    });
    expect(after.status).toBe(401);
  });

  it("body mode stays for native apps; logout with the header clears the cookie", async () => {
    const body = await t.request<{ refresh_token: string }>("POST", "/api/v1/auth/login", { body: CREDS.marketing });
    expect(body.body.refresh_token).toMatch(/^rt_/);
    expect(cookieOf(body.headers, "kkt_rt")).toBeNull();
    const r = await t.request<{ refresh_token: string; access_token: string }>("POST", "/api/v1/auth/refresh", {
      body: { refresh_token: body.body.refresh_token },
    });
    expect(r.status).toBe(200);
    expect(r.body.refresh_token).toMatch(/^rt_/);
    const out = await t.request("POST", "/api/v1/auth/logout", {
      token: r.body.access_token,
      headers: { "x-kkt-session": "cookie" },
    });
    expect(out.status).toBe(204);
    expect(cookieOf(out.headers, "kkt_rt")).toMatch(/^kkt_rt=;.*Max-Age=0/);
  });

  it("past REFRESH_ABSOLUTE_TTL_DAYS the family ends: 401 SESSION_EXPIRED, whatever the sliding expiry says", async () => {
    const login = await t.request<{ refresh_token: string }>("POST", "/api/v1/auth/login", { body: CREDS.employee });
    const [row] = await t.app.sql<{ family_id: string; expires_at: Date; family_started_at: Date }[]>`
      select family_id, expires_at, family_started_at from refresh_tokens where token_hash = encode(sha256(${login.body.refresh_token}::bytea), 'hex')`;
    expect(row).toBeTruthy();
    await t.app
      .sql`update refresh_tokens set family_started_at = now() - interval '31 days' where family_id = ${row!.family_id}`;
    const r = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      body: { refresh_token: login.body.refresh_token },
    });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("SESSION_EXPIRED");
    const [revoked] = await t.app.sql<{ n: number }[]>`
      select count(*)::int as n from refresh_tokens where family_id = ${row!.family_id} and revoke_reason = 'SESSION_EXPIRED'`;
    expect(revoked!.n).toBe(1);
  });

  it("portal: the kkt_prt cookie on /api/v1/portal/auth works the same way", async () => {
    await createPortalCustomer(t, { phone: "9700000077", password: "Welcome@123" });
    const login = await t.request<{ refresh_token?: string }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: "9700000077", password: "Welcome@123" },
      headers: { "x-kkt-session": "cookie" },
    });
    expect(login.status, login.text).toBe(200);
    expect(login.body.refresh_token).toBeUndefined();
    const c = cookieOf(login.headers, "kkt_prt")!;
    expect(c).toMatch(/Path=\/api\/v1\/portal\/auth/);
    const r = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/refresh", {
      headers: { cookie: `kkt_prt=${valueOf(c)}`, "x-kkt-session": "cookie" },
    });
    expect(r.status, r.text).toBe(200);
    // a staff cookie is never read by the portal
    const wrong = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/refresh", {
      headers: { cookie: `kkt_rt=${valueOf(c)}`, "x-kkt-session": "cookie" },
    });
    expect(wrong.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 7. Auth cache versions
// ---------------------------------------------------------------------------
describe("auth cache: a change invalidates exactly its subject", () => {
  it("a portal password change revokes that customer's other sessions but leaves other users' cached rows valid", async () => {
    const victim = await createPortalCustomer(t, { phone: "9700000088", password: "Welcome@123" });
    await createPortalCustomer(t, { phone: "9700000089", password: "Welcome@123" });
    const v1 = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: "9700000088", password: "Welcome@123" },
    });
    const v2 = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: "9700000088", password: "Welcome@123" },
    });
    const other = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: "9700000089", password: "Welcome@123" },
    });
    const staff = await t.loginAs("accounts");
    // warm the caches
    expect((await t.request("GET", "/api/v1/portal/auth/me", { token: other.body.access_token })).status).toBe(200);
    expect((await t.request("GET", "/api/v1/auth/me", { token: staff.access_token })).status).toBe(200);
    const globalBefore = await t.app.redis.get(PERM_VERSION_KEY);

    const changed = await t.request("POST", "/api/v1/portal/auth/change-password", {
      token: v1.body.access_token,
      body: { current_password: "Welcome@123", new_password: "Changed@12345" },
    });
    expect(changed.status, changed.text).toBe(200);
    expect(await t.app.redis.get(PERM_VERSION_KEY)).toBe(globalBefore); // no global invalidation any more
    expect(Number(await t.app.redis.get(authVersionKey("portal", victim.portalUserId)))).toBeGreaterThan(0);
    // the customer's other session is gone at once
    expect((await t.request("GET", "/api/v1/portal/auth/me", { token: v2.body.access_token })).status).toBe(401);

    // proof that the other cached rows are still trusted: deactivate them behind the cache's back — a still-valid cached row keeps
    // answering 200 until its 30 s TTL (an invalidated one would re-read the database and answer 401)
    await t.app.sql`update portal_users set is_enabled = false where phone = '9700000089'`;
    await t.app.sql`update users set is_active = false where email = ${CREDS.accounts.email}`;
    try {
      expect((await t.request("GET", "/api/v1/portal/auth/me", { token: other.body.access_token })).status).toBe(200);
      expect((await t.request("GET", "/api/v1/auth/me", { token: staff.access_token })).status).toBe(200);
    } finally {
      await t.app.sql`update portal_users set is_enabled = true where phone = '9700000089'`;
      await t.app.sql`update users set is_active = true where email = ${CREDS.accounts.email}`;
    }
  });

  it("a role permission edit reaches every holder at once (role version), without touching other roles", async () => {
    const roleIdValue = await customRole("Cache probe", ["customer.read"]);
    await newStaff("cache.probe@sgb.in", "Cache-Probe-12345", roleIdValue);
    const probe = (await t.login("cache.probe@sgb.in", "Cache-Probe-12345")).access_token;
    expect((await t.request("GET", "/api/v1/customers", { token: probe })).status).toBe(200);
    expect((await t.request("GET", "/api/v1/leads", { token: probe })).status).toBe(403);
    const [r] = await t.app.sql<{ version: number }[]>`select version from roles where id = ${roleIdValue}`;
    const edit = await t.request("PATCH", `/api/v1/roles/${roleIdValue}`, {
      token: admin,
      body: { permissions: ["dashboard.view", "customer.read", "lead.read"], version: r!.version },
    });
    expect(edit.status, edit.text).toBe(200);
    expect((await t.request("GET", "/api/v1/leads", { token: probe })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 8. Public rate limits behind the website (contract C3)
// ---------------------------------------------------------------------------
describe("public rate limits: per route group, per visitor behind the website (contract C3)", () => {
  it("a valid internal token makes the API count the forwarded visitor IP; without it both headers are ignored", async () => {
    const token = "internal-token-for-tests-0123456789-abcdef";
    const before = { limit: config.PUBLIC_RATE_LIMIT_PER_MIN, token: config.INTERNAL_API_TOKEN };
    (config as { INTERNAL_API_TOKEN?: string }).INTERNAL_API_TOKEN = token;
    (config as { PUBLIC_RATE_LIMIT_PER_MIN: number }).PUBLIC_RATE_LIMIT_PER_MIN = 3;
    try {
      const nextIp = "10.250.0.9"; // the Next.js server
      const statuses = async (headers: Record<string, string>, n: number, url = "/api/v1/public/site") => {
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push((await t.request("GET", url, { ip: nextIp, headers })).status);
        return out;
      };
      // three visitors, each within their own budget although they all arrive from the Next server
      for (const visitor of ["203.0.113.1", "203.0.113.2", "203.0.113.3"])
        expect(await statuses({ "x-kkt-internal-token": token, "x-kkt-client-ip": visitor }, 3)).not.toContain(429);
      // a forged token: headers ignored, everything counts against the Next server's own IP
      const forged = await statuses({ "x-kkt-internal-token": "wrong-token", "x-kkt-client-ip": "198.51.100.7" }, 4);
      expect(forged).toContain(429);
      // groups are separate buckets: the exhausted catalog budget does not block the visit group
      const visits = await t.request("GET", "/api/v1/public/projects/no-such-project/visit-availability", {
        ip: nextIp,
        headers: { "x-kkt-client-ip": "198.51.100.7" },
      });
      expect(visits.status).not.toBe(429);
    } finally {
      (config as { PUBLIC_RATE_LIMIT_PER_MIN: number }).PUBLIC_RATE_LIMIT_PER_MIN = before.limit;
      (config as { INTERNAL_API_TOKEN?: string }).INTERNAL_API_TOKEN = before.token;
    }
  });
});

// ---------------------------------------------------------------------------
// 9. DPDP erasure + audit PII
// ---------------------------------------------------------------------------
describe("DPDP: erasure removes every copy; new audit rows hold PII masked", () => {
  it("customer audit rows mask phone, e-mail, PAN and address, with keyed fingerprints that still show a change", async () => {
    const c = await t.request<{ id: string; version: number }>("POST", "/api/v1/customers", {
      token: admin,
      body: {
        full_name: "Masked Person",
        phone: "9700003210",
        email: "masked.person@example.com",
        pan: "ABCDE1234F",
        co_applicants: [],
        address_current: { line1: "1 Secret Lane", city: "Patna", state: "Bihar", pincode: "800001" },
      },
    });
    expect(c.status, c.text).toBe(201);
    const [created] = await t.app.sql<{ after: Record<string, unknown> }[]>`
      select after from audit_logs where action = 'customer.create' and entity_id = ${c.body.id}`;
    const text = JSON.stringify(created!.after);
    expect(text).not.toContain("9700003210");
    expect(text).not.toContain("masked.person@example.com");
    expect(text).not.toContain("Secret Lane");
    expect(created!.after).toMatchObject({
      phone: "******3210",
      email: "m***@e***.com",
      address_current: "[redacted]",
    });
    expect(created!.after["phone_fp"]).toMatch(/^[0-9a-f]{16}$/);
    const upd = await t.request("PATCH", `/api/v1/customers/${c.body.id}`, {
      token: admin,
      body: { phone: "9700003211", version: c.body.version },
    });
    expect(upd.status, upd.text).toBe(200);
    const [u] = await t.app.sql<{ before: Record<string, unknown>; after: Record<string, unknown> }[]>`
      select before, after from audit_logs where action = 'customer.update' and entity_id = ${c.body.id}`;
    expect(u!.before["phone_fp"]).not.toBe(u!.after["phone_fp"]);
    expect(u!.after["email_fp"]).toBe(u!.before["email_fp"]);
  });

  it("erasure also scrubs drafts, notifications, service-request text and earlier export files, queueing every storage delete", async () => {
    const project = await createProject(t, "Erase Copies", "ERC");
    const cust = await newCustomer(admin, "Ravi Erasable", "9700004444");
    const { bookingId } = await createActiveBooking(t, cust.id, project);
    await t.app.sql`update bookings set status = 'CANCELLED' where id = ${bookingId}`;
    const [adminUser] = await t.app.sql<{ id: string }[]>`select id from users where email = ${CREDS.admin.email}`;
    const [draft] = await t.app.sql<{ id: string }[]>`
      insert into booking_drafts (company_id, user_id, payload) values (${t.companyId}, ${adminUser!.id},
        ${JSON.stringify({ customer: { full_name: "Ravi Erasable", phone: "9700004444" } })}::jsonb) returning id`;
    const [untouched] = await t.app.sql<{ id: string }[]>`
      insert into booking_drafts (company_id, user_id, payload) values (${t.companyId}, ${adminUser!.id},
        ${JSON.stringify({ customer: { full_name: "Someone Else", phone: "9700005555" } })}::jsonb) returning id`;
    await t.app.sql`insert into notifications (company_id, recipient_type, recipient_id, type, title, body)
      values (${t.companyId}, 'CUSTOMER', ${cust.id}, 'DEMAND_RAISED', 'Dear Ravi Erasable, a demand is due', 'Pay soon'),
             (${t.companyId}, 'STAFF', ${adminUser!.id}, 'LEAD_ASSIGNED', 'Call Ravi Erasable on 9700004444', null)`;
    const [cat] = await t.app.sql<{ id: string }[]>`
      insert into service_categories (company_id, name) values (${t.companyId}, 'Erase Plumbing') returning id`;
    const [ticket] = await t.app.sql<{ id: string }[]>`
      insert into service_requests (company_id, ticket_number, customer_id, booking_id, category_id, subject, description, rating_comment)
      values (${t.companyId}, 'SR-ERASE/0001', ${cust.id}, ${bookingId}, ${cat!.id}, 'Leak in Ravi''s bathroom', 'Call me on 9700004444', 'Thanks') returning id`;
    await t.app.sql`insert into service_request_messages (ticket_id, author_type, author_id, author_name, body) values
      (${ticket!.id}, 'CUSTOMER', ${cust.id}, 'Ravi Erasable', 'My flat number is B-101, phone 9700004444'),
      (${ticket!.id}, 'STAFF', ${adminUser!.id}, 'Admin', 'Spoke to Ravi Erasable today')`;
    const [exp] = await t.app.sql<{ id: string }[]>`
      insert into exports (company_id, user_id, path, status, row_count, storage_key, finished_at, expires_at)
      values (${t.companyId}, ${adminUser!.id}, '/api/v1/customers', 'DONE', 10, ${`exports/${t.companyId}/erase-test.csv`}, now(), now() + interval '7 days') returning id`;

    const r = await t.request<{ anonymised: Record<string, number | boolean> }>(
      "POST",
      `/api/v1/admin/customers/${cust.id}/erase`,
      {
        token: admin,
        body: { confirm: "ERASE", reason: "DPDP request" },
        headers: { "idempotency-key": "erase-copies-1" },
      },
    );
    expect(r.status, r.text).toBe(200);
    expect(r.body.anonymised).toMatchObject({
      booking_drafts: 1,
      notifications: 2,
      service_requests: 1,
      exports_removed: 1,
      storage_deletions_queued: 1,
    });
    const drafts = await t.app.sql<
      { id: string; payload: unknown }[]
    >`select id, payload from booking_drafts where id in (${draft!.id}, ${untouched!.id})`;
    expect(drafts.find((d) => d.id === draft!.id)!.payload).toEqual({ erased: true });
    expect(JSON.stringify(drafts.find((d) => d.id === untouched!.id)!.payload)).toContain("Someone Else");
    const notes = await t.app.sql<{ title: string; body: string | null; is_withdrawn: boolean }[]>`
      select title, body, is_withdrawn from notifications where company_id = ${t.companyId} and (recipient_id = ${cust.id} or title like 'Call %')`;
    expect(JSON.stringify(notes)).not.toContain("Ravi");
    expect(JSON.stringify(notes)).not.toContain("9700004444");
    const [tk] = await t.app.sql<{ subject: string; description: string | null; rating_comment: string | null }[]>`
      select subject, description, rating_comment from service_requests where id = ${ticket!.id}`;
    expect(tk).toEqual({ subject: "Service request (customer erased)", description: null, rating_comment: null });
    const msgs = await t.app.sql<
      { body: string }[]
    >`select body from service_request_messages where ticket_id = ${ticket!.id}`;
    expect(JSON.stringify(msgs)).not.toContain("Ravi");
    expect(JSON.stringify(msgs)).not.toContain("9700004444");
    const [e] = await t.app.sql<
      { status: string; error: string }[]
    >`select status, error from exports where id = ${exp!.id}`;
    expect(e!.status).toBe("FAILED");
    expect(e!.error).toMatch(/erased/);
    const [q] = await t.app.sql<{ n: number }[]>`
      select count(*)::int as n from storage_deletions where key = ${`exports/${t.companyId}/erase-test.csv`} and reason = 'CUSTOMER_ERASED'`;
    expect(q!.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10. Deprecated duplicates
// ---------------------------------------------------------------------------
describe("duplicate routes: one canonical implementation, the alias deprecated", () => {
  it("GET /permissions answers like GET /roles/permissions and carries Deprecation / Sunset / Link", async () => {
    const canonical = await t.request("GET", "/api/v1/roles/permissions", { token: admin });
    const alias = await t.request("GET", "/api/v1/permissions", { token: admin });
    expect(alias.status).toBe(200);
    expect(alias.body).toEqual(canonical.body);
    expect(canonical.headers["deprecation"]).toBeUndefined();
    expect(alias.headers["deprecation"]).toMatch(/^@\d+$/);
    expect(String(alias.headers["sunset"])).toContain("2027");
    expect(String(alias.headers["link"])).toContain('</api/v1/roles/permissions>; rel="successor-version"');
  });

  it("POST /customers/:id/erase is idempotent like the canonical route (same key → same response, nothing erased twice)", async () => {
    const c = await newCustomer(admin, "Alias Erase", "9700006666");
    const first = await t.request<{ erased_at: string; version: number }>("POST", `/api/v1/customers/${c.id}/erase`, {
      token: admin,
      body: { confirm: "ERASE", reason: "DPDP" },
      headers: { "idempotency-key": "alias-erase-1" },
    });
    expect(first.status, first.text).toBe(200);
    const replay = await t.request<{ erased_at: string; version: number }>("POST", `/api/v1/customers/${c.id}/erase`, {
      token: admin,
      body: { confirm: "ERASE", reason: "DPDP" },
      headers: { "idempotency-key": "alias-erase-1" },
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    const route = t.app.routeRegistry.find((x) => x.url === "/api/v1/customers/:id/erase" && x.method === "POST");
    expect(route).toMatchObject({ idempotent: true, sunset: "2027-04-24" });
  });
});
