/* Packages the three surfaces into ONE CRA build output (frontend/build):
     /            marketing site   (deploy-assets/site  → build/site-assets/* + build/index.html)
     /erp/*       ERP              (CRA output moved into build/erp/)
     /portal/*    customer portal  (deploy-assets/portal → build/portal/)
   Idempotent: safe to run after every `craco build` (webpack `done` hook) and again from `yarn build`. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const BUILD = path.join(root, "build");
const ASSETS = path.join(root, "deploy-assets");
const MARKER = "<!--kkt-router-loader-->";
const SURFACES = new Set(["erp", "portal", "site-assets"]);

const LOADER = `${MARKER}<script data-kkt-loader>(function(){var p=location.pathname,s=/^\\/erp(\\/|$)/.test(p)?"/erp/":/^\\/portal(\\/|$)/.test(p)?"/portal/":null;if(!s)return;window.__KKT_SURFACE=s;document.documentElement.style.visibility="hidden";function fail(){document.documentElement.style.visibility="";var m=function(){document.body.innerHTML='<div style="font-family:system-ui,sans-serif;padding:48px 24px;text-align:center;color:#0B1F3A" data-testid="loader-failed"><p style="font-size:18px;font-weight:700">Loading failed</p><p style="color:#64748b">We could not load this page. Check your connection and try again.</p><button onclick="location.reload()" style="margin-top:12px;padding:10px 20px;border-radius:999px;border:0;background:#0B1F3A;color:#fff;font-weight:600;cursor:pointer">Retry</button></div>'};document.body?m():document.addEventListener("DOMContentLoaded",m)}fetch(s+"index.html",{cache:"no-cache",credentials:"same-origin"}).then(function(r){if(!r.ok)throw new Error(r.status);return r.text()}).then(function(h){if(h.indexOf("data-kkt-loader")!==-1)throw new Error("fallback");document.open();document.write(h);document.close()}).catch(fail)})();</script>`;

const log = (m) => console.log(`[package] ${m}`);
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const cp = (src, dst) => fs.cpSync(src, dst, { recursive: true, force: true });
const read = (p) => fs.readFileSync(p, "utf8");
const has = (p) => fs.existsSync(p);

function erpAtRoot() {
  const idx = path.join(BUILD, "index.html");
  return has(idx) && read(idx).includes("/erp/static/") && !read(idx).includes(MARKER);
}

function moveErp() {
  if (!erpAtRoot()) return false;
  const dst = path.join(BUILD, "erp");
  rm(dst);
  fs.mkdirSync(dst);
  for (const e of fs.readdirSync(BUILD)) {
    if (SURFACES.has(e)) continue;
    cp(path.join(BUILD, e), path.join(dst, e));
  }
  log("ERP → build/erp/");
  return true;
}

// Root ERP leftovers (static/*.js|css) must survive until react-scripts has printed its size report.
function cleanRoot() {
  for (const e of fs.readdirSync(BUILD)) {
    if (SURFACES.has(e) || e === "index.html") continue;
    if (!has(path.join(BUILD, "erp", e))) continue;
    if (has(path.join(BUILD, "site-assets", e))) continue;
    rm(path.join(BUILD, e));
  }
}

function copySite() {
  const src = path.join(ASSETS, "site");
  if (!has(path.join(src, "index.html"))) throw new Error(`deploy-assets missing: ${src}/index.html — run \`yarn package:assets\``);
  const dst = path.join(BUILD, "site-assets");
  rm(dst);
  cp(src, dst);
  for (const f of ["robots.txt", "favicon.svg", "manifest.json"]) if (has(path.join(src, f))) cp(path.join(src, f), path.join(BUILD, f));
  let html = read(path.join(src, "index.html"));
  if (!html.includes(MARKER)) html = html.replace(/<head([^>]*)>/i, (m) => `${m}${LOADER}`);
  fs.writeFileSync(path.join(BUILD, "index.html"), html);
  log("site → build/ (assets under /site-assets, router-loader injected)");
}

function copyPortal() {
  const src = path.join(ASSETS, "portal");
  if (!has(path.join(src, "index.html"))) throw new Error(`deploy-assets missing: ${src}/index.html — run \`yarn package:assets\``);
  const dst = path.join(BUILD, "portal");
  rm(dst);
  cp(src, dst);
  log("portal → build/portal/");
}

function verify() {
  const must = ["index.html", "erp/index.html", "portal/index.html", "erp/asset-manifest.json"];
  for (const m of must) if (!has(path.join(BUILD, m))) throw new Error(`package verification failed: build/${m} missing`);
  const rootHtml = read(path.join(BUILD, "index.html"));
  if (!rootHtml.includes("data-kkt-loader")) throw new Error("router-loader missing from build/index.html");
  const manifest = JSON.parse(read(path.join(BUILD, "erp", "asset-manifest.json")));
  for (const f of Object.values(manifest.files)) {
    if (!f.startsWith("/erp/")) throw new Error(`ERP asset not under /erp: ${f} (set PUBLIC_URL=/erp)`);
    if (!has(path.join(BUILD, f.replace(/^\//, "")))) throw new Error(`ERP asset missing: ${f}`);
  }
  for (const m of rootHtml.matchAll(/(?:src|href)="(\/site-assets\/[^"]+)"/g)) if (!has(path.join(BUILD, m[1]))) throw new Error(`site asset missing: ${m[1]}`);
  log("verified: build/index.html (site), build/erp/index.html, build/portal/index.html");
}

function packageBuild({ clean = true } = {}) {
  if (!has(path.join(BUILD, "index.html"))) throw new Error("build/index.html missing — run `craco build` first");
  moveErp();
  copySite();
  copyPortal();
  if (clean) cleanRoot();
  verify();
}

module.exports = { packageBuild, cleanRoot, BUILD };

if (require.main === module) {
  try { packageBuild(); } catch (e) { console.error(`[package] ${e.message}`); process.exit(1); }
}
