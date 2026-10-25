/* Preview glue.
   PREVIEW_MODE=production (frontend/.env): serve the static production builds of ERP (/erp, SPA fallback) and the marketing
   site (/) from one small express server on 3000 with gzip/brotli, immutable hashed assets and no-cache index.html.
   Any other value: start the ERP dev server (3000) + marketing dev server (3002) with HMR (yarn dev). */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const siteDir = path.resolve(root, "../site");
require("dotenv").config({ path: path.join(root, ".env") });
const PROD = process.env.PREVIEW_MODE === "production";
const PORT = process.env.PORT || 3000;

function build(force) {
  const erpOut = path.join(root, "build", "erp", "index.html");
  if (force || !fs.existsSync(erpOut)) {
    console.log("[preview] building packaged bundle (site + ERP + portal)…");
    const r = spawnSync("yarn", ["craco", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, PUBLIC_URL: "/erp", REACT_APP_BASE_PATH: "/erp", GENERATE_SOURCEMAP: "false", INLINE_RUNTIME_CHUNK: "false", DISABLE_ESLINT_PLUGIN: "true" } });
    if (r.status) process.exit(r.status);
  }
}

function serve() {
  const express = require("express");
  const compression = require("compression");
  const zlib = require("zlib");
  const app = express();
  app.disable("x-powered-by");
  app.use(compression({ threshold: 1024, brotli: { enabled: true, zlib: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } } } }));
  const staticOpts = { index: false, setHeaders: (res, file) => { res.setHeader("Cache-Control", /\/static\/|\/_expo\/|\.(woff2?|png|jpg|jpeg|webp|svg|ico)$/.test(file) ? "public, max-age=31536000, immutable" : "public, max-age=3600"); } };
  const build = path.join(root, "build");
  const packaged = fs.existsSync(path.join(build, "erp", "index.html")) && fs.readFileSync(path.join(build, "index.html"), "utf8").includes("data-kkt-loader");
  const noCache = (res) => res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  if (packaged) {
    // 1:1 with static hosting: hashed assets from build/, every unknown path falls back to the ROOT index.html (router-loader picks the surface).
    app.use(express.static(build, staticOpts));
    app.get(/^\/(?!api\/).*/, (req, res) => { noCache(res); res.sendFile(path.join(build, "index.html")); });
    app.listen(PORT, "0.0.0.0", () => console.log(`[preview] packaged build on :${PORT} (site /, ERP /erp, portal /portal — root-index fallback)`));
    return;
  }
  const spa = (dir) => (req, res) => { noCache(res); res.sendFile(path.join(dir, "index.html")); };
  app.use("/erp", express.static(build, staticOpts));
  app.get(/^\/erp(\/.*)?$/, spa(build));
  const portalUrl = process.env.REACT_APP_PORTAL_URL;
  const portalRedirect = (req, res) => res.redirect(302, portalUrl ? `${portalUrl.replace(/\/$/, "")}${req.path.replace(/^\/portal/, "") || "/"}` : "/erp");
  app.get("/portal", portalRedirect);
  app.get(/^\/portal\/.*/, portalRedirect);
  const site = path.join(siteDir, "build");
  if (fs.existsSync(path.join(site, "index.html"))) {
    app.use(express.static(site, staticOpts));
    app.get(/^\/(?!api\/).*/, spa(site));
  } else {
    app.get("/", (req, res) => res.redirect(302, "/erp"));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`[preview] production preview on :${PORT} (ERP /erp, site /)`));
}

if (process.argv.includes("--build-only")) { build(true); process.exit(0); }
if (PROD) { build(false); serve(); return; }

const procs = [];
const run = (name, cmd, args, opts) => {
  const p = spawn(cmd, args, { stdio: "inherit", ...opts });
  p.on("exit", (code) => { if (name === "erp") { procs.forEach((x) => x !== p && x.kill()); process.exit(code ?? 0); } else console.warn(`[dev] ${name} exited with ${code}`); });
  procs.push(p);
  return p;
};
if (process.env.SKIP_SITE !== "true" && fs.existsSync(path.join(siteDir, "package.json"))) {
  if (!fs.existsSync(path.join(siteDir, "node_modules"))) console.warn("[dev] /app/site/node_modules missing — run `yarn install` in /app/site; serving ERP only");
  else run("site", "yarn", ["start"], { cwd: siteDir, env: { ...process.env, PORT: process.env.SITE_PORT || "3002", BROWSER: "none", HOST: "0.0.0.0", DANGEROUSLY_DISABLE_HOST_CHECK: "true", PUBLIC_URL: "/site-assets", WDS_SOCKET_PATH: "/site-ws", WDS_SOCKET_PORT: "443", DISABLE_EMERGENT_OVERLAY: "true", ENABLE_HEALTH_CHECK: "false", REACT_APP_BASE_PATH: "" } });
}
run("erp", "yarn", ["craco", "start"], { cwd: root, env: process.env });
["SIGINT", "SIGTERM"].forEach((s) => process.on(s, () => { procs.forEach((p) => p.kill(s)); process.exit(0); }));
