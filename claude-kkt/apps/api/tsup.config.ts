import { cp } from "node:fs/promises";
import { defineConfig } from "tsup";
export default defineConfig({
  // pdfWorker: the PDF worker-thread entry (modules/reports/services/pdfPool.ts loads dist/modules/reports/services/pdfWorker.js, so a
  // worker thread only loads pdfkit + the renderer instead of the whole reports module graph and the app config).
  // cli/restore: the restore CLI ships in the image (`node dist/cli/restore.js --file … --database-url … --confirm`, docs/RESTORE.md).
  entry: ["src/server.ts", "src/worker.ts", "src/modules/*/index.ts", "src/modules/reports/services/pdfWorker.ts", "src/cli/restore.ts"],
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
