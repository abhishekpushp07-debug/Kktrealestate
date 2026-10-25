import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { roomTypes } from "@kkt/db";
import { paginate } from "../../src/lib/list.js";
import { withOptionalVersion } from "../../src/lib/version.js";
import { PDF_BYTES, pngBytes, uploadMultipart } from "./fixtures/web.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Cross-cutting fixes from docs/TODO-integration.md: microsecond-exact keyset cursors (1), multipart Idempotency-Key fingerprints (2),
 * documents.version + If-Match (3), review indexes (4), estimated counts above a threshold unless exact=true (5),
 * withOptionalVersion keeping refinements (8), OR-permissions in the route registry (9), service_requests.category_id NOT NULL (11).
 */

let t: TestContext;
let admin: string;
let marketing: string;
let sales: string;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  marketing = (await t.loginAs("marketing")).access_token;
  sales = (await t.loginAs("sales")).access_token;
});
afterAll(async () => { await t?.close(); });

describe("1 · keyset cursors on timestamp sorts are microsecond-exact", () => {
  it("rows written in the same millisecond are all returned, once, across pages", async () => {
    const base = "2025-06-01 10:00:00";
    for (const [i, us] of ["000100", "000200", "000300", "000400"].entries()) {
      await t.app.sql`insert into room_types (company_id, name, code, sort_order, created_at) values (${t.companyId}, ${`Room ${i}`}, ${`R${i}`}, ${i}, ${`${base}.${us}+00`}::timestamptz)`;
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const url: string = `/api/v1/masters/room-types?limit=1&sort=created_at${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const r: { status: number; text: string; body: { items: { id: string; code: string }[]; next_cursor: string | null } } = await t.request<{ items: { id: string; code: string }[]; next_cursor: string | null }>("GET", url, { token: admin });
      expect(r.status, r.text).toBe(200);
      seen.push(...r.body.items.map((i) => i.code));
      cursor = r.body.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["R0", "R1", "R2", "R3"]);
    // descending too
    const desc = await t.request<{ items: { code: string }[]; next_cursor: string | null }>("GET", "/api/v1/masters/room-types?limit=3&sort=-created_at", { token: admin });
    expect(desc.body.items.map((i) => i.code)).toEqual(["R3", "R2", "R1"]);
    const rest = await t.request<{ items: { code: string }[] }>("GET", `/api/v1/masters/room-types?limit=3&sort=-created_at&cursor=${encodeURIComponent(desc.body.next_cursor!)}`, { token: admin });
    expect(rest.body.items.map((i) => i.code)).toEqual(["R0"]);
  });
});

describe("5 · list totals: exact below the threshold or on exact=true, planner estimate above it", () => {
  it("paginate() answers with the planner's estimate when the table is above the threshold and the caller did not ask for exact", async () => {
    const exact = await paginate(t.app.db, { table: roomTypes, sort: { allowed: { name: roomTypes.name }, default: "name" }, page_size: 2, exact: true, estimateAbove: -2 });
    expect(exact.total).toBe(4);
    expect(exact.items).toHaveLength(2);
    const estimated = await paginate(t.app.db, { table: roomTypes, sort: { allowed: { name: roomTypes.name }, default: "name" }, page_size: 2, estimateAbove: -2 });
    expect(Number.isInteger(estimated.total)).toBe(true);
    expect(estimated.total).toBeGreaterThanOrEqual(0);
    const small = await paginate(t.app.db, { table: roomTypes, sort: { allowed: { name: roomTypes.name }, default: "name" }, page_size: 2 });
    expect(small.total).toBe(4); // tiny table → exact count
    const viaApi = await t.request<{ total: number }>("GET", "/api/v1/masters/room-types?exact=true", { token: admin });
    expect(viaApi.status, viaApi.text).toBe(200);
    expect(viaApi.body.total).toBe(4);
  });
});

describe("8 · withOptionalVersion keeps refinements", () => {
  it("a refined update schema still rejects the refined case once version is optional", () => {
    const schema = z.strictObject({ version: z.int().min(1), a: z.int(), b: z.int() }).refine((v) => v.a <= v.b, { message: "a must be ≤ b", path: ["b"] });
    const wrapped = withOptionalVersion(schema);
    expect(wrapped.safeParse({ a: 1, b: 2 }).success).toBe(true);
    expect(wrapped.safeParse({ version: 3, a: 1, b: 2 }).success).toBe(true);
    const bad = wrapped.safeParse({ a: 5, b: 2 });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain("a must be ≤ b");
    expect(wrapped.safeParse({ a: 1, b: 2, extra: true }).success).toBe(false); // still strict
  });
});

describe("9 · OR-permissions are registered truthfully and enforced as any-of", () => {
  it("PATCH /projects/:id/website is registered as project.write|cms.write; Marketing (cms.write) may write, Sales may not", async () => {
    const entry = t.app.routeRegistry.find((r) => r.method === "PATCH" && r.url === "/api/v1/projects/:id/website");
    expect(entry?.permission).toBe("project.write|cms.write");
    const visit = t.app.routeRegistry.find((r) => r.method === "PATCH" && r.url === "/api/v1/projects/:id/visit-settings");
    expect(visit?.permission).toBe("project.write|cms.write");
    const [p] = await t.app.sql<{ id: string }[]>`insert into projects (company_id, name, code, city) values (${t.companyId}, 'Central Towers', 'CT', 'Patna') returning id`;
    const cur = await t.request<{ version: number }>("GET", `/api/v1/projects/${p!.id}/website`, { token: marketing });
    expect(cur.status, cur.text).toBe(200);
    const ok = await t.request<{ highlights: string[] }>("PATCH", `/api/v1/projects/${p!.id}/website`, { token: marketing, body: { version: cur.body.version, highlights: ["Vastu"] } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.highlights).toEqual(["Vastu"]);
    const denied = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${p!.id}/website`, { token: sales, body: { version: 2, highlights: ["x"] } });
    expect(denied.status).toBe(403);
    expect(denied.body.error.details?.["alternatives"]).toEqual(["project.write", "cms.write"]);
    expect((await t.request("GET", `/api/v1/projects/${p!.id}/website`, { token: sales })).status).toBe(200);
  });
});

describe("2 + 3 · multipart idempotency fingerprint and documents.version", () => {
  it("same Idempotency-Key with a different file → 422 IDEMPOTENCY_MISMATCH; PATCH honours If-Match and bumps version", async () => {
    const [p] = await t.app.sql<{ id: string }[]>`select id from projects where code = 'CT'`;
    const key = `central-doc-${Date.now()}`;
    const png = await pngBytes(300, 200);
    const first = await uploadMultipart(t, admin, "/api/v1/documents", { entity_type: "PROJECT", entity_id: p!.id, title: "Plan" }, { name: "plan.png", data: png }, { "idempotency-key": key });
    expect(first.status, first.text).toBe(201);
    const replay = await uploadMultipart(t, admin, "/api/v1/documents", { entity_type: "PROJECT", entity_id: p!.id, title: "Plan" }, { name: "plan.png", data: png }, { "idempotency-key": key });
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.document.id).toBe(first.body.document.id);
    const other = await uploadMultipart(t, admin, "/api/v1/documents", { entity_type: "PROJECT", entity_id: p!.id, title: "Plan" }, { name: "plan.pdf", data: PDF_BYTES }, { "idempotency-key": key });
    expect(other.status).toBe(422);
    expect(other.body.error?.code).toBe("IDEMPOTENCY_MISMATCH");
    const docs = await t.app.sql<{ n: string }[]>`select count(*)::text as n from documents where entity_id = ${p!.id}`;
    expect(Number(docs[0]!.n)).toBe(1);

    const row = await t.request<{ version: number }>("GET", `/api/v1/documents/${first.body.document.id}`, { token: admin });
    expect(row.body.version).toBe(1);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/documents/${first.body.document.id}`, { token: admin, body: { title: "x" }, headers: { "if-match": '"7"' } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const ok = await t.request<{ version: number; title: string }>("PATCH", `/api/v1/documents/${first.body.document.id}`, { token: admin, body: { title: "Site plan" }, headers: { "if-match": '"1"' } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ version: 2, title: "Site plan" });
    const viaBody = await t.request<{ version: number }>("PATCH", `/api/v1/documents/${first.body.document.id}`, { token: admin, body: { version: 2, title: "Site plan v2" } });
    expect(viaBody.status, viaBody.text).toBe(200);
    expect(viaBody.body.version).toBe(3);
  });
});

describe("4 + 11 · schema", () => {
  it("the review indexes exist and service_requests.category_id is NOT NULL", async () => {
    const idx = await t.app.sql<{ indexname: string }[]>`select indexname from pg_indexes where schemaname = 'public'`;
    const names = new Set(idx.map((i) => i.indexname));
    for (const n of ["site_visits_lead_status_idx", "flat_types_rooms_gin_idx", "flat_types_areas_gin_idx", "floor_plan_templates_positions_gin_idx", "blocks_floor_plans_gin_idx", "payment_plan_assignments_plan_idx", "bookings_payment_plan_idx", "audit_logs_company_created_idx"]) {
      expect(names.has(n), n).toBe(true);
    }
    const [col] = await t.app.sql<{ is_nullable: string }[]>`select is_nullable from information_schema.columns where table_name = 'service_requests' and column_name = 'category_id'`;
    expect(col?.is_nullable).toBe("NO");
    const [v] = await t.app.sql<{ data_type: string }[]>`select data_type from information_schema.columns where table_name = 'documents' and column_name = 'version'`;
    expect(v?.data_type).toBe("integer");
  });
});
