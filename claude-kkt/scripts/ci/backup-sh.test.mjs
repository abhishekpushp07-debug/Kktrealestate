// Tests of infra/backup/backup.sh: node --test scripts/ci/*.test.mjs   (run by the "Supply chain" job of .github/workflows/ci.yml)
//
// The script runs under the system POSIX sh (dash on the CI runner, busybox ash in the kkt-backup image). The PostgreSQL client tools are
// replaced by stubs on PATH, so these tests cover the script's own logic: encryption round trips, failure propagation (a failed dump or
// cipher must never be recorded as a successful backup), the status file, WAL archiving and retention. The openssl mode needs only
// openssl (always on the runner); the age mode runs where age is installed (the CI infra job, the kkt-backup image) and is skipped elsewhere.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "infra", "backup", "backup.sh");
const which = (cmd) => {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};
const OPENSSL = which("openssl");
const HAS_AGE = Boolean(which("age") && which("age-keygen"));
const MODES = [
  ["openssl", OPENSSL ? false : "openssl is not installed"],
  ["age", HAS_AGE ? false : "age is not installed (the CI infra job and the kkt-backup image have it)"],
];

const sandboxes = [];
after(() => {
  for (const d of sandboxes) rmSync(d, { recursive: true, force: true });
});

/** A backup directory, a key of the given mode and stubbed PostgreSQL tools on PATH. */
function sandbox(mode) {
  const dir = mkdtempSync(join(tmpdir(), "kkt-backup-test-"));
  sandboxes.push(dir);
  const bin = join(dir, "bin");
  const backups = join(dir, "b");
  mkdirSync(bin);
  mkdirSync(backups);
  const key = join(dir, "key");
  if (mode === "age") spawnSync("age-keygen", ["-o", key], { stdio: "ignore" });
  else writeFileSync(key, randomBytes(32).toString("hex"));
  const ext = mode === "age" ? ".age" : ".enc";
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // the plaintext the stubbed pg_dump / pg_basebackup produce: a marker that must never appear on disk unencrypted
  const marker = `KKT-PLAINTEXT-${randomBytes(8).toString("hex")}`;
  const dumpData = Buffer.concat([Buffer.from(`PGDMP ${marker}\n`), randomBytes(200_000)]);
  const baseData = Buffer.concat([Buffer.from(`base.tar ${marker}\n`), randomBytes(50_000)]);
  writeFileSync(join(dir, "dump.bin"), dumpData);
  writeFileSync(join(dir, "base.bin"), baseData);
  stub("pg_isready", "exit 0");
  stub("pg_dump", `cat "${join(dir, "dump.bin")}"`);
  // pg_basebackup -D - writes the tar to stdout; Postgres' archiver pushes the backup history file meanwhile
  stub(
    "pg_basebackup",
    `cat "${join(dir, "base.bin")}"\nprintf x > "${join(backups, "wal")}/000000010000000000000002.00000028.backup${ext}"`,
  );
  stub("pg_archivecleanup", `echo "$@" > "${join(dir, "archivecleanup.args")}"`);
  const run = (args, env = {}) =>
    spawnSync("sh", [SCRIPT, ...args], {
      encoding: "buffer",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        BACKUP_DIR: backups,
        BACKUP_ENCRYPTION_KEY_FILE: key,
        BACKUP_PBKDF2_ITER: "1000",
        VERIFY_RESTORE: "false",
        // never the weekday: base backups only when none exists
        BASEBACKUP_WEEKDAY: "9",
        ...env,
      },
    });
  const status = () =>
    Object.fromEntries(
      readFileSync(join(backups, "status.prom"), "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(" ")),
    );
  const files = (sub) => (existsSync(join(backups, sub)) ? readdirSync(join(backups, sub)).sort() : []);
  return { dir, bin, backups, key, ext, stub, run, status, files, marker, dumpData, baseData };
}

/** Every regular file under `dir`, recursively. */
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

for (const [mode, skip] of MODES) {
  test(
    `${mode}: a good cycle writes an encrypted dump and base backup that decrypt to the originals, and records success`,
    { skip },
    () => {
      const s = sandbox(mode);
      const r = s.run(["once"]);
      assert.equal(r.status, 0, r.stderr.toString());
      const dumps = s.files("dumps").filter((f) => f.endsWith(`.dump${s.ext}`));
      assert.equal(dumps.length, 1);
      if (mode === "openssl") assert.ok(s.files("dumps").includes(`${dumps[0]}.hmac`));
      assert.ok(s.files("dumps").includes(`${dumps[0]}.sha256`));
      const dec = s.run(["decrypt", join(s.backups, "dumps", dumps[0]), "-"]);
      assert.equal(dec.status, 0, dec.stderr.toString());
      assert.ok(dec.stdout.equals(s.dumpData), "the dump decrypts to exactly what pg_dump wrote");

      const [base] = s.files("base");
      assert.match(base, /^\d{8}T\d{6}Z$/);
      assert.equal(
        readFileSync(join(s.backups, "base", base, "WAL_START"), "utf8").trim(),
        "000000010000000000000002.00000028.backup",
      );
      const decBase = s.run(["decrypt", join(s.backups, "base", base, `base.tar.gz${s.ext}`), "-"]);
      assert.equal(decBase.status, 0, decBase.stderr.toString());
      assert.ok(
        gunzipSync(decBase.stdout).equals(s.baseData),
        "the base backup decrypts and gunzips to the pg_basebackup tar",
      );

      for (const f of walk(s.backups)) assert.ok(!readFileSync(f).includes(s.marker), `plaintext on disk in ${f}`);
      const st = s.status();
      assert.ok(Number(st.kkt_backup_last_success_timestamp_seconds) > 0);
      assert.ok(Number(st.kkt_backup_last_base_backup_timestamp_seconds) > 0);
      assert.equal(st.kkt_backup_encrypted, "1");
      assert.equal(Number(st.kkt_backup_last_dump_bytes), statSync(join(s.backups, "dumps", dumps[0])).size);
    },
  );

  test(
    `${mode}: a failing pg_dump fails the cycle, records no success and leaves no dump (even without the restore drill)`,
    { skip },
    () => {
      const s = sandbox(mode);
      s.stub("pg_dump", 'printf "half a dump"; echo "pg_dump: error: connection lost" >&2; exit 1');
      const r = s.run(["once"]);
      assert.equal(r.status, 1);
      assert.match(r.stderr.toString(), /pg_dump FAILED/);
      assert.deepEqual(s.files("dumps"), []);
      const st = s.status();
      assert.equal(st.kkt_backup_last_success_timestamp_seconds, "0");
      assert.equal(st.kkt_backup_last_dump_bytes, "0");
    },
  );

  test(`${mode}: wal-push / wal-fetch round trip, idempotent re-push, conflicting content refused`, { skip }, () => {
    const s = sandbox(mode);
    mkdirSync(join(s.backups, "wal"));
    const seg = join(s.dir, "seg");
    writeFileSync(seg, randomBytes(64 * 1024));
    const name = "000000010000000000000001";
    assert.equal(s.run(["wal-push", seg, name]).status, 0);
    assert.ok(existsSync(join(s.backups, "wal", `${name}${s.ext}`)));
    assert.equal(s.run(["wal-push", seg, name]).status, 0, "re-archiving identical content succeeds");
    const out = join(s.dir, "out");
    assert.equal(s.run(["wal-fetch", name, out]).status, 0);
    assert.ok(readFileSync(out).equals(readFileSync(seg)));
    assert.equal(
      s.run(["wal-fetch", "000000010000000000000009", join(s.dir, "none")]).status,
      1,
      "a missing segment is reported",
    );
    writeFileSync(seg, randomBytes(64 * 1024));
    const conflict = s.run(["wal-push", seg, name]);
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr.toString(), /exists with different content/);
  });

  test(`${mode}: a tampered file is refused`, { skip }, () => {
    const s = sandbox(mode);
    mkdirSync(join(s.backups, "wal"));
    const seg = join(s.dir, "seg");
    writeFileSync(seg, randomBytes(64 * 1024));
    assert.equal(s.run(["wal-push", seg, "000000010000000000000001"]).status, 0);
    const f = join(s.backups, "wal", `000000010000000000000001${s.ext}`);
    const bytes = readFileSync(f);
    bytes[2000] ^= 0xff;
    writeFileSync(f, bytes);
    assert.notEqual(s.run(["decrypt", f, join(s.dir, "x")]).status, 0);
    if (mode === "openssl") {
      rmSync(`${f}.hmac`);
      const r = s.run(["decrypt", f, join(s.dir, "x")]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr.toString(), /hmac is missing/);
    }
  });
}

test(
  "openssl: a cipher that fails at the end of the stream (disk full) fails the cycle instead of publishing a truncated, MAC'd dump",
  { skip: OPENSSL ? false : "openssl is not installed" },
  () => {
    const s = sandbox("openssl");
    // `openssl enc` writes part of its output, consumes the rest and fails (ENOSPC on the last block); every other openssl call is real
    s.stub(
      "openssl",
      [
        'if [ "$1" = enc ]; then',
        '  out=""; for a in "$@"; do [ "$prev" = -out ] && out="$a"; prev="$a"; done',
        '  head -c 1000 > "$out"; cat > /dev/null; echo "write error: No space left on device" >&2; exit 1',
        "fi",
        `exec "${OPENSSL}" "$@"`,
      ].join("\n"),
    );
    const r = s.run(["once"]);
    assert.equal(r.status, 1);
    assert.deepEqual(s.files("dumps"), [], "no truncated dump, MAC or checksum is left behind");
    assert.equal(s.status().kkt_backup_last_success_timestamp_seconds, "0");
    // WAL archiving: Postgres must see the failure (and retry), and nothing may be archived under the segment's name
    mkdirSync(join(s.backups, "wal"), { recursive: true });
    writeFileSync(join(s.dir, "seg"), randomBytes(4096));
    assert.notEqual(s.run(["wal-push", join(s.dir, "seg"), "000000010000000000000001"]).status, 0);
    assert.ok(!existsSync(join(s.backups, "wal", "000000010000000000000001.enc")));
  },
);

test(
  "a failed base backup keeps the dump cycle green but leaves the base-backup timestamp at 0 (alert KktBaseBackupStale)",
  { skip: OPENSSL ? false : "openssl is not installed" },
  () => {
    const s = sandbox("openssl");
    s.stub("pg_basebackup", 'echo "pg_basebackup: error: could not connect" >&2; exit 1');
    const r = s.run(["once"]);
    assert.equal(r.status, 0, r.stderr.toString());
    assert.match(r.stderr.toString(), /pg_basebackup FAILED/);
    assert.deepEqual(s.files("base"), [], "the half-written base backup directory is removed");
    const st = s.status();
    assert.ok(Number(st.kkt_backup_last_success_timestamp_seconds) > 0);
    assert.equal(st.kkt_backup_last_base_backup_timestamp_seconds, "0");
  },
);

test(
  "retention: keeps BASE_BACKUPS_KEEP base backups, cleans WAL before the oldest kept one, drops crashed .partial directories after a day",
  { skip: OPENSSL ? false : "openssl is not installed" },
  () => {
    const s = sandbox("openssl");
    for (const sub of ["dumps", "wal"]) mkdirSync(join(s.backups, sub));
    const bases = ["20260101T000000Z", "20260108T000000Z", "20260115T000000Z"];
    bases.forEach((b, i) => {
      mkdirSync(join(s.backups, "base", b), { recursive: true });
      writeFileSync(join(s.backups, "base", b, "base.tar.gz.enc"), "x");
      writeFileSync(join(s.backups, "base", b, "WAL_START"), `00000001000000000000000${i + 1}.00000028.backup\n`);
    });
    const crashed = join(s.backups, "base", "20251201T000000Z.partial");
    const running = join(s.backups, "base", "20260116T000000Z.partial");
    mkdirSync(crashed);
    mkdirSync(running);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(crashed, twoDaysAgo, twoDaysAgo);
    const r = s.run(["prune"]);
    assert.equal(r.status, 0, r.stderr.toString());
    assert.deepEqual(s.files("base"), ["20260108T000000Z", "20260115T000000Z", "20260116T000000Z.partial"]);
    assert.equal(
      readFileSync(join(s.dir, "archivecleanup.args"), "utf8").trim(),
      `-x .enc ${join(s.backups, "wal")} 000000010000000000000002.00000028.backup`,
    );
  },
);

test("without a key (and without the explicit BACKUP_ENCRYPTION=none opt-out) nothing is written", () => {
  const s = sandbox("openssl");
  const r = s.run(["once"], { BACKUP_ENCRYPTION_KEY_FILE: "" });
  assert.equal(r.status, 1);
  assert.match(r.stderr.toString(), /BACKUP_ENCRYPTION_KEY_FILE is not set/);
  assert.deepEqual(readdirSync(s.backups), []);
  const wrongMode = s.run(["once"], { BACKUP_ENCRYPTION: "age" });
  assert.equal(wrongMode.status, 1);
  assert.match(wrongMode.stderr.toString(), /holds a key for openssl/);
});

test(
  "`backup.sh base` takes a base backup on demand without claiming a dump success",
  { skip: OPENSSL ? false : "openssl is not installed" },
  () => {
    const s = sandbox("openssl");
    const r = s.run(["base"]);
    assert.equal(r.status, 0, r.stderr.toString());
    assert.equal(s.files("base").length, 1);
    assert.deepEqual(s.files("dumps"), []);
    const st = s.status();
    assert.ok(Number(st.kkt_backup_last_base_backup_timestamp_seconds) > 0);
    assert.equal(st.kkt_backup_last_success_timestamp_seconds, "0");
  },
);
