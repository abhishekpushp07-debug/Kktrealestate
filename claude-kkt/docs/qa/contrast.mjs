#!/usr/bin/env node
/**
 * WCAG 2.x contrast check of the design tokens of the three front ends (SPEC §18 scenario 14: WCAG-AA contrast).
 *
 * Reads the tokens straight from the sources — apps/erp/src/styles/index.css and apps/web/app/globals.css (`--color-*` in @theme) and
 * apps/portal/src/ui/theme.ts (`colors` + `toneStyles`) — and checks every text/background pair the apps actually use:
 *   normal text ≥ 4.5:1, large text (≥ 24 px, or ≥ 18.66 px bold) and UI components/focus rings ≥ 3:1.
 * Semi-transparent colours (rgba / Tailwind `/NN`) are blended over their background first.
 *
 * Usage: node docs/qa/contrast.mjs [erp|web|portal ...] [--markdown]   (exit code 1 when any pair fails)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------------------------------------------------------------
// colour maths
// ---------------------------------------------------------------------------------------------------------------------------------

/** "#abc" | "#aabbcc" | "rgba(r,g,b,a)" | "rgb(r g b / a)" → {r,g,b,a} */
export function parseColor(input) {
  const s = String(input).trim().toLowerCase();
  if (s === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 };
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: alpha };
  }
  throw new Error(`Unparseable colour: ${input}`);
}

function blend(fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function luminance({ r, g, b }) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio of fg over bg (bg itself blended over `base`, default white). */
export function contrast(fg, bg, base = "#ffffff") {
  const b = blend(parseColor(bg), parseColor(base));
  const f = blend(parseColor(fg), b);
  const [l1, l2] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// token readers
// ---------------------------------------------------------------------------------------------------------------------------------

/** `--color-name: value;` declarations of a Tailwind 4 stylesheet. */
function cssTokens(path) {
  const css = readFileSync(join(root, path), "utf8");
  const out = {};
  for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

/** `colors` object and `toneStyles` of the portal theme (plain literals, read without executing TS). */
function portalTokens() {
  const src = readFileSync(join(root, "apps/portal/src/ui/theme.ts"), "utf8");
  const block = /export const colors = \{([\s\S]*?)\} as const;/.exec(src)[1];
  const colors = {};
  for (const m of block.matchAll(/(\w+):\s*"([^"]+)"/g)) colors[m[1]] = m[2];
  const tones = {};
  const toneBlock = /export const toneStyles[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src)[1];
  const val = (v) => (v.startsWith("colors.") ? colors[v.slice(7)] : v.replace(/"/g, ""));
  for (const m of toneBlock.matchAll(/(\w+):\s*\{\s*bg:\s*([^,]+),\s*fg:\s*([^,]+),\s*border:\s*([^}]+?)\s*\}/g)) tones[m[1]] = { bg: val(m[2].trim()), fg: val(m[3].trim()), border: val(m[4].trim()) };
  return { colors, tones };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// pairs per app: [label, fg, bg, min, base?]  (min 4.5 normal text, 3 large text / UI components)
// ---------------------------------------------------------------------------------------------------------------------------------

function erpPairs() {
  const t = cssTokens("apps/erp/src/styles/index.css");
  const c = (k) => {
    if (!(k in t)) throw new Error(`ERP token --color-${k} missing`);
    return t[k];
  };
  const pairs = [];
  for (const bg of ["card", "surface", "ivory"]) {
    pairs.push([`ink on ${bg}`, c("ink"), c(bg), 4.5]);
    pairs.push([`ink-muted on ${bg}`, c("ink-muted"), c(bg), 4.5]);
    pairs.push([`ink-subtle (captions, placeholders) on ${bg}`, c("ink-subtle"), c(bg), 4.5]);
    pairs.push([`navy-700 (links) on ${bg}`, c("navy-700"), c(bg), 4.5]);
    pairs.push([`gold-text on ${bg}`, c("gold-text"), c(bg), 4.5]);
    pairs.push([`danger-fg on ${bg}`, c("danger-fg"), c(bg), 4.5]);
    pairs.push([`success-fg on ${bg}`, c("success-fg"), c(bg), 4.5]);
    pairs.push([`warning-fg on ${bg}`, c("warning-fg"), c(bg), 4.5]);
  }
  pairs.push(["white on primary button (navy-950)", "#ffffff", c("navy-950"), 4.5]);
  pairs.push(["white on primary hover (navy-800)", "#ffffff", c("navy-800"), 4.5]);
  pairs.push(["navy-950 on gold button", c("navy-950"), c("gold"), 4.5]);
  pairs.push(["navy-950 on gold hover", c("navy-950"), c("gold-hover"), 4.5]);
  pairs.push(["white on danger button", "#ffffff", c("danger"), 4.5]);
  pairs.push(["white on danger hover", "#ffffff", c("danger-hover"), 4.5]);
  pairs.push(["danger-fg on danger-bg (alerts, chips)", c("danger-fg"), c("danger-bg"), 4.5]);
  pairs.push(["success-fg on success-bg", c("success-fg"), c("success-bg"), 4.5]);
  pairs.push(["warning-fg on warning-bg", c("warning-fg"), c("warning-bg"), 4.5]);
  pairs.push(["info-fg on info-bg", c("info-fg"), c("info-bg"), 4.5]);
  pairs.push(["gold-text on gold-light", c("gold-text"), c("gold-light"), 4.5]);
  for (const s of ["available", "hold", "booked", "sold", "blocked"]) pairs.push([`status chip ${s} (fg on bg)`, c(`status-${s}-fg`), c(`status-${s}-bg`), 4.5]);
  pairs.push(["navy-200 (sidebar text) on navy-950", c("navy-200"), c("navy-950"), 4.5]);
  pairs.push(["navy-100 (sidebar active) on navy-900", c("navy-100"), c("navy-900"), 4.5]);
  pairs.push(["gold (sidebar accent) on navy-950", c("gold"), c("navy-950"), 4.5]);
  pairs.push(["navy-950 on navy-50 (hover rows, code)", c("navy-950"), c("navy-50"), 4.5]);
  // form-control boundaries (WCAG 1.4.11): inputs, selects, comboboxes, checkboxes, radios and the switch track use border-input
  for (const bg of ["card", "surface", "ivory"]) pairs.push([`input / checkbox / radio border (border-input) on ${bg} — UI component`, c("border-input"), c(bg), 3]);
  pairs.push(["input hover border (navy-400) on card — UI component", c("navy-400"), c("card"), 3]);
  pairs.push(["switch track off (border-input) on card — UI component", c("border-input"), c("card"), 3]);
  pairs.push(["switch thumb (white) on track off — UI component", "#ffffff", c("border-input"), 3]);
  pairs.push(["invalid border (danger) on card — UI component", c("danger"), c("card"), 3]);
  pairs.push(["focus ring: navy-950 inner ring on card — UI component", c("navy-950"), c("card"), 3]);
  pairs.push(["focus ring: gold outer ring on navy-950 (sidebar) — UI component", c("gold"), c("navy-950"), 3]);
  return pairs;
}

function webPairs() {
  const t = cssTokens("apps/web/app/globals.css");
  const c = (k) => {
    if (!(k in t)) throw new Error(`web token --color-${k} missing`);
    return t[k];
  };
  const pairs = [];
  for (const bg of ["ivory-50", "ivory-100", "ivory-200"]) {
    pairs.push([`ink on ${bg}`, c("ink"), c(bg), 4.5]);
    pairs.push([`ink-muted on ${bg}`, c("ink-muted"), c(bg), 4.5]);
    pairs.push([`ink-soft (filter labels, meta) on ${bg}`, c("ink-soft"), c(bg), 4.5]);
    pairs.push([`gold-700 (eyebrows, links) on ${bg}`, c("gold-700"), c(bg), 4.5]);
    pairs.push([`danger on ${bg}`, c("danger"), c(bg), 4.5]);
    pairs.push([`success on ${bg}`, c("success"), c(bg), 4.5]);
  }
  pairs.push(["ink-soft on white", c("ink-soft"), "#ffffff", 4.5]);
  pairs.push(["gold-700 on white", c("gold-700"), "#ffffff", 4.5]);
  pairs.push(["gold-600 (large display accents only) on ivory-100", c("gold-600"), c("ivory-100"), 3]);
  pairs.push(["navy-900 on gold-500 (primary pill button)", c("navy-900"), c("gold-500"), 4.5]);
  pairs.push(["navy-900 on gold-400 (button hover)", c("navy-900"), c("gold-400"), 4.5]);
  pairs.push(["white on navy-900 (dark sections)", "#ffffff", c("navy-900"), 4.5]);
  pairs.push(["ivory-100 on navy-900", c("ivory-100"), c("navy-900"), 4.5]);
  pairs.push(["gold-400 (eyebrows on dark) on navy-900", c("gold-400"), c("navy-900"), 4.5]);
  pairs.push(["gold-300 on navy-950 (footer)", c("gold-300"), c("navy-950"), 4.5]);
  pairs.push(["white/70 (muted copy on dark) on navy-900", "rgba(255,255,255,0.7)", c("navy-900"), 4.5]);
  pairs.push(["white/60 (footer meta) on navy-950", "rgba(255,255,255,0.6)", c("navy-950"), 4.5]);
  pairs.push(["navy-200 on navy-900", c("navy-200"), c("navy-900"), 4.5]);
  // form controls (components/ui/Field.tsx CONTROL): white field, border navy-900/55 (painted over the white field), placeholder ink-soft
  const fieldBorder = blendHex("rgba(11,31,58,0.55)", "#ffffff");
  for (const bg of ["#ffffff", c("ivory-50"), c("ivory-100"), c("ivory-200")]) pairs.push([`field border (navy-900/55) next to ${bg} — UI component`, fieldBorder, bg, 3]);
  pairs.push(["field placeholder (ink-soft) on white field", c("ink-soft"), "#ffffff", 4.5]);
  pairs.push(["field focus border + ring (gold-700) on white field — UI component", c("gold-700"), "#ffffff", 3]);
  pairs.push(["consent checkbox accent (gold-700) on white — UI component", c("gold-700"), "#ffffff", 3]);
  pairs.push(["invalid border (danger) on white — UI component", c("danger"), "#ffffff", 3]);
  pairs.push(["focus ring (gold-600) on ivory-100 — UI component", c("gold-600"), c("ivory-100"), 3]);
  return pairs;
}

function portalPairs() {
  const { colors: c, tones } = portalTokens();
  const pairs = [];
  for (const bg of ["surface", "ivory", "surfaceMuted"]) {
    pairs.push([`ink on ${bg}`, c.ink, c[bg], 4.5]);
    pairs.push([`inkMuted on ${bg}`, c.inkMuted, c[bg], 4.5]);
    pairs.push([`inkSubtle (12 px captions, placeholders) on ${bg}`, c.inkSubtle, c[bg], 4.5]);
    pairs.push([`goldText (text accents) on ${bg}`, c.goldText, c[bg], 4.5]);
    pairs.push([`danger on ${bg}`, c.danger, c[bg], 4.5]);
    pairs.push([`success on ${bg}`, c.success, c[bg], 4.5]);
    pairs.push([`warning on ${bg}`, c.warning, c[bg], 4.5]);
    pairs.push([`info on ${bg}`, c.info, c[bg], 4.5]);
    pairs.push([`navy500 on ${bg}`, c.navy500, c[bg], 4.5]);
  }
  for (const [name, tone] of Object.entries(tones)) pairs.push([`chip "${name}" (fg on bg)`, tone.fg, tone.bg, 4.5]);
  pairs.push(["onNavy on navy (primary button, sidebar)", c.onNavy, c.navy, 4.5]);
  pairs.push(["onNavyMuted on navy", c.onNavyMuted, c.navy, 4.5]);
  pairs.push(["onNavySubtle (sidebar captions, placeholders) on navy", c.onNavySubtle, c.navy, 4.5]);
  pairs.push(["onNavySubtle on navy800", c.onNavySubtle, c.navy800, 4.5]);
  pairs.push(["gold on navy (accents)", c.gold, c.navy, 4.5]);
  pairs.push(["dangerOnNavy (field errors on navy) on navy", c.dangerOnNavy, c.navy, 4.5]);
  pairs.push(["navy on gold (gold button)", c.navy, c.gold, 4.5]);
  pairs.push(["navy on gold700 (gold button pressed)", c.navy, c.gold700, 4.5]);
  pairs.push(["danger on dangerBg (danger button)", c.danger, c.dangerBg, 4.5]);
  pairs.push(["onNavy on rgba(255,255,255,0.12) over navy (onNavy button)", c.onNavy, blendHex("rgba(255,255,255,0.12)", c.navy), 4.5]);
  for (const bg of ["surface", "ivory", "surfaceMuted"]) pairs.push([`field border (fieldBorder) on ${bg} — UI component`, c.fieldBorder, c[bg], 3]);
  const navyField = blendHex("rgba(255,255,255,0.08)", c.navy);
  pairs.push(["field border on navy (fieldBorderOnNavy) vs field fill — UI component", c.fieldBorderOnNavy, navyField, 3]);
  pairs.push(["field border on navy (fieldBorderOnNavy) vs navy card — UI component", c.fieldBorderOnNavy, c.navy, 3]);
  pairs.push(["focused field border (goldText) on surface — UI component", c.goldText, c.surface, 3]);
  pairs.push(["focused field border on navy (gold) — UI component", c.gold, navyField, 3]);
  pairs.push(["invalid field border on navy (dangerOnNavy) — UI component", c.dangerOnNavy, navyField, 3]);
  pairs.push(["invalid border (danger) on surface — UI component", c.danger, c.surface, 3]);
  return pairs;
}

function blendHex(fg, bg) {
  const b = blend(parseColor(fg), parseColor(bg));
  const h = (v) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(b.r)}${h(b.g)}${h(b.b)}`;
}

const APPS = { erp: erpPairs, web: webPairs, portal: portalPairs };

export function check(app) {
  return APPS[app]().map(([label, fg, bg, min, note]) => {
    const ratio = contrast(fg, bg);
    // pairs with a note are informational (borders next to labelled fields are not required to meet 3:1; focus rings are paired)
    const pass = note ? true : ratio + 1e-9 >= min;
    return { label, fg, bg, ratio: Math.round(ratio * 100) / 100, min, pass, note: note ?? "" };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const markdown = args.includes("--markdown");
  const apps = args.filter((a) => !a.startsWith("--"));
  let failed = 0;
  for (const app of apps.length ? apps : Object.keys(APPS)) {
    const rows = check(app);
    const bad = rows.filter((r) => !r.pass);
    failed += bad.length;
    if (markdown) {
      console.log(`\n#### ${app} — ${rows.length - bad.length}/${rows.length} pairs pass\n`);
      console.log("| Pair | Foreground | Background | Ratio | Needs | Result |");
      console.log("|---|---|---|---|---|---|");
      for (const r of rows) console.log(`| ${r.label} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio.toFixed(2)}:1 | ${r.note ? r.note : `${r.min}:1`} | ${r.note ? "info" : r.pass ? "pass" : "**FAIL**"} |`);
    } else {
      console.log(`${app}: ${rows.length - bad.length}/${rows.length} pairs pass`);
      for (const r of rows) console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.ratio.toFixed(2).padStart(5)}:1 (≥ ${r.min})  ${r.label}  ${r.fg} on ${r.bg}${r.note ? `  [${r.note}]` : ""}`);
    }
  }
  process.exitCode = failed > 0 ? 1 : 0;
}
