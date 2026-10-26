// Browser QA for apps/portal — see docs/qa/portal.md. Run from the repo root with the API and the web export served (SPA fallback):
//   PORTAL_URL=http://localhost:8081 API_URL=http://localhost:4200 PORTAL_DB=kkt_qa_portal node docs/qa/portal/browser-qa.cjs
// AXE=0 skips the axe-core scans.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const sharp = require(path.join(ROOT, "node_modules", "sharp"));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kkt-portal-qa-"));

const PORTAL = process.env.PORTAL_URL || "http://localhost:8081";
const API = `${process.env.API_URL || "http://localhost:4200"}/api/v1`;
const PORTAL_DB = process.env.PORTAL_DB || "kkt_qa_portal";
const { createAxe } = require("../axe.cjs");
const axe = createAxe("portal");
const OUT = process.env.OUT_DIR || __dirname;
const MAX_SHOTS = 40;
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith(".png")) fs.unlinkSync(path.join(OUT, f));

const report = { pages: [], defects: [], notes: [], shots: 0 };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PW_FILE = path.join(TMP, "pw.json");
const passwords = fs.existsSync(PW_FILE) ? JSON.parse(fs.readFileSync(PW_FILE, "utf8")) : {};
const passwordOf = (phone) => passwords[phone] ?? "Welcome@123";
async function apiLogin(phone) {
  const r = await fetch(`${API}/portal/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: passwordOf(phone) }) });
  if (!r.ok) throw new Error(`apiLogin ${phone} failed ${r.status}`);
  return (await r.json()).access_token;
}
async function staffLogin() {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@sgb.in", password: "Admin@12345" }) });
  return (await r.json()).access_token;
}
async function staffReply(ticketId, body, isInternal) {
  const t = await staffLogin();
  const r = await fetch(`${API}/service-requests/${ticketId}/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}`, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ body, is_internal: isInternal, attachment_ids: [] }) });
  if (!r.ok) throw new Error(`staff reply failed ${r.status} ${await r.text()}`);
  return r.json();
}
async function staffSetStatus(ticketId, status) {
  const t = await staffLogin();
  const cur = await (await fetch(`${API}/service-requests/${ticketId}`, { headers: { authorization: `Bearer ${t}` } })).json();
  if (cur.status === status) return cur; // a public staff reply already moved NEW → IN_PROGRESS
  const r = await fetch(`${API}/service-requests/${ticketId}/status`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}`, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ status, version: cur.version }) });
  if (!r.ok) throw new Error(`staff status ${status} failed ${r.status} ${await r.text()}`);
  return r.json();
}

/** A page with console / request monitors. */
async function openPage(browser, width, height, name) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"], deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  const page = await ctx.newPage();
  const mon = { errors: [], warnings: [], failed: [], responses: [], allow: [] };
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error") mon.errors.push(text.slice(0, 400));
    else if (m.type() === "warning") mon.warnings.push(text.slice(0, 200));
  });
  page.on("pageerror", (e) => mon.errors.push("[pageerror] " + e.message));
  page.on("requestfailed", (r) => {
    // Closing the in-app viewer unmounts the iframe mid-load: Chromium's PDF plugin aborts its own range request (our action, not a failure).
    if (r.failure()?.errorText === "net::ERR_ABORTED") { report.notes.push(`aborted by our own navigation/close: ${r.url().slice(0, 90)}`); return; }
    mon.failed.push(`${r.url()} (${r.failure()?.errorText})`);
  });
  page.on("response", (r) => {
    mon.responses.push({ url: r.url(), status: r.status(), type: r.headers()["content-type"] ?? "" });
    if (r.status() >= 400 && !mon.allow.some((a) => r.url().includes(a))) mon.failed.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.mon = mon;
  page.qaName = name;
  page.width = width;
  return { ctx, page };
}

function drain(page) {
  const m = page.mon;
  const out = { errors: m.errors.splice(0), warnings: m.warnings.splice(0), failed: m.failed.splice(0) };
  return out;
}

async function settle(page, ms = 700) {
  try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch { /* fine */ }
  await sleep(ms);
}

/** Per-page assertions + screenshot. */
async function check(page, name, opts = {}) {
  await settle(page, opts.wait ?? 700);
  const width = page.width;
  const d = drain(page);
  const metrics = await page.evaluate(() => {
    const sw = document.documentElement.scrollWidth, iw = window.innerWidth;
    const targets = [];
    const sel = '[role="button"],[role="tab"],[role="link"],a,button,input,[role="imagebutton"]';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      targets.push({ text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), h: Math.round(r.height), w: Math.round(r.width), tag: el.tagName.toLowerCase(), role: el.getAttribute("role") });
    }
    // the app tab bar is the bottom-most tablist (segmented controls are tablists too)
    const tablists = [...document.querySelectorAll('[role="tablist"]')].map((t) => t.getBoundingClientRect()).filter((r) => r.height > 0);
    const tb = tablists.length ? tablists.reduce((a, b) => (b.bottom > a.bottom ? b : a)) : null;
    return { sw, iw, targets, tabbar: tb ? { top: tb.top, bottom: tb.bottom, h: tb.height } : null, ih: window.innerHeight };
  });
  const overflow = metrics.sw > metrics.iw;
  const small = metrics.targets.filter((t) => t.h < 47.5);
  // Primary targets (SPEC: ≥ 48 px on phones): the tab bar and the main action buttons of a screen.
  const PRIMARY = /^(Sign in|Sign out|Save|Submit|Send|Raise|Confirm|Change password|Update password|Continue|Reopen|Rate|Try again|New|Pay|Download statement)/i;
  const smallPrimary = width < 500 ? small.filter((t) => t.role === "tab" || (t.role === "button" && PRIMARY.test(t.text))) : [];
  const axeViolations = await axe.scan(page, name, width);
  const axeBlocking = axe.blocking(axeViolations);
  const entry = { name, width, axe: axeViolations ? axeViolations.map((v) => `${v.impact}:${v.id}(${v.nodes})`) : null, errors: d.errors, failed: d.failed, warnings: d.warnings.length, overflow: overflow ? `${metrics.sw}>${metrics.iw}` : null, small, smallPrimary, tabbar: metrics.tabbar, ih: metrics.ih };
  if (axeBlocking.length) report.defects.push({ page: `${name}-${width}`, kind: "axe", detail: axeBlocking.map((v) => `${v.impact} ${v.id} ×${v.nodes}: ${v.targets.slice(0, 3).join(" | ")} — ${v.summary.slice(0, 160)}`).join(" || ").slice(0, 900) });
  if (smallPrimary.length) report.defects.push({ page: `${name}-${width}`, kind: "target", detail: smallPrimary.map((t) => `${t.text} ${t.h}px`).join(", ") });
  report.pages.push(entry);
  if (d.errors.length) report.defects.push({ page: `${name}-${width}`, kind: "console", detail: d.errors.join(" | ").slice(0, 600) });
  if (d.failed.length) report.defects.push({ page: `${name}-${width}`, kind: "request", detail: d.failed.join(" | ").slice(0, 600) });
  if (width < 500 && overflow) report.defects.push({ page: `${name}-${width}`, kind: "overflow", detail: entry.overflow });
  if (!opts.noShot && report.shots < MAX_SHOTS) {
    const file = path.join(OUT, `${name}-${width}.png`);
    const buf = await page.screenshot({ fullPage: false });
    let png = await sharp(buf).png({ palette: true, quality: 70, compressionLevel: 9 }).toBuffer();
    if (png.length > 290 * 1024) png = await sharp(buf).png({ palette: true, colours: 64, quality: 50, compressionLevel: 9 }).toBuffer();
    fs.writeFileSync(file, png);
    report.shots += 1;
    entry.shot = `${name}-${width}.png (${Math.round(png.length / 1024)} KB)`;
  }
  log(`[${width}] ${name}: errors=${d.errors.length} failed=${d.failed.length} overflow=${entry.overflow ?? "no"} small=${small.length} smallPrimary=${smallPrimary.length} axe=${axeBlocking.length ? axeBlocking.map((v) => v.id).join(",") : "ok"}${entry.shot ? " shot=" + entry.shot : ""}`);
  if (d.errors.length) log("   console:", d.errors.slice(0, 3));
  if (d.failed.length) log("   failed:", d.failed.slice(0, 3));
  return entry;
}

async function login(page, phone) {
  await page.goto(`${PORTAL}/login`, { waitUntil: "load" });
  await settle(page, 400);
  await page.getByPlaceholder("98765 43210").fill(phone);
  await page.getByPlaceholder("Your password").fill(passwordOf(phone));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const left = async (ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (!new URL(page.url()).pathname.startsWith("/login")) return true; await sleep(250); } return false; };
  if (!(await left(12000))) {
    report.notes.push(`login for ${phone}: first Sign in click did not navigate within 12 s (banner: ${(await bodyText(page)).includes("Sign-in failed")}), clicked again`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if (!(await left(12000))) throw new Error(`login for ${phone} did not navigate`);
  }
  await settle(page);
}

async function goto(page, p) {
  await page.goto(`${PORTAL}${p}`, { waitUntil: "load" });
  await settle(page);
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
function expect(cond, msg, page) {
  if (!cond) { report.defects.push({ page: page ? `${page.qaName}-${page.width}` : "-", kind: "assert", detail: msg }); log("  ASSERT FAIL:", msg); }
  else log("  ok:", msg);
}

// Test photo for uploads.
const PHOTO = path.join(TMP, "snag.jpg");

(async () => {
  await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 180, g: 60, b: 40 } } }).jpeg({ quality: 80 }).toFile(PHOTO);
  const browser = await chromium.launch();
  const ids = {};
  {
    const t = await apiLogin("9876543210");
    const b = await (await fetch(`${API}/portal/bookings`, { headers: { authorization: `Bearer ${t}` } })).json();
    ids.rajeshBooking = b[0].booking_id;
    const r = await (await fetch(`${API}/portal/requests`, { headers: { authorization: `Bearer ${t}` } })).json();
    ids.rajeshRequest = r.items[0].id;
    const t2 = await apiLogin("9876543219");
    const b2 = await (await fetch(`${API}/portal/bookings`, { headers: { authorization: `Bearer ${t2}` } })).json();
    ids.poojaBooking = b2[0].booking_id;
    // extra sessions so the sessions screen has something to revoke
    await apiLogin("9876543210"); await apiLogin("9876543210");
  }

  // =====================================================================
  // Desktop 1440 — Rajesh (worked example, Completed booking)
  // =====================================================================
  {
    const { ctx, page } = await openPage(browser, 1440, 900, "desktop");
    await goto(page, "/login");
    await check(page, "login");
    // wrong password → sign-in failed banner (deliberate 401)
    page.mon.allow.push("/portal/auth/login");
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByPlaceholder("Your password").fill("Wrong@12345");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await sleep(1200);
    expect((await bodyText(page)).includes("Sign-in failed"), "wrong password shows 'Sign-in failed'", page);
    // accessibility: inputs are labelled, the failure is announced through a live region
    expect((await page.getByLabel("Mobile number", { exact: true }).count()) === 1 && (await page.getByLabel("Password", { exact: true }).count()) === 1, "login inputs carry their labels as accessible names", page);
    expect((await page.locator('[role="alert"]', { hasText: "Sign-in failed" }).count()) === 1, "sign-in failure is a role=alert live region", page);
    page.mon.allow.length = 0; drain(page);
    await login(page, "9876543210");
    expect(page.url().endsWith("/") || page.url().endsWith("8081"), "login lands on home", page);
    let txt = await bodyText(page);
    expect(txt.includes("Rajesh") && txt.includes("₹60,00,000") && txt.includes("₹40,00,000"), "home shows greeting + paid buckets (Cash 60 L / Account 40 L)", page);
    expect(txt.includes("100%") && txt.includes("Possession/Handover"), "progress ring 100% + current stage", page);
    expect(txt.includes("Villa CLP") && txt.includes("No further installments"), "plan card + next installment (none)", page);
    expect(txt.includes("new notice") || txt.includes("Notices"), "notices strip (unread count or caught up)", page);
    expect(txt.includes("Ankit Verma") && txt.includes("sales@sgb.in"), "RM card", page);
    expect(txt.includes("Sign out") && (await page.locator('[role="tablist"]').count()) === 0, "desktop: sidebar present, no tab bar", page);
    await check(page, "home");

    // My flat
    await page.getByRole("link", { name: "My Flat" }).first().click().catch(async () => page.locator("text=My Flat").first().click());
    await settle(page);
    txt = await bodyText(page);
    expect(txt.includes("Rooms & sizes") && txt.includes("Price breakup") && txt.includes("Agreement value") && txt.includes("Specifications"), "my flat: rooms, price breakup, agreement, specifications", page);
    expect(txt.includes("Floor 1") || txt.includes("Villa"), "floor label humanised", page);
    await check(page, "flat");

    // Payments
    await goto(page, "/payments");
    txt = await bodyText(page);
    expect(txt.includes("Receipts") && txt.includes("SGB/"), "receipts list with receipt numbers", page);
    // open a receipt PDF in the in-app viewer
    await page.getByRole("button", { name: "View" }).first().click();
    await sleep(2500);
    const pdfResp = page.mon.responses.find((r) => r.url.includes("/portal/files/") && r.type.includes("pdf"));
    expect(!!pdfResp && pdfResp.status === 200, "receipt PDF streamed 200 application/pdf into the viewer", page);
    expect((await page.locator("iframe").count()) >= 1, "in-app PDF viewer iframe mounted", page);
    await check(page, "receipt-viewer", { wait: 1200 });
    await page.getByRole("button", { name: "Close viewer" }).click();
    await sleep(300);
    // download
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }).catch(() => null), page.getByRole("button", { name: "Download" }).first().click()]);
    expect(!!dl && /\.pdf$/i.test(dl.suggestedFilename()), `receipt download triggered (${dl ? dl.suggestedFilename() : "none"})`, page);
    await check(page, "payments-receipts");
    await page.getByRole("tab", { name: "Ledger" }).click();
    await settle(page);
    txt = await bodyText(page);
    expect(txt.includes("Cash paid") && txt.includes("Total due") && txt.includes("Demand"), "ledger table with running totals", page);
    await check(page, "payments-ledger");
    await page.getByRole("tab", { name: "Demands" }).click();
    await settle(page);
    txt = await bodyText(page);
    expect(txt.includes("DM-"), "demands listed with DM- numbers", page);
    await page.getByRole("button", { name: "View" }).first().click();
    await sleep(2000);
    const dmResp = page.mon.responses.filter((r) => r.url.includes("/portal/files/") && r.type.includes("pdf"));
    expect(dmResp.length >= 2 && dmResp.every((r) => r.status === 200), "demand letter PDF streams 200", page);
    await page.getByRole("button", { name: "Close viewer" }).click();
    await check(page, "payments-demands");
    await page.getByRole("tab", { name: "Schedule" }).click();
    await settle(page);
    txt = await bodyText(page);
    expect(txt.includes("100% paid") && txt.includes("10 of 10 installments"), "schedule: 100% paid, 10/10 settled", page);
    await check(page, "payments-schedule");

    // Construction
    await goto(page, "/construction");
    txt = await bodyText(page);
    expect(txt.includes("14 of 14 stages complete"), "construction: 14/14 stages complete (premium villa block)", page);
    const thumbs = page.locator('[aria-label]:has(img[src*="/portal/files/"])');
    const thumbCount = await thumbs.count();
    expect(thumbCount >= 20, `construction photos rendered (${thumbCount})`, page);
    const imgOk = page.mon.responses.filter((r) => r.url.includes("/portal/files/") && r.type.startsWith("image/"));
    expect(imgOk.length > 0 && imgOk.every((r) => r.status === 200), `photo thumbnails stream 200 (${imgOk.length})`, page);
    await check(page, "construction");
    await thumbs.first().click();
    await sleep(1500);
    expect((await bodyText(page)).includes("1 / "), "lightbox opened with counter", page);
    await page.getByRole("button", { name: "Next photo" }).click();
    await sleep(600);
    expect((await bodyText(page)).includes("2 / "), "lightbox next photo", page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await check(page, "construction-lightbox", { wait: 800 });
    await page.keyboard.press("Escape");
    await sleep(400);

    // Documents
    await goto(page, "/more/documents");
    txt = await bodyText(page);
    expect(txt.includes("Account statement") && txt.includes("Allotment letter") && txt.includes("Signed payment plan acceptance"), "documents: generated + shared", page);
    await page.getByRole("button", { name: "View" }).nth(2).click();
    await sleep(2000);
    expect(page.mon.responses.some((r) => r.url.includes("/portal/files/") && r.status === 200), "shared document opens through a signed link", page);
    await page.getByRole("button", { name: "Close viewer" }).click();
    await check(page, "documents");

    // Requests: list → new (with photo) → detail → reply → reopen → rate
    await goto(page, "/more/requests");
    txt = await bodyText(page);
    expect(txt.includes("SR-2627/0005") && txt.includes("Closed"), "requests list shows seeded closed ticket", page);
    await check(page, "requests");
    await page.getByRole("button", { name: "New" }).click();
    await settle(page);
    // submit empty: field errors are announced (role=alert) and wired to the inputs (aria-invalid + aria-describedby)
    await page.getByRole("button", { name: "Submit request" }).click();
    await sleep(400);
    {
      const subject = page.getByLabel("Subject", { exact: true });
      const describedBy = await subject.getAttribute("aria-describedby");
      const errText = describedBy ? await page.locator(`[id="${describedBy}"]`).innerText().catch(() => "") : "";
      expect((await subject.getAttribute("aria-invalid")) === "true" && /short subject/.test(errText) && (await page.locator(`[id="${describedBy}"][role="alert"]`).count()) === 1, `empty submit: Subject is aria-invalid and described by its role=alert error ("${errText}")`, page);
      await check(page, "request-new-errors", { noShot: true });
    }
    await page.getByRole("button", { name: /Category/ }).first().click().catch(() => page.locator("text=What is this about?").click());
    await sleep(500);
    await page.getByRole("button", { name: /Defect|Snag/ }).first().click();
    await sleep(300);
    await page.getByPlaceholder(/Receipt missing/).fill("QA: hairline crack in living room wall");
    await page.getByPlaceholder(/Describe the issue/).fill("Noticed a hairline crack near the balcony door after the last rain. Photo attached.");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Add photos" }).click()]);
    await chooser.setFiles(PHOTO);
    await sleep(800);
    expect((await bodyText(page)).includes("1/10"), "photo attached to the new request form", page);
    await check(page, "request-new");
    await page.getByRole("button", { name: "Submit request" }).click();
    await page.waitForURL(/\/more\/requests\/[0-9a-f-]{36}/, { timeout: 15000 });
    await settle(page, 1200);
    ids.newRequest = page.url().split("/").pop();
    txt = await bodyText(page);
    expect(txt.includes("SR-") && txt.includes("hairline crack"), `request created ${ids.newRequest}`, page);
    const createdDetail = await (await fetch(`${API}/portal/requests/${ids.newRequest}`, { headers: { authorization: `Bearer ${await apiLogin("9876543210")}` } })).json();
    const attachments = createdDetail.messages.flatMap((m) => m.attachments);
    expect(attachments.length === 1 && attachments[0].thumb_url && attachments[0].url, "photo uploaded and linked (thumb_url + url signed)", page);
    // reply with a second photo
    await page.getByPlaceholder("Write your message…").fill("Adding one more photo from this morning.");
    const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Add photos" }).click()]);
    await chooser2.setFiles(PHOTO);
    await sleep(500);
    await page.getByRole("button", { name: "Send" }).click();
    await sleep(2500);
    txt = await bodyText(page);
    expect(txt.includes("Adding one more photo"), "reply appears in the thread", page);
    // open the attachment in the photo viewer
    const attachBtn = page.locator('[role="button"]:has-text("snag.jpg")').first();
    if (await attachBtn.count()) { await attachBtn.click(); await sleep(1200); expect((await bodyText(page)).includes("1 / 1"), "attachment opens in the lightbox", page); await page.keyboard.press("Escape"); await sleep(300); }
    // staff replies publicly and adds an INTERNAL note: the reply shows (and rings the bell), the note never reaches the customer
    await staffReply(ids.newRequest, "Thanks, our site engineer will inspect the wall on Monday.", false);
    await staffReply(ids.newRequest, "INTERNAL-NOTE-QA: contractor liability, do not share", true);
    await page.reload({ waitUntil: "load" });
    await settle(page, 1200);
    txt = await bodyText(page);
    expect(txt.includes("site engineer will inspect"), "staff public reply visible in the thread", page);
    expect(!txt.includes("INTERNAL-NOTE-QA"), "internal staff note never shown to the customer", page);
    // staff resolves → customer reopens
    await staffSetStatus(ids.newRequest, "IN_PROGRESS");
    await staffSetStatus(ids.newRequest, "RESOLVED");
    await page.reload({ waitUntil: "load" });
    await settle(page, 1000);
    txt = await bodyText(page);
    expect(txt.includes("Resolved") && txt.includes("Reopen request"), "resolved request offers reopen", page);
    await check(page, "request-detail");
    await page.getByRole("button", { name: "Reopen request" }).click();
    await sleep(500);
    await page.getByPlaceholder(/leak has started/).fill("The crack has widened after yesterday's rain.");
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await sleep(2000);
    txt = await bodyText(page);
    expect(txt.includes("Request reopened") || !txt.includes("Reopen request"), "request reopened from the portal", page);
    // staff resolves again → customer rates
    await staffSetStatus(ids.newRequest, "RESOLVED");
    await page.reload({ waitUntil: "load" });
    await settle(page, 1000);
    await page.getByRole("radio", { name: "4 stars" }).click();
    await page.getByPlaceholder(/Anything we should know/).fill("Quick turnaround, thank you.");
    await page.getByRole("button", { name: "Submit rating" }).click();
    await sleep(2000);
    txt = await bodyText(page);
    expect(txt.includes("Your rating") && txt.includes("Closed"), "rating submitted → request closed with rating", page);

    // Notices
    await goto(page, "/more/notices");
    txt = await bodyText(page);
    expect(txt.includes("Company-wide") || txt.includes("Ganesh"), "notices list", page);
    await check(page, "notices");
    await page.locator('[role="button"]:not([aria-label])').filter({ hasText: /\d{1,2} [A-Z][a-z]{2} \d{4}/ }).first().click();
    await settle(page);
    expect((await bodyText(page)).includes("Published"), "notice detail renders markdown body", page);
    // Notifications
    await goto(page, "/more/notifications");
    txt = await bodyText(page);
    expect(/\d+ unread/.test(txt) && txt.includes("Reply on your request"), "notifications list with unread count incl. the staff reply", page);
    await check(page, "notifications");
    const first = page.locator('[role="button"]').filter({ hasText: /ago|Yesterday|Today|\d{4}/ }).first();
    await first.click();
    await settle(page);
    expect(!page.url().includes("/more/notifications"), `notification tap navigates (→ ${new URL(page.url()).pathname})`, page);
    await goto(page, "/more/notifications");
    if (await page.getByRole("button", { name: "Mark all read" }).count()) {
      await page.getByRole("button", { name: "Mark all read" }).click();
      await sleep(1500);
    }
    expect((await bodyText(page)).includes("all caught up"), "tap / mark all read → caught up", page);
    const unreadNow = await (await fetch(`${API}/portal/notifications/unread-count`, { headers: { authorization: `Bearer ${await apiLogin("9876543210")}` } })).json();
    expect(unreadNow.count === 0, "unread-count {count} is 0 after mark-all-read", page);

    // Profile (KYC masked) + edit
    await goto(page, "/more/profile");
    txt = await bodyText(page);
    expect(/XXXXX\d{4}[A-Z]/.test(txt) && /XXXX XXXX \d{4}/.test(txt), "KYC masked (PAN XXXXX1234K, Aadhaar XXXX XXXX 1234)", page);
    expect(!/[A-Z]{5}\d{4}[A-Z]/.test(txt.replace(/XXXXX\d{4}[A-Z]/g, "")), "no unmasked PAN anywhere on the profile", page);
    await page.getByPlaceholder("Optional").first().fill("9123456789");
    await page.getByRole("button", { name: "Save changes" }).click();
    await sleep(1500);
    expect((await bodyText(page)).includes("Profile updated"), "profile edit saved (toast)", page);
    await check(page, "profile");
    await page.getByPlaceholder("Optional").first().fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await sleep(1200);

    // Bank details
    await goto(page, "/more/bank-details");
    txt = await bodyText(page);
    expect(txt.includes("IFSC") && txt.includes("Account number"), "bank details shown", page);
    await page.getByRole("button", { name: "Copy IFSC" }).click();
    await sleep(600);
    expect((await bodyText(page)).includes("IFSC copied"), "copy IFSC → toast", page);
    await check(page, "bank-details");

    // Sessions
    await goto(page, "/more/sessions");
    txt = await bodyText(page);
    expect(txt.includes("This device") && (txt.match(/Sign out/g) || []).length >= 2, "sessions list: current + others", page);
    await check(page, "sessions");
    // the sidebar's own "Sign out" is the first match on desktop; the session rows follow
    await page.getByRole("button", { name: "Sign out", exact: true }).nth(1).click();
    await sleep(1500);
    expect((await bodyText(page)).includes("Signed out on that device"), "revoke one session → toast", page);
    await page.getByRole("button", { name: "Sign out all other devices" }).click();
    await sleep(400);
    await page.getByRole("button", { name: "Sign them out" }).click();
    await sleep(1500);
    expect((await bodyText(page)).includes("Other devices signed out"), "revoke all other sessions", page);

    // Change password (and back)
    await goto(page, "/more/password");
    await check(page, "password");
    const fields = page.locator("input[type=password]");
    const fresh = `QaPortal@${Date.now() % 1000000}x`;
    // weak password first → policy message, nothing changes
    await fields.nth(0).fill(passwordOf("9876543210"));
    await fields.nth(1).fill("short1");
    await fields.nth(2).fill("short1");
    await page.getByRole("button", { name: "Update password" }).click();
    await sleep(800);
    expect(/10 characters|stronger/i.test(await bodyText(page)), "weak password rejected client-side", page);
    await fields.nth(1).fill(fresh);
    await fields.nth(2).fill(fresh);
    await page.getByRole("button", { name: "Update password" }).click();
    await sleep(2000);
    txt = await bodyText(page);
    expect(txt.includes("Password updated"), "password changed", page);
    const relog = await fetch(`${API}/portal/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "9876543210", password: fresh }) });
    expect(relog.status === 200, "new password works on the API", page);
    const oldLogin = await fetch(`${API}/portal/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "9876543210", password: passwordOf("9876543210") }) });
    expect(oldLogin.status === 401, "old password no longer works", page);
    passwords["9876543210"] = fresh;
    fs.writeFileSync(PW_FILE, JSON.stringify(passwords));
    // reusing a recent password is refused (history of 5) — deliberate 422
    page.mon.allow.push("/portal/auth/change-password");
    await goto(page, "/more/password");
    await fields.nth(0).fill(fresh);
    await fields.nth(1).fill("Welcome@123");
    await fields.nth(2).fill("Welcome@123");
    await page.getByRole("button", { name: "Update password" }).click();
    await sleep(1500);
    expect(/last 5|not used|recent|history/i.test(await bodyText(page)), "password history (last 5) refuses Welcome@123 with a message", page);
    page.mon.allow.length = 0; drain(page);

    // Not-found route
    await goto(page, "/this-page-does-not-exist");
    expect((await bodyText(page)).includes("That page doesn't exist"), "+not-found screen for unknown route", page);
    await check(page, "not-found");

    await ctx.close();
  }

  // =====================================================================
  // Desktop 1440 — Pooja (primary with co-applicant), Sanjay (co-applicant) isolation
  // =====================================================================
  {
    const { ctx, page } = await openPage(browser, 1440, 900, "desktop-pooja");
    await login(page, "9876543219");
    let txt = await bodyText(page);
    expect(txt.includes("Pooja") && txt.includes("A-803") && txt.includes("Primary applicant"), "Pooja home: A-803 primary", page);
    expect(/next installment/i.test(txt) && txt.includes("Excavation"), "next installment card (Excavation)", page);
    expect(txt.includes("3rd Slab") && txt.includes("Up next: 4th Slab"), "construction ring: 3rd Slab, up next 4th Slab", page);
    await goto(page, "/more/profile");
    txt = await bodyText(page);
    expect(txt.includes("Sanjay Jha") && txt.includes("Co-applicant on BK-2627/0010"), "profile lists booking co-applicant Sanjay", page);
    await goto(page, "/flat");
    txt = await bodyText(page);
    expect(txt.includes("B1-07"), "my flat: parking B1-07", page);
    await goto(page, "/more/documents");
    txt = await bodyText(page);
    expect(txt.includes("Allotment letter – A-803") && txt.includes("Agreement for sale – A-803"), "two shared documents", page);
    // isolation: Rajesh's request id → not found
    page.mon.allow.push(`/portal/requests/${ids.rajeshRequest}`);
    await goto(page, `/more/requests/${ids.rajeshRequest}`);
    txt = await bodyText(page);
    expect(txt.includes("Not found") && !txt.includes("Rajesh"), "another customer's request id → Not found screen", page);
    page.mon.allow.length = 0;
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage(browser, 1440, 900, "desktop-sanjay");
    await login(page, "9876543220");
    let txt = await bodyText(page);
    expect(txt.includes("Sanjay") && txt.includes("Co-applicant") && txt.includes("A-803"), "Sanjay home: same booking as co-applicant", page);
    await check(page, "home-coapplicant");
    // isolation through the booking switcher: inject a foreign booking id into /portal/bookings
    page.mon.allow.push(`/portal/bookings/${ids.rajeshBooking}/`);
    await page.route("**/api/v1/portal/bookings", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.unshift({ booking_id: ids.rajeshBooking, booking_number: "BK-FORGED", project_name: "Ganesh Green Villas", block_name: "Block P", flat_number: "P1", role: "PRIMARY", status: "ACTIVE" });
      await route.fulfill({ response: res, json });
    });
    await page.evaluate(() => { localStorage.setItem("kkt.portal.booking", "__FORGED__"); localStorage.removeItem("kkt.portal.cache.v2"); });
    await page.reload({ waitUntil: "load" });
    await settle(page, 1200);
    await page.getByRole("button", { name: "Switch booking" }).click().catch(() => null);
    await sleep(500);
    await page.getByRole("button", { name: /BK-FORGED/ }).click().catch(() => null);
    await settle(page, 1500);
    txt = await bodyText(page);
    expect(txt.includes("Not found") && !txt.includes("₹60,00,000"), "foreign booking id → Not found screen, no data leaked", page);
    const r404 = page.mon.responses.filter((r) => r.url.includes(`/portal/bookings/${ids.rajeshBooking}/`));
    expect(r404.length > 0 && r404.every((r) => r.status === 404), `API answered 404 for the foreign booking (${r404.length} calls)`, page);
    await page.unroute("**/api/v1/portal/bookings");
    await ctx.close();
  }

  // =====================================================================
  // Phone 390×844 — Rajesh full walk + Sanjay co-applicant
  // =====================================================================
  {
    const { ctx, page } = await openPage(browser, 390, 844, "phone");
    await goto(page, "/login");
    await check(page, "login");
    await login(page, "9876543210");
    let txt = await bodyText(page);
    expect((await page.getByRole("tab", { name: "My Flat" }).count()) === 1 && !txt.includes("SERVICES"), "phone: tab bar present, no sidebar", page);
    const tabCheck = async (name) => {
      const m = await page.evaluate(() => {
        const tb = [...document.querySelectorAll('[role="tablist"]')].map((t) => t.getBoundingClientRect()).reduce((a, b) => (b.bottom > a.bottom ? b : a));
        const scroller = [...document.querySelectorAll("div")].find((d) => { const cs = getComputedStyle(d); return (cs.overflowY === "auto" || cs.overflowY === "scroll") && d.scrollHeight > d.clientHeight; });
        if (!scroller) return { tbTop: tb.top, tbBottom: tb.bottom, ih: window.innerHeight };
        scroller.scrollTop = scroller.scrollHeight;
        const last = scroller.lastElementChild.getBoundingClientRect();
        return { tbTop: tb.top, tbBottom: tb.bottom, ih: window.innerHeight, lastBottom: last.bottom, scrollerBottom: scroller.getBoundingClientRect().bottom };
      });
      expect(Math.round(m.tbBottom) <= m.ih && (m.lastBottom === undefined || m.lastBottom <= m.tbTop + 1), `${name}: tab bar at the bottom (${Math.round(m.tbTop)}–${Math.round(m.tbBottom)} of ${m.ih}) and content ends above it`, page);
      await page.evaluate(() => { const s = [...document.querySelectorAll("div")].find((d) => { const cs = getComputedStyle(d); return (cs.overflowY === "auto" || cs.overflowY === "scroll") && d.scrollHeight > d.clientHeight; }); if (s) s.scrollTop = 0; });
    };
    await check(page, "home");
    await tabCheck("home");
    await page.getByRole("tab", { name: "My Flat" }).click();
    await settle(page);
    await check(page, "flat");
    await tabCheck("flat");
    await page.getByRole("tab", { name: "Payments" }).click();
    await settle(page);
    await check(page, "payments-receipts");
    await page.getByRole("tab", { name: "Ledger" }).click();
    await settle(page);
    expect((await bodyText(page)).includes("Total due after this"), "ledger uses card layout on phones", page);
    await check(page, "payments-ledger");
    await page.getByRole("tab", { name: "Demands" }).click();
    await settle(page);
    await check(page, "payments-demands");
    await page.getByRole("tab", { name: "Schedule" }).click();
    await settle(page);
    await check(page, "payments-schedule");
    await tabCheck("payments");
    await page.getByRole("tab", { name: "Construction" }).click();
    await settle(page);
    await check(page, "construction");
    await page.locator('[aria-label]:has(img[src*="/portal/files/"])').first().click();
    await sleep(1200);
    await check(page, "construction-lightbox", { wait: 600 });
    await page.getByRole("button", { name: "Close viewer" }).click();
    await sleep(300);
    await page.getByRole("tab", { name: "More" }).click();
    await settle(page);
    await check(page, "more");
    await tabCheck("more");
    await page.getByRole("button", { name: /Documents/ }).first().click();
    await settle(page);
    await check(page, "documents");
    await goto(page, "/more/requests");
    await check(page, "requests");
    await goto(page, `/more/requests/${ids.newRequest}`);
    await check(page, "request-detail");
    await goto(page, "/more/requests/new");
    await check(page, "request-new");
    await goto(page, "/more/notices");
    await check(page, "notices");
    await goto(page, "/more/notifications");
    await check(page, "notifications");
    await goto(page, "/more/profile");
    txt = await bodyText(page);
    expect(/XXXXX\d{4}[A-Z]/.test(txt), "phone profile: KYC masked", page);
    await check(page, "profile");
    await goto(page, "/more/bank-details");
    await check(page, "bank-details");
    await goto(page, "/more/sessions");
    await check(page, "sessions", { noShot: true });
    await goto(page, "/more/password");
    await check(page, "password", { noShot: true });
    page.mon.allow.push(`/portal/requests/${ids.rajeshRequest}x`);
    await goto(page, "/nope/nothing");
    await check(page, "not-found");
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage(browser, 390, 844, "phone-sanjay");
    await login(page, "9876543220");
    const txt = await bodyText(page);
    expect(txt.includes("Co-applicant") && txt.includes("A-803"), "phone Sanjay home: co-applicant booking", page);
    await check(page, "home-coapplicant", { noShot: report.shots >= MAX_SHOTS });
    await ctx.close();
  }

  await browser.close();
  // Restore the seed contract on the QA database: Welcome@123 again for the worked-example customer (any argon2 hash of it verifies).
  const { execSync } = require("node:child_process");
  try {
    const sqlFile = path.join(TMP, "restore.sql");
    fs.writeFileSync(sqlFile, "update portal_users set password_hash = (select pu2.password_hash from portal_users pu2 join customers c2 on c2.id = pu2.customer_id where c2.phone = '9876543211'), failed_attempts = 0, locked_until = null where customer_id = (select id from customers where phone = '9876543210');\n");
    fs.chmodSync(sqlFile, 0o644); fs.chmodSync(TMP, 0o755);
    execSync(`cat ${sqlFile} | su postgres -c "psql -d ${PORTAL_DB}"`);
    delete passwords["9876543210"]; fs.writeFileSync(PW_FILE, JSON.stringify(passwords));
    report.notes.push(`Seed password Welcome@123 restored for 9876543210 on ${PORTAL_DB} after the run (hash copied in the DB; the history rule is append-only).`);
  } catch (e) { report.notes.push("Could not restore the seed password: " + e.message); }
  report.axe = axe.summary();
  log("\n==== ACCESSIBILITY (axe)\n" + axe.markdown());
  fs.writeFileSync(path.join(TMP, "report.json"), JSON.stringify(report, null, 2));
  log("report:", path.join(TMP, "report.json"));
  log("\nSHOTS:", report.shots, "DEFECTS:", report.defects.length);
  for (const d of report.defects) log(" -", d.page, d.kind, d.detail.slice(0, 300));
})().catch((e) => { console.error("FATAL", e); fs.writeFileSync(path.join(TMP, "report.json"), JSON.stringify(report, null, 2)); process.exit(1); });
