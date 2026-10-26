import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const apiTarget = process.env.VITE_API_URL || "http://localhost:4000";

/** Buckets a node_modules id into one of the long-lived vendor chunks. */
function vendorChunk(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return "react";
  if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return "query";
  if (
    /[\\/]node_modules[\\/](recharts|d3-[a-z-]+|victory-vendor|internmap|delaunator|robust-predicates)[\\/]/.test(id)
  ) {
    return "charts";
  }
  return "vendor";
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
    rollupOptions: {
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
