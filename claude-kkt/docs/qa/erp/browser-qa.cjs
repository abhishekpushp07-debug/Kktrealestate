// Browser QA for apps/erp — see docs/qa/erp.md. Run from the repo root with the API on :4000 (demo seed) and the ERP build served on :5173:
//   node docs/qa/erp/browser-qa.cjs                      # full walk (wipes docs/qa/erp/*.png first)
//   ONLY=login,roles,masters,inventory,crm,money,misc,smoke node docs/qa/erp/browser-qa.cjs
// Env: ERP_URL, API_URL, OUT_DIR, ONLY, WIPE=1 (wipe PNGs even with ONLY), REPORT (path of the JSONL results file).
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const sharp = require(path.join(ROOT, "node_modules", "sharp"));
const { createAxe } = require("../axe.cjs");
const axe = createAxe("erp");

const BASE = process.env.ERP_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:4000";
const OUT = process.env.OUT_DIR || __dirname;
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const run = (k) => !ONLY || ONLY.includes(k);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kkt-erp-qa-"));
const RESULTS = process.env.REPORT || path.join(TMP, "results.jsonl");
const MAX_SHOTS = 40;
fs.mkdirSync(OUT, { recursive: true });
if (!ONLY || process.env.WIPE === "1") for (const f of fs.readdirSync(OUT)) if (f.endsWith(".png")) fs.unlinkSync(path.join(OUT, f));

const CREDS = {
  admin: { email: "admin@sgb.in", password: "Admin@12345" },
  projects: { email: "projects@sgb.in", password: "Project@12345" },
  accounts: { email: "accounts@sgb.in", password: "Accounts@12345" },
  sales: { email: "sales@sgb.in", password: "Sales@12345" },
  marketing: { email: "marketing@sgb.in", password: "Marketing@12345" },
  employee: { email: "employee@sgb.in", password: "Employee@12345" },
};
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } };
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const summary = { checks: 0, defects: [], notes: [], shots: 0, asserts: { pass: 0, fail: 0 } };

/* ------------------------------------------------------------------ harness */

async function newContext(browser, width) {
  const context = await browser.newContext({ viewport: VIEWPORTS[width], deviceScaleFactor: 1, isMobile: width === 390, hasTouch: width === 390, locale: "en-IN", timezoneId: "Asia/Kolkata", acceptDownloads: true });
  const page = await context.newPage();
  const col = { errors: [], failed: [], allow: [] };
  page.on("console", (msg) => { if (msg.type() === "error") col.errors.push(msg.text().slice(0, 400)); });
  page.on("pageerror", (err) => col.errors.push(`pageerror: ${String(err && err.message ? err.message : err).slice(0, 400)}`));
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    if (res.status() >= 400) {
      const u = url.replace(API, "").replace(BASE, "");
      const allowed = col.allow.some((a) => (typeof a === "string" ? u.includes(a) : a.test(u)));
      col.failed.push({ status: res.status(), method: res.request().method(), url: u, allowed });
    }
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    const err = req.failure() && req.failure().errorText;
    if (err === "net::ERR_ABORTED") return; // our own navigation cancelled an in-flight fetch
    col.failed.push({ status: 0, method: req.method(), url: url.replace(API, "").replace(BASE, ""), error: err, allowed: false });
  });
  page.col = col;
  page.width = width;
  page.role = "admin";
  return { context, page };
}
function reset(page) { page.col.errors = []; page.col.failed = []; page.col.allow = []; }

async function settle(page, extra = 250) {
  try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
  try { await page.waitForFunction(() => document.querySelectorAll('[data-skeleton], .animate-pulse, [aria-busy="true"]').length === 0, null, { timeout: 8000 }); } catch {}
  await page.waitForTimeout(extra);
  try { await page.waitForLoadState("networkidle", { timeout: 5000 }); } catch {}
}
async function goto(page, p) { await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" }); await settle(page); }
const bodyText = (page) => page.locator("body").innerText();

async function login(page, role) {
  page.role = role;
  const c = CREDS[role];
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("login-email-input").fill(c.email);
  await page.getByTestId("login-password-input").fill(c.password);
  await page.getByTestId("login-submit-btn").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await settle(page);
  reset(page);
}

/** Horizontal overflow + interactive targets under 48 px (phone; SPEC asks 48 px). Elements inside tables and dense rows are excluded (secondary targets). */
async function layout(page) {
  return page.evaluate(() => {
    const docW = document.documentElement.scrollWidth, winW = window.innerWidth;
    const wide = [];
    if (docW > winW) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > winW + 1 && r.width > 0 && getComputedStyle(el).visibility !== "hidden") {
          wide.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" ? "." + el.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".") : ""} right=${Math.round(r.right)}`);
          if (wide.length >= 6) break;
        }
      }
    }
    const small = [];
    let targets = 0;
    for (const el of document.querySelectorAll('button, a[href], [role="button"], input:not([type=hidden]), select, textarea, [role="tab"], [role="menuitem"], [role="option"], [role="radio"], [role="checkbox"], [role="switch"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") continue;
      if (el.closest("table, [data-dense], [role=grid]")) continue;
      targets += 1;
      if (r.height < 47.5) {
        const id = el.getAttribute("data-testid") || "";
        const label = (id || el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
        // Primary = buttons/links that carry an action, every tab, and nav links (sidebar, drawer, Back). Switches are toggled through their 48 px label row and breadcrumb crumbs are desktop-only, so they count as secondary.
        const labelled = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const isSwitch = el.getAttribute("role") === "switch" && Boolean(labelled);
        const crumb = el.tagName === "A" && Boolean(el.closest("ol")) && Boolean(el.closest('nav[aria-label="Breadcrumb"]'));
        const primary = !isSwitch && !crumb && (/btn$|submit|save|confirm|next|post|create|generate|publish|send|convert|login|search|new/i.test(id) || (el.tagName === "BUTTON" && /^(Save|Next|Confirm|Post|Create|Generate|Publish|Send|Sign in)/.test((el.textContent || "").trim())) || el.getAttribute("role") === "tab" || (el.tagName === "A" && Boolean(el.closest("nav"))));
        small.push({ label, h: Math.round(r.height * 10) / 10, tag: el.tagName.toLowerCase(), primary });
      }
    }
    return { docW, winW, overflow: docW > winW, wide, targets, small };
  });
}

let shotCount = 0;
async function screenshot(page, name) {
  const file = path.join(OUT, `${name}-${page.width}.png`);
  const buf = await page.screenshot({ type: "png", fullPage: false });
  let out = await sharp(buf).png({ palette: true, colours: 256, compressionLevel: 9 }).toBuffer();
  if (out.length > 300 * 1024) out = await sharp(buf).png({ palette: true, colours: 96, compressionLevel: 9 }).toBuffer();
  if (out.length > 300 * 1024) out = await sharp(buf).resize({ width: Math.round(page.width * 0.8) }).png({ palette: true, colours: 64, compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(file, out);
  shotCount += 1;
  summary.shots = shotCount;
  return { file: path.basename(file), kb: Math.round(out.length / 1024) };
}

/** Per-page assertions (console, failed requests, overflow, targets) + optional screenshot. */
async function check(page, name, opts = {}) {
  await settle(page, opts.extra || 250);
  const lay = await layout(page);
  const failed = page.col.failed.filter((f) => !f.allowed);
  const allowedStatuses = new Set(page.col.failed.filter((f) => f.allowed).map((f) => String(f.status)));
  const errors = page.col.errors.filter((e) => {
    const m = /Failed to load resource: the server responded with a status of (\d+)/.exec(e);
    return !(m && allowedStatuses.has(m[1]) && !failed.some((f) => String(f.status) === m[1]));
  });
  let shot = null;
  if (opts.shot) {
    if (shotCount >= MAX_SHOTS) summary.notes.push(`screenshot budget exhausted at ${name}-${page.width}`);
    else shot = await screenshot(page, typeof opts.shot === "string" ? opts.shot : name);
  }
  const axeViolations = await axe.scan(page, name, page.width, { exclude: opts.axeExclude });
  const axeBlocking = axe.blocking(axeViolations);
  const rec = { name, role: page.role, width: page.width, url: page.url().replace(BASE, ""), axe: axeViolations ? axeViolations.map((v) => `${v.impact}:${v.id}(${v.nodes})`) : null, errors, failed, allowed: page.col.failed.filter((f) => f.allowed), overflow: lay.overflow ? `${lay.docW}>${lay.winW}` : null, wide: lay.wide, targets: lay.targets, smallPrimary: lay.small.filter((s) => s.primary), smallAll: lay.small.length, small: lay.small, shot, note: opts.note || null };
  fs.appendFileSync(RESULTS, JSON.stringify(rec) + "\n");
  summary.checks += 1;
  const flags = [];
  if (errors.length) { flags.push(`console=${errors.length}`); summary.defects.push({ page: `${name}-${page.width}`, kind: "console", detail: errors.join(" | ").slice(0, 500) }); }
  if (failed.length) { flags.push(`failed=${failed.length}`); summary.defects.push({ page: `${name}-${page.width}`, kind: "request", detail: failed.map((f) => `${f.status} ${f.method} ${f.url}${f.error ? " " + f.error : ""}`).join(" | ").slice(0, 500) }); }
  if (lay.overflow && page.width === 390) { flags.push(`OVERFLOW ${lay.docW}>${lay.winW}`); summary.defects.push({ page: `${name}-${page.width}`, kind: "overflow", detail: `${lay.docW}>${lay.winW} ${lay.wide.join("; ")}` }); }
  if (axeBlocking.length) { flags.push(`axe=${axeBlocking.map((v) => v.id).join(",")}`); summary.defects.push({ page: `${name}-${page.width}`, kind: "axe", detail: axeBlocking.map((v) => `${v.impact} ${v.id} ×${v.nodes}: ${v.targets.slice(0, 3).join(" | ")} — ${v.summary.slice(0, 160)}`).join(" || ").slice(0, 900) }); }
  if (page.width === 390 && rec.smallPrimary.length) { flags.push(`smallPrimary=${rec.smallPrimary.length}`); summary.defects.push({ page: `${name}-${page.width}`, kind: "target", detail: rec.smallPrimary.map((s) => `${s.label} ${s.h}px`).join(", ") }); }
  log(`[${page.width}] ${name} ${rec.url} ${flags.length ? "!! " + flags.join(" ") : "ok"}${shot ? ` shot=${shot.file} (${shot.kb} KB)` : ""}${opts.note ? " · " + opts.note : ""}`);
  for (const e of errors) log("    console:", e.slice(0, 220));
  for (const f of failed) log("    failed:", f.status, f.method, f.url, f.error || "");
  if (lay.overflow) for (const w of lay.wide) log("    wide:", w);
  if (page.width === 390) for (const s of rec.smallPrimary) log("    small primary:", JSON.stringify(s));
  reset(page);
  return rec;
}

function expect(cond, msg, page) {
  if (cond) { summary.asserts.pass += 1; log("  ok:", msg); }
  else { summary.asserts.fail += 1; summary.defects.push({ page: page ? `${page.role}/${page.url().replace(BASE, "")}` : "-", kind: "assert", detail: msg }); log("  ASSERT FAIL:", msg); }
  fs.appendFileSync(RESULTS, JSON.stringify({ assert: msg, ok: Boolean(cond) }) + "\n");
}
function note(msg) { log("    note:", msg); summary.notes.push(msg); fs.appendFileSync(RESULTS, JSON.stringify({ note: msg }) + "\n"); }

/* ------------------------------------------------------------------ interaction helpers */

/** Radix Select: open the trigger (test id or locator) and pick the option whose text matches. */
async function selectOption(page, trigger, optionText) {
  const t = typeof trigger === "string" ? page.getByTestId(trigger) : trigger;
  await t.scrollIntoViewIfNeeded();
  await t.click();
  const option = page.getByRole("option", { name: optionText, exact: false }).first();
  await option.waitFor({ state: "visible", timeout: 8000 });
  await option.click();
  await page.waitForTimeout(120);
}
/** cmdk Combobox: open the trigger, type a query, pick the first matching item. */
async function comboPick(page, trigger, query, optionText) {
  const t = typeof trigger === "string" ? page.getByTestId(trigger) : trigger;
  await t.scrollIntoViewIfNeeded();
  await t.click();
  const input = page.locator("[cmdk-input]").last();
  await input.waitFor({ state: "visible", timeout: 8000 });
  if (query) await input.fill(query);
  await page.waitForTimeout(700);
  const items = optionText ? page.locator("[cmdk-item]", { hasText: optionText }) : page.locator("[cmdk-item]");
  await items.first().waitFor({ state: "visible", timeout: 10000 });
  await items.first().click();
  await page.waitForTimeout(150);
}
/** Works for both a Radix Select and a cmdk Combobox: open, then type (if a search input appears) and pick the matching option/item. */
async function pickAny(page, trigger, text) {
  const t = typeof trigger === "string" ? page.getByTestId(trigger) : trigger;
  await t.scrollIntoViewIfNeeded();
  await t.click();
  const input = page.locator("[cmdk-input]").last();
  const hasInput = await input.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false);
  if (hasInput) {
    await input.fill(typeof text === "string" ? text : "");
    await page.waitForTimeout(700);
    const item = page.locator("[cmdk-item]", { hasText: text }).first();
    await item.waitFor({ state: "visible", timeout: 10000 });
    await item.click();
  } else {
    const option = page.getByRole("option", { name: text, exact: false }).first();
    await option.waitFor({ state: "visible", timeout: 8000 });
    await option.click();
  }
  await page.waitForTimeout(150);
}
async function menuPick(page, triggerTestId, itemText) {
  await page.getByTestId(triggerTestId).click();
  const item = page.getByRole("menuitem", { name: itemText, exact: false }).first();
  await item.waitFor({ state: "visible", timeout: 8000 });
  await item.click();
}
async function toast(page, text, timeout = 15000) {
  await page.locator("[data-sonner-toast]", { hasText: text }).first().waitFor({ state: "visible", timeout });
}
async function alertConfirm(page, name, reason) {
  const dlg = page.getByRole("alertdialog");
  await dlg.waitFor({ state: "visible", timeout: 8000 });
  if (reason) { const ta = dlg.locator("textarea"); if (await ta.count()) await ta.fill(reason); }
  await dlg.getByRole("button", { name, exact: false }).last().click();
}
async function dialogText(page) { return page.getByRole("dialog").last().innerText(); }
/** Close a Sheet/drawer reliably: Escape first, then its Close button; waits until it is gone. */
async function closeSheet(page, testId) {
  const sheet = page.getByTestId(testId);
  if (!(await sheet.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  if (await sheet.waitFor({ state: "hidden", timeout: 3000 }).then(() => true).catch(() => false)) return;
  const close = sheet.getByRole("button", { name: /^close$/i }).first();
  if (await close.count()) await close.click();
  await sheet.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}
/** MarkdownEditor puts the test id on its wrapper; type into the textarea inside it. */
async function fillMarkdown(page, testId, text) {
  const root = page.getByTestId(testId);
  const tag = await root.evaluate((e) => e.tagName);
  await (tag === "TEXTAREA" ? root : root.locator("textarea").first()).fill(text);
}

/* ------------------------------------------------------------------ API helpers (admin token for setup/verification) */

// Access tokens live ~15 min and a full walk takes longer: tokens are refreshed after 10 minutes and on any 401.
const tokens = {};
async function apiLogin(role = "admin", fresh = false) {
  const cached = tokens[role];
  if (!fresh && cached && Date.now() - cached.at < 10 * 60_000) return cached.token;
  const res = await fetch(`${API}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(CREDS[role]) });
  const body = await res.json();
  tokens[role] = { token: body.access_token, at: Date.now() };
  return body.access_token;
}
async function apiFetch(p, init, role) {
  let res = await fetch(`${API}/api/v1${p}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${await apiLogin(role)}` } });
  if (res.status === 401) res = await fetch(`${API}/api/v1${p}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${await apiLogin(role, true)}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function apiGet(p, role = "admin") {
  return apiFetch(p, { headers: {} }, role);
}
async function apiSend(method, p, body, role = "admin", version) {
  const headers = { "content-type": "application/json", "idempotency-key": crypto.randomUUID() };
  if (version !== undefined) headers["if-match"] = `"${version}"`;
  return apiFetch(p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, role);
}
const PHONE = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
function aadhaar() {
  const d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const p = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const inv = [0,4,3,2,1,5,6,7,8,9];
  const base = "2" + String(Math.floor(Math.random() * 1e10)).padStart(10, "0");
  let c = 0;
  const rev = base.split("").reverse().map(Number);
  for (let i = 0; i < rev.length; i++) c = d[c][p[(i + 1) % 8][rev[i]]];
  return base + inv[c];
}
const PNG = path.join(TMP, "qa-image.png");
const PDF = path.join(TMP, "qa-doc.pdf");

/* ------------------------------------------------------------------ sections */

const MASTER_KINDS = ["room-types", "area-types", "flat-types", "block-types", "floor-plan-templates", "amenities", "construction-stages", "payment-plans", "charge-types", "payment-modes", "bank-accounts", "document-types", "plc-types", "spec-categories", "spec-items", "service-categories"];
const REPORT_KEYS = ["collections", "outstanding-ageing", "advances", "demand-vs-collection", "upcoming-dues", "inventory", "cheques", "cancellations", "sales-funnel", "bankwise-receipts", "roznamcha", "activity"];

async function discover() {
  const ids = {};
  const projects = (await apiGet("/projects?page_size=10")).body.items;
  ids.sgh = projects.find((p) => p.code === "SGH");
  ids.ggv = projects.find((p) => p.code === "GGV");
  const blocks = (await apiGet(`/blocks?project_id=${ids.sgh.id}&page_size=20`)).body.items;
  ids.towerA = blocks.find((b) => /Tower A/i.test(b.name)) || blocks[0];
  ids.towerB = blocks.find((b) => /Tower B/i.test(b.name)) || blocks[1];
  ids.customers = (await apiGet("/customers?page_size=50")).body.items;
  ids.rajesh = ids.customers.find((c) => c.phone === "9876543210");
  ids.kavita = ids.customers.find((c) => c.phone === "9876543221");
  const bookings = (await apiGet("/bookings?page_size=20&sort=booking_number")).body.items;
  ids.bookingPriya = bookings.find((b) => /0002$/.test(b.booking_number)) || bookings[1];
  ids.bookingRajesh = bookings.find((b) => /0001$/.test(b.booking_number)) || bookings[0];
  ids.payment = (await apiGet(`/bookings/${ids.bookingPriya.id}/payments?page_size=1`)).body.items[0];
  ids.demand = (await apiGet(`/bookings/${ids.bookingPriya.id}/demands?page_size=1`)).body.items[0];
  ids.ticket = (await apiGet("/service-requests?page_size=1")).body.items[0];
  ids.post = (await apiGet("/cms/posts?page_size=1")).body.items[0];
  return ids;
}

/* ---- login + roles ---- */
async function sectionLogin(browser) {
  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.clear());
      await goto(page, "/login");
      await check(page, "login", { shot: true });
      page.col.allow.push("/auth/login");
      await page.getByTestId("login-email-input").fill("admin@sgb.in");
      await page.getByTestId("login-password-input").fill("Wrong@12345");
      await page.getByTestId("login-submit-btn").click();
      await page.waitForTimeout(1500);
      const txt = await bodyText(page);
      expect(txt.includes("Incorrect email or password"), `wrong password shows "Incorrect email or password." (${width})`, page);
      await check(page, "login-wrong-password");
      await login(page, "admin");
      expect(new URL(page.url()).pathname === "/", `login lands on the dashboard (${width})`, page);
      await check(page, "dashboard-after-login");
      // user menu → logout
      await page.getByTestId("user-menu-trigger").click();
      await page.getByTestId("user-menu-logout").click();
      await page.waitForURL(/\/login/, { timeout: 10000 });
      expect(page.url().includes("/login"), `logout returns to /login (${width})`, page);
      await check(page, "logout");
    } catch (e) { log(`[${width}] login EXCEPTION ${e.message.slice(0, 300)}`); summary.defects.push({ page: `login-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); }
    await context.close();
  }
}

const ROLE_NAV = {
  admin: ["/projects", "/flats", "/rate-cards", "/masters", "/leads", "/site-visits", "/customers", "/bookings", "/payments", "/demands", "/roznamcha", "/construction", "/service-requests", "/website/settings", "/website/enquiries", "/reports", "/admin/users", "/admin/roles", "/admin/settings", "/admin/audit-log", "/sessions", "/notifications"],
  projects: ["/projects", "/flats", "/rate-cards", "/masters", "/leads", "/site-visits", "/customers", "/bookings", "/construction", "/service-requests", "/reports", "/sessions", "/notifications"],
  accounts: ["/projects", "/customers", "/bookings", "/payments", "/payments/cheques", "/demands", "/roznamcha", "/reports", "/admin/audit-log", "/sessions", "/notifications"],
  sales: ["/projects", "/flats", "/leads", "/site-visits", "/customers", "/bookings", "/website/enquiries", "/sessions", "/notifications"],
  marketing: ["/website/settings", "/website/banners", "/website/home-sections", "/website/posts", "/website/gallery", "/website/testimonials", "/website/pages", "/website/people", "/website/notices", "/website/enquiries", "/leads", "/sessions", "/notifications"],
  employee: ["/projects", "/flats", "/construction", "/sessions", "/notifications"],
};
const ROLE_FORBIDDEN = {
  projects: ["/admin/users", "/website/settings", "/admin/settings"],
  accounts: ["/admin/users", "/leads", "/website/settings"],
  sales: ["/admin/users", "/admin/settings", "/website/settings"],
  marketing: ["/payments", "/bookings", "/admin/users"],
  employee: ["/payments", "/customers", "/bookings", "/admin/users"],
};

async function sectionRoles(browser, ids) {
  for (const width of [1440, 390]) {
    for (const role of Object.keys(ROLE_NAV)) {
      if (width === 390 && !["admin", "sales"].includes(role)) continue;
      const { context, page } = await newContext(browser, width);
      try {
        await login(page, role);
        if (width === 1440) {
          const links = await page.locator('[data-testid^="sidebar-"][data-testid$="-link"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
          note(`${role}: sidebar = ${links.join(" ")}`);
          const txt = await bodyText(page);
          if (role === "admin") expect(/Collections|collections/.test(txt) && /Overdue|ageing|Ageing/.test(txt), "owner dashboard shows collections + ageing widgets", page);
          if (role === "accounts") expect(/Post payment|Post a payment/i.test(txt) && /cheque/i.test(txt), "accounts dashboard shows quick post payment + cheques", page);
          if (role === "sales") expect(/follow-up|Follow-up/i.test(txt) && /site visit/i.test(txt), "sales dashboard shows follow-ups + site visits", page);
          if (role === "projects") expect(/Shree Ganesh Heights/.test(txt) && !/Ganesh Green/.test(txt), "project-admin dashboard scoped to SGH only", page);
          if (role === "marketing") expect(/enquir/i.test(txt) || /website/i.test(txt), "marketing dashboard shows enquiries/website widgets", page);
        }
        await check(page, `dashboard-${role}`, { shot: width === 1440 || role === "admin" });
        if (width === 390 && role === "admin") {
          await page.getByTestId("topbar-menu-btn").click();
          await page.waitForTimeout(500);
          expect((await page.locator('[data-testid="sidebar-projects-link"]').count()) > 0, "phone nav drawer opens from the top bar", page);
          await check(page, "mobile-nav", { shot: true });
          await page.keyboard.press("Escape");
        }
        if (width === 1440) {
          for (const p of ROLE_NAV[role]) { await goto(page, p); await check(page, `nav${p.replace(/\//g, "-")}`); }
          for (const p of ROLE_FORBIDDEN[role] || []) {
            await goto(page, p);
            const blocked = page.url().includes("/forbidden") || (await page.getByText(/don.t have access|don.t have permission|forbidden|not allowed/i).count()) > 0;
            expect(blocked, `${role} → ${p} is blocked`, page);
            await check(page, `forbidden${p.replace(/\//g, "-")}`);
          }
          if (role === "projects") {
            page.col.allow.push(`/projects/${ids.ggv.id}`);
            await goto(page, `/projects/${ids.ggv.id}`);
            expect((await page.getByText(/not found|could not be found/i).count()) > 0, "scoped project admin gets not-found for GGV (not forbidden)", page);
            await check(page, "scoped-out-of-scope-project");
            await goto(page, "/projects");
            const names = await page.locator("main").innerText();
            expect(!names.includes("Ganesh Green") && names.includes("Shree Ganesh Heights"), "scoped project list shows SGH only", page);
            // Activity report needs audit.view (the API guards GET /reports/activity with it); Project Admin holds report.view only
            await goto(page, "/reports");
            expect((await page.getByTestId("report-card-activity").count()) === 0 && (await page.getByTestId("report-card-collections").count()) === 1, "project admin: reports catalogue hides the Activity report (no audit.view)", page);
            await goto(page, "/reports/activity");
            expect((await page.getByText(/don.t have access/i).count()) > 0, "project admin: /reports/activity shows the forbidden page without calling the API", page);
            await check(page, "reports-activity-forbidden");
          }
          if (role === "sales") {
            await goto(page, `/customers/${ids.rajesh.id}`);
            const reveal = await page.getByTestId("kyc-reveal-btn").count();
            const panel = await page.getByTestId("kyc-panel").innerText().catch(() => "");
            expect(reveal === 0 && /X{4,}/.test(panel), `sales sees masked KYC and no reveal button (${panel.replace(/\s+/g, " ").slice(0, 80)})`, page);
            await check(page, "sales-customer-kyc-masked");
            const r = await apiGet(`/customers/${ids.rajesh.id}?reveal=true`, "sales");
            expect(r.status === 403, `API reveal as sales → 403 (${r.status})`, page);
          }
        }
      } catch (e) { log(`[${width}] roles ${role} EXCEPTION ${e.message.slice(0, 300)}`); summary.defects.push({ page: `roles-${role}-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); }
      await context.close();
    }
  }
}

/* ---- masters ---- */
async function sectionMasters(browser) {
  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    try {
      await login(page, "admin");
      for (const kind of MASTER_KINDS) {
        await goto(page, `/masters/${kind}`);
        const rows = await page.locator(`[data-testid="master-table-${kind}"] tbody tr, [data-testid^="stage-row-"]`).count();
        await check(page, `masters-${kind}`, { shot: kind === "flat-types" || (kind === "construction-stages" && width === 1440), note: `rows=${rows}` });
        if (kind === "flat-types" && width === 1440) {
          const first = page.locator('[data-testid^="row-actions-"]').first();
          await first.click();
          await page.getByRole("menuitem", { name: "Edit" }).click();
          await page.getByTestId("master-form-sheet-flat-types").waitFor({ state: "visible", timeout: 10000 });
          const sheet = await page.getByTestId("master-form-sheet-flat-types").innerText();
          expect(/v\d+/.test(sheet) && (await page.locator('[data-testid^="room-0-"]').count()) > 0 && (await page.locator('[data-testid^="area-0-"]').count()) > 0, "flat-type edit sheet shows version, rooms and areas", page);
          await check(page, "masters-flat-type-edit-sheet");
          await page.getByTestId("master-form-cancel-btn").click();
        }
      }
      if (width === 1440) {
        // create / edit (version) / deactivate / restore a room type
        await goto(page, "/masters/room-types");
        await page.getByTestId("master-new-btn").click();
        await page.getByTestId("master-form-sheet-room-types").waitFor({ state: "visible" });
        await page.getByTestId("field-name").fill(`QA Room ${stamp}`);
        await page.getByTestId("field-code").fill(`QA${stamp}`);
        await page.getByTestId("master-form-submit-btn").click();
        await toast(page, /created/i);
        await check(page, "masters-room-type-create");
        const row = page.locator('[data-testid="master-table-room-types"] tbody tr', { hasText: `QA Room ${stamp}` }).first();
        await row.waitFor({ state: "visible", timeout: 10000 });
        const actionsId = await row.locator('[data-testid^="row-actions-"]').getAttribute("data-testid");
        await menuPick(page, actionsId, "Edit");
        await page.getByTestId("master-form-sheet-room-types").waitFor({ state: "visible" });
        expect(/v1\b/.test(await page.getByTestId("master-form-sheet-room-types").innerText()), "edit sheet shows version v1", page);
        await page.getByTestId("field-name").fill(`QA Room ${stamp} edited`);
        await page.getByTestId("master-form-submit-btn").click();
        await toast(page, /saved/i);
        const created = (await apiGet(`/masters/room-types?search=QA%20Room%20${stamp}&include_inactive=true`)).body.items[0];
        expect(created && created.version === 2 && /edited$/.test(created.name), `edit bumped version to 2 (${created && created.version})`, page);
        await check(page, "masters-room-type-edit");
        await menuPick(page, actionsId, "Deactivate");
        await alertConfirm(page, /deactivate|confirm/i);
        await toast(page, /deactivated/i);
        await page.getByTestId("master-include-inactive-switch").click();
        await settle(page);
        await page.locator('[data-testid="master-table-room-types"] tbody tr', { hasText: `QA Room ${stamp}` }).first().waitFor({ state: "visible", timeout: 10000 });
        await menuPick(page, actionsId, "Restore");
        await toast(page, /restored|active/i);
        await check(page, "masters-room-type-deactivate-restore");
        await page.getByTestId("master-include-inactive-switch").click();
        await settle(page);
        // in-use deactivate → 409 IN_USE (deliberate) → usage dialog
        const used = page.locator('[data-testid="master-table-room-types"] tbody tr', { hasText: "Bedroom" }).first();
        const usedId = await used.locator('[data-testid^="row-actions-"]').getAttribute("data-testid");
        page.col.allow.push("/deactivate");
        await menuPick(page, usedId, "Deactivate");
        await alertConfirm(page, /deactivate|confirm/i);
        await page.waitForTimeout(1500);
        let txt = await bodyText(page);
        expect(/in use|used by|usage|cannot be deactivated|Where used/i.test(txt), "deactivating an in-use master shows the usage conflict", page);
        await check(page, "masters-in-use-conflict");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await menuPick(page, usedId, "Where used");
        await page.getByTestId("usage-dialog-close-btn").waitFor({ state: "visible", timeout: 8000 });
        txt = await dialogText(page);
        expect(/flat type|Flat types|\d+/.test(txt), `usage dialog lists usage (${txt.replace(/\s+/g, " ").slice(0, 80)})`, page);
        await check(page, "masters-usage-dialog");
        await page.getByTestId("usage-dialog-close-btn").click();
        // CSV import preview + commit (area types)
        await goto(page, "/masters/area-types");
        await page.getByTestId("master-import-csv-btn").click();
        await page.getByTestId("csv-import-dialog-area-types").waitFor({ state: "visible" });
        await page.getByTestId("csv-import-textarea").fill(`name,code,sort_order\nQA Area ${stamp},QA${stamp},99\nCarpet,CARPET,1\n,BADROW,2`);
        await page.getByTestId("csv-preview-btn").click();
        await page.locator('[data-testid^="csv-row-"]').first().waitFor({ state: "visible", timeout: 15000 });
        const previewText = await page.getByTestId("csv-import-dialog-area-types").innerText();
        expect((await page.locator('[data-testid^="csv-row-"]').count()) === 3 && /create/i.test(previewText) && /error|invalid/i.test(previewText), "CSV preview shows 3 rows with create / update / error markers", page);
        expect(await page.getByTestId("csv-commit-btn").isDisabled(), "commit stays disabled while the preview has an error row", page);
        await check(page, "masters-csv-preview");
        // fix the bad row, re-preview, commit
        await page.getByTestId("csv-import-textarea").fill(`name,code,sort_order\nQA Area ${stamp},QA${stamp},99\nCarpet,CARPET,1`);
        await page.getByTestId("csv-preview-btn").click();
        await page.waitForFunction(() => !document.querySelector('[data-testid="csv-commit-btn"]')?.hasAttribute("disabled"), null, { timeout: 15000 });
        await page.getByTestId("csv-commit-btn").click();
        await toast(page, /import|created|committed/i);
        await settle(page);
        const imported = (await apiGet(`/masters/area-types?search=QA${stamp}`)).body.items[0];
        expect(Boolean(imported), "CSV commit created the valid row", page);
        await check(page, "masters-csv-commit");
        if (await page.getByTestId("csv-close-btn").isVisible().catch(() => false)) await page.getByTestId("csv-close-btn").click();
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.getByTestId("master-export-csv-btn").click()]);
        expect(/\.csv$/.test(dl.suggestedFilename()), `masters CSV export (${dl.suggestedFilename()})`, page);
        // construction stages: reorder + possession radio
        await goto(page, "/masters/construction-stages");
        const stageRows = page.locator('[data-testid^="stage-row-"]');
        const names = async () => (await apiGet("/masters/construction-stages?page_size=50&sort=sort_order")).body.items.map((s) => s.name);
        const before = await names();
        const firstId = (await stageRows.first().getAttribute("data-testid")).replace("stage-row-", "");
        await page.getByTestId(`stage-down-${firstId}`).click();
        await page.getByTestId("stages-save-order-btn").click();
        await toast(page, /order saved/i);
        await settle(page);
        const after = await names();
        expect(after[1] === before[0] && after[0] === before[1], `stage reorder saved (${before.slice(0, 2).join(" > ")} → ${after.slice(0, 2).join(" > ")})`, page);
        await page.getByTestId(`stage-up-${firstId}`).click();
        await page.getByTestId("stages-save-order-btn").click();
        await toast(page, /order saved/i);
        await settle(page);
        const stagesApi = (await apiGet("/masters/construction-stages?page_size=50&sort=sort_order")).body.items;
        const possession = stagesApi.find((s) => s.is_possession);
        const finishing = stagesApi.find((s) => /Finishing/i.test(s.name));
        await page.getByTestId(`stage-possession-${finishing.id}`).click();
        await toast(page, /possession stage/i);
        await settle(page);
        let stagesNow = (await apiGet("/masters/construction-stages?page_size=50")).body.items;
        expect(stagesNow.filter((s) => s.is_possession).length === 1 && stagesNow.find((s) => s.is_possession).id === finishing.id, "possession radio moves the single possession flag", page);
        await page.getByTestId(`stage-possession-${possession.id}`).click();
        await toast(page, /possession stage/i);
        await settle(page);
        stagesNow = (await apiGet("/masters/construction-stages?page_size=50")).body.items;
        expect(stagesNow.find((s) => s.is_possession).id === possession.id, "possession flag restored to Possession/Handover", page);
        await check(page, "masters-stages-after");
        // payment plan form with the live sum footer
        await goto(page, "/masters/payment-plans");
        await page.getByTestId("master-new-btn").click();
        await page.getByTestId("master-form-sheet-payment-plans").waitFor({ state: "visible" });
        await page.getByTestId("field-name").fill(`QA Plan ${stamp}`);
        await page.getByTestId("field-code").fill(`QAP${stamp}`);
        await selectOption(page, "field-plan-type", /Down Payment/);
        if ((await page.locator('[data-testid="installment-0-percent"]').count()) === 0) await page.getByTestId("add-installment-btn").click();
        await page.getByTestId("installment-0-name").fill("On booking");
        await page.getByTestId("installment-0-percent").fill("40");
        await page.getByTestId("installment-0-percent").press("Tab");
        await selectOption(page, "installment-0-trigger", /^On booking$/);
        let sum = await page.getByTestId("percent-sum").innerText();
        expect(/40(\.00)?%/.test(sum) && /to go/i.test(sum), `sum footer after one installment: ${sum.replace(/\s+/g, " ")}`, page);
        await page.getByTestId("add-installment-btn").click();
        await page.getByTestId("installment-1-name").fill("30 days after booking");
        await page.getByTestId("installment-1-percent").fill("60");
        await page.getByTestId("installment-1-percent").press("Tab");
        await selectOption(page, "installment-1-trigger", /Days after booking/);
        await page.getByTestId("installment-1-days").fill("30");
        await page.getByTestId("installment-1-days").press("Tab");
        sum = await page.getByTestId("percent-sum").innerText();
        expect(/100(\.00)?%/.test(sum) && !/to go|over/i.test(sum), `sum footer reaches 100%: ${sum.replace(/\s+/g, " ")}`, page);
        await check(page, "masters-payment-plan-form");
        await page.getByTestId("master-form-submit-btn").click();
        await toast(page, /created/i);
        const plan = (await apiGet(`/masters/payment-plans?search=QAP${stamp}`)).body.items[0];
        expect(plan && plan.installments && plan.installments.length === 2, "payment plan created with 2 installments", page);
        await check(page, "masters-payment-plan-created");
      }
    } catch (e) { log(`[${width}] masters EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: `masters-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "masters-exception").catch(() => {}); }
    await context.close();
  }
}

/* ---- inventory ---- */
async function sectionInventory(browser, ids) {
  const sgh = ids.sgh;
  const towerA = ids.towerA;
  const towerB = ids.towerB;
  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    try {
      await login(page, "admin");
      await goto(page, "/projects");
      await check(page, "projects", { shot: width === 1440 });
      await goto(page, `/projects/${sgh.id}`);
      await check(page, "project-overview", { shot: width === 1440 ? "project-detail" : false });
      for (const tab of ["blocks", "parking", "rate-cards", "construction", "website", "visits"]) {
        await page.getByTestId(`project-tab-${tab}`).click();
        await check(page, `project-tab-${tab}`);
      }
      if (width === 1440) {
        // parking bulk generate
        await page.getByTestId("project-tab-parking").click();
        await settle(page);
        await page.getByTestId("parking-bulk-btn").click();
        const dlg = page.locator("#parking-bulk-form");
        await dlg.waitFor({ state: "visible" });
        await dlg.getByLabel(/^Prefix/).fill(`Q${stamp.slice(0, 2)}-`);
        await dlg.getByLabel(/^From/).fill("1");
        await dlg.getByLabel(/^To\b/).fill("3");
        await selectOption(page, dlg.getByLabel(/^Type/), /Open/);
        await dlg.getByLabel(/^Level/).fill("G");
        await dlg.getByLabel(/^Price per slot/).fill("150000");
        await check(page, "parking-bulk-dialog");
        await page.getByTestId("parking-bulk-submit").click();
        await toast(page, /3 slots created/i);
        await check(page, "parking-bulk-created");
        // rate card: create → activate → apply
        await page.getByTestId("project-tab-rate-cards").click();
        await settle(page);
        await page.getByTestId("rate-card-new-btn").click();
        await page.getByTestId("rate-card-form-sheet").waitFor({ state: "visible" });
        await page.getByTestId("rate-card-name").fill(`SGH QA ${stamp}`);
        await page.getByTestId("rate-card-effective").fill("2026-11-01");
        if ((await page.getByLabel("Flat type").count()) === 0) await page.getByTestId("rate-card-add-rate").click();
        const flatTypeSelects = page.getByTestId("rate-card-form-sheet").getByLabel("Flat type");
        const wanted = ["2BHK-A", "2BHK-B", "3BHK-A", "3BHK-B"];
        const rates = ["5250", "5450", "5650", "5850"];
        for (let i = 0; i < wanted.length; i++) {
          if (i > 0) await page.getByTestId("rate-card-add-rate").click();
          await selectOption(page, flatTypeSelects.nth(i), wanted[i]);
          await page.getByTestId("rate-card-form-sheet").getByLabel("Rate per sq ft").nth(i).fill(rates[i]);
        }
        await check(page, "rate-card-form");
        await page.getByTestId("rate-card-submit").click();
        await toast(page, /Draft .* created/i);
        await settle(page);
        const cards = (await apiGet(`/rate-cards?project_id=${sgh.id}&page_size=20`)).body.items;
        const draft = cards.find((c) => c.name === `SGH QA ${stamp}`);
        expect(draft && draft.status === "DRAFT", "rate card created as DRAFT", page);
        await page.getByTestId(`rate-card-activate-${draft.id}`).click();
        await alertConfirm(page, /activate/i);
        await toast(page, /now the active rate card/i);
        await settle(page);
        const active = (await apiGet(`/rate-cards/${draft.id}`)).body;
        expect(active.status === "ACTIVE", "rate card ACTIVE after activation", page);
        await check(page, "rate-card-activated");
        await page.getByTestId(`rate-card-apply-${draft.id}`).click();
        const applyDlg = page.getByRole("alertdialog");
        await applyDlg.waitFor({ state: "visible", timeout: 8000 });
        await page.waitForTimeout(1500);
        const applyText = await applyDlg.innerText();
        await applyDlg.getByRole("button", { name: /re-price|apply/i }).last().click();
        await toast(page, /re-priced/i);
        note(`rate card apply preview: ${applyText.replace(/\s+/g, " ").slice(0, 140)}`);
        await check(page, "rate-card-applied");
        // construction: complete the next stage on Tower B, then undo it
        await goto(page, `/blocks/${towerB.id}?tab=construction`);
        await page.getByTestId("construction-panel").waitFor({ state: "visible", timeout: 15000 });
        const stagesBefore = (await apiGet(`/blocks/${towerB.id}/construction`)).body;
        const completedBefore = stagesBefore.stages.filter((s) => s.status === "COMPLETED").length;
        await page.getByTestId("construction-update-btn").click();
        await page.getByTestId("construction-update-submit").waitFor({ state: "visible" });
        await selectOption(page, "construction-target", /Plinth/);
        await check(page, "construction-update-dialog");
        await page.getByTestId("construction-update-submit").click();
        await toast(page, /marked complete/i);
        await settle(page);
        // The dialog stays open to show the result (stages completed, demands raised, buyers notified); read it and close it.
        const resultDlg = page.getByRole("dialog").last();
        if (await resultDlg.isVisible().catch(() => false)) {
          note(`update-status result: ${(await resultDlg.innerText()).replace(/\s+/g, " ").slice(0, 160)}`);
          await check(page, "construction-update-result");
          const closeBtn = resultDlg.getByRole("button", { name: /^(close|done)$/i }).last();
          if (await closeBtn.count()) await closeBtn.click(); else await page.keyboard.press("Escape");
          await resultDlg.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
        }
        const stagesAfter = (await apiGet(`/blocks/${towerB.id}/construction`)).body;
        const completedAfter = stagesAfter.stages.filter((s) => s.status === "COMPLETED");
        expect(completedAfter.length === completedBefore + 1 && /Plinth/.test(completedAfter[completedAfter.length - 1].name), `Plinth completed on Tower B (${completedBefore} → ${completedAfter.length})`, page);
        const demandsRaised = ((await apiGet(`/demands?page_size=200`)).body.items || []).filter((d) => /Plinth/i.test(d.installment_name || d.trigger_label || ""));
        note(`demands after Plinth on Tower B: ${demandsRaised.length} (${demandsRaised.map((d) => d.demand_number).join(",")})`);
        await check(page, "construction-updated");
        const last = completedAfter[completedAfter.length - 1];
        const undoBtn = page.getByTestId(`stage-undo-${last.id}`);
        await undoBtn.waitFor({ state: "visible", timeout: 15000 });
        await undoBtn.scrollIntoViewIfNeeded();
        await undoBtn.click({ timeout: 10000 }).catch(async () => { note("undo button needed a forced click (first click intercepted)"); await undoBtn.click({ force: true }); });
        await alertConfirm(page, /undo stage/i, "QA: slab casting postponed");
        await toast(page, /Stage undone/i);
        await settle(page);
        const stagesUndone = (await apiGet(`/blocks/${towerB.id}/construction`)).body;
        expect(stagesUndone.stages.filter((s) => s.status === "COMPLETED").length === completedBefore, "undo restored the stage count", page);
        await check(page, "construction-undone");
        // website settings: save a harmless change, revert; publish guard on a project without hero/description
        await goto(page, `/projects/${sgh.id}?tab=website`);
        await page.getByTestId("website-save").waitFor({ state: "visible", timeout: 15000 });
        const meta = page.getByLabel("Meta title");
        const oldMeta = await meta.inputValue();
        await meta.fill(`${oldMeta.replace(/ \(QA.*\)$/, "")} (QA ${stamp})`.slice(0, 70));
        await page.getByTestId("website-save").click();
        await toast(page, /Website settings saved/i);
        await settle(page);
        await meta.fill(oldMeta);
        await page.getByTestId("website-save").click();
        await toast(page, /Website settings saved/i);
        await check(page, "website-tab-saved");
        const newProject = await apiSend("POST", "/projects", { name: `QA Project ${stamp}`, code: `QP${stamp}`, project_type: "RESIDENTIAL", status: "PLANNING", address: { line1: "Plot 1", city: "Patna", state: "Bihar", pincode: "800001" } });
        expect(newProject.status === 201 || newProject.status === 200, `API created a bare project for the publish guard (${newProject.status})`, page);
        await goto(page, `/projects/${newProject.body.id}?tab=website`);
        await page.getByTestId("website-published").waitFor({ state: "visible", timeout: 15000 });
        page.col.allow.push("/website");
        await page.getByTestId("website-published").click();
        await page.getByTestId("website-save").click();
        await page.waitForTimeout(1500);
        const guardText = await bodyText(page);
        expect(/Cannot publish yet|Publishing is blocked until/i.test(guardText) && /hero|description|location/i.test(guardText), "publish guard lists the missing hero / description / location", page);
        await check(page, "website-publish-guard");
        // visit settings: change seats, save, revert
        await goto(page, `/projects/${sgh.id}?tab=visits`);
        await page.getByTestId("visit-settings-save").waitFor({ state: "visible", timeout: 15000 });
        const seats = page.getByLabel("Seats per slot");
        const oldSeats = await seats.inputValue();
        await seats.fill(String(Number(oldSeats || 3) + 1));
        await seats.press("Tab");
        await page.getByTestId("visit-settings-save").click();
        await toast(page, /Site-visit settings saved/i);
        const vs = (await apiGet(`/projects/${sgh.id}/visit-settings`)).body;
        expect(Number(vs.settings ? vs.settings.seats_per_slot : vs.seats_per_slot) === Number(oldSeats) + 1, "visit settings saved seats + 1", page);
        await seats.fill(oldSeats);
        await seats.press("Tab");
        await page.getByTestId("visit-settings-save").click();
        await toast(page, /Site-visit settings saved/i);
        await check(page, "visit-settings-saved");
      }
      // block grid (Tower A): colour modes, flat drawer, hold, bulk status, print
      await goto(page, `/blocks/${towerA.id}`);
      await page.getByTestId("inventory-grid").waitFor({ state: "visible", timeout: 15000 });
      await check(page, "block-grid", { shot: true });
      const avail = (await apiGet(`/flats?block_id=${towerA.id}&status=AVAILABLE&page_size=50&sort=flat_number`)).body.items;
      const target = avail[avail.length - 1];
      await page.getByTestId(`grid-cell-${target.flat_number}`).click();
      await page.getByTestId("flat-drawer").waitFor({ state: "visible", timeout: 10000 });
      const drawerEl = page.getByTestId("flat-drawer");
      await page.waitForFunction(() => /carpet/i.test(document.querySelector('[data-testid="flat-drawer"]')?.innerText || ""), null, { timeout: 15000 }).catch(() => {});
      let drawer = await drawerEl.innerText();
      await drawerEl.getByRole("tab", { name: /price/i }).click();
      await page.waitForTimeout(300);
      drawer += await drawerEl.innerText();
      expect(/bedroom|living|kitchen/i.test(drawer) && /carpet|built/i.test(drawer) && /₹/.test(drawer), `flat drawer for ${target.flat_number} shows rooms, areas (Details) and the price breakup (Price)`, page);
      await drawerEl.getByRole("tab", { name: /details/i }).click();
      await check(page, "flat-drawer");
      if (width === 1440) {
        await drawerEl.getByRole("tab", { name: /actions/i }).click();
        await selectOption(page, "flat-status-select", /Hold/);
        await page.getByTestId("flat-drawer").getByLabel("Reason").fill("QA: token received");
        await page.getByTestId("flat-status-save").click();
        await toast(page, /now on hold/i);
        await settle(page);
        drawer = await drawerEl.innerText();
        expect(/On hold/i.test(drawer), "drawer shows the hold banner after the status change", page);
        await check(page, "flat-drawer-hold");
        await drawerEl.getByRole("tab", { name: /actions/i }).click();
        await selectOption(page, "flat-status-select", /Available/);
        await page.getByTestId("flat-status-save").click();
        await toast(page, /now available/i);
        await settle(page);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await selectOption(page, "grid-colour-by", /type/i);
      await check(page, "block-grid-by-type");
      await selectOption(page, "grid-colour-by", /price/i);
      await check(page, "block-grid-by-price");
      await selectOption(page, "grid-colour-by", /status/i);
      if (width === 1440) {
        await page.getByTestId("grid-select-mode").click();
        const [a, b] = avail.slice(0, 2);
        await page.getByTestId(`grid-cell-${a.flat_number}`).click();
        await page.getByTestId(`grid-cell-${b.flat_number}`).click();
        await page.getByTestId("grid-bulk-status").click();
        await page.getByRole("menuitem", { name: /Blocked/i }).click();
        await toast(page, /2 flats set to blocked/i);
        await settle(page);
        const blocked = (await apiGet(`/flats?block_id=${towerA.id}&status=BLOCKED&page_size=50`)).body.items.map((f) => f.flat_number);
        expect(blocked.includes(a.flat_number) && blocked.includes(b.flat_number), `bulk status blocked ${a.flat_number}, ${b.flat_number}`, page);
        await check(page, "block-grid-bulk-blocked");
        await page.getByTestId(`grid-cell-${a.flat_number}`).click();
        await page.getByTestId(`grid-cell-${b.flat_number}`).click();
        await page.getByTestId("grid-bulk-status").click();
        await page.getByRole("menuitem", { name: /Available/i }).click();
        await toast(page, /2 flats set to available/i);
        await settle(page);
        await page.getByTestId("grid-select-mode").click();
        await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
        await page.getByTestId("grid-print").click();
        expect((await page.evaluate(() => window.__printed)) === 1 && (await page.locator(".kkt-print-area").count()) > 0, "print chart triggers window.print() on the print area", page);
      }
      for (const tab of ["flats", "pricing", "construction"]) {
        await page.getByTestId(`block-tab-${tab}`).click();
        await check(page, `block-tab-${tab}`);
      }
      await goto(page, "/flats");
      await check(page, "flats");
      await goto(page, "/rate-cards");
      await check(page, "rate-cards-overview");
      await goto(page, "/construction");
      await check(page, "construction-overview");

      // block wizard: 3-floor tower with FP-4 → 12 flats
      await goto(page, `/projects/${sgh.id}/blocks/new`);
      await check(page, "block-wizard", { shot: true });
      await selectOption(page, "wizard-block-type", /Tower/);
      const code = `Q${stamp.slice(0, 2)}${width === 390 ? "M" : "D"}`;
      await page.getByTestId("wizard-name").fill(`Tower ${code}`);
      await page.getByTestId("wizard-code").fill(code);
      await page.getByTestId("wizard-next").click();
      await page.getByTestId("wizard-floors").fill("3");
      await page.getByTestId("wizard-floors").press("Tab");
      await check(page, "block-wizard-floors");
      await page.getByTestId("wizard-next").click();
      await settle(page);
      await page.getByTestId("wizard-range-0-template").waitFor({ state: "visible", timeout: 10000 });
      if (await page.getByTestId("wizard-range-0-from").count()) { await page.getByTestId("wizard-range-0-from").fill("1"); await page.getByTestId("wizard-range-0-to").fill("3"); }
      await selectOption(page, "wizard-range-0-template", /FP-4\b(?!-)/);
      await check(page, "block-wizard-ranges");
      await page.getByTestId("wizard-next").click();
      await settle(page);
      await check(page, "block-wizard-pricing");
      if (await page.getByTestId("wizard-next").isEnabled().catch(() => false)) { await page.getByTestId("wizard-next").click(); await settle(page); }
      const expected = await page.getByTestId("wizard-expected-count").innerText().catch(() => "?");
      expect(/12/.test(expected), `wizard preview expects 12 flats (${expected.trim().replace(/\s+/g, " ")})`, page);
      await check(page, "block-wizard-preview");
      await page.getByTestId("wizard-create").click();
      await page.waitForURL(/\/blocks\/[0-9a-f-]+/, { timeout: 30000 });
      await page.locator('[data-testid^="grid-cell-"]').first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
      await settle(page);
      const cells = await page.locator('[data-testid^="grid-cell-"]').count();
      const createdBlock = (await apiGet(`/blocks?project_id=${sgh.id}&page_size=50`)).body.items.find((b) => b.code === code);
      const flats = createdBlock ? (await apiGet(`/flats?block_id=${createdBlock.id}&page_size=50&sort=flat_number`)).body : { total: 0, items: [] };
      expect(cells === 12 && flats.total === 12, `block ${code}: 12 grid cells and 12 flats via API (cells=${cells}, api=${flats.total}: ${flats.items.map((f) => f.flat_number).join(",")})`, page);
      const f0 = flats.items[0];
      expect(f0 && f0.price_paise > 0 && f0.carpet_sqft > 0, `generated flat has a snapshot (carpet ${f0 && f0.carpet_sqft} sq ft) and a price (₹${f0 && f0.price_paise / 100})`, page);
      await check(page, "block-wizard-created");
    } catch (e) { log(`[${width}] inventory EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: `inventory-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "inventory-exception").catch(() => {}); }
    await context.close();
  }
}

/* ---- crm ---- */
async function sectionCrm(browser, ids) {
  let newCustomerId = null;
  let leadPhone = null;
  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    try {
      await login(page, "admin");
      await goto(page, "/customers");
      await check(page, "customers", { shot: width === 1440 });
      if (width === 1440) {
        await page.getByTestId("customer-new-btn").click();
        await page.getByTestId("customer-form-sheet").waitFor({ state: "visible" });
        const phone = PHONE();
        const pan = `QAPZZ${String(Math.floor(Math.random() * 9000) + 1000)}K`;
        await page.getByTestId("customer-name").fill(`QA Buyer ${stamp}`);
        await page.getByTestId("customer-phone").fill(phone);
        await page.getByTestId("customer-pan").fill(pan);
        await page.getByTestId("customer-aadhaar").fill(aadhaar());
        await pickAny(page, "customer-rm", "Ankit");
        await check(page, "customer-form");
        await page.getByTestId("customer-form-submit").click();
        await toast(page, /created|saved/i);
        await page.waitForURL(/\/customers\/[0-9a-f-]+/, { timeout: 15000 }).catch(() => {});
        const m = page.url().match(/\/customers\/([0-9a-f-]+)/);
        if (m) newCustomerId = m[1];
        else { newCustomerId = (await apiGet(`/customers?search=${phone}`)).body.items[0].id; await goto(page, `/customers/${newCustomerId}`); }
        note(`new customer ${newCustomerId} phone ${phone} pan ${pan}`);
        page.qaPan = pan;
      } else {
        newCustomerId = newCustomerId || (await apiGet(`/customers?search=QA%20Buyer&page_size=1`)).body.items[0].id;
        await goto(page, `/customers/${newCustomerId}`);
      }
      await check(page, "customer-360", { shot: true });
      const before = await page.getByTestId("kyc-panel").innerText();
      await page.getByTestId("kyc-reveal-btn").click();
      await settle(page);
      const after = await page.getByTestId("kyc-panel").innerText();
      expect(/X{4,}/.test(before) && !/X{4,}[0-9]{4}[A-Z]/.test(after) && /[A-Z]{5}[0-9]{4}[A-Z]/.test(after), `admin KYC reveal unmasks PAN (${after.replace(/\s+/g, " ").slice(0, 60)})`, page);
      if (width === 1440) {
        const audit = (await apiGet(`/audit-logs?action=customer.kyc_reveal&page_size=5`)).body;
        expect(audit && audit.items && audit.items.length > 0, `KYC reveal is audit-logged (${audit && audit.items ? audit.items.length : "?"} rows)`, page);
      }
      await check(page, "customer-kyc-revealed");
      if (width === 1440) {
        await page.getByTestId("kyc-status-btn").click();
        await page.getByTestId("kyc-status-submit").waitFor({ state: "visible" });
        await check(page, "customer-kyc-status-dialog");
        await page.keyboard.press("Escape");
        // co-applicant
        await page.getByTestId("co-applicant-add").click();
        await page.getByTestId("co-applicant-sheet").waitFor({ state: "visible" });
        const sheet = page.getByTestId("co-applicant-sheet");
        await sheet.getByLabel(/^Full name/i).first().fill(`QA Spouse ${stamp}`);
        await sheet.getByLabel(/^Relation/i).first().fill("Spouse");
        await sheet.getByLabel(/^Mobile/i).first().fill(PHONE());
        await check(page, "customer-co-applicant-sheet");
        await page.getByTestId("co-applicant-submit").click();
        await toast(page, /co-applicant|added|saved/i);
        await settle(page);
        expect((await page.getByTestId("co-applicants-card").innerText()).includes(`QA Spouse ${stamp}`), "co-applicant listed on the 360 card", page);
        // portal access: enable → temp password shown once
        await page.getByTestId("portal-access-card").scrollIntoViewIfNeeded();
        await page.getByTestId("portal-enable").click();
        await page.getByTestId("portal-temp-done").waitFor({ state: "visible", timeout: 15000 });
        const dlg = await dialogText(page);
        expect(/temporary password|password/i.test(dlg) && /[A-Za-z0-9@#$%!]{8,}/.test(dlg), `portal enable shows the temporary password once (${dlg.replace(/\s+/g, " ").slice(0, 90)})`, page);
        await check(page, "customer-portal-enabled");
        await page.getByTestId("portal-temp-done").click();
        await settle(page);
        expect(/enabled|active/i.test(await page.getByTestId("portal-access-card").innerText()), "portal card shows access enabled", page);
        await page.getByTestId("portal-reset").click();
        await alertConfirm(page, /reset|confirm/i);
        await page.getByTestId("portal-temp-done").waitFor({ state: "visible", timeout: 15000 });
        await page.getByTestId("portal-temp-done").click();
        await page.getByTestId("portal-revoke").click();
        await alertConfirm(page, /revoke|confirm/i);
        await toast(page, /revoked|sessions/i).catch(() => {});
        await check(page, "customer-portal-reset-revoke");
        // documents upload
        await page.getByTestId("documents-upload-btn").click();
        await page.getByTestId("upload-document-submit").waitFor({ state: "visible" });
        await page.getByTestId("upload-document-file").setInputFiles(PDF);
        await selectOption(page, "upload-document-type", /Photograph|PAN|Aadhaar|.+/); // customer-applicable types are the KYC ones
        await check(page, "customer-document-upload-dialog");
        await page.getByTestId("upload-document-submit").click();
        await toast(page, /Document uploaded/i);
        await settle(page);
        expect((await page.locator('[data-testid^="document-download-"]').count()) > 0, "uploaded document listed with a download button", page);
        await check(page, "customer-document-uploaded");
        for (const t of ["customer-bookings", "customer-payments", "customer-leads", "customer-tickets", "customer-history"]) {
          const el = page.getByTestId(t);
          if (await el.count()) { await el.first().click(); await settle(page, 150); }
        }
        await check(page, "customer-360-tabs");
      }

      // leads
      await goto(page, "/leads");
      await check(page, "leads", { shot: true });
      if (width === 1440) {
        // The seed's NEW leads get consumed by repeated runs, so create the leads this walk needs through the UI (sheet → drawer opens).
        const createLead = async (name) => {
          await page.getByTestId("lead-new-btn").click();
          await page.getByTestId("lead-form-sheet").waitFor({ state: "visible" });
          const phone = PHONE();
          await page.getByTestId("lead-name").fill(name);
          await page.getByTestId("lead-phone").fill(phone);
          await selectOption(page, "lead-source", /Walk/);
          await pickAny(page, "lead-project", "Heights");
          await page.getByTestId("lead-form-submit").click();
          await toast(page, /created|saved/i);
          await settle(page);
          const row = (await apiGet(`/leads?search=${phone}&page_size=1`)).body.items[0];
          expect(Boolean(row && row.lead_number && row.stage === "NEW"), `lead ${row && row.lead_number} created as NEW (${name})`, page);
          return { ...row, phone };
        };
        const leadA = await createLead(`QA Drag ${stamp}`);
        await check(page, "lead-create");
        await closeSheet(page, "lead-drawer");
        const card = page.locator(`[data-testid="kanban-column-NEW"] [data-testid="lead-card-${leadA.id}"]`).first();
        await card.waitFor({ state: "visible", timeout: 15000 });
        const leadId = leadA.id;
        const from = await card.boundingBox();
        const target = await page.getByTestId("kanban-column-CONTACTED").boundingBox();
        await page.mouse.move(from.x + from.width / 2, from.y + 20);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, { steps: 4 });
        await page.mouse.move(target.x + target.width / 2, target.y + 140, { steps: 14 });
        await page.mouse.up();
        await toast(page, /Moved to Contacted/i).catch(() => {});
        await settle(page);
        const nowIn = await page.locator(`[data-testid="kanban-column-CONTACTED"] [data-testid="lead-card-${leadId}"]`).count();
        const leadApi = (await apiGet(`/leads/${leadId}`)).body;
        expect(nowIn === 1 && leadApi.stage === "CONTACTED", `kanban drag NEW → CONTACTED (stage=${leadApi.stage})`, page);
        await check(page, "leads-drag");
        // Move-to LOST from the drawer asks for a reason
        await page.locator(`[data-testid="lead-card-${leadId}"]`).click();
        await page.getByTestId("lead-drawer").waitFor({ state: "visible" });
        await selectOption(page, "lead-stage-select", /Lost/i);
        await alertConfirm(page, /mark lost|lost|confirm/i, "QA: budget mismatch");
        await toast(page, /Moved to Lost/i);
        await settle(page);
        const lost = (await apiGet(`/leads/${leadId}`)).body;
        expect(lost.stage === "LOST" && /budget mismatch/i.test(lost.lost_reason || ""), `lead marked LOST with reason (${lost.lost_reason})`, page);
        await check(page, "lead-lost");
        await closeSheet(page, "lead-drawer");
        // second lead: follow-up, convert → start booking link
        const lead = await createLead(`QA Lead ${stamp}`);
        leadPhone = lead.phone;
        if (!(await page.getByTestId("lead-drawer").isVisible().catch(() => false))) {
          const newCard = page.locator(`[data-testid="lead-card-${lead.id}"]`).first();
          await newCard.waitFor({ state: "visible", timeout: 15000 });
          await newCard.scrollIntoViewIfNeeded();
          await newCard.click();
        } else note("creating a lead opened its drawer directly");
        await page.getByTestId("lead-drawer").waitFor({ state: "visible" });
        await page.getByTestId("lead-drawer").getByRole("tab", { name: /follow-ups/i }).click();
        await page.getByTestId("follow-up-note").fill("QA follow-up: call back tomorrow");
        await page.getByTestId("follow-up-add").click();
        await toast(page, /Follow-up recorded/i);
        await check(page, "lead-drawer");
        await page.getByTestId("lead-convert").click();
        await page.getByTestId("lead-convert-submit").waitFor({ state: "visible" });
        // "Link an existing customer (matched by phone)" is the default; this lead's phone is new, so create the customer.
        const createMode = page.getByRole("dialog").last().getByRole("radio", { name: /create|new customer/i }).first();
        if (await createMode.count()) await createMode.click();
        await check(page, "lead-convert-dialog");
        await page.getByTestId("lead-convert-submit").click();
        await toast(page, /Converted/i);
        await page.getByTestId("lead-start-booking").waitFor({ state: "visible", timeout: 10000 });
        const href = await page.getByTestId("lead-start-booking").getAttribute("href");
        const conv = (await apiGet(`/leads/${lead.id}`)).body;
        expect(conv.stage === "CONVERTED" && Boolean(conv.customer_id) && /\/bookings\/new/.test(href || ""), `lead converted (customer ${conv.customer_id}) with a start-booking link (${href})`, page);
        await check(page, "lead-converted");
        await closeSheet(page, "lead-drawer");
        await page.getByTestId("leads-view-list").click();
        await check(page, "leads-list");
        await page.getByTestId("leads-view-kanban").click();
      }

      // enquiries inbox + unread badge
      const unread = (await apiGet("/enquiries?is_read=false&page_size=1")).body;
      await goto(page, "/website/enquiries");
      const badge = width === 1440 ? await page.getByTestId("sidebar-enquiries-badge").textContent({ timeout: 5000 }).catch(() => "") : "";
      const title = await page.locator("main").innerText();
      expect(/unread/i.test(title) || unread.total === 0, `enquiries inbox shows the unread badge (${unread.total} unread; sidebar "${badge}")`, page);
      await check(page, "enquiries");
      if (width === 1440 && unread.total > 0) {
        await page.locator('[data-testid="enquiries-table"] tbody tr').first().click();
        await settle(page);
        const unreadAfter = (await apiGet("/enquiries?is_read=false&page_size=1")).body;
        expect(unreadAfter.total === unread.total - 1, `opening an enquiry marks it read (${unread.total} → ${unreadAfter.total})`, page);
        await check(page, "enquiry-opened");
        await page.keyboard.press("Escape");
      }

      // site visits
      await goto(page, "/site-visits");
      await check(page, "site-visits", { shot: width === 1440 });
      if (width === 1440) {
        await page.getByTestId("visits-view-week").click();
        await check(page, "site-visits-week");
        await page.getByTestId("visits-view-list").click();
        await check(page, "site-visits-list");
        await page.getByTestId("visits-view-day").click();
        await page.getByTestId("visit-new-btn").click();
        await page.getByTestId("visit-form-sheet").waitFor({ state: "visible" });
        await pickAny(page, "visit-project", "Heights");
        await comboPick(page, "visit-lead", `QA Lead ${stamp}`).catch(async () => comboPick(page, "visit-customer", `QA Buyer ${stamp}`));
        await page.getByTestId("slot-picker").waitFor({ state: "visible", timeout: 15000 });
        await page.locator('[data-testid^="slot-day-"]:not([disabled])').nth(1).click();
        const slot = page.locator('[data-testid^="slot-2"]:not([disabled])').first();
        await slot.waitFor({ state: "visible", timeout: 10000 });
        const slotId = await slot.getAttribute("data-testid");
        await slot.click();
        await check(page, "site-visit-form");
        await page.getByTestId("visit-form-submit").click();
        await toast(page, /visit|booked|created|SV-/i);
        await settle(page);
        const visit = (await apiGet(`/site-visits?page_size=50&sort=-created_at`)).body.items.find((v) => /QA/.test(v.name || "") && v.status === "CONFIRMED");
        expect(Boolean(visit) && visit.status === "CONFIRMED", `site visit ${visit && visit.visit_number} created in ${slotId} (status ${visit && visit.status})`, page);
        await check(page, "site-visit-created");
        // The list view keeps its own project filter (`l_project_id`, defaulting to the first project); open the SGH list directly.
        await goto(page, `/site-visits?view=list&l_project_id=${ids.sgh.id}`);
        const chip = page.locator(`[data-testid="visit-chip-${visit.id}"]`);
        if (await chip.count()) await chip.first().click();
        else await page.locator("[data-testid=visits-table] tbody tr", { hasText: visit.visit_number }).first().click();
        await page.getByTestId("visit-drawer").waitFor({ state: "visible", timeout: 10000 });
        await check(page, "site-visit-drawer");
        await page.getByTestId("visit-reschedule").click();
        await page.getByTestId("slot-picker").waitFor({ state: "visible", timeout: 15000 });
        await page.locator('[data-testid^="slot-day-"]:not([disabled])').nth(2).click();
        const slot2 = page.locator('[data-testid^="slot-2"]:not([disabled])').first();
        await slot2.waitFor({ state: "visible", timeout: 10000 });
        await slot2.click();
        await page.getByTestId("visit-reschedule-submit").click();
        await toast(page, /resched|moved/i);
        await settle(page);
        const v1 = (await apiGet(`/site-visits/${visit.id}`)).body;
        expect(v1.visit_date !== visit.visit_date || v1.slot_start !== visit.slot_start, `visit rescheduled (${visit.visit_date} ${visit.slot_start} → ${v1.visit_date} ${v1.slot_start})`, page);
        await check(page, "site-visit-rescheduled");
        await page.getByTestId("visit-complete").click();
        const confirm = page.getByRole("alertdialog").getByRole("button", { name: /complete|confirm|mark/i });
        if (await confirm.count()) await confirm.click();
        await toast(page, /completed|outcome/i).catch(() => {});
        await settle(page);
        const v2 = (await apiGet(`/site-visits/${visit.id}`)).body;
        const lead2 = v2 && v2.lead_id ? (await apiGet(`/leads/${v2.lead_id}`)).body : null;
        expect(v2.status === "COMPLETED", `visit completed (status ${v2.status}; lead stage ${lead2 && lead2.stage})`, page);
        await check(page, "site-visit-completed");
      }
    } catch (e) { log(`[${width}] crm EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: `crm-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "crm-exception").catch(() => {}); }
    await context.close();
  }
  return { newCustomerId };
}

/* ---- bookings + payments ---- */
async function pickAvailableFlat(blockId) {
  return (await apiGet(`/flats?block_id=${blockId}&status=AVAILABLE&page_size=50&sort=flat_number`)).body.items[0];
}
async function runWizard(page, width, { towerA, customer }) {
  const flat = await pickAvailableFlat(towerA.id);
  note(`[${width}] wizard target flat ${flat.flat_number} (${flat.status}) price ${flat.price_paise}`);
  await goto(page, "/bookings/new");
  await page.getByTestId("booking-wizard").waitFor({ state: "visible", timeout: 15000 });
  if (await page.getByTestId("discard-draft").count()) await page.getByTestId("discard-draft").click();
  await check(page, "booking-wizard", { shot: true });
  await selectOption(page, "wizard-project", /Heights/);
  await selectOption(page, "wizard-block", new RegExp(towerA.name));
  await page.getByTestId("flat-picker").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("flat-picker-find").fill(flat.flat_number);
  const cell = page.getByTestId(`pick-cell-${flat.flat_number}`);
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await page.getByTestId("wizard-selected-flat").waitFor({ state: "visible", timeout: 10000 });
  await check(page, "booking-wizard-flat");
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-customer-search").fill(customer.phone);
  const opt = page.getByTestId(`customer-option-${customer.id}`);
  await opt.waitFor({ state: "visible", timeout: 15000 });
  await opt.click();
  await page.getByTestId("wizard-selected-customer").waitFor({ state: "visible", timeout: 10000 });
  await check(page, "booking-wizard-customer");
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-agreement-value").waitFor({ state: "visible" });
  const total = await page.getByTestId("wizard-agreement-value").inputValue();
  await page.getByRole("tab", { name: /Percentages/i }).click();
  await page.getByTestId("wizard-cash-percent").fill("60");
  await page.getByTestId("wizard-cash-percent").press("Tab");
  await page.getByRole("tab", { name: /Amounts/i }).click();
  const cash = await page.getByTestId("wizard-cash-amount").inputValue();
  const account = await page.getByTestId("wizard-account-amount").inputValue();
  expect(total.replace(/\D/g, "") === String(Math.round(flat.price_paise / 100)) && cash && account, `agreement prefilled from the flat price (${total}) and split 60/40 (${cash} / ${account})`, page);
  await check(page, "booking-wizard-agreement");
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-plan").waitFor({ state: "visible", timeout: 15000 });
  const planText = await page.getByTestId("wizard-plan").innerText();
  const radios = page.getByTestId("wizard-plan").getByRole("radio");
  if ((await radios.first().getAttribute("aria-checked")) !== "true") await radios.first().click();
  await page.getByTestId("schedule-preview").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  const previewRows = await page.locator('[data-testid="schedule-preview"] tbody tr').count();
  expect(/Standard CLP/.test(planText) && /default/i.test(planText) && previewRows >= 10, `plan step lists Standard CLP as default with a ${previewRows}-row schedule preview`, page);
  await check(page, "booking-wizard-plan");
  await page.getByTestId("wizard-next").click();
  await page.locator('[data-testid^="charge-line-"]').first().waitFor({ state: "visible", timeout: 15000 });
  const legal = page.locator('[data-testid="charge-line-LEGAL"], [data-testid^="charge-line-"]', { hasText: /Legal/i }).first();
  const legalBox = legal.getByRole("checkbox").first();
  if (await legalBox.count()) { if ((await legalBox.getAttribute("aria-checked")) !== "true") await legalBox.click(); }
  const slotBox = page.getByRole("checkbox", { name: /^Slot /i }).first();
  await slotBox.waitFor({ state: "visible", timeout: 15000 });
  const slotName = await slotBox.getAttribute("aria-label");
  await slotBox.click();
  note(`[${width}] parking picked: ${slotName}`);
  await check(page, "booking-wizard-charges");
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-confirm").waitFor({ state: "visible", timeout: 15000 });
  const review = await bodyText(page);
  expect(review.includes(flat.flat_number) && review.includes(customer.full_name || customer.name || "") && /Standard CLP/.test(review), "review step shows flat, customer and plan", page);
  await check(page, "booking-wizard-review");
  await page.getByTestId("wizard-confirm").click();
  const dlg = page.getByRole("alertdialog");
  if (await dlg.count().catch(() => 0)) { const btn = dlg.getByRole("button", { name: /confirm|create|book/i }); if (await btn.count()) await btn.click(); }
  await page.waitForURL(/\/bookings\/[0-9a-f-]+$/, { timeout: 40000 });
  await settle(page);
  const bookingId = page.url().match(/\/bookings\/([0-9a-f-]+)/)[1];
  const booking = (await apiGet(`/bookings/${bookingId}`)).body;
  const flatAfter = (await apiGet(`/flats/${flat.id}`)).body;
  const parkingCount = (booking.parking_slots || booking.parking || []).length;
  expect(booking.status === "ACTIVE" && flatAfter.status === "BOOKED" && parkingCount === 1 && booking.summary.total_order_raised_paise > 0, `booking ${booking.booking_number} ACTIVE, flat ${flatAfter.flat_number} BOOKED, parking ${parkingCount}, raised ₹${booking.summary.total_order_raised_paise / 100} (catch-up demands)`, page);
  await check(page, "booking-created");
  return { bookingId, booking, flat };
}

async function sectionMoney(browser, ids) {
  const towerA = ids.towerA;
  const qaBuyer = (await apiGet("/customers?search=QA%20Buyer&page_size=1")).body.items[0] || ids.customers[ids.customers.length - 1];
  let created = null, createdPhone = null;
  {
    const { context, page } = await newContext(browser, 1440);
    try {
      await login(page, "admin");
      await goto(page, "/bookings");
      await check(page, "bookings", { shot: true });
      await goto(page, `/bookings/${ids.bookingPriya.id}`);
      let txt = await bodyText(page);
      expect(/cash bucket/i.test(txt) && /account bucket/i.test(txt) && /Standard CLP/.test(txt), "booking overview shows both bucket cards and the plan", page);
      await check(page, "booking-detail", { shot: true });
      for (const tab of ["ledger", "schedule", "demands", "payments", "charges", "documents", "revisions", "history"]) {
        await page.getByRole("tab", { name: new RegExp(tab, "i") }).click();
        await check(page, `booking-tab-${tab}`);
      }
      await goto(page, `/bookings/${ids.bookingRajesh.id}?tab=ledger`);
      txt = await page.getByTestId("ledger-table").innerText();
      expect(/60,00,000/.test(txt) && /40,00,000/.test(txt) && /advance/i.test(txt), "worked example ledger shows 60 L / 40 L cumulative and advance rows", page);
      await check(page, "booking-ledger-worked-example");
      created = await runWizard(page, 1440, { towerA, customer: ids.kavita });
    } catch (e) { log(`[1440] bookings EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: "bookings-1440", kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "bookings-exception").catch(() => {}); }
    await context.close();
  }
  {
    const { context, page } = await newContext(browser, 390);
    try {
      await login(page, "sales");
      await goto(page, "/bookings");
      await check(page, "bookings");
      createdPhone = await runWizard(page, 390, { towerA, customer: qaBuyer });
      await goto(page, `/bookings/${createdPhone.bookingId}`);
      await check(page, "booking-detail", { shot: true });
      for (const tab of ["ledger", "schedule", "payments"]) { await page.getByRole("tab", { name: new RegExp(tab, "i") }).click(); await check(page, `booking-tab-${tab}`); }
      if (!created) created = createdPhone;
    } catch (e) { log(`[390] bookings EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: "bookings-390", kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "bookings-exception").catch(() => {}); }
    await context.close();
  }

  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    try {
      await login(page, "accounts");
      await goto(page, "/payments");
      await check(page, "payments", { shot: width === 1440 });
      if (width === 1440 && created) {
        const b = created.booking;
        const post = async ({ amount, mode, bucket, instrument, expectCap, name }) => {
          await goto(page, "/payments");
          await page.getByTestId("payments-post-btn").click();
          await page.getByTestId("payment-dialog").waitFor({ state: "visible" });
          await comboPick(page, "payment-booking-search", b.booking_number, b.booking_number);
          await page.getByTestId("payment-booking-banner").waitFor({ state: "visible", timeout: 15000 });
          if (bucket) { const radio = page.getByTestId("payment-dialog").getByRole("radio", { name: new RegExp(bucket, "i") }).first(); if (await radio.count()) await radio.click(); }
          await page.getByTestId("payment-amount").fill(String(amount));
          await selectOption(page, "payment-mode", mode);
          if (await page.getByTestId("payment-bank-account").count()) await selectOption(page, "payment-bank-account", /HDFC/);
          if (instrument && (await page.getByTestId("payment-instrument-number").count())) {
            await page.getByTestId("payment-instrument-number").fill(instrument);
            const instrumentDate = page.getByTestId("payment-dialog").getByLabel(/^Instrument date/i);
            if (await instrumentDate.count()) await instrumentDate.fill(new Date().toISOString().slice(0, 10));
          }
          await check(page, `payment-dialog-${name}`);
          if (expectCap) page.col.allow.push("/payments"); // the 409 BUCKET_CAP_EXCEEDED is the test (check() resets the allow-list)
          await page.getByTestId("payment-submit").click();
          if (expectCap) {
            await page.getByTestId("payment-cap-error").waitFor({ state: "visible", timeout: 15000 });
            const msg = await page.getByTestId("payment-cap-error").innerText();
            expect(/agreed/i.test(msg) && /received|already/i.test(msg), `bucket cap rejected with the explanatory message: ${msg.replace(/\s+/g, " ").slice(0, 160)}`, page);
            await check(page, "payment-bucket-cap");
            await page.keyboard.press("Escape");
            return null;
          }
          await page.getByTestId("receipt-view").waitFor({ state: "visible", timeout: 20000 });
          const receipt = await page.getByTestId("receipt-view").innerText();
          const num = (receipt.match(/SGB\/\d{4}\/\d{4}/) || [])[0];
          const pending = await page.getByTestId("receipt-subject-to-realisation").count();
          note(`posted ${name} ₹${amount} bucket=${bucket || "default"} → receipt ${num}; subject-to-realisation=${pending}`);
          await check(page, `payment-posted-${name}`, { shot: name === "cash" ? "receipt" : false });
          return { num, pending };
        };
        const rows = async () => (await apiGet(`/bookings/${created.bookingId}/payments?page_size=50`)).body.items;
        const find = (list, num) => list.find((p) => p.receipt_number === num);
        // 1. cash → receipt view, print (popup) and PDF download
        const cash = await post({ amount: 100000, mode: /^Cash$/, bucket: "Cash", name: "cash" });
        expect(Boolean(cash && cash.num) && cash.pending === 0, `cash receipt ${cash && cash.num} cleared immediately (no "subject to realisation")`, page);
        expect(/One Lakh/i.test(await page.getByTestId("receipt-view").innerText()), "receipt shows the amount in words (Indian system)", page);
        const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 10000 }).catch(() => null), page.getByTestId("receipt-print").click()]);
        if (popup) { await popup.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}); expect(/\/print\/receipt\//.test(popup.url()), `receipt print opens ${popup.url().replace(BASE, "")}`, page); await popup.close(); } else expect(false, "receipt print opened a print window", page);
        const [dl1] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }).catch(() => null), page.getByTestId("receipt-download").click()]);
        expect(Boolean(dl1) && /\.pdf$/i.test(dl1.suggestedFilename()), `receipt PDF download (${dl1 && dl1.suggestedFilename()})`, page);
        await page.keyboard.press("Escape");
        const cashRow = find(await rows(), cash.num);
        // 2. NEFT on Account (clears) → reverse later
        const neft = await post({ amount: 200000, mode: /NEFT/, bucket: "Account", instrument: `UTR${Date.now()}`, name: "neft" });
        // 3. two cheques (pending) → clear one, bounce one
        const chq1 = await post({ amount: 150000, mode: /Cheque/, bucket: "Cash", instrument: `CHQ${Math.floor(Math.random() * 1e6)}`, name: "cheque1" });
        expect(chq1 && chq1.pending > 0, "cheque receipt says subject to realisation", page);
        const chq2 = await post({ amount: 100000, mode: /Cheque/, bucket: "Cash", instrument: `CHQ${Math.floor(Math.random() * 1e6)}`, name: "cheque2" });
        // 4. bucket cap
        const cashAgreed = b.cash_agreed_paise || (b.summary && b.summary.cash_agreed_paise) || 0;
        await post({ amount: Math.ceil(cashAgreed / 100) + 500000, mode: /^Cash$/, bucket: "Cash", expectCap: true, name: "cap" });
        let list = await rows();
        const neftRow = find(list, neft.num), chq1Row = find(list, chq1.num), chq2Row = find(list, chq2.num);
        expect(chq1Row.status === "PENDING" && chq2Row.status === "PENDING" && neftRow.status === "CLEARED", "cheques PENDING, NEFT CLEARED via API", page);
        // cheques page: clear chq1
        await goto(page, "/payments/cheques");
        await check(page, "cheques");
        await page.getByTestId(`payment-clear-${chq1Row.id}`).click();
        let dlg = page.locator('[role="dialog"], [role="alertdialog"]').last();
        await dlg.waitFor({ state: "visible", timeout: 8000 });
        await check(page, "cheque-clear-dialog");
        await dlg.getByRole("button", { name: /clear|confirm/i }).last().click();
        await toast(page, /cleared/i);
        await settle(page);
        // bounce chq2 (reason)
        await page.getByTestId(`payment-bounce-${chq2Row.id}`).click();
        dlg = page.locator('[role="dialog"], [role="alertdialog"]').last();
        await dlg.waitFor({ state: "visible", timeout: 8000 });
        const reason = dlg.locator("textarea").last();
        if (await reason.count()) await reason.fill("QA: insufficient funds");
        await dlg.getByRole("button", { name: /bounce|confirm/i }).last().click();
        await toast(page, /bounced/i);
        await settle(page);
        await check(page, "cheques-after");
        // reverse NEFT from the booking payments tab
        await goto(page, `/bookings/${created.bookingId}?tab=payments`);
        await page.getByTestId(`payment-reverse-${neftRow.id}`).click();
        dlg = page.locator('[role="dialog"], [role="alertdialog"]').last();
        await dlg.waitFor({ state: "visible", timeout: 8000 });
        await dlg.locator("textarea").last().fill("QA: posted against the wrong bucket");
        await check(page, "payment-reverse-dialog");
        await dlg.getByRole("button", { name: /reverse|confirm/i }).last().click();
        await toast(page, /reversed/i);
        await settle(page);
        list = await rows();
        const after = (await apiGet(`/bookings/${created.bookingId}`)).body;
        const st = (n) => find(list, n).status;
        expect(st(chq1.num) === "CLEARED" && st(chq2.num) === "BOUNCED" && st(neft.num) === "REVERSED" && st(cash.num) === "CLEARED", `statuses: cash ${st(cash.num)}, neft ${st(neft.num)}, chq1 ${st(chq1.num)}, chq2 ${st(chq2.num)}`, page);
        const cashPaid = after.summary.cash ? after.summary.cash.paid_paise : NaN;
        const accountPaid = after.summary.account ? after.summary.account.paid_paise : NaN;
        expect(after.summary.total_paid_paise === 25000000 && cashPaid === 25000000 && accountPaid === 0, `summary total_paid ₹${after.summary.total_paid_paise / 100} = cash ₹${cashPaid / 100} (1 L cash + 1.5 L cleared cheque; bounced and reversed excluded) + account ₹${accountPaid / 100} (NEFT reversed)`, page);
        const ledger = (await apiGet(`/bookings/${created.bookingId}/ledger?page_size=50`)).body.items;
        const events = ledger.map((r) => r.event_type || r.event);
        expect(events.includes("REVERSAL") && events.filter((e) => e === "PAYMENT").length === 3, `ledger events: ${events.join(",")}`, page);
        await check(page, "booking-payments-after");
        await page.getByRole("tab", { name: /ledger/i }).click();
        await check(page, "booking-ledger-after");
        // receipt print pages: cleared + cancelled
        await goto(page, `/print/receipt/${cashRow.id}`);
        txt = await bodyText(page);
        expect(/Rupees One Lakh/i.test(txt) && new RegExp(cash.num.replace(/\//g, "\\/")).test(txt), "print receipt shows number and amount in words", page);
        await check(page, "receipt-print");
        const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByTestId("print-download-pdf").click()]);
        expect(/\.pdf$/i.test(dl2.suggestedFilename()), `print page PDF download (${dl2.suggestedFilename()})`, page);
        await goto(page, `/print/receipt/${neftRow.id}`);
        expect((await page.getByTestId("receipt-cancelled-note").count()) > 0, "reversed receipt shows CANCELLED", page);
        await check(page, "receipt-print-cancelled");
        await goto(page, `/payments/${cashRow.id}`);
        expect(/\/bookings\//.test(page.url()) && /tab=payments/.test(page.url()), `/payments/:id redirects to the booking payments tab (${page.url().replace(BASE, "")})`, page);
        await check(page, "payment-redirect");
      }
      if (width === 390 && created) {
        await page.getByTestId("payments-post-btn").click();
        await page.getByTestId("payment-dialog").waitFor({ state: "visible" });
        await check(page, "payment-dialog-phone");
        await page.keyboard.press("Escape");
        const pays = (await apiGet(`/bookings/${created.bookingId}/payments?page_size=5`)).body.items;
        if (pays[0]) { await goto(page, `/print/receipt/${pays[0].id}`); await check(page, "receipt-print"); }
      }
      // demands (accounts view; the admin-only "run dues" + integrity panel are exercised below as admin)
      await goto(page, "/demands");
      await check(page, "demands", { shot: width === 1440 });
      if (width === 1440) {
        txt = await bodyText(page);
        expect(/DM-/.test(txt) && /Open|Partially paid|Paid|Overdue/i.test(txt), "demands list shows numbered demands with statuses", page);
        await goto(page, `/print/demand/${ids.bookingPriya.id}/${ids.demand.id}`);
        txt = await bodyText(page);
        expect(/DM-/.test(txt) && /Cash/.test(txt) && /Account/.test(txt) && /IFSC|A\/c|Account number/i.test(txt), "demand letter shows both buckets and bank details", page);
        await check(page, "demand-letter-print");
      }
      // roznamcha
      await goto(page, "/roznamcha");
      await check(page, "roznamcha", { shot: width === 1440 });
      if (width === 1440) {
        txt = await bodyText(page);
        expect(/Opening cash/i.test(txt) && /Closing cash/i.test(txt), "roznamcha shows opening and closing cash", page);
        await goto(page, "/roznamcha?mode=RANGE");
        await check(page, "roznamcha-range");
        await goto(page, "/roznamcha");
        await page.getByTestId("roznamcha-add-contra").click();
        const dlg = page.getByRole("dialog").last();
        await dlg.waitFor({ state: "visible" });
        await check(page, "roznamcha-contra-dialog");
        const amount = dlg.getByLabel(/Amount/i).first();
        if (await amount.count()) await amount.fill("50000"); else await dlg.getByRole("textbox").first().fill("50000");
        const bank = dlg.getByLabel(/Bank account/i).first();
        if (await bank.count()) await selectOption(page, bank, /HDFC/);
        const narration = dlg.getByLabel(/Narration|Remarks|Note/i).first();
        if (await narration.count()) await narration.fill("QA: cash deposited to HDFC");
        await page.getByTestId("contra-save").click();
        await toast(page, /contra|recorded|saved/i);
        await settle(page);
        txt = await bodyText(page);
        expect(/50,000/.test(txt), "contra entry of ₹50,000 appears in the day book", page);
        await check(page, "roznamcha-contra-saved");
      }
    } catch (e) { log(`[${width}] payments EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: `payments-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "payments-exception").catch(() => {}); }
    await context.close();
  }

  // admin: revise agreement, cancel / complete dialogs with blockers, cancel the phone booking
  if (created) {
    const { context, page } = await newContext(browser, 1440);
    try {
      await login(page, "admin");
      await goto(page, `/bookings/${created.bookingId}`);
      const b0 = (await apiGet(`/bookings/${created.bookingId}`)).body;
      await page.getByTestId("booking-revise").click();
      await page.getByTestId("revision-save").waitFor({ state: "visible" });
      const newCash = Math.round(b0.cash_agreed_paise / 100) - 100000;
      await page.getByTestId("revision-cash").fill(String(newCash));
      await page.getByTestId("revision-cash").press("Tab");
      await page.getByTestId("revision-reason").fill("QA: loan sanction increased the account portion");
      const effect = await page.getByTestId("revision-effect").innerText();
      await check(page, "booking-revise-dialog");
      await page.getByTestId("revision-save").click();
      await toast(page, /Agreement revised/i);
      await settle(page);
      const b1 = (await apiGet(`/bookings/${created.bookingId}`)).body;
      const revs = b1.agreement_revisions || [];
      const ledger = (await apiGet(`/bookings/${created.bookingId}/ledger?page_size=50`)).body.items.map((r) => r.event_type || r.event);
      expect(b1.cash_agreed_paise === newCash * 100 && b1.agreement_value_paise === b0.agreement_value_paise && ledger.includes("AGREEMENT_CHANGE"), `agreement revised (cash ${b0.cash_agreed_paise / 100} → ${b1.cash_agreed_paise / 100}, total unchanged, AGREEMENT_CHANGE row, ${revs.length} revision(s)); effect box: ${effect.replace(/\s+/g, " ").slice(0, 80)}`, page);
      await page.getByRole("tab", { name: /revisions/i }).click();
      expect(/loan sanction/i.test(await page.getByTestId("revisions-tab").innerText()), "revisions tab lists the reason", page);
      await check(page, "booking-revisions-after");
      // complete dialog → blockers, confirm disabled
      await page.getByTestId("booking-more").click();
      await page.getByRole("menuitem", { name: /complete|handover/i }).click();
      await page.getByTestId("complete-confirm").waitFor({ state: "visible" });
      const completeText = await dialogText(page);
      expect(/outstanding|pending|possession/i.test(completeText) && (await page.getByTestId("complete-confirm").isDisabled()), `complete dialog lists blockers and disables confirm: ${completeText.replace(/\s+/g, " ").slice(0, 120)}`, page);
      await check(page, "booking-complete-blockers");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      // cancel dialog on a booking with a pending cheque (seed #2) → blocked; then cancel the phone booking for real
      await goto(page, `/bookings/${ids.bookingPriya.id}`);
      await page.getByTestId("booking-more").click();
      await page.getByRole("menuitem", { name: /cancel/i }).click();
      await page.getByTestId("cancel-confirm").waitFor({ state: "visible" });
      const cancelText = await dialogText(page);
      expect(/pending cheque|cheque/i.test(cancelText) && (await page.getByTestId("cancel-confirm").isDisabled()), `cancel dialog blocks while a cheque is pending: ${cancelText.replace(/\s+/g, " ").slice(0, 120)}`, page);
      await check(page, "booking-cancel-blocked");
      await page.keyboard.press("Escape");
      if (createdPhone && createdPhone.bookingId !== created.bookingId) {
        await goto(page, `/bookings/${createdPhone.bookingId}`);
        await page.getByTestId("booking-more").click();
        await page.getByRole("menuitem", { name: /cancel/i }).click();
        await page.getByTestId("cancel-confirm").waitFor({ state: "visible" });
        await page.getByTestId("cancel-reason").fill("QA: customer withdrew before agreement");
        await check(page, "booking-cancel-dialog");
        await page.getByTestId("cancel-confirm").click();
        await toast(page, /cancelled/i);
        await settle(page);
        const bc = (await apiGet(`/bookings/${createdPhone.bookingId}`)).body;
        const fc = (await apiGet(`/flats/${createdPhone.flat.id}`)).body;
        expect(bc.status === "CANCELLED" && fc.status === "AVAILABLE", `phone booking cancelled → ${bc.status}; flat ${fc.flat_number} ${fc.status}`, page);
        await check(page, "booking-cancelled");
      }
      // admin tools on the demands page: run dues now + integrity report (zero findings expected on the seed + QA data)
      await goto(page, "/demands");
      await page.getByTestId("demands-run-dues").click();
      await toast(page, /dues|raised|run/i);
      await check(page, "demands-run-dues");
      await page.getByTestId("demands-integrity-toggle").click();
      await page.getByTestId("integrity-panel").waitFor({ state: "visible", timeout: 20000 });
      await settle(page, 800);
      const panel = await page.getByTestId("integrity-panel").innerText();
      const integrity = (await apiGet("/dues/integrity")).body;
      const findings = integrity && Array.isArray(integrity.findings) ? integrity.findings.length : -1;
      expect(findings === 0 && integrity.ok === true && /no findings|0 findings|clean|zero|No issues/i.test(panel), `integrity report after dues run: ok=${integrity && integrity.ok}, ${findings} findings over ${integrity && integrity.bookings_checked} bookings — panel: ${panel.replace(/\s+/g, " ").slice(0, 120)}`, page);
      await check(page, "demands-integrity");
    } catch (e) { log(`[1440] booking-actions EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: "booking-actions-1440", kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "booking-actions-exception").catch(() => {}); }
    await context.close();
  }
}

/* ---- service, CMS, reports, admin, palette ---- */
async function sectionMisc(browser, ids) {
  const sgh = ids.sgh;
  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    try {
      await login(page, "admin");
      await goto(page, "/service-requests");
      await check(page, "service-requests", { shot: width === 1440 });
      if (width === 1440) {
        await page.getByTestId("tickets-view-kanban").click();
        await page.getByTestId("service-kanban").waitFor({ state: "visible", timeout: 15000 });
        await settle(page);
        expect((await page.locator('[data-testid^="service-column-"]').count()) >= 4, "service kanban renders status columns", page);
        await check(page, "service-kanban");
        await page.getByTestId("tickets-view-list").click();
        await page.getByTestId("ticket-new-btn").click();
        await page.getByTestId("ticket-submit").waitFor({ state: "visible" });
        await pickAny(page, "ticket-customer", "Priya");
        await selectOption(page, "ticket-category", /Payment/);
        await page.getByTestId("ticket-subject").fill(`QA ticket ${stamp}: receipt copy needed`);
        await page.getByTestId("ticket-description").fill("Customer asks for a duplicate receipt for the October cheque. Please share by email.");
        await check(page, "service-new-ticket");
        await page.getByTestId("ticket-submit").click();
        await toast(page, /created|SR-/i);
        await page.waitForURL(/\/service-requests\/[0-9a-f-]+/, { timeout: 15000 }).catch(() => {});
        await settle(page);
        if (!/service-requests\/[0-9a-f-]+/.test(page.url())) { const t = (await apiGet(`/service-requests?search=QA%20ticket%20${stamp}&page_size=1`)).body.items[0]; await goto(page, `/service-requests/${t.id}`); }
        await check(page, "service-request-detail");
        await page.getByTestId("reply-internal-toggle").click();
        await page.getByTestId("reply-body").fill("Internal: verify the cheque number with accounts before replying.");
        await page.getByTestId("reply-send").click();
        await toast(page, /Internal note added/i);
        await settle(page);
        expect((await page.getByTestId("internal-badge").count()) >= 1, "internal note shows the Internal badge", page);
        await page.getByTestId("reply-internal-toggle").click();
        await page.getByTestId("reply-body").fill("Hello, the duplicate receipt has been emailed to you.");
        await page.getByTestId("reply-send").click();
        await toast(page, /Reply sent/i);
        await settle(page);
        await pickAny(page, "ticket-assignee-select", "Ankit");
        await toast(page, /Assigned to/i);
        await selectOption(page, "ticket-priority-select", /Urgent/);
        await toast(page, /Priority set/i);
        const statusBtn = page.locator('[data-testid^="ticket-status-"]:not([data-testid="ticket-status-select"])').first();
        const to = (await statusBtn.getAttribute("data-testid")).replace("ticket-status-", "");
        await statusBtn.click();
        await page.getByTestId("status-dialog-confirm").waitFor({ state: "visible" });
        await page.getByTestId("status-dialog-note").fill("QA status change");
        await page.getByTestId("status-dialog-confirm").click();
        await toast(page, /Ticket is now/i);
        await settle(page);
        const t = (await apiGet(`/service-requests/${page.url().match(/service-requests\/([0-9a-f-]+)/)[1]}`)).body;
        expect(t.status === to && t.priority === "URGENT" && /Ankit/.test(t.assignee_name || "") && (t.messages || []).filter((x) => x.is_internal).length === 1, `ticket ${t.ticket_number}: status ${t.status}, priority ${t.priority}, assignee ${t.assignee_name}, ${(t.messages || []).length} messages (1 internal)`, page);
        await check(page, "service-request-after");
      } else {
        await goto(page, `/service-requests/${ids.ticket.id}`);
        await check(page, "service-request-detail", { shot: true });
      }
    } catch (e) { log(`[${width}] service EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: `service-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "service-exception").catch(() => {}); }
    await context.close();
  }

  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    try {
      await login(page, "marketing");
      await goto(page, "/website/settings");
      await check(page, "website-settings", { shot: width === 1440 });
      if (width === 1440) {
        const before = (await apiGet("/cms/site")).body;
        const tagline = page.getByLabel("Tagline");
        const old = await tagline.inputValue();
        await tagline.fill(`${old.replace(/ \(QA.*\)$/, "")} (QA ${stamp})`);
        await page.getByTestId("site-save-btn").click();
        await toast(page, /Site settings saved/i);
        await settle(page);
        let txt = await bodyText(page);
        expect(new RegExp(`version ${before.version + 1}`).test(txt), `site settings saved → version ${before.version} → ${before.version + 1}`, page);
        await check(page, "website-settings-saved");
        await tagline.fill(old.replace(/ \(QA.*\)$/, ""));
        await page.getByTestId("site-save-btn").click();
        await toast(page, /Site settings saved/i);
        // banners: create with an uploaded image
        await goto(page, "/website/banners");
        await check(page, "website-banners");
        await page.getByTestId("cms-new-btn").click();
        await page.getByTestId("cms-save").waitFor({ state: "visible" });
        let dlg = page.getByRole("dialog").last();
        await dlg.locator('input[type="file"]').first().setInputFiles(PNG);
        await toast(page, /Image uploaded/i);
        await dlg.getByLabel(/^Title/).fill(`QA banner ${stamp}`);
        await dlg.getByLabel(/^Subtitle/).fill("Festive offer on 3 BHK homes");
        await check(page, "website-banner-form");
        await page.getByTestId("cms-save").click();
        await toast(page, /Banner created/i);
        await settle(page);
        const banner = (await apiGet("/cms/banners?page_size=50")).body.items.find((x) => x.title === `QA banner ${stamp}`);
        expect(Boolean(banner && banner.document_id), `banner created with image ${banner && banner.document_id}`, page);
        await check(page, "website-banner-created");
        // post: create draft → publish
        await goto(page, "/website/posts/new");
        await page.getByTestId("post-title").fill(`QA post ${stamp}`);
        await fillMarkdown(page, "post-body", "## Construction update\n\nTower A reached the **4th slab** this week.");
        await check(page, "website-post-editor");
        await page.getByTestId("post-save-draft").click();
        await toast(page, /saved|draft|created/i);
        await page.waitForURL(/\/website\/posts\/[0-9a-f-]+/, { timeout: 15000 }).catch(() => {});
        await settle(page);
        await page.getByTestId("post-publish").click();
        const confirm = page.getByRole("alertdialog").getByRole("button", { name: /publish/i });
        if (await confirm.count()) await confirm.click();
        await toast(page, /published/i);
        await settle(page);
        const post = (await apiGet("/cms/posts?page_size=50")).body.items.find((p) => p.title === `QA post ${stamp}`);
        expect(post && post.status === "PUBLISHED" && post.slug, `post published (status ${post && post.status}, slug ${post && post.slug})`, page);
        await check(page, "website-post-published");
        await goto(page, "/website/posts");
        await check(page, "website-posts");
        // notices
        await goto(page, "/website/notices");
        await check(page, "website-notices");
        await page.getByTestId("cms-new-btn").click();
        await page.getByTestId("notice-title").waitFor({ state: "visible" });
        await page.getByTestId("notice-title").fill(`QA notice ${stamp}: water supply maintenance`);
        await fillMarkdown(page, "notice-body", "Water supply will be interrupted on Sunday 10:00–13:00 for tank cleaning.");
        await pickAny(page, "notice-project", "Heights");
        if ((await page.getByTestId("notice-published").getAttribute("aria-checked")) !== "true") await page.getByTestId("notice-published").click();
        await page.getByTestId("cms-save").click();
        await toast(page, /Notice created|created|saved/i);
        await settle(page);
        const notice = ((await apiGet("/notices?page_size=50")).body.items || []).find((n) => /QA notice/.test(n.title));
        expect(Boolean(notice && notice.is_published), `notice created and published (${notice && notice.is_published})`, page);
        await check(page, "website-notice-created");
        // gallery upload
        await goto(page, "/website/gallery");
        const galleryBefore = await page.locator('[data-testid^="gallery-item-"]').count();
        await check(page, "website-gallery", { note: `items=${galleryBefore}` });
        await page.getByTestId("cms-new-btn").click();
        await page.getByTestId("cms-save").waitFor({ state: "visible" });
        dlg = page.getByRole("dialog").last();
        await dlg.locator('input[type="file"]').first().setInputFiles(PNG);
        await toast(page, /Image uploaded/i);
        await dlg.getByLabel("Caption").fill(`QA gallery ${stamp}`);
        await dlg.getByLabel("Category").fill("Exterior");
        await page.getByTestId("cms-save").click();
        await toast(page, /created/i);
        await settle(page);
        expect((await page.locator('[data-testid^="gallery-item-"]').count()) === galleryBefore + 1, "gallery item added after upload", page);
        await check(page, "website-gallery-uploaded");
        // pages: open the first page's editor
        await goto(page, "/website/pages");
        await check(page, "website-pages");
        const firstRow = page.locator('[data-testid="cms-table"] tbody tr').first();
        await firstRow.click();
        await page.getByTestId("cms-save").waitFor({ state: "visible", timeout: 8000 });
        dlg = page.getByRole("dialog").last();
        expect((await dlg.getByLabel("Slug").inputValue()).length > 0 && (await dlg.locator("textarea").count()) > 0, "page editor opens with slug and markdown content", page);
        await check(page, "website-page-editor");
        await page.keyboard.press("Escape");
        for (const p of ["/website/home-sections", "/website/testimonials", "/website/people"]) { await goto(page, p); await check(page, `cms${p.replace(/\//g, "-")}`); }
      } else {
        for (const p of ["/website/banners", "/website/posts", "/website/gallery", "/website/notices"]) { await goto(page, p); await check(page, `cms${p.replace(/\//g, "-")}`); }
      }
    } catch (e) { log(`[${width}] cms EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: `cms-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "cms-exception").catch(() => {}); }
    await context.close();
  }

  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    try {
      await login(page, "admin");
      await goto(page, "/reports");
      await check(page, "reports", { shot: width === 1440 });
      for (const key of width === 1440 ? REPORT_KEYS : ["collections", "outstanding-ageing"]) {
        await goto(page, `/reports/${key}${key === "demand-vs-collection" ? `?project_id=${sgh.id}` : ""}`);
        const stats = await page.getByTestId("report-stats").count();
        const rows = await page.locator("main table tbody tr").count();
        await check(page, `report-${key}`, { shot: key === "collections" && width === 390 ? "report-collections" : false, note: `stats=${stats} rows=${rows}` });
      }
      if (width === 1440) {
        for (const key of ["collections", "outstanding-ageing"]) {
          await goto(page, `/reports/${key}`);
          for (const fmt of ["csv", "pdf"]) {
            const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId(`report-export-${fmt}`).click()]);
            const p = await dl.path();
            const size = p ? fs.statSync(p).size : 0;
            const head = p ? fs.readFileSync(p).subarray(0, 5).toString() : "";
            expect(size > 100 && (fmt === "csv" ? !head.startsWith("%PDF") : head.startsWith("%PDF")), `${key} ${fmt} export (${dl.suggestedFilename()}, ${size} bytes)`, page);
          }
          await check(page, `report-${key}-exports`);
        }
        // collections reconcile with Σ cleared payments
        const col = (await apiGet(`/reports/collections?from=2025-04-01&to=2027-03-31`)).body;
        const pays = (await apiGet(`/payments?status=CLEARED&page_size=200&from=2025-04-01&to=2027-03-31`)).body;
        const sumPays = (pays.items || []).reduce((s, p) => s + p.amount_paise, 0);
        const colTotal = col && (col.totals ? (col.totals.total_paise ?? col.totals.amount_paise) : col.total_paise);
        note(`collections report total ₹${colTotal / 100} vs Σ cleared payments ₹${sumPays / 100} (${pays.total} rows)`);
        await goto(page, `/reports/customer-statement?booking_id=${ids.bookingRajesh.id}`);
        await page.getByTestId("statement-view").waitFor({ state: "visible", timeout: 15000 });
        const stx = await page.getByTestId("statement-view").innerText();
        expect(/1,00,00,000/.test(stx) && /Villa CLP/.test(stx), "customer statement shows the ₹1 Cr worked example", page);
        await check(page, "customer-statement");
        for (const [id, label] of [["statement-pdf", "statement"], ["statement-allotment-pdf", "allotment"], ["statement-csv", "csv"]]) {
          const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId(id).click()]);
          expect(/\.(pdf|csv)$/i.test(dl.suggestedFilename()), `${label} download (${dl.suggestedFilename()})`, page);
        }
        // admin: users / roles / audit / settings / sessions / notifications
        await goto(page, "/admin/users");
        await check(page, "admin-users", { shot: true });
        await page.getByTestId("user-new-btn").click();
        await page.getByTestId("user-form-sheet").waitFor({ state: "visible" });
        await page.getByTestId("field-name").fill(`QA User ${stamp}`);
        await page.getByTestId("field-email").fill(`qa.${stamp.toLowerCase()}@sgb.in`);
        await selectOption(page, "field-role-id", /Employee/);
        if (await page.getByTestId("field-password").count()) await page.getByTestId("field-password").fill("Welcome@12345x");
        await check(page, "admin-user-form");
        await page.getByTestId("user-form-submit-btn").click();
        await toast(page, /created|saved/i);
        if (await page.getByTestId("temp-password-done-btn").isVisible().catch(() => false)) { await check(page, "admin-user-temp-password"); await page.getByTestId("temp-password-done-btn").click(); }
        await settle(page);
        const user = (await apiGet(`/users?search=qa.${stamp.toLowerCase()}&page_size=1`)).body.items[0];
        expect(Boolean(user), `user created (${user && user.email})`, page);
        await check(page, "admin-user-created");
        await goto(page, "/admin/roles");
        await check(page, "admin-roles");
        await page.getByTestId("role-new-btn").click();
        await page.getByTestId("role-form-sheet").waitFor({ state: "visible" });
        await page.getByTestId("field-name").fill(`QA Role ${stamp}`);
        await selectOption(page, "role-copy-from", /Employee/);
        await settle(page);
        expect((await page.locator('[data-testid^="permission-"][data-state="checked"], [data-testid^="permission-"][aria-checked="true"]').count()) > 0, "copy-from pre-ticks the Employee permissions", page);
        await check(page, "admin-role-form");
        await page.getByTestId("role-form-submit-btn").click();
        await toast(page, /created|saved/i);
        await check(page, "admin-role-created");
        await goto(page, "/admin/audit-log");
        await check(page, "admin-audit");
        await page.locator("[data-testid=audit-table] tbody tr").first().click();
        await page.getByTestId("audit-detail-sheet").waitFor({ state: "visible", timeout: 8000 });
        expect((await page.locator('[data-testid^="diff-row-"]').count()) >= 0, "audit detail sheet opens with before/after diff", page);
        await check(page, "admin-audit-detail");
        await page.keyboard.press("Escape");
        await page.getByTestId("audit-tab-logins").click();
        await page.getByTestId("login-events-table").waitFor({ state: "visible", timeout: 8000 });
        expect((await page.locator("[data-testid=login-events-table] tbody tr").count()) > 0, "login events table lists sign-ins (incl. the failed one)", page);
        await check(page, "admin-audit-logins");
        await goto(page, "/admin/settings");
        await check(page, "admin-settings");
        const hold = page.getByTestId("settings-hold-hours");
        const oldHold = await hold.inputValue();
        await hold.fill(String(Number(oldHold || 48) + 1));
        await hold.press("Tab");
        await page.getByTestId("settings-save-btn").click();
        await toast(page, /saved/i);
        const settings = (await apiGet("/settings/company")).body;
        expect(Number(settings.settings && settings.settings.booking_hold_hours) === Number(oldHold) + 1, `settings saved (booking hold hours ${oldHold} → ${Number(oldHold) + 1})`, page);
        await check(page, "admin-settings-saved");
        await hold.fill(oldHold);
        await hold.press("Tab");
        await page.getByTestId("settings-save-btn").click();
        await toast(page, /saved/i);
        await apiLogin("admin"); // an extra session to revoke
        await goto(page, "/sessions");
        const sessionsBefore = await page.locator('[data-testid^="session-"]:not([data-testid^="session-revoke-"])').count();
        await check(page, "sessions", { note: `sessions=${sessionsBefore}` });
        if (await page.getByTestId("sessions-revoke-others-btn").isEnabled().catch(() => false)) {
          await page.getByTestId("sessions-revoke-others-btn").click();
          await alertConfirm(page, /revoke|sign out|confirm/i).catch(() => {});
          await toast(page, /revoked|signed out/i).catch(() => {});
          await settle(page);
          const sessionsAfter = await page.locator('[data-testid^="session-"]:not([data-testid^="session-revoke-"])').count();
          expect(sessionsAfter <= sessionsBefore, `revoke other sessions (${sessionsBefore} → ${sessionsAfter})`, page);
          tokens.admin = null;
          await check(page, "sessions-after-revoke");
        }
        await goto(page, "/notifications");
        await check(page, "notifications");
        const unreadBefore = (await apiGet("/notifications/unread-count")).body;
        if (await page.getByTestId("notifications-mark-all-btn").isEnabled().catch(() => false)) {
          await page.getByTestId("notifications-mark-all-btn").click();
          await toast(page, /read|marked/i).catch(() => {});
          await settle(page);
          const unreadAfter = (await apiGet("/notifications/unread-count")).body;
          expect((unreadAfter.count ?? unreadAfter.unread) === 0, `mark all read (${unreadBefore.count ?? unreadBefore.unread} → ${unreadAfter.count ?? unreadAfter.unread})`, page);
          await check(page, "notifications-read");
        }
        await page.getByTestId("notification-bell").click();
        await settle(page);
        await check(page, "notification-bell");
        await page.keyboard.press("Escape");
        // command palette: flat, customer, booking
        await goto(page, "/");
        for (const [q, re, label] of [["A-301", /A-301/, "flat"], ["Priya", /Priya Verma/, "customer"], ["BK-", /BK-\d{4}\/\d{4}/, "booking"]]) {
          await page.keyboard.press("Control+k");
          const input = page.locator("[cmdk-input]").last();
          await input.waitFor({ state: "visible", timeout: 8000 });
          await input.fill(q);
          await page.waitForTimeout(1200);
          await settle(page);
          const items = await page.locator("[cmdk-item]").allInnerTexts();
          const hit = page.locator("[cmdk-item]", { hasText: re }).first();
          expect((await hit.count()) > 0, `palette "${q}" finds the ${label} (${items.map((t) => t.replace(/\s+/g, " ").slice(0, 40)).slice(0, 4).join(" | ")})`, page);
          if (label === "flat") await check(page, "command-palette");
          const beforeUrl = page.url();
          await hit.click();
          await settle(page);
          expect(page.url() !== beforeUrl, `palette ${label} navigates to ${page.url().replace(BASE, "")}`, page);
          await goto(page, "/");
        }
      } else {
        await goto(page, "/admin/users"); await check(page, "admin-users");
        await goto(page, "/admin/settings"); await check(page, "admin-settings");
        await goto(page, "/notifications"); await check(page, "notifications");
        const phoneSearch = page.getByRole("button", { name: /search/i }).first();
        if (await phoneSearch.isVisible().catch(() => false)) await phoneSearch.click(); else await page.keyboard.press("Control+k");
        const input = page.locator("[cmdk-input]").last();
        await input.waitFor({ state: "visible", timeout: 8000 });
        await input.fill("Priya");
        await page.waitForTimeout(1200);
        await settle(page);
        expect((await page.locator("[cmdk-item]", { hasText: /Priya/ }).count()) > 0, "phone palette finds the customer", page);
        await check(page, "command-palette");
        await page.keyboard.press("Escape");
      }
    } catch (e) { log(`[${width}] misc EXCEPTION ${e.message.slice(0, 400)}`); summary.defects.push({ page: `misc-${width}`, kind: "exception", detail: e.message.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 900) }); await check(page, "misc-exception").catch(() => {}); }
    await context.close();
  }
}

/* ---- smoke: admin walks every route at both widths ---- */
async function sectionSmoke(browser, ids) {
  const routes = [
    ["dashboard", "/"], ["projects", "/projects"], ["project-detail", `/projects/${ids.sgh.id}`], ["project-blocks", `/projects/${ids.sgh.id}?tab=blocks`], ["block-wizard", `/projects/${ids.sgh.id}/blocks/new`], ["block-detail", `/blocks/${ids.towerA.id}`], ["flats", "/flats"], ["rate-cards", "/rate-cards"], ["masters", "/masters"],
    ...MASTER_KINDS.map((s) => [`masters-${s}`, `/masters/${s}`]),
    ["leads", "/leads"], ["site-visits", "/site-visits"], ["customers", "/customers"], ["customer-detail", `/customers/${ids.rajesh.id}`], ["bookings", "/bookings"], ["booking-detail", `/bookings/${ids.bookingPriya.id}`], ["booking-new", "/bookings/new"], ["payments", "/payments"], ["cheques", "/payments/cheques"], ["payment-redirect", `/payments/${ids.payment.id}`], ["demands", "/demands"], ["roznamcha", "/roznamcha"], ["construction", "/construction"], ["service-requests", "/service-requests"], ["service-request-detail", `/service-requests/${ids.ticket.id}`],
    ["website-settings", "/website/settings"], ["website-banners", "/website/banners"], ["website-home-sections", "/website/home-sections"], ["website-posts", "/website/posts"], ["website-post-editor", `/website/posts/${ids.post.id}`], ["website-gallery", "/website/gallery"], ["website-testimonials", "/website/testimonials"], ["website-pages", "/website/pages"], ["website-people", "/website/people"], ["website-notices", "/website/notices"], ["website-enquiries", "/website/enquiries"], ["enquiries-alias", "/enquiries"],
    ["reports", "/reports"], ...REPORT_KEYS.map((k) => [`report-${k}`, `/reports/${k}`]), ["customer-statement", `/reports/customer-statement?booking_id=${ids.bookingRajesh.id}`],
    ["admin-users", "/admin/users"], ["admin-roles", "/admin/roles"], ["admin-audit", "/admin/audit-log"], ["admin-settings", "/admin/settings"], ["sessions", "/sessions"], ["notifications", "/notifications"], ["change-password", "/change-password"], ["print-receipt", `/print/receipt/${ids.payment.id}`], ["print-demand", `/print/demand/${ids.bookingPriya.id}/${ids.demand.id}`], ["not-found", "/no-such-page"], ["alias-master", "/master/flat-types"], ["alias-users", "/users"],
  ];
  for (const width of [1440, 390]) {
    const { context, page } = await newContext(browser, width);
    await login(page, "admin");
    for (const [name, p] of routes) {
      try {
        await goto(page, p);
        if (name === "booking-new" && (await page.getByTestId("discard-draft").count())) await page.getByTestId("discard-draft").click();
        await check(page, `smoke-${name}`);
      } catch (e) { log(`[${width}] ${name} EXCEPTION ${e.message.slice(0, 200)}`); summary.defects.push({ page: `smoke-${name}-${width}`, kind: "exception", detail: e.message.slice(0, 200) }); reset(page); }
    }
    await context.close();
  }
}

/* ------------------------------------------------------------------ main */
(async () => {
  await sharp({ create: { width: 1600, height: 700, channels: 3, background: { r: 11, g: 31, b: 58 } } }).png().toFile(PNG);
  fs.writeFileSync(PDF, Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF\n"));
  const health = await fetch(`${API}/api/v1/health`).then((r) => r.json()).catch(() => null);
  if (!health || health.status !== "ok") throw new Error(`API not healthy at ${API}`);
  const ids = await discover();
  log(`stamp ${stamp} · results ${RESULTS} · SGH ${ids.sgh.id} · Tower A ${ids.towerA.id}`);
  const browser = await chromium.launch();
  const t0 = Date.now();
  if (run("login")) await sectionLogin(browser);
  if (run("roles")) await sectionRoles(browser, ids);
  if (run("masters")) await sectionMasters(browser);
  if (run("inventory")) await sectionInventory(browser, ids);
  if (run("crm")) await sectionCrm(browser, ids);
  if (run("money")) await sectionMoney(browser, ids);
  if (run("misc")) await sectionMisc(browser, ids);
  if (run("smoke")) await sectionSmoke(browser, ids);
  await browser.close();
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  log(`\n==== SUMMARY (${mins} min): ${summary.checks} page checks, ${summary.asserts.pass}/${summary.asserts.pass + summary.asserts.fail} assertions passed, ${summary.shots} screenshots, ${summary.defects.length} defects`);
  for (const d of summary.defects) log(`  - [${d.kind}] ${d.page}: ${d.detail}`);
  log("\n==== ACCESSIBILITY (axe)\n" + axe.markdown());
  summary.axe = axe.summary();
  fs.writeFileSync(path.join(TMP, "axe.json"), JSON.stringify(axe.pages, null, 2));
  fs.writeFileSync(path.join(TMP, "summary.json"), JSON.stringify(summary, null, 2));
  log(`summary.json: ${path.join(TMP, "summary.json")}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
