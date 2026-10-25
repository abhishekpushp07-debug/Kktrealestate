/**
 * Demo seed entry points (docs/SEED.md, SPEC §17):
 *   seedDemo(app, { force?, log? })  – drives the real API in-process to the exact demo state; returns early when the demo company
 *                                      already has projects unless { force: true }.
 *   reseed(db, { app? })             – guarded restore used by POST /admin/reseed: truncates every business table (sequences and
 *                                      idempotency keys included), keeps companies / roles / users / audit_logs (+ staff sessions),
 *                                      re-bootstraps the logins when missing, writes an `admin.reseed` audit row and runs seedDemo.
 *   CLI: `pnpm --filter @kkt/api seed` → migrations (idempotent) + bootstrap + seedDemo against DATABASE_URL.
 *
 * Documented fallbacks (direct SQL where no endpoint can express something historical):
 *   - brochure_downloads rows with past dates (+ the projects' download counters) — leads.ts;
 *   - finished site visits are booked at future slots through the scheduler, their outcome is marked through the API, then the
 *     visit_date is moved into the past — visits.ts.
 * Everything else — masters, inventory, prices, customers (KYC encryption), plans, stages, demands, payments, receipts, ledgers,
 * revisions, cancellation, handover, documents, photos, leads, visits, tickets, notices, CMS — is produced by the API.
 */
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import type { IntegrityReportResponse } from "@kkt/contracts";
import { runMigrations, type DB } from "@kkt/db";
import { config } from "../config.js";
import { writeAudit } from "../lib/audit.js";
import { bumpPermVersion, invalidate } from "../lib/cache.js";
import { logger } from "../lib/logger.js";
import { ensureBootstrap } from "./bootstrap.js";
import { seedBookings } from "./bookings.js";
import { seedCms } from "./cms.js";
import { seedConstruction } from "./construction.js";
import { SeedContext } from "./context.js";
import { enablePortalForAll, seedCustomers } from "./customers.js";
import { seedLeads } from "./leads.js";
import { seedMasters } from "./masters.js";
import { seedPlans } from "./plans.js";
import { seedProjects } from "./projects.js";
import { seedService } from "./service.js";
import { seedVisits } from "./visits.js";
import { validateSeed } from "./validate.js";

export { SEED_FALLBACKS } from "./fallbacks.js";

/** Result of a seed run. */
export interface SeedResult {
  skipped: boolean;
  counts: Record<string, number>;
  integrity?: IntegrityReportResponse;
  durationMs: number;
}

/** Options of seedDemo. */
export interface SeedOptions {
  /** Re-run even when projects already exist (the caller must have emptied the business tables first). */
  force?: boolean;
  log?: (msg: string) => void;
}

/** Tables that survive a reseed: identity, audit trail, staff sessions and the job-run history (operational, not demo data). */
export const RESEED_KEEP_TABLES = new Set(["companies", "roles", "users", "audit_logs", "refresh_tokens", "login_events", "password_history", "job_runs"]);

/** Redis key prefixes that cache rows the reseed replaces. */
const RESEED_REDIS_PREFIXES = ["idem:", "company:", "perm:user:", "perm:portal:", "pub:", "dash:", "visit:", "job:running:"];

async function hasProjects(app: FastifyInstance): Promise<boolean> {
  const [row] = await app.sql<{ n: number }[]>`select count(*)::int as n from projects`;
  return (row?.n ?? 0) > 0;
}

/** Seeds the demo company through the API. Idempotent: returns `{skipped: true}` when projects already exist (unless force). */
export async function seedDemo(app: FastifyInstance, opts: SeedOptions = {}): Promise<SeedResult> {
  const started = Date.now();
  const log = opts.log ?? ((msg: string) => logger.info({ seed: true }, msg));
  if (!opts.force && (await hasProjects(app))) {
    log("seed skipped: the demo company already has projects");
    return { skipped: true, counts: {}, durationMs: Date.now() - started };
  }
  const boot = await ensureBootstrap(app.db);
  const ctx = new SeedContext(app, boot.companyId, log);
  // The seed posts several hundred writes in a minute from one admin login; the per-user write throttle is an operational guard,
  // not a business rule, so it is lifted for the duration of the run and restored afterwards.
  const writeLimit = config.WRITE_RATE_LIMIT_PER_MIN;
  const publicLimit = config.PUBLIC_RATE_LIMIT_PER_MIN;
  config.WRITE_RATE_LIMIT_PER_MIN = 1_000_000;
  config.PUBLIC_RATE_LIMIT_PER_MIN = 1_000_000;
  try {
    await ctx.loginStaff();
    await seedMasters(ctx);
    await seedProjects(ctx);
    await seedPlans(ctx);
    await seedCustomers(ctx);
    await seedConstruction(ctx);
    await seedLeads(ctx);
    await enablePortalForAll(ctx);
    await seedBookings(ctx);
    await seedVisits(ctx);
    await seedCms(ctx);
    await seedService(ctx);
    const integrity = (await validateSeed(ctx)) as IntegrityReportResponse;
    await invalidate(app.redis, "pub:");
    await invalidate(app.redis, "dash:");
    log(`seed complete in ${Math.round((Date.now() - started) / 1000)} s: ${Object.entries(ctx.counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    return { skipped: false, counts: ctx.counts, integrity, durationMs: Date.now() - started };
  } finally {
    config.WRITE_RATE_LIMIT_PER_MIN = writeLimit;
    config.PUBLIC_RATE_LIMIT_PER_MIN = publicLimit;
    // The seed's own in-process calls bumped the per-user write counters of the staff logins (and the portal users it enabled);
    // left in place they would throttle the admin who triggered a reseed for the next minute. Drop them with the lifted limit.
    await invalidate(app.redis, "rl:w:");
  }
}

/** Truncates every business table (keeping identity + audit), inside one transaction with the append-only guards bypassed. */
export async function truncateBusinessTables(app: FastifyInstance): Promise<string[]> {
  const rows = await app.sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  const tables = rows.map((r) => r.tablename).filter((t) => !RESEED_KEEP_TABLES.has(t)).sort();
  if (tables.length === 0) return [];
  await app.sql.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx.unsafe(`truncate table ${tables.map((t) => `"${t}"`).join(", ")} restart identity cascade`);
    // portal sessions belong to the customers that were just removed; staff sessions stay valid
    await tx.unsafe("delete from refresh_tokens where subject_type = 'CUSTOMER'");
    await tx.unsafe("delete from password_history where user_type = 'CUSTOMER'");
    await tx.unsafe("delete from login_events where subject_type = 'CUSTOMER'");
  });
  return tables;
}

/**
 * Guarded reseed (POST /admin/reseed): restores EXACTLY the docs/SEED.md state. Needs a built app to drive the API; when the caller
 * has none (CLI, tests) one is built and closed here. Never allowed in production (the route enforces it; this function re-checks).
 */
export async function reseed(db: DB, opts: { app?: FastifyInstance; log?: (msg: string) => void } = {}): Promise<{ counts: Record<string, number>; integrity?: IntegrityReportResponse; truncated: string[] }> {
  if (config.NODE_ENV === "production") throw new Error("reseed is disabled when NODE_ENV=production");
  const log = opts.log ?? ((msg: string) => logger.info({ seed: true }, msg));
  let app = opts.app;
  let ownApp = false;
  if (!app) {
    const { buildApp } = await import("../app.js");
    app = await buildApp({ logger: false });
    await app.ready();
    ownApp = true;
  }
  try {
    log("reseed: truncating business tables");
    const truncated = await truncateBusinessTables(app);
    for (const prefix of RESEED_REDIS_PREFIXES) await invalidate(app.redis, prefix);
    await bumpPermVersion(app.redis);
    const boot = await ensureBootstrap(db);
    await app.db.transaction(async (tx) => {
      await writeAudit(tx, { companyId: boot.companyId, actor: { type: "SYSTEM", id: null, name: "reseed" }, action: "admin.reseed", entityType: "company", entityId: boot.companyId, after: { truncated_tables: truncated.length, bootstrap_created: boot.created } });
    });
    const result = await seedDemo(app, { force: true, log });
    return { counts: result.counts, integrity: result.integrity, truncated };
  } finally {
    if (ownApp) await app.close();
  }
}

/** `pnpm --filter @kkt/api seed`: migrate (idempotent), bootstrap, seed. */
async function main(): Promise<void> {
  await runMigrations(config.DATABASE_URL);
  logger.info("migrations applied");
  const { buildApp } = await import("../app.js");
  const app = await buildApp({ logger: false });
  await app.ready();
  try {
    const boot = await ensureBootstrap(app.db);
    logger.info({ companyId: boot.companyId, created: boot.created }, "bootstrap seed ensured");
    const force = process.argv.includes("--force");
    if (force) {
      await reseed(app.db, { app });
    } else {
      const result = await seedDemo(app);
      if (result.skipped) logger.warn("demo data already present (run with --force to drop business data and reseed)");
    }
  } finally {
    await app.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    logger.fatal({ err }, "seed failed");
    process.exit(1);
  });
}
