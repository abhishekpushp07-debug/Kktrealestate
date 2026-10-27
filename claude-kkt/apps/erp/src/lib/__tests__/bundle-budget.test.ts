/**
 * Audit v3 C9: the ERP build enforces a bundle budget (scripts/bundle-budget.mjs, run by `pnpm build`). These tests pin the analysis
 * on a synthetic manifest and check the wiring (manifest on, budget in the build script, heavy pages lazy, fonts not blocking).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyse, BUDGETS, MUST_BE_LAZY, type Manifest } from "../../../scripts/bundle-budget.mjs";

const ROOT = path.resolve(__dirname, "../../..");
const KB = 1024;

function manifest(extra: Manifest = {}): Manifest {
  const lazy = Object.fromEntries(
    MUST_BE_LAZY.map((src, i) => [
      src,
      { file: `assets/page${i}.js`, src, isDynamicEntry: true, imports: ["_charts.js"] },
    ]),
  );
  return {
    "index.html": {
      file: "assets/index.js",
      isEntry: true,
      imports: ["_react.js", "_ui.js"],
      css: ["assets/index.css"],
    },
    "_react.js": { file: "assets/react.js" },
    "_ui.js": { file: "assets/ui.js" },
    "_charts.js": { file: "assets/charts-x.js" },
    ...lazy,
    ...extra,
  };
}

const sizes: Record<string, number> = {
  "assets/index.js": 70 * KB,
  "assets/react.js": 100 * KB,
  "assets/ui.js": 80 * KB,
  "assets/charts-x.js": 116 * KB,
  "assets/index.css": 15 * KB,
};
const sizeOf = (file: string) => sizes[file] ?? 5 * KB;

describe("bundle budget analysis", () => {
  it("sums the entry and its static imports as the first load; lazy pages and charts are excluded", () => {
    const report = analyse(manifest(), sizeOf);
    expect(report.firstLoad.js.map((c) => c.file).sort()).toEqual([
      "assets/index.js",
      "assets/react.js",
      "assets/ui.js",
    ]);
    expect(report.firstLoad.jsGzipKb).toBe(250);
    expect(report.firstLoad.cssGzipKb).toBe(15);
    expect(report.failures).toEqual([]);
  });

  it("fails when the first load grows past the budget or a chunk is too big", () => {
    const report = analyse(manifest(), (f) => (f === "assets/ui.js" ? 200 * KB : sizeOf(f)));
    expect(report.failures.join("\n")).toMatch(/first-load JS 370 KB gzip > budget/);
    expect(report.failures.join("\n")).toMatch(/chunk assets\/ui\.js 200 KB gzip > budget/);
  });

  it("fails when the charts chunk or a heavy page becomes part of the first load", () => {
    const m = manifest();
    m["index.html"]!.imports = ["_react.js", "_ui.js", "_charts.js", MUST_BE_LAZY[0]!];
    const failures = analyse(m, sizeOf).failures.join("\n");
    expect(failures).toMatch(/charts vendor chunk/);
    expect(failures).toMatch(new RegExp(`${MUST_BE_LAZY[0]} is part of the first load`));
    const missing = manifest();
    delete missing[MUST_BE_LAZY[1]!];
    expect(analyse(missing, sizeOf).failures.join("\n")).toMatch(/is not a chunk of its own/);
  });

  it("the budgets stay tight", () => {
    expect(BUDGETS.firstLoadJsGzipKb).toBeLessThanOrEqual(300);
    expect(BUDGETS.chunkGzipKb).toBeLessThanOrEqual(130);
  });
});

describe("build wiring", () => {
  it("the build writes a manifest and runs the budget", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toMatch(/vite build && node scripts\/bundle-budget\.mjs/);
    const config = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    expect(config).toMatch(/manifest: true/);
    expect(config).not.toMatch(/return "vendor"/); // no catch-all vendor chunk on the first load
  });

  it("heavy pages are lazy routes", () => {
    const routes = fs.readFileSync(path.join(ROOT, "src/routes.tsx"), "utf8");
    for (const src of MUST_BE_LAZY) {
      const mod = src.replace(/^src\//, "@/").replace(/\.tsx$/, "");
      expect(routes, src).toContain(`lazy(() => import("${mod}"))`);
    }
  });

  it("the web-font stylesheet is preloaded, not render-blocking", () => {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"[^>]*fonts\.googleapis/s);
    expect(html).toMatch(/id="kkt-fonts"\s+rel="preload"\s+as="style"/);
    expect(fs.readFileSync(path.join(ROOT, "src/main.tsx"), "utf8")).toMatch(/applyPreloadedFonts\(\)/);
  });
});
