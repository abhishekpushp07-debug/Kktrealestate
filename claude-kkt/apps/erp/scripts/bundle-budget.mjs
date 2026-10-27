#!/usr/bin/env node
/**
 * ERP bundle budget (audit v3 C9). Reads the Vite manifest of a production build (dist/.vite/manifest.json, `build.manifest: true`)
 * and the built files, and fails when a budget is exceeded. No dependencies: sizes are gzip -9 of the files on disk (node:zlib).
 *
 *   node scripts/bundle-budget.mjs [distDir] [--json]     (run by `pnpm build`; `pnpm budget` re-checks an existing dist)
 *
 * Budgets (gzip KB):
 *   - first load: the entry chunk + every chunk it imports statically + its CSS (what index.html loads before the first paint);
 *   - any single JS chunk;
 *   - the charts vendor chunk must never be part of the first load, and the heavy pages (reports, wizards, dashboard, detail
 *     pages) must stay lazy chunks of their own.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const BUDGETS = {
  firstLoadJsGzipKb: 275,
  firstLoadCssGzipKb: 20,
  chunkGzipKb: 130,
};

/** Source modules that must be lazy (dynamic-import) entries, never part of the first load. */
export const MUST_BE_LAZY = [
  "src/features/reports/ReportsPage.tsx",
  "src/features/reports/ReportPage.tsx",
  "src/features/bookings/wizard/BookingWizard.tsx",
  "src/features/inventory/BlockWizard.tsx",
  "src/features/dashboard/DashboardPage.tsx",
  "src/features/bookings/BookingDetailPage.tsx",
  "src/features/crm/CustomerDetailPage.tsx",
  "src/features/inventory/ProjectDetailPage.tsx",
];

const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const kb = (bytes) => Math.round((bytes / 1024) * 100) / 100;

/** Pure analysis of a manifest + a file-size lookup (unit-tested in src/lib/__tests__/bundle-budget.test.ts). */
export function analyse(manifest, sizeOf, budgets = BUDGETS) {
  const entries = Object.entries(manifest);
  const entryKey = entries.find(([, c]) => c.isEntry)?.[0];
  if (!entryKey) throw new Error("manifest has no entry chunk");
  const firstLoad = new Set();
  const walk = (key) => {
    if (firstLoad.has(key) || !manifest[key]) return;
    firstLoad.add(key);
    for (const dep of manifest[key].imports ?? []) walk(dep);
  };
  walk(entryKey);
  const css = new Set();
  for (const key of firstLoad) for (const file of manifest[key].css ?? []) css.add(file);

  const firstJs = [...firstLoad].map((key) => ({ key, file: manifest[key].file, gzip: sizeOf(manifest[key].file) }));
  const firstJsGzip = firstJs.reduce((sum, c) => sum + c.gzip, 0);
  const firstCssGzip = [...css].reduce((sum, file) => sum + sizeOf(file), 0);

  const chunks = entries
    .filter(([, c]) => c.file.endsWith(".js"))
    .map(([key, c]) => ({ key, file: c.file, name: c.name ?? key, gzip: sizeOf(c.file), lazy: !firstLoad.has(key) }))
    .sort((a, b) => b.gzip - a.gzip);

  const failures = [];
  if (kb(firstJsGzip) > budgets.firstLoadJsGzipKb)
    failures.push(`first-load JS ${kb(firstJsGzip)} KB gzip > budget ${budgets.firstLoadJsGzipKb} KB`);
  if (kb(firstCssGzip) > budgets.firstLoadCssGzipKb)
    failures.push(`first-load CSS ${kb(firstCssGzip)} KB gzip > budget ${budgets.firstLoadCssGzipKb} KB`);
  for (const c of chunks)
    if (kb(c.gzip) > budgets.chunkGzipKb)
      failures.push(`chunk ${c.file} ${kb(c.gzip)} KB gzip > budget ${budgets.chunkGzipKb} KB`);
  for (const c of firstJs)
    if (/(^|\/)charts-/.test(c.file)) failures.push(`the charts vendor chunk ${c.file} is part of the first load`);
  for (const src of MUST_BE_LAZY) {
    const c = manifest[src];
    if (!c) failures.push(`${src} is not a chunk of its own (lost its lazy route?)`);
    else if (firstLoad.has(src)) failures.push(`${src} is part of the first load`);
  }
  return {
    firstLoad: { js: firstJs, jsGzipKb: kb(firstJsGzip), cssGzipKb: kb(firstCssGzip), css: [...css] },
    largest: chunks.slice(0, 12).map((c) => ({ file: c.file, gzipKb: kb(c.gzip), lazy: c.lazy })),
    totalJsGzipKb: kb(chunks.reduce((s, c) => s + c.gzip, 0)),
    chunkCount: chunks.length,
    failures,
  };
}

function main() {
  const args = process.argv.slice(2);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(here, "..", "dist"));
  const manifestPath = path.join(dist, ".vite", "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`bundle-budget: ${manifestPath} not found (build with build.manifest: true first)`);
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const cache = new Map();
  const sizeOf = (file) => {
    if (!cache.has(file)) cache.set(file, gz(fs.readFileSync(path.join(dist, file))));
    return cache.get(file);
  };
  const report = analyse(manifest, sizeOf);
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `bundle-budget: first load ${report.firstLoad.jsGzipKb} KB JS + ${report.firstLoad.cssGzipKb} KB CSS (gzip) in ` +
        `${report.firstLoad.js.length} chunks; ${report.chunkCount} chunks, ${report.totalJsGzipKb} KB JS in all`,
    );
    for (const c of report.firstLoad.js) console.log(`  first load  ${c.file}  ${kb(c.gzip)} KB`);
    for (const c of report.largest.filter((x) => x.lazy).slice(0, 6))
      console.log(`  lazy        ${c.file}  ${c.gzipKb} KB`);
  }
  if (report.failures.length) {
    for (const f of report.failures) console.error(`bundle-budget: FAIL ${f}`);
    process.exit(1);
  }
  if (!args.includes("--json")) console.log("bundle-budget: OK");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
