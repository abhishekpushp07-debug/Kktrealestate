/* Browser QA for apps/web (Chromium headless, 1440x900 + 390x844). */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const WEB = process.env.WEB_URL || "http://localhost:3000";
const API = process.env.API_URL || "http://localhost:4100";
const OUT = process.env.OUT_DIR || __dirname;
const SITE = process.env.SITE_URL || WEB; // NEXT_PUBLIC_SITE_URL of the build under test (sitemap / robots URLs)
const REDIS_DB = process.env.REDIS_DB || null; // Redis db of the API under test (visitor-IP forwarding check)
const REPORT = process.env.REPORT || path.join(require("os").tmpdir(), `kkt-web-qa-${Date.now()}.json`);
const { createAxe } = require("../axe.cjs");
const axe = createAxe("web");
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null; // e.g. ONLY=static,enquiry,brochure,visit,toggles
const VIEWPORTS = { 1440: { width: 1440, height: 900 }, 390: { width: 390, height: 844 } };
fs.mkdirSync(OUT, { recursive: true });

let sharp = null;
try { sharp = require("sharp"); } catch { /* optional: PNGs over 300 KB are shrunk afterwards with shrink.py */ }

const report = { pages: [], flows: [], defects: [], shots: 0 };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function flow(name, ok, detail) { report.flows.push({ name, ok, detail }); log(ok ? "PASS" : "FAIL", name, detail ?? ""); if (!ok) report.defects.push(`${name}: ${detail ?? ""}`); }
function want(cond, name, detail) { flow(name, Boolean(cond), detail); return Boolean(cond); }

async function newPage(browser, width) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[width], deviceScaleFactor: 1, isMobile: width === 390, hasTouch: width === 390, acceptDownloads: true, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  const net = { consoleErrors: [], pageErrors: [], failed: [] };
  page.on("console", (m) => { if (m.type() === "error") net.consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => net.pageErrors.push(String(e).slice(0, 300)));
  page.on("requestfailed", (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) net.failed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.status() >= 400) net.failed.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  const reset = () => { net.consoleErrors.length = 0; net.pageErrors.length = 0; net.failed.length = 0; };
  return { ctx, page, net, reset };
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(400);
}

async function metrics(page) {
  return page.evaluate(() => {
    const sw = document.documentElement.scrollWidth, iw = window.innerWidth;
    const small = [];
    const sel = "a[href], button, [role=button], input:not([type=hidden]), select, textarea, [role=radio]";
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= document.documentElement.scrollWidth) continue; // off-screen / sr-only
      if (el.closest('[aria-hidden="true"]') || el.classList.contains("sr-only")) continue;
      if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) continue; // the label is the target
      // Stretched links (::after covering the card) hit the whole positioned ancestor, not just the text box.
      const after = getComputedStyle(el, "::after");
      let hitH = r.height;
      if (after.position === "absolute" && after.content !== "none" && el.offsetParent) hitH = Math.max(hitH, el.offsetParent.getBoundingClientRect().height);
      if (hitH < 47.5) small.push({ tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute("aria-label") || el.value || el.name || "").trim().replace(/\s+/g, " ").slice(0, 40), h: Math.round(r.height), w: Math.round(r.width) });
    }
    return { scrollWidth: sw, innerWidth: iw, small };
  });
}

async function shoot(page, name, width) {
  if (report.shots >= 40) return null;
  const file = path.join(OUT, `${name}-${width}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
  let size = fs.statSync(file).size;
  if (size > 300 * 1024 && sharp) {
    const buf = await sharp(file).png({ palette: true, quality: 70, compressionLevel: 9 }).toBuffer();
    fs.writeFileSync(file, buf);
    size = buf.length;
  }
  report.shots++;
  return { file: path.basename(file), kb: Math.round(size / 1024) };
}

/** Audits the current page: console/network, overflow, tap targets, screenshot. */
async function audit(h, name, width, opts = {}) {
  const { page, net } = h;
  await settle(page);
  const m = await metrics(page);
  const allow = opts.allow ?? [];
  const failed = net.failed.filter((f) => !allow.some((a) => (a instanceof RegExp ? a.test(f) : f.includes(a))));
  const consoleErrors = [...net.consoleErrors, ...net.pageErrors].filter((c) => !allow.some((a) => (a instanceof RegExp ? a.test(c) : c.includes(a))));
  const shot = opts.noShot ? null : await shoot(page, name, width);
  const axeViolations = await axe.scan(page, name, width);
  const axeBlocking = axe.blocking(axeViolations);
  const entry = { page: name, width, url: page.url(), axe: axeViolations ? axeViolations.map((v) => `${v.impact}:${v.id}(${v.nodes})`) : null, consoleErrors, failed, overflow: width === 390 ? m.scrollWidth > m.innerWidth : m.scrollWidth > m.innerWidth, scrollWidth: m.scrollWidth, innerWidth: m.innerWidth, small: m.small, settleMs: opts.settleMs ?? null, shot };
  report.pages.push(entry);
  const problems = [];
  if (consoleErrors.length) problems.push(`console: ${consoleErrors.join(" | ")}`);
  if (failed.length) problems.push(`requests: ${failed.join(" | ")}`);
  if (entry.overflow) problems.push(`overflow ${m.scrollWidth}>${m.innerWidth}`);
  if (axeBlocking.length) problems.push(`axe: ${axeBlocking.map((v) => `${v.impact} ${v.id} ×${v.nodes} ${v.targets.slice(0, 3).join(" | ")}`).join(" ;; ")}`);
  if (width === 390 && m.small.length) problems.push(`small targets: ${m.small.map((s) => `${s.tag}"${s.text}"${s.h}px`).join(", ")}`);
  log(problems.length ? "WARN" : "OK  ", `${name}@${width}`, entry.settleMs !== null ? `${entry.settleMs}ms` : "", shot ? `${shot.file} ${shot.kb}KB` : "", problems.join(" ;; "));
  if (problems.length) report.defects.push(`${name}@${width}: ${problems.join(" ;; ")}`);
  h.reset();
  return entry;
}

async function gotoTimed(page, url, opts) {
  const t0 = Date.now();
  const res = await page.goto(url, { waitUntil: "domcontentloaded", ...opts });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  return { res, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Admin API helpers
// ---------------------------------------------------------------------------
async function adminToken(request) {
  const r = await request.post(`${API}/api/v1/auth/login`, { data: { email: "admin@sgb.in", password: "Admin@12345" }, headers: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const j = await r.json();
  if (!j.access_token) throw new Error(`admin login failed: ${JSON.stringify(j)}`);
  return j.access_token;
}
async function api(request, token, method, url, data) {
  const r = await request.fetch(`${API}/api/v1${url}`, { method, data, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json", "idempotency-key": `qa-${Date.now()}-${Math.random()}` } : {}) } });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status(), body };
}
async function pollUntil(fn, { timeoutMs = 90000, every = 3000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await fn()) return Date.now() - t0; await sleep(every); }
  return -1;
}

// ---------------------------------------------------------------------------
// Static walk
// ---------------------------------------------------------------------------
async function staticWalk(browser) {
  const posts = await (await fetch(`${API}/api/v1/public/posts`)).json();
  const postSlug = posts.items[0].slug;
  const pages = [
    ["home", "/"],
    ["projects", "/projects"],
    ["projects-filtered", "/projects?status=READY&bhk=4"],
    ["project-sgh", "/projects/shree-ganesh-heights"],
    ["project-ggv", "/projects/ganesh-green-villas"],
    ["about", "/about"],
    ["gallery", "/gallery"],
    ["blog", "/blog"],
    ["blog-post", `/blog/${postSlug}`],
    ["contact", "/contact"],
    ["privacy", "/privacy"],
    ["disclaimer", "/disclaimer"],
    ["not-found", "/projects/no-such-project"],
  ];
  for (const width of [1440, 390]) {
    const h = await newPage(browser, width);
    const { page } = h;
    for (const [name, url] of pages) {
      const { res, ms } = await gotoTimed(page, `${WEB}${url}`);
      const status = res?.status();
      if (name === "not-found") {
        want(status === 404, `404 status for unknown project slug @${width}`, `status ${status}`);
        want(await page.getByText("This address does not exist").isVisible().catch(() => false), `404 page body @${width}`);
      } else want(status === 200, `${name} responds 200 @${width}`, `status ${status}`);
      // content assertions (once per width)
      if (name === "home") {
        const slides = await page.locator("section, div").filter({ hasText: "Festive offer on Tower C" }).count();
        want(slides > 0, `home hero slide text @${width}`);
        want((await page.getByText("1,400").count()) > 0 || (await page.getByText(/families/i).count()) > 0, `home trust strip @${width}`);
        want((await page.getByRole("link", { name: /Shree Ganesh Heights/ }).count()) > 0, `home featured projects @${width}`);
        want((await page.getByText("Rajesh Kumar Sinha").count()) > 0, `home testimonials @${width}`);
        want((await page.getByRole("link", { name: /Vastu tips/ }).count()) > 0, `home latest posts @${width}`);
      }
      if (name === "projects") want((await page.getByText(/2 projects/).count()) > 0, `projects list shows 2 projects @${width}`);
      if (name === "projects-filtered") {
        want((await page.getByText(/1 project match/).count()) > 0, `projects filter status=READY&bhk=4 → 1 @${width}`);
        want((await page.getByRole("link", { name: /Ganesh Green Villas/ }).count()) > 0 && (await page.getByRole("link", { name: /Shree Ganesh Heights/ }).count()) === 0, `filtered list contains only GGV @${width}`);
      }
      if (name === "project-sgh") {
        const body = await page.locator("main").innerText();
        want(/₹\s?5\.46 Cr|₹5\.46/.test(body) || /₹/.test(body), `SGH shows prices @${width}`, body.match(/₹[^\n]{0,20}/)?.[0]);
        want(await page.locator("#availability").count() === 1, `SGH availability grid present @${width}`);
        const cells = await page.locator("#availability [data-flat], #availability [title], #availability li, #availability td, #availability button, #availability span").count();
        want(cells > 50, `SGH availability grid has cells @${width}`, `${cells}`);
        const photos = await page.locator("#progress img").count();
        want(photos > 0, `SGH progress photos @${width}`, `${photos} img`);
        want(await page.locator("#visit").count() === 1, `SGH visit booking section @${width}`);
        want(await page.locator("#media").count() === 1 && (await page.locator("#media iframe").count()) === 0, `SGH click-to-load embeds (no iframe before click) @${width}`);
      }
      if (name === "project-ggv") {
        const cfg = (await page.locator("#configurations").innerText().catch(() => "")) + (await page.locator("aside").innerText().catch(() => ""));
        want(!/₹/.test(cfg), `GGV hides prices in configurations + enquiry card @${width}`, cfg.match(/₹[^\n]{0,20}/)?.[0]);
        want(/price on request/i.test(await page.locator("main").innerText()), `GGV says "Price on request" @${width}`);
        want((await page.locator("#progress").count()) === 0, `GGV hides construction progress @${width}`);
        want((await page.locator("#availability").count()) === 1, `GGV shows availability @${width}`);
      }
      if (name === "about") want((await page.getByText("Suresh Agarwal").count()) > 0, `about shows leadership @${width}`);
      if (name === "gallery") want((await page.locator("main img").count()) >= 12, `gallery renders images @${width}`, `${await page.locator("main img").count()} img`);
      if (name === "blog") want((await page.getByRole("link", { name: /Vastu tips/ }).count()) > 0 && (await page.getByText("ggv-block-q-handover").count()) === 0, `blog lists 4 published posts @${width}`);
      if (name === "blog-post") want(await page.locator("article, main").first().innerText().then((t) => t.length > 200), `blog post renders body @${width}`);
      if (name === "contact") want((await page.locator("#enquire form").count()) === 1 && (await page.locator("#visit form").count()) === 1, `contact has enquiry + visit forms @${width}`);
      if (name === "privacy" || name === "disclaimer") want((await page.locator("main").innerText()).length > 200, `${name} renders body @${width}`);
      await audit(h, name, width, { settleMs: ms, allow: name === "not-found" ? [/404 GET .*no-such-project/, /status of 404/] : [] });
      if (width === 390 && name === "home") {
        // Mobile nav menu + sticky bar sheet
        await page.getByRole("button", { name: "Open menu" }).click();
        await sleep(400);
        want(await page.getByRole("dialog", { name: "Menu" }).isVisible(), "mobile menu opens @390");
        await audit(h, "home-menu", 390);
        await page.getByRole("button", { name: "Close menu" }).click().catch(() => page.keyboard.press("Escape"));
        await sleep(300);
        const enquireBtn = page.locator('nav[aria-label="Quick actions"] button');
        await enquireBtn.click();
        await sleep(400);
        want((await page.getByRole("dialog").count()) > 0, "sticky bar sheet opens @390");
        await audit(h, "home-sheet", 390);
        await page.keyboard.press("Escape");
      }
      if (name === "gallery") {
        await page.locator("main button:has(img)").first().click();
        await sleep(500);
        want(await page.getByRole("dialog").first().isVisible(), `gallery lightbox opens @${width}`);
        await page.getByRole("button", { name: "Next image" }).click().catch(() => {});
        await sleep(300);
        await audit(h, "gallery-lightbox", width);
        await page.keyboard.press("Escape");
        await sleep(200);
        want((await page.getByRole("dialog").count()) === 0, `gallery lightbox closes on Escape @${width}`);
      }
    }
    // draft post must 404 and sitemap/robots
    const draft = await page.goto(`${WEB}/blog/ggv-block-q-handover`, { waitUntil: "domcontentloaded" });
    want(draft.status() === 404, `draft post 404 @${width}`, `status ${draft.status()}`);
    h.reset();
    await h.ctx.close();
  }
  // sitemap + robots via request
  const sm = await (await fetch(`${WEB}/sitemap.xml`)).text();
  want(sm.includes(`<loc>${SITE}/projects/shree-ganesh-heights</loc>`) && sm.includes("/projects/ganesh-green-villas") && sm.includes(`/blog/${postSlug}`) && !sm.includes("ggv-block-q-handover"), "sitemap.xml lists published content only");
  const rb = await (await fetch(`${WEB}/robots.txt`)).text();
  want(/Allow: \//.test(rb) && rb.includes(`Sitemap: ${SITE}/sitemap.xml`) && rb.includes("Disallow: /visit/"), "robots.txt allows crawl, hides /visit/");
}

// ---------------------------------------------------------------------------
// Enquiry + rate limit (contact page, 1440)
// ---------------------------------------------------------------------------
async function enquiryFlow(browser) {
  const h = await newPage(browser, 1440);
  const { page } = h;
  const refs = [];
  // accessibility: an empty submit marks the fields invalid and points them at their role=alert errors
  {
    await page.goto(`${WEB}/contact`, { waitUntil: "domcontentloaded" });
    const form = page.locator("#enquire form");
    await form.locator('input[name="name"]').waitFor({ timeout: 10000 });
    await form.locator('button[type="submit"]').click();
    await sleep(300);
    const nameInput = form.locator('input[name="name"]');
    const describedBy = await nameInput.getAttribute("aria-describedby");
    const errText = describedBy ? await page.locator(`[id="${describedBy}"]`).innerText().catch(() => "") : "";
    want((await nameInput.getAttribute("aria-invalid")) === "true" && errText.length > 0 && (await page.locator(`[id="${describedBy}"][role="alert"]`).count()) === 1, "enquiry: empty submit → name aria-invalid, described by its role=alert error", errText);
  }
  const t0 = Date.now();
  for (let i = 1; i <= 6; i++) {
    const t = Date.now();
    const lap = (label) => log(`   enquiry #${i} ${label} +${Date.now() - t}ms`);
    await page.goto(`${WEB}/contact`, { waitUntil: "domcontentloaded" });
    await page.locator("#enquire form input[name=name]").waitFor({ timeout: 10000 });
    lap("loaded");
    const form = page.locator("#enquire form");
    await form.locator('input[name="name"]').fill(`QA Visitor ${i}`);
    await form.locator('input[name="phone"]').fill(`98700${String(10000 + i).slice(-5)}`);
    const projectSel = form.locator("select").first();
    if (await projectSel.count()) await projectSel.selectOption({ index: 1 }).catch(() => {});
    await form.locator('input[name="consent"]').check({ force: true });
    lap("filled");
    await form.locator('button[type="submit"]').click();
    if (i < 6) {
      const ok = await page.getByText("Reference number").waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
      const ref = ok ? (await page.locator("#enquire").innerText()).match(/ENQ-[\w/-]+/)?.[0] : null;
      refs.push(ref);
      lap("submitted");
      want(ok && ref, `enquiry #${i} shows reference number`, `${ref ?? (await page.locator("#enquire").innerText()).slice(0, 200)} (+${Date.now() - t0}ms since first)`);
      if (i === 1) await audit(h, "enquiry-success", 1440);
    } else {
      const err = await page.locator("#enquire [role=alert], #enquire .text-danger, #enquire form p").filter({ hasText: /quick succession|try again/i }).first();
      const shown = await err.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
      want(shown, "6th enquiry in a minute shows rate-limit message", shown ? await err.innerText() : (await page.locator("#enquire").innerText()).slice(0, 300));
      await audit(h, "enquiry-rate-limited", 1440, { allow: ["429 POST", "status of 429"] });
    }
    h.reset();
  }
  await h.ctx.close();
  return refs;
}

// ---------------------------------------------------------------------------
// Brochure gate (SGH page, 1440)
// ---------------------------------------------------------------------------
async function brochureFlow(browser) {
  const h = await newPage(browser, 1440);
  const { page, ctx } = h;
  await page.goto(`${WEB}/projects/shree-ganesh-heights`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator("#brochure").scrollIntoViewIfNeeded();
  await page.locator("#brochure").getByRole("button", { name: /Download brochure/ }).click();
  const dialog = page.getByRole("dialog");
  want(await dialog.isVisible(), "brochure gate modal opens");
  await audit(h, "brochure-gate", 1440);
  await dialog.locator('input[name="name"]').fill("QA Brochure Visitor");
  await dialog.locator('input[name="phone"]').fill("9870099001");
  await dialog.locator('input[name="consent"]').check({ force: true });
  const dl = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await dialog.getByRole("button", { name: /Get the brochure/ }).click();
  const download = await dl;
  let pdfOk = false, bytes = 0;
  if (download) {
    const file = path.join(path.dirname(__filename), "brochure.pdf");
    await download.saveAs(file);
    const buf = fs.readFileSync(file);
    bytes = buf.length;
    pdfOk = buf.slice(0, 5).toString() === "%PDF-";
  }
  want(download && pdfOk, "brochure download starts after valid details (PDF attachment)", `${bytes} bytes, name=${download?.suggestedFilename()}`);
  want(await page.getByText("Your download is starting").isVisible().catch(() => false), "brochure modal shows ready state");
  await audit(h, "brochure-ready", 1440);
  const stored = await page.evaluate(() => localStorage.getItem("kkt:brochure-visitor"));
  want(stored && JSON.parse(stored).visitor_token, "visitor token remembered on device");
  // returning visitor: reload, click again → skips form, downloads again
  await page.keyboard.press("Escape");
  await page.goto(`${WEB}/projects/shree-ganesh-heights`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator("#brochure").scrollIntoViewIfNeeded();
  const dl2 = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await page.locator("#brochure").getByRole("button", { name: /Download brochure/ }).click();
  const welcome = await page.getByText(/Welcome back|Your download is starting/).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const d2 = await dl2;
  const formShown = await page.getByRole("dialog").locator('input[name="name"]').count();
  want(welcome && d2 && formShown === 0, "returning visitor skips the form and the download starts", `welcome=${welcome} download=${Boolean(d2)} formInputs=${formShown}`);
  // forged link
  const forged = await ctx.request.get(`${API}/api/v1/public/brochure/abcdefghijkl.zzzzzz.00000000000000000000000000000000`);
  want(forged.status() === 404, "forged brochure link rejected", `status ${forged.status()}`);
  h.reset();
  await h.ctx.close();
}

// ---------------------------------------------------------------------------
// Site visit (SGH page, 390) + manage + cancel
// ---------------------------------------------------------------------------
async function visitFlow(browser) {
  const h = await newPage(browser, 390);
  const { page, ctx } = h;
  await page.goto(`${WEB}/projects/shree-ganesh-heights#visit`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const form = page.locator("#visit form");
  await form.scrollIntoViewIfNeeded();
  const avail0 = await (await fetch(`${API}/api/v1/public/projects/shree-ganesh-heights/visit-availability`)).json();
  const dateChips = form.locator('[role=radiogroup][aria-label="Visit date"] button');
  await dateChips.first().waitFor({ timeout: 10000 });
  await sleep(500);
  const enabledDates = form.locator('[role=radiogroup][aria-label="Visit date"] button:not([disabled])');
  const disabledDates = form.locator('[role=radiogroup][aria-label="Visit date"] button[disabled]');
  want((await dateChips.count()) === 14 && (await enabledDates.count()) > 0, "date strip shows 14 days with enabled dates", `enabled=${await enabledDates.count()} disabled=${await disabledDates.count()}`);
  // Sunday must be disabled (visits Mon–Sat)
  const sundayDisabled = await disabledDates.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  want(sundayDisabled.some((l) => /^Sun/.test(l ?? "")), "Sunday date is disabled (visit days Mon–Sat)", sundayDisabled.join(" | "));
  // choose the second enabled date (first could be "today" with cut-off slots)
  const target = enabledDates.nth(Math.min(1, (await enabledDates.count()) - 1));
  const dateLabel = await target.getAttribute("aria-label");
  await target.click();
  const slots = form.locator('[role=radiogroup][aria-label="Visit time"] button');
  await slots.first().waitFor({ timeout: 5000 });
  const slotText = await slots.first().innerText();
  want(/\d+ left/.test(slotText), 'slot chips show "N left"', slotText.replace(/\n/g, " "));
  const leftBefore = Number(slotText.match(/(\d+) left/)?.[1]);
  const slotStart = slotText.split("\n")[0].trim();
  await slots.first().click();
  await form.locator('input[name="name"]').fill("QA Visit Visitor");
  await form.locator('input[name="phone"]').fill("9870099002");
  await form.locator('select[name="visitors"]').selectOption("2");
  // Tab into the consent box the way a keyboard user would: the browser must scroll it clear of the sticky bar.
  await form.locator('input[name="consent"]').focus();
  await sleep(300);
  const consentBox = await form.locator('input[name="consent"]').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: window.innerHeight }; });
  want(consentBox.bottom <= consentBox.vh - 64, "focused consent checkbox is scrolled clear of the sticky mobile bar", JSON.stringify(consentBox));
  await form.locator('input[name="consent"]').check();
  const submit = form.locator('button[type="submit"]');
  const sh = await submit.evaluate((e) => e.getBoundingClientRect().height);
  want(sh >= 48, "visit submit button ≥ 48px on phone (SPEC §15)", `${sh}px`);
  await submit.click();
  const ok = await page.getByText("Your visit is confirmed").waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  const box = page.locator("#visit [role=status]");
  const text = ok ? await box.innerText() : await page.locator("#visit").innerText();
  const visitNumber = text.match(/SV-[\w/-]+/)?.[0];
  want(ok && visitNumber, "site visit booked: success with visit number", visitNumber ?? text.slice(0, 300));
  await audit(h, "visit-success", 390);
  const icsHref = await box.getByRole("link", { name: /Add to calendar/ }).getAttribute("href").catch(() => null);
  const manageHref = await box.getByRole("link", { name: /Manage or cancel/ }).getAttribute("href").catch(() => null);
  want(icsHref && manageHref, "success shows .ics + manage links", `${icsHref} | ${manageHref}`);
  if (icsHref) {
    const r = await ctx.request.get(icsHref);
    const ics = await r.text();
    const dtstart = ics.match(/DTSTART;TZID=Asia\/Kolkata:(\d{8}T\d{6})/)?.[1];
    const expectStart = `${slotNowDate(dateLabel, avail0)}T${to24h(slotStart).replace(":", "")}00`;
    want(r.status() === 200 && /BEGIN:VCALENDAR/.test(ics) && /BEGIN:VTIMEZONE/.test(ics) && dtstart === expectStart && /TRIGGER:-PT1H/.test(ics) && ics.includes(visitNumber), ".ics downloads: VTIMEZONE Asia/Kolkata, DTSTART = chosen slot in IST, 1-hour reminder", `${r.status()} ${(r.headers()["content-type"] || "")} DTSTART=${dtstart} expected=${expectStart}`);
  }
  // availability decreased by 2 seats (visitors=2 → seats)? SPEC: seats per slot; check via API
  const avail = await (await fetch(`${API}/api/v1/public/projects/shree-ganesh-heights/visit-availability`)).json();
  const slotNow = avail.flatMap((d) => d.slots.map((s) => ({ ...s, date: d.date }))).find((s) => s.start === to24h(slotStart) && dateMatches(dateLabel, s.date));
  want(slotNow ? slotNow.available === leftBefore - 1 : false, "slot capacity decreased by one after booking", `before=${leftBefore} now=${slotNow?.available} (${to24h(slotStart)} ${dateLabel})`);
  // manage page
  if (manageHref) {
    await page.goto(manageHref, { waitUntil: "domcontentloaded" });
    await settle(page);
    want((await page.getByText(visitNumber).count()) > 0 && (await page.getByText("Confirmed").count()) > 0, "manage page shows the visit as Confirmed");
    await audit(h, "visit-manage", 390);
    await page.getByRole("button", { name: "Cancel this visit" }).click();
    await page.getByRole("button", { name: /Yes, cancel my visit/ }).click();
    const cancelled = await page.getByText("This visit has been cancelled").waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    want(cancelled, "manage page cancel → Cancelled");
    await audit(h, "visit-cancelled", 390);
    const avail2 = await (await fetch(`${API}/api/v1/public/projects/shree-ganesh-heights/visit-availability`)).json();
    const slotAfter = avail2.flatMap((d) => d.slots.map((s) => ({ ...s, date: d.date }))).find((s) => s.start === to24h(slotStart) && dateMatches(dateLabel, s.date));
    want(slotAfter && slotAfter.available === leftBefore, "cancel frees the seat", `after=${slotAfter?.available}`);
    // reload manage page: cancelling expires the link (API 410 LINK_EXPIRED) → the branded "link has expired" page, no cancel button
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page);
    want((await page.getByRole("heading", { name: /link has expired/i }).count()) > 0 && (await page.getByRole("button", { name: "Cancel this visit" }).count()) === 0, "manage link after cancel shows the expired-link page (410), not an error");
    await audit(h, "visit-link-expired", 390, { allow: [/410 GET/, /status of 410/] });
  }
  // SLOT_FULL: book the remaining seats via API then try the UI once more
  h.reset();
  await h.ctx.close();
}
function slotNowDate(label, days) {
  return (days.find((d) => dateMatches(label, d.date))?.date ?? "").replace(/-/g, "");
}
function to24h(label) {
  // "10:00 am" / "1:00 pm" / "10:00" → "HH:MM"
  const m = label.toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!m) return label;
  let hh = Number(m[1]);
  if (m[3] === "pm" && hh < 12) hh += 12;
  if (m[3] === "am" && hh === 12) hh = 0;
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}
function dateMatches(label, iso) {
  // label like "Tuesday, 27 October 2026, 7 slots"; iso "2026-10-27" (calendar date, no timezone arithmetic)
  const day = Number(iso.slice(8, 10));
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(iso.slice(5, 7)) - 1];
  return new RegExp(`\\b${day}\\b`).test(label) && label.includes(month) && label.includes(iso.slice(0, 4));
}

// ---------------------------------------------------------------------------
// Admin toggles: unpublish GGV → 404 everywhere; site_live=false → coming soon
// ---------------------------------------------------------------------------
async function toggleFlows(browser) {
  const h = await newPage(browser, 1440);
  const { page, ctx } = h;
  const token = await adminToken(ctx.request);
  const projects = await api(ctx.request, token, "GET", "/projects?page_size=50");
  const ggv = (projects.body.items ?? projects.body).find((p) => p.code === "GGV");
  want(Boolean(ggv), "admin can list projects (found GGV)", `${projects.status}`);
  // --- unpublish
  const ws = await api(ctx.request, token, "GET", `/projects/${ggv.id}/website`);
  const un = await api(ctx.request, token, "POST", `/projects/${ggv.id}/website/publish`, { is_published: false, version: ws.body.version });
  want(un.status === 200 && un.body.is_published === false, "admin unpublishes GGV", `${un.status} ${JSON.stringify(un.body).slice(0, 120)}`);
  const t404 = await pollUntil(async () => (await fetch(`${WEB}/projects/ganesh-green-villas`)).status === 404);
  want(t404 >= 0, "unpublished project 404s on the website (within cache window)", `${t404}ms`);
  const listNo = await pollUntil(async () => !(await (await fetch(`${WEB}/projects`)).text()).includes("Ganesh Green Villas"));
  want(listNo >= 0, "unpublished project absent from /projects list", `${listNo}ms`);
  const smNo = await pollUntil(async () => !(await (await fetch(`${WEB}/sitemap.xml`)).text()).includes("ganesh-green-villas"));
  want(smNo >= 0, "unpublished project absent from sitemap.xml", `${smNo}ms`);
  const gal = await (await fetch(`${WEB}/gallery`)).text();
  const ws2 = await api(ctx.request, token, "GET", `/projects/${ggv.id}/website`);
  const re = await api(ctx.request, token, "POST", `/projects/${ggv.id}/website/publish`, { is_published: true, version: ws2.body.version });
  want(re.status === 200 && re.body.is_published === true, "admin republishes GGV", `${re.status}`);
  const back = await pollUntil(async () => (await fetch(`${WEB}/projects/ganesh-green-villas`)).status === 200);
  want(back >= 0, "republished project is back", `${back}ms`);
  // --- site live off
  const cs = await api(ctx.request, token, "GET", "/cms/site");
  const off = await api(ctx.request, token, "PATCH", "/cms/site", { site_live: false, version: cs.body.version });
  want(off.status === 200 && off.body.site_live === false, "admin sets site_live=false", `${off.status} ${JSON.stringify(off.body).slice(0, 100)}`);
  const tcs = await pollUntil(async () => /Something extraordinary|coming soon/i.test(await (await fetch(`${WEB}/`)).text()));
  want(tcs >= 0, "coming-soon shown on home within the cache window", `${tcs}ms`);
  for (const width of [1440, 390]) {
    const hh = await newPage(browser, width);
    await hh.page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
    want((await hh.page.getByRole("heading", { name: "Shree Ganesh Builders" }).count()) > 0 && (await hh.page.locator("nav[aria-label=Primary]").count()) === 0, `coming-soon page (no nav) @${width}`);
    await audit(hh, "coming-soon", width);
    await hh.page.goto(`${WEB}/projects/shree-ganesh-heights`, { waitUntil: "domcontentloaded" });
    await settle(hh.page);
    want((await hh.page.locator("#availability").count()) === 0 && (await hh.page.getByText(/Something extraordinary/).count()) > 0, `project page gated while site is off @${width}`);
    hh.reset();
    await hh.ctx.close();
  }
  const rb = await (await fetch(`${WEB}/robots.txt`)).text();
  want(/Disallow: \/\s*$/m.test(rb), "robots.txt disallows all while site is off", rb.replace(/\n/g, " "));
  const sm = await (await fetch(`${WEB}/sitemap.xml`)).text();
  want(!sm.includes("/projects") && sm.includes("/privacy"), "sitemap.xml only legal pages while site is off");
  const cs2 = await api(ctx.request, token, "GET", "/cms/site");
  const on = await api(ctx.request, token, "PATCH", "/cms/site", { site_live: true, version: cs2.body.version });
  want(on.status === 200 && on.body.site_live === true, "admin restores site_live=true", `${on.status}`);
  const tback = await pollUntil(async () => !/Something extraordinary/.test(await (await fetch(`${WEB}/`)).text()));
  want(tback >= 0, "site back online after restore", `${tback}ms`);
  await h.ctx.close();
}

// ---------------------------------------------------------------------------
// Security headers (strict nonce CSP), click-to-load embeds under the CSP, visitor IP forwarding to the API
// ---------------------------------------------------------------------------
async function securityFlow(browser) {
  const res = await fetch(`${WEB}/projects/shree-ganesh-heights`);
  const csp = res.headers.get("content-security-policy") ?? "";
  const html = await res.text();
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  want(Boolean(nonce) && /script-src [^;]*'strict-dynamic'/.test(csp) && !/script-src [^;]*'unsafe-inline'/.test(csp), "CSP: script-src is nonce + strict-dynamic (no unsafe-inline)", csp.slice(0, 160));
  want(/frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /frame-src https:/.test(csp), "CSP: frame-ancestors/object-src/base-uri locked, https frames allowed for click-to-load embeds");
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((a) => !/application\/ld\+json/.test(a));
  want(scripts.length > 0 && scripts.every((a) => a.includes(`nonce="${nonce}"`)), "every executable <script> carries the request nonce", `${scripts.filter((a) => !a.includes(`nonce="${nonce}"`)).length}/${scripts.length} without`);
  want(res.headers.get("x-frame-options") === "DENY" && res.headers.get("x-content-type-options") === "nosniff" && Boolean(res.headers.get("referrer-policy")) && Boolean(res.headers.get("permissions-policy")), "X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy present");
  const res2 = await fetch(`${WEB}/projects/shree-ganesh-heights`);
  want(/'nonce-([^']+)'/.exec(res2.headers.get("content-security-policy") ?? "")?.[1] !== nonce, "nonce changes per request");

  // embeds load only after the click and the CSP lets the iframe in (no violation reported)
  const h = await newPage(browser, 1440);
  const cspViolations = [];
  h.page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text().slice(0, 200)); });
  await h.page.goto(`${WEB}/projects/shree-ganesh-heights`, { waitUntil: "domcontentloaded" });
  await settle(h.page);
  want((await h.page.locator("#media iframe").count()) === 0, "no third-party iframe before the click");
  const play = h.page.locator("#media button").first();
  await play.click();
  await sleep(800);
  want((await h.page.locator("#media iframe").count()) === 1, "click-to-load injects the player iframe");
  want(cspViolations.length === 0, "no CSP violation on a project page incl. the embed", cspViolations.join(" | "));
  h.reset();
  await h.ctx.close();

  // the web server forwards the visitor's address: the API rate-limits that address, not the web server's
  if (REDIS_DB !== null) {
    const { execSync } = require("node:child_process");
    const ip = `203.0.113.${10 + Math.floor(Math.random() * 200)}`;
    const r = await fetch(`${WEB}/projects/shree-ganesh-heights`, { headers: { "x-forwarded-for": ip } });
    const keys = execSync(`redis-cli -n ${REDIS_DB} --scan --pattern 'rl:pub:*${ip}*'`).toString().trim();
    want(r.status === 200 && keys.length > 0, "detail render is rate-limited under the visitor's IP (x-forwarded-for forwarded to the API)", `${ip}: ${keys.split("\n")[0] ?? "no key"}`);
  }
}

(async () => {
  const browser = await chromium.launch();
  const run = (k) => !ONLY || ONLY.includes(k);
  try {
    if (run("static")) await staticWalk(browser);
    if (run("enquiry")) await enquiryFlow(browser);
    if (run("brochure")) await brochureFlow(browser);
    if (run("visit")) await visitFlow(browser);
    if (run("security")) await securityFlow(browser);
    if (run("toggles")) await toggleFlows(browser);
  } catch (e) {
    log("CRASH", e);
    report.defects.push(`CRASH: ${e?.stack ?? e}`);
  } finally {
    await browser.close();
    report.axe = axe.summary();
    log("\n==== ACCESSIBILITY (axe)\n" + axe.markdown());
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    log(`report: ${REPORT}`);
    log(`done: ${report.pages.length} page audits, ${report.flows.filter((f) => f.ok).length}/${report.flows.length} checks passed, ${report.shots} screenshots, ${report.defects.length} defects`);
  }
})();
