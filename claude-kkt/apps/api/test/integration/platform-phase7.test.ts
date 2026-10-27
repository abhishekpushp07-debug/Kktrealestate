/**
 * Phase 7 platform track (docs/hardening/phase7-platform.md):
 *  - idempotency: a committed write is never executed twice (commit marker inside the handler's transaction, outcome-unknown replies,
 *    leases renewed by a heartbeat instead of the fixed 60 s takeover);
 *  - lists: keyset pages run no count(*)/EXPLAIN unless include_total, estimated totals are flagged;
 *  - public caching (contract C5), client error reports (contract C2), health endpoints.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

// a short lease so a slow handler outlives several lease periods (the heartbeat must keep it) within a test's time budget
process.env["IDEMPOTENCY_LEASE_SECONDS"] = "2";
process.env["CLIENT_ERROR_RATE_LIMIT_PER_MIN"] = "5";

const { buildTestApp, freshIp } = await import("./helpers.js");
type TestContext = Awaited<ReturnType<typeof buildTestApp>>;
type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

let t: TestContext;
let admin: string;
const calls: Record<string, number> = {};
const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);

beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  const { ApiError } = await import("../../src/lib/errors.js");
  const { sql } = await import("drizzle-orm");
  t = await buildTestApp({
    extraRoutes: (api) => {
      const body = z.object({ code: z.string() });
      const created = z.object({ n: z.number() });
      const insertRoom = (
        exec: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
        companyId: string,
        code: string,
      ) => exec.execute(sql`insert into room_types (company_id, name, code) values (${companyId}, ${code}, ${code})`);
      // commits, then the response does not match its schema → 500 after COMMIT (the audit's serialisation case)
      route(api, {
        method: "POST",
        url: "/_test/p7/commit-then-bad-response",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req, reply) => {
          bump("bad-response");
          await api.db.transaction(async (tx) => insertRoom(tx, req.user!.companyId, req.body.code));
          return reply.code(201).send({ n: "not a number" } as unknown as { n: number });
        },
      });
      // the transaction itself fails → rolled back → the claim is released and a retry runs again
      route(api, {
        method: "POST",
        url: "/_test/p7/rollback-500",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req, reply) => {
          const n = bump("rollback");
          await api.db.transaction(async (tx) => {
            await insertRoom(tx, req.user!.companyId, `${req.body.code}-${n}`);
            if (n === 1) throw new Error("boom inside the transaction");
          });
          return reply.code(201).send({ n });
        },
      });
      // commits, then a 4xx: the outcome is stored and replayed (never re-run)
      route(api, {
        method: "POST",
        url: "/_test/p7/commit-then-422",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req) => {
          bump("commit-422");
          await api.db.transaction(async (tx) => insertRoom(tx, req.user!.companyId, req.body.code));
          throw ApiError.rule("rejected after the write", "NO_CHANGE");
        },
      });
      // a write outside any transaction (autocommit), then a crash → outcome unknown
      route(api, {
        method: "POST",
        url: "/_test/p7/autocommit-then-500",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req) => {
          bump("autocommit");
          await insertRoom(api.db, req.user!.companyId, req.body.code);
          throw new Error("crash after an autocommit write");
        },
      });
      // a normal create through a transaction
      route(api, {
        method: "POST",
        url: "/_test/p7/ok",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req, reply) => {
          const n = bump("ok");
          await api.db.transaction(async (tx) => insertRoom(tx, req.user!.companyId, req.body.code));
          return reply.code(201).send({ n });
        },
      });
      // contract C5: a public route that opts into CDN caching, and one that does not
      let served = 0;
      route(api, {
        method: "GET",
        url: "/_test/p7/cached",
        public: true,
        cachePolicy: { public: true, sMaxAge: 60, staleWhileRevalidate: 300 },
        schema: { response: { 200: z.object({ hello: z.string(), version: z.number() }) } },
        handler: async () => {
          served += 1;
          return { hello: "world", version: 3 };
        },
      });
      route(api, {
        method: "GET",
        url: "/_test/p7/uncached",
        public: true,
        schema: { response: { 200: z.object({ hello: z.string() }) } },
        handler: async () => ({ hello: "world" }),
      });
      void served;
      // slower than two leases (2 s each): the heartbeat must keep the claim alive
      route(api, {
        method: "POST",
        url: "/_test/p7/slow",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req, reply) => {
          const n = bump("slow");
          await new Promise((r) => setTimeout(r, 5_000));
          await api.db.transaction(async (tx) => insertRoom(tx, req.user!.companyId, req.body.code));
          return reply.code(201).send({ n });
        },
      });
    },
  });
  admin = (await t.loginAs("admin")).access_token;
});
afterAll(async () => {
  await t?.close();
});

async function post<T = unknown>(url: string, body: unknown, key: string) {
  return t.request<T>("POST", url, { token: admin, body, headers: { "idempotency-key": key } });
}
async function rooms(code: string): Promise<number> {
  const [r] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where code like ${`${code}%`}`;
  return r!.n;
}

describe("idempotency: a committed write is never executed twice", () => {
  it("a 500 after COMMIT (response serialisation) keeps the key: the retry answers 409 IDEMPOTENT_OUTCOME_UNKNOWN, nothing runs twice", async () => {
    const key = `ser-${randomUUID()}`;
    const code = `SER${Date.now()}`;
    const first = await post<ErrorBody>("/api/v1/_test/p7/commit-then-bad-response", { code }, key);
    expect(first.status).toBe(500);
    const [row] = await t.app.sql<{ committed_at: Date | null; status_code: number | null }[]>`
      select committed_at, status_code from idempotency_keys where key = ${key}`;
    expect(row!.committed_at).not.toBeNull();
    expect(row!.status_code).toBe(500);
    for (let i = 0; i < 2; i++) {
      const retry = await post<ErrorBody>("/api/v1/_test/p7/commit-then-bad-response", { code }, key);
      expect(retry.status).toBe(409);
      expect(retry.body.error.code).toBe("IDEMPOTENT_OUTCOME_UNKNOWN");
      expect(retry.body.error.details).toMatchObject({
        original_status: 500,
        retry_with_new_key: false,
        action: "LOOKUP_RESOURCE",
      });
      expect(retry.headers["idempotent-replayed"]).toBe("true");
    }
    expect(calls["bad-response"]).toBe(1);
    expect(await rooms(code)).toBe(1);
    // Redis is only a cache: the durable record answers the same without it
    await t.app.redis.flushdb();
    const again = await post<ErrorBody>("/api/v1/_test/p7/commit-then-bad-response", { code }, key);
    expect(again.body.error.code).toBe("IDEMPOTENT_OUTCOME_UNKNOWN");
    expect(calls["bad-response"]).toBe(1);
  });

  it("a failure inside the transaction rolls the mark back with the write: the claim is released and the retry runs", async () => {
    const key = `rb-${randomUUID()}`;
    const code = `RB${Date.now()}`;
    const first = await post("/api/v1/_test/p7/rollback-500", { code }, key);
    expect(first.status).toBe(500);
    expect((await t.app.sql`select 1 from idempotency_keys where key = ${key}`).length).toBe(0);
    const second = await post<{ n: number }>("/api/v1/_test/p7/rollback-500", { code }, key);
    expect(second.status).toBe(201);
    expect(second.body.n).toBe(2);
    expect(await rooms(code)).toBe(1);
    const third = await post<{ n: number }>("/api/v1/_test/p7/rollback-500", { code }, key);
    expect(third.headers["idempotent-replayed"]).toBe("true");
    expect(calls["rollback"]).toBe(2);
  });

  it("a 4xx after COMMIT is stored and replayed instead of re-running the write", async () => {
    const key = `c422-${randomUUID()}`;
    const code = `C4${Date.now()}`;
    const first = await post<ErrorBody>("/api/v1/_test/p7/commit-then-422", { code }, key);
    expect(first.status).toBe(422);
    const second = await post<ErrorBody>("/api/v1/_test/p7/commit-then-422", { code }, key);
    expect(second.status).toBe(422);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.error.code).toBe("BUSINESS_RULE");
    expect(calls["commit-422"]).toBe(1);
    expect(await rooms(code)).toBe(1);
  });

  it("an autocommit write followed by a 500 is never released either", async () => {
    const key = `ac-${randomUUID()}`;
    const code = `AC${Date.now()}`;
    expect((await post("/api/v1/_test/p7/autocommit-then-500", { code }, key)).status).toBe(500);
    const retry = await post<ErrorBody>("/api/v1/_test/p7/autocommit-then-500", { code }, key);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("IDEMPOTENT_OUTCOME_UNKNOWN");
    expect(calls["autocommit"]).toBe(1);
    expect(await rooms(code)).toBe(1);
  });

  it("an instance that died after COMMIT (lease lapsed, no stored response) is never re-run: 409 IDEMPOTENT_OUTCOME_UNKNOWN", async () => {
    const key = `crash-${randomUUID()}`;
    const code = `CR${Date.now()}`;
    expect((await post("/api/v1/_test/p7/ok", { code }, key)).status).toBe(201);
    const before = calls["ok"];
    // the response was never stored (crash between COMMIT and onSend) and the instance's heartbeat stopped
    await t.app
      .sql`update idempotency_keys set status_code = null, response_body = null, lease_expires_at = now() - interval '1 second'
                    where key = ${key}`;
    await t.app.redis.flushdb();
    const retry = await post<ErrorBody>("/api/v1/_test/p7/ok", { code }, key);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("IDEMPOTENT_OUTCOME_UNKNOWN");
    expect(calls["ok"]).toBe(before);
    expect(await rooms(code)).toBe(1);
  });

  it("a slow handler past several leases keeps its claim (heartbeat): a concurrent retry waits and replays, the write runs once", async () => {
    const key = `slow-${randomUUID()}`;
    const code = `SL${Date.now()}`;
    const first = post<{ n: number }>("/api/v1/_test/p7/slow", { code }, key);
    // 3 s later the original 2 s lease would have lapsed without the heartbeat (the old rule took over after a fixed 60 s)
    await new Promise((r) => setTimeout(r, 3_000));
    const [mid] = await t.app.sql<{ lease_ok: boolean; status_code: number | null }[]>`
      select lease_expires_at > now() as lease_ok, status_code from idempotency_keys where key = ${key}`;
    expect(mid!.status_code).toBeNull();
    expect(mid!.lease_ok).toBe(true);
    const retry = await post<{ n: number }>("/api/v1/_test/p7/slow", { code }, key);
    const done = await first;
    expect(done.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.body).toEqual(done.body);
    expect(calls["slow"]).toBe(1);
    expect(await rooms(code)).toBe(1);
  }, 30_000);
});

describe("lists: counting and estimate flags", () => {
  it("keyset pages run no count(*) / EXPLAIN unless include_total; estimated totals carry meta.total_is_estimate", async () => {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const schema = await import("@kkt/db");
    const { paginate, resetTableEstimates } = await import("../../src/lib/list.js");
    const queries: string[] = [];
    const client = postgres(process.env["DATABASE_URL"]!, { max: 2, onnotice: () => undefined });
    const db = drizzle(client, { logger: { logQuery: (q) => queries.push(q) } }) as unknown as typeof t.app.db;
    try {
      const sort = { allowed: { name: schema.roomTypes.name }, default: "name" };
      queries.length = 0;
      const page = await paginate(db, { table: schema.roomTypes, sort, limit: 2, estimateAbove: -2 });
      expect(queries.some((q) => /count\(|explain/i.test(q))).toBe(false);
      expect(page.meta).toEqual({ total_is_estimate: false, total_included: false });
      expect(page.total).toBe(page.items.length);
      queries.length = 0;
      resetTableEstimates();
      const counted = await paginate(db, {
        table: schema.roomTypes,
        sort,
        limit: 2,
        includeTotal: true,
        estimateAbove: -2,
      });
      expect(queries.some((q) => /explain/i.test(q))).toBe(true);
      expect(counted.meta).toEqual({ total_is_estimate: true, total_included: true });
      const exact = await paginate(db, { table: schema.roomTypes, sort, page_size: 2, exact: true, estimateAbove: -2 });
      expect(exact.meta).toEqual({ total_is_estimate: false, total_included: true });
      const offset = await paginate(db, { table: schema.roomTypes, sort, page_size: 2, estimateAbove: -2 });
      expect(offset.meta).toEqual({ total_is_estimate: true, total_included: true });
    } finally {
      await client.end({ timeout: 5 });
    }
  });
});

describe("public caching (contract C5)", () => {
  it("an opted-in anonymous GET is public + s-maxage + stale-while-revalidate with a strong body ETag and 304 on If-None-Match", async () => {
    const ip = freshIp();
    const r = await t.request<{ hello: string }>("GET", "/api/v1/_test/p7/cached", { ip });
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, s-maxage=60, stale-while-revalidate=300");
    const etag = String(r.headers["etag"]);
    // a strong tag over the body — not the record's version tag ("v3"), which promises the record, not the bytes
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{20,}"$/);
    expect(String(r.headers["vary"])).toMatch(/x-kkt-company/i);
    const again = await t.request("GET", "/api/v1/_test/p7/cached", { ip, headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(again.text).toBe("");
    expect(again.headers["cache-control"]).toBe("public, s-maxage=60, stale-while-revalidate=300");
    expect(again.headers["etag"]).toBe(etag);
    const weak = await t.request("GET", "/api/v1/_test/p7/cached", {
      ip,
      headers: { "if-none-match": `W/${etag}, "x"` },
    });
    expect(weak.status).toBe(304);
    const other = await t.request("GET", "/api/v1/_test/p7/cached", { ip, headers: { "if-none-match": '"nope"' } });
    expect(other.status).toBe(200);
  });

  it("without a cache policy, or with credentials, responses stay no-store", async () => {
    const plain = await t.request("GET", "/api/v1/_test/p7/uncached");
    expect(plain.headers["cache-control"]).toBe("no-store");
    const authed = await t.request("GET", "/api/v1/_test/p7/cached", { token: admin });
    expect(authed.status).toBe(200);
    expect(authed.headers["cache-control"]).toBe("no-store");
    // staff responses never become publicly cacheable
    const staff = await t.request("GET", "/api/v1/masters/room-types", { token: admin });
    expect(staff.headers["cache-control"]).toBe("no-store");
  });
});

describe("client error reports (contract C2)", () => {
  it("accepts a report without authentication (202), logs it at warn without the query string, counts it per app", async () => {
    const { logger } = await import("../../src/lib/logger.js");
    const seen: Record<string, unknown>[] = [];
    const original = logger.warn.bind(logger);
    (logger as unknown as { warn: (...a: unknown[]) => void }).warn = (...a: unknown[]) => {
      if (a[1] === "client error reported") seen.push(a[0] as Record<string, unknown>);
      return (original as (...x: unknown[]) => void)(...a);
    };
    try {
      const body = {
        app: "portal",
        message: "TypeError: x is undefined",
        stack: "TypeError: x is undefined\n    at Bookings (app.js:1:2)",
        url: "https://portal.example.in/bookings/42?phone=9876543210&token=abc#ledger",
        release: "abc123",
        user_agent: "Mozilla/5.0",
        extra: { component: "BookingLedger", status: 500 },
      };
      const r = await t.request<{ accepted: boolean }>("POST", "/api/v1/client-errors", { body });
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ accepted: true });
      expect(seen).toHaveLength(1);
      const logged = seen[0]!["client_error"] as Record<string, unknown>;
      expect(logged).toMatchObject({
        app: "portal",
        message: body.message,
        url: "https://portal.example.in/bookings/42",
      });
      expect(JSON.stringify(seen[0])).not.toContain("9876543210");
      expect(seen[0]!["subject"]).toBeUndefined();
      // a bearer token attributes the report to its user (never required)
      await t.request("POST", "/api/v1/client-errors", { token: admin, body: { app: "erp", message: "boom" } });
      expect(seen[1]!["subject"]).toMatchObject({ type: "staff", company_id: t.companyId });
      // a broken token is not an error either: the report is accepted, just unattributed
      const bad = await t.request("POST", "/api/v1/client-errors", {
        token: "garbage",
        body: { app: "web", message: "x" },
      });
      expect(bad.status).toBe(202);
      const metrics = await t.request("GET", "/api/v1/metrics", { token: admin });
      expect(metrics.text).toMatch(/kkt_client_errors_total\{app="portal"\} [1-9]/);
      expect(metrics.text).toMatch(/kkt_client_errors_total\{app="erp"\} [1-9]/);
    } finally {
      (logger as unknown as { warn: unknown }).warn = original;
    }
  });

  it("validates the body (unknown app, oversized message/stack, unknown keys → 400; body over 16 KB → 413)", async () => {
    const bad = [
      { app: "mobile", message: "x" },
      { app: "erp", message: "" },
      { app: "erp", message: "m".repeat(2049) },
      { app: "erp", message: "x", stack: "s".repeat(8193) },
      { app: "erp", message: "x", password: "nope" },
    ];
    for (const body of bad) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/client-errors", { body });
      expect(r.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    }
    const huge = await t.request<ErrorBody>("POST", "/api/v1/client-errors", {
      body: { app: "erp", message: "x", extra: { blob: "b".repeat(17 * 1024) } },
    });
    expect(huge.status).toBe(413);
  });

  it("is rate limited per client IP (CLIENT_ERROR_RATE_LIMIT_PER_MIN)", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++)
      statuses.push(
        (await t.request("POST", "/api/v1/client-errors", { ip, body: { app: "web", message: `e${i}` } })).status,
      );
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // another client is unaffected
    expect(
      (await t.request("POST", "/api/v1/client-errors", { ip: freshIp(), body: { app: "web", message: "x" } })).status,
    ).toBe(202);
  });
});

describe("health endpoints", () => {
  type Health = {
    status: string;
    checks: Record<string, boolean>;
    details: {
      worker: { age_seconds: number | null; last_heartbeat_at: string | null };
      storage: { ok: boolean; error: string | null };
    };
  };
  const beat = (at: Date) =>
    t.app.redis.set("kkt:worker:heartbeat", JSON.stringify({ at: at.toISOString(), host: "test", pid: 1, queues: [] }));

  it("/health is ok with a fresh worker heartbeat, degraded (200) when it is stale, and never hardcodes a check", async () => {
    await beat(new Date());
    const ok = await t.request<Health>("GET", "/health");
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("ok");
    expect(ok.body.checks).toEqual({ database: true, redis: true, storage: true, worker: true, migrations: true });
    expect(ok.body.details.worker.age_seconds).toBeLessThan(5);
    await beat(new Date(Date.now() - 3600_000));
    const stale = await t.request<Health>("GET", "/api/v1/health");
    expect(stale.status).toBe(200);
    expect(stale.body.status).toBe("degraded");
    expect(stale.body.checks.worker).toBe(false);
    await t.app.redis.del("kkt:worker:heartbeat");
    expect((await t.request<Health>("GET", "/health")).body.details.worker.last_heartbeat_at).toBeNull();
  });

  it("/health answers 503 down when the database, Redis or storage fails; /health/live stays 200; /health/ready follows DB + Redis", async () => {
    const { resetStorageProbe } = await import("../../src/modules/system/index.js");
    await beat(new Date());
    // storage: the health object's folder becomes a plain file, so the real put fails
    const { mkdir, rm, writeFile } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const { config } = await import("../../src/config.js");
    const dir = resolve(config.STORAGE_LOCAL_DIR);
    await mkdir(dir, { recursive: true });
    await rm(join(dir, "health"), { recursive: true, force: true });
    await writeFile(join(dir, "health"), "not a directory");
    resetStorageProbe();
    try {
      const down = await t.request<Health>("GET", "/health");
      expect(down.status).toBe(503);
      expect(down.body.status).toBe("down");
      expect(down.body.checks.storage).toBe(false);
      expect(down.body.details.storage.error).toBeTruthy();
      expect((await t.request("GET", "/health/live")).status).toBe(200);
      expect((await t.request("GET", "/health/ready")).status).toBe(200); // readiness is DB + Redis only
    } finally {
      await rm(join(dir, "health"), { force: true });
      resetStorageProbe();
    }
    expect((await t.request<Health>("GET", "/health")).status).toBe(200);
    // database
    const db = t.app.db as unknown as { execute: (...a: unknown[]) => Promise<unknown> };
    const execute = db.execute;
    db.execute = () =>
      Promise.reject(
        Object.assign(new Error("connect ECONNREFUSED postgres://u:p@db:5432/kkt"), { code: "ECONNREFUSED" }),
      );
    try {
      const down = await t.request<Health & { details: { database: { error: string } } }>("GET", "/api/v1/health");
      expect(down.status).toBe(503);
      expect(down.body.checks.database).toBe(false);
      expect(down.body.details.database.error).not.toContain("postgres://");
      const ready = await t.request<ErrorBody>("GET", "/api/v1/health/ready");
      expect(ready.status).toBe(503);
      expect(ready.body.error.message).toContain("database");
      expect((await t.request("GET", "/api/v1/ready")).status).toBe(503);
      expect((await t.request("GET", "/api/v1/health/live")).status).toBe(200);
    } finally {
      db.execute = execute;
    }
    // redis
    t.app.redis.disconnect(false);
    try {
      const down = await t.request<Health>("GET", "/health");
      expect(down.status).toBe(503);
      expect(down.body.checks.redis).toBe(false);
      expect((await t.request("GET", "/health/ready")).status).toBe(503);
    } finally {
      await t.app.redis.connect();
    }
    expect((await t.request("GET", "/health/ready")).status).toBe(200);
  });
});
