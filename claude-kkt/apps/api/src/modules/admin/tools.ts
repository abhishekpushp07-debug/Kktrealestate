/**
 * Admin tools (SPEC §10/§11 "admin recompute rebuilds a booking's summary and ledger from source records; startup reconciliation
 * reports mismatches", §17 guarded reseed): recompute, reconcile (dry run), job registry + run-now, system facts, reseed.
 * "Run dues now" and the integrity report/repair already live in the money module (POST /dues/run, GET /dues/integrity); the jobs view links to them.
 */
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  AdminJobEnqueuedResponseSchema,
  AdminJobNameParamsSchema,
  AdminJobRunFilterSchema,
  AdminJobRunListResponseSchema,
  AdminJobRunNowRequestSchema,
  AdminJobRunRowSchema,
  AdminJobsResponseSchema,
  AdminRecomputeRequestSchema,
  AdminRecomputeResponseSchema,
  AdminReconcileRequestSchema,
  AdminReconcileResponseSchema,
  AdminReseedRequestSchema,
  AdminReseedResponseSchema,
  AdminSystemResponseSchema,
  JOB_NAMES,
  type AdminJobInfo,
  type AdminJobRunRow,
  type AdminRecomputeMismatch,
  type AdminRecomputeResponse,
  type AdminReconcileResponse,
  type AdminReseedResponse,
  type AdminSystemResponse,
  type IntegrityReportResponse,
  type JobName,
} from "@kkt/contracts";
import { bookings, companies, jobRuns, type DB, type Executor } from "@kkt/db";
import { config } from "../../config.js";
import {
  JOB_SCHEDULES,
  partitioningEnabled,
  registeredJobs,
  registerJob,
  sweepAbandonedJobRuns,
} from "../../jobs/index.js";
import { enqueueJob, nextRuns } from "../../jobs/queue.js";
import { writeAudit } from "../../lib/audit.js";
import { bumpPermVersion, invalidate } from "../../lib/cache.js";
import { sendCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { listPaging, paginate } from "../../lib/list.js";

import { route } from "../../lib/routes.js";
import { ensureProjectAccess, scopeFilter, type StaffContext } from "../../lib/scope.js";
import { CORE_MODULES, discoverModules, selectModules } from "../loader.js";
import { onSnapshot, rebuild } from "../money/index.js";
import { adminMeta, idParams, iso, requireSuperAdmin, staff } from "./common.js";

type JobRunRecord = typeof jobRuns.$inferSelect;

/**
 * The part of a job result one tenant may read (audit B: job_runs is a platform table, but results can carry tenant data). Convention for
 * job results: tenant-neutral counters at the top level, tenant data under `by_company: {<company id>: {...}}` — a reader sees the top
 * level merged with their own company's entry and nothing of the others; a result naming another `company_id` is hidden entirely.
 */
export function companyJobResult(
  result: Record<string, unknown> | null | undefined,
  companyId: string,
): Record<string, unknown> | null {
  if (!result) return null;
  if (typeof result["company_id"] === "string" && result["company_id"] !== companyId) return null;
  const byCompany = result["by_company"];
  if (!byCompany || typeof byCompany !== "object") return result;
  const { by_company: _all, ...rest } = result;
  const own = (byCompany as Record<string, unknown>)[companyId];
  return { ...rest, ...(own && typeof own === "object" ? (own as Record<string, unknown>) : {}) };
}

/** Wire row of a job run, its result reduced to what `companyId` may read (companyJobResult). */
export function toJobRunRow(r: JobRunRecord, companyId: string): AdminJobRunRow {
  return {
    id: r.id,
    job_name: r.jobName,
    started_at: r.startedAt.toISOString(),
    finished_at: iso(r.finishedAt),
    status: r.status,
    result: companyJobResult(r.result ?? null, companyId),
    error: r.error,
  };
}

// ---------------------------------------------------------------------------
// Recompute / reconcile
// ---------------------------------------------------------------------------

/** Scope of a recompute/reconcile run. */
export interface RebuildScope {
  bookingId?: string | undefined;
  projectId?: string | undefined;
  all?: boolean | undefined;
}

/** Bookings (id + number) in scope for the caller; 404 for a booking/project outside the user's project scope. */
export async function bookingsInScope(
  db: Executor,
  user: Pick<StaffContext, "companyId" | "allProjects" | "projectIds">,
  scope: RebuildScope,
): Promise<{ id: string; bookingNumber: string }[]> {
  const where: (SQL | undefined)[] = [eq(bookings.companyId, user.companyId)];
  if (scope.bookingId) {
    const [b] = await db
      .select({ id: bookings.id, bookingNumber: bookings.bookingNumber, projectId: bookings.projectId })
      .from(bookings)
      .where(and(eq(bookings.id, scope.bookingId), eq(bookings.companyId, user.companyId)))
      .limit(1);
    if (!b) throw ApiError.notFound("Booking");
    ensureProjectAccess(user, b.projectId, "Booking");
    return [{ id: b.id, bookingNumber: b.bookingNumber }];
  }
  if (scope.projectId) {
    ensureProjectAccess(user, scope.projectId);
    where.push(eq(bookings.projectId, scope.projectId));
  } else {
    where.push(scopeFilter(user, bookings.projectId));
  }
  return db
    .select({ id: bookings.id, bookingNumber: bookings.bookingNumber })
    .from(bookings)
    .where(and(...where.filter((w): w is SQL => w !== undefined)))
    .orderBy(bookings.bookingNumber);
}

/** Dry run: derives every booking's ledger again and reports where the stored summary/ledger disagree. Nothing is written. */
export async function reconcileBookings(
  db: Executor,
  targets: readonly { id: string; bookingNumber: string }[],
): Promise<AdminReconcileResponse> {
  const mismatches: AdminRecomputeMismatch[] = [];
  const affected = new Set<string>();
  for (const b of targets) {
    // one consistent snapshot per booking (REPEATABLE READ, read only): a payment committing midway cannot fake a mismatch
    const r = await onSnapshot(db, (tx) => rebuild(tx, b.id, { write: false }));
    for (const m of r.mismatches) {
      affected.add(b.id);
      mismatches.push({
        booking_id: b.id,
        booking_number: b.bookingNumber,
        field: m.field,
        stored: m.stored,
        recomputed: m.recomputed,
      });
    }
  }
  return { bookings_checked: targets.length, bookings_with_mismatches: affected.size, mismatches };
}

/** Rebuilds summary + ledger of each booking from its source rows (one transaction per booking, under the booking lock). */
export async function recomputeBookings(
  db: DB,
  targets: readonly { id: string; bookingNumber: string }[],
): Promise<AdminRecomputeResponse> {
  const mismatches: AdminRecomputeMismatch[] = [];
  let rows = 0;
  for (const b of targets) {
    const r = await db.transaction((tx) => rebuild(tx, b.id, { write: true }));
    rows += r.rows.length;
    for (const m of r.mismatches)
      mismatches.push({
        booking_id: b.id,
        booking_number: b.bookingNumber,
        field: m.field,
        stored: m.stored,
        recomputed: m.recomputed,
      });
  }
  return { bookings_rebuilt: targets.length, ledger_rows_rewritten: rows, mismatches_found: mismatches };
}

/**
 * Startup/nightly reconciliation job body: a dry run over every booking, per company. The result keeps each company's findings (booking
 * numbers, money mismatches) under `by_company[<company id>]`, so a tenant admin reading job_runs sees only their own (companyJobResult);
 * the top level holds only the number of companies.
 */
export async function reconciliationJob(db: DB): Promise<Record<string, unknown>> {
  const list = await db.select({ id: companies.id }).from(companies).orderBy(companies.createdAt);
  const byCompany: Record<string, Record<string, unknown>> = {};
  for (const c of list) {
    const targets = await db
      .select({ id: bookings.id, bookingNumber: bookings.bookingNumber })
      .from(bookings)
      .where(eq(bookings.companyId, c.id))
      .orderBy(bookings.bookingNumber);
    const r = await reconcileBookings(db, targets);
    byCompany[c.id] = {
      bookings_checked: r.bookings_checked,
      bookings_with_mismatches: r.bookings_with_mismatches,
      mismatches: r.mismatches.slice(0, 100),
    };
  }
  return { companies: list.length, by_company: byCompany };
}

// ---------------------------------------------------------------------------
// Reseed
// ---------------------------------------------------------------------------

/** Shape the seed module exports as `reseed(db, { app })` (the app drives the seed through its own API in-process). */
type ReseedFn = (
  db: DB,
  opts?: { app?: FastifyInstance },
) => Promise<{ counts?: Record<string, number>; integrity?: IntegrityReportResponse }>;

/**
 * Resolves `reseed(db)` from the seed module (apps/api/src/seed/run.ts) when it exports it; null otherwise. The import is static so the
 * bundle resolves it; run.ts guards its CLI `main()` behind an argv check, so importing it never executes the seed as a side effect.
 */
export async function loadReseed(): Promise<ReseedFn | null> {
  const mod = (await import("../../seed/run.js")) as Record<string, unknown>;
  return typeof mod["reseed"] === "function" ? (mod["reseed"] as ReseedFn) : null;
}

// ---------------------------------------------------------------------------
// System facts
// ---------------------------------------------------------------------------

function parseInfo(info: string, key: string): string | null {
  const m = info.match(new RegExp(`^${key}:(.*)$`, "m"));
  return m?.[1]?.trim() ?? null;
}

/** Versions, database size, table row estimates, Redis memory, job health (job results reduced to `companyId`'s view). */
export async function systemFacts(app: FastifyInstance, companyId: string): Promise<AdminSystemResponse> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [pg, dbInfo, tables, runs, runStats, redisServer, redisMemory, redisClients] = await Promise.all([
    app.db
      .execute<{ v: string }>(sql`select version() as v`)
      .then((r) => r[0]?.v ?? null)
      .catch(() => null),
    app.db
      .execute<{ name: string; size: string | number; pretty: string }>(
        sql`select current_database() as name, pg_database_size(current_database()) as size, pg_size_pretty(pg_database_size(current_database())) as pretty`,
      )
      .then((r) => r[0] ?? null)
      .catch(() => null),
    app.db
      .execute<{ relname: string; n: string | number }>(
        sql`select relname, n_live_tup as n from pg_stat_user_tables where schemaname = 'public' order by relname`,
      )
      .catch(() => [] as { relname: string; n: string | number }[]),
    app.db
      .execute<JobRunRecord & { started_at: Date; finished_at: Date | null; job_name: string }>(
        sql`select distinct on (job_name) id, job_name, started_at, finished_at, status, result, error from job_runs order by job_name, started_at desc`,
      )
      .catch(() => []),
    app.db
      .select({
        total: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${jobRuns.status} in ('FAILED', 'ABANDONED'))::int`,
      })
      .from(jobRuns)
      .where(gte(jobRuns.startedAt, since))
      .then((r) => r[0] ?? { total: 0, failed: 0 }),
    app.redis.info("server").catch(() => ""),
    app.redis.info("memory").catch(() => ""),
    app.redis.info("clients").catch(() => ""),
  ]);
  const estimated: Record<string, number> = {};
  for (const t of tables) estimated[t.relname] = Math.max(0, Number(t.n));
  const used = parseInfo(redisMemory, "used_memory");
  const clients = parseInfo(redisClients, "connected_clients");
  return {
    app_version: config.APP_VERSION,
    node_version: process.version,
    postgres_version: pg,
    redis_version: parseInfo(redisServer, "redis_version"),
    uptime_seconds: Math.round(process.uptime()),
    started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    modules: [...CORE_MODULES, ...selectModules(discoverModules())],
    database: {
      name: dbInfo?.name ?? null,
      size_bytes: dbInfo ? Number(dbInfo.size) : null,
      size_pretty: dbInfo?.pretty ?? null,
      table_count: tables.length,
      table_rows_estimated: estimated,
    },
    redis: { used_memory_bytes: used ? Number(used) : null, connected_clients: clients ? Number(clients) : null },
    jobs: {
      registered: registeredJobs(),
      runs_last_24h: Number(runStats.total),
      failed_last_24h: Number(runStats.failed),
      last_runs: (
        runs as unknown as {
          id: string;
          job_name: string;
          started_at: Date;
          finished_at: Date | null;
          status: JobRunRecord["status"];
          result: JobRunRecord["result"];
          error: string | null;
        }[]
      ).map((r) => ({
        id: r.id,
        job_name: r.job_name,
        started_at: new Date(r.started_at).toISOString(),
        finished_at: iso(r.finished_at),
        status: r.status,
        result: companyJobResult(r.result ?? null, companyId),
        error: r.error,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Bounded wait for a queue read (BullMQ's connection waits for Redis indefinitely). */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** BullMQ deduplication id of manual "run now" requests: one pending/running manual run per job name (retries included). */
export const manualDedupeId = (name: string) => `manual:${name}`;

/** Per-job statistics for GET /admin/jobs. */
type JobStats = { job_name: string; failures_24h: number; failures_since_success: number };

/**
 * Monthly partition maintenance (packages/db/partitions): creates the next months' partitions of audit_logs, ledger_entries,
 * login_events and notifications through `kkt_create_next_partitions()`. Registered always, scheduled and active only with
 * PARTITIONING_ENABLED=true (the partitioning scripts are opt-in at ~50 M rows).
 */
export async function partitionMaintenance(db: DB, monthsAhead = 2): Promise<Record<string, unknown>> {
  if (!partitioningEnabled()) return { skipped: true, reason: "PARTITIONING_ENABLED is not true" };
  const rows = await db.execute<{ created: string }>(sql`select kkt_create_next_partitions(${monthsAhead}) as created`);
  const created = rows.map((r) => r.created).filter(Boolean);
  return { created, months_ahead: monthsAhead };
}

/** Registers the admin job and the /admin/* tool routes. */
export function registerToolRoutes(app: FastifyInstance): void {
  registerJob("STARTUP_RECONCILIATION", async ({ db }) => reconciliationJob(db));
  registerJob("JOB_RUN_SWEEP", async ({ db }) => sweepAbandonedJobRuns(db));
  registerJob("PARTITION_MAINTENANCE", async ({ db, data }) =>
    partitionMaintenance(db, typeof data["months_ahead"] === "number" ? data["months_ahead"] : 2),
  );

  route(app, {
    method: "POST",
    url: "/admin/recompute",
    permission: "admin.tools",
    schema: {
      body: AdminRecomputeRequestSchema,
      response: { 200: AdminRecomputeResponseSchema },
      summary:
        "Rebuild booking summaries + ledgers from source records (booking, project or all); reports the mismatches that were fixed",
      tags: ["admin"],
    },
    handler: async (req) => {
      const user = staff(req);
      const targets = await bookingsInScope(app.db, user, {
        bookingId: req.body.booking_id,
        projectId: req.body.project_id,
        all: req.body.all,
      });
      const result = await recomputeBookings(app.db, targets);
      const meta = adminMeta(req);
      await app.db.transaction(async (tx) => {
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: meta.actor,
          ip: meta.ip,
          requestId: meta.requestId,
          action: "admin.recompute",
          entityType: "booking",
          entityId: req.body.booking_id ?? null,
          after: {
            scope: req.body,
            bookings_rebuilt: result.bookings_rebuilt,
            ledger_rows_rewritten: result.ledger_rows_rewritten,
            mismatches_fixed: result.mismatches_found.length,
            mismatches: result.mismatches_found.slice(0, 50),
          },
        });
      });
      return result;
    },
  });

  route(app, {
    method: "POST",
    url: "/admin/reconcile",
    permission: "admin.tools",
    schema: {
      body: AdminReconcileRequestSchema,
      response: { 200: AdminReconcileResponseSchema },
      summary: "Dry run of recompute: report summary/ledger mismatches without writing",
      tags: ["admin"],
    },
    handler: async (req) => {
      const user = staff(req);
      const targets = await bookingsInScope(app.dbReplica, user, {
        bookingId: req.body.booking_id,
        projectId: req.body.project_id,
        all: req.body.all,
      });
      return reconcileBookings(app.dbReplica, targets);
    },
  });

  route(app, {
    method: "GET",
    url: "/admin/jobs",
    permission: "admin.tools",
    schema: {
      response: { 200: AdminJobsResponseSchema },
      summary:
        "Every job: handler presence, schedule, next run, last run, last success, failure counts; recent runs and related links",
      tags: ["admin"],
    },
    handler: async (req) => {
      const companyId = staff(req).companyId;
      const recent = await app.dbReplica.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(25);
      const names = [...JOB_NAMES];
      type LastRow = {
        id: string;
        job_name: string;
        started_at: Date;
        finished_at: Date | null;
        status: JobRunRecord["status"];
        result: JobRunRecord["result"];
        error: string | null;
      };
      const toRow = (r: LastRow) => ({
        id: r.id,
        job_name: r.job_name,
        started_at: new Date(r.started_at).toISOString(),
        finished_at: iso(r.finished_at),
        status: r.status,
        result: companyJobResult(r.result ?? null, companyId),
        error: r.error,
      });
      const [last, lastOk, stats, next] = await Promise.all([
        app.dbReplica.execute<LastRow>(
          sql`select distinct on (job_name) id, job_name, started_at, finished_at, status, result, error from job_runs where job_name in ${names} order by job_name, started_at desc`,
        ),
        app.dbReplica.execute<LastRow>(
          sql`select distinct on (job_name) id, job_name, started_at, finished_at, status, result, error from job_runs where job_name in ${names} and status = 'OK' order by job_name, started_at desc`,
        ),
        app.dbReplica.execute<JobStats>(sql`
          with last_ok as (select job_name, max(started_at) as at from job_runs where status = 'OK' and job_name in ${names} group by job_name)
          select r.job_name,
                 count(*) filter (where r.status in ('FAILED', 'ABANDONED') and r.started_at >= now() - interval '24 hours')::int as failures_24h,
                 count(*) filter (where r.status in ('FAILED', 'ABANDONED') and r.started_at > coalesce(l.at, '-infinity'::timestamptz))::int as failures_since_success
          from job_runs r left join last_ok l on l.job_name = r.job_name
          where r.job_name in ${names} group by r.job_name`),
        withTimeout(nextRuns(app.jobQueue()), 1_500, new Map<string, string>()),
      ]);
      const lastBy = new Map(last.map((r) => [r.job_name, toRow(r)]));
      const okBy = new Map(lastOk.map((r) => [r.job_name, toRow(r)]));
      const statsBy = new Map(stats.map((r) => [r.job_name, r]));
      const registered = new Set(registeredJobs());
      const jobs: AdminJobInfo[] = names.map((name) => {
        const s = JOB_SCHEDULES.find((x) => x.name === name);
        const st = statsBy.get(name);
        const enabled = s ? (s.enabled ? s.enabled() : true) : false;
        return {
          name,
          registered: registered.has(name),
          cron: s?.cron ?? null,
          tz: s?.tz ?? null,
          schedule_enabled: enabled,
          last_run: lastBy.get(name) ?? null,
          last_success: okBy.get(name) ?? null,
          failure_count_24h: Number(st?.failures_24h ?? 0),
          failures_since_success: Number(st?.failures_since_success ?? 0),
          next_run_at: enabled ? (next.get(name) ?? null) : null,
        };
      });
      return {
        jobs,
        recent_runs: recent.map((r) => toJobRunRow(r, companyId)),
        links: {
          run_dues_now: "/api/v1/dues/run",
          integrity_report: "/api/v1/dues/integrity",
          integrity_repair: "/api/v1/dues/integrity/repair",
          recompute: "/api/v1/admin/recompute",
          reconcile: "/api/v1/admin/reconcile",
          backups: "/api/v1/admin/backups",
          exports: "/api/v1/exports",
        },
      };
    },
  });

  const jobRunCsv = ["started_at", "job_name", "status", "finished_at", "error"].map((k) => ({ key: k, header: k }));
  route(app, {
    method: "GET",
    url: "/admin/jobs/runs",
    permission: "admin.tools",
    schema: {
      querystring: AdminJobRunFilterSchema,
      response: { 200: AdminJobRunListResponseSchema },
      summary: "Job run history (filter by job_name/status; csv)",
      tags: ["admin"],
    },
    handler: async (req, reply) => {
      const q = req.query;
      const where: (SQL | undefined)[] = [];
      if (q.job_name) where.push(eq(jobRuns.jobName, q.job_name));
      if (q.status) where.push(eq(jobRuns.status, q.status));
      const r = await paginate<JobRunRecord>(app.dbReplica, {
        table: jobRuns,
        where: where.length ? and(...where.filter((w): w is SQL => w !== undefined)) : undefined,
        search: { columns: [jobRuns.jobName, jobRuns.error], term: q.search },
        sort: {
          allowed: {
            started_at: jobRuns.startedAt,
            job_name: jobRuns.jobName,
            status: jobRuns.status,
            finished_at: jobRuns.finishedAt,
          },
          default: "-started_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const companyId = staff(req).companyId;
      const items = r.items.map((x) => toJobRunRow(x, companyId));
      if (q.format === "csv")
        return sendCsv(reply, "job-runs.csv", jobRunCsv, items as unknown as Record<string, unknown>[]);
      return { ...r, items };
    },
  });

  route(app, {
    method: "GET",
    url: "/admin/jobs/runs/:id",
    permission: "admin.tools",
    schema: {
      params: idParams,
      response: { 200: AdminJobRunRowSchema },
      summary: "One job run (404 while the enqueued job has not started yet)",
      tags: ["admin"],
    },
    handler: async (req) => {
      const [row] = await app.db.select().from(jobRuns).where(eq(jobRuns.id, req.params.id)).limit(1);
      if (!row) throw ApiError.notFound("Job run");
      return toJobRunRow(row, staff(req).companyId);
    },
  });

  route(app, {
    method: "POST",
    url: "/admin/jobs/:name/run",
    permission: "admin.tools",
    schema: {
      params: AdminJobNameParamsSchema,
      body: AdminJobRunNowRequestSchema.optional(),
      response: { 202: AdminJobEnqueuedResponseSchema },
      summary:
        "Enqueue a registered job now (runs on the worker with the normal retry policy); returns the run id to poll",
      tags: ["admin"],
    },
    handler: async (req, reply) => {
      const user = staff(req);
      const name: JobName = req.params.name;
      if (!registeredJobs().includes(name))
        throw ApiError.rule(`Job ${name} has no handler registered in this process`, "JOB_NOT_REGISTERED", {
          registered: registeredJobs(),
        });
      const queue = app.jobQueue();
      const data = req.body?.data ?? {};
      // one manual run per job at a time: the dedupe id makes the add atomic in Redis (parallel clicks cannot both enqueue)
      const queued = await withTimeout(
        enqueueJob(queue, name, { ...data, __manual: user.id }, { dedupeId: manualDedupeId(name) }),
        5_000,
        null,
      );
      if (!queued) throw ApiError.unavailable("The job queue (Redis) is not reachable; retry shortly");
      if (queued.deduplicated)
        throw ApiError.conflict("JOB_ALREADY_RUNNING", `Job ${name} is already queued or running`, {
          run_id: queued.runId,
        });
      const meta = adminMeta(req);
      await app.db.transaction(async (tx) => {
        await writeAudit(tx, {
          companyId: user.companyId,
          actor: meta.actor,
          ip: meta.ip,
          requestId: meta.requestId,
          action: "job.enqueue",
          entityType: "job_run",
          entityId: queued.runId,
          after: { job_name: name, data },
        });
      });
      return reply.status(202).send({
        run_id: queued.runId,
        job_id: queued.jobId,
        job_name: name,
        status: "QUEUED" as const,
        queued_at: queued.queuedAt,
      });
    },
  });

  route(app, {
    method: "GET",
    url: "/admin/system",
    permission: "admin.tools",
    schema: {
      response: { 200: AdminSystemResponseSchema },
      summary: "Versions, database size and row estimates, Redis memory, loaded modules, job health",
      tags: ["admin"],
    },
    handler: async (req) => systemFacts(app, staff(req).companyId),
  });

  route(app, {
    method: "POST",
    url: "/admin/reseed",
    permission: "admin.tools",
    idempotent: true,
    schema: {
      body: AdminReseedRequestSchema,
      response: { 200: AdminReseedResponseSchema },
      summary:
        "Guarded reseed (Super Admin, never in production): restores the demo state through seed/run.ts reseed(db); 501 until the seed module ships it",
      tags: ["admin"],
    },
    handler: async (req) => {
      const user = staff(req);
      requireSuperAdmin(user);
      if (config.NODE_ENV === "production")
        throw ApiError.rule("Reseed is disabled when NODE_ENV=production", "RESEED_DISABLED");
      const reseed = await loadReseed();
      if (!reseed)
        throw new ApiError(
          501,
          "NOT_IMPLEMENTED",
          "Reseed is not available in this build: apps/api/src/seed/run.ts does not export reseed(db) yet (the demo seed module is pending)",
        );
      const startedAt = new Date();
      const result = await reseed(app.db, { app });
      const finishedAt = new Date();
      // Everything cached about the old rows is stale now.
      await invalidate(app.redis, "company:");
      await invalidate(app.redis, "perm:");
      await bumpPermVersion(app.redis); // a reseed replaces every subject: the global generation, not per-subject versions
      const [company] = await app.db.select({ id: companies.id }).from(companies).limit(1);
      const companyId = company?.id ?? user.companyId;
      const integrity: IntegrityReportResponse =
        result.integrity ??
        (await (async () => {
          const { runReport } = await import("../money/index.js");
          return (await runReport(app.db, { companyId }, { triggeredBy: user.id, persist: false })).report;
        })());
      const meta = adminMeta(req);
      await app.db.transaction(async (tx) => {
        await writeAudit(tx, {
          companyId,
          actor: meta.actor,
          ip: meta.ip,
          requestId: meta.requestId,
          action: "admin.reseed",
          entityType: "company",
          entityId: companyId,
          after: {
            started_at: startedAt.toISOString(),
            finished_at: finishedAt.toISOString(),
            counts: result.counts ?? {},
            integrity_ok: integrity.ok,
          },
        });
      });
      const response: AdminReseedResponse = {
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        counts: result.counts ?? {},
        integrity,
      };
      return response;
    },
  });
}
