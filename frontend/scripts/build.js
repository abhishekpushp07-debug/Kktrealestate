/* Production build wrapper: `yarn build` must not depend on frontend/.env (absent in the cloud build container).
   Defaults apply only when unset; then `craco build` (packaging runs in its webpack `done` hook) + idempotent re-package. */
const { spawnSync } = require("child_process");


const defaults = { PUBLIC_URL: "/erp", REACT_APP_BASE_PATH: "/erp", GENERATE_SOURCEMAP: "false", INLINE_RUNTIME_CHUNK: "false" };
for (const [k, v] of Object.entries(defaults)) if (!process.env[k]) process.env[k] = v;
console.log(`[build] PUBLIC_URL=${process.env.PUBLIC_URL} REACT_APP_BASE_PATH=${process.env.REACT_APP_BASE_PATH}`);

const craco = require.resolve("@craco/craco/package.json").replace(/package\.json$/, require("@craco/craco/package.json").bin.craco);
const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=2048" };
const r = spawnSync(process.execPath, [craco, "build"], { stdio: "inherit", env });
if (r.status !== 0) process.exit(r.status || 1);

const { packageBuild } = require("./package-build");
try { packageBuild(); } catch (e) { console.error(`[package] ${e.message}`); process.exit(1); }
