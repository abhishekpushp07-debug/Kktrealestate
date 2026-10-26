/**
 * Adversarial review of the platform-reliability track: attacks the places its own tests did not reach.
 *  - keyset paging (JSON cursor lists and the async export) over a NULLABLE sort column never skips or repeats rows;
 *  - an export of a route that cannot keyset-page its CSV fails loudly instead of silently stopping at the 10,000-row cap;
 *  - export paths with dot segments / route params are refused;
 *  - "run now" is race-free: parallel clicks enqueue ONE job;
 *  - the once-per-deploy boot lock is released when enqueuing the boot jobs fails (the next boot retries);
 *  - repeatable schedules carry the 3-attempt exponential retry policy;
 *  - a tenant job's final-failure alert reaches only that company's Super Admins;
 *  - restore refuses a non-empty target BEFORE migrating it;
 *  - idempotency keys are scoped per subject; If-Match must be a version number.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyReply } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { JobName } from "@kkt/contracts";

process.env["JOB_BACKOFF_MS"] = "50";
const { buildTestApp, TEST_DATABASE_URL } = await import("./helpers.js");
const { startTestWorker, waitForExport } = await import("./worker.js");
type TestContext = Awaited<ReturnType<typeof buildTestApp>>;
type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

let t: TestContext;
let admin: string;
let sales: string;
const UNPAGED_ROWS = 10_000;

beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  const { sendCsv } = await import("../../src/lib/csv.js");
  t = await buildTestApp({
    extraRoutes: (api) => {
      // a list route that answers CSV without paginate()/listPaging(): it cannot keyset-page and reports no X-Export-* facts
      route(api, {
        method: "GET",
        url: "/_test/unpaged",
        permission: "master.read",
        schema: { querystring: z.object({ format: z.enum(["json", "csv"]).optional() }), response: { 200: z.any() } },
        handler: async (req, reply: FastifyReply) => {
          const rows = Array.from({ length: UNPAGED_ROWS }, (_, i) => ({ n: i }));
          if (req.query.format === "csv") return sendCsv(reply, "unpaged.csv", [{ key: "n", header: "n" }], rows);
          return { items: rows.slice(0, 25), total: UNPAGED_ROWS, page: 1, page_size: 25, next_cursor: null };
        },
      });
    },
  });
  admin = (await t.loginAs("admin")).access_token;
  sales = (await t.loginAs("sales")).access_token;
});

afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------
describe("keyset paging over a nullable sort column", () => {
  it("JSON cursor pages over finished_at (NULLs first on DESC, last on ASC) return every row exactly once", async () => {
    await t.app.sql`delete from job_runs`;
    await t.app.sql`insert into job_runs (job_name, status, started_at, finished_at)
      select 'DAILY_DUES', (case when g % 3 = 0 then 'RUNNING' else 'OK' end)::job_run_status, now() - (g || ' seconds')::interval,
             case when g % 3 = 0 then null else now() - (g || ' seconds')::interval end
      from generate_series(1, 23) g`;
    // duplicate non-null sort values as well (ties broken by id)
    await t.app
      .sql`insert into job_runs (job_name, status, started_at, finished_at) select 'DAILY_DUES', 'OK', now(), '2026-01-01T00:00:00Z' from generate_series(1, 4)`;
    const all = (await t.app.sql<{ id: string }[]>`select id from job_runs`).map((r) => r.id).sort();
    for (const sort of ["finished_at", "-finished_at"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 50; guard += 1) {
        const r: { status: number; text: string; body: { items: { id: string }[]; next_cursor: string | null } } =
          await t.request<{ items: { id: string }[]; next_cursor: string | null }>(
            "GET",
            `/api/v1/admin/jobs/runs?sort=${sort}&limit=4${cursor ? `&cursor=${cursor}` : ""}`,
            { token: admin },
          );
        expect(r.status, r.text).toBe(200);
        seen.push(...r.body.items.map((i) => i.id));
        cursor = r.body.next_cursor;
        if (!cursor) break;
      }
      expect(seen.length, sort).toBe(all.length);
      expect([...seen].sort(), sort).toEqual(all);
    }
  });

  it("an async export sorted by a nullable column contains every row (page boundaries inside the NULL block)", async () => {
    const worker = await startTestWorker(t.app);
    try {
      await t.app.sql`delete from job_runs`;
      await t.app.sql`insert into job_runs (job_name, status, started_at, finished_at)
        select 'DAILY_DUES', 'RUNNING', now() - (g || ' seconds')::interval, null from generate_series(1, 5_200) g`;
      await t.app.sql`insert into job_runs (job_name, status, started_at, finished_at)
        select 'DAILY_DUES', 'OK', now() - (g || ' seconds')::interval, now() - (g || ' seconds')::interval from generate_series(1, 30) g`;
      for (const sort of ["-finished_at", "finished_at"]) {
        const r = await t.request<{ id: string }>("POST", "/api/v1/exports", {
          token: admin,
          body: { path: "/api/v1/admin/jobs/runs", query: { sort, job_name: "DAILY_DUES" } },
        });
        expect(r.status, r.text).toBe(202);
        const done = await waitForExport(t.app, r.body.id, 120_000);
        expect(done.status, done.error ?? "").toBe("DONE");
        expect(done.row_count, sort).toBe(5_230);
      }
    } finally {
      await worker.close();
    }
  });
});

// ---------------------------------------------------------------------------
describe("async export guards", () => {
  it("a route that cannot keyset-page its CSV fails the export instead of silently stopping at the 10,000-row cap", async () => {
    const { runCsvExport } = await import("../../src/modules/documents/index.js");
    const [row] = await t.app.sql<
      { id: string }[]
    >`insert into exports (company_id, user_id, path, query, status) select ${t.companyId}, id, '/api/v1/_test/unpaged', '{}'::jsonb, 'QUEUED' from users where email = 'admin@sgb.in' returning id`;
    await expect(
      runCsvExport({ db: t.app.db, app: t.app, data: { export_id: row!.id }, attempt: 3, maxAttempts: 3 }),
    ).rejects.toThrow(/cannot page/);
    const [after] = await t.app.sql<
      { status: string; row_count: number | null }[]
    >`select status, row_count from exports where id = ${row!.id}`;
    expect(after).toMatchObject({ status: "FAILED", row_count: null });
  });

  it("refuses export paths with dot segments or route-parameter syntax", async () => {
    for (const path of [
      "/api/v1/notifications/..",
      "/api/v1/notifications/./x",
      "/api/v1/bookings/../admin/jobs/runs",
      "/api/v1/notifications/:id",
    ]) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/exports", { token: admin, body: { path, query: {} } });
      expect(r.status, path).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
describe("jobs: run now, boot lock, schedules, alerts", () => {
  it("parallel 'run now' clicks enqueue exactly one job; the others are 409 JOB_ALREADY_RUNNING", async () => {
    const queue = t.app.jobQueue();
    await queue.obliterate({ force: true });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        t.request<{ run_id: string } & ErrorBody>("POST", "/api/v1/admin/jobs/IDEMPOTENCY_PURGE/run", {
          token: admin,
          body: {},
        }),
      ),
    );
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === "JOB_ALREADY_RUNNING")).toBe(
      true,
    );
    const waiting = (await queue.getJobs(["waiting", "active", "delayed", "prioritized"], 0, 100)).filter(
      (j) => j.name === "IDEMPOTENCY_PURGE",
    );
    expect(waiting).toHaveLength(1);
    await queue.obliterate({ force: true });
    // once it is no longer pending a new manual run is accepted again
    const again = await t.request("POST", "/api/v1/admin/jobs/IDEMPOTENCY_PURGE/run", { token: admin, body: {} });
    expect(again.status, again.text).toBe(202);
    await queue.obliterate({ force: true });
  });

  it("the boot lock is released when enqueuing the boot jobs fails, so the next boot of the deploy retries them", async () => {
    const { enqueueBootJobs, createQueue } = await import("../../src/jobs/queue.js");
    const { registeredJobs } = await import("../../src/jobs/index.js");
    const queue = createQueue();
    const deploy = `fail-${randomUUID()}`;
    const brokenDb = {
      select: () => {
        throw new Error("database unavailable");
      },
    } as unknown as typeof t.app.db;
    try {
      await expect(
        enqueueBootJobs(queue, {
          db: brokenDb,
          lockRedis: t.app.redisSecurity,
          registered: new Set(registeredJobs()),
          deploy,
        }),
      ).rejects.toThrow(/database unavailable/);
      expect(await t.app.redisSecurity.keys(`boot:jobs:*${deploy}`)).toEqual([]);
      const retry = await enqueueBootJobs(queue, {
        db: t.app.db,
        lockRedis: t.app.redisSecurity,
        registered: new Set(registeredJobs()),
        deploy,
      });
      expect(retry.acquired).toBe(true);
      expect(retry.enqueued.map((e) => e.name)).toContain("STARTUP_RECONCILIATION");
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it("repeatable schedules carry the retry policy (3 attempts, exponential backoff)", async () => {
    const { createQueue, registerSchedules, schedulerId } = await import("../../src/jobs/queue.js");
    const { registeredJobs } = await import("../../src/jobs/index.js");
    const queue = createQueue();
    try {
      const r = await registerSchedules(queue, new Set(registeredJobs()));
      expect(r.scheduled).toContain("HOLD_EXPIRY");
      const s = await queue.getJobScheduler(schedulerId("HOLD_EXPIRY"));
      expect(s?.template?.opts).toMatchObject({ attempts: 3, backoff: { type: "exponential" } });
    } finally {
      for (const s of await queue.getJobSchedulers(0, 99)) await queue.removeJobScheduler(s.key);
      await queue.close();
    }
  });

  it("a tenant job's final failure alerts only that company's Super Admins (other tenants never see its error)", async () => {
    const [other] = await t.app.sql<
      { id: string }[]
    >`insert into companies (name) values ('Other Builder') returning id`;
    const [role] = await t.app.sql<
      { id: string }[]
    >`insert into roles (company_id, name, permissions) values (${other!.id}, 'Super Admin', '{}') returning id`;
    const [otherAdmin] = await t.app.sql<
      { id: string }[]
    >`insert into users (company_id, name, email, password_hash, role_id) values (${other!.id}, 'Other Admin', ${`other-${randomUUID().slice(0, 8)}@x.in`}, 'x', ${role!.id}) returning id`;
    const { registerJob, runJob } = await import("../../src/jobs/index.js");
    registerJob("TEST_TENANT_JOB" as JobName, async () => {
      throw new Error("booking BK/42 of Sri Ganesh failed");
    });
    await expect(runJob(t.app.db, "TEST_TENANT_JOB", { company_id: t.companyId })).rejects.toThrow(/BK\/42/);
    const bells = await t.app.sql<
      { company_id: string; recipient_id: string }[]
    >`select company_id, recipient_id from notifications where type = 'JOB_FAILED' and title = 'Job TEST_TENANT_JOB failed'`;
    expect(bells.length).toBeGreaterThan(0);
    expect(bells.every((b) => b.company_id === t.companyId)).toBe(true);
    expect(bells.some((b) => b.recipient_id === otherAdmin!.id)).toBe(false);
    // a system-wide job (no company in its payload) still alerts every company
    registerJob("TEST_GLOBAL_JOB" as JobName, async () => {
      throw new Error("redis gone");
    });
    await expect(runJob(t.app.db, "TEST_GLOBAL_JOB")).rejects.toThrow();
    const global = await t.app.sql<
      { recipient_id: string }[]
    >`select recipient_id from notifications where type = 'JOB_FAILED' and title = 'Job TEST_GLOBAL_JOB failed'`;
    expect(global.some((b) => b.recipient_id === otherAdmin!.id)).toBe(true);
    await t.app.sql`delete from notifications where company_id = ${other!.id}`;
    await t.app.sql`delete from users where company_id = ${other!.id}`;
    await t.app.sql`delete from roles where company_id = ${other!.id}`;
    await t.app.sql`delete from companies where id = ${other!.id}`;
  });

  it("exports and backups carry their company in the job payload (tenant-scoped alerts)", async () => {
    const queue = t.app.jobQueue();
    await queue.obliterate({ force: true });
    const exp = await t.request<{ id: string }>("POST", "/api/v1/exports", {
      token: admin,
      body: { path: "/api/v1/admin/jobs/runs", query: {} },
    });
    expect(exp.status, exp.text).toBe(202);
    const bk = await t.request<{ id: string }>("POST", "/api/v1/admin/backup", {
      token: admin,
      body: { include_sensitive: false },
    });
    expect(bk.status, bk.text).toBe(202);
    const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"], 0, 100);
    for (const name of ["EXPORT_CSV", "BACKUP_EXPORT"]) {
      const j = jobs.find((x) => x.name === name);
      expect(j?.data, name).toMatchObject({ company_id: t.companyId });
    }
    await queue.obliterate({ force: true });
    await t.app.sql`delete from exports where id in (${exp.body.id}, ${bk.body.id})`;
  });
});

// ---------------------------------------------------------------------------
describe("backup under the DML-only application role", () => {
  it("a backup taken as a role without access to the drizzle schema still succeeds (schema version unknown, transaction not aborted)", async () => {
    const role = `${new URL(TEST_DATABASE_URL).pathname.slice(1)}_bk_app`;
    await t.app.sql.unsafe(`drop role if exists "${role}"`);
    await t.app.sql.unsafe(`create role "${role}" nologin nosuperuser`);
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { schema } = await import("@kkt/db");
    const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => undefined, connection: { role } });
    try {
      // what kkt_app gets (infra/postgres/init/01-roles.sql): public schema usage + DML; nothing on schema drizzle
      await t.app.sql.unsafe(
        `grant usage on schema public to "${role}"; grant select, insert, update, delete on all tables in schema public to "${role}"`,
      );
      const db = drizzle(client, { schema }) as unknown as typeof t.app.db;
      const { writeBackupArchive } = await import("../../src/modules/admin/backup.js");
      const file = join(mkdtempSync(join(tmpdir(), "kkt-roleback-")), "b.zip");
      const manifest = await writeBackupArchive(db, file, {
        companyId: t.companyId,
        companyName: "SGB",
        includeSensitive: false,
      });
      expect(manifest.row_count).toBeGreaterThan(0);
      expect(manifest.schema.migrations_applied).toBeNull();
      expect(manifest.tables.find((x) => x.name === "users")!.rows).toBeGreaterThan(0);
    } finally {
      await client.end({ timeout: 5 });
      await t.app.sql.unsafe(`drop owned by "${role}"`).catch(() => undefined);
      await t.app.sql.unsafe(`drop role if exists "${role}"`).catch(() => undefined);
    }
  });
});

// ---------------------------------------------------------------------------
describe("restore target checks", () => {
  const target = (() => {
    const u = new URL(TEST_DATABASE_URL);
    u.pathname = `/${u.pathname.slice(1)}_restore_dirty`;
    return u.toString();
  })();
  const adminUrl = (() => {
    const u = new URL(TEST_DATABASE_URL);
    u.pathname = "/postgres";
    return u.toString();
  })();
  const name = new URL(target).pathname.slice(1);
  afterAll(async () => {
    const a = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    try {
      await a.unsafe(`drop database if exists "${name}" with (force)`);
    } finally {
      await a.end({ timeout: 5 });
    }
  });

  it("refuses a non-empty target database before running any migration on it", async () => {
    const a = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    try {
      await a.unsafe(`drop database if exists "${name}" with (force)`);
      await a.unsafe(`create database "${name}"`);
    } finally {
      await a.end({ timeout: 5 });
    }
    const pg = postgres(target, { max: 1, onnotice: () => undefined });
    try {
      await pg.unsafe("create table someone_elses_data (id int primary key, v text)");
      await pg.unsafe("insert into someone_elses_data values (1, 'precious')");
      const { writeBackupArchive } = await import("../../src/modules/admin/backup.js");
      const { restoreBackup } = await import("../../src/modules/admin/restore.js");
      const file = join(mkdtempSync(join(tmpdir(), "kkt-dirty-")), "b.zip");
      await writeBackupArchive(t.app.db, file, { companyId: t.companyId, companyName: "SGB", includeSensitive: true });
      await expect(restoreBackup({ file, databaseUrl: target, confirm: true, skipIntegrity: true })).rejects.toThrow(
        /not empty/,
      );
      const tables = await pg<{ t: string }[]>`select tablename as t from pg_tables where schemaname = 'public'`;
      expect(tables.map((x) => x.t)).toEqual(["someone_elses_data"]);
      const drizzleSchema = await pg`select 1 from pg_namespace where nspname = 'drizzle'`;
      expect(drizzleSchema).toHaveLength(0);
    } finally {
      await pg.end({ timeout: 5 });
    }
  });
});

// ---------------------------------------------------------------------------
describe("worker load guards", () => {
  it("a user may have at most 3 exports in flight (429 + Retry-After); a company one backup at a time (409 JOB_ALREADY_RUNNING)", async () => {
    await t.app.sql`delete from exports`;
    const queue = t.app.jobQueue();
    await queue.obliterate({ force: true });
    const post = () =>
      t.request<{ id: string } & ErrorBody>("POST", "/api/v1/exports", {
        token: admin,
        body: { path: "/api/v1/admin/jobs/runs", query: {} },
      });
    for (let i = 0; i < 3; i += 1) expect((await post()).status).toBe(202);
    const fourth = await post();
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe("RATE_LIMITED");
    expect(fourth.headers["retry-after"]).toBe("60");
    // another user is not affected; a finished export frees a slot; stale (lost) rows older than a day do not count
    const [one] = await t.app.sql<{ id: string }[]>`select id from exports order by created_at limit 1`;
    await t.app.sql`update exports set status = 'DONE' where id = ${one!.id}`;
    expect((await post()).status).toBe(202);
    await t.app.sql`update exports set created_at = now() - interval '2 days' where status = 'QUEUED'`;
    expect((await post()).status).toBe(202);

    const b1 = await t.request<{ id: string }>("POST", "/api/v1/admin/backup", {
      token: admin,
      body: { include_sensitive: false },
    });
    expect(b1.status, b1.text).toBe(202);
    const b2 = await t.request<ErrorBody>("POST", "/api/v1/admin/backup", {
      token: admin,
      body: { include_sensitive: false },
    });
    expect(b2.status).toBe(409);
    expect(b2.body.error).toMatchObject({ code: "JOB_ALREADY_RUNNING", details: { backup_id: b1.body.id } });
    await t.app.sql`update exports set status = 'FAILED' where id = ${b1.body.id}`;
    expect(
      (await t.request("POST", "/api/v1/admin/backup", { token: admin, body: { include_sensitive: false } })).status,
    ).toBe(202);
    await queue.obliterate({ force: true });
    await t.app.sql`delete from exports`;
  });
});

// ---------------------------------------------------------------------------
describe("queue outage", () => {
  it("POST /exports and POST /admin/backup answer 503 (row FAILED) instead of hanging when the queue's Redis does not answer", async () => {
    const queue = t.app.jobQueue();
    const add = queue.add.bind(queue);
    (queue as unknown as { add: () => Promise<never> }).add = () => new Promise<never>(() => undefined);
    try {
      const started = Date.now();
      const r = await t.request<ErrorBody>("POST", "/api/v1/exports", {
        token: admin,
        body: { path: "/api/v1/admin/jobs/runs", query: {} },
      });
      expect(r.status).toBe(503);
      expect(r.headers["retry-after"]).toBeDefined();
      expect(Date.now() - started).toBeLessThan(15_000);
      const b = await t.request<ErrorBody>("POST", "/api/v1/admin/backup", {
        token: admin,
        body: { include_sensitive: false },
      });
      expect(b.status).toBe(503);
      const rows = await t.app.sql<{ status: string; error: string }[]>`select status, error from exports`;
      expect(rows).toHaveLength(2);
      expect(rows.every((x) => x.status === "FAILED" && x.error.startsWith("could not enqueue"))).toBe(true);
    } finally {
      (queue as unknown as { add: typeof add }).add = add;
      await t.app.sql`delete from exports`;
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
describe("idempotency and version edge cases", () => {
  it("the same Idempotency-Key from two different users runs twice (scope = subject), never replaying the other user's response", async () => {
    const key = `shared-${randomUUID()}`;
    const make = (token: string, name: string) =>
      t.request<{ id: string; name: string }>("POST", "/api/v1/masters/room-types", {
        token,
        body: {
          name,
          code: name
            .toUpperCase()
            .replace(/[^A-Z]/g, "")
            .slice(0, 8),
        },
        headers: { "idempotency-key": key },
      });
    const a = await make(admin, "Scoped Alpha");
    expect(a.status, a.text).toBe(201);
    const b = await make(admin, "Scoped Alpha");
    expect(b.headers["idempotent-replayed"]).toBe("true");
    // sales may not write masters; what matters is that the key of another subject is not a mismatch/replay
    const c = await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", {
      token: sales,
      body: { name: "Scoped Beta", code: "SBETA" },
      headers: { "idempotency-key": key },
    });
    expect(c.headers["idempotent-replayed"]).toBeUndefined();
    expect(c.body.error?.code).not.toBe("IDEMPOTENCY_MISMATCH");
  });

  it("If-Match must carry a version number: '*' or a non-numeric tag is VERSION_REQUIRED", async () => {
    const created = await t.request<{ id: string; version: number }>("POST", "/api/v1/masters/room-types", {
      token: admin,
      body: { name: "IfMatch Room", code: "IFM" },
    });
    expect(created.status, created.text).toBe(201);
    for (const tag of ["*", '"abc"', 'W/""', '"0"']) {
      const r = await t.request<ErrorBody>("PATCH", `/api/v1/masters/room-types/${created.body.id}`, {
        token: admin,
        body: { name: "x" },
        headers: { "if-match": tag },
      });
      expect(r.status, tag).toBe(400);
      expect(r.body.error.code, tag).toBe("VERSION_REQUIRED");
    }
  });
});
