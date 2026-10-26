import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Path of the committed v1 snapshot (docs/openapi/v1.json at the repository root). */
export const OPENAPI_SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "docs", "openapi", "v1.json");

type Json = Record<string, unknown>;

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Json).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
}

/**
 * Generates the public OpenAPI document of /api/v1 from the code without Postgres or Redis (an offline app). The result is normalised so
 * the committed snapshot only changes when the API changes: environment-specific `servers`/`info.version` are fixed and keys are sorted.
 */
export async function generateOpenApi(): Promise<Json> {
  const { buildApp } = await import("../../app.js");
  const app = await buildApp({ logger: false, offline: true });
  try {
    await app.ready();
    const doc = JSON.parse(JSON.stringify(app.swagger())) as Json;
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json"), "utf8")) as { version: string };
    doc["servers"] = [{ url: "/", description: "Same origin as the ERP, portal or website host (the API is served under /api/v1 on each)" }];
    doc["info"] = { ...(doc["info"] as Json), version: pkg.version, "x-api-version": "v1" };
    return sortKeys(doc) as Json;
  } finally {
    await app.close();
  }
}

/** Reads the committed snapshot. */
export function readSnapshot(path = OPENAPI_SNAPSHOT): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}
