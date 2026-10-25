/* Refreshes the committed deploy artifacts used by package-build.js:
     deploy-assets/site    ← `yarn build` of /app/site with PUBLIC_URL=/site-assets
     deploy-assets/portal  ← `npx expo export --platform web` of /app/mobile (baseUrl /portal)
   Run `yarn package:assets` whenever the site or the portal changes (definition of done for every phase). */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const siteDir = path.resolve(root, "../site");
const mobileDir = path.resolve(root, "../mobile");
const ASSETS = path.join(root, "deploy-assets");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const run = (cmd, args, cwd, env) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status) { console.error(`[package:assets] ${cmd} ${args.join(" ")} failed in ${cwd}`); process.exit(r.status); }
};
const replace = (src, dst) => { fs.rmSync(dst, { recursive: true, force: true }); fs.cpSync(src, dst, { recursive: true }); };

if (!only || only === "site") {
  if (!fs.existsSync(path.join(siteDir, "node_modules"))) { console.error("[package:assets] /app/site/node_modules missing — run `yarn install` there"); process.exit(1); }
  run("yarn", ["build"], siteDir, { PUBLIC_URL: "/site-assets", GENERATE_SOURCEMAP: "false", DISABLE_ESLINT_PLUGIN: "true", REACT_APP_BASE_PATH: "", REACT_APP_PORTAL_URL: "", INLINE_RUNTIME_CHUNK: "false" });
  replace(path.join(siteDir, "build"), path.join(ASSETS, "site"));
  console.log("[package:assets] site → deploy-assets/site");
}
if (!only || only === "portal") {
  if (!fs.existsSync(path.join(mobileDir, "node_modules"))) { console.error("[package:assets] /app/mobile/node_modules missing — run `yarn install` there"); process.exit(1); }
  run("npx", ["expo", "export", "--platform", "web", "--output-dir", "dist"], mobileDir, { CI: "1" });
  const html = fs.readFileSync(path.join(mobileDir, "dist", "index.html"), "utf8");
  if (!html.includes("/portal/")) { console.error("[package:assets] portal export is not based at /portal — check app.json experiments.baseUrl"); process.exit(1); }
  replace(path.join(mobileDir, "dist"), path.join(ASSETS, "portal"));
  console.log("[package:assets] portal → deploy-assets/portal");
}
fs.writeFileSync(path.join(ASSETS, "BUILT_AT"), `${new Date().toISOString()}\n`);
