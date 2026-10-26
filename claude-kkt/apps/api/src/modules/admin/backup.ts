/**
 * Full backup export (SPEC §2 "Super Admin can download a full backup export"; audit B9). `POST /admin/backup` records a backup row (the
 * `exports` table, path `admin:backup`) and enqueues job BACKUP_EXPORT. The job reads every table inside ONE repeatable-read snapshot
 * through a server-side cursor (batches of 5,000, no row cap) and streams it as NDJSON (`tables/<name>.ndjson`, one `row_to_json` object
 * per line: exact Postgres values — microsecond timestamps, numerics, arrays, jsonb) into a ZIP (archiver) written to a temp file and then
 * to storage. `manifest.json` carries row counts, the schema version (applied migrations), a sha256 per file, the FK load order and the
 * stripped columns; `RESTORE.md` explains the restore CLI (`pnpm --filter @kkt/api restore`, modules/admin/restore.ts).
 * Rows are scoped to the caller's tenant (company_id, the company row itself, or the parent row's company for child tables without
 * company_id). Encrypted/hashed columns (*_enc, password_hash, mfa_*, token_hash, pan/aadhaar hashes, idempotency response bodies) are
 * stripped unless the caller asks for `include_sensitive` (a full disaster-recovery backup needs them).
 */
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { ZipArchive } from "archiver";
import { and, desc, eq, exists, getTableColumns, getTableName, inArray, is, isNull, or, sql, type SQL } from "drizzle-orm";
import { PgDialect, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  AdminBackupLinkResponseSchema, AdminBackupListResponseSchema, AdminBackupQueuedResponseSchema, AdminBackupRequestSchema, type AdminBackupRow,
} from "@kkt/contracts";
import { exports as exportsTable, schema, type DB, type Executor } from "@kkt/db";
import { config } from "../../config.js";
import { registerJob, type JobContext } from "../../jobs/index.js";
import { enqueueJobWithin } from "../../jobs/queue.js";
import { writeAudit } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { documentStorage, fileTokenKey, signFileToken, storeFile, verifyFileToken, withTempDir } from "../documents/index.js";
import { notify } from "../notifications/index.js";
import { adminMeta, idParams, requireSuperAdmin, staff } from "./common.js";

/** How long a stored backup stays downloadable (EXPORT_CLEANUP removes it afterwards). */
export const BACKUP_TTL_SECONDS = 24 * 3600;
/** Lifetime of one signed download link. */
export const BACKUP_LINK_TTL_SECONDS = 15 * 60;
/** Archive format tag written to manifest.json (2 = NDJSON per table, sha256 per file, FK load order). */
export const BACKUP_FORMAT = "kkt-backup/2";
/** Rows fetched per cursor batch while streaming a table into the archive. */
export const BACKUP_BATCH_SIZE = 5_000;
/** `exports.path` of backup rows. */
export const BACKUP_PATH = "admin:backup";

/** Columns never exported without `include_sensitive` (regex on the SQL column name): ciphertexts, password/MFA material, token hashes, keyed PII hashes. */
const SENSITIVE_COLUMN = /_enc$|^password_hash$|^mfa_|token_hash|^(pan|aadhaar)_hash$/;
/** Table-specific extras: stored idempotent responses may echo one-time secrets (temporary passwords). */
const SENSITIVE_BY_TABLE: Record<string, readonly string[]> = { idempotency_keys: ["response_body"] };

/** True when a column must be stripped from a non-sensitive export. */
export function isSensitiveColumn(table: string, column: string): boolean {
  return SENSITIVE_COLUMN.test(column) || (SENSITIVE_BY_TABLE[table] ?? []).includes(column);
}

/** One exportable table. */
export interface BackupTable {
  name: string;
  table: PgTable;
  /** TS property → column. */
  columns: Record<string, PgColumn>;
}

/** Every pgTable exported by @kkt/db, by SQL name. */
export function backupTables(): BackupTable[] {
  const out: BackupTable[] = [];
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (!is(value, PgTable)) continue;
    out.push({ name: getTableName(value), table: value, columns: getTableColumns(value) as Record<string, PgColumn> });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** How a table was restricted to the tenant: by its company_id, by its parent row's company (child tables), or not at all (process-wide tables). */
export type BackupTableScope = "company" | "parent" | "global";

/** One table entry of the manifest. */
export interface BackupManifestTable {
  name: string;
  file: string;
  rows: number;
  bytes: number;
  sha256: string;
  scope: BackupTableScope;
  columns: string[];
  stripped_columns: string[];
}

/** Manifest written to the archive. */
export interface BackupManifest {
  format: string;
  generated_at: string;
  app_version: string;
  node_version: string;
  company: { id: string; name: string | null };
  include_sensitive: boolean;
  schema: { migrations_applied: number | null; latest_migration: string | null };
  table_count: number;
  row_count: number;
  batch_size: number;
  /** Tables parents-first (foreign keys), the order the restore CLI loads them in. */
  load_order: string[];
  tables: BackupManifestTable[];
  /** sha256 of RESTORE.md (manifest.json cannot carry its own). */
  files: Record<string, string>;
}

export const RESTORE_MD = `# Restoring a KKT backup

This archive was produced by \`POST /api/v1/admin/backup\` (job BACKUP_EXPORT). It holds one NDJSON file per table under \`tables/\`
(one JSON object per line, produced by PostgreSQL's \`row_to_json\`: snake_case column names, exact values — timestamps with
microseconds, money as integer paise, arrays and jsonb as JSON), \`manifest.json\` (row counts, schema version, sha256 of every file,
the foreign-key load order, stripped columns) and this file. Every table was read inside one repeatable-read snapshot, so the archive is
consistent across tables.

## With the restore CLI (recommended)

\`\`\`
pnpm --filter @kkt/api restore -- --file <backup.zip> --database-url postgres://user:pass@host:5432/<empty database> --confirm
\`\`\`

The CLI
1. verifies the sha256 of every file against \`manifest.json\` (a corrupt or edited archive is refused before anything is written);
2. runs the migrations of this application version on the target (it must be an EMPTY database; the CLI refuses a database that has rows);
3. loads the tables parents-first in foreign-key order (\`manifest.json → load_order\`, recomputed from the target's catalog) inside one
   transaction, using \`json_populate_recordset\` so PostgreSQL converts every value itself. No trigger has to be disabled: the
   append-only guards (audit_logs, payments, demands) block UPDATE/DELETE/TRUNCATE, never INSERT, and no foreign key is self-referencing;
4. checks the row count of every table against the manifest and runs the integrity report for every company — a clean restore reports
   zero findings.

## By hand

Load \`tables/*.ndjson\` in the order of \`manifest.json → load_order\` into a migrated empty database of the same application version
(\`manifest.json → app_version\`, \`schema.migrations_applied\`), e.g. per batch of lines:
\`INSERT INTO t (cols) SELECT cols FROM json_populate_recordset(NULL::t, '[line1,line2,…]')\`. Then run \`GET /api/v1/dues/integrity\`:
it must report zero findings.

## Stripped columns

A backup made without \`include_sensitive: true\` lacks password hashes, MFA secrets, encrypted PAN/Aadhaar/bank numbers and token
hashes (\`manifest.json → tables[].stripped_columns\`). The CLI refuses it unless \`--allow-stripped\` is given; then required secret columns
are filled with an unusable marker: staff and customers must reset their passwords and customers re-submit KYC. Encrypted values in a
sensitive backup are AES-GCM ciphertexts bound to FIELD_ENCRYPTION_KEYS: restore with the same keys.

## Files

Uploaded files (documents, photos) live in the object storage, not in this archive; restore the bucket/directory alongside.
`;

/** Child tables without company_id, scoped through their parent row: child column (TS property) → parent table name. */
const PARENT_SCOPE: Record<string, { column: string; parent: string }> = {
  lead_activities: { column: "leadId", parent: "leads" },
  lead_follow_ups: { column: "leadId", parent: "leads" },
  lead_stage_history: { column: "leadId", parent: "leads" },
  payment_plan_installments: { column: "planId", parent: "payment_plans" },
  project_amenities: { column: "projectId", parent: "projects" },
  project_team: { column: "projectId", parent: "projects" },
  project_visit_settings: { column: "projectId", parent: "projects" },
  project_website_settings: { column: "projectId", parent: "projects" },
  rate_card_plc_rules: { column: "rateCardId", parent: "rate_cards" },
  rate_card_rates: { column: "rateCardId", parent: "rate_cards" },
  service_request_messages: { column: "ticketId", parent: "service_requests" },
  user_project_scopes: { column: "userId", parent: "users" },
  booking_co_applicants: { column: "bookingId", parent: "bookings" },
};

function parentExists(db: Executor, child: BackupTable, column: string, parent: BackupTable, companyId: string): SQL {
  const childCol = child.columns[column];
  const parentId = parent.columns["id"];
  const parentCompany = parent.columns["companyId"];
  if (!childCol || !parentId || !parentCompany) throw new Error(`backup: cannot scope ${child.name} through ${parent.name}.${column}`);
  return exists(db.select({ one: sql`1` }).from(parent.table).where(and(eq(parentId, childCol), eq(parentCompany, companyId))));
}

/** Tenant restriction of one table (exported for tests). */
export function tableScope(db: Executor, t: BackupTable, companyId: string, byName: Map<string, BackupTable>): { where: SQL | undefined; scope: BackupTableScope } {
  const companyCol = t.columns["companyId"];
  if (companyCol) return { where: companyCol.notNull ? eq(companyCol, companyId) : or(eq(companyCol, companyId), isNull(companyCol)), scope: "company" };
  if (t.name === "companies") return { where: eq(t.columns["id"]!, companyId), scope: "company" };
  const via = PARENT_SCOPE[t.name];
  if (via) {
    const parent = byName.get(via.parent);
    if (!parent) throw new Error(`backup: parent table ${via.parent} missing`);
    return { where: parentExists(db, t, via.column, parent, companyId), scope: "parent" };
  }
  if (t.name === "password_history") {
    const users = byName.get("users"), portal = byName.get("portal_users");
    if (!users || !portal) throw new Error("backup: users/portal_users missing");
    const subject = t.columns["subjectId"]!;
    return {
      where: or(
        exists(db.select({ one: sql`1` }).from(users.table).where(and(eq(users.columns["id"]!, subject), eq(users.columns["companyId"]!, companyId)))),
        exists(db.select({ one: sql`1` }).from(portal.table).where(and(eq(portal.columns["id"]!, subject), eq(portal.columns["companyId"]!, companyId)))),
      ),
      scope: "parent",
    };
  }
  return { where: undefined, scope: "global" };
}

/** Stable order for the cursor: the primary key, or every sortable column (json has no ordering operator) for key-less junction tables. */
function orderColumns(t: BackupTable): PgColumn[] {
  const pk = Object.values(t.columns).filter((c) => c.primary);
  if (pk.length > 0) return pk;
  const sortable = Object.values(t.columns).filter((c) => c.dataType !== "json");
  return sortable.length > 0 ? sortable : Object.values(t.columns).slice(0, 1);
}

/**
 * Applied drizzle migrations (count + latest hash) — the schema version a restore must match. Unknown (nulls) when the journal does not
 * exist or the role may not read it (the DML-only application role kkt_app has no rights on schema `drizzle` unless the deployment grants
 * them). The privileges are checked first: a failing statement would abort the backup's surrounding transaction.
 */
export async function schemaVersion(pg: Sql): Promise<{ migrations_applied: number | null; latest_migration: string | null }> {
  try {
    const [probe] = await pg<{ ok: boolean }[]>`
      select coalesce((select has_schema_privilege(n.oid, 'USAGE') from pg_namespace n where n.nspname = 'drizzle'), false)
         and coalesce((select has_table_privilege(c.oid, 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'drizzle' and c.relname = '__drizzle_migrations'), false) as ok`;
    if (!probe?.ok) return { migrations_applied: null, latest_migration: null };
    const rows = await pg<{ n: number; latest: string | null }[]>`select count(*)::int as n, (select hash from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1) as latest from drizzle.__drizzle_migrations`;
    return { migrations_applied: rows[0] ? Number(rows[0].n) : null, latest_migration: rows[0]?.latest ?? null };
  } catch {
    return { migrations_applied: null, latest_migration: null };
  }
}

/** Public tables parents-first by foreign key (ties alphabetical); throws on a cycle. Self-references are ignored. */
export async function fkLoadOrder(pg: Sql): Promise<string[]> {
  const tables = (await pg<{ name: string }[]>`select tablename as name from pg_tables where schemaname = 'public' order by tablename`).map((r) => r.name);
  const edges = await pg<{ child: string; parent: string }[]>`
    select c.relname as child, p.relname as parent from pg_constraint k
    join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
    where k.contype = 'f' and k.connamespace = 'public'::regnamespace and c.oid <> p.oid`;
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const e of edges) deps.get(e.child)?.add(e.parent);
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...(deps.get(t) ?? [])].every((p) => done.has(p) || !deps.has(p)));
    if (ready.length === 0) throw new Error(`foreign-key cycle among ${tables.filter((t) => !done.has(t)).join(", ")}`);
    for (const t of ready) { done.add(t); order.push(t); }
  }
  return order;
}

/** The postgres.js client behind a Drizzle handle. */
export function pgClient(db: DB): Sql {
  const client = (db as unknown as { $client?: Sql }).$client;
  if (!client) throw new Error("backup: the Drizzle handle exposes no postgres.js client");
  return client;
}

/** Options of writeBackupArchive(). */
export interface WriteBackupOptions {
  companyId: string;
  companyName: string | null;
  includeSensitive: boolean;
  now?: Date;
  batchSize?: number;
}

/**
 * Streams the tenant's tables into a ZIP at `file`: NDJSON per table, read through a cursor in one repeatable-read read-only snapshot
 * (no statement/idle timeout for this transaction only), then manifest.json and RESTORE.md. Memory stays bounded by one batch.
 */
export async function writeBackupArchive(db: DB, file: string, opts: WriteBackupOptions): Promise<BackupManifest> {
  const now = opts.now ?? new Date();
  const batch = Math.max(1, Math.floor(opts.batchSize ?? BACKUP_BATCH_SIZE));
  const pg = pgClient(db);
  const dialect = new PgDialect();
  const all = backupTables();
  const byName = new Map(all.map((t) => [t.name, t]));
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const out = createWriteStream(file);
  const written = finished(out);
  let archiveError: Error | null = null;
  archive.on("error", (err) => { archiveError = err; });
  archive.on("warning", (err) => { archiveError = err; });
  archive.pipe(out);

  /** Adds one entry fed by `produce`, waiting until archiver has consumed it (one entry in flight → bounded memory). */
  const addEntry = async (name: string, produce: (write: (chunk: string) => Promise<void>) => Promise<void>): Promise<{ sha256: string; bytes: number }> => {
    const pass = new PassThrough();
    const consumed = once(archive, "entry");
    archive.append(pass, { name, date: now });
    const hash = createHash("sha256");
    let bytes = 0;
    const write = async (chunk: string) => {
      if (archiveError) throw archiveError;
      hash.update(chunk);
      bytes += Buffer.byteLength(chunk);
      if (!pass.write(chunk)) await once(pass, "drain");
    };
    await produce(write);
    pass.end();
    await consumed;
    if (archiveError) throw archiveError;
    return { sha256: hash.digest("hex"), bytes };
  };

  const tables: BackupManifestTable[] = [];
  let loadOrder: string[] = [];
  let version: BackupManifest["schema"] = { migrations_applied: null, latest_migration: null };
  await pg.begin("isolation level repeatable read read only", async (tx) => {
    await tx.unsafe("set local statement_timeout = 0");
    await tx.unsafe("set local idle_in_transaction_session_timeout = 0");
    version = await schemaVersion(tx as unknown as Sql);
    loadOrder = (await fkLoadOrder(tx as unknown as Sql)).filter((n) => byName.has(n));
    for (const t of all) {
      const { where, scope } = tableScope(db, t, opts.companyId, byName);
      const keep: string[] = [];
      const stripped: string[] = [];
      for (const col of Object.values(t.columns)) {
        if (!opts.includeSensitive && isSensitiveColumn(t.name, col.name)) stripped.push(col.name);
        else keep.push(col.name);
      }
      const cols = sql.join(keep.map((c) => sql.identifier(c)), sql`, `);
      const order = sql.join(orderColumns(t).map((c) => sql.identifier(c.name)), sql`, `);
      const inner = sql`select ${cols} from ${t.table}${where ? sql` where ${where}` : sql``} order by ${order}`;
      const q = dialect.sqlToQuery(sql`select row_to_json(x)::text as j from (${inner}) x`);
      const file = `tables/${t.name}.ndjson`;
      let rows = 0;
      const facts = await addEntry(file, async (write) => {
        for await (const chunk of tx.unsafe<{ j: string }[]>(q.sql, q.params as never[]).cursor(batch)) {
          rows += chunk.length;
          await write(`${chunk.map((r) => r.j).join("\n")}\n`);
        }
      });
      tables.push({ name: t.name, file, rows, bytes: facts.bytes, sha256: facts.sha256, scope, columns: keep, stripped_columns: stripped });
    }
  });
  const restoreFacts = await addEntry("RESTORE.md", async (write) => write(RESTORE_MD));
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, generated_at: now.toISOString(), app_version: config.APP_VERSION, node_version: process.version,
    company: { id: opts.companyId, name: opts.companyName }, include_sensitive: opts.includeSensitive, schema: version,
    table_count: tables.length, row_count: tables.reduce((s, t) => s + t.rows, 0), batch_size: batch, load_order: loadOrder, tables,
    files: { "RESTORE.md": restoreFacts.sha256 },
  };
  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: "manifest.json", date: now });
  await archive.finalize();
  await written;
  if (archiveError) throw archiveError;
  return manifest;
}

/** sha256 of a file on disk. */
async function fileSha256(path: string): Promise<string> {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Backup rows (exports table, path admin:backup) + links
// ---------------------------------------------------------------------------

type ExportRecord = typeof exportsTable.$inferSelect;

/** Request + job facts kept in `exports.query` of a backup row. */
interface BackupFacts {
  kind: "backup";
  include_sensitive: boolean;
  generated_by: string | null;
  run_id: string | null;
  file_name?: string;
  size_bytes?: number;
  table_count?: number;
  sha256?: string;
}

function facts(r: ExportRecord): BackupFacts {
  const q = (r.query ?? {}) as Partial<BackupFacts>;
  return { kind: "backup", include_sensitive: q.include_sensitive === true, generated_by: q.generated_by ?? null, run_id: q.run_id ?? null, ...q } as BackupFacts;
}

/** Wire row of a backup. */
export function toBackupRow(r: ExportRecord): AdminBackupRow {
  const f = facts(r);
  return {
    id: r.id, status: r.status, file_name: f.file_name ?? null, size_bytes: f.size_bytes ?? null, generated_at: r.createdAt.toISOString(),
    finished_at: r.finishedAt ? r.finishedAt.toISOString() : null, storage_expires_at: r.expiresAt ? r.expiresAt.toISOString() : null,
    include_sensitive: f.include_sensitive, table_count: f.table_count ?? null, row_count: r.rowCount, generated_by: f.generated_by, error: r.error, run_id: f.run_id,
  };
}

/** Key for the compact signed link tokens (derived from JWT_SECRET with its own context label). */
const linkKey = fileTokenKey("kkt-backup-link-v1", config.JWT_SECRET);

/** Signed token for a backup id (`exp` = unix seconds). */
export function signBackupToken(id: string, exp: number): string {
  return signFileToken(linkKey, id, exp);
}

/** Backup id of a valid, unexpired token; null when malformed, forged or expired. */
export function verifyBackupToken(token: string): string | null {
  return verifyFileToken(linkKey, token);
}

/** Signed download link for a stored backup (15 minutes). */
export function backupLink(s: Pick<AdminBackupRow, "id">): { download_url: string; expires_at: string } {
  const exp = Math.floor(Date.now() / 1000) + BACKUP_LINK_TTL_SECONDS;
  return { download_url: `${config.API_PUBLIC_URL}/api/v1/admin/backups/download/${signBackupToken(s.id, exp)}`, expires_at: new Date(exp * 1000).toISOString() };
}

function fileNameFor(now: Date, id: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  return `kkt-backup-${stamp}-${id.slice(0, 8)}.zip`;
}

/** Backups of a company, newest first (50). */
export async function listBackups(db: Executor, companyId: string): Promise<AdminBackupRow[]> {
  const rows = await db.select().from(exportsTable).where(and(eq(exportsTable.companyId, companyId), eq(exportsTable.path, BACKUP_PATH))).orderBy(desc(exportsTable.createdAt)).limit(50);
  return rows.map(toBackupRow);
}

/** A live (DONE, unexpired) backup row by id; null otherwise. */
export async function loadDoneBackup(db: Executor, id: string, companyId?: string): Promise<ExportRecord | null> {
  const [r] = await db.select().from(exportsTable).where(and(eq(exportsTable.id, id), eq(exportsTable.path, BACKUP_PATH), companyId ? eq(exportsTable.companyId, companyId) : undefined)).limit(1);
  if (!r || r.status !== "DONE" || !r.storageKey) return null;
  if (r.expiresAt && r.expiresAt.getTime() <= Date.now()) return null;
  return r;
}

/** BACKUP_EXPORT: builds the archive for the backup row in `data.backup_id`, stores it for 24 h and tells the requester. */
export async function runBackupJob(ctx: Pick<JobContext, "db" | "data" | "attempt" | "maxAttempts" | "runId">): Promise<Record<string, unknown>> {
  const id = String(ctx.data["backup_id"] ?? "");
  const [row] = await ctx.db.select().from(exportsTable).where(and(eq(exportsTable.id, id), eq(exportsTable.path, BACKUP_PATH))).limit(1);
  if (!row) return { skipped: true, reason: "backup not found" };
  if (row.status === "DONE") return { skipped: true, reason: "already done" };
  const f = facts(row);
  await ctx.db.update(exportsTable).set({ status: "RUNNING", error: null }).where(eq(exportsTable.id, row.id));
  try {
    const [company] = await ctx.db.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, row.companyId)).limit(1);
    const now = new Date();
    const fileName = fileNameFor(now, row.id);
    const key = `backups/${row.companyId}/${fileName}`;
    const built = await withTempDir("backup", async (dir) => {
      const file = join(dir, fileName);
      const manifest = await writeBackupArchive(ctx.db, file, { companyId: row.companyId, companyName: company?.name ?? null, includeSensitive: f.include_sensitive, now });
      const size = (await stat(file)).size;
      const sha256 = await fileSha256(file);
      await storeFile(documentStorage(), key, file, "application/zip");
      return { manifest, size, sha256 };
    });
    const done = new Date();
    const next: BackupFacts = { ...f, file_name: fileName, size_bytes: built.size, table_count: built.manifest.table_count, sha256: built.sha256 };
    await ctx.db.transaction(async (tx) => {
      await tx.update(exportsTable).set({ status: "DONE", storageKey: key, rowCount: built.manifest.row_count, finishedAt: done, expiresAt: new Date(done.getTime() + BACKUP_TTL_SECONDS * 1000), query: next as unknown as Record<string, never>, error: null }).where(eq(exportsTable.id, row.id));
      await notify(tx, { companyId: row.companyId, recipients: [{ type: "STAFF", id: row.userId }], type: "EXPORT_READY", title: `Backup ready: ${fileName}`, body: `${built.manifest.row_count} rows in ${built.manifest.table_count} tables`, entityType: "export", entityId: row.id, link: "/admin/backups" });
    });
    return { backup_id: row.id, file_name: fileName, size_bytes: built.size, row_count: built.manifest.row_count, table_count: built.manifest.table_count };
  } catch (err) {
    const final = ctx.attempt >= ctx.maxAttempts;
    await ctx.db.update(exportsTable).set({ status: final ? "FAILED" : "QUEUED", error: (err as Error).message.slice(0, 1000), ...(final ? { finishedAt: new Date(), expiresAt: new Date(Date.now() + BACKUP_TTL_SECONDS * 1000) } : {}) }).where(eq(exportsTable.id, row.id));
    throw err;
  }
}

/** Routes: POST /admin/backup, GET /admin/backups, POST /admin/backups/:id/link, GET /admin/backups/download/:token; job BACKUP_EXPORT. */
export function registerBackupRoutes(app: FastifyInstance): void {
  registerJob("BACKUP_EXPORT", async (ctx) => runBackupJob(ctx));

  route(app, {
    method: "POST", url: "/admin/backup", permission: "admin.tools", idempotent: true,
    schema: { body: AdminBackupRequestSchema, response: { 202: AdminBackupQueuedResponseSchema }, summary: "Queue a full backup export (Super Admin): job BACKUP_EXPORT streams every table into a ZIP (NDJSON + manifest + RESTORE.md); poll GET /admin/backups", tags: ["admin"] },
    handler: async (req, reply) => {
      const user = staff(req);
      requireSuperAdmin(user);
      // one backup per company at a time: each one streams every table in a long repeatable-read snapshot
      const [busy] = await app.db.select({ id: exportsTable.id }).from(exportsTable).where(and(
        eq(exportsTable.companyId, user.companyId), eq(exportsTable.path, BACKUP_PATH), inArray(exportsTable.status, ["QUEUED", "RUNNING"]),
        sql`${exportsTable.createdAt} > now() - interval '6 hours'`,
      )).limit(1);
      if (busy) throw ApiError.conflict("JOB_ALREADY_RUNNING", "A backup is already queued or running; wait for it to finish", { backup_id: busy.id });
      const id = randomUUID();
      const runId = randomUUID();
      const f: BackupFacts = { kind: "backup", include_sensitive: req.body.include_sensitive, generated_by: user.name, run_id: runId };
      const [row] = await app.db.insert(exportsTable).values({ id, companyId: user.companyId, userId: user.id, path: BACKUP_PATH, query: f as unknown as Record<string, never>, status: "QUEUED" }).returning();
      try {
        await enqueueJobWithin(app.jobQueue(), "BACKUP_EXPORT", { backup_id: id, company_id: user.companyId }, { runId });
      } catch (err) {
        await app.db.update(exportsTable).set({ status: "FAILED", error: "could not enqueue the backup job", finishedAt: new Date() }).where(eq(exportsTable.id, id));
        req.log.error({ err }, "backup: enqueue failed");
        throw ApiError.unavailable("The job queue is not reachable; retry shortly");
      }
      const meta = adminMeta(req);
      await app.db.transaction(async (tx) => {
        await writeAudit(tx, { companyId: user.companyId, actor: meta.actor, ip: meta.ip, requestId: meta.requestId, action: "backup.export", entityType: "company", entityId: user.companyId, after: { backup_id: id, include_sensitive: req.body.include_sensitive, run_id: runId, status: "QUEUED" } });
      });
      return reply.status(202).send(toBackupRow(row!));
    },
  });

  route(app, {
    method: "GET", url: "/admin/backups", permission: "admin.tools",
    schema: { response: { 200: AdminBackupListResponseSchema }, summary: "Backups of the company with their status (QUEUED/RUNNING/DONE/FAILED; files kept 24 h)", tags: ["admin"] },
    handler: async (req) => {
      const user = staff(req);
      requireSuperAdmin(user);
      return { items: await listBackups(app.db, user.companyId) };
    },
  });

  route(app, {
    method: "POST", url: "/admin/backups/:id/link", permission: "admin.tools",
    schema: { params: idParams, response: { 200: AdminBackupLinkResponseSchema }, summary: "Signed 15-minute download link of a finished backup (409 EXPORT_NOT_READY while queued/running/failed)", tags: ["admin"] },
    handler: async (req) => {
      const user = staff(req);
      requireSuperAdmin(user);
      const [r] = await app.db.select().from(exportsTable).where(and(eq(exportsTable.id, req.params.id), eq(exportsTable.path, BACKUP_PATH), eq(exportsTable.companyId, user.companyId))).limit(1);
      if (!r) throw ApiError.notFound("Backup");
      if (r.status !== "DONE") throw ApiError.conflict("EXPORT_NOT_READY", `Backup is ${r.status.toLowerCase()}`, { status: r.status });
      const live = await loadDoneBackup(app.db, r.id, user.companyId);
      if (!live) throw ApiError.notFound("Backup");
      const row = toBackupRow(live);
      const meta = adminMeta(req);
      await app.db.transaction(async (tx) => {
        await writeAudit(tx, { companyId: user.companyId, actor: meta.actor, ip: meta.ip, requestId: meta.requestId, action: "backup.link", entityType: "company", entityId: user.companyId, after: { backup_id: r.id } });
      });
      return { ...backupLink(row), file_name: row.file_name ?? "backup.zip", size_bytes: row.size_bytes };
    },
  });

  route(app, {
    method: "GET", url: "/admin/backups/download/:token", public: true,
    schema: { params: z.object({ token: z.string().min(1).max(100) }), response: { 200: z.any() }, summary: "Stream a backup through its signed 15-minute link (forged/expired → 404)", tags: ["admin"] },
    handler: async (req, reply) => {
      const id = verifyBackupToken(req.params.token);
      if (!id) throw ApiError.notFound("Backup");
      const r = await loadDoneBackup(app.db, id);
      if (!r?.storageKey) throw ApiError.notFound("Backup");
      const store = documentStorage();
      if (!(await store.exists(r.storageKey))) throw ApiError.notFound("Backup");
      const f = facts(r);
      const name = (f.file_name ?? "backup.zip").replace(/[^A-Za-z0-9._-]/g, "_");
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename="${name}"`);
      reply.header("Cache-Control", "no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      if (f.size_bytes !== undefined) reply.header("Content-Length", String(f.size_bytes));
      return reply.send(await store.stream(r.storageKey));
    },
  });
}
