import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts", "src/modules/*/index.ts"],
  outDir: "dist",
  splitting: true,
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: ["@kkt/contracts", "@kkt/domain", "@kkt/db"],
  external: ["sharp", "argon2", "pdfkit"],
});
