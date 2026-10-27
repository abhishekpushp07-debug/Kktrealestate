/**
 * Adversarial review of the phase 7 platform track (docs/hardening/phase7-review-platform.md): each test pins a defect the review found
 * in the track's code and fails on the code as the track left it.
 *  1. upload bookkeeping (storage_pending_objects) pinned the Idempotency-Key, so a failed upload could not be retried with its key;
 *  2. the commit marker wrote inside READ ONLY transactions (25006 → 500);
 *  3. an autocommit write was remembered only in memory: an instance that died afterwards let a retry take the claim over and write again;
 *  4. deterministic rendition keys: a deletion queued for a failed run's orphans deleted the objects of a later successful run;
 *  5. export parts aged into the sweep's orphan window while a resumed export was still building;
 *  6. tampered cursors with impossible dates / out-of-range numbers reached Postgres (400 VALIDATION_ERROR instead of INVALID_CURSOR).
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const STORAGE_DIR = mkdtempSync(join(tmpdir(), "kkt-platform-review-"));
process.env["STORAGE_LOCAL_DIR"] = STORAGE_DIR;
process.env["IDEMPOTENCY_LEASE_SECONDS"] = "2";

const { buildTestApp, freshIp } = await import("./helpers.js");
const { createPortalCustomer } = await import("./fixtures.js");
type TestContext = Awaited<ReturnType<typeof buildTestApp>>;
type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

let t: TestContext;
let admin: string;
let customerId: string;
let png: Buffer;
const calls: Record<string, number> = {};
const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
let gate: { promise: Promise<void>; open: () => void } | null = null;

beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  const { sql } = await import("drizzle-orm");
  t = await buildTestApp({
    extraRoutes: (api) => {
      const body = z.object({ code: z.string() });
      const created = z.object({ n: z.number() });
      // an idempotent create that reads on a READ ONLY snapshot first (what money/integrity onSnapshot does), then writes
      route(api, {
        method: "POST",
        url: "/_test/p7r/read-only-snapshot",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req, reply) => {
          const n = bump("ro");
          await api.db.transaction(async (tx) => tx.execute(sql`select count(*) from room_types`), {
            isolationLevel: "repeatable read",
            accessMode: "read only",
          });
          await api.db.transaction(async (tx) =>
            tx.execute(
              sql`insert into room_types (company_id, name, code) values (${req.user!.companyId}, ${req.body.code}, ${req.body.code})`,
            ),
          );
          return reply.code(201).send({ n });
        },
      });
      // commits, then crashes: the stored outcome is "unknown" and counted
      route(api, {
        method: "POST",
        url: "/_test/p7r/commit-then-500",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req) => {
          bump("c500");
          await api.db.transaction(async (tx) =>
            tx.execute(
              sql`insert into room_types (company_id, name, code) values (${req.user!.companyId}, ${req.body.code}, ${req.body.code})`,
            ),
          );
          throw new Error("crash after COMMIT");
        },
      });
      // an autocommit write, then the handler waits (the test looks at the claim meanwhile)
      route(api, {
        method: "POST",
        url: "/_test/p7r/autocommit-then-wait",
        permission: "master.write",
        idempotent: true,
        schema: { body, response: { 201: created } },
        handler: async (req, reply) => {
          const n = bump("ac-wait");
          await api.db.execute(
            sql`insert into room_types (company_id, name, code) values (${req.user!.companyId}, ${req.body.code}, ${req.body.code})`,
          );
          if (gate) await gate.promise;
          return reply.code(201).send({ n });
        },
      });
    },
  });
  admin = (await t.loginAs("admin")).access_token;
  customerId = (await createPortalCustomer(t, { phone: "9876507777" })).customerId;
  png = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 200, g: 30, b: 40 } } })
    .png()
    .toBuffer();
});
afterAll(async () => {
  await t?.close();
});

async function upload(fields: Record<string, string>, file: { name: string; data: Buffer }, key?: string) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", new Blob([new Uint8Array(file.data)]), file.name);
  const encoded = new Response(fd);
  const res = await t.app.inject({
    method: "POST",
    url: "/api/v1/documents",
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      authorization: `Bearer ${admin}`,
      "x-forwarded-for": freshIp(),
      ...(key ? { "idempotency-key": key } : {}),
    },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
  return {
    status: res.statusCode,
    headers: res.headers,
    body: JSON.parse(res.body) as { document: { id: string; renditions: string } } & Partial<ErrorBody>,
  };
}

async function rooms(code: string): Promise<number> {
  const [r] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where code = ${code}`;
  return r!.n;
}

describe("idempotency × uploads: bookkeeping writes never pin the key", () => {
  it("an upload whose storage write fails (5xx) can be retried with the same key and succeeds", async () => {
    const svc = await import("../../src/modules/documents/service.js");
    const store = svc.storage();
    const put = store.put.bind(store);
    let failed = 0;
    store.put = async (k, data, type) => {
      if (failed === 0) {
        failed += 1;
        throw new Error("object store unavailable");
      }
      return put(k, data, type);
    };
    const key = `up-${randomUUID()}`;
    try {
      const first = await upload({ entity_type: "CUSTOMER", entity_id: customerId }, { name: "a.png", data: png }, key);
      expect(first.status).toBe(500);
      // nothing committed: the claim was released
      expect(await t.app.sql`select 1 from idempotency_keys where key = ${key}`).toHaveLength(0);
    } finally {
      store.put = put;
    }
    const retry = await upload({ entity_type: "CUSTOMER", entity_id: customerId }, { name: "a.png", data: png }, key);
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(retry.body.document.renditions).toBe("PENDING");
    const replay = await upload({ entity_type: "CUSTOMER", entity_id: customerId }, { name: "a.png", data: png }, key);
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.document.id).toBe(retry.body.document.id);
  });

  it("an upload whose transaction fails after the storage write (rolled back) can be retried with the same key", async () => {
    await t.app.sql.unsafe(`
      create or replace function kkt_test_refuse_doc2() returns trigger language plpgsql as $$
      begin if new.title = 'P7R-FAIL' then raise exception 'refused by test trigger'; end if; return new; end $$;
      drop trigger if exists kkt_test_refuse_doc2 on documents;
      create trigger kkt_test_refuse_doc2 before insert on documents for each row execute function kkt_test_refuse_doc2();`);
    const key = `upt-${randomUUID()}`;
    try {
      const first = await upload(
        { entity_type: "CUSTOMER", entity_id: customerId, title: "P7R-FAIL" },
        { name: "b.png", data: png },
        key,
      );
      expect(first.status).toBe(500);
      expect(await t.app.sql`select 1 from idempotency_keys where key = ${key}`).toHaveLength(0);
    } finally {
      await t.app.sql.unsafe(
        `drop trigger if exists kkt_test_refuse_doc2 on documents; drop function if exists kkt_test_refuse_doc2();`,
      );
    }
    const retry = await upload(
      { entity_type: "CUSTOMER", entity_id: customerId, title: "P7R-FAIL" },
      { name: "b.png", data: png },
      key,
    );
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect(await t.app.sql`select key from storage_pending_objects`).toHaveLength(0);
  });
});

describe("idempotency: commit marker edge cases", () => {
  it("a READ ONLY transaction under a claim is not marked (it used to fail with 25006 → 500)", async () => {
    const key = `ro-${randomUUID()}`;
    const code = `RO${Date.now()}`;
    const res = await t.request<{ n: number }>("POST", "/api/v1/_test/p7r/read-only-snapshot", {
      token: admin,
      body: { code },
      headers: { "idempotency-key": key },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [row] = await t.app.sql<{ committed_at: Date | null }[]>`
      select committed_at from idempotency_keys where key = ${key}`;
    expect(row!.committed_at).not.toBeNull(); // the write transaction marked it
    expect(await rooms(code)).toBe(1);
  });

  it("an autocommit write marks the claim durably before the response, so a dead instance's claim is never taken over", async () => {
    const key = `acw-${randomUUID()}`;
    const code = `ACW${Date.now()}`;
    let open!: () => void;
    gate = { promise: new Promise<void>((r) => (open = r)), open: () => open() };
    const pending = t.request<{ n: number }>("POST", "/api/v1/_test/p7r/autocommit-then-wait", {
      token: admin,
      body: { code },
      headers: { "idempotency-key": key },
    });
    try {
      // while the handler still runs (no response stored yet), the claim already says "committed"
      let committed: Date | null = null;
      for (let i = 0; i < 100 && !committed; i++) {
        const rows = await t.app.sql<{ committed_at: Date | null }[]>`
          select committed_at from idempotency_keys where key = ${key}`;
        committed = rows[0]?.committed_at ?? null;
        if (!committed) await new Promise((r) => setTimeout(r, 20));
      }
      expect(committed).not.toBeNull();
    } finally {
      gate.open();
      gate = null;
    }
    expect((await pending).status).toBe(201);
    // the instance "died" before storing its answer: no response, lease lapsed
    await t.app.sql`update idempotency_keys set status_code = null, response_body = null,
                      lease_expires_at = now() - interval '1 second' where key = ${key}`;
    await t.app.redis.flushdb();
    const retry = await t.request<ErrorBody>("POST", "/api/v1/_test/p7r/autocommit-then-wait", {
      token: admin,
      body: { code },
      headers: { "idempotency-key": key },
    });
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("IDEMPOTENT_OUTCOME_UNKNOWN");
    expect(calls["ac-wait"]).toBe(1);
    expect(await rooms(code)).toBe(1);
  });
});

describe("idempotency: outcome-unknown metric", () => {
  it("a 5xx after COMMIT increments kkt_idempotency_outcome_unknown_total (it was declared but never counted)", async () => {
    const { registry } = await import("../../src/lib/metrics.js");
    const read = async () =>
      (await registry.getSingleMetric("kkt_idempotency_outcome_unknown_total")!.get()).values.reduce(
        (a, v) => a + v.value,
        0,
      );
    const before = await read();
    const key = `c500-${randomUUID()}`;
    const res = await t.request("POST", "/api/v1/_test/p7r/commit-then-500", {
      token: admin,
      body: { code: `C5${Date.now()}` },
      headers: { "idempotency-key": key },
    });
    expect(res.status).toBe(500);
    expect(await read()).toBe(before + 1);
  });
});

describe("renditions: a queued orphan deletion never removes a later run's objects", () => {
  it("run 1 fails after a write, its orphan is queued (deletion fails, backs off), run 2 succeeds, the deletion runs: run 2's renditions survive", async () => {
    const svc = await import("../../src/modules/documents/service.js");
    const { renderDocument, storageSweep } = await import("../../src/modules/documents/renditions.js");
    const up = await upload({ entity_type: "CUSTOMER", entity_id: customerId }, { name: "r.png", data: png });
    expect(up.status).toBe(201);
    const id = up.body.document.id;
    const store = svc.storage();
    // run 1: the thumb is written, the medium write fails → the attempt throws with the thumb left pending
    let puts = 0;
    const failing = {
      ...store,
      get: store.get.bind(store),
      put: async (k: string, d: Buffer, ty: string) => {
        puts += 1;
        if (puts === 2) throw new Error("store hiccup");
        return store.put(k, d, ty);
      },
    } as typeof store;
    await expect(renderDocument(t.app.db, failing, id)).rejects.toThrow("store hiccup");
    const orphanKeys = (
      await t.app.sql<{ key: string }[]>`
      select key from storage_pending_objects where purpose = 'rendition'`
    ).map((r) => r.key);
    expect(orphanKeys.length).toBeGreaterThanOrEqual(1);
    // an hour later the sweep queues them for deletion, but the store refuses the delete (backoff)
    await t.app
      .sql`update storage_pending_objects set created_at = now() - interval '2 hours' where purpose = 'rendition'`;
    const refusing = {
      ...store,
      remove: async () => {
        throw new Error("delete refused");
      },
    } as typeof store;
    const now = new Date();
    const first = await storageSweep(t.app.db, refusing, { now });
    expect(first.orphans_queued).toBeGreaterThanOrEqual(1);
    expect(first.failed).toBeGreaterThanOrEqual(1);
    // run 2 succeeds
    const ok = await renderDocument(t.app.db, store, id);
    expect(ok.status).toBe("READY");
    const [doc] = await t.app.sql<{ variants: { thumb_key: string; medium_key: string } }[]>`
      select variants from documents where id = ${id}`;
    // the queued deletion becomes due and runs
    await storageSweep(t.app.db, store, { now: new Date(now.getTime() + 2 * 24 * 3600_000) });
    expect(existsSync(join(STORAGE_DIR, doc!.variants.thumb_key))).toBe(true);
    expect(existsSync(join(STORAGE_DIR, doc!.variants.medium_key))).toBe(true);
    for (const k of orphanKeys) expect(existsSync(join(STORAGE_DIR, k))).toBe(false);
  });

  it("a rendition run that loses to a concurrent one does not replace its keys (its own objects stay pending for the sweep)", async () => {
    const svc = await import("../../src/modules/documents/service.js");
    const { renderDocument } = await import("../../src/modules/documents/renditions.js");
    const up = await upload({ entity_type: "CUSTOMER", entity_id: customerId }, { name: "c.png", data: png });
    const id = up.body.document.id;
    const [a, b] = await Promise.all([
      renderDocument(t.app.db, svc.storage(), id),
      renderDocument(t.app.db, svc.storage(), id),
    ]);
    expect([a.status, b.status].sort()).toEqual(["READY", "SKIPPED"]);
    const [doc] = await t.app.sql<{ variants: { thumb_key: string; medium_key: string } }[]>`
      select variants from documents where id = ${id}`;
    expect(existsSync(join(STORAGE_DIR, doc!.variants.thumb_key))).toBe(true);
    // the loser's keys are still recorded as pending (never referenced by the row), so the sweep will remove them
    const pending = (
      await t.app.sql<{ key: string }[]>`
      select key from storage_pending_objects where purpose = 'rendition' and key like ${`%${doc!.variants.thumb_key.split("/").pop()!.split("_thumb_")[0]}%`}`
    ).map((r) => r.key);
    expect(pending).toHaveLength(2);
    expect(pending).not.toContain(doc!.variants.thumb_key);
  });
});

describe("EXPORT_CSV parts and the storage sweep", () => {
  async function newExport(jobName: string): Promise<{ id: string; companyId: string }> {
    await t.app.sql`insert into job_runs (job_name, status, started_at, finished_at)
                    select ${jobName}, 'OK', now() - (g || ' seconds')::interval, now()
                    from generate_series(1, 25) g`;
    const created = await t.request<{ id: string }>("POST", "/api/v1/exports", {
      token: admin,
      body: { path: "/api/v1/admin/jobs/runs", query: { job_name: jobName } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(202);
    const [co] = await t.app.sql<
      { company_id: string }[]
    >`select company_id from exports where id = ${created.body.id}`;
    return { id: created.body.id, companyId: co!.company_id };
  }

  it("a resumed export whose first parts are older than the orphan window is not swept mid-build", async () => {
    const list = await import("../../src/lib/list.js");
    const svc = await import("../../src/modules/documents/service.js");
    const { runCsvExport } = await import("../../src/modules/documents/exports.js");
    const { storageSweep } = await import("../../src/modules/documents/renditions.js");
    const ex = await newExport("PARTITION_MAINTENANCE");
    const pageRows = list.csvExportLimits.pageRows;
    list.csvExportLimits.pageRows = 10;
    try {
      const abort = new AbortController();
      let saved: Record<string, unknown> | null = null;
      const ctx = { db: t.app.db, app: t.app, data: { export_id: ex.id }, attempt: 1, maxAttempts: 3 };
      await expect(
        runCsvExport({
          ...ctx,
          signal: abort.signal,
          saveCheckpoint: async (cp) => {
            saved = cp;
            abort.abort(new Error("worker shutdown"));
          },
        }),
      ).rejects.toThrow();
      // the build sat parked longer than the orphan window …
      await t.app
        .sql`update storage_pending_objects set created_at = now() - interval '2 hours' where purpose = 'export-part'`;
      // … and the sweep runs while the resumed build is half way (at its next checkpoint)
      let swept = false;
      const out = await runCsvExport({
        ...ctx,
        attempt: 2,
        checkpoint: saved,
        saveCheckpoint: async () => {
          if (swept) return;
          swept = true;
          await storageSweep(t.app.db, svc.storage());
        },
      });
      expect(swept).toBe(true);
      expect(out).toMatchObject({ rows: 25, pages: 3, resumed_at_page: 1 });
      const [row] = await t.app.sql<{ status: string; storage_key: string }[]>`
        select status, storage_key from exports where id = ${ex.id}`;
      expect(row!.status).toBe("DONE");
      const csv = (await svc.storage().get(row!.storage_key)).toString("utf8").trimEnd().split("\r\n");
      expect(new Set(csv.slice(1).map((l) => l.split(",")[0])).size).toBe(25);
    } finally {
      list.csvExportLimits.pageRows = pageRows;
    }
  });

  it("parts the sweep already queued for deletion are never reused: the build restarts under new keys and the old deletion cannot hit it", async () => {
    const list = await import("../../src/lib/list.js");
    const svc = await import("../../src/modules/documents/service.js");
    const { runCsvExport, exportPartKey } = await import("../../src/modules/documents/exports.js");
    const { storageSweep } = await import("../../src/modules/documents/renditions.js");
    const ex = await newExport("VISIT_OUTCOME_NUDGE");
    const pageRows = list.csvExportLimits.pageRows;
    list.csvExportLimits.pageRows = 10;
    try {
      const abort = new AbortController();
      let saved: { run: string } | null = null;
      const ctx = { db: t.app.db, app: t.app, data: { export_id: ex.id }, attempt: 1, maxAttempts: 3 };
      await expect(
        runCsvExport({
          ...ctx,
          signal: abort.signal,
          saveCheckpoint: async (cp) => {
            saved = cp as { run: string };
            abort.abort(new Error("worker shutdown"));
          },
        }),
      ).rejects.toThrow();
      const oldPart = exportPartKey(ex.companyId, ex.id, saved!.run, 0);
      // parked past the window: the sweep queues the part, but its delete fails for now (backoff)
      await t.app
        .sql`update storage_pending_objects set created_at = now() - interval '2 hours' where purpose = 'export-part'`;
      const store = svc.storage();
      const refusing = {
        ...store,
        remove: async () => {
          throw new Error("delete refused");
        },
      } as typeof store;
      const now = new Date();
      expect((await storageSweep(t.app.db, refusing, { now })).orphans_queued).toBeGreaterThanOrEqual(1);
      // the resumed attempt finds its part no longer recorded and starts over under a new run nonce
      const out = await runCsvExport({ ...ctx, attempt: 2, checkpoint: saved, saveCheckpoint: async () => undefined });
      expect(out).toMatchObject({ rows: 25, pages: 3 });
      expect(out).not.toHaveProperty("resumed_at_page");
      // the queued deletion of the old part runs later and touches only that key
      await storageSweep(t.app.db, store, { now: new Date(now.getTime() + 2 * 24 * 3600_000) });
      expect(existsSync(join(STORAGE_DIR, oldPart))).toBe(false);
      const [row] = await t.app.sql<{ status: string; storage_key: string }[]>`
        select status, storage_key from exports where id = ${ex.id}`;
      expect(row!.status).toBe("DONE");
      expect(existsSync(join(STORAGE_DIR, row!.storage_key))).toBe(true);
    } finally {
      list.csvExportLimits.pageRows = pageRows;
    }
  });
});

describe("cursors: tampered values answer 400 INVALID_CURSOR, never a database error", () => {
  it("an impossible calendar date in a timestamp cursor is INVALID_CURSOR", async () => {
    await t.app.sql`insert into job_runs (job_name, status, started_at, finished_at)
                    select 'HOLD_EXPIRY', 'OK', now() - (g || ' seconds')::interval, now() from generate_series(1, 3) g`;
    const first = await t.request<{ next_cursor: string | null }>("GET", "/api/v1/admin/jobs/runs?limit=1", {
      token: admin,
    });
    expect(first.status).toBe(200);
    const { decodeCursor, encodeCursor } = await import("../../src/lib/list.js");
    const c = decodeCursor(first.body.next_cursor!);
    expect(typeof c.v).toBe("string");
    for (const v of [
      "2024-02-30 10:00:00.000000",
      "2023-02-29 10:00:00",
      "2024-01-01 24:00:00",
      "0000-01-01 00:00:00",
    ]) {
      const tampered = encodeCursor({ ...c, v });
      const res = await t.request<ErrorBody>("GET", `/api/v1/admin/jobs/runs?limit=1&cursor=${tampered}`, {
        token: admin,
      });
      expect(res.status, v).toBe(400);
      expect(res.body.error.code, v).toBe("INVALID_CURSOR");
    }
  });
});
