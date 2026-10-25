/**
 * Full backup export (SPEC §2 "Super Admin can download a full backup export"): one JSON file per Drizzle table plus manifest.json and
 * RESTORE.md, zipped in memory (./zip.ts), stored under `backups/<company>/…` in the documents storage for 24 h and handed out through a
 * signed 15-minute link. Encrypted/hashed columns (*_enc, password_hash, mfa_*, token_hash, idempotency response bodies) are stripped
 * unless the caller asks for `include_sensitive`.
 */
import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName, is, isNull, or, eq, sql } from "drizzle-orm";
import { PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AdminBackupCreatedResponseSchema, AdminBackupListResponseSchema, AdminBackupRequestSchema, type AdminBackupCreatedResponse, type AdminBackupRow } from "@kkt/contracts";
import { schema, type Executor } from "@kkt/db";
import { config } from "../../config.js";
import { writeAudit } from "../../lib/audit.js";
import { signPayload, verifyPayload } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { route } from "../../lib/routes.js";
import { createStorage, type Storage } from "../../lib/storage.js";
import { adminMeta, requireSuperAdmin, staff } from "./common.js";
import { readCentralDirectory, ZipWriter } from "./zip.js";

/** How long a stored backup stays downloadable. */
export const BACKUP_TTL_SECONDS = 24 * 3600;
/** Lifetime of one signed download link. */
export const BACKUP_LINK_TTL_SECONDS = 15 * 60;
/** Archive format tag written to manifest.json. */
export const BACKUP_FORMAT = "kkt-backup/1";

/** Columns never exported without `include_sensitive` (regex on the SQL column name). */
const SENSITIVE_COLUMN = /_enc$|^password_hash$|^mfa_|token_hash/;
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

/** Every pgTable exported by @kkt/db, by SQL name (77 at the time of writing). */
export function backupTables(): BackupTable[] {
  const out: BackupTable[] = [];
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (!is(value, PgTable)) continue;
    out.push({ name: getTableName(value), table: value, columns: getTableColumns(value) as Record<string, PgColumn> });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Manifest written to the archive. */
export interface BackupManifest {
  format: string;
  generated_at: string;
  app_version: string;
  node_version: string;
  company: { id: string; name: string | null };
  include_sensitive: boolean;
  migrations_applied: number | null;
  table_count: number;
  row_count: number;
  tables: { name: string; file: string; rows: number; columns: string[]; stripped_columns: string[] }[];
}

/** Result of buildBackup(). */
export interface BuiltBackup {
  zip: Buffer;
  manifest: BackupManifest;
}

const RESTORE_MD = `# Restoring a KKT backup

This archive was produced by \`POST /api/v1/admin/backup\`. It contains one JSON array per table under \`tables/\` (snake_case column
names exactly as in PostgreSQL, timestamps as RFC 3339 UTC, money as integer paise) plus this file and \`manifest.json\`.

1. Provision an empty PostgreSQL 16 database and run the migrations of the same application version (\`manifest.json → app_version\`):
   \`pnpm --filter @kkt/db migrate\`.
2. Disable the append-only guards for the load only: \`SET session_replication_role = replica;\` (triggers on audit_logs, payments, demands).
3. Load the tables in dependency order — the order used in \`manifest.json → tables\` is alphabetical, so load parents first:
   companies, roles, users, masters (room_types, area_types, flat_types, …), documents, projects, blocks, flats, customers, leads,
   bookings, demands, payments, ledger_entries, then everything else. Any JSON loader works, e.g. \`jq -c '.[]'\` into \`COPY … FROM STDIN (FORMAT csv)\`
   after converting, or a small script using the same Drizzle schema (\`db.insert(table).values(rows)\`).
4. Columns stripped from a non-sensitive export (\`manifest.json → tables[].stripped_columns\`) are absent: password hashes, MFA secrets,
   encrypted PAN/Aadhaar/bank numbers and refresh-token hashes. Users must reset their passwords; customers must re-submit KYC.
   Only an export made with \`include_sensitive: true\` restores them verbatim (they are AES-GCM ciphertexts bound to FIELD_ENCRYPTION_KEY).
5. Re-enable the guards (\`RESET session_replication_role;\`), then run \`GET /api/v1/dues/integrity\`: it must report zero findings.
6. Uploaded files (documents, photos) live in the object storage, not in this archive; restore the storage bucket/directory alongside.
`;

/** Rows of one table as snake_case objects (Dates/bigints stay JSON-friendly; drizzle reads paise bigints as numbers). */
async function exportRows(db: Executor, t: BackupTable, companyId: string, includeSensitive: boolean): Promise<{ rows: Record<string, unknown>[]; columns: string[]; stripped: string[] }> {
  const companyCol = t.columns["companyId"];
  const base = db.select().from(t.table).$dynamic();
  // Tenant scope: rows of this company, plus rows that belong to no company (login attempts for unknown users, job runs).
  const rows = (await (companyCol ? base.where(companyCol.notNull ? eq(companyCol, companyId) : or(eq(companyCol, companyId), isNull(companyCol))) : base)) as Record<string, unknown>[];
  const keep: [string, string][] = [];
  const stripped: string[] = [];
  for (const [prop, col] of Object.entries(t.columns)) {
    if (!includeSensitive && isSensitiveColumn(t.name, col.name)) stripped.push(col.name);
    else keep.push([prop, col.name]);
  }
  const out = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [prop, name] of keep) o[name] = r[prop] ?? null;
    return o;
  });
  return { rows: out, columns: keep.map(([, n]) => n), stripped };
}

async function migrationsApplied(db: Executor): Promise<number | null> {
  try {
    const rows = await db.execute<{ n: number | string }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return rows[0] ? Number(rows[0].n) : null;
  } catch {
    return null;
  }
}

/** Builds the archive in memory for one company. Exported so a CLI/cron could produce backups without HTTP. */
export async function buildBackup(db: Executor, opts: { companyId: string; companyName: string | null; includeSensitive: boolean; now?: Date }): Promise<BuiltBackup> {
  const now = opts.now ?? new Date();
  const zip = new ZipWriter(now);
  const tables: BackupManifest["tables"] = [];
  let rowCount = 0;
  for (const t of backupTables()) {
    const { rows, columns, stripped } = await exportRows(db, t, opts.companyId, opts.includeSensitive);
    const file = `tables/${t.name}.json`;
    zip.file(file, rows.length === 0 ? "[]\n" : `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
    tables.push({ name: t.name, file, rows: rows.length, columns, stripped_columns: stripped });
    rowCount += rows.length;
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, generated_at: now.toISOString(), app_version: config.APP_VERSION, node_version: process.version,
    company: { id: opts.companyId, name: opts.companyName }, include_sensitive: opts.includeSensitive, migrations_applied: await migrationsApplied(db),
    table_count: tables.length, row_count: rowCount, tables,
  };
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  zip.file("RESTORE.md", RESTORE_MD);
  const bytes = zip.build();
  // Self-check: the central directory must read back with every entry (a corrupt archive must never be handed out).
  const entries = readCentralDirectory(bytes);
  if (entries.length !== zip.count) throw new Error("backup: archive self-check failed");
  return { zip: bytes, manifest };
}

// ---------------------------------------------------------------------------
// Storage + registry (Redis sorted set per company; score = generated_at ms)
// ---------------------------------------------------------------------------

let storageInstance: Storage | null = null;
function storage(): Storage {
  storageInstance ??= createStorage();
  return storageInstance;
}

interface StoredBackup {
  id: string;
  key: string;
  file_name: string;
  size_bytes: number;
  generated_at: string;
  include_sensitive: boolean;
  table_count: number;
  row_count: number;
  generated_by: string | null;
}

const registryKey = (companyId: string) => `backups:${companyId}`;

function toRow(s: StoredBackup): AdminBackupRow {
  return { id: s.id, file_name: s.file_name, size_bytes: s.size_bytes, generated_at: s.generated_at, storage_expires_at: new Date(new Date(s.generated_at).getTime() + BACKUP_TTL_SECONDS * 1000).toISOString(), include_sensitive: s.include_sensitive, table_count: s.table_count, row_count: s.row_count, generated_by: s.generated_by };
}

/** Removes expired archives (older than 24 h) from storage and the registry. */
async function prune(app: FastifyInstance, companyId: string, now = Date.now()): Promise<number> {
  const cutoff = now - BACKUP_TTL_SECONDS * 1000;
  const expired = await app.redis.zrangebyscore(registryKey(companyId), "-inf", `(${cutoff}`);
  for (const raw of expired) {
    try { await storage().remove((JSON.parse(raw) as StoredBackup).key); } catch (err) { app.log.warn({ err }, "backup: could not remove expired archive"); }
  }
  if (expired.length > 0) await app.redis.zremrangebyscore(registryKey(companyId), "-inf", `(${cutoff}`);
  return expired.length;
}

/** Recent backups of the company, newest first (expired ones pruned on the way). */
export async function listBackups(app: FastifyInstance, companyId: string): Promise<AdminBackupRow[]> {
  await prune(app, companyId);
  const raws = await app.redis.zrevrange(registryKey(companyId), 0, 49);
  return raws.map((r) => toRow(JSON.parse(r) as StoredBackup));
}

/** Signed download link for a stored backup (15 minutes). */
export function backupLink(s: Pick<StoredBackup, "key" | "file_name" | "generated_at">, companyId: string): { download_url: string; expires_at: string } {
  const token = signPayload({ k: s.key, n: s.file_name, g: new Date(s.generated_at).getTime(), c: companyId }, BACKUP_LINK_TTL_SECONDS);
  return { download_url: `${config.API_PUBLIC_URL}/api/v1/admin/backups/download/${token}`, expires_at: new Date(Date.now() + BACKUP_LINK_TTL_SECONDS * 1000).toISOString() };
}

function fileNameFor(now: Date, id: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  return `kkt-backup-${stamp}-${id.slice(0, 8)}.zip`;
}

/** Builds, stores (24 h) and registers a backup; returns the signed link. */
export async function createBackup(app: FastifyInstance, opts: { companyId: string; companyName: string | null; includeSensitive: boolean; generatedBy: string | null }): Promise<AdminBackupCreatedResponse & { key: string }> {
  const now = new Date();
  const id = randomUUID();
  const built = await buildBackup(app.db, { companyId: opts.companyId, companyName: opts.companyName, includeSensitive: opts.includeSensitive, now });
  const file_name = fileNameFor(now, id);
  const key = `backups/${opts.companyId}/${file_name}`;
  await storage().put(key, built.zip, "application/zip");
  const stored: StoredBackup = { id, key, file_name, size_bytes: built.zip.length, generated_at: now.toISOString(), include_sensitive: opts.includeSensitive, table_count: built.manifest.table_count, row_count: built.manifest.row_count, generated_by: opts.generatedBy };
  await prune(app, opts.companyId, now.getTime());
  await app.redis.zadd(registryKey(opts.companyId), now.getTime(), JSON.stringify(stored));
  await app.redis.expire(registryKey(opts.companyId), BACKUP_TTL_SECONDS * 2);
  const link = backupLink(stored, opts.companyId);
  return { ...link, key, file_name, size_bytes: stored.size_bytes, generated_at: stored.generated_at, id, storage_expires_at: toRow(stored).storage_expires_at, include_sensitive: stored.include_sensitive, table_count: stored.table_count, row_count: stored.row_count };
}

/** Routes: POST /admin/backup, GET /admin/backups, GET /admin/backups/download/:token. */
export function registerBackupRoutes(app: FastifyInstance): void {
  route(app, {
    method: "POST", url: "/admin/backup", permission: "admin.tools", idempotent: true,
    schema: { body: AdminBackupRequestSchema, response: { 201: AdminBackupCreatedResponseSchema }, summary: "Full backup export as ZIP (Super Admin): one JSON per table + manifest + RESTORE.md; 24 h storage, 15 min signed link", tags: ["admin"] },
    handler: async (req, reply) => {
      const user = staff(req);
      requireSuperAdmin(user);
      const [company] = await app.db.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, user.companyId)).limit(1);
      const result = await createBackup(app, { companyId: user.companyId, companyName: company?.name ?? null, includeSensitive: req.body.include_sensitive, generatedBy: user.name });
      const meta = adminMeta(req);
      await app.db.transaction(async (tx) => {
        await writeAudit(tx, { companyId: user.companyId, actor: meta.actor, ip: meta.ip, requestId: meta.requestId, action: "backup.export", entityType: "company", entityId: user.companyId, after: { backup_id: result.id, file_name: result.file_name, size_bytes: result.size_bytes, include_sensitive: result.include_sensitive, table_count: result.table_count, row_count: result.row_count } });
      });
      const { key: _key, ...body } = result;
      return reply.status(201).send(body);
    },
  });

  route(app, {
    method: "GET", url: "/admin/backups", permission: "admin.tools",
    schema: { response: { 200: AdminBackupListResponseSchema }, summary: "Recent backups still in storage (24 h)", tags: ["admin"] },
    handler: async (req) => {
      const user = staff(req);
      requireSuperAdmin(user);
      return { items: await listBackups(app, user.companyId) };
    },
  });

  route(app, {
    method: "GET", url: "/admin/backups/download/:token", public: true,
    schema: { params: z.object({ token: z.string().min(1).max(600) }), response: { 200: z.any() }, summary: "Stream a backup through its signed 15-minute link (forged/expired → 404)", tags: ["admin"] },
    handler: async (req, reply) => {
      const payload = verifyPayload<{ k: string; n: string; g: number; c: string }>(req.params.token);
      if (!payload || typeof payload.k !== "string" || !payload.k.startsWith("backups/") || typeof payload.g !== "number") throw ApiError.notFound("Backup");
      if (Date.now() - payload.g > BACKUP_TTL_SECONDS * 1000) throw ApiError.notFound("Backup");
      const store = storage();
      if (!(await store.exists(payload.k))) throw ApiError.notFound("Backup");
      const name = String(payload.n).replace(/[^A-Za-z0-9._-]/g, "_") || "backup.zip";
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename="${name}"`);
      reply.header("Cache-Control", "no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      return reply.send(await store.stream(payload.k));
    },
  });
}
