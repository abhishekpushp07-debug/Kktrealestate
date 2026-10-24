import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPortalCustomer } from "./fixtures.js";
import { buildTestApp, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await buildTestApp(); });
afterAll(async () => { await t?.close(); });

describe("audit log", () => {
  it("every mutation writes an immutable row with actor, before/after and request id; sensitive keys are stripped", async () => {
    const admin = await t.loginAs("admin");
    const created = await t.request<{ id: string; version: number }>("POST", "/api/v1/masters/amenities", { token: admin.access_token, body: { name: "Clubhouse", category: "Leisure" } });
    expect(created.status).toBe(201);
    const patched = await t.request("PATCH", `/api/v1/masters/amenities/${created.body.id}`, { token: admin.access_token, body: { category: "Lifestyle", version: created.body.version } });
    expect(patched.status).toBe(200);
    const list = await t.request<{ items: { action: string; actor_type: string; actor_name: string; entity_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; request_id: string; ip: string }[]; total: number }>("GET", `/api/v1/audit-logs?entity_type=amenity&entity_id=${created.body.id}`, { token: admin.access_token });
    expect(list.status).toBe(200);
    expect(list.body.items.map((i) => i.action)).toEqual(["amenity.update", "amenity.create"]);
    const update = list.body.items[0]!;
    expect(update.actor_type).toBe("STAFF");
    expect(update.actor_name).toBe("Suresh Agarwal");
    expect(update.before?.["category"]).toBe("Leisure");
    expect(update.after?.["category"]).toBe("Lifestyle");
    expect(update.request_id).toBeTruthy();
    expect(update.ip).toMatch(/^10\./);
    const entity = await t.request<{ items: unknown[] }>("GET", `/api/v1/audit-logs/entity/amenity/${created.body.id}`, { token: admin.access_token });
    expect(entity.body.items).toHaveLength(2);
    // a user create must never leak password material
    const [salesRole] = await t.app.sql<{ id: string }[]>`select id from roles where name = 'Sales'`;
    const user = await t.request<{ id: string }>("POST", "/api/v1/users", { token: admin.access_token, body: { name: "Audit Target", email: "audit.target@sgb.in", role_id: salesRole!.id, password: "Secret-Pass-123" } });
    const rows = await t.app.sql<{ after: Record<string, unknown> }[]>`select after from audit_logs where action = 'user.create' and entity_id = ${user.body.id}`;
    expect(JSON.stringify(rows[0]!.after)).not.toContain("Secret-Pass-123");
    expect(Object.keys(rows[0]!.after)).not.toContain("password_hash");
    const byActor = await t.request<{ total: number }>("GET", `/api/v1/audit-logs?actor_id=${admin.user.id}&action=user.create`, { token: admin.access_token });
    expect(byActor.body.total).toBe(1);
    const csv = await t.request("GET", "/api/v1/audit-logs?format=csv", { token: admin.access_token });
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    const today = new Date().toISOString().slice(0, 10);
    const ranged = await t.request<{ total: number }>("GET", `/api/v1/audit-logs?from=${today}&to=${today}`, { token: admin.access_token });
    expect(ranged.body.total).toBeGreaterThan(0);
    const future = await t.request<{ total: number }>("GET", `/api/v1/audit-logs?from=2099-01-01&to=2099-01-02`, { token: admin.access_token });
    expect(future.body.total).toBe(0);
  });

  it("portal actions are logged with actor_type CUSTOMER", async () => {
    const c = await createPortalCustomer(t, { phone: "9876543213", name: "Sunita Devi" });
    const login = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", { body: { phone: "9876543213", password: "Welcome@123" } });
    expect(login.status).toBe(200);
    await t.request("POST", "/api/v1/portal/auth/change-password", { token: login.body.access_token, body: { current_password: "Welcome@123", new_password: "Sunita-Pass-77" } });
    const rows = await t.app.sql<{ action: string; actor_type: string; actor_id: string; actor_name: string }[]>`select action, actor_type, actor_id, actor_name from audit_logs where entity_type = 'portal_user' and entity_id = ${c.portalUserId} order by created_at`;
    expect(rows.map((r) => r.action)).toEqual(["portal_auth.login", "portal_auth.password_changed"]);
    expect(rows.every((r) => r.actor_type === "CUSTOMER" && r.actor_id === c.customerId)).toBe(true);
    expect(rows[0]!.actor_name).toBe("Sunita Devi");
    const admin = await t.loginAs("admin");
    const viaApi = await t.request<{ items: { actor_type: string }[] }>("GET", "/api/v1/audit-logs?actor_type=CUSTOMER", { token: admin.access_token });
    expect(viaApi.body.items.length).toBeGreaterThanOrEqual(2);
    expect(viaApi.body.items.every((i) => i.actor_type === "CUSTOMER")).toBe(true);
  });

  it("audit rows cannot be updated or deleted", async () => {
    await expect(t.app.sql`update audit_logs set action = 'tampered'`).rejects.toThrow(/immutable/);
    await expect(t.app.sql`delete from audit_logs`).rejects.toThrow(/immutable/);
  });

  it("login events are listable with filters", async () => {
    const admin = await t.loginAs("admin");
    await t.request("POST", "/api/v1/auth/login", { body: { email: "admin@sgb.in", password: "wrong-pass-1A" } });
    const all = await t.request<{ items: { identifier: string; success: boolean }[]; total: number }>("GET", "/api/v1/audit-logs/login-events?identifier=admin@sgb.in", { token: admin.access_token });
    expect(all.status).toBe(200);
    expect(all.body.items.some((e) => e.success === false)).toBe(true);
    expect(all.body.items.some((e) => e.success === true)).toBe(true);
    const failed = await t.request<{ items: { success: boolean }[] }>("GET", "/api/v1/audit-logs/login-events?success=false", { token: admin.access_token });
    expect(failed.body.items.every((e) => e.success === false)).toBe(true);
    const sales = await t.loginAs("sales");
    expect((await t.request("GET", "/api/v1/audit-logs", { token: sales.access_token })).status).toBe(403);
    const accounts = await t.loginAs("accounts");
    expect((await t.request("GET", "/api/v1/audit-logs", { token: accounts.access_token })).status).toBe(200);
  });
});
