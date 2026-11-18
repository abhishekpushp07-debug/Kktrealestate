/* Production build wrapper: `yarn build` must not depend on frontend/.env (absent in the cloud build container).
   Defaults apply only when unset, then a plain `craco build`. The ERP is the only frontend and is served at `/`. */
const { spawnSync } = require("child_process");

const defaults = { PUBLIC_URL: "/", REACT_APP_BASE_PATH: "/", GENERATE_SOURCEMAP: "false", INLINE_RUNTIME_CHUNK: "false" };
for (const [k, v] of Object.entries(defaults)) if (!process.env[k]) process.env[k] = v;
console.log(`[build] PUBLIC_URL=${process.env.PUBLIC_URL} REACT_APP_BASE_PATH=${process.env.REACT_APP_BASE_PATH}`);

const craco = require.resolve("@craco/craco/package.json").replace(/package\.json$/, require("@craco/craco/package.json").bin.craco);
const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=2048" };
const r = spawnSync(process.execPath, [craco, "build"], { stdio: "inherit", env });
if (r.status !== 0) process.exit(r.status || 1);

const fs = require("fs");
const path = require("path");
const out = path.resolve(__dirname, "..", "build");
if (!fs.existsSync(path.join(out, "index.html")) || !fs.existsSync(path.join(out, "static"))) {
  console.error("[build] build/index.html or build/static missing");
  process.exit(1);
}
console.log("[build] ok: build/index.html + static/");
