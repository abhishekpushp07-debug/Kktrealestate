/**
 * Signed backup manifests (phase 7 ops, audit D "restore accepts any archive whose unsigned manifest hashes match"): the application
 * export carries manifest.sig, an HMAC-SHA256 of the exact manifest.json bytes under the LINK_SIGNING_KEYS ring (key family
 * kkt-backup-manifest-v1). The restore (library and CLI) refuses an unsigned archive, an edited manifest, a manifest re-signed with a
 * foreign key, a key id that is not in the ring and files the signed manifest does not list — all before it connects to the target.
 * Backup download links use the same ring (`<kid>.<body>.<sig>`).
 */
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createWriteStream, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type TestContext } from "./helpers.js";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));
/** A database that does not exist: every refusal below must happen before the restore connects anywhere. */
const NOWHERE = "postgres://postgres:postgres@127.0.0.1:1/kkt_never_touched";

let t: TestContext;
let good: string;
const dir = mkdtempSync(join(tmpdir(), "kkt-backup-sig-"));

type Mod = typeof import("../../src/modules/admin/backup.js") & typeof import("../../src/modules/admin/restore.js");
let m: Mod;

/** Re-packs `src` into a new archive, letting `edit` change, drop (null) or add entries. */
async function repack(
  src: string,
  name: string,
  edit: (entry: string, text: string) => string | null,
  extra: Record<string, string> = {},
): Promise<string> {
  const out = join(dir, name);
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const stream = createWriteStream(out);
  archive.pipe(stream);
  for (const e of await m.readZipEntries(src)) {
    const text = edit(e.name, await m.readZipText(src, e.name));
    if (text !== null) archive.append(text, { name: e.name });
  }
  for (const [n, text] of Object.entries(extra)) archive.append(text, { name: n });
  await archive.finalize();
  await finished(stream);
  return out;
}

function runCli(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli/restore.ts", ...args], {
      cwd: API_DIR,
      env: { ...process.env, LOG_LEVEL: "fatal" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (out += c.toString()));
    child.on("exit", (code) => resolve({ code, out }));
  });
}

beforeAll(async () => {
  t = await buildTestApp();
  m = {
    ...(await import("../../src/modules/admin/backup.js")),
    ...(await import("../../src/modules/admin/restore.js")),
  } as Mod;
  good = join(dir, "good.zip");
  await m.writeBackupArchive(t.app.db, good, { companyId: t.companyId, companyName: "SGB", includeSensitive: true });
}, 120_000);

afterAll(async () => {
  await t?.close();
});

describe("signed backup manifests", () => {
  it("the archive carries manifest.sig over the exact manifest bytes with the active LINK_SIGNING_KEYS key", async () => {
    const names = (await m.readZipEntries(good)).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["manifest.json", "manifest.sig", "RESTORE.md"]));
    const sig = JSON.parse(await m.readZipText(good, "manifest.sig")) as Record<string, string>;
    const { activeLinkKey } = await import("../../src/lib/crypto.js");
    const { kid, key } = activeLinkKey(m.BACKUP_MANIFEST_LABEL);
    const manifestText = await m.readZipText(good, "manifest.json");
    expect(sig).toMatchObject({ format: "kkt-backup-sig/1", alg: "HMAC-SHA256", kid });
    expect(sig["signature"]).toBe(createHmac("sha256", key).update(manifestText).digest("base64url"));
    expect(JSON.parse(manifestText)).toMatchObject({ format: "kkt-backup/3" });
    const v = await m.verifyBackupArchive(good);
    expect(v.signed_by).toBe(kid);
    expect(v.files_verified).toBe(v.manifest.tables.length + 1);
  });

  it("refuses an unsigned archive (no manifest.sig) and a legacy kkt-backup/2 archive before connecting to the target", async () => {
    const unsigned = await repack(good, "unsigned.zip", (n, text) => (n === "manifest.sig" ? null : text));
    await expect(m.restoreBackup({ file: unsigned, databaseUrl: NOWHERE, confirm: true })).rejects.toThrow(
      /manifest\.sig is missing: the archive is not signed/,
    );
    const legacy = await repack(good, "legacy.zip", (n, text) =>
      n === "manifest.sig" ? null : n === "manifest.json" ? text.replace('"kkt-backup/3"', '"kkt-backup/2"') : text,
    );
    await expect(m.verifyBackupArchive(legacy)).rejects.toThrow(/not signed/);
    const garbage = await repack(good, "garbage-sig.zip", (n, text) => (n === "manifest.sig" ? "not json" : text));
    await expect(m.verifyBackupArchive(garbage)).rejects.toThrow(/not valid JSON/);
  });

  it("refuses an edited manifest even when its checksums were recomputed (the signature covers the manifest bytes)", async () => {
    // the attacker edits a table file AND its sha256 in the manifest, so the checksum check alone would pass
    const { createHash } = await import("node:crypto");
    const manifest = JSON.parse(await m.readZipText(good, "manifest.json")) as {
      tables: { name: string; file: string; sha256: string; bytes: number }[];
    };
    const companies = manifest.tables.find((x) => x.name === "companies")!;
    const forged = (await m.readZipText(good, companies.file)).replace(/"name":"[^"]*"/, '"name":"Forged Builders"');
    companies.sha256 = createHash("sha256").update(forged).digest("hex");
    companies.bytes = Buffer.byteLength(forged);
    const edited = await repack(good, "edited.zip", (n, text) =>
      n === "manifest.json" ? `${JSON.stringify(manifest, null, 2)}\n` : n === companies.file ? forged : text,
    );
    await expect(m.restoreBackup({ file: edited, databaseUrl: NOWHERE, confirm: true })).rejects.toThrow(
      /manifest signature does not match/,
    );
    // the same edit without touching the manifest is caught by the checksum
    const fileOnly = await repack(good, "file-only.zip", (n, text) => (n === companies.file ? forged : text));
    await expect(m.verifyBackupArchive(fileOnly)).rejects.toThrow(/checksum mismatch for tables\/companies\.ndjson/);
  });

  it("refuses a manifest re-signed with a foreign key under a known kid, and a kid that is not in the ring", async () => {
    const sig = JSON.parse(await m.readZipText(good, "manifest.sig")) as Record<string, string>;
    const manifestText = await m.readZipText(good, "manifest.json");
    const foreign = createHmac("sha256", Buffer.alloc(32, 9)).update(manifestText).digest("base64url");
    const resigned = await repack(good, "resigned.zip", (n, text) =>
      n === "manifest.sig" ? JSON.stringify({ ...sig, signature: foreign }) : text,
    );
    await expect(m.verifyBackupArchive(resigned)).rejects.toThrow(/signature does not match/);
    const unknown = await repack(good, "unknown-kid.zip", (n, text) =>
      n === "manifest.sig" ? JSON.stringify({ ...sig, kid: "zz9" }) : text,
    );
    await expect(m.verifyBackupArchive(unknown)).rejects.toThrow(
      /signed with key zz9, which is not in LINK_SIGNING_KEYS/,
    );
  });

  it("refuses files the signed manifest does not list", async () => {
    const injected = await repack(good, "injected.zip", (_n, text) => text, { "tables/evil.ndjson": '{"id":1}\n' });
    await expect(m.verifyBackupArchive(injected)).rejects.toThrow(/does not list \(tables\/evil\.ndjson\)/);
  });

  it("the CLI --verify-only answers 0 for an authentic archive and 1 (with the reason) for a tampered one", async () => {
    const ok = await runCli(["--file", good, "--verify-only"]);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toContain('"ok": true');
    expect(ok.out).toContain('"signed_by"');
    const unsigned = await repack(good, "cli-unsigned.zip", (n, text) => (n === "manifest.sig" ? null : text));
    const bad = await runCli(["--", "--file", unsigned, "--verify-only"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/restore failed: manifest\.sig is missing/);
  });
});

describe("backup download links on the LINK_SIGNING_KEYS ring", () => {
  it("tokens are <kid>.<body>.<sig>, verify, expire, reject forgeries, and legacy compact tokens keep verifying", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const now = Math.floor(Date.now() / 1000);
    const token = m.signBackupToken(id, now + 60);
    const { activeLinkKey } = await import("../../src/lib/crypto.js");
    expect(token.split(".")).toHaveLength(3);
    expect(token.startsWith(`${activeLinkKey(m.BACKUP_LINK_LABEL).kid}.`)).toBe(true);
    expect(token.length).toBeLessThanOrEqual(100);
    expect(m.verifyBackupToken(token)).toBe(id);
    expect(m.verifyBackupToken(m.signBackupToken(id, now - 1))).toBeNull();
    const [kid, body, sig] = token.split(".") as [string, string, string];
    expect(m.verifyBackupToken(`${kid}.${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(m.verifyBackupToken(`nokey.${body}.${sig}`)).toBeNull();
    // a link issued before the ring (compact `<body>.<sig>`, key derived from JWT_SECRET) still works outside production
    const { signFileToken, fileTokenKey } = await import("../../src/modules/documents/index.js");
    const { config } = await import("../../src/config.js");
    const legacy = signFileToken(fileTokenKey("kkt-backup-link-v1", config.JWT_SECRET), id, now + 60);
    expect(m.verifyBackupToken(legacy)).toBe(id);
  });
});
