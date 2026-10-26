/**
 * Backup → restore drill (audit B9): the demo seed is backed up through the API (job BACKUP_EXPORT), restored into a FRESH database with
 * the restore code / CLI, and the restored database has identical row counts per table and a clean integrity report. Corrupt archives,
 * non-empty targets and stripped backups are refused before anything is written.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, freshIp, TEST_DATABASE_URL, type TestContext } from "./helpers.js";
import { startTestWorker, waitForExport, type TestWorker } from "./worker.js";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
const target = (suffix: string) => {
  const u = new URL(TEST_DATABASE_URL);
  u.pathname = `/${u.pathname.slice(1)}_restore${suffix}`;
  return u.toString();
};
/** Tables the backup job itself writes to while it runs (its job_runs row, its exports row, the audit row, bells): compared with the manifest only. */
const MOVING = new Set(["job_runs", "exports", "audit_logs", "notifications", "idempotency_keys"]);

let t: TestContext;
let admin: string;
let worker: TestWorker;
const dir = mkdtempSync(join(tmpdir(), "kkt-restore-"));

async function recreate(url: string): Promise<void> {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  u.pathname = "/postgres";
  const pg = postgres(u.toString(), { max: 1, onnotice: () => undefined });
  try {
    await pg.unsafe(`drop database if exists "${name}" with (force)`);
    await pg.unsafe(`create database "${name}"`);
  } finally {
    await pg.end({ timeout: 5 });
  }
}

async function dropDb(url: string): Promise<void> {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  u.pathname = "/postgres";
  const pg = postgres(u.toString(), { max: 1, onnotice: () => undefined });
  try {
    await pg.unsafe(`drop database if exists "${name}" with (force)`);
  } finally {
    await pg.end({ timeout: 5 });
  }
}

async function counts(url: string): Promise<Record<string, number>> {
  const pg = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const tables = await pg<
      { t: string }[]
    >`select tablename as t from pg_tables where schemaname = 'public' order by tablename`;
    const out: Record<string, number> = {};
    for (const { t: name } of tables)
      out[name] = Number((await pg.unsafe<{ n: number }[]>(`select count(*)::int as n from "${name}"`))[0]!.n);
    return out;
  } finally {
    await pg.end({ timeout: 5 });
  }
}

/** Requests a backup through the API, waits for the worker and downloads the archive to a file. */
async function backup(includeSensitive: boolean): Promise<string> {
  const r = await t.request<{ id: string }>("POST", "/api/v1/admin/backup", {
    token: admin,
    body: { include_sensitive: includeSensitive },
  });
  expect(r.status, r.text).toBe(202);
  const done = await waitForExport(t.app, r.body.id, 180_000);
  expect(done.status, done.error ?? "").toBe("DONE");
  const link = await t.request<{ download_url: string }>("POST", `/api/v1/admin/backups/${r.body.id}/link`, {
    token: admin,
  });
  const res = await t.app.inject({
    method: "GET",
    url: link.body.download_url.replace(/^https?:\/\/[^/]+/, ""),
    headers: { "x-forwarded-for": freshIp() },
  });
  expect(res.statusCode).toBe(200);
  const file = join(dir, `${r.body.id}.zip`);
  writeFileSync(file, res.rawPayload);
  return file;
}

let sourceCounts: Record<string, number>;
let sensitiveZip: string;

beforeAll(async () => {
  t = await buildTestApp();
  const { seedDemo } = await import("../../src/seed/run.js");
  const seeded = await seedDemo(t.app);
  expect(seeded.skipped).toBeFalsy();
  admin = (await t.loginAs("admin")).access_token;
  worker = await startTestWorker(t.app);
  sourceCounts = await counts(TEST_DATABASE_URL);
  sensitiveZip = await backup(true);
}, 15 * 60_000);

afterAll(async () => {
  await worker?.close();
  await t?.close();
  await dropDb(target("")).catch(() => undefined);
  await dropDb(target("_cli")).catch(() => undefined);
});

describe("backup → restore into a fresh database", () => {
  it(
    "restores every table with identical row counts and a clean integrity report",
    async () => {
      expect(sourceCounts["bookings"]).toBeGreaterThan(0);
      expect(sourceCounts["ledger_entries"]).toBeGreaterThan(0);
      const url = target("");
      await recreate(url);
      const { restoreBackup, readZipText } = await import("../../src/modules/admin/index.js");
      const manifest = JSON.parse(await readZipText(sensitiveZip, "manifest.json")) as {
        tables: { name: string; rows: number }[];
      };
      const result = await restoreBackup({ file: sensitiveZip, databaseUrl: url, confirm: true });
      expect(result.integrity.length).toBe(1);
      expect(result.integrity.every((i) => i.ok && i.findings === 0)).toBe(true);
      const restored = await counts(url);
      for (const tb of manifest.tables) {
        expect(restored[tb.name], tb.name).toBe(tb.rows);
        if (!MOVING.has(tb.name)) expect(tb.rows, `${tb.name} (source)`).toBe(sourceCounts[tb.name]);
      }
      expect(Object.keys(restored).sort()).toEqual(Object.keys(sourceCounts).sort());
      expect(result.tables.reduce((s, x) => s + x.restored, 0)).toBe(manifest.tables.reduce((s, x) => s + x.rows, 0));
      // exact values survive (microsecond timestamps, money, jsonb)
      const src = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => undefined });
      const dst = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const q = `select id, booking_number, agreement_value_paise, flat_snapshot, created_at::text as c from bookings order by id`;
        expect(await dst.unsafe(q)).toEqual(await src.unsafe(q));
        const l = `select booking_id, seq, amount_paise, total_due_paise from ledger_entries order by booking_id, seq`;
        expect(await dst.unsafe(l)).toEqual(await src.unsafe(l));
      } finally {
        await src.end({ timeout: 5 });
        await dst.end({ timeout: 5 });
      }
      // the target is no longer empty: a second restore is refused before writing anything
      await expect(restoreBackup({ file: sensitiveZip, databaseUrl: url, confirm: true })).rejects.toThrow(/not empty/);
    },
    10 * 60_000,
  );

  it(
    "refuses a modified archive (sha256 mismatch), a restore without --confirm and a stripped backup without --allow-stripped",
    async () => {
      const { restoreBackup, readZipEntries, readZipText } = await import("../../src/modules/admin/index.js");
      await expect(
        restoreBackup({ file: sensitiveZip, databaseUrl: target("_never"), confirm: false }),
      ).rejects.toThrow(/--confirm/);
      // re-pack the archive with one edited table file
      const tampered = join(dir, "tampered.zip");
      const archive = new ZipArchive({ zlib: { level: 1 } });
      const out = createWriteStream(tampered);
      archive.pipe(out);
      for (const e of await readZipEntries(sensitiveZip)) {
        let text = await readZipText(sensitiveZip, e.name);
        if (e.name === "tables/payment_modes.ndjson") text = text.replace(/"name":"[^"]+"/, '"name":"Tampered"');
        archive.append(text, { name: e.name });
      }
      await archive.finalize();
      await finished(out);
      await expect(restoreBackup({ file: tampered, databaseUrl: target("_never"), confirm: true })).rejects.toThrow(
        /checksum mismatch for tables\/payment_modes\.ndjson/,
      );
      const stripped = await backup(false);
      await expect(restoreBackup({ file: stripped, databaseUrl: target("_never"), confirm: true })).rejects.toThrow(
        /--allow-stripped/,
      );
    },
    10 * 60_000,
  );

  it(
    "the CLI restores a stripped backup with --allow-stripped (secrets replaced by an unusable marker) and exits 0 on a clean integrity report",
    async () => {
      const stripped = await backup(false);
      const url = target("_cli");
      await recreate(url);
      const run = (args: string[]) =>
        new Promise<{ code: number | null; out: string }>((resolve) => {
          let out = "";
          const child = spawn(process.execPath, ["--import", "tsx", "src/cli/restore.ts", ...args], {
            cwd: API_DIR,
            env: { ...process.env, LOG_LEVEL: "fatal" },
            stdio: ["ignore", "pipe", "pipe"],
          });
          child.stdout.on("data", (c: Buffer) => {
            out += c.toString();
          });
          child.stderr.on("data", (c: Buffer) => {
            out += c.toString();
          });
          child.on("exit", (code) => resolve({ code, out }));
        });
      const refused = await run(["--file", stripped, "--database-url", url]);
      expect(refused.code).toBe(2);
      expect(refused.out).toContain("--confirm");
      const ok = await run(["--", "--file", stripped, "--database-url", url, "--confirm", "--allow-stripped"]);
      expect(ok.code, ok.out).toBe(0);
      expect(ok.out).toContain('"ok": true');
      const pg = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const users = await pg<{ password_hash: string }[]>`select password_hash from users`;
        expect(users.length).toBeGreaterThanOrEqual(6);
        expect(users.every((u) => u.password_hash.startsWith("!restored-without-secret:"))).toBe(true);
      } finally {
        await pg.end({ timeout: 5 });
      }
    },
    10 * 60_000,
  );
});
