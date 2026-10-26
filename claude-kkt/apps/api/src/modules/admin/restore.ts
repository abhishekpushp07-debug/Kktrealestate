/**
 * Restore of a backup archive (audit B9; CLI src/cli/restore.ts). Steps: verify the sha256 of every file against manifest.json → check the
 * target is empty (before touching it) → migrate it → load the tables parents-first in foreign-key order inside ONE transaction with `json_populate_recordset`
 * (PostgreSQL converts every value; no trigger is disabled — the append-only guards never block INSERT) → compare each table's row count
 * with the manifest → run the integrity report for every company. Nothing is written when a check fails before the load, and the load
 * itself is all-or-nothing.
 */
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import type { Sql } from "postgres";
import { createDb, runMigrations } from "@kkt/db";
import { BACKUP_FORMAT, fkLoadOrder, schemaVersion, type BackupManifest } from "./backup.js";

/** Rows per INSERT … SELECT FROM json_populate_recordset. */
const LOAD_BATCH = 2_000;
/** Prefix of the value written into stripped NOT NULL secret columns with --allow-stripped (never a valid hash or ciphertext). */
export const STRIPPED_MARKER = "!restored-without-secret";

/** Options of restoreBackup(). */
export interface RestoreOptions {
  /** Path of the backup ZIP. */
  file: string;
  /** Target database (must be empty; it is migrated first). */
  databaseUrl: string;
  /** Must be true: restoring is a deliberate act. */
  confirm: boolean;
  /** Accept a backup made without include_sensitive (secret columns get an unusable marker). */
  allowStripped?: boolean;
  /** Skip the integrity report (tests of broken archives). */
  skipIntegrity?: boolean;
  log?: (msg: string) => void;
}

/** Outcome of restoreBackup(). */
export interface RestoreResult {
  manifest: Pick<
    BackupManifest,
    "format" | "generated_at" | "app_version" | "company" | "include_sensitive" | "schema" | "table_count" | "row_count"
  >;
  tables: { name: string; expected: number; restored: number }[];
  load_order: string[];
  integrity: { company_id: string; ok: boolean; findings: number }[];
  duration_ms: number;
}

async function openZip(file: string): Promise<{ zip: ZipFile; entries: Map<string, Entry> }> {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true });
  const entries = new Map<string, Entry>();
  for await (const e of zip.eachEntry()) entries.set(e.fileName, e);
  return { zip, entries };
}

async function entryStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return zip.openReadStreamPromise(entry);
}

async function entryText(zip: ZipFile, entry: Entry): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of await entryStream(zip, entry)) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function entrySha256(zip: ZipFile, entry: Entry): Promise<string> {
  const hash = createHash("sha256");
  for await (const c of await entryStream(zip, entry)) hash.update(c as Buffer);
  return hash.digest("hex");
}

/** Names and sizes of every entry of a ZIP file (tests, diagnostics). */
export async function readZipEntries(file: string): Promise<{ name: string; size: number }[]> {
  const { zip, entries } = await openZip(file);
  try {
    return [...entries.values()].map((e) => ({ name: e.fileName, size: e.uncompressedSize }));
  } finally {
    zip.close();
  }
}

/** Text of one entry of a ZIP file. */
export async function readZipText(file: string, name: string): Promise<string> {
  const { zip, entries } = await openZip(file);
  try {
    const e = entries.get(name);
    if (!e) throw new Error(`${name} is not in the archive`);
    return await entryText(zip, e);
  } finally {
    zip.close();
  }
}

/** Columns of every public table in the target: name → { columns, required secret-less columns }. */
async function targetColumns(
  pg: Sql,
): Promise<Map<string, Map<string, { notNull: boolean; hasDefault: boolean; type: string }>>> {
  const rows = await pg<
    { table_name: string; column_name: string; is_nullable: string; column_default: string | null; data_type: string }[]
  >`
    select table_name, column_name, is_nullable, column_default, data_type from information_schema.columns where table_schema = 'public'`;
  const out = new Map<string, Map<string, { notNull: boolean; hasDefault: boolean; type: string }>>();
  for (const r of rows) {
    const t = out.get(r.table_name) ?? new Map<string, { notNull: boolean; hasDefault: boolean; type: string }>();
    t.set(r.column_name, { notNull: r.is_nullable === "NO", hasDefault: r.column_default !== null, type: r.data_type });
    out.set(r.table_name, t);
  }
  return out;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Public tables of the target that hold at least one row. */
async function nonEmptyTables(pg: Sql): Promise<string[]> {
  const tables = await pg<
    { name: string }[]
  >`select tablename as name from pg_tables where schemaname = 'public' order by tablename`;
  const out: string[] = [];
  for (const { name } of tables) {
    const [r] = await pg.unsafe<{ any: boolean }[]>(`select exists(select 1 from ${ident(name)}) as any`);
    if (r?.any) out.push(name);
  }
  return out;
}

function notEmpty(tables: readonly string[]): Error {
  return new Error(
    `the target database is not empty (${tables.slice(0, 5).join(", ")}${tables.length > 5 ? ", …" : ""}); restore into a new database`,
  );
}

/** Restores a backup archive into an empty database. Throws (writing nothing) on any failed check. */
export async function restoreBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const started = Date.now();
  const log = opts.log ?? (() => undefined);
  if (!opts.confirm) throw new Error("restore needs --confirm: it loads a full backup into the target database");
  const { zip, entries } = await openZip(opts.file);
  try {
    const manifestEntry = entries.get("manifest.json");
    if (!manifestEntry) throw new Error("manifest.json is missing: not a KKT backup");
    const manifest = JSON.parse(await entryText(zip, manifestEntry)) as BackupManifest;
    if (manifest.format !== BACKUP_FORMAT)
      throw new Error(`unsupported backup format ${manifest.format} (this build restores ${BACKUP_FORMAT})`);

    // 1. integrity of the archive
    log(`verifying ${manifest.tables.length + Object.keys(manifest.files ?? {}).length} checksums`);
    for (const t of manifest.tables) {
      const e = entries.get(t.file);
      if (!e) throw new Error(`${t.file} listed in manifest.json is missing from the archive`);
      if ((await entrySha256(zip, e)) !== t.sha256)
        throw new Error(`checksum mismatch for ${t.file}: the archive is corrupt or was modified`);
    }
    for (const [name, sum] of Object.entries(manifest.files ?? {})) {
      const e = entries.get(name);
      if (!e || (await entrySha256(zip, e)) !== sum) throw new Error(`checksum mismatch for ${name}`);
    }
    const stripped = manifest.tables.filter((t) => t.stripped_columns.length > 0);
    if (!manifest.include_sensitive && stripped.length > 0 && !opts.allowStripped) {
      throw new Error(
        "this backup was made without include_sensitive (no password hashes, MFA secrets or encrypted KYC); pass --allow-stripped to restore it anyway (users must then reset their passwords)",
      );
    }

    // 2. target: must be empty BEFORE anything touches it (never migrate someone else's database), then migrate; the schema must not be
    //    older than the backup's
    const handle = createDb(opts.databaseUrl, { max: 2, timeouts: false });
    try {
      const pg = handle.sql;
      const occupied = await nonEmptyTables(pg);
      if (occupied.length > 0) throw notEmpty(occupied);
      log("migrating the target database");
      await runMigrations(opts.databaseUrl);
      const version = await schemaVersion(pg);
      if (
        manifest.schema.migrations_applied !== null &&
        version.migrations_applied !== null &&
        version.migrations_applied < manifest.schema.migrations_applied
      ) {
        throw new Error(
          `the target schema (${version.migrations_applied} migrations) is older than the backup's (${manifest.schema.migrations_applied}); restore with the same or a newer application version`,
        );
      }
      const columns = await targetColumns(pg);
      // the migrations themselves must not have written rows either
      const seeded = await nonEmptyTables(pg);
      if (seeded.length > 0) throw notEmpty(seeded);
      const byName = new Map(manifest.tables.map((t) => [t.name, t]));
      const missing = manifest.tables.filter((t) => !columns.has(t.name)).map((t) => t.name);
      if (missing.length > 0) throw new Error(`the target schema has no table ${missing.join(", ")}`);
      const order = (await fkLoadOrder(pg)).filter((n) => byName.has(n));

      // 3. load parents-first in one transaction
      const tables: RestoreResult["tables"] = [];
      await pg.begin(async (tx) => {
        for (const name of order) {
          const t = byName.get(name)!;
          const target = columns.get(name)!;
          const cols = t.columns.filter((c) => target.has(c));
          const unknown = t.columns.filter((c) => !target.has(c));
          if (unknown.length > 0) throw new Error(`${name}: the target has no column ${unknown.join(", ")}`);
          const fills = opts.allowStripped
            ? t.stripped_columns.filter((c) => {
                const col = target.get(c);
                return col && col.notNull && !col.hasDefault;
              })
            : [];
          for (const c of fills)
            if (!["text", "character varying"].includes(target.get(c)!.type))
              throw new Error(
                `${name}.${c} is a required stripped column of type ${target.get(c)!.type}; it cannot be filled`,
              );
          const insertCols = [...cols, ...fills].map(ident).join(", ");
          // unique per row (token hashes carry unique indexes), never a valid hash or ciphertext
          const selectCols = [
            ...cols.map(ident),
            ...fills.map(() => `'${STRIPPED_MARKER}:' || gen_random_uuid()::text`),
          ].join(", ");
          const statement = `insert into ${ident(name)} (${insertCols}) select ${selectCols} from json_populate_recordset(null::${ident(name)}, $1::json)`;
          const lines = createInterface({ input: await entryStream(zip, entries.get(t.file)!), crlfDelay: Infinity });
          let batch: string[] = [];
          let restored = 0;
          const flush = async () => {
            if (batch.length === 0) return;
            await tx.unsafe(statement, [`[${batch.join(",")}]`]);
            restored += batch.length;
            batch = [];
          };
          for await (const line of lines) {
            if (line.trim() === "") continue;
            batch.push(line);
            if (batch.length >= LOAD_BATCH) await flush();
          }
          await flush();
          const [count] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from ${ident(name)}`);
          const n = Number(count?.n ?? 0);
          if (n !== t.rows || restored !== t.rows)
            throw new Error(`${name}: expected ${t.rows} rows, loaded ${restored}, table has ${n}`);
          tables.push({ name, expected: t.rows, restored: n });
          log(`${name}: ${n} rows`);
        }
      });

      // 4. integrity report per company
      const integrity: RestoreResult["integrity"] = [];
      if (!opts.skipIntegrity) {
        const { runReport } = await import("../money/index.js");
        const companies = await pg<{ id: string }[]>`select id from companies order by created_at`;
        for (const c of companies) {
          const { report } = await runReport(handle.db, { companyId: c.id }, { persist: false });
          integrity.push({ company_id: c.id, ok: report.ok, findings: report.findings.length });
          log(`integrity ${c.id}: ${report.ok ? "OK" : `${report.findings.length} findings`}`);
        }
      }
      const { tables: _t, files: _f, load_order: _o, batch_size: _b, node_version: _n, ...head } = manifest;
      return { manifest: head, tables, load_order: order, integrity, duration_ms: Date.now() - started };
    } finally {
      await handle.close();
    }
  } finally {
    zip.close();
  }
}
