/**
 * Process preload: runs before anything else touches the libuv thread pool (argon2 hashing, sharp image work, zlib compression and fs all
 * share it, and libuv sizes it ONCE, on first use, from UV_THREADPOOL_SIZE). The default of 4 threads lets four concurrent password
 * hashes stall every upload and every file read, so the API and the worker run with 16 (config UV_THREADPOOL_SIZE overrides).
 *
 * Loaded first by src/telemetry.ts (`node --import ./dist/telemetry.js …`, the production command) and imported first by server.ts and
 * worker.ts (dev). ESM hoists every `import`, so setting the variable inside server.ts itself would come after the dependency graph was
 * loaded; a preload module (or the first import of the entry) is evaluated before any other module of the graph runs.
 *
 * It must stay free of application imports.
 */
const DEFAULT_UV_THREADPOOL_SIZE = 16;

/** The thread-pool size this process asks libuv for (valid UV_THREADPOOL_SIZE from the environment, else 16). */
export function threadPoolSize(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env["UV_THREADPOOL_SIZE"]);
  return Number.isInteger(n) && n >= 1 && n <= 1024 ? n : DEFAULT_UV_THREADPOOL_SIZE;
}

process.env["UV_THREADPOOL_SIZE"] = String(threadPoolSize());
