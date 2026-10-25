import { cp } from "node:fs/promises";
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
  // @kkt/db resolves its migration folders relative to the bundle, so ship them next to the entry (dist/drizzle, dist/sql).
  onSuccess: async () => {
    await cp("../../packages/db/drizzle", "dist/drizzle", { recursive: true });
    await cp("../../packages/db/src/sql", "dist/sql", { recursive: true });
  },
});
