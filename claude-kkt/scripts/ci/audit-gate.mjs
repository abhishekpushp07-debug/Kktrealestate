#!/usr/bin/env node
// Dependency audit gate (CI job "Supply chain"; docs/DEPLOY.md "CI gates").
//
//   node scripts/ci/audit-gate.mjs                       # runs `pnpm audit --prod --json` itself
//   node scripts/ci/audit-gate.mjs --report audit.json   # evaluates a saved report (tests, offline runs)
//   options: --allowlist <file> (default scripts/ci/audit-allowlist.json), --today YYYY-MM-DD (tests)
//
// Fails (exit 1) on every high or critical advisory of a production dependency that is not in the allowlist, and on every allowlist
// entry past its expiry date (or without a reason / expiry). Moderate and low advisories are printed, not fatal. Unused allowlist entries
// are reported as warnings so they get removed. Understands pnpm's npm-v6-style report ({advisories}) and npm v7+ ({vulnerabilities}).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FATAL = new Set(["high", "critical"]);

/** Advisories of a report as {id, ghsa, module, severity, title, url, paths}. */
export function advisoriesOf(report) {
  const out = [];
  if (report && typeof report.advisories === "object" && report.advisories !== null) {
    for (const [id, a] of Object.entries(report.advisories)) {
      out.push({
        id: String(a.id ?? id),
        ghsa: a.github_advisory_id ?? null,
        module: a.module_name,
        severity: String(a.severity ?? "").toLowerCase(),
        title: a.title ?? "",
        url: a.url ?? "",
        paths: (a.findings ?? []).flatMap((f) => f.paths ?? []),
      });
    }
  } else if (report && typeof report.vulnerabilities === "object" && report.vulnerabilities !== null) {
    for (const [name, v] of Object.entries(report.vulnerabilities)) {
      for (const via of v.via ?? []) {
        if (typeof via !== "object") continue; // transitive pointer to another entry
        const ghsa = /GHSA-[\w-]+/.exec(via.url ?? "")?.[0] ?? null;
        out.push({
          id: String(via.source ?? ghsa ?? name),
          ghsa,
          module: via.name ?? name,
          severity: String(via.severity ?? v.severity ?? "").toLowerCase(),
          title: via.title ?? "",
          url: via.url ?? "",
          paths: v.nodes ?? [],
        });
      }
    }
  } else if (report && report.error) {
    throw new Error(
      `pnpm audit failed: ${report.error.code ?? ""} ${report.error.summary ?? JSON.stringify(report.error)}`,
    );
  }
  return out;
}

/** The gate's decision: {failures: string[], warnings: string[], accepted: string[], info: string[]}. */
export function evaluate(report, allowlist, today = new Date().toISOString().slice(0, 10)) {
  const failures = [];
  const warnings = [];
  const accepted = [];
  const info = [];
  const entries = allowlist?.entries ?? [];
  const used = new Set();
  for (const e of entries) {
    const label = `${e.id ?? "?"} (${e.module ?? "?"})`;
    if (!e.id || !e.module) failures.push(`allowlist entry ${label}: id and module are required`);
    if (!e.reason || String(e.reason).trim().length < 20)
      failures.push(`allowlist entry ${label}: a reason (≥ 20 characters) is required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expires ?? ""))
      failures.push(`allowlist entry ${label}: expires must be YYYY-MM-DD`);
    else if (e.expires < today)
      failures.push(`allowlist entry ${label} expired on ${e.expires}: fix the dependency or re-decide and extend`);
  }
  for (const a of advisoriesOf(report)) {
    const line = `${a.severity} ${a.module} ${a.ghsa ?? a.id} ${a.title} ${a.url} via ${a.paths.slice(0, 3).join(", ") || "?"}`;
    if (!FATAL.has(a.severity)) {
      info.push(line);
      continue;
    }
    const entry = entries.find(
      (e) =>
        e.module === a.module &&
        (e.id === a.ghsa || e.id === a.id) &&
        (!e.paths || e.paths.length === 0 || a.paths.every((p) => e.paths.includes(p))),
    );
    if (entry) {
      used.add(entry);
      accepted.push(`${line} — allowlisted until ${entry.expires}: ${entry.reason}`);
    } else failures.push(line);
  }
  for (const e of entries)
    if (!used.has(e)) warnings.push(`allowlist entry ${e.id} (${e.module}) matches no advisory any more: remove it`);
  return { failures, warnings, accepted, info };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const allowlist = JSON.parse(
    readFileSync(opt("--allowlist") ?? join(root, "scripts", "ci", "audit-allowlist.json"), "utf8"),
  );
  let raw;
  if (opt("--report")) raw = readFileSync(opt("--report"), "utf8");
  else {
    try {
      raw = execFileSync("pnpm", ["audit", "--prod", "--json"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      // pnpm audit exits non-zero when it finds anything; the JSON is still on stdout
      raw = err.stdout;
      if (!raw) throw err;
    }
  }
  const { failures, warnings, accepted, info } = evaluate(JSON.parse(raw), allowlist, opt("--today"));
  for (const l of info) console.log(`note     ${l}`);
  for (const l of accepted) console.log(`accepted ${l}`);
  for (const l of warnings) console.log(`::warning::${l}`);
  for (const l of failures) console.log(`::error::${l}`);
  console.log(
    `audit gate: ${failures.length} failure(s), ${accepted.length} allowlisted, ${info.length} below high, ${warnings.length} warning(s)`,
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
