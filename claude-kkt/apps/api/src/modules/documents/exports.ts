/**
 * Asynchronous CSV exports (audit F5 / ARCHITECTURE §6 "CSV > 10k rows never runs in a request"). `POST /exports {path, query}` accepts
 * any GET list route under /api/v1 the caller may read (checked against the route registry, the caller's permissions and a preflight
 * request with the caller's own token), stores an `exports` row and enqueues job EXPORT_CSV. The job runs the route in-process
 * (`app.inject`) as that user with a short-lived internal access token (aud erp), pages through ALL rows with keyset CSV pages
 * (`X-Export-Cursor` → `X-Export-Next-Cursor`, lib/list.ts), streams them into a temp file and stores it; the user gets an EXPORT_READY
 * bell. Files are downloadable for 7 days through a signed 15-minute link (`POST /exports/:id/link`); EXPORT_CLEANUP removes them.
 */
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { and, desc, eq, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ExportCreateRequestSchema, ExportFilterSchema, ExportLinkResponseSchema, ExportListResponseSchema, ExportRowSchema, IdSchema,
  type ExportRow,
} from "@kkt/contracts";
import { exports as exportsTable, roles, users, type DB } from "@kkt/db";
import { config } from "../../config.js";
import { registerJob, type JobContext } from "../../jobs/index.js";
import { enqueueJobWithin } from "../../jobs/queue.js";
import { actorFromRequest, auditMeta, writeAudit } from "../../lib/audit.js";
import { parseCsv } from "../../lib/csv.js";
import { ApiError } from "../../lib/errors.js";
import { signAccessToken } from "../../lib/jwt.js";
import { csvExportLimits, EXPORT_CURSOR_HEADER, fromListQuery, paginate } from "../../lib/list.js";
import { permissionAlternatives, route, type RegistryEntry } from "../../lib/routes.js";
import { notify } from "../notifications/index.js";
import { fileTokenKey, signFileToken, storeFile, verifyFileToken, withTempDir } from "./files.js";
import { storage } from "./service.js";

type ExportRecord = typeof exportsTable.$inferSelect;

/** Exported files stay downloadable this long. */
export const EXPORT_TTL_DAYS = 7;
/** Lifetime of one signed download link. */
export const EXPORT_LINK_TTL_SECONDS = 15 * 60;
/** Query keys the export job controls itself. */
export const RESERVED_EXPORT_KEYS = ["page", "page_size", "cursor", "limit", "format", "exact"] as const;
/** `exports.path` prefix of list exports (backups share the table with path `admin:backup`). */
const LIST_PATH_PREFIX = "/api/v1/";
/** Exports one user may have queued or running at a time (each one pages a whole list on the worker). */
export const MAX_ACTIVE_EXPORTS_PER_USER = 3;
/** Rows older than this no longer count as "in flight" (a lost queue entry must not block the user forever). */
const ACTIVE_EXPORT_WINDOW_HOURS = 24;

/** Exports of `userId` that are QUEUED or RUNNING (recent ones only). */
async function activeExports(db: DB, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(exportsTable).where(and(
    eq(exportsTable.userId, userId), like(exportsTable.path, `${LIST_PATH_PREFIX}%`), inArray(exportsTable.status, ["QUEUED", "RUNNING"]),
    sql`${exportsTable.createdAt} > now() - make_interval(hours => ${ACTIVE_EXPORT_WINDOW_HOURS})`,
  ));
  return Number(r?.n ?? 0);
}

/** Lifetime of the internal access token one export page is fetched with (a new one is minted when it runs low). */
const INTERNAL_TOKEN_MINUTES = 5;

const linkKey = fileTokenKey("kkt-export-link-v1", config.JWT_SECRET);
const idParams = z.object({ id: IdSchema });

/** File name of an export: last static path segment + date + short id. */
export function exportFileName(r: Pick<ExportRecord, "id" | "path" | "createdAt">): string {
  const segments = r.path.replace(/^\/api\/v1\//, "").split("/").filter((s) => s && !s.startsWith(":") && !/^[0-9a-f-]{36}$/i.test(s));
  const base = (segments.join("-") || "export").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);
  const stamp = r.createdAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `${base}-${stamp}-${r.id.slice(0, 8)}.csv`;
}

/** Wire row. */
export function toExportRow(r: ExportRecord): ExportRow {
  return {
    id: r.id, path: r.path, query: (r.query ?? {}) as Record<string, unknown>, status: r.status, row_count: r.rowCount, file_name: exportFileName(r),
    error: r.error, created_at: r.createdAt.toISOString(), finished_at: r.finishedAt ? r.finishedAt.toISOString() : null, expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
  };
}

/** Regex of a registered route url (`:param` matches one path segment). */
function routePattern(url: string): RegExp {
  const escaped = url.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
  return new RegExp(`^${escaped}$`);
}

/** The staff GET route a path resolves to (static routes win over parameterised ones), or null. */
export function resolveListRoute(registry: readonly RegistryEntry[], path: string): RegistryEntry | null {
  const candidates = registry.filter((r) => r.method === "GET" && r.audience === "erp" && !r.public && r.permission && r.url.startsWith(LIST_PATH_PREFIX) && routePattern(r.url).test(path));
  candidates.sort((a, b) => (a.url.match(/:/g)?.length ?? 0) - (b.url.match(/:/g)?.length ?? 0));
  return candidates[0] ?? null;
}

/** Builds `path?query` with the export's filters (arrays repeat the key). */
export function exportUrl(path: string, query: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) for (const item of v) qs.append(k, String(item));
    else if (v !== undefined && v !== null) qs.append(k, String(v));
  }
  for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** Mints the internal access token an export page is fetched with: the requesting user, audience erp, a throwaway session id. */
async function internalToken(db: DB, userId: string): Promise<string> {
  const [u] = await db.select({ id: users.id, companyId: users.companyId, isActive: users.isActive, roleActive: roles.isActive }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, userId)).limit(1);
  if (!u || !u.isActive || !u.roleActive) throw new Error("the user who requested the export is no longer active");
  return signAccessToken({ sub: u.id, aud: "erp", cid: u.companyId, sid: randomUUID(), mfa: true }, INTERNAL_TOKEN_MINUTES);
}

function header(h: Record<string, unknown>, name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : v === undefined ? undefined : String(v);
}

/** Text of an error response for the export's `error` column. */
function failureText(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
    if (parsed.error) return `${status} ${parsed.error.code ?? ""}: ${parsed.error.message ?? ""}`.trim();
  } catch { /* not JSON */ }
  return `${status}: ${body.slice(0, 300)}`;
}

/**
 * EXPORT_CSV: runs the list route page by page as the requesting user and stores the CSV. A failure on the last attempt marks the
 * export FAILED (earlier attempts put it back to QUEUED for the retry).
 */
export async function runCsvExport(ctx: Pick<JobContext, "db" | "app" | "data" | "attempt" | "maxAttempts">): Promise<Record<string, unknown>> {
  const exportId = String(ctx.data["export_id"] ?? "");
  const app = ctx.app;
  if (!app) throw new Error("EXPORT_CSV needs the built app (in-process route calls)");
  const [row] = await ctx.db.select().from(exportsTable).where(eq(exportsTable.id, exportId)).limit(1);
  if (!row) return { skipped: true, reason: "export not found" };
  if (row.status === "DONE") return { skipped: true, reason: "already done" };
  await ctx.db.update(exportsTable).set({ status: "RUNNING", error: null }).where(eq(exportsTable.id, row.id));
  try {
    const key = `exports/${row.companyId}/${row.id}.csv`;
    const counts = await withTempDir("export", async (dir) => {
      const file = join(dir, "export.csv");
      const out = createWriteStream(file);
      let rows = 0;
      let pages = 0;
      let token = await internalToken(ctx.db, row.userId);
      let tokenAt = Date.now();
      let cursor = "start";
      const query = (row.query ?? {}) as Record<string, unknown>;
      try {
        for (;;) {
          if (Date.now() - tokenAt > (INTERNAL_TOKEN_MINUTES - 1) * 60_000) { token = await internalToken(ctx.db, row.userId); tokenAt = Date.now(); }
          const res = await app.inject({ method: "GET", url: exportUrl(row.path, query, { format: "csv" }), headers: { authorization: `Bearer ${token}`, [EXPORT_CURSOR_HEADER]: cursor, "x-request-id": `export-${row.id.slice(0, 8)}-${pages}` } });
          if (res.statusCode !== 200) throw new Error(failureText(res.statusCode, res.body));
          if (!String(res.headers["content-type"] ?? "").startsWith("text/csv")) throw new Error(`${row.path} does not produce CSV (format=csv)`);
          let body = res.body;
          if (pages > 0) {
            const nl = body.indexOf("\r\n");
            body = nl === -1 ? "" : body.slice(nl + 2);
          }
          if (!out.write(body)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
          const pageRows = header(res.headers, "x-export-rows");
          const counted = pageRows !== undefined ? Number(pageRows) : Math.max(0, parseCsv(res.body).length - 1);
          rows += counted;
          pages += 1;
          const next = header(res.headers, "x-export-next-cursor");
          if (header(res.headers, "x-export-truncated") === "true") throw new Error(`${row.path} cannot page its CSV export; it stopped at its row cap`);
          // A route that reports no export facts (no paginate()/listPaging()) cannot keyset-page: a full cap's worth of rows means it may
          // have cut the list, so fail loudly instead of storing a silently truncated file.
          if (pageRows === undefined && !next && counted >= csvExportLimits.maxRows) throw new Error(`${row.path} cannot page its CSV export; it returned ${counted} rows without paging facts`);
          if (!next) break;
          cursor = next;
        }
      } finally {
        out.end();
        await finished(out);
      }
      await storeFile(storage(), key, file, "text/csv");
      return { rows, pages };
    });
    const now = new Date();
    await ctx.db.transaction(async (tx) => {
      await tx.update(exportsTable).set({ status: "DONE", rowCount: counts.rows, storageKey: key, finishedAt: now, expiresAt: new Date(now.getTime() + EXPORT_TTL_DAYS * 86_400_000), error: null }).where(eq(exportsTable.id, row.id));
      await notify(tx, { companyId: row.companyId, recipients: [{ type: "STAFF", id: row.userId }], type: "EXPORT_READY", title: `Export ready: ${exportFileName(row)}`, body: `${counts.rows} rows from ${row.path}`, entityType: "export", entityId: row.id, link: "/exports" });
    });
    return { export_id: row.id, rows: counts.rows, pages: counts.pages };
  } catch (err) {
    const final = ctx.attempt >= ctx.maxAttempts;
    await ctx.db.update(exportsTable).set({ status: final ? "FAILED" : "QUEUED", error: (err as Error).message.slice(0, 1000), ...(final ? { finishedAt: new Date(), expiresAt: new Date(Date.now() + EXPORT_TTL_DAYS * 86_400_000) } : {}) }).where(eq(exportsTable.id, row.id));
    throw err;
  }
}

/** EXPORT_CLEANUP: removes expired export/backup files and rows (anything past expires_at, or 7 days old when it never finished). */
export async function cleanupExports(db: DB, batch = 500): Promise<Record<string, unknown>> {
  let removed = 0;
  let fileErrors = 0;
  for (;;) {
    const due = await db.select().from(exportsTable)
      .where(lte(sql`coalesce(${exportsTable.expiresAt}, ${exportsTable.createdAt} + make_interval(days => ${EXPORT_TTL_DAYS}))`, sql`now()`)).limit(batch);
    if (due.length === 0) break;
    for (const r of due) {
      if (r.storageKey) {
        try { await storage().remove(r.storageKey); } catch { fileErrors += 1; }
      }
    }
    await db.delete(exportsTable).where(inArray(exportsTable.id, due.map((r) => r.id)));
    removed += due.length;
    if (due.length < batch) break;
  }
  return { removed, file_errors: fileErrors };
}

/** Signed download link of a finished export. */
export function exportLink(id: string): { download_url: string; expires_at: string } {
  const exp = Math.floor(Date.now() / 1000) + EXPORT_LINK_TTL_SECONDS;
  return { download_url: `${config.API_PUBLIC_URL}/api/v1/exports/download/${signFileToken(linkKey, id, exp)}`, expires_at: new Date(exp * 1000).toISOString() };
}

/** Routes: POST /exports, GET /exports, GET /exports/:id, POST /exports/:id/link, GET /exports/download/:token; jobs EXPORT_CSV + EXPORT_CLEANUP. */
export function registerExportRoutes(app: FastifyInstance): void {
  registerJob("EXPORT_CSV", async (ctx) => runCsvExport(ctx));
  registerJob("EXPORT_CLEANUP", async ({ db }) => cleanupExports(db));

  const ownExport = async (userId: string, id: string): Promise<ExportRecord> => {
    const [r] = await app.db.select().from(exportsTable).where(and(eq(exportsTable.id, id), eq(exportsTable.userId, userId), like(exportsTable.path, `${LIST_PATH_PREFIX}%`))).limit(1);
    if (!r) throw ApiError.notFound("Export");
    return r;
  };

  route(app, {
    method: "POST", url: "/exports", permission: "notification.read", idempotent: true,
    schema: { body: ExportCreateRequestSchema, response: { 202: ExportRowSchema }, summary: "Queue a full CSV export of any list route the caller may read (no 10,000-row cap); ready-bell when done", tags: ["exports"] },
    handler: async (req, reply) => {
      const user = req.user!;
      const path = req.body.path.replace(/\/+$/, "");
      const query = req.body.query;
      // a literal path only: dot segments are normalised away by the router (the registry match would describe another route) and
      // `:param` is route syntax, not a value
      if (path.split("/").some((seg) => seg === "." || seg === ".." || seg.includes(":"))) {
        throw ApiError.badRequest(`${path} is not a staff list route that can be exported`, { issues: [{ path: "path", message: "Dot segments and route parameters are not allowed" }] });
      }
      const reserved = Object.keys(query).filter((k) => (RESERVED_EXPORT_KEYS as readonly string[]).includes(k));
      if (reserved.length > 0) throw ApiError.badRequest(`query must not set ${reserved.join(", ")} (the export controls paging and format)`, { issues: reserved.map((k) => ({ path: `query.${k}`, message: "Reserved by the export" })) });
      const target = resolveListRoute(app.routeRegistry, path);
      if (!target || path.startsWith("/api/v1/exports")) throw ApiError.badRequest(`${path} is not a staff list route that can be exported`, { issues: [{ path: "path", message: "Unknown or non-exportable route" }] });
      const alternatives = permissionAlternatives(target.permission ?? "");
      if (!alternatives.some((p) => user.permissions.has(p))) throw ApiError.forbidden(`Missing permission ${alternatives.join(" or ")}`, { permission: alternatives[0], alternatives });
      if ((await activeExports(app.db, user.id)) >= MAX_ACTIVE_EXPORTS_PER_USER) {
        throw new ApiError(429, "RATE_LIMITED", `You already have ${MAX_ACTIVE_EXPORTS_PER_USER} exports in progress; wait for one to finish`, { retry_after: 60, limit: MAX_ACTIVE_EXPORTS_PER_USER }, { "Retry-After": "60" });
      }
      // Preflight with the caller's own token: filters are validated, scope is enforced and the route must answer a list envelope.
      const pre = await app.inject({ method: "GET", url: exportUrl(path, query), headers: { authorization: req.headers.authorization ?? "" } });
      if (pre.statusCode !== 200) {
        const parsed = (() => { try { return JSON.parse(pre.body) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }; } catch { return {}; } })();
        throw new ApiError(pre.statusCode >= 400 && pre.statusCode < 500 ? pre.statusCode : 400, parsed.error?.code ?? "VALIDATION_ERROR", parsed.error?.message ?? `${path} rejected the export query`, parsed.error?.details);
      }
      const preBody = (() => { try { return JSON.parse(pre.body) as { items?: unknown }; } catch { return {}; } })();
      if (!Array.isArray(preBody.items)) throw ApiError.badRequest(`${path} is not a list route (no items envelope)`, { issues: [{ path: "path", message: "Not a list route" }] });
      const [row] = await app.db.insert(exportsTable).values({ companyId: user.companyId, userId: user.id, path, query: query as Record<string, never>, status: "QUEUED" }).returning();
      try {
        await enqueueJobWithin(app.jobQueue(), "EXPORT_CSV", { export_id: row!.id, company_id: user.companyId });
      } catch (err) {
        await app.db.update(exportsTable).set({ status: "FAILED", error: "could not enqueue the export job", finishedAt: new Date() }).where(eq(exportsTable.id, row!.id));
        req.log.error({ err }, "export: enqueue failed");
        throw ApiError.unavailable("The job queue is not reachable; retry shortly");
      }
      await app.db.transaction(async (tx) => {
        await writeAudit(tx, { companyId: user.companyId, actor: actorFromRequest(req), action: "export.create", entityType: "export", entityId: row!.id, after: { path, query }, ...auditMeta(req) });
      });
      return reply.status(202).send(toExportRow(row!));
    },
  });

  route(app, {
    method: "GET", url: "/exports", permission: "notification.read",
    schema: { querystring: ExportFilterSchema, response: { 200: ExportListResponseSchema }, summary: "My exports (newest first)", tags: ["exports"] },
    handler: async (req) => {
      const q = req.query;
      const where: (SQL | undefined)[] = [eq(exportsTable.userId, req.user!.id), like(exportsTable.path, `${LIST_PATH_PREFIX}%`)];
      if (q.status) where.push(eq(exportsTable.status, q.status));
      const r = await paginate<ExportRecord>(app.dbReplica, {
        table: exportsTable,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: { columns: [exportsTable.path], term: q.search },
        sort: { allowed: { created_at: exportsTable.createdAt, status: exportsTable.status }, default: "-created_at", requested: q.sort },
        ...fromListQuery(q),
      });
      return { ...r, items: r.items.map(toExportRow) };
    },
  });

  route(app, {
    method: "GET", url: "/exports/:id", permission: "notification.read",
    schema: { params: idParams, response: { 200: ExportRowSchema }, summary: "One of my exports", tags: ["exports"] },
    handler: async (req) => toExportRow(await ownExport(req.user!.id, req.params.id)),
  });

  route(app, {
    method: "POST", url: "/exports/:id/link", permission: "notification.read",
    schema: { params: idParams, response: { 200: ExportLinkResponseSchema }, summary: "Signed 15-minute download link of a finished export (409 EXPORT_NOT_READY before)", tags: ["exports"] },
    handler: async (req) => {
      const r = await ownExport(req.user!.id, req.params.id);
      if (r.status !== "DONE" || !r.storageKey) throw ApiError.conflict("EXPORT_NOT_READY", `Export is ${r.status.toLowerCase()}`, { status: r.status });
      if (r.expiresAt && r.expiresAt.getTime() <= Date.now()) throw ApiError.notFound("Export");
      return { ...exportLink(r.id), file_name: exportFileName(r), row_count: r.rowCount ?? 0 };
    },
  });

  route(app, {
    method: "GET", url: "/exports/download/:token", public: true,
    schema: { params: z.object({ token: z.string().min(1).max(100) }), response: { 200: z.any() }, summary: "Stream an export through its signed 15-minute link (forged/expired → 404)", tags: ["exports"] },
    handler: async (req, reply) => {
      const id = verifyFileToken(linkKey, req.params.token);
      if (!id) throw ApiError.notFound("Export");
      const [r] = await app.db.select().from(exportsTable).where(and(eq(exportsTable.id, id), eq(exportsTable.status, "DONE"), or(sql`${exportsTable.expiresAt} is null`, sql`${exportsTable.expiresAt} > now()`))).orderBy(desc(exportsTable.createdAt)).limit(1);
      if (!r?.storageKey || !(await storage().exists(r.storageKey))) throw ApiError.notFound("Export");
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${exportFileName(r)}"`);
      reply.header("Cache-Control", "no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      return reply.send(await storage().stream(r.storageKey));
    },
  });
}
