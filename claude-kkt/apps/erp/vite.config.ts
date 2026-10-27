import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * The API the dev server and `vite preview` proxy /api to. VITE_API_URL is also baked into the bundle (empty = same origin, the
 * production setup behind Caddy); KKT_API_PROXY_TARGET lets a same-origin build (VITE_API_URL="") be previewed against any API, so
 * the HttpOnly refresh cookie (contract C1) works locally without cross-origin CORS.
 */
const apiTarget = process.env.KKT_API_PROXY_TARGET || process.env.VITE_API_URL || "http://localhost:4000";

const NM = String.raw`[\\/]node_modules[\\/]`;
/** Libraries the shell needs on every page (router, query client, Radix primitives, toasts, icons, class helpers). */
const SHELL_VENDOR = new RegExp(
  `${NM}(@radix-ui|radix-ui|@floating-ui|sonner|cmdk|lucide-react|clsx|class-variance-authority|tailwind-merge|aria-hidden|react-remove-scroll[\\w-]*|use-callback-ref|use-sidecar|detect-node-es|get-nonce|tslib)[\\\\/]`,
);
/** recharts and everything only recharts uses (redux toolkit, immer, decimal.js-light, d3): one lazy chunk for the chart pages. */
const CHART_VENDOR = new RegExp(
  `${NM}(recharts|d3-[a-z-]+|victory-vendor|internmap|delaunator|robust-predicates|@reduxjs|redux|redux-thunk|react-redux|reselect|immer|decimal\\.js-light|eventemitter3|es-toolkit|tiny-invariant)[\\\\/]`,
);

/**
 * Buckets a node_modules id into a long-lived vendor chunk. Anything not listed (react-hook-form, date-fns, zod helpers used by
 * forms only, …) is left to Rollup, which puts it next to the lazy pages that use it instead of into the first-load payload (audit
 * v3 C9: a 527 KB catch-all vendor chunk loaded on every page).
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (
    new RegExp(`${NM}(react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\\\/]`).test(
      id,
    )
  )
    return "react";
  if (new RegExp(`${NM}@tanstack[\\\\/](query-core|react-query)[\\\\/]`).test(id)) return "query";
  if (CHART_VENDOR.test(id)) return "charts";
  if (SHELL_VENDOR.test(id)) return "ui";
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths({ projects: ["./tsconfig.json"] })],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: { port: 5173 },
  build: {
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 700,
    // dist/.vite/manifest.json feeds scripts/bundle-budget.mjs (first-load and per-chunk size budgets).
    manifest: true,
    rollupOptions: {
      // @kkt/contracts is pure (schemas, enums, labels): modules the ERP does not reference are dropped instead of riding along in
      // the entry chunk because Rollup cannot prove `z.object(...)` side-effect free.
      treeshake: { moduleSideEffects: (id: string) => !/[\\/]packages[\\/]contracts[\\/]src[\\/]/.test(id) },
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: false,
  },
});
