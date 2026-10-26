// axe-core accessibility scans for the three browser QA runners (docs/qa/{erp,web,portal}/browser-qa.cjs).
// One scan per page name and viewport width (1440 and 390), WCAG 2.0/2.1/2.2 A + AA rules. Serious and critical violations are
// defects; moderate/minor ones are listed in the summary. Set AXE=0 to skip the scans.
const { AxeBuilder } = require("@axe-core/playwright");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);

function createAxe(app) {
  const enabled = process.env.AXE !== "0";
  const seen = new Set();
  const pages = [];

  /** Scans the current page once per name@width. Returns the violations (or null when skipped). */
  async function scan(page, name, width, opts = {}) {
    if (!enabled) return null;
    const key = `${name}@${width}`;
    if (seen.has(key)) return null;
    seen.add(key);
    let builder = new AxeBuilder({ page }).withTags(TAGS);
    for (const sel of opts.exclude ?? []) builder = builder.exclude(sel);
    let result;
    try {
      // Reduced motion while scanning: smooth scrolling and scroll-reveal fades would otherwise make axe measure elements mid-scroll or
      // mid-fade (the apps honour prefers-reduced-motion, so this is also a state real users get).
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForTimeout(150);
      result = await builder.analyze();
      await page.emulateMedia({ reducedMotion: null });
    } catch (e) {
      await page.emulateMedia({ reducedMotion: null }).catch(() => {});
      pages.push({ name, width, url: page.url(), error: String(e && e.message ? e.message : e).slice(0, 300), violations: [] });
      return [];
    }
    // axe 4.14 sometimes builds the background stack of text far down a tall, scrolled page without its section (it then reports the
    // page background, e.g. ivory, behind ivory-on-navy text). Re-check those nodes against their nearest opaque ancestor and keep
    // the violation unless that ancestor really fails too; reclassified nodes are listed as `verifiedFalsePositives`.
    const falsePositives = [];
    for (const v of result.violations.filter((x) => x.id === "color-contrast")) {
      const keep = [];
      for (const n of v.nodes) {
        const data = (n.any[0] || {}).data || {};
        const verdict = await page.evaluate(verifyContrastNode, { target: n.target[n.target.length - 1], fg: data.fgColor, bg: data.bgColor, expected: parseFloat(String(data.expectedContrastRatio || "4.5")) }).catch(() => null);
        if (verdict && verdict.falsePositive) falsePositives.push({ target: n.target.join(" "), axe: `${data.fgColor} on ${data.bgColor} = ${data.contrastRatio}`, actual: verdict.detail });
        else keep.push(n);
      }
      v.nodes = keep;
    }
    result.violations = result.violations.filter((v) => v.nodes.length > 0);
    const violations = result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 6).map((n) => n.target.join(" ")),
      summary: (v.nodes[0] && v.nodes[0].failureSummary ? v.nodes[0].failureSummary : "").replace(/\s+/g, " ").slice(0, 400),
    }));
    pages.push({ name, width, url: page.url(), violations, verifiedFalsePositives: falsePositives, passes: result.passes.length, incomplete: result.incomplete.length });
    return violations;
  }

  const blocking = (violations) => (violations ?? []).filter((v) => BLOCKING.has(v.impact));

  function summary() {
    const byRule = {};
    let blockingCount = 0;
    for (const p of pages) {
      for (const v of p.violations) {
        const r = (byRule[v.id] ??= { id: v.id, impact: v.impact, help: v.help, pages: 0, nodes: 0, examples: [] });
        r.pages += 1;
        r.nodes += v.nodes;
        if (r.examples.length < 4) r.examples.push(`${p.name}@${p.width}: ${v.targets[0] ?? ""}`);
        if (BLOCKING.has(v.impact)) blockingCount += 1;
      }
    }
    const scanned = pages.length;
    const at1440 = pages.filter((p) => p.width === 1440).length;
    const at390 = pages.filter((p) => p.width === 390).length;
    const clean = pages.filter((p) => p.violations.length === 0 && !p.error).length;
    return { app, scanned, at1440, at390, clean, blocking: blockingCount, errors: pages.filter((p) => p.error).length, rules: Object.values(byRule).sort((a, b) => b.nodes - a.nodes) };
  }

  function markdown() {
    const s = summary();
    const fp = pages.reduce((n, p) => n + (p.verifiedFalsePositives ? p.verifiedFalsePositives.length : 0), 0);
    const lines = [`axe-core ${require("axe-core/package.json").version} · ${s.scanned} scans (${s.at1440} at 1440 px, ${s.at390} at 390 px) · ${s.clean} with no violation · serious/critical: ${s.blocking}${fp ? ` · ${fp} color-contrast node(s) re-verified as axe stacking false positives` : ""}`];
    if (s.rules.length) {
      lines.push("", "| Rule | Impact | Pages | Nodes | Example |", "|---|---|---|---|---|");
      for (const r of s.rules) lines.push(`| \`${r.id}\` — ${r.help} | ${r.impact} | ${r.pages} | ${r.nodes} | ${r.examples[0] ?? ""} |`);
    }
    return lines.join("\n");
  }

  return { scan, blocking, summary, markdown, pages };
}

/**
 * Runs in the page: is a color-contrast node a stacking false positive? True only when axe's background is the page (html/body)
 * background while the element sits on a nearer opaque ancestor background against which axe's own foreground colour passes.
 */
function verifyContrastNode({ target, fg, bg, expected }) {
  const el = document.querySelector(target);
  if (!el || !fg || !bg) return null;
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; }
    const h = /^#([0-9a-f]{6})$/i.exec(c);
    return h ? { r: parseInt(h[1].slice(0, 2), 16), g: parseInt(h[1].slice(2, 4), 16), b: parseInt(h[1].slice(4, 6), 16), a: 1 } : null;
  };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pageBgs = [document.documentElement, document.body].map((e) => parse(getComputedStyle(e).backgroundColor)).filter((c) => c && c.a > 0);
  const axeBg = parse(bg);
  if (!axeBg || !pageBgs.some((c) => c.r === axeBg.r && c.g === axeBg.g && c.b === axeBg.b)) return { falsePositive: false };
  for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return { falsePositive: false };
    const c = parse(cs.backgroundColor);
    if (c && c.a >= 1) {
      const r = ratio(parse(fg), c);
      return { falsePositive: r >= expected, detail: `${fg} on ${cs.backgroundColor} (${e.tagName.toLowerCase()}) = ${r.toFixed(2)}` };
    }
    if (c && c.a > 0) return { falsePositive: false };
  }
  return { falsePositive: false };
}

module.exports = { createAxe };
