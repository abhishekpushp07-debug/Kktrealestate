import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FastifyInstance, FastifyPluginAsync, FastifyPluginCallback } from "fastify";

/** Modules wired explicitly by app.ts (always on); every other `modules/<name>/index.(ts|js)` is auto-discovered. */
export const CORE_MODULES = [
  "auth",
  "users",
  "roles",
  "masters",
  "notifications",
  "search",
  "audit",
  "system",
] as const;

type Plugin = FastifyPluginAsync | FastifyPluginCallback;

/**
 * Directory holding the module folders. In the source tree this file lives in `src/modules/`; in the tsup bundle it is inlined into a
 * chunk at `dist/`, next to the `dist/modules/<name>/index.js` entries, so the root is `<chunk dir>/modules` there.
 */
function resolveModulesRoot(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  if (basename(dir) === "modules") return dir;
  const nested = join(dir, "modules");
  return isDirectory(nested) ? nested : dir;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const here = resolveModulesRoot();

/** Names of module directories next to this file that contain an index.ts/index.js. */
export function discoverModules(root = here): string[] {
  return readdirSync(root)
    .filter((name) => {
      try {
        if (!statSync(join(root, name)).isDirectory()) return false;
      } catch {
        return false;
      }
      return ["index.ts", "index.js", "index.mts", "index.mjs"].some((f) => exists(join(root, name, f)));
    })
    .sort();
}

function exists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Applies the KKT_MODULES filter: when set (comma-separated names) only those non-core modules load,
 * so a half-built module from another developer cannot break unrelated test runs. Unset = everything.
 */
export function selectModules(discovered: string[], filter = process.env["KKT_MODULES"]): string[] {
  const nonCore = discovered.filter((n) => !(CORE_MODULES as readonly string[]).includes(n));
  if (filter === undefined || filter.trim() === "") return nonCore;
  const wanted = new Set(
    filter
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return nonCore.filter((n) => wanted.has(n));
}

function pickPlugin(name: string, mod: Record<string, unknown>): Plugin {
  if (typeof mod["default"] === "function") return mod["default"] as Plugin;
  const named = Object.entries(mod).find(([k, v]) => k.endsWith("Module") && typeof v === "function");
  if (named) return named[1] as Plugin;
  throw new Error(`Module "${name}" must export default a Fastify plugin (or a named export ending in "Module")`);
}

/** Dynamically imports one module directory and returns its Fastify plugin. */
export async function loadModule(name: string, root = here): Promise<Plugin> {
  const file = ["index.ts", "index.js", "index.mts", "index.mjs"].map((f) => join(root, name, f)).find(exists);
  if (!file) throw new Error(`Module "${name}" has no index file`);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  return pickPlugin(name, mod);
}

/** Registers every discovered non-core module under `prefix`; returns the names registered. */
export async function registerDiscoveredModules(app: FastifyInstance, prefix: string, root = here): Promise<string[]> {
  const names = selectModules(discoverModules(root));
  for (const name of names) {
    const plugin = await loadModule(name, root);
    await app.register(plugin as FastifyPluginAsync, { prefix });
    app.log.info({ module: name }, "module registered");
  }
  return names;
}
