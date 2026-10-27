import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests for the portal's pure modules (no React Native runtime); screens are covered by docs/qa/portal. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
