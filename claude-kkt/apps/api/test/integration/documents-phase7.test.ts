/**
 * Phase 7 platform track, documents: no image processing or storage I/O inside a DB transaction, renditions in a background job, the
 * storage sweep (orphans of failed uploads, queued deletions with backoff), bounded image work.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const STORAGE_DIR = mkdtempSync(join(tmpdir(), "kkt-docs-p7-"));
process.env["STORAGE_LOCAL_DIR"] = STORAGE_DIR;
process.env["IMAGE_CONCURRENCY"] = "2";

const { buildTestApp, freshIp } = await import("./helpers.js");
const { createPortalCustomer } = await import("./fixtures.js");
type TestContext = Awaited<ReturnType<typeof buildTestApp>>;

let t: TestContext;
let admin: string;
let customerId: string;
let png: Buffer;

type DocRow = {
  id: string;
  mime: string;
  renditions: string;
  has_variants: boolean;
  thumb_url: string | null;
  medium_url: string | null;
};

async function upload(fields: Record<string, string>, file: { name: string; data: Buffer }) {
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
    },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as { document: DocRow; error?: { code: string } } };
}

/** Every file under the storage root (relative keys). */
function storedKeys(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`);
      else out.push(`${prefix}${e.name}`);
    }
  };
  walk(STORAGE_DIR, "");
  return out.filter((k) => !k.startsWith("health/") && !k.startsWith("exports/"));
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  customerId = (await createPortalCustomer(t, { phone: "9876505555" })).customerId;
  png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 10, g: 80, b: 40 } } })
    .png()
    .toBuffer();
});
afterAll(async () => {
  await t?.close();
});

describe("uploads: no storage I/O or image work inside a transaction, renditions in a job", () => {
  it("the upload answers PENDING without waiting for renditions; storage writes happen while no transaction is open; the job finishes them", async () => {
    const svc = await import("../../src/modules/documents/service.js");
    const store = svc.storage();
    // instrument: count open transactions and the storage writes made while one is open
    let open = 0;
    const writesInTx: string[] = [];
    const db = t.app.db as unknown as { transaction: (...a: unknown[]) => Promise<unknown> };
    const transaction = db.transaction;
    db.transaction = (fn: unknown, cfg?: unknown) =>
      transaction.call(
        t.app.db,
        async (tx: unknown) => {
          open += 1;
          try {
            return await (fn as (tx: unknown) => Promise<unknown>)(tx);
          } finally {
            open -= 1;
          }
        },
        cfg,
      );
    const put = store.put.bind(store);
    store.put = async (key, data, type) => {
      if (open > 0) writesInTx.push(key);
      return put(key, data, type);
    };
    try {
      const before = storedKeys().length;
      const r = await upload(
        { entity_type: "CUSTOMER", entity_id: customerId, title: "Async" },
        { name: "big.png", data: png },
      );
      expect(r.status).toBe(201);
      expect(r.body.document.renditions).toBe("PENDING");
      expect(r.body.document.has_variants).toBe(false);
      // the thumb/medium links serve the original until the renditions exist
      expect(r.body.document.thumb_url).toMatch(/\/api\/v1\/files\//);
      expect(writesInTx).toEqual([]);
      // only the original was written; no rendition yet, and nothing left pending
      const keys = storedKeys();
      expect(keys.length).toBe(before + 1);
      expect(keys.some((k) => k.endsWith("_thumb.webp"))).toBe(false);
      expect(await t.app.sql`select key from storage_pending_objects`).toHaveLength(0);
      // the renditions job was enqueued on the HEAVY queue
      const { Queue } = await import("bullmq");
      const { bullConnection } = await import("../../src/jobs/queue.js");
      const heavy = new Queue("kkt-jobs-heavy", { connection: bullConnection() });
      try {
        const waiting = await heavy.getJobs(["waiting", "delayed", "prioritized"]);
        expect(waiting.map((j) => [j.name, j.data["document_id"]])).toContainEqual([
          "DOCUMENT_RENDITIONS",
          r.body.document.id,
        ]);
      } finally {
        await heavy.close();
      }
      // the job (as the worker runs it)
      const { runJob } = await import("../../src/jobs/index.js");
      const run = await runJob(t.app.db, "DOCUMENT_RENDITIONS", { document_id: r.body.document.id }, { app: t.app });
      expect(run.result).toMatchObject({ status: "READY" });
      expect(writesInTx).toEqual([]);
      const after = await t.request<DocRow>("GET", `/api/v1/documents/${r.body.document.id}`, { token: admin });
      expect(after.body.renditions).toBe("READY");
      expect(after.body.has_variants).toBe(true);
      expect(storedKeys().filter((k) => k.endsWith(".webp"))).toHaveLength(2);
      expect(await t.app.sql`select key from storage_pending_objects`).toHaveLength(0);
      // idempotent: a second run skips
      expect((await runJob(t.app.db, "DOCUMENT_RENDITIONS", { document_id: r.body.document.id })).result).toMatchObject(
        {
          status: "SKIPPED",
        },
      );
    } finally {
      db.transaction = transaction;
      store.put = put;
    }
  });

  it("an undecodable image is marked FAILED and keeps serving its original", async () => {
    const r = await upload({ entity_type: "CUSTOMER", entity_id: customerId }, { name: "bad.png", data: png });
    const id = r.body.document.id;
    const [row] = await t.app.sql<{ storage_key: string }[]>`select storage_key from documents where id = ${id}`;
    const svc = await import("../../src/modules/documents/service.js");
    // the stored bytes rot (or were truncated by the client): a PNG header followed by garbage
    await svc.storage().put(row!.storage_key, Buffer.concat([png.subarray(0, 64), Buffer.alloc(512, 7)]), "image/png");
    const { runJob } = await import("../../src/jobs/index.js");
    const run = await runJob(t.app.db, "DOCUMENT_RENDITIONS", { document_id: id });
    expect(run.result).toMatchObject({ status: "FAILED" });
    const doc = await t.request<DocRow>("GET", `/api/v1/documents/${id}`, { token: admin });
    expect(doc.body.renditions).toBe("FAILED");
    expect(doc.body.has_variants).toBe(false);
    const link = await t.request<{ mime: string }>("POST", `/api/v1/documents/${id}/link?variant=thumb`, {
      token: admin,
    });
    expect(link.status).toBe(200);
    expect(link.body.mime).toBe("image/png"); // the original stands in
  });

  it("image work is bounded: at most IMAGE_CONCURRENCY sharp pipelines at once", async () => {
    const { imageSlots, makeVariants, sharpThreads } = await import("../../src/modules/documents/renditions.js");
    expect(imageSlots.permits).toBe(2);
    expect(sharp.concurrency()).toBe(sharpThreads());
    let peak = 0;
    const sampler = setInterval(() => (peak = Math.max(peak, imageSlots.state().inUse)), 1);
    try {
      await Promise.all(Array.from({ length: 6 }, () => makeVariants(png)));
    } finally {
      clearInterval(sampler);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(imageSlots.state()).toEqual({ inUse: 0, waiting: 0 });
  });
});

describe("failures after the storage write leave no orphan", () => {
  it("a failure inside the transaction removes the written original and its pending record at once", async () => {
    // a database failure after the storage write (an insert the database refuses)
    await t.app.sql.unsafe(`
      create or replace function kkt_test_refuse_doc() returns trigger language plpgsql as $$
      begin if new.title = 'FAIL-AFTER-WRITE' then raise exception 'refused by test trigger'; end if; return new; end $$;
      drop trigger if exists kkt_test_refuse_doc on documents;
      create trigger kkt_test_refuse_doc before insert on documents for each row execute function kkt_test_refuse_doc();`);
    try {
      const before = storedKeys();
      const r = await upload(
        { entity_type: "CUSTOMER", entity_id: customerId, title: "FAIL-AFTER-WRITE" },
        { name: "doomed.png", data: png },
      );
      expect(r.status).toBe(500);
      expect(storedKeys()).toEqual(before);
      expect(await t.app.sql`select key from storage_pending_objects`).toHaveLength(0);
      expect(await t.app.sql`select 1 from documents where title = 'FAIL-AFTER-WRITE'`).toHaveLength(0);
    } finally {
      await t.app.sql.unsafe(
        `drop trigger if exists kkt_test_refuse_doc on documents; drop function if exists kkt_test_refuse_doc();`,
      );
    }
  });

  it("a process that died between the storage write and COMMIT leaves a pending record; STORAGE_SWEEP removes the object after an hour", async () => {
    const svc = await import("../../src/modules/documents/service.js");
    const prepared = await svc.prepareUpload(t.app.db, {
      companyId: t.companyId,
      entityType: "CUSTOMER",
      entityId: customerId,
      buffer: png,
      filename: "crash.png",
      uploadedBy: null,
      uploadedByType: "SYSTEM",
    });
    const staged = await svc.stageUpload(t.app.db, prepared);
    // … and the process dies here: no transaction, no cleanup
    expect(existsSync(join(STORAGE_DIR, staged.key))).toBe(true);
    const [pending] = await t.app.sql<
      { purpose: string }[]
    >`select purpose from storage_pending_objects where key = ${staged.key}`;
    expect(pending!.purpose).toBe("document");
    const { runJob } = await import("../../src/jobs/index.js");
    // younger than an hour: left alone (an upload may still be committing)
    const early = await runJob(t.app.db, "STORAGE_SWEEP", {}, { app: t.app });
    expect(early.result).toMatchObject({ orphans_queued: 0 });
    expect(existsSync(join(STORAGE_DIR, staged.key))).toBe(true);
    await t.app
      .sql`update storage_pending_objects set created_at = now() - interval '2 hours' where key = ${staged.key}`;
    const swept = await runJob(t.app.db, "STORAGE_SWEEP", {}, { app: t.app });
    expect(swept.result).toMatchObject({ orphans_queued: 1, deleted: 1, failed: 0 });
    expect(existsSync(join(STORAGE_DIR, staged.key))).toBe(false);
    expect(await t.app.sql`select 1 from storage_pending_objects where key = ${staged.key}`).toHaveLength(0);
    const [del] = await t.app.sql<{ reason: string; done_at: Date | null }[]>`
      select reason, done_at from storage_deletions where key = ${staged.key}`;
    expect(del!.reason).toBe("ORPHANED_DOCUMENT");
    expect(del!.done_at).not.toBeNull();
  });

  it("a committed document's object is never swept, even if its pending record was left behind", async () => {
    const svc = await import("../../src/modules/documents/service.js");
    const row = await svc.uploadDocument(
      t.app,
      {
        companyId: t.companyId,
        entityType: "CUSTOMER",
        entityId: customerId,
        buffer: png,
        filename: "kept.png",
        uploadedBy: null,
        uploadedByType: "SYSTEM",
      },
      async (_tx, r) => r,
    );
    await t.app.sql`insert into storage_pending_objects (key, company_id, purpose, created_at)
                    values (${row.storageKey}, ${t.companyId}, 'document', now() - interval '2 hours')`;
    const { storageSweep } = await import("../../src/modules/documents/renditions.js");
    await storageSweep(t.app.db, svc.storage());
    expect(existsSync(join(STORAGE_DIR, row.storageKey))).toBe(true);
    expect(await t.app.sql`select 1 from storage_pending_objects where key = ${row.storageKey}`).toHaveLength(0);
  });

  it("queued deletions retry with exponential backoff and an attempt count until the object is gone", async () => {
    const svc = await import("../../src/modules/documents/service.js");
    const { storageSweep, deletionBackoffMs } = await import("../../src/modules/documents/renditions.js");
    const key = `${t.companyId}/2026/10/stuck-object.png`;
    // a directory where the object should be: the store refuses to delete it
    mkdirSync(join(STORAGE_DIR, key), { recursive: true });
    const [q] = await t.app.sql<{ id: string }[]>`
      insert into storage_deletions (key, company_id, reason, attempts) values (${key}, ${t.companyId}, 'CUSTOMER_ERASED', 1) returning id`;
    const now = new Date();
    const first = await storageSweep(t.app.db, svc.storage(), { now });
    expect(first.failed).toBeGreaterThanOrEqual(1);
    const [a] = await t.app.sql<
      { attempts: number; last_error: string; next_attempt_at: Date; done_at: Date | null }[]
    >`
      select attempts, last_error, next_attempt_at, done_at from storage_deletions where id = ${q!.id}`;
    expect(a!.attempts).toBe(2);
    expect(a!.last_error).toBeTruthy();
    expect(a!.done_at).toBeNull();
    expect(new Date(a!.next_attempt_at).getTime() - now.getTime()).toBe(deletionBackoffMs(2));
    expect(deletionBackoffMs(3)).toBe(2 * deletionBackoffMs(2));
    expect(deletionBackoffMs(40)).toBe(24 * 3600_000);
    // not due yet: untouched
    await storageSweep(t.app.db, svc.storage(), { now });
    expect(
      (await t.app.sql<{ attempts: number }[]>`select attempts from storage_deletions where id = ${q!.id}`)[0]!
        .attempts,
    ).toBe(2);
    // the obstacle is gone and the retry is due
    const { rmSync } = await import("node:fs");
    rmSync(join(STORAGE_DIR, key), { recursive: true });
    const later = new Date(now.getTime() + deletionBackoffMs(2) + 1000);
    const second = await storageSweep(t.app.db, svc.storage(), { now: later });
    expect(second.deleted).toBeGreaterThanOrEqual(1);
    const [b] = await t.app.sql<{ done_at: Date | null }[]>`select done_at from storage_deletions where id = ${q!.id}`;
    expect(b!.done_at).not.toBeNull();
  });

  it("STORAGE_SWEEP is scheduled every 10 minutes on the critical queue; DOCUMENT_RENDITIONS runs on the heavy queue", async () => {
    const { JOB_SCHEDULES, queueNameOf } = await import("../../src/jobs/index.js");
    expect(JOB_SCHEDULES.find((s) => s.name === "STORAGE_SWEEP")?.cron).toBe("*/10 * * * *");
    expect(queueNameOf("STORAGE_SWEEP")).toBe("kkt-jobs");
    expect(queueNameOf("DOCUMENT_RENDITIONS")).toBe("kkt-jobs-heavy");
  });
});

describe("EXPORT_CSV checkpoints (heavy queue)", () => {
  it("an export interrupted between pages resumes at its checkpoint: every row exactly once, parts cleaned up", async () => {
    const list = await import("../../src/lib/list.js");
    const { runCsvExport, exportPartKey } = await import("../../src/modules/documents/exports.js");
    const svc = await import("../../src/modules/documents/service.js");
    await t.app.sql`insert into job_runs (job_name, status, started_at, finished_at)
                    select 'HOLD_EXPIRY', 'OK', now() - (g || ' seconds')::interval, now() from generate_series(1, 25) g`;
    const created = await t.request<{ id: string }>("POST", "/api/v1/exports", {
      token: admin,
      body: { path: "/api/v1/admin/jobs/runs", query: { job_name: "HOLD_EXPIRY" } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(202);
    const exportId = created.body.id;
    const pageRows = list.csvExportLimits.pageRows;
    list.csvExportLimits.pageRows = 10;
    try {
      const abort = new AbortController();
      let saved: Record<string, unknown> | null = null;
      const ctx = { db: t.app.db, app: t.app, data: { export_id: exportId }, attempt: 1, maxAttempts: 3 };
      // first attempt: interrupted (a deploy) right after its first checkpoint
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
      expect(saved).toMatchObject({ rows: 10, pages: 1 });
      const [co] = await t.app.sql<{ company_id: string }[]>`select company_id from exports where id = ${exportId}`;
      expect(await svc.storage().exists(exportPartKey(co!.company_id, exportId, 0))).toBe(true);
      // the next attempt resumes from it
      const out = await runCsvExport({ ...ctx, attempt: 2, checkpoint: saved, saveCheckpoint: async () => undefined });
      expect(out).toMatchObject({ rows: 25, pages: 3, resumed_at_page: 1 });
      const [row] = await t.app.sql<{ status: string; storage_key: string; row_count: number }[]>`
        select status, storage_key, row_count from exports where id = ${exportId}`;
      expect(row).toMatchObject({ status: "DONE", row_count: 25 });
      const csv = (await svc.storage().get(row!.storage_key)).toString("utf8").trimEnd().split("\r\n");
      expect(csv).toHaveLength(26); // header + 25 rows
      const ids = csv.slice(1).map((l) => l.split(",")[0]);
      expect(new Set(ids).size).toBe(25);
      for (let n = 0; n < 3; n++)
        expect(await svc.storage().exists(exportPartKey(co!.company_id, exportId, n))).toBe(false);
      expect(
        await t.app.sql`select 1 from storage_pending_objects where key like ${`exports/%${exportId}%`}`,
      ).toHaveLength(0);
    } finally {
      list.csvExportLimits.pageRows = pageRows;
    }
  });
});
