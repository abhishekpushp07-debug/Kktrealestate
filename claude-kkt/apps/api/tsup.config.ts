import { defineConfig } from "tsup";
export default defineConfig({
  entry: { server: "src/server.ts", worker: "src/worker.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: ["@kkt/contracts", "@kkt/domain", "@kkt/db"],
  external: ["sharp", "argon2", "pdfkit"],
});
