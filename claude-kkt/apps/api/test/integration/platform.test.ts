/**
 * Platform reliability (audit groups A/B/C/F): the standalone worker runs real handlers and enqueues the boot jobs once per deploy;
 * failed jobs are retried (3 attempts, exponential backoff) and the final failure notifies the Super Admins and the error webhook;
 * idempotency survives Redis outages and crashed instances; database failures map to retryable envelopes; staff PATCH routes require a
 * version; the notification sweep retracts bells of deleted/erased/voided entities; expired idempotency keys are purged in batches.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { JobName } from "@kkt/contracts";

// The error webhook must be configured before the app's config is loaded (helpers import the app lazily).
const hooks: Record<string, unknown>[] = [];
const hookServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c: Buffer) => {
    body += c.toString();
  });
  req.on("end", () => {
    hooks.push(JSON.parse(body) as Record<string, unknown>);
    res.writeHead(204).end();
  });
});
await new Promise<void>((r) => hookServer.listen(0, "127.0.0.1", r));
process.env["ERROR_WEBHOOK_URL"] = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;
process.env["JOB_BACKOFF_MS"] = "50";

const { buildTestApp, freshIp } = await import("./helpers.js");
const { startTestWorker, waitFor, waitForRun } = await import("./worker.js");
type TestContext = Awaited<ReturnType<typeof buildTestApp>>;
type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
let t: TestContext;
let admin: string;
let slowCalls = 0;
let flakyCalls = 0;
let lockHolder: { release: () => void } | null = null;

beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  const { ApiError } = await import("../../src/lib/errors.js");
  const { sql } = await import("drizzle-orm");
  t = await buildTestApp({
    extraRoutes: (api) => {
      route(api, {
        method: "POST",
        url: "/_test/slow",
        permission: "master.write",
        idempotent: true,
        schema: { body: z.object({ v: z.number() }), response: { 201: z.object({ n: z.number() }) } },
        handler: async (_req, reply) => {
          slowCalls += 1;
          const n = slowCalls;
          await new Promise((r) => setTimeout(r, 400));
          return reply.code(201).send({ n });
        },
      });
      route(api, {
        method: "POST",
        url: "/_test/flaky",
        permission: "master.write",
        idempotent: true,
        schema: { body: z.object({ v: z.number() }), response: { 201: z.object({ n: z.number() }) } },
        handler: async (_req, reply) => {
          flakyCalls += 1;
          if (flakyCalls === 1) throw ApiError.rule("first attempt fails", "TEST");
          return reply.code(201).send({ n: flakyCalls });
        },
      });
      route(api, {
        method: "GET",
        url: "/_test/pg/:code",
        permission: "master.read",
        schema: { params: z.object({ code: z.string() }), response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async (req) => {
          const code = req.params.code;
          const pgError = Object.assign(new Error(`simulated ${code}`), { code });
          throw code === "40001" ? Object.assign(new Error("Failed query: update …"), { cause: pgError }) : pgError;
        },
      });
      route(api, {
        method: "GET",
        url: "/_test/statement-timeout",
        permission: "master.read",
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async () => {
          await api.db.transaction(async (tx) => {
            await tx.execute(sql`set local statement_timeout = 50`);
            await tx.execute(sql`select pg_sleep(1)`);
          });
          return { ok: true };
        },
      });
      route(api, {
        method: "GET",
        url: "/_test/lock-timeout",
        permission: "master.read",
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async () => {
          await api.db.transaction(async (tx) => {
            await tx.execute(sql`set local lock_timeout = 50`);
            await tx.execute(sql`select 1 from companies for update`);
          });
          return { ok: true };
        },
      });
    },
  });
  admin = (await t.loginAs("admin")).access_token;
});

afterAll(async () => {
  lockHolder?.release();
  await t?.close();
  await new Promise<void>((r) => hookServer.close(() => r()));
});

// ---------------------------------------------------------------------------
describe("standalone worker process", () => {
  let child: ChildProcess | null = null;
  afterAll(() => {
    if (child && child.exitCode === null) child.kill("SIGKILL");
  });

  it("builds the full app, runs real module handlers, schedules the housekeeping jobs and enqueues the boot jobs once per deploy", async () => {
    const deploy = `test-${randomUUID()}`;
    const env = {
      ...process.env,
      DATABASE_URL: process.env["DATABASE_URL"]!,
      REDIS_URL: process.env["REDIS_URL"]!,
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      DEPLOY_ID: deploy,
      JOB_BACKOFF_MS: "50",
    };
    delete (env as Record<string, string | undefined>)["KKT_MODULES"];
    let output = "";
    child = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], {
      cwd: API_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c: Buffer) => {
      output += c.toString();
    });
    child.stderr!.on("data", (c: Buffer) => {
      output += c.toString();
    });
    await waitFor(
      "worker started",
      async () =>
        output.includes("worker started") || (child!.exitCode !== null ? Promise.reject(new Error(output)) : false),
      90_000,
      200,
    );
    // boot jobs ran through the real handlers (no placeholder results)
    const boot = await waitFor(
      "boot jobs",
      async () => {
        const rows = await t.app.sql<
          { job_name: string; status: string; result: Record<string, unknown> | null }[]
        >`select job_name, status, result from job_runs where job_name in ('STARTUP_RECONCILIATION', 'NOTIFICATION_SWEEP', 'DUES_CATCHUP') and status <> 'RUNNING'`;
        return rows.length >= 3 ? rows : null;
      },
      60_000,
      200,
    );
    expect(boot.map((r) => r.job_name).sort()).toEqual([
      "DUES_CATCHUP",
      "NOTIFICATION_SWEEP",
      "STARTUP_RECONCILIATION",
    ]);
    expect(boot.every((r) => r.status === "OK")).toBe(true);
    expect(boot.find((r) => r.job_name === "STARTUP_RECONCILIATION")!.result).toMatchObject({
      bookings_checked: expect.any(Number),
    });
    expect(boot.some((r) => JSON.stringify(r.result).includes("implemented"))).toBe(false);
    expect(await t.app.redis.keys(`boot:jobs:*:${deploy}`)).toHaveLength(1);
    // repeatable schedules registered by the worker
    const schedulers = await t.app.jobQueue().getJobSchedulers(0, 99);
    expect(schedulers.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        "DAILY_DUES",
        "PORTAL_FILE_CLEANUP",
        "IDEMPOTENCY_PURGE",
        "HOLD_EXPIRY",
        "EXPORT_CLEANUP",
      ]),
    );
    expect(schedulers.map((s) => s.name)).not.toContain("PARTITION_MAINTENANCE");
    const jobs = await t.request<{ jobs: { name: string; next_run_at: string | null }[] }>(
      "GET",
      "/api/v1/admin/jobs",
      { token: admin },
    );
    expect(jobs.body.jobs.find((j) => j.name === "IDEMPOTENCY_PURGE")!.next_run_at).not.toBeNull();
    // a job enqueued now is consumed by the child process with the module's real handler
    const { enqueueJob } = await import("../../src/jobs/queue.js");
    const q = await enqueueJob(t.app.jobQueue(), "IDEMPOTENCY_PURGE");
    const run = await waitForRun(t.app, q.runId, 30_000);
    expect(run).toMatchObject({ status: "OK" });
    expect(run.result).toMatchObject({ deleted: expect.any(Number), batches: expect.any(Number) });
    // graceful shutdown
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((r) => child!.once("exit", (c) => r(c)));
    expect(code).toBe(0);
    for (const s of schedulers) await t.app.jobQueue().removeJobScheduler(s.key);
  });

  it("boot jobs are enqueued once per deploy (Redis lock) and the dues catch-up is skipped when dues already ran after the latest 00:30 IST", async () => {
    const { enqueueBootJobs, createQueue } = await import("../../src/jobs/queue.js");
    const { registeredJobs } = await import("../../src/jobs/index.js");
    const queue = createQueue();
    try {
      const deploy = `lock-${randomUUID()}`;
      await t.app
        .sql`insert into job_runs (job_name, status, started_at, finished_at) values ('DAILY_DUES', 'OK', now(), now())`;
      const first = await enqueueBootJobs(queue, {
        db: t.app.db,
        lockRedis: t.app.redisSecurity,
        registered: new Set(registeredJobs()),
        deploy,
      });
      expect(first.acquired).toBe(true);
      expect(first.enqueued.map((e) => e.name).sort()).toEqual(["NOTIFICATION_SWEEP", "STARTUP_RECONCILIATION"]);
      expect(first.skipped.map((s) => s.name)).toContain("DUES_CATCHUP");
      const second = await enqueueBootJobs(queue, {
        db: t.app.db,
        lockRedis: t.app.redisSecurity,
        registered: new Set(registeredJobs()),
        deploy,
      });
      expect(second).toMatchObject({ acquired: false, enqueued: [] });
      // a handler that is not registered is skipped with a reason, never failing the boot
      const partial = await enqueueBootJobs(queue, {
        db: t.app.db,
        lockRedis: t.app.redisSecurity,
        registered: new Set(["STARTUP_RECONCILIATION"]),
        deploy: `${deploy}-2`,
        now: new Date(Date.now() + 2 * 86_400_000),
      });
      expect(partial.enqueued.map((e) => e.name)).toEqual(["STARTUP_RECONCILIATION"]);
      expect(partial.skipped.map((s) => s.name).sort()).toEqual(["DAILY_DUES", "NOTIFICATION_SWEEP"]);
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  });
});

// ---------------------------------------------------------------------------
describe("retries and failure alerts", () => {
  let worker: Awaited<ReturnType<typeof startTestWorker>>;
  beforeAll(async () => {
    worker = await startTestWorker(t.app);
  });
  afterAll(async () => {
    await worker?.close();
  });

  it("a failing attempt is recorded and RETHROWN so BullMQ retries it (3 attempts, exponential backoff); a later success ends it", async () => {
    const { registerJob } = await import("../../src/jobs/index.js");
    const { enqueueJob } = await import("../../src/jobs/queue.js");
    let calls = 0;
    registerJob("TEST_FLAKY_JOB" as JobName, async ({ attempt }) => {
      calls += 1;
      if (calls < 3) throw new Error(`transient ${calls}`);
      return { attempt };
    });
    const q = await enqueueJob(t.app.jobQueue(), "TEST_FLAKY_JOB" as JobName);
    const rows = await waitFor("three attempts", async () => {
      const r = await t.app.sql<
        { id: string; status: string; error: string | null; result: Record<string, unknown> | null }[]
      >`select id, status, error, result from job_runs where job_name = 'TEST_FLAKY_JOB' order by started_at`;
      return r.length === 3 && r[2]!.status !== "RUNNING" ? r : null;
    });
    expect(rows.map((r) => r.status)).toEqual(["FAILED", "FAILED", "OK"]);
    expect(rows[0]!.id).toBe(q.runId);
    expect(rows[0]!.result).toMatchObject({ attempt: 1, max_attempts: 3, will_retry: true });
    expect(rows[1]!.result).toMatchObject({ attempt: 2, will_retry: true });
    expect(rows[2]!.result).toMatchObject({ attempt: 3 });
    expect(hooks).toHaveLength(0);
  });

  it("after the final failure job_runs is FAILED, the Super Admins get a JOB_FAILED bell and ERROR_WEBHOOK_URL receives the event; GET /admin/jobs counts the failures", async () => {
    const { registerJob } = await import("../../src/jobs/index.js");
    const { enqueueJob } = await import("../../src/jobs/queue.js");
    registerJob("TEST_BROKEN_JOB" as JobName, async () => {
      throw new Error("disk on fire");
    });
    const q = await enqueueJob(t.app.jobQueue(), "TEST_BROKEN_JOB" as JobName);
    const rows = await waitFor("final failure", async () => {
      const r = await t.app.sql<
        { id: string; status: string; result: Record<string, unknown> | null }[]
      >`select id, status, result from job_runs where job_name = 'TEST_BROKEN_JOB' and status = 'FAILED' order by started_at`;
      return r.length === 3 ? r : null;
    });
    expect(rows[2]!.result).toMatchObject({ attempt: 3, max_attempts: 3, will_retry: false });
    await waitFor("webhook", async () => hooks.length > 0);
    expect(hooks[0]).toMatchObject({
      event: "job.failed",
      job_name: "TEST_BROKEN_JOB",
      error: "disk on fire",
      attempts: 3,
      max_attempts: 3,
    });
    const bells = await t.app.sql<
      { title: string; link: string }[]
    >`select n.title, n.link from notifications n join users u on u.id = n.recipient_id where n.type = 'JOB_FAILED' and u.email = 'admin@sgb.in'`;
    expect(bells).toEqual([{ title: "Job TEST_BROKEN_JOB failed", link: "/admin/jobs" }]);
    expect(q.runId).toBe(rows[0]!.id);
  });

  it("a job name without a handler fails at once without retries (never a silent OK)", async () => {
    const { enqueueJob } = await import("../../src/jobs/queue.js");
    const before = hooks.length;
    const q = await enqueueJob(t.app.jobQueue(), "TEST_NO_HANDLER" as JobName);
    const run = await waitForRun(t.app, q.runId);
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("no handler registered");
    expect(run.result).toMatchObject({ will_retry: false });
    await new Promise((r) => setTimeout(r, 300));
    const [n] = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from job_runs where job_name = 'TEST_NO_HANDLER'`;
    expect(n!.n).toBe(1);
    await waitFor("webhook", async () => hooks.length > before);
  });
});

// ---------------------------------------------------------------------------
describe("idempotency durability", () => {
  it("concurrent duplicates wait for the first request and replay it, also with Redis down (Postgres IN_PROGRESS record)", async () => {
    const run = async () => {
      slowCalls = 0;
      const key = `slow-${randomUUID()}`;
      const req = () =>
        t.request<{ n: number }>("POST", "/api/v1/_test/slow", {
          token: admin,
          body: { v: 1 },
          headers: { "idempotency-key": key },
        });
      const [a, b, c] = await Promise.all([req(), req(), req()]);
      expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
      expect(slowCalls).toBe(1);
      expect(new Set([a.body.n, b.body.n, c.body.n])).toEqual(new Set([1]));
      expect([a, b, c].filter((r) => r.headers["idempotent-replayed"] === "true")).toHaveLength(2);
      const [row] = await t.app.sql<
        { status_code: number | null }[]
      >`select status_code from idempotency_keys where key = ${key}`;
      expect(row!.status_code).toBe(201);
      return key;
    };
    await run();
    t.app.redis.disconnect(false);
    try {
      const key = await run();
      // the durable record still replays without Redis
      const again = await t.request<{ n: number }>("POST", "/api/v1/_test/slow", {
        token: admin,
        body: { v: 1 },
        headers: { "idempotency-key": key },
      });
      expect(again.headers["idempotent-replayed"]).toBe("true");
      expect(slowCalls).toBe(1);
    } finally {
      await t.app.redis.connect();
    }
  });

  it("a non-2xx response releases the claim so the client may retry with the same key; a different body is 422 IDEMPOTENCY_MISMATCH", async () => {
    flakyCalls = 0;
    const key = `flaky-${randomUUID()}`;
    const first = await t.request<ErrorBody>("POST", "/api/v1/_test/flaky", {
      token: admin,
      body: { v: 1 },
      headers: { "idempotency-key": key },
    });
    expect(first.status).toBe(422);
    expect((await t.app.sql`select 1 from idempotency_keys where key = ${key}`).length).toBe(0);
    const second = await t.request<{ n: number }>("POST", "/api/v1/_test/flaky", {
      token: admin,
      body: { v: 1 },
      headers: { "idempotency-key": key },
    });
    expect(second.status).toBe(201);
    expect(second.body.n).toBe(2);
    const other = await t.request<ErrorBody>("POST", "/api/v1/_test/flaky", {
      token: admin,
      body: { v: 2 },
      headers: { "idempotency-key": key },
    });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("an IN_PROGRESS record older than 60 s is abandoned (crashed instance): the retry with the same body takes it over and runs", async () => {
    slowCalls = 0;
    const key = `crash-${randomUUID()}`;
    const ok = await t.request<{ n: number }>("POST", "/api/v1/_test/slow", {
      token: admin,
      body: { v: 7 },
      headers: { "idempotency-key": key },
    });
    expect(ok.status).toBe(201);
    // simulate a crash between COMMIT and storing the response: the claim stays IN_PROGRESS and the cache is empty
    await t.app.sql`update idempotency_keys set status_code = null, response_body = null where key = ${key}`;
    await t.app.redis.flushdb();
    const fresh = t.request<{ n: number }>("POST", "/api/v1/_test/slow", {
      token: admin,
      body: { v: 7 },
      headers: { "idempotency-key": key },
    });
    // a still-fresh claim makes the duplicate wait; age it past the abandon threshold while it waits
    await new Promise((r) => setTimeout(r, 150));
    await t.app.sql`update idempotency_keys set created_at = now() - interval '61 seconds' where key = ${key}`;
    const retried = await fresh;
    expect(retried.status).toBe(201);
    expect(retried.headers["idempotent-replayed"]).toBeUndefined();
    expect(slowCalls).toBe(2);
    const [row] = await t.app.sql<
      { status_code: number | null }[]
    >`select status_code from idempotency_keys where key = ${key}`;
    expect(row!.status_code).toBe(201);
    // an abandoned claim is never taken over by a DIFFERENT request
    await t.app
      .sql`update idempotency_keys set status_code = null, response_body = null, created_at = now() - interval '61 seconds' where key = ${key}`;
    await t.app.redis.flushdb();
    const mismatch = await t.request<ErrorBody>("POST", "/api/v1/_test/slow", {
      token: admin,
      body: { v: 8 },
      headers: { "idempotency-key": key },
    });
    expect(mismatch.status).toBe(422);
  });

  it("IDEMPOTENCY_PURGE deletes expired records in batches and keeps live ones", async () => {
    await t.app.sql`insert into idempotency_keys (scope_key, key, method, path, request_hash, status_code, expires_at)
      select 'purge-test', 'k' || g, 'POST', '/x', 'h', 201, now() - interval '1 minute' from generate_series(1, 12) g`;
    await t.app
      .sql`insert into idempotency_keys (scope_key, key, method, path, request_hash, status_code, expires_at) values ('purge-test', 'live', 'POST', '/x', 'h', 201, now() + interval '1 hour')`;
    const { purgeExpiredIdempotencyKeys } = await import("../../src/plugins/idempotency.js");
    const r = await purgeExpiredIdempotencyKeys(t.app.sql, 5);
    expect(r).toEqual({ deleted: 12, batches: 3 });
    expect(
      (await t.app.sql<{ key: string }[]>`select key from idempotency_keys where scope_key = 'purge-test'`).map(
        (x) => x.key,
      ),
    ).toEqual(["live"]);
    const { runJob } = await import("../../src/jobs/index.js");
    expect((await runJob(t.app.db, "IDEMPOTENCY_PURGE")).result).toEqual({ deleted: 0, batches: 1 });
  });

  it("rate limiting and authentication fail open on a Redis outage (requests keep working, logged)", async () => {
    t.app.redis.disconnect(false);
    try {
      const r = await t.request("GET", "/api/v1/masters/room-types", { token: admin });
      expect(r.status, r.text).toBe(200);
      slowCalls = 0;
      const w = await t.request("POST", "/api/v1/_test/slow", { token: admin, body: { v: 3 } });
      expect(w.status, w.text).toBe(201);
    } finally {
      await t.app.redis.connect();
    }
    expect(t.app.redisSecurity).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("database error mapping", () => {
  it("statement timeout → 503 SERVICE_UNAVAILABLE + Retry-After 5; lock timeout → 409 LOCK_TIMEOUT; 40001/40P01 → 409 CONFLICT_RETRY; connection failures → 503", async () => {
    const st = await t.request<ErrorBody>("GET", "/api/v1/_test/statement-timeout", { token: admin });
    expect(st.status).toBe(503);
    expect(st.headers["retry-after"]).toBe("5");
    expect(st.body.error).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      details: { retryable: true, reason: "statement_timeout" },
    });

    // hold the company row lock in another connection so the route's FOR UPDATE times out
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const locked = new Promise<void>((ready) => {
      void t.app.sql.begin(async (tx) => {
        await tx`select 1 from companies for update`;
        ready();
        await held;
      });
    });
    await locked;
    lockHolder = { release };
    const lt = await t.request<ErrorBody>("GET", "/api/v1/_test/lock-timeout", { token: admin });
    release();
    lockHolder = null;
    expect(lt.status).toBe(409);
    expect(lt.body.error).toMatchObject({ code: "LOCK_TIMEOUT", details: { retryable: true } });

    for (const code of ["40001", "40P01"]) {
      const r = await t.request<ErrorBody>("GET", `/api/v1/_test/pg/${code}`, { token: admin });
      expect(r.status, code).toBe(409);
      expect(r.body.error).toMatchObject({ code: "CONFLICT_RETRY", details: { retryable: true, sqlstate: code } });
    }
    for (const code of ["57P01", "08006", "53300", "CONNECT_TIMEOUT", "ECONNREFUSED"]) {
      const r = await t.request<ErrorBody>("GET", `/api/v1/_test/pg/${code}`, { token: admin });
      expect(r.status, code).toBe(503);
      expect(r.headers["retry-after"], code).toBe("5");
      expect(r.body.error.code, code).toBe("SERVICE_UNAVAILABLE");
    }
    // a genuine bug stays a 500 without details
    const bug = await t.request<ErrorBody>("GET", "/api/v1/_test/pg/XX000", { token: admin });
    expect(bug.status).toBe(500);
    expect(bug.body.error.code).toBe("INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
describe("version policy", () => {
  it("a staff PATCH without body.version or If-Match is 400 VERSION_REQUIRED before the handler runs; with either it proceeds", async () => {
    const created = await t.request<{ id: string; version: number }>("POST", "/api/v1/masters/room-types", {
      token: admin,
      body: { name: "Versioned Room", code: "VROOM" },
    });
    expect(created.status, created.text).toBe(201);
    const none = await t.request<ErrorBody>("PATCH", `/api/v1/masters/room-types/${created.body.id}`, {
      token: admin,
      body: { name: "Renamed" },
    });
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe("VERSION_REQUIRED");
    expect(none.body.error.details?.["issues"]).toEqual([expect.objectContaining({ path: "version" })]);
    // even for a record that does not exist the version is checked first (no information about existence)
    expect(
      (
        await t.request<ErrorBody>("PATCH", "/api/v1/masters/room-types/11111111-1111-4111-8111-111111111111", {
          token: admin,
          body: { name: "x" },
        })
      ).body.error.code,
    ).toBe("VERSION_REQUIRED");
    const viaBody = await t.request<{ version: number }>("PATCH", `/api/v1/masters/room-types/${created.body.id}`, {
      token: admin,
      body: { name: "Renamed", version: created.body.version },
    });
    expect(viaBody.status, viaBody.text).toBe(200);
    const viaHeader = await t.request<{ version: number }>("PATCH", `/api/v1/masters/room-types/${created.body.id}`, {
      token: admin,
      body: { name: "Renamed again" },
      headers: { "if-match": `"${viaBody.body.version}"` },
    });
    expect(viaHeader.status, viaHeader.text).toBe(200);
    // auth still answers first: no token → 401, not 400
    expect(
      (
        await t.request("PATCH", `/api/v1/masters/room-types/${created.body.id}`, {
          body: { name: "x" },
          ip: freshIp(),
        })
      ).status,
    ).toBe(401);
  });

  it("every staff PATCH route is covered by the policy (no exemptions left); portal self-service is exempt", async () => {
    const { requiresVersion, VERSION_POLICY_EXEMPT } = await import("../../src/lib/version.js");
    expect(VERSION_POLICY_EXEMPT).toEqual([]);
    const patches = t.app.routeRegistry.filter((r) => r.method === "PATCH");
    expect(patches.length).toBeGreaterThan(20);
    const uncovered = patches
      .filter((r) => !requiresVersion("PATCH", r.url, { audience: r.audience ?? undefined, public: r.public }))
      .map((r) => r.url)
      .sort();
    expect(uncovered).toEqual([...VERSION_POLICY_EXEMPT, "/api/v1/portal/profile"].sort());
  });
});

// ---------------------------------------------------------------------------
describe("notification sweep", () => {
  it("retracts bells of soft-deleted documents, erased customers, VOID demands, missing tickets and erased customer recipients (unread deleted, read withdrawn); live entities untouched", async () => {
    const { createActiveBooking } = await import("./fixtures/crm.js");
    const { createProject, createPortalCustomer } = await import("./fixtures.js");
    const [adminUser] = await t.app.sql<{ id: string }[]>`select id from users where email = 'admin@sgb.in'`;
    const staffId = adminUser!.id;
    const projectId = await createProject(t, "Sweep Project", "SWP");
    const live = await createPortalCustomer(t, { phone: "9876511001", name: "Live Customer" });
    const erased = await createPortalCustomer(t, { phone: "9876511002", name: "Erased Customer" });
    const { bookingId, blockId } = await createActiveBooking(t, live.customerId, projectId);
    const demand = async (seq: number, status: string) =>
      (
        await t.app.sql<
          { id: string }[]
        >`insert into demands (company_id, booking_id, project_id, block_id, customer_id, demand_number, installment_seq, installment_name, trigger_type, percent, cumulative_percent, cash_demand_paise, account_demand_paise, total_demand_paise, demand_date, due_date, status)
      values (${t.companyId}, ${bookingId}, ${projectId}, ${blockId}, ${live.customerId}, ${`DM-SWEEP/${seq}`}, ${seq}, 'Inst', 'ON_BOOKING', 10, 10, 100, 100, 200, current_date, current_date, ${status}) returning id`
      )[0]!.id;
    const voidDemand = await demand(1, "VOID");
    const liveDemand = await demand(2, "OPEN");
    const doc = async (deleted: boolean) =>
      (
        await t.app.sql<
          { id: string }[]
        >`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, is_deleted, deleted_at)
      values (${t.companyId}, 'CUSTOMER', ${live.customerId}, 'a.pdf', 'application/pdf', 10, 'x', ${`documents/${randomUUID()}.pdf`}, 'STAFF', ${deleted}, case when ${deleted}::boolean then now() end) returning id`
      )[0]!.id;
    const deletedDoc = await doc(true);
    const liveDoc = await doc(false);
    await t.app.sql`update customers set erased_at = now() where id = ${erased.customerId}`;
    const bell = async (
      entityType: string,
      entityId: string,
      read: boolean,
      recipient: { type: string; id: string } = { type: "STAFF", id: staffId },
    ) =>
      (
        await t.app.sql<
          { id: string }[]
        >`insert into notifications (company_id, recipient_type, recipient_id, type, title, entity_type, entity_id, is_read) values (${t.companyId}, ${recipient.type}, ${recipient.id}, 'DEMAND_RAISED', 'x', ${entityType}, ${entityId}, ${read}) returning id`
      )[0]!.id;
    const gone = [
      await bell("document", deletedDoc, false),
      await bell("customer", erased.customerId, false),
      await bell("demand", voidDemand, false),
      await bell("service_request", randomUUID(), false),
      await bell("booking", bookingId, false, { type: "CUSTOMER", id: erased.customerId }),
    ];
    const withdrawn = [await bell("demand", voidDemand, true), await bell("document", deletedDoc, true)];
    const kept = [
      await bell("document", liveDoc, false),
      await bell("demand", liveDemand, false),
      await bell("customer", live.customerId, true),
      await bell("booking", bookingId, false, { type: "CUSTOMER", id: live.customerId }),
    ];

    const { sweepNotifications } = await import("../../src/modules/notifications/index.js");
    const r = await sweepNotifications(t.app.db, 2);
    expect(r.deleted).toBe(gone.length);
    expect(r.withdrawn).toBe(withdrawn.length);
    expect(r.by_entity).toMatchObject({
      document: { deleted: 1, withdrawn: 1 },
      demand: { deleted: 1, withdrawn: 1 },
      customer: { deleted: 1 },
      service_request: { deleted: 1 },
      "recipient:customer": { deleted: 1 },
    });
    const remaining = await t.app.sql<
      { id: string; is_withdrawn: boolean }[]
    >`select id, is_withdrawn from notifications where id = any(${[...gone, ...withdrawn, ...kept]}::uuid[])`;
    expect(remaining.filter((x) => gone.includes(x.id))).toEqual([]);
    expect(remaining.filter((x) => withdrawn.includes(x.id)).every((x) => x.is_withdrawn)).toBe(true);
    expect(remaining.filter((x) => kept.includes(x.id)).every((x) => !x.is_withdrawn)).toBe(true);
    expect(remaining.filter((x) => kept.includes(x.id))).toHaveLength(kept.length);
    // idempotent, and registered as a job
    expect(await sweepNotifications(t.app.db)).toMatchObject({ deleted: 0, withdrawn: 0 });
    const { runJob } = await import("../../src/jobs/index.js");
    expect((await runJob(t.app.db, "NOTIFICATION_SWEEP")).status).toBe("OK");
  });

  it("soft-deleting a document withdraws its bells at once", async () => {
    const { createPortalCustomer } = await import("./fixtures.js");
    const c = await createPortalCustomer(t, { phone: "9876511003", name: "Doc Bell Customer" });
    const [d] = await t.app.sql<
      { id: string }[]
    >`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type)
      values (${t.companyId}, 'CUSTOMER', ${c.customerId}, 'b.pdf', 'application/pdf', 10, 'x', ${`documents/${randomUUID()}.pdf`}, 'STAFF') returning id`;
    const [u] = await t.app.sql<{ id: string }[]>`select id from users where email = 'admin@sgb.in'`;
    await t.app
      .sql`insert into notifications (company_id, recipient_type, recipient_id, type, title, entity_type, entity_id) values (${t.companyId}, 'STAFF', ${u!.id}, 'DEMAND_RAISED', 'doc', 'document', ${d!.id})`;
    const del = await t.request("DELETE", `/api/v1/documents/${d!.id}`, { token: admin });
    expect(del.status, del.text).toBe(204);
    expect((await t.app.sql`select 1 from notifications where entity_id = ${d!.id}`).length).toBe(0);
  });
});
