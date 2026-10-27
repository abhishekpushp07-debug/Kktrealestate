#!/usr/bin/env node
// Supply-chain gate for GitHub Actions (CI job "Supply chain"): every third-party action is pinned by its full commit SHA with the
// version in a comment (`uses: actions/checkout@<40 hex> # v7.0.0`), so a moved or hijacked tag cannot change what runs. Local actions
// (`./.github/actions/…`) are exempt; `docker://` references need an @sha256 digest. Actions whose SHA could not be verified yet are
// listed in scripts/ci/action-pins-pending.json with a reason and an expiry: the gate fails once an entry expires or is no longer used.
//
//   node scripts/ci/check-action-pins.mjs [dir…]     # default: .github
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every `uses:` reference of a workflow / composite action text: {line, ref, comment}. */
export function usesOf(text) {
  const out = [];
  text.split("\n").forEach((l, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)["']?\s*(?:#\s*(.*))?$/.exec(l);
    if (m) out.push({ line: i + 1, ref: m[1], comment: (m[2] ?? "").trim() });
  });
  return out;
}

/** Problems of one reference (empty = fine); `pending` = [{action, reason, expires}]. */
export function checkRef(ref, comment, pending = [], today = new Date().toISOString().slice(0, 10)) {
  if (ref.startsWith("./")) return [];
  if (ref.startsWith("docker://"))
    return /@sha256:[0-9a-f]{64}$/.test(ref) ? [] : [`${ref}: pin docker actions by @sha256 digest`];
  const at = ref.lastIndexOf("@");
  if (at === -1) return [`${ref}: no version`];
  const action = ref.slice(0, at);
  const version = ref.slice(at + 1);
  if (/^[0-9a-f]{40}$/.test(version)) {
    return /^v?\d/.test(comment) ? [] : [`${ref}: add the release it points at as a comment (# vX.Y.Z)`];
  }
  const p = pending.find((e) => e.action === action);
  if (p) return p.expires < today ? [`${action}: the pending-pin entry expired on ${p.expires}; pin it by SHA`] : [];
  return [`${ref}: pin by full commit SHA (actions/x@<40 hex> # ${version})`];
}

function files(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.ya?ml$/.test(f)) out.push(p);
  }
  return out;
}

function main() {
  const dirs = process.argv.slice(2);
  const pendingFile = join(ROOT, "scripts", "ci", "action-pins-pending.json");
  const pending = existsSync(pendingFile) ? JSON.parse(readFileSync(pendingFile, "utf8")).pending : [];
  for (const e of pending)
    if (!e.action || !e.reason || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires ?? ""))
      throw new Error(`pending entry ${JSON.stringify(e)}: action, reason and expires (YYYY-MM-DD) are required`);
  const problems = [];
  const used = new Set();
  let refs = 0;
  for (const f of (dirs.length ? dirs : [join(ROOT, ".github")]).flatMap((d) => files(d))) {
    for (const u of usesOf(readFileSync(f, "utf8"))) {
      refs++;
      const action = u.ref.slice(0, u.ref.lastIndexOf("@"));
      if (pending.some((e) => e.action === action) && !/@[0-9a-f]{40}$/.test(u.ref)) used.add(action);
      for (const p of checkRef(u.ref, u.comment, pending)) problems.push(`${relative(ROOT, f)}:${u.line}: ${p}`);
    }
  }
  for (const e of pending)
    if (!used.has(e.action))
      problems.push(`action-pins-pending.json: ${e.action} is pinned or unused now; remove the entry`);
  for (const p of problems) console.log(`::error::${p}`);
  console.log(`action pins: ${refs} reference(s), ${problems.length} problem(s), ${used.size} pending verification`);
  if (problems.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
