/**
 * Image renditions and storage hygiene (audit A2/C5 "image processing inside the upload transaction", D9/B9 "orphaned files"):
 *
 *  - every sharp pipeline (header reads at upload, the rendition encodes) runs under a process-wide semaphore of IMAGE_CONCURRENCY
 *    permits, and libvips gets a bounded thread count (sharp.concurrency), so image work can neither starve the libuv thread pool
 *    (argon2, fs, zlib share it) nor oversubscribe the CPU;
 *  - DOCUMENT_RENDITIONS (heavy queue) produces the webp thumb (≈480 px) and medium (≈1080 px) renditions after the upload committed; until
 *    they exist the document reports `renditions: "PENDING"` and its thumb/medium links serve the original;
 *  - STORAGE_SWEEP (critical queue, every 10 minutes) turns uploads that never committed (storage_pending_objects older than an hour)
 *    into queued deletions, retries storage_deletions with exponential backoff, and re-enqueues renditions that never ran.
 */
import { availableParallelism } from "node:os";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { documents, storageDeletions, storagePendingObjects, type DB, type Executor } from "@kkt/db";
import { config } from "../../config.js";
import { enqueueJobWithin } from "../../jobs/queue.js";
import type { JobContext } from "../../jobs/index.js";
import { logger } from "../../lib/logger.js";
import { storageSweepTotal } from "../../lib/metrics.js";
import type { Storage } from "../../lib/storage.js";

/** Rendition widths (px). */
export const THUMB_WIDTH = 480;
export const MEDIUM_WIDTH = 1080;
/** Images above this many pixels (width × height) are refused before any decoding (decompression-bomb guard). */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** Rendition state of a document (DocumentRow.renditions). */
export type RenditionStatus = "NONE" | "PENDING" | "READY" | "FAILED";

/** documents.variants as stored (packages/db DocumentVariants plus the rendition state this module records). */
export interface StoredVariants {
  thumb_key?: string | null;
  medium_key?: string | null;
  width?: number | null;
  height?: number | null;
  renditions?: "PENDING" | "READY" | "FAILED" | null;
}

/** Rendition state of a stored row (legacy rows: renditions present → READY, an image with dimensions only → FAILED). */
export function renditionStatus(mime: string, variants: StoredVariants | null | undefined): RenditionStatus {
  if (!mime.startsWith("image/")) return "NONE";
  if (variants?.thumb_key && variants.medium_key) return "READY";
  if (variants?.renditions === "PENDING") return "PENDING";
  if (variants?.renditions === "FAILED" || variants?.width) return "FAILED";
  return "NONE";
}

// ---------------------------------------------------------------------------
// Bounded image work
// ---------------------------------------------------------------------------

/** A counting semaphore (FIFO). */
export class Semaphore {
  private available: number;
  private readonly waiters: (() => void)[] = [];
  constructor(readonly permits: number) {
    this.available = permits;
  }
  /** Runs `fn` holding one permit. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.available > 0) this.available -= 1;
    else await new Promise<void>((resolve) => this.waiters.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.available += 1;
    }
  }
  /** Permits in use and callers waiting (tests, metrics). */
  state(): { inUse: number; waiting: number } {
    return { inUse: this.permits - this.available, waiting: this.waiters.length };
  }
}

/** Process-wide permit for sharp work (IMAGE_CONCURRENCY pipelines at once). */
export const imageSlots = new Semaphore(config.IMAGE_CONCURRENCY);

/** libvips threads per pipeline: the CPUs shared out between the concurrent pipelines (at least 1). */
export function sharpThreads(cpus = availableParallelism(), pipelines = config.IMAGE_CONCURRENCY): number {
  return Math.max(1, Math.floor(cpus / Math.max(1, pipelines)));
}
sharp.concurrency(sharpThreads());

/** Generates the webp thumb and medium renditions (one permit for both encodes); throws when the bytes are not a decodable image. */
export async function makeVariants(
  buffer: Buffer,
): Promise<{ thumb: Buffer; medium: Buffer; width: number | null; height: number | null }> {
  return imageSlots.run(async () => {
    const opts = { limitInputPixels: MAX_IMAGE_PIXELS };
    const meta = await sharp(buffer, opts).metadata();
    const thumb = await sharp(buffer, opts)
      .rotate()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    const medium = await sharp(buffer, opts)
      .rotate()
      .resize({ width: MEDIUM_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { thumb, medium, width: meta.width ?? null, height: meta.height ?? null };
  });
}

// ---------------------------------------------------------------------------
// Pending objects (written to storage before their row commits)
// ---------------------------------------------------------------------------

/** Records `key` as written-but-not-committed (autocommit, BEFORE the bytes are written). */
export async function recordPendingObject(
  db: Executor,
  key: string,
  companyId: string | null,
  purpose: string,
): Promise<void> {
  await db.insert(storagePendingObjects).values({ key, companyId, purpose }).onConflictDoNothing();
}

/** Forgets pending keys (inside the transaction that commits their owning row). */
export async function clearPendingObjects(tx: Executor, keys: readonly string[]): Promise<void> {
  for (const key of keys) await tx.delete(storagePendingObjects).where(eq(storagePendingObjects.key, key));
}

// ---------------------------------------------------------------------------
// DOCUMENT_RENDITIONS
// ---------------------------------------------------------------------------

/** Enqueues the renditions of an image document (deduplicated per document); a queue outage leaves it PENDING for the sweep. */
export async function requestRenditions(
  app: Pick<FastifyInstance, "jobQueue" | "log">,
  doc: { id: string; companyId: string; mime: string },
): Promise<boolean> {
  if (!doc.mime.startsWith("image/")) return false;
  try {
    await enqueueJobWithin(
      app.jobQueue(),
      "DOCUMENT_RENDITIONS",
      { document_id: doc.id, company_id: doc.companyId },
      { dedupeId: `renditions:${doc.id}` },
      2_000,
    );
    return true;
  } catch (err) {
    app.log.warn(
      { err: (err as Error).message, document_id: doc.id },
      "renditions not enqueued; STORAGE_SWEEP retries",
    );
    return false;
  }
}

/** Outcome of one rendition run. */
export interface RenditionResult {
  document_id: string;
  status: "READY" | "FAILED" | "SKIPPED";
  reason?: string;
}

/**
 * Generates and stores the renditions of one document and records them. Idempotent: a deleted, non-image or already rendered document is
 * skipped. Rendition keys are recorded as pending before they are written and cleared in the transaction that records them, so a crash in
 * between leaves nothing the sweep cannot find. An undecodable image is marked FAILED (the original stays served); storage errors throw
 * (BullMQ retries).
 */
export async function renderDocument(
  db: DB,
  store: Storage,
  documentId: string,
  signal?: AbortSignal,
): Promise<RenditionResult> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return { document_id: documentId, status: "SKIPPED", reason: "not found" };
  const variants = (doc.variants ?? null) as StoredVariants | null;
  if (doc.isDeleted) return { document_id: doc.id, status: "SKIPPED", reason: "deleted" };
  if (!doc.mime.startsWith("image/")) return { document_id: doc.id, status: "SKIPPED", reason: "not an image" };
  if (variants?.thumb_key && variants.medium_key)
    return { document_id: doc.id, status: "SKIPPED", reason: "already rendered" };
  signal?.throwIfAborted();
  const original = await store.get(doc.storageKey);
  let img: Awaited<ReturnType<typeof makeVariants>>;
  try {
    img = await makeVariants(original);
  } catch (err) {
    await db
      .update(documents)
      .set({ variants: { ...(variants ?? {}), renditions: "FAILED" } as StoredVariants as typeof doc.variants })
      .where(eq(documents.id, doc.id));
    logger.warn({ document_id: doc.id, err: (err as Error).message }, "renditions failed; the original stays served");
    return { document_id: doc.id, status: "FAILED", reason: (err as Error).message.slice(0, 200) };
  }
  signal?.throwIfAborted();
  const base = doc.storageKey.replace(/\.[a-z0-9]+$/i, "");
  const thumbKey = `${base}_thumb.webp`;
  const mediumKey = `${base}_medium.webp`;
  for (const key of [thumbKey, mediumKey]) await recordPendingObject(db, key, doc.companyId, "rendition");
  await store.put(thumbKey, img.thumb, "image/webp");
  await store.put(mediumKey, img.medium, "image/webp");
  const next: StoredVariants = {
    thumb_key: thumbKey,
    medium_key: mediumKey,
    width: img.width ?? variants?.width ?? null,
    height: img.height ?? variants?.height ?? null,
    renditions: "READY",
  };
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(documents)
      .set({ variants: next as typeof doc.variants })
      .where(and(eq(documents.id, doc.id), eq(documents.isDeleted, false)))
      .returning({ id: documents.id });
    // the pending records go in the same transaction: committed → the keys belong to the row; rolled back → the sweep removes them
    if (rows.length > 0) await clearPendingObjects(tx, [thumbKey, mediumKey]);
    return rows.length > 0;
  });
  if (!updated) return { document_id: doc.id, status: "SKIPPED", reason: "deleted meanwhile" };
  return { document_id: doc.id, status: "READY" };
}

/** DOCUMENT_RENDITIONS handler. */
export async function renditionsJob(
  ctx: Pick<JobContext, "db" | "data" | "signal">,
  store: Storage,
): Promise<Record<string, unknown>> {
  const id = String(ctx.data["document_id"] ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { skipped: true, reason: "no document_id" };
  return { ...(await renderDocument(ctx.db, store, id, ctx.signal)) };
}

// ---------------------------------------------------------------------------
// STORAGE_SWEEP
// ---------------------------------------------------------------------------

/** Age after which a pending (never committed) object is an orphan. */
export const PENDING_ORPHAN_AFTER_MS = 60 * 60_000;
/** Deletions handled per sweep run. */
export const SWEEP_BATCH = 200;
/** Backoff of a failed deletion: 1 min · 2^attempts, capped at a day (the row is never dropped). */
export function deletionBackoffMs(attempts: number): number {
  return Math.min(24 * 3600_000, 60_000 * 2 ** Math.max(0, Math.min(attempts, 20)));
}

/** True for a "the object is already gone" storage error (both drivers report ENOENT). */
function isNotFound(err: unknown): boolean {
  return (err as { code?: string }).code === "ENOENT";
}

/**
 * STORAGE_SWEEP: (1) pending objects older than PENDING_ORPHAN_AFTER_MS whose row never committed become queued deletions (one statement,
 * so nothing is lost between the two tables); (2) due storage_deletions are claimed with SKIP LOCKED (a 10-minute lease), deleted, and
 * marked done — or retried later with exponential backoff and an attempt count; (3) image documents still PENDING after ten minutes get
 * their renditions re-enqueued.
 */
export async function storageSweep(
  db: DB,
  store: Storage,
  opts: { now?: Date; app?: Pick<FastifyInstance, "jobQueue" | "log"> | null; signal?: AbortSignal } = {},
): Promise<{ orphans_queued: number; deleted: number; failed: number; renditions_requeued: number }> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - PENDING_ORPHAN_AFTER_MS);
  const orphans = (await db.execute(sql`
    with gone as (
      delete from ${storagePendingObjects} p
      where p.key in (
        select key from ${storagePendingObjects}
        where created_at < ${cutoff.toISOString()}::timestamptz
        order by created_at limit ${SWEEP_BATCH * 5} for update skip locked)
        and not exists (
          select 1 from ${documents} d
          where d.storage_key = p.key or d.variants ->> 'thumb_key' = p.key or d.variants ->> 'medium_key' = p.key)
      returning p.key, p.company_id, p.purpose)
    insert into ${storageDeletions} (key, company_id, reason)
    select key, company_id, 'ORPHANED_' || upper(purpose) from gone
    returning id`)) as unknown as { id: string }[];
  // committed objects whose pending record was left behind (defensive): just forget the record
  await db.execute(sql`
    delete from ${storagePendingObjects} p
    where p.created_at < ${cutoff.toISOString()}::timestamptz
      and exists (
        select 1 from ${documents} d
        where d.storage_key = p.key or d.variants ->> 'thumb_key' = p.key or d.variants ->> 'medium_key' = p.key)`);

  let deleted = 0;
  let failed = 0;
  for (;;) {
    opts.signal?.throwIfAborted();
    const due = (await db.execute(sql`
      update ${storageDeletions} set next_attempt_at = ${now.toISOString()}::timestamptz + interval '10 minutes'
      where id in (
        select id from ${storageDeletions}
        where done_at is null and next_attempt_at <= greatest(now(), ${now.toISOString()}::timestamptz)
        order by next_attempt_at limit ${SWEEP_BATCH} for update skip locked)
      returning id, key, attempts`)) as unknown as { id: string; key: string; attempts: number }[];
    if (due.length === 0) break;
    for (const d of due) {
      try {
        await store.remove(d.key).catch((err: unknown) => {
          if (!isNotFound(err)) throw err;
        });
        await db.update(storageDeletions).set({ doneAt: new Date() }).where(eq(storageDeletions.id, d.id));
        storageSweepTotal.inc({ action: "deletion_done" });
        deleted += 1;
      } catch (err) {
        const attempts = Number(d.attempts) + 1;
        await db
          .update(storageDeletions)
          .set({
            attempts,
            lastError: String((err as Error).message).slice(0, 500),
            nextAttemptAt: new Date(now.getTime() + deletionBackoffMs(attempts)),
          })
          .where(eq(storageDeletions.id, d.id));
        storageSweepTotal.inc({ action: attempts >= 10 ? "deletion_gave_up" : "deletion_failed" });
        if (attempts >= 10)
          logger.error({ key: d.key, attempts }, "storage deletion keeps failing; still retried daily");
        failed += 1;
      }
    }
    if (due.length < SWEEP_BATCH) break;
  }
  if (orphans.length > 0) storageSweepTotal.inc({ action: "orphan_queued" }, orphans.length);

  let requeued = 0;
  if (opts.app) {
    const stuck = (await db.execute(sql`
      select id, company_id, mime from ${documents}
      where is_deleted = false and mime like 'image/%' and variants ->> 'renditions' = 'PENDING'
        and created_at < ${new Date(now.getTime() - 10 * 60_000).toISOString()}::timestamptz
      order by created_at limit ${SWEEP_BATCH}`)) as unknown as { id: string; company_id: string; mime: string }[];
    for (const d of stuck)
      if (await requestRenditions(opts.app, { id: d.id, companyId: d.company_id, mime: d.mime })) requeued += 1;
  }
  return { orphans_queued: orphans.length, deleted, failed, renditions_requeued: requeued };
}
