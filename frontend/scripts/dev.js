/* Preview glue: starts the ERP dev server (3000) and the standalone marketing site (3002). Production builds don't use this. */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const siteDir = path.resolve(__dirname, "../../site");
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
run("erp", "yarn", ["craco", "start"], { cwd: path.resolve(__dirname, ".."), env: process.env });
["SIGINT", "SIGTERM"].forEach((s) => process.on(s, () => { procs.forEach((p) => p.kill(s)); process.exit(0); }));
