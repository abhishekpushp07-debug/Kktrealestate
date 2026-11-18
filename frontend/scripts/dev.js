/* Preview glue — the ERP is the only frontend and is served at `/`.
   PREVIEW_MODE=production (frontend/.env): serve the static production build from one small express server on 3000
   (gzip/brotli, immutable hashed assets, no-cache index.html, SPA fallback; `/api/*` is never touched here).
   Any other value: `craco start` dev server with HMR. Legacy `/erp` and `/erp/*` URLs redirect permanently to the root path. */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(root, ".env") });
const PROD = process.env.PREVIEW_MODE === "production";
const PORT = process.env.PORT || 3000;
const BUILD_ENV = { PUBLIC_URL: "/", REACT_APP_BASE_PATH: "/", GENERATE_SOURCEMAP: "false", INLINE_RUNTIME_CHUNK: "false", DISABLE_ESLINT_PLUGIN: "true" };

function build(force) {
  const out = path.join(root, "build", "index.html");
  if (force || !fs.existsSync(out)) {
    console.log("[preview] building ERP bundle…");
    const r = spawnSync("yarn", ["craco", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, ...BUILD_ENV } });
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
  const build = path.join(root, "build");
  const staticOpts = { index: false, setHeaders: (res, file) => { res.setHeader("Cache-Control", /\/static\//.test(file) ? "public, max-age=31536000, immutable" : "public, max-age=3600"); } };
  app.get(/^\/erp(\/.*)?$/, (req, res) => res.redirect(301, (req.path.replace(/^\/erp/, "") || "/") + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "")));
  app.use(express.static(build, staticOpts));
  app.get(/^\/(?!api\/).*/, (req, res) => { res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); res.sendFile(path.join(build, "index.html")); });
  app.listen(PORT, "0.0.0.0", () => console.log(`[preview] KKT ERP production preview on :${PORT} (root, SPA fallback)`));
}

if (process.argv.includes("--build-only")) { build(true); process.exit(0); }
if (PROD) { build(false); serve(); } else {
  const p = spawn("yarn", ["craco", "start"], { cwd: root, stdio: "inherit", env: { ...process.env, PUBLIC_URL: "/", REACT_APP_BASE_PATH: "/" } });
  p.on("exit", (code) => process.exit(code ?? 0));
}
