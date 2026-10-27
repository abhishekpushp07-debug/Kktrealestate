/**
 * Phase 7 foundation review (docs/hardening/phase7-review-foundation.md): defects found in the foundation stage and fixed here.
 * - IN_USE usage counts compare the key in the column's own type, so the FK index added by migration 0005 serves the count (the cast of
 *   the column to text forced a sequential scan of the referencing table on every refused delete) and the count is capped;
 * - the body-hash ETag never turns a write into a 304 (If-None-Match only short-circuits GET/HEAD);
 * - the process-local tenant cache is bounded (slugs and hosts come from unauthenticated headers; misses are cached).
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Executor } from "@kkt/db";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
let admin: string;

beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  t = await buildTestApp({
    extraRoutes: (api) => {
      for (const method of ["GET", "POST"] as const)
        route(api, {
          method,
          url: "/_test/etag-probe",
          permission: "master.read",
          schema: { response: { 200: z.object({ hello: z.string() }) } },
          handler: async () => ({ hello: "world" }),
        });
    },
  });
  admin = (await t.loginAs("admin")).access_token;
});

afterAll(async () => {
  await t?.close();
});

describe("IN_USE usage count (lib/pgErrors.ts withUsageCount)", () => {
  it("counts the referencing rows through the FK index (key cast to the column type, never the column to text) and caps the count", async () => {
    const { mapIntegrityError, withUsageCount, USAGE_COUNT_CAP } = await import("../../src/lib/pgErrors.js");
    let failure: unknown;
    try {
      await t.app.db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM roles WHERE id = (SELECT role_id FROM users ORDER BY created_at LIMIT 1)`);
      });
    } catch (err) {
      failure = err;
    }
    const mapped = mapIntegrityError(failure);
    expect(mapped?.code).toBe("IN_USE");

    const seen: { sql: string; params: unknown[] }[] = [];
    const dialect = (t.app.db as unknown as { dialect: { sqlToQuery(q: unknown): { sql: string; params: unknown[] } } })
      .dialect;
    const spy = {
      execute: (q: unknown) => {
        seen.push(dialect.sqlToQuery(q));
        return t.app.db.execute(q as Parameters<typeof t.app.db.execute>[0]);
      },
    } as unknown as Executor;
    const withCount = await withUsageCount(spy, failure, mapped!);
    const [n] = await t.app.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM users WHERE role_id = (SELECT role_id FROM users ORDER BY created_at LIMIT 1)`;
    expect(withCount.details?.["usage_count"]).toBe(n!.n);

    const count = seen.find((q) => /count\(\*\)/.test(q.sql))!;
    expect(count.sql).not.toMatch(/::text/);
    expect(count.sql).toMatch(/CAST\(\$1 AS uuid\)/);
    expect(count.sql).toContain(`LIMIT $2`);
    expect(count.params[1]).toBe(USAGE_COUNT_CAP);
    // with sequential scans priced out, the planner reaches users.role_id through an index (impossible with role_id::text = $1)
    const plan = await t.app.sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL enable_seqscan = off");
      return tx.unsafe(`EXPLAIN ${count.sql}`, count.params as string[]);
    });
    const text = plan.map((r) => String((r as Record<string, unknown>)["QUERY PLAN"])).join("\n");
    expect(text).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
  });
});

describe("ETag plugin (plugins/etag.ts)", () => {
  it("If-None-Match short-circuits a GET with 304, never a write", async () => {
    const g = await t.request("GET", "/api/v1/_test/etag-probe", { token: admin });
    expect(g.status).toBe(200);
    const tag = String(g.headers["etag"]);
    expect(tag).toMatch(/^"[A-Za-z0-9+/=]+"$/);
    const cached = await t.request("GET", "/api/v1/_test/etag-probe", {
      token: admin,
      headers: { "if-none-match": tag },
    });
    expect(cached.status).toBe(304);
    const write = await t.request<{ hello: string }>("POST", "/api/v1/_test/etag-probe", {
      token: admin,
      body: {},
      headers: { "if-none-match": tag },
    });
    expect(write.status, write.text).toBe(200);
    expect(write.body.hello).toBe("world");
  });
});

describe("tenant cache (lib/tenant.ts)", () => {
  it("stays bounded under a flood of unknown slugs and hosts, and still resolves real companies", async () => {
    const { companyIdBySlug, companyIdByHost, clearTenantCache, tenantCacheSize, TENANT_CACHE_MAX_ENTRIES } =
      await import("../../src/lib/tenant.js");
    clearTenantCache();
    const extra = 200;
    for (let i = 0; i < TENANT_CACHE_MAX_ENTRIES + extra; i += 1) {
      if (i % 2 === 0) expect(await companyIdBySlug(t.app.db, `nobody-${i}`)).toBeNull();
      else expect(await companyIdByHost(t.app.db, `h${i}.unknown.example`)).toBeNull();
      expect(tenantCacheSize()).toBeLessThanOrEqual(TENANT_CACHE_MAX_ENTRIES);
    }
    const [c] = await t.app.sql<{ slug: string }[]>`SELECT slug FROM companies WHERE id = ${t.companyId}`;
    expect(await companyIdBySlug(t.app.db, c!.slug)).toBe(t.companyId);
    expect(tenantCacheSize()).toBeLessThanOrEqual(TENANT_CACHE_MAX_ENTRIES);
    clearTenantCache();
  });

  it("an unknown x-kkt-company on a public route is still 400 COMPANY_REQUIRED after the flood", async () => {
    const r = await t.request<ErrorBody>("GET", "/api/v1/public/projects", {
      headers: { "x-kkt-company": "nobody-1" },
    });
    expect(r.status, r.text).toBe(400);
    expect(r.body.error.code).toBe("COMPANY_REQUIRED");
  });
});
