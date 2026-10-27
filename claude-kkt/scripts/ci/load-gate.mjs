#!/usr/bin/env node
// Nightly load gate (.github/workflows/nightly.yml): reads the markdown table apps/api/loadtest/run.ts appends
// (| Scenario | Conns | Requests | non-2xx | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |) and fails when a scenario served no requests,
// more than max_non2xx_ratio of them failed, or its p95 exceeds the limit in scripts/ci/load-thresholds.json.
//
//   node scripts/ci/load-gate.mjs /tmp/loadtest.md [thresholds.json]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Rows of the LAST table in the report: {name, requests, non2xx, p95}. */
export function parseReport(md) {
  const blocks = md.split(/\n(?=### Run )/);
  const last = blocks[blocks.length - 1];
  return last
    .split("\n")
    .filter((l) => /^\| (GET|POST|PUT|PATCH|DELETE) /.test(l))
    .map((l) => {
      const c = l.split("|").map((s) => s.trim());
      return { name: c[1], requests: Number(c[3]), non2xx: parseInt(c[4], 10) || 0, p95: Number(c[6]) };
    });
}

/** Gate decision: {failures, lines}. */
export function gate(rows, t) {
  const failures = [];
  const lines = [];
  if (rows.length < (t.min_scenarios ?? 1))
    failures.push(`only ${rows.length} scenario(s) ran (expected ≥ ${t.min_scenarios})`);
  for (const r of rows) {
    const rule = (t.p95_ms ?? []).find((x) => new RegExp(x.pattern).test(r.name));
    const max = rule ? rule.max : t.default_max;
    const ratio = r.requests > 0 ? r.non2xx / r.requests : 1;
    const ok = r.requests > 0 && ratio <= t.max_non2xx_ratio && Number.isFinite(r.p95) && r.p95 <= max;
    lines.push(
      `${ok ? "ok  " : "FAIL"} ${r.name}: p95 ${r.p95} ms (limit ${max}), ${r.requests} requests, non-2xx ${(ratio * 100).toFixed(2)}%`,
    );
    if (r.requests === 0) failures.push(`${r.name}: no requests completed`);
    else if (ratio > t.max_non2xx_ratio)
      failures.push(`${r.name}: ${(ratio * 100).toFixed(2)}% non-2xx (limit ${t.max_non2xx_ratio * 100}%)`);
    if (!(r.p95 <= max)) failures.push(`${r.name}: p95 ${r.p95} ms above ${max} ms`);
  }
  return { failures, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [report, thresholds] = process.argv.slice(2);
  const t = JSON.parse(
    readFileSync(thresholds ?? join(dirname(fileURLToPath(import.meta.url)), "load-thresholds.json"), "utf8"),
  );
  const { failures, lines } = gate(parseReport(readFileSync(report, "utf8")), t);
  for (const l of lines) console.log(l);
  for (const f of failures) console.log(`::error::${f}`);
  process.exit(failures.length ? 1 : 0);
}
