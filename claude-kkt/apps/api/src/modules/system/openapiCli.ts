/**
 * OpenAPI snapshot CLI (no database or Redis needed):
 *
 *   pnpm --filter @kkt/api openapi           # regenerate docs/openapi/v1.json (after an intentional, compatible API change)
 *   pnpm --filter @kkt/api openapi:check     # exit 1 on breaking changes against the committed snapshot (CI)
 *
 * Breaking changes need the deprecation process in docs/VERSIONING.md (or /api/v2), never a silent snapshot refresh.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateOpenApi, OPENAPI_SNAPSHOT, readSnapshot } from "./openapi.js";
import { diffOpenApi, formatDiff } from "./openapiDiff.js";

process.env["NODE_ENV"] ??= "test";
process.env["LOG_LEVEL"] ??= "fatal";

const check = process.argv.includes("--check");
const force = process.argv.includes("--force");
const doc = await generateOpenApi();

if (check || existsSync(OPENAPI_SNAPSHOT)) {
  const diff = existsSync(OPENAPI_SNAPSHOT) ? diffOpenApi(readSnapshot(), doc) : { breaking: [], additive: ["(no snapshot yet)"], notices: [] };
  process.stdout.write(`${formatDiff(diff)}\n`);
  if (check) process.exit(diff.breaking.length > 0 ? 1 : 0);
  if (diff.breaking.length > 0 && !force) {
    process.stderr.write("\nRefusing to overwrite the snapshot with breaking changes. Follow docs/VERSIONING.md, or pass --force for an approved v1 exception.\n");
    process.exit(1);
  }
}
await mkdir(dirname(OPENAPI_SNAPSHOT), { recursive: true });
// formatted exactly as `prettier --check` (CI format job) expects
const prettier = await import("prettier");
const options = (await prettier.resolveConfig(OPENAPI_SNAPSHOT)) ?? {};
await writeFile(OPENAPI_SNAPSHOT, await prettier.format(JSON.stringify(doc), { ...options, parser: "json", filepath: OPENAPI_SNAPSHOT }));
process.stdout.write(`wrote ${OPENAPI_SNAPSHOT} (${Object.keys((doc["paths"] as object) ?? {}).length} paths)\n`);
process.exit(0);
