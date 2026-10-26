import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIST } from "@kkt/domain";
import { config } from "../../src/config.js";
import { jobHandler, registerJob, runJob, sweepAbandonedJobRuns } from "../../src/jobs/index.js";
import { scrapeMetrics } from "../../src/lib/metrics.js";
import { createRedis } from "../../src/plugins/redis.js";
import { createWebProject, publishWebProject, type WebProject } from "./fixtures/web.js";
import { createCustomer } from "./fixtures/money.js";
import { buildTestApp, freshIp, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Cross-track fixes (docs/hardening): one-time secrets never reach the idempotency store (item 2), API docs exposure (item 3), job
 * observability glue — metrics per run, ABANDONED sweeper (item 4) — and the Redis outage latency budget (item 5).
 */
let t: TestContext;
let admin: string;
let sales: string;
let n = 0;
const key = () => `xt-${Date.now()}-${++n}`;

/** Every idempotency record (Postgres row and Redis copy) as text, to search for leaked secrets. */
async function idempotencyStoreText(): Promise<string> {
  const rows = await t.app.sql<{ body: string | null }[]>`select response_body::text as body from idempotency_keys`;
  const keys = await t.app.redis.keys("idem:*");
  const cached = keys.length ? await t.app.redis.mget(...keys) : [];
  return [...rows.map((r) => r.body ?? ""), ...cached.map((c) => c ?? "")].join("\n");
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  sales = (await t.loginAs("sales")).access_token;
});
afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------
describe("item 2: one-time secrets are never persisted by the idempotency store", () => {
  it("POST /users: the temp password is returned once; the stored replay is redacted and a replay is 409 IDEMPOTENT_SECRET_REPLAY", async () => {
    const roles = await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles?page_size=50", {
      token: admin,
    });
    const salesRole = roles.body.items.find((r) => r.name === "Sales")!;
    const k = key();
    const body = { name: "Secret Keeper", email: "secret.keeper@sgb.in", role_id: salesRole.id };
    const created = await t.request<{ id: string; temp_password?: string }>("POST", "/api/v1/users", {
      token: admin,
      body,
      headers: { "idempotency-key": k },
    });
    expect(created.status, created.text).toBe(201);
    const password = created.body.temp_password!;
    expect(password.length).toBeGreaterThanOrEqual(8);
    const stored = await idempotencyStoreText();
    expect(stored).toContain(created.body.id); // the record exists …
    expect(stored).not.toContain(password); // … without the secret, in Postgres and in Redis
    expect(stored).toContain("[redacted]");

    const replay = await t.request<ErrorBody>("POST", "/api/v1/users", {
      token: admin,
      body,
      headers: { "idempotency-key": k },
    });
    expect(replay.status, replay.text).toBe(409);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.error.code).toBe("IDEMPOTENT_SECRET_REPLAY");
    expect(replay.body.error.details).toMatchObject({
      original_status: 201,
      redacted_fields: ["temp_password"],
      original: { id: created.body.id, email: "secret.keeper@sgb.in", temp_password: "[redacted]" },
    });
    expect(replay.text).not.toContain(password);
    // the same key with a different body is still a mismatch, not a secret replay
    const other = await t.request<ErrorBody>("POST", "/api/v1/users", {
      token: admin,
      body: { ...body, name: "Someone Else" },
      headers: { "idempotency-key": k },
    });
    expect(other.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    // the password works (it was issued, only not stored)
    expect(
      (await t.request("POST", "/api/v1/auth/login", { body: { email: "secret.keeper@sgb.in", password } })).status,
    ).toBe(200);
  });

  it("POST /users with an explicit password carries no secret: stored and replayed normally", async () => {
    const roles = await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles?page_size=50", {
      token: admin,
    });
    const k = key();
    const body = {
      name: "Plain Create",
      email: "plain.create@sgb.in",
      role_id: roles.body.items.find((r) => r.name === "Sales")!.id,
      password: "Plain-Create-Pass-1",
    };
    const first = await t.request<{ id: string; temp_password?: string }>("POST", "/api/v1/users", {
      token: admin,
      body,
      headers: { "idempotency-key": k },
    });
    expect(first.status, first.text).toBe(201);
    expect(first.body.temp_password).toBeUndefined();
    const again = await t.request<{ id: string }>("POST", "/api/v1/users", {
      token: admin,
      body,
      headers: { "idempotency-key": k },
    });
    expect(again.status).toBe(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.id).toBe(first.body.id);
    expect(await idempotencyStoreText()).not.toContain("Plain-Create-Pass-1");
  });

  it("portal enable / reset / bulk enable are not idempotent: an Idempotency-Key stores nothing, the password exists only in the response", async () => {
    const customerId = await createCustomer(t, "Portal Secret");
    const before = (await t.app.sql<{ n: number }[]>`select count(*)::int as n from idempotency_keys`)[0]!.n;
    const enable = await t.request<{ temp_password: string | null }>(
      "POST",
      `/api/v1/customers/${customerId}/portal/enable`,
      { token: admin, body: {}, headers: { "idempotency-key": key() } },
    );
    expect(enable.status, enable.text).toBe(200);
    expect(enable.body.temp_password).toBeTruthy();
    expect(enable.headers["cache-control"]).toBe("no-store");
    const reset = await t.request<{ temp_password: string | null }>(
      "POST",
      `/api/v1/customers/${customerId}/portal/reset-password`,
      { token: admin, body: {}, headers: { "idempotency-key": key() } },
    );
    expect(reset.status, reset.text).toBe(200);
    expect(reset.body.temp_password).toBeTruthy();
    const action = await t.request<{ temp_password: string | null }>("POST", `/api/v1/customers/${customerId}/portal`, {
      token: admin,
      body: { action: "RESET_PASSWORD" },
      headers: { "idempotency-key": key() },
    });
    expect(action.status, action.text).toBe(200);
    const bulk = await t.request("POST", "/api/v1/customers/portal/bulk-enable", {
      token: admin,
      body: {},
      headers: { "idempotency-key": key() },
    });
    expect(bulk.status, bulk.text).toBe(200);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from idempotency_keys`)[0]!.n).toBe(before);
    const stored = await idempotencyStoreText();
    for (const secret of [enable.body.temp_password!, reset.body.temp_password!, action.body.temp_password!])
      expect(stored).not.toContain(secret);
  });

  it("every idempotent route that can answer with a one-time secret declares it (route registry)", () => {
    const SECRET_FIELDS = new Set([
      "temp_password",
      "temporary_password",
      "password",
      "manage_url",
      "manage_token",
      "ics_url",
      "credentials",
      "secret",
      "otpauth_url",
      "access_token",
      "refresh_token",
      "token",
      "download_url",
    ]);
    // reviewed exceptions: the brochure link is a 15-minute signed link to public marketing material (gated only by lead capture);
    // replaying it to the same visitor within its life is the point of the idempotency key
    const ALLOWED = new Set(["POST /api/v1/public/brochure-requests → download_url"]);
    const idempotent = t.app.routeRegistry.filter((r) => r.idempotent);
    expect(idempotent.length).toBeGreaterThan(30);
    const uncovered = idempotent
      .flatMap((r) =>
        (r.responseFields ?? [])
          .filter((f) => SECRET_FIELDS.has(f) && !(r.oneTimeSecrets ?? []).includes(f))
          .map((f) => `${r.method} ${r.url} → ${f}`),
      )
      .filter((x) => !ALLOWED.has(x));
    expect(uncovered).toEqual([]);
    const declared = Object.fromEntries(
      idempotent
        .filter((r) => (r.oneTimeSecrets ?? []).length > 0)
        .map((r) => [`${r.method} ${r.url}`, r.oneTimeSecrets]),
    );
    expect(declared).toEqual({
      "POST /api/v1/users": ["temp_password"],
      "POST /api/v1/site-visits": ["manage_url"],
      "POST /api/v1/public/site-visits": ["manage_url", "ics_url"],
      "POST /api/v1/public/site-visits/:token/reschedule": ["manage_url", "manage_token", "ics_url"],
    });
    // the routes that hand out portal passwords are deliberately not idempotent (nothing is stored for them at all)
    for (const url of [
      "/api/v1/customers/:id/portal/enable",
      "/api/v1/customers/:id/portal/reset-password",
      "/api/v1/customers/:id/portal",
      "/api/v1/customers/portal/bulk-enable",
      "/api/v1/users/:id/reset-password",
    ]) {
      const r = t.app.routeRegistry.find((e) => e.method === "POST" && e.url === url);
      expect(r, url).toBeDefined();
      expect(r!.idempotent, url).toBeUndefined();
    }
  });

  it("public visit booking: the manage link never reaches the store; a replay gets the redacted original", async () => {
    const wp: WebProject = await createWebProject(t, admin, { name: "Secret Heights", code: "SCH", suffix: "X7" });
    await publishWebProject(t, admin, wp);
    const cur = await t.request<{ version: number }>("GET", `/api/v1/projects/${wp.projectId}/visit-settings`, {
      token: admin,
    });
    const D = (d: number) => addDays(todayIST(), d);
    const patch = await t.request("PATCH", `/api/v1/projects/${wp.projectId}/visit-settings`, {
      token: admin,
      body: {
        version: cur.body.version,
        settings: {
          enabled: true,
          visit_days: [0, 1, 2, 3, 4, 5, 6],
          start_time: "10:00",
          end_time: "13:00",
          slot_minutes: 60,
          seats_per_slot: 4,
          min_lead_hours: 48,
          max_days_ahead: 14,
          blackout_dates: [],
        },
      },
    });
    expect(patch.status, patch.text).toBe(200);
    const ip = freshIp();
    const k = key();
    const body = {
      project_slug: wp.slug,
      visit_date: D(6),
      slot_start: "11:00",
      name: "Secret Visitor",
      phone: "9876611122",
      visitors: 1,
      consent: true,
      website: "",
    };
    const first = await t.request<{ visit_number: string; manage_url: string; ics_url: string }>(
      "POST",
      "/api/v1/public/site-visits",
      { ip, body, headers: { "idempotency-key": k } },
    );
    expect(first.status, first.text).toBe(201);
    const token = new URL(first.body.manage_url).pathname.split("/").pop()!;
    expect(token.length).toBeGreaterThan(10);
    const stored = await idempotencyStoreText();
    expect(stored).toContain(first.body.visit_number);
    expect(stored).not.toContain(token);
    const replay = await t.request<ErrorBody>("POST", "/api/v1/public/site-visits", {
      ip,
      body,
      headers: { "idempotency-key": k },
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error.details).toMatchObject({
      original: { visit_number: first.body.visit_number, manage_url: "[redacted]" },
    });
    expect(replay.text).not.toContain(token);
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from site_visits where phone = '9876611122'`)[0]!.n,
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("item 3: API docs are not public unless DOCS_PUBLIC (default off in production)", () => {
  const DOCS = ["/api/v1/openapi.json", "/api/v1/docs/json", "/api/v1/docs/static/swagger-ui.css"];
  it("with DOCS_PUBLIC=false: anonymous 401, staff without admin.tools 403, admin.tools 200 (private, no-store)", async () => {
    const saved = config.DOCS_PUBLIC;
    config.DOCS_PUBLIC = false;
    try {
      for (const url of DOCS) {
        const anon = await t.request<ErrorBody>("GET", url);
        expect(anon.status, url).toBe(401);
        expect(anon.body.error.code).toBe("UNAUTHENTICATED");
        const bad = await t.request<ErrorBody>("GET", url, { headers: { authorization: "Bearer not-a-token" } });
        expect(bad.status, url).toBe(401);
        const staff = await t.request<ErrorBody>("GET", url, { token: sales });
        expect(staff.status, url).toBe(403);
        expect(staff.body.error.code).toBe("FORBIDDEN");
        const ok = await t.request("GET", url, { token: admin });
        expect(ok.status, `${url}: ${ok.text.slice(0, 200)}`).toBe(200);
      }
      const doc = await t.request<{ openapi: string; paths: Record<string, unknown> }>("GET", "/api/v1/openapi.json", {
        token: admin,
      });
      expect(doc.body.openapi).toBe("3.1.0");
      expect(Object.keys(doc.body.paths).length).toBeGreaterThan(300);
      expect(doc.headers["cache-control"]).toBe("private, no-store");
      const ui = await t.request("GET", "/api/v1/docs", { token: admin });
      expect([200, 302]).toContain(ui.status);
      expect((await t.request("GET", "/api/v1/docs")).status).toBe(401);
      // a portal (customer) token is not a staff token
      // other public routes are unaffected
      expect((await t.request("GET", "/api/v1/health")).status).toBe(200);
    } finally {
      config.DOCS_PUBLIC = saved;
    }
  });

  it("with DOCS_PUBLIC=true (the default outside production) anyone may read them", async () => {
    const saved = config.DOCS_PUBLIC;
    config.DOCS_PUBLIC = true;
    try {
      for (const url of DOCS) expect((await t.request("GET", url)).status, url).toBe(200);
      expect((await t.request("GET", "/api/v1/openapi.json")).headers["cache-control"]).toBe("public, max-age=60");
    } finally {
      config.DOCS_PUBLIC = saved;
    }
  });
});

// ---------------------------------------------------------------------------
describe("item 4: job observability", () => {
  const series = (text: string, job: string, status: string) =>
    Number(new RegExp(`^job_runs_total\\{job_name="${job}",status="${status}"\\} (\\d+)`, "m").exec(text)?.[1] ?? 0);
  const count = (text: string, job: string) =>
    Number(new RegExp(`^job_duration_seconds_count\\{job_name="${job}"\\} (\\d+)`, "m").exec(text)?.[1] ?? 0);

  it("runJob records job_runs_total and job_duration_seconds for every outcome (OK and FAILED)", async () => {
    const before = await scrapeMetrics();
    await runJob(t.app.db, "JOB_RUN_SWEEP");
    const original = jobHandler("PARTITION_MAINTENANCE");
    registerJob("PARTITION_MAINTENANCE", async () => {
      throw new Error("planned failure");
    });
    try {
      await expect(runJob(t.app.db, "PARTITION_MAINTENANCE", {}, { attempt: 1, maxAttempts: 3 })).rejects.toThrow(
        "planned failure",
      );
    } finally {
      registerJob("PARTITION_MAINTENANCE", original);
    }
    const after = await scrapeMetrics();
    expect(series(after, "JOB_RUN_SWEEP", "OK") - series(before, "JOB_RUN_SWEEP", "OK")).toBe(1);
    expect(series(after, "PARTITION_MAINTENANCE", "FAILED") - series(before, "PARTITION_MAINTENANCE", "FAILED")).toBe(
      1,
    );
    expect(count(after, "JOB_RUN_SWEEP") - count(before, "JOB_RUN_SWEEP")).toBe(1);
    expect(count(after, "PARTITION_MAINTENANCE") - count(before, "PARTITION_MAINTENANCE")).toBe(1);
  });

  it("JOB_RUN_SWEEP marks runs still RUNNING after twice their job's budget as ABANDONED, and only those", async () => {
    await t.app.sql`delete from job_runs`;
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const rows = [
      { name: "HOLD_EXPIRY", started: ago(11), status: "RUNNING" }, // budget 5 min → abandoned after 10
      { name: "HOLD_EXPIRY", started: ago(9), status: "RUNNING" },
      { name: "DAILY_DUES", started: ago(90), status: "RUNNING" }, // budget 60 min → abandoned after 120
      { name: "DAILY_DUES", started: ago(130), status: "RUNNING" },
      { name: "EXPORT_CLEANUP", started: ago(61), status: "RUNNING" }, // default 30 min budget
      { name: "BACKUP_EXPORT", started: ago(200), status: "RUNNING" }, // budget 2 h → abandoned after 4 h
      { name: "HOLD_EXPIRY", started: ago(500), status: "OK" },
    ];
    const ids: string[] = [];
    for (const r of rows) {
      const [row] = await t.app.sql<
        { id: string }[]
      >`insert into job_runs (job_name, started_at, status) values (${r.name}, ${r.started.toISOString()}::timestamptz, ${r.status}::job_run_status) returning id`;
      ids.push(row!.id);
    }
    const run = await runJob(t.app.db, "JOB_RUN_SWEEP");
    expect(run.result).toEqual({ abandoned: 3, jobs: { HOLD_EXPIRY: 1, DAILY_DUES: 1, EXPORT_CLEANUP: 1 } });
    const after = await t.app.sql<
      { id: string; status: string; finished_at: Date | null; error: string | null }[]
    >`select id, status, finished_at, error from job_runs where id in ${t.app.sql(ids)}`;
    const status = (i: number) => after.find((r) => r.id === ids[i])!;
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => status(i).status)).toEqual([
      "ABANDONED",
      "RUNNING",
      "RUNNING",
      "ABANDONED",
      "ABANDONED",
      "RUNNING",
      "OK",
    ]);
    expect(status(0).finished_at).not.toBeNull();
    expect(status(0).error).toMatch(/twice the job's time budget/);
    expect((await sweepAbandonedJobRuns(t.app.db)).abandoned).toBe(0); // idempotent
    // the admin API lists and filters ABANDONED runs and counts them as failures
    const list = await t.request<{ items: { id: string; status: string }[] }>(
      "GET",
      "/api/v1/admin/jobs/runs?status=ABANDONED",
      { token: admin },
    );
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((r) => r.id).sort()).toEqual([ids[0], ids[3], ids[4]].sort());
    const jobs = await t.request<{ jobs: { name: string; failure_count_24h: number }[] }>("GET", "/api/v1/admin/jobs", {
      token: admin,
    });
    expect(jobs.body.jobs.find((j) => j.name === "EXPORT_CLEANUP")!.failure_count_24h).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("item 5: a dead Redis adds no latency to reads that have a source of truth", () => {
  it("/auth/me, a cached public list and a staff list answer in < 300 ms with the main and security Redis on a dead port", async () => {
    const login = await t.loginAs("accounts");
    const dead = createRedis("redis://127.0.0.1:1");
    dead.on("error", () => undefined);
    const host = t.app as unknown as { redisSecurity: unknown; redis: unknown };
    const [cache, security] = [host.redis, host.redisSecurity];
    host.redis = dead;
    host.redisSecurity = dead;
    try {
      // the first command finds out that the server is gone (connection refused); afterwards the client is known to be disconnected
      await t.request("GET", "/api/v1/auth/me", { token: login.access_token });
      for (let i = 0; i < 50 && dead.status === "wait"; i += 1) await new Promise((r) => setTimeout(r, 10));
      for (const url of [
        "/api/v1/auth/me",
        "/api/v1/auth/me",
        "/api/v1/public/projects",
        "/api/v1/customers?limit=5",
      ]) {
        const started = performance.now();
        const r = await t.request("GET", url, url.includes("public") ? {} : { token: login.access_token });
        const ms = performance.now() - started;
        expect(r.status, `${url}: ${r.text.slice(0, 200)}`).toBe(200);
        expect(ms, `${url} took ${Math.round(ms)} ms`).toBeLessThan(300);
      }
    } finally {
      host.redis = cache;
      host.redisSecurity = security;
      dead.disconnect();
    }
  }, 30_000);
});
