import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject } from "./fixtures.js";
import { buildTestApp, CREDS, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  const { ensureProjectAccess } = await import("../../src/lib/scope.js");
  t = await buildTestApp({
    extraRoutes: (api) => {
      route(api, {
        method: "GET",
        url: "/_test/projects/:id",
        permission: "project.read",
        schema: {
          params: z.object({ id: z.uuid() }),
          response: { 200: z.object({ id: z.string(), name: z.string() }) },
        },
        handler: async (req) => {
          const rows = await api.sql<
            { id: string; name: string }[]
          >`select id, name from projects where id = ${req.params.id}`;
          const p = rows[0];
          if (!p) throw new Error("fixture missing");
          ensureProjectAccess(req.user!, p.id);
          return p;
        },
      });
    },
  });
});
afterAll(async () => {
  await t?.close();
});

describe("permissions", () => {
  it("Sales cannot write masters (403) but can read them", async () => {
    const sales = await t.loginAs("sales");
    const denied = await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", {
      token: sales.access_token,
      body: { name: "Study", code: "STUDY" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    expect(denied.body.error.details?.["permission"]).toBe("master.write");
    const list = await t.request("GET", "/api/v1/masters/room-types", { token: sales.access_token });
    expect(list.status).toBe(200);
    const employee = await t.loginAs("employee");
    expect((await t.request("GET", "/api/v1/users", { token: employee.access_token })).status).toBe(403);
  });

  it("every staff route under /api/v1 declares a permission; portal and public routes are tagged", async () => {
    const staff = t.app.routeRegistry.filter((r) => r.url.startsWith("/api/v1") && !r.public && r.audience === "erp");
    const missing = staff.filter((r) => !r.permission).map((r) => `${r.method} ${r.url}`);
    expect(missing).toEqual([]);
    expect(staff.length).toBeGreaterThan(80);
    const portal = t.app.routeRegistry.filter((r) => r.url.startsWith("/api/v1/portal"));
    expect(portal.every((r) => r.public || r.audience === "portal")).toBe(true);
    const publicRoutes = t.app.routeRegistry.filter((r) => r.public).map((r) => r.url);
    expect(publicRoutes).toContain("/api/v1/auth/login");
    expect(publicRoutes).toContain("/health");
    const admin = await t.loginAs("admin");
    const viaApi = await t.request<{
      items: { url: string; permission: string | null; public: boolean; audience: string | null }[];
    }>("GET", "/api/v1/system/routes", { token: admin.access_token });
    expect(viaApi.status).toBe(200);
    expect(
      viaApi.body.items.filter(
        (i) => i.url.startsWith("/api/v1") && !i.public && i.audience === "erp" && !i.permission,
      ),
    ).toEqual([]);
  });

  it("permission changes take effect through the Redis version bump", async () => {
    const admin = await t.loginAs("admin");
    const roles = await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles", {
      token: admin.access_token,
    });
    const created = await t.request<{ id: string; version: number }>("POST", "/api/v1/roles", {
      token: admin.access_token,
      body: { name: "Auditor", permissions: ["dashboard.view", "audit.view"] },
    });
    expect(created.status).toBe(201);
    const [emp] = await t.app.sql<
      { id: string; version: number }[]
    >`select id, version from users where email = ${CREDS.employee.email}`;
    const moved = await t.request("PATCH", `/api/v1/users/${emp!.id}`, {
      token: admin.access_token,
      body: { role_id: created.body.id, version: emp!.version },
    });
    expect(moved.status).toBe(200);
    const employee = await t.loginAs("employee");
    expect((await t.request("GET", "/api/v1/audit-logs", { token: employee.access_token })).status).toBe(200);
    const salesRole = roles.body.items.find((r) => r.name === "Sales")!;
    const back = await t.request("PATCH", `/api/v1/users/${emp!.id}`, {
      token: admin.access_token,
      body: { role_id: salesRole.id, version: emp!.version + 1 },
    });
    expect(back.status).toBe(200);
    // same access token, new permissions (cache invalidated by perm:version)
    expect((await t.request("GET", "/api/v1/audit-logs", { token: employee.access_token })).status).toBe(403);
    expect((await t.request("GET", "/api/v1/masters/room-types", { token: employee.access_token })).status).toBe(200);
  });
});

describe("project scope", () => {
  it("scoped users get 404 (not 403) outside their projects and never see them in search", async () => {
    const projectA = await createProject(t, "Shree Ganesh Heights", "SGH");
    const projectB = await createProject(t, "Ganesh Green Villas", "GGV");
    const admin = await t.loginAs("admin");
    const [pm] = await t.app.sql<
      { id: string; version: number }[]
    >`select id, version from users where email = ${CREDS.projects.email}`;
    const scoped = await t.request<{ all_projects: boolean; project_ids: string[] }>(
      "PUT",
      `/api/v1/users/${pm!.id}/scope`,
      { token: admin.access_token, body: { version: pm!.version, all_projects: false, project_ids: [projectA] } },
    );
    expect(scoped.status).toBe(200);
    expect(scoped.body.project_ids).toEqual([projectA]);
    const projects = await t.loginAs("projects");
    expect(projects.user.permissions).toContain("project.read");
    const inScope = await t.request<{ id: string }>("GET", `/api/v1/_test/projects/${projectA}`, {
      token: projects.access_token,
    });
    expect(inScope.status).toBe(200);
    const outOfScope = await t.request<ErrorBody>("GET", `/api/v1/_test/projects/${projectB}`, {
      token: projects.access_token,
    });
    expect(outOfScope.status).toBe(404);
    expect(outOfScope.body.error.code).toBe("NOT_FOUND");
    expect((await t.request("GET", `/api/v1/_test/projects/${projectB}`, { token: admin.access_token })).status).toBe(
      200,
    );
    const search = await t.request<{ results: { type: string; id: string }[] }>("GET", "/api/v1/search?q=Ganesh", {
      token: projects.access_token,
    });
    expect(search.status).toBe(200);
    expect(search.body.results.map((r) => r.id)).toEqual([projectA]);
    const adminSearch = await t.request<{ results: { id: string }[] }>("GET", "/api/v1/search?q=Ganesh", {
      token: admin.access_token,
    });
    expect(adminSearch.body.results.map((r) => r.id).sort()).toEqual([projectA, projectB].sort());
    const me = await t.request<{ user: { all_projects: boolean; project_ids: string[] } }>("GET", "/api/v1/auth/me", {
      token: projects.access_token,
    });
    expect(me.body.user.all_projects).toBe(false);
    expect(me.body.user.project_ids).toEqual([projectA]);
  });

  it("scoped user with zero projects sees nothing", async () => {
    const admin = await t.loginAs("admin");
    const [emp] = await t.app.sql<
      { id: string; version: number }[]
    >`select id, version from users where email = ${CREDS.employee.email}`;
    const bad = await t.request<ErrorBody>("PUT", `/api/v1/users/${emp!.id}/scope`, {
      token: admin.access_token,
      body: { version: emp!.version, all_projects: false, project_ids: [] },
    });
    expect(bad.status).toBe(400);
  });
});

describe("users admin", () => {
  it("creates, resets, deactivates and unlocks users; duplicates are 409", async () => {
    const admin = await t.loginAs("admin");
    const roles = await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles", {
      token: admin.access_token,
    });
    const salesRole = roles.body.items.find((r) => r.name === "Sales")!;
    const created = await t.request<{
      id: string;
      version: number;
      temp_password?: string;
      must_change_password: boolean;
    }>("POST", "/api/v1/users", {
      token: admin.access_token,
      body: { name: "New Sales", email: "new.sales@sgb.in", role_id: salesRole.id },
    });
    expect(created.status).toBe(201);
    expect(created.body.temp_password).toBeTruthy();
    expect(created.body.must_change_password).toBe(true);
    const dup = await t.request<ErrorBody>("POST", "/api/v1/users", {
      token: admin.access_token,
      body: { name: "Dup", email: "NEW.SALES@sgb.in", role_id: salesRole.id },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
    const first = await t.login("new.sales@sgb.in", created.body.temp_password!);
    expect(first.must_change_password).toBe(true);
    const reset = await t.request<{ temp_password?: string; version: number }>(
      "POST",
      `/api/v1/users/${created.body.id}/reset-password`,
      { token: admin.access_token, body: { version: created.body.version, must_change_password: false } },
    );
    expect(reset.status).toBe(200);
    expect((await t.request("GET", "/api/v1/auth/me", { token: first.access_token })).status).toBe(401);
    const second = await t.login("new.sales@sgb.in", reset.body.temp_password!);
    expect(second.must_change_password).toBe(false);
    const deact = await t.request<{ is_active: boolean; version: number }>(
      "POST",
      `/api/v1/users/${created.body.id}/deactivate`,
      { token: admin.access_token, body: { version: reset.body.version } },
    );
    expect(deact.status).toBe(200);
    expect(deact.body.is_active).toBe(false);
    const inactive = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: second.access_token });
    expect(inactive.status).toBe(401);
    const loginInactive = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { email: "new.sales@sgb.in", password: reset.body.temp_password },
    });
    expect(loginInactive.status).toBe(401);
    expect(loginInactive.body.error.code).toBe("USER_INACTIVE");
    const stale = await t.request<ErrorBody>("POST", `/api/v1/users/${created.body.id}/activate`, {
      token: admin.access_token,
      body: { version: 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(deact.body.version);
    expect(stale.body.error.details?.["changed_by"]).toBe("Suresh Agarwal");
    const self = await t.request<ErrorBody>("POST", `/api/v1/users/${admin.user.id}/deactivate`, {
      token: admin.access_token,
      body: {},
    });
    expect(self.status).toBe(403); // nobody changes their own active state
    expect(self.body.error.details?.["reason"]).toBe("SELF_CHANGE");
    await t.app
      .sql`update users set locked_until = now() + interval '10 minutes', failed_attempts = 5 where id = ${created.body.id}`;
    const listLocked = await t.request<{ items: { id: string }[] }>(
      "GET",
      "/api/v1/users?is_locked=true&include_inactive=true",
      { token: admin.access_token },
    );
    expect(listLocked.body.items.map((u) => u.id)).toContain(created.body.id);
    const unlocked = await t.request<{ locked_until: string | null }>(
      "POST",
      `/api/v1/users/${created.body.id}/unlock`,
      { token: admin.access_token, body: { version: deact.body.version } },
    );
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.locked_until).toBeNull();
    const csv = await t.request("GET", "/api/v1/users?format=csv", { token: admin.access_token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(String(csv.headers["content-disposition"])).toContain("attachment");
    expect(csv.text.split("\n")[0]).toContain("name,email");
  });

  it("system roles are immutable and roles in use cannot be deactivated", async () => {
    const admin = await t.loginAs("admin");
    const roles = await t.request<{
      items: { id: string; name: string; version: number; is_system: boolean; user_count: number }[];
    }>("GET", "/api/v1/roles", { token: admin.access_token });
    const sales = roles.body.items.find((r) => r.name === "Sales")!;
    expect(sales.is_system).toBe(true);
    const rename = await t.request<ErrorBody>("PATCH", `/api/v1/roles/${sales.id}`, {
      token: admin.access_token,
      body: { name: "Salez", version: sales.version },
    });
    expect(rename.status).toBe(409);
    expect(rename.body.error.code).toBe("SYSTEM_ROLE");
    const describe = await t.request<{ description: string }>("PATCH", `/api/v1/roles/${sales.id}`, {
      token: admin.access_token,
      body: { description: "Front-line sales team", version: sales.version },
    });
    expect(describe.status).toBe(200);
    const deact = await t.request<ErrorBody>("POST", `/api/v1/roles/${sales.id}/deactivate`, {
      token: admin.access_token,
      body: {},
    });
    expect(deact.status).toBe(409);
    expect(deact.body.error.code).toBe("SYSTEM_ROLE");
    const custom = await t.request<{ id: string; version: number }>("POST", "/api/v1/roles", {
      token: admin.access_token,
      body: { name: "Viewer", permissions: ["dashboard.view"] },
    });
    const [emp] = await t.app.sql<
      { id: string; version: number }[]
    >`select id, version from users where email = ${CREDS.marketing.email}`;
    await t.request("PATCH", `/api/v1/users/${emp!.id}`, {
      token: admin.access_token,
      body: { role_id: custom.body.id, version: emp!.version },
    });
    const inUse = await t.request<ErrorBody>("POST", `/api/v1/roles/${custom.body.id}/deactivate`, {
      token: admin.access_token,
      body: { version: custom.body.version },
    });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe("IN_USE");
    expect(inUse.body.error.details?.["usage_count"]).toBe(1);
    const unknownPerm = await t.request<ErrorBody>("POST", "/api/v1/roles", {
      token: admin.access_token,
      body: { name: "Bad", permissions: ["not.a.permission"] },
    });
    expect(unknownPerm.status).toBe(400);
    const catalog = await t.request<{ groups: { key: string; permissions: { code: string }[] }[] }>(
      "GET",
      "/api/v1/roles/permissions",
      { token: admin.access_token },
    );
    expect(catalog.status).toBe(200);
    expect(catalog.body.groups.flatMap((g) => g.permissions).length).toBeGreaterThan(40);
  });
});
