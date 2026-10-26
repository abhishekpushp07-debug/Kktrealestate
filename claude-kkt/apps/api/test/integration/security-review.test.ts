import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "@kkt/contracts";
import { createProject } from "./fixtures.js";
import { createActiveBooking, validAadhaar } from "./fixtures/crm.js";
import { buildTestApp, CREDS, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Adversarial review of the security track: attacks the hardening of security-hardening.test.ts from the angles its tests left open —
 * scope escalation through account management, granting Super Admin by permission parity, self password reset, parallel login bursts,
 * KYC identifiers swapped after verification, writes to erased customers, the key-rotation job racing a user edit, one-time passwords
 * in HTTP caches, and authentication against a Redis client that is really down (offline queue + retries, not a fail-fast stub).
 */
let t: TestContext;
let admin: string;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
});
afterAll(async () => { await t?.close(); });

async function roleId(name: string): Promise<string> {
  const [r] = await t.app.sql<{ id: string }[]>`select id from roles where name = ${name} and company_id = ${t.companyId}`;
  return r!.id;
}

async function newStaff(email: string, password: string, roleName: string, extra: Record<string, unknown> = {}): Promise<{ id: string; version: number }> {
  const r = await t.request<{ id: string; version: number }>("POST", "/api/v1/users", { token: admin, body: { name: email.split("@")[0], email, role_id: await roleId(roleName), password, must_change_password: false, ...extra } });
  if (r.status !== 201) throw new Error(`user create failed: ${r.text}`);
  return r.body;
}

function reason(r: { body: ErrorBody }): unknown {
  return r.body.error.details?.["reason"];
}

describe("account management cannot widen the caller's reach", () => {
  let projectA: string;
  let projectB: string;
  let scopedAdmin: string;

  beforeAll(async () => {
    projectA = await createProject(t, "Review Scope Alpha", "RSA");
    projectB = await createProject(t, "Review Scope Beta", "RSB");
    const role = await t.request<{ id: string }>("POST", "/api/v1/roles", { token: admin, body: { name: "Scoped user admin", permissions: [...new Set([...SYSTEM_ROLES.Employee.permissions, "users.manage"])] } });
    expect(role.status).toBe(201);
    await newStaff("review.scoped@sgb.in", "Review-Scoped-12", "Scoped user admin", { all_projects: false, project_ids: [projectA] });
    scopedAdmin = (await t.login("review.scoped@sgb.in", "Review-Scoped-12")).access_token;
  });

  it("a project-scoped administrator cannot take over an all-projects or other-project account (password reset, deactivate, edit)", async () => {
    const wide = await newStaff("review.wide@sgb.in", "Review-Wide-123", "Employee", { all_projects: true });
    const other = await newStaff("review.other@sgb.in", "Review-Other-12", "Employee", { all_projects: false, project_ids: [projectB] });
    const inside = await newStaff("review.inside@sgb.in", "Review-Inside-1", "Employee", { all_projects: false, project_ids: [projectA] });
    for (const target of [wide, other]) {
      const reset = await t.request<ErrorBody>("POST", `/api/v1/users/${target.id}/reset-password`, { token: scopedAdmin, body: { version: target.version, new_password: "Taken-Over-1234", must_change_password: false } });
      expect(reset.status, reset.text).toBe(403);
      expect(reason(reset)).toBe("SCOPE_ESCALATION");
      const off = await t.request<ErrorBody>("POST", `/api/v1/users/${target.id}/deactivate`, { token: scopedAdmin, body: {} });
      expect(off.status).toBe(403);
      const rename = await t.request<ErrorBody>("PATCH", `/api/v1/users/${target.id}`, { token: scopedAdmin, body: { version: target.version, email: "attacker@evil.example" } });
      expect(rename.status).toBe(403);
      expect(reason(rename)).toBe("SCOPE_ESCALATION");
    }
    // nothing changed: the old passwords still work
    expect((await t.request("POST", "/api/v1/auth/login", { body: { email: "review.wide@sgb.in", password: "Review-Wide-123" } })).status).toBe(200);
    // an account inside the caller's own scope stays manageable
    const ok = await t.request<{ temp_password?: string }>("POST", `/api/v1/users/${inside.id}/reset-password`, { token: scopedAdmin, body: { version: inside.version, must_change_password: true } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.temp_password).toBeTruthy();
  });

  it("holding every permission is not enough to make a Super Admin; only a Super Admin grants that role", async () => {
    const all = await t.request<{ id: string }>("POST", "/api/v1/roles", { token: admin, body: { name: "Everything but Super Admin", permissions: [...ALL_PERMISSIONS] } });
    expect(all.status, all.text).toBe(201);
    await newStaff("review.all@sgb.in", "Review-All-1234", "Everything but Super Admin");
    const tok = (await t.login("review.all@sgb.in", "Review-All-1234")).access_token;
    const create = await t.request<ErrorBody>("POST", "/api/v1/users", { token: tok, body: { name: "Shadow SA", email: "shadow.sa@sgb.in", role_id: await roleId("Super Admin"), password: "Shadow-Super-123", must_change_password: false } });
    expect(create.status).toBe(403);
    expect(reason(create)).toBe("SUPER_ADMIN_TARGET");
    const emp = await newStaff("review.promote@sgb.in", "Review-Promote-1", "Employee");
    const promote = await t.request<ErrorBody>("PATCH", `/api/v1/users/${emp.id}`, { token: tok, body: { version: emp.version, role_id: await roleId("Super Admin") } });
    expect(promote.status).toBe(403);
    expect(reason(promote)).toBe("SUPER_ADMIN_TARGET");
    // the Super Admin may
    const real = await t.request("PATCH", `/api/v1/users/${emp.id}`, { token: admin, body: { version: emp.version, role_id: await roleId("Super Admin") } });
    expect(real.status).toBe(200);
  });

  it("nobody resets their own password through the admin route (a stolen session must not set a password without the current one)", async () => {
    const [me] = await t.app.sql<{ id: string; version: number }[]>`select id, version from users where email = ${CREDS.admin.email}`;
    const self = await t.request<ErrorBody>("POST", `/api/v1/users/${me!.id}/reset-password`, { token: admin, body: { version: me!.version, new_password: "Self-Reset-12345", must_change_password: false } });
    expect(self.status).toBe(403);
    expect(reason(self)).toBe("SELF_CHANGE");
  });
});

describe("parallel login bursts cannot exceed the lockout budget", () => {
  it("10 simultaneous wrong passwords from one IP evaluate at most 5 guesses; the rest are refused without a password check", async () => {
    await newStaff("review.burst@sgb.in", "Review-Burst-12", "Employee");
    const ip = "10.250.9.9";
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => t.request<ErrorBody>("POST", "/api/v1/auth/login", { ip, body: { email: "review.burst@sgb.in", password: `Wrong-Guess-${i}` } })));
    for (const r of results) expect([401, 423, 429]).toContain(r.status);
    const [n] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from login_events where identifier = 'review.burst@sgb.in' and reason = 'BAD_PASSWORD'`;
    expect(n!.n).toBeLessThanOrEqual(5);
    // the pair is now locked; another IP still signs in (no lockout DoS)
    expect((await t.request("POST", "/api/v1/auth/login", { ip, body: { email: "review.burst@sgb.in", password: "Review-Burst-12" } })).status).toBeGreaterThanOrEqual(400);
    expect((await t.request("POST", "/api/v1/auth/login", { ip: "10.250.9.10", body: { email: "review.burst@sgb.in", password: "Review-Burst-12" } })).status).toBe(200);
  });

  it("the same burst against an unknown e-mail produces the same status mix (no enumeration through the guard)", async () => {
    const ip = "10.250.9.11";
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => t.request<ErrorBody>("POST", "/api/v1/auth/login", { ip, body: { email: "nobody.here@sgb.in", password: `Wrong-Guess-${i}` } })));
    for (const r of results) expect([401, 423, 429]).toContain(r.status);
    const [n] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from login_events where identifier = 'nobody.here@sgb.in' and reason = 'UNKNOWN_USER'`;
    expect(n!.n).toBeLessThanOrEqual(5);
  });
});

describe("customer records", () => {
  async function newCustomer(name: string, phone: string, extra: Record<string, unknown> = {}) {
    const r = await t.request<{ id: string; version: number; customer_code: string; kyc_status: string }>("POST", "/api/v1/customers", { token: admin, body: { full_name: name, phone, ...extra } });
    if (r.status !== 201) throw new Error(r.text);
    return r.body;
  }
  async function version(id: string): Promise<number> {
    const [c] = await t.app.sql<{ version: number }[]>`select version from customers where id = ${id}`;
    return c!.version;
  }

  it("swapping PAN or Aadhaar after verification sends KYC back to PENDING (a verified badge never covers new identifiers)", async () => {
    const sales = await t.loginAs("sales");
    const c = await newCustomer("Kyc Swap", "9855500001", { pan: "KYCSW1234K", aadhaar: validAadhaar("34567890124") });
    await t.app.sql`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, is_sensitive)
      values (${t.companyId}, 'CUSTOMER', ${c.id}, 'swap.jpg', 'image/jpeg', 100, 'sha-swap', 'k/swap', 'STAFF', true)`;
    expect((await t.request("POST", `/api/v1/customers/${c.id}/kyc`, { token: sales.access_token, body: { version: await version(c.id), kyc_status: "SUBMITTED" } })).status).toBe(200);
    const verified = await t.request<{ kyc_status: string }>("POST", `/api/v1/customers/${c.id}/kyc`, { token: admin, body: { version: await version(c.id), kyc_status: "VERIFIED" } });
    expect(verified.body.kyc_status).toBe("VERIFIED");
    // re-sending the same PAN (a full edit form) keeps the verification
    const same = await t.request<{ kyc_status: string }>("PATCH", `/api/v1/customers/${c.id}`, { token: sales.access_token, body: { version: await version(c.id), pan: "kycsw1234k", notes: "met at site" } });
    expect(same.status, same.text).toBe(200);
    expect(same.body.kyc_status).toBe("VERIFIED");
    // a different PAN does not
    const swapped = await t.request<{ kyc_status: string; kyc_verified_by: string | null }>("PATCH", `/api/v1/customers/${c.id}`, { token: sales.access_token, body: { version: await version(c.id), pan: "OTHER1234Z" } });
    expect(swapped.status, swapped.text).toBe(200);
    expect(swapped.body.kyc_status).toBe("PENDING");
    expect(swapped.body.kyc_verified_by).toBeNull();
    const [audit] = await t.app.sql<{ after: { reason: string; kyc_status: string } }[]>`select after from audit_logs where action = 'customer.kyc_reset' and entity_id = ${c.id}`;
    expect(audit!.after).toMatchObject({ kyc_status: "PENDING", reason: "IDENTIFIERS_CHANGED" });
  });

  it("an erased customer takes no new co-applicant (no PII re-enters an erased record)", async () => {
    const c = await newCustomer("Erase Then Add", "9855500002");
    const erased = await t.request("POST", `/api/v1/customers/${c.id}/erase`, { token: admin, body: { confirm: "ERASE", reason: "Customer request" } });
    expect(erased.status, erased.text).toBe(200);
    const add = await t.request<ErrorBody>("POST", `/api/v1/customers/${c.id}/co-applicants`, { token: admin, body: { full_name: "Late Spouse", relation: "Wife", phone: "9855500003" } });
    expect(add.status).toBe(422);
    expect(add.body.error.details?.["rule"]).toBe("CUSTOMER_ERASED");
  });

  it("one-time passwords are never cacheable (bulk enable JSON and single enable)", async () => {
    const p = await createProject(t, "Review Portal Towers", "RPT");
    const c1 = await newCustomer("Review Portal One", "9855500011");
    const c2 = await newCustomer("Review Portal Two", "9855500012");
    await createActiveBooking(t, c1.id, p);
    await createActiveBooking(t, c2.id, p);
    const single = await t.request<{ temp_password: string | null }>("POST", `/api/v1/customers/${c2.id}/portal/enable`, { token: admin, body: {} });
    expect(single.status, single.text).toBe(200);
    expect(single.body.temp_password).toBeTruthy();
    expect(String(single.headers["cache-control"])).toContain("no-store");
    const bulk = await t.request<{ enabled: number; already_enabled: number; failed?: number }>("POST", "/api/v1/customers/portal/bulk-enable", { token: admin, body: { project_id: p } });
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body).toMatchObject({ enabled: 1, already_enabled: 1 });
    expect(bulk.body.failed).toBeUndefined();
    expect(String(bulk.headers["cache-control"])).toContain("no-store");
  });
});

describe("REENCRYPT_FIELDS never overwrites a value a user changed mid-pass", () => {
  it("a PAN edited between the batch read and its update keeps the new value", async () => {
    const { config } = await import("../../src/config.js");
    const { reencryptFields } = await import("../../src/modules/auth/reencrypt.js");
    const { decryptField, encryptField } = await import("../../src/lib/crypto.js");
    const c = await t.request<{ id: string }>("POST", "/api/v1/customers", { token: admin, body: { full_name: "Rotate Race", phone: "9855500021", pan: "RACEO1234R" } });
    expect(c.status, c.text).toBe(201);
    const original = config.FIELD_KEY_RING;
    try {
      config.FIELD_KEY_RING = [{ kid: "k9", secret: "review-race-field-key-0123456789abcdef-k9" }, ...original];
      const db = t.app.db;
      let interfered = false;
      // A user saves a new PAN after the job read the batch and before it writes it back.
      const racing = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "transaction") {
            return async (fn: (tx: unknown) => Promise<unknown>) => {
              if (!interfered) {
                interfered = true;
                await t.app.sql`update customers set pan_enc = ${encryptField("NEWPA1234N")} where id = ${c.body.id}`;
              }
              return target.transaction(fn as never);
            };
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
      });
      const result = await reencryptFields(racing as typeof db, { batchSize: 500 });
      expect(interfered).toBe(true);
      expect(result.remaining).toBe(0);
      const [row] = await t.app.sql<{ pan_enc: string }[]>`select pan_enc from customers where id = ${c.body.id}`;
      expect(decryptField(row!.pan_enc)).toBe("NEWPA1234N");
      expect(row!.pan_enc.startsWith("k9.")).toBe(true);
    } finally {
      config.FIELD_KEY_RING = [...original, { kid: "k9", secret: "review-race-field-key-0123456789abcdef-k9" }];
    }
  });
});

describe("authentication with a Redis that is really down", () => {
  it("a client with retries and an offline queue (production settings) still signs in and authenticates within seconds", async () => {
    const { createRedis } = await import("../../src/plugins/redis.js");
    const dead = createRedis("redis://127.0.0.1:1");
    dead.on("error", () => undefined);
    const host = t.app as unknown as { redisSecurity: unknown; redis: unknown };
    const [cache, security] = [host.redis, host.redisSecurity];
    host.redis = dead;
    host.redisSecurity = dead;
    try {
      const started = Date.now();
      const login = await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", { body: CREDS.accounts });
      expect(login.status, login.text).toBe(200);
      // sign-in touches Redis only for the rate limit, which fails open within its 250 ms budget
      expect(Date.now() - started).toBeLessThan(2_000);
      const me = await t.request("GET", "/api/v1/auth/me", { token: login.body.access_token });
      expect(me.status, me.text).toBe(200);
      const list = await t.request("GET", "/api/v1/customers?limit=5", { token: login.body.access_token });
      expect(list.status, list.text).toBe(200);
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      host.redis = cache;
      host.redisSecurity = security;
      dead.disconnect();
    }
  }, 30_000);
});
