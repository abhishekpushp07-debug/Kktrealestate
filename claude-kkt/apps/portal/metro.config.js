// Expo Metro config for the pnpm monorepo (hoisted node_modules at the workspace root).
// Platform-specific modules (x.web.tsx / x.tsx): Metro resolves platform variants per extension in
// sourceExts order, so a platform file must use the SAME extension as its default counterpart
// (storage.web.ts ↔ storage.ts, files.web.tsx ↔ files.tsx) or the default file wins on that platform.
// `@kkt/contracts` is consumed as TypeScript source and uses ESM-style `./x.js` specifiers
// for `.ts` files, so we remap `.js` → `.ts`/`.tsx` when the `.js` file does not exist.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = Array.from(new Set([...(config.watchFolders ?? []), workspaceRoot]));
config.resolver.nodeModulesPaths = Array.from(
  new Set([
    ...(config.resolver.nodeModulesPaths ?? []),
    path.join(projectRoot, "node_modules"),
    path.join(workspaceRoot, "node_modules"),
  ]),
);

const previousResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const base = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3));
    if (!fs.existsSync(`${base}.js`)) {
      for (const ext of [".ts", ".tsx"]) {
        if (fs.existsSync(`${base}${ext}`)) {
          return { type: "sourceFile", filePath: `${base}${ext}` };
        }
      }
    }
  }
  return previousResolve
    ? previousResolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
