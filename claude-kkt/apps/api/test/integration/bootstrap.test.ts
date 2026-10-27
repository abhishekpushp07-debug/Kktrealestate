import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { BOOTSTRAP_USERS, BootstrapRefused, bootstrapMode, ensureBootstrap } from "../../src/seed/bootstrap.js";
import { reseed, seedDemo, SEED_LOCK_KEY, truncateBusinessTables } from "../../src/seed/run.js";
import { buildTestApp, truncateAll, type TestContext } from "./helpers.js";

/**
 * Production bootstrap (audit D "default admin credentials and the full demo dataset are created on first production boot"):
 * production is simulated in-process by switching `config` (NODE_ENV, SEED_DEMO, BOOTSTRAP_*) and restoring it after every test.
 */
let t: TestContext;
const saved = {
  NODE_ENV: config.NODE_ENV,
  SEED_DEMO: config.SEED_DEMO,
  name: config.BOOTSTRAP_COMPANY_NAME,
  email: config.BOOTSTRAP_ADMIN_EMAIL,
  password: config.BOOTSTRAP_ADMIN_PASSWORD,
};

function production(env: { name?: string; email?: string; password?: string; seedDemo?: boolean } = {}): void {
  config.NODE_ENV = "production";
  config.SEED_DEMO = env.seedDemo ?? false;
  config.BOOTSTRAP_COMPANY_NAME = env.name;
  config.BOOTSTRAP_ADMIN_EMAIL = env.email;
  config.BOOTSTRAP_ADMIN_PASSWORD = env.password;
}

async function counts(): Promise<{ companies: number; roles: number; users: number; projects: number }> {
  const [r] = await t.app.sql<{ companies: number; roles: number; users: number; projects: number }[]>`
    select (select count(*)::int from companies) as companies, (select count(*)::int from roles) as roles,
           (select count(*)::int from users) as users, (select count(*)::int from projects) as projects`;
  return r!;
}

beforeAll(async () => {
  t = await buildTestApp();
});
afterEach(async () => {
  config.NODE_ENV = saved.NODE_ENV;
  config.SEED_DEMO = saved.SEED_DEMO;
  config.BOOTSTRAP_COMPANY_NAME = saved.name;
  config.BOOTSTRAP_ADMIN_EMAIL = saved.email;
  config.BOOTSTRAP_ADMIN_PASSWORD = saved.password;
});
afterAll(async () => {
  // leave the database as every other suite expects it: the demo bootstrap
  await truncateAll(t.app.sql);
  await ensureBootstrap(t.app.db, { mode: "demo" });
  await t?.close();
});

describe("production bootstrap", () => {
  it("refuses to start on a fresh production database without BOOTSTRAP_* settings, and writes nothing", async () => {
    await truncateAll(t.app.sql);
    production();
    expect(bootstrapMode()).toBe("production");
    await expect(ensureBootstrap(t.app.db)).rejects.toBeInstanceOf(BootstrapRefused);
    await expect(ensureBootstrap(t.app.db)).rejects.toThrow(
      /BOOTSTRAP_COMPANY_NAME is not set; BOOTSTRAP_ADMIN_EMAIL is not set; BOOTSTRAP_ADMIN_PASSWORD is not set/,
    );
    expect(await counts()).toEqual({ companies: 0, roles: 0, users: 0, projects: 0 });
  });

  it("refuses a password that fails the policy (and never echoes it)", async () => {
    await truncateAll(t.app.sql);
    production({ name: "Acme Builders", email: "owner@acme.example", password: "alllowercase123" });
    const err = (await ensureBootstrap(t.app.db).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(BootstrapRefused);
    expect(err.message).toMatch(/upper-case/);
    expect(err.message).not.toContain("alllowercase123");
    expect((await counts()).companies).toBe(0);
  });

  it("creates the company, the six system roles and ONE Super Admin who must change the password — never a demo user", async () => {
    await truncateAll(t.app.sql);
    production({ name: "Acme Builders", email: "Owner@Acme.example", password: "Strong-Owner-Pass-1" });
    const boot = await ensureBootstrap(t.app.db);
    expect(boot).toMatchObject({ created: true, mode: "production", adminEmail: "owner@acme.example" });
    const [company] = await t.app.sql<{ name: string; gstin: string | null }[]>`select name, gstin from companies`;
    expect(company).toEqual({ name: "Acme Builders", gstin: null });
    const roleNames = (await t.app.sql<{ name: string }[]>`select name from roles where is_system order by name`).map(
      (r) => r.name,
    );
    expect(roleNames).toEqual(["Accounts", "Employee", "Marketing", "Project Admin", "Sales", "Super Admin"]);
    const users = await t.app.sql<
      { email: string; must_change_password: boolean; role: string }[]
    >`select u.email, u.must_change_password, r.name as role from users u join roles r on r.id = u.role_id`;
    expect(users).toEqual([{ email: "owner@acme.example", must_change_password: true, role: "Super Admin" }]);
    for (const demo of BOOTSTRAP_USERS) expect(users.some((u) => u.email === demo.email)).toBe(false);
    // the admin signs in and is forced to change the password first
    const login = await t.request<{ must_change_password: boolean; access_token: string }>(
      "POST",
      "/api/v1/auth/login",
      { body: { email: "owner@acme.example", password: "Strong-Owner-Pass-1" } },
    );
    expect(login.status).toBe(200);
    expect(login.body.must_change_password).toBe(true);
    expect((await t.request("GET", "/api/v1/users", { token: login.body.access_token })).status).toBe(403);
    // idempotent at every later boot, even once the BOOTSTRAP_* settings are removed
    production();
    const again = await ensureBootstrap(t.app.db);
    expect(again).toMatchObject({ created: false, companyId: boot.companyId, adminEmail: null });
    expect(await counts()).toMatchObject({ companies: 1, roles: 6, users: 1 });
  });

  it("concurrent replicas booting together create exactly one company and one admin (advisory lock)", async () => {
    await truncateAll(t.app.sql);
    production({ name: "Race Builders", email: "race@acme.example", password: "Strong-Race-Pass-1" });
    const results = await Promise.all([
      ensureBootstrap(t.app.db),
      ensureBootstrap(t.app.db),
      ensureBootstrap(t.app.db),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.companyId)).size).toBe(1);
    expect(await counts()).toMatchObject({ companies: 1, roles: 6, users: 1 });
  });

  it("the demo bootstrap is also race-free (no duplicate company or logins)", async () => {
    await truncateAll(t.app.sql);
    const results = await Promise.all([
      ensureBootstrap(t.app.db, { mode: "demo" }),
      ensureBootstrap(t.app.db, { mode: "demo" }),
    ]);
    expect(new Set(results.map((r) => r.companyId)).size).toBe(1);
    expect(await counts()).toMatchObject({ companies: 1, roles: 6, users: BOOTSTRAP_USERS.length });
  });

  it("production with SEED_DEMO=true keeps the demo bootstrap", () => {
    production({ seedDemo: true });
    expect(bootstrapMode()).toBe("demo");
  });
});

describe("demo seed guards", () => {
  it("seedDemo refuses in production unless SEED_DEMO=true, and reseed stays refused in production", async () => {
    production({ name: "Acme Builders", email: "owner@acme.example", password: "Strong-Owner-Pass-1" });
    const r = await seedDemo(t.app);
    expect(r).toMatchObject({ skipped: true, refused: "production" });
    expect((await counts()).projects).toBe(0);
    await expect(reseed(t.app.db, { app: t.app })).rejects.toThrow(/production/);
  });

  it("seedDemo runs under an advisory lock: a second replica waits, then sees the data and skips", async () => {
    await t.app
      .sql`insert into projects (company_id, name, code, city) values ((select id from companies limit 1), 'Locked Heights', 'LKH', 'Patna')`;
    const holder = await t.app.sql.reserve();
    try {
      await holder`select pg_advisory_lock(hashtext(${SEED_LOCK_KEY}))`;
      let settled = false;
      const run = seedDemo(t.app, { log: () => undefined }).then((r) => {
        settled = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false); // blocked behind the lock
      await holder`select pg_advisory_unlock(hashtext(${SEED_LOCK_KEY}))`;
      expect(await run).toMatchObject({ skipped: true });
    } finally {
      holder.release();
    }
  });

  it("truncating the business tables works without disabling any trigger and keeps the audit log", async () => {
    await t.loginAs("admin"); // writes an auth.login audit row
    const [before] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs`;
    const truncated = await truncateBusinessTables(t.app);
    expect(truncated).toContain("projects");
    expect(truncated).not.toContain("audit_logs");
    const [after] = await t.app.sql<
      { n: number; p: number }[]
    >`select (select count(*)::int from audit_logs) as n, (select count(*)::int from projects) as p`;
    expect(before!.n).toBeGreaterThan(0);
    expect(after!.n).toBe(before!.n);
    expect(after!.p).toBe(0);
    // the append-only guards are still armed
    await expect(t.app.sql`delete from audit_logs`).rejects.toThrow(/immutable/);
  });
});
