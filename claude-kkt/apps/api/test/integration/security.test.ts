import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject } from "./fixtures.js";
import { buildTestApp, CREDS, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Adversarial security suite: every assertion here is a way an attacker (or a careless client) could get past the model
 * described in docs/SECURITY.md and docs/API-CONVENTIONS.md.
 */
let t: TestContext;
const NIL = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  t = await buildTestApp({
    extraRoutes: (api) => {
      route(api, {
        method: "GET", url: "/_test/boom", permission: "dashboard.view",
        schema: { response: { 200: z.object({ ok: z.boolean() }) } },
        handler: async () => { throw new Error("kaboom: secret internals"); },
      });
    },
  });
});
afterAll(async () => { await t?.close(); });

/** Fills `:id`-style params so a registry url can be requested. */
function concrete(url: string): string {
  return url.replace(/:type\b/g, "amenity").replace(/:[A-Za-z_]+/g, NIL);
}

function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function newStaff(email: string, password: string, roleName: string, mustChange = false): Promise<{ id: string; version: number }> {
  const admin = await t.loginAs("admin");
  const [role] = await t.app.sql<{ id: string }[]>`select id from roles where name = ${roleName}`;
  const r = await t.request<{ id: string; version: number }>("POST", "/api/v1/users", { token: admin.access_token, body: { name: email.split("@")[0], email, role_id: role!.id, password, must_change_password: mustChange } });
  if (r.status !== 201) throw new Error(`user create failed: ${r.text}`);
  return r.body;
}

describe("tokens", () => {
  it("refresh reuse kills the entire family, including later rotations, and access tokens are bounded to 15 minutes", async () => {
    const login = await t.loginAs("accounts");
    const r1 = await t.request<{ access_token: string; refresh_token: string }>("POST", "/api/v1/auth/refresh", { body: { refresh_token: login.refresh_token } });
    const r2 = await t.request<{ access_token: string; refresh_token: string }>("POST", "/api/v1/auth/refresh", { body: { refresh_token: r1.body.refresh_token } });
    expect(r2.status).toBe(200);
    // every access token of the family carries the same sid and a 15-minute life
    for (const tok of [login.access_token, r1.body.access_token, r2.body.access_token]) {
      const p = jwtPayload(tok);
      expect(p["sid"]).toBe(jwtPayload(login.access_token)["sid"]);
      expect(Number(p["exp"]) - Number(p["iat"])).toBe(900);
      expect(p["aud"]).toBe("erp");
    }
    // the newest token still works before the attack
    expect((await t.request("GET", "/api/v1/auth/me", { token: r2.body.access_token })).status).toBe(200);
    // an attacker replays the middle token
    const reuse = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", { body: { refresh_token: r1.body.refresh_token } });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("TOKEN_REUSED");
    // the victim's newest refresh token and every access token of the family are dead
    expect((await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", { body: { refresh_token: r2.body.refresh_token } })).body.error.code).toBe("TOKEN_REUSED");
    for (const tok of [login.access_token, r1.body.access_token, r2.body.access_token]) {
      const dead = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: tok });
      expect(dead.status).toBe(401);
      expect(dead.body.error.code).toBe("SESSION_REVOKED");
    }
    const rows = await t.app.sql<{ revoke_reason: string | null; revoked_at: string | null }[]>`select revoke_reason, revoked_at from refresh_tokens where family_id = ${String(jwtPayload(login.access_token)["sid"])}`;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.revoked_at !== null && r.revoke_reason === "REUSE_DETECTED")).toBe(true);
  });

  it("a refresh token of one audience cannot be rotated on the other audience's endpoint", async () => {
    const staff = await t.loginAs("marketing");
    const r = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/refresh", { body: { refresh_token: staff.refresh_token } });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("INVALID_TOKEN");
    // and the staff token is untouched by the failed cross-audience attempt
    expect((await t.request("POST", "/api/v1/auth/refresh", { body: { refresh_token: staff.refresh_token } })).status).toBe(200);
  });
});

describe("lockout", () => {
  it("resets the failure counter on a successful login", async () => {
    const wrong = { email: CREDS.marketing.email, password: "Wrong-Pass-1A" };
    for (let i = 0; i < 3; i++) expect((await t.request("POST", "/api/v1/auth/login", { body: wrong })).status).toBe(401);
    const third = await t.request<ErrorBody>("POST", "/api/v1/auth/login", { body: wrong });
    expect(third.status).toBe(401);
    expect(third.body.error.details?.["attempts_left"]).toBe(1);
    expect((await t.request("POST", "/api/v1/auth/login", { body: CREDS.marketing })).status).toBe(200);
    const [row] = await t.app.sql<{ failed_attempts: number }[]>`select failed_attempts from users where email = ${CREDS.marketing.email}`;
    expect(row!.failed_attempts).toBe(0);
    // four more failures do not lock (counter restarted), the fifth does
    for (let i = 0; i < 4; i++) expect((await t.request("POST", "/api/v1/auth/login", { body: wrong })).status).toBe(401);
    expect((await t.request("POST", "/api/v1/auth/login", { body: wrong })).status).toBe(423);
    await t.app.sql`update users set failed_attempts = 0, locked_until = null where email = ${CREDS.marketing.email}`;
  });

  it("unknown e-mail and wrong password are indistinguishable on the wire", async () => {
    const unknown = await t.request<ErrorBody>("POST", "/api/v1/auth/login", { body: { email: "nobody-here@sgb.in", password: "Wrong-Pass-1A" } });
    const wrong = await t.request<ErrorBody>("POST", "/api/v1/auth/login", { body: { email: CREDS.sales.email, password: "Wrong-Pass-1A" } });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });
});

describe("deactivation", () => {
  it("rejects a deactivated user's still-valid access token on the very next request, with or without the Redis fast path", async () => {
    const created = await newStaff("victim@sgb.in", "Victim-Pass-123", "Sales");
    const victim = await t.login("victim@sgb.in", "Victim-Pass-123");
    expect((await t.request("GET", "/api/v1/auth/me", { token: victim.access_token })).status).toBe(200);
    const admin = await t.loginAs("admin");
    const deact = await t.request("POST", `/api/v1/users/${created.id}/deactivate`, { token: admin.access_token, body: { version: created.version } });
    expect(deact.status).toBe(200);
    const next = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: victim.access_token });
    expect(next.status).toBe(401);
    expect(["SESSION_REVOKED", "USER_INACTIVE"]).toContain(next.body.error.code);
    // Redis lost (no revocation marker, no cached permissions): the database row still says inactive
    await t.app.redis.flushdb();
    const again = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: victim.access_token });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("USER_INACTIVE");
    expect((await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", { body: { refresh_token: victim.refresh_token } })).status).toBe(401);
  });
});

describe("permissions and audiences", () => {
  it("a Sales token cannot call any write route under /masters", async () => {
    const sales = await t.loginAs("sales");
    const writes = t.app.routeRegistry.filter((r) => r.url.startsWith("/api/v1/masters") && r.method !== "GET");
    expect(writes.length).toBeGreaterThan(60);
    for (const r of writes) {
      const res = await t.request<ErrorBody>(r.method as "POST" | "PATCH" | "DELETE", concrete(r.url), { token: sales.access_token, body: {} });
      expect(res.status, `${r.method} ${r.url}`).toBe(403);
      expect(res.body.error.code, `${r.method} ${r.url}`).toBe("FORBIDDEN");
      expect(res.body.error.details?.["permission"]).toBe("master.write");
    }
  });

  it("a staff token is 401 INVALID_AUDIENCE on every portal route and a portal token on every staff route", async () => {
    const { createPortalCustomer } = await import("./fixtures.js");
    await createPortalCustomer(t, { phone: "9876543299", name: "Cross Audience" });
    const customer = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", { body: { phone: "9876543299", password: "Welcome@123" } });
    expect(customer.status).toBe(200);
    const staff = await t.loginAs("admin");
    const portalRoutes = t.app.routeRegistry.filter((r) => r.audience === "portal" && !r.public);
    const staffRoutes = t.app.routeRegistry.filter((r) => r.audience === "erp" && !r.public);
    expect(portalRoutes.length).toBeGreaterThan(5);
    for (const r of portalRoutes) {
      const res = await t.request<ErrorBody>(r.method as "GET" | "POST" | "DELETE", concrete(r.url), { token: staff.access_token, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.url}`).toBe(401);
      expect(res.body.error.code, `${r.method} ${r.url}`).toBe("INVALID_AUDIENCE");
    }
    for (const r of staffRoutes) {
      const res = await t.request<ErrorBody>(r.method as "GET" | "POST" | "DELETE", concrete(r.url), { token: customer.body.access_token, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.url}`).toBe(401);
      expect(res.body.error.code, `${r.method} ${r.url}`).toBe("INVALID_AUDIENCE");
    }
  });

  it("a forged token signed with another key and a token of the wrong type are rejected", async () => {
    const { SignJWT, generateKeyPair } = await import("jose");
    const { privateKey } = await generateKeyPair("EdDSA");
    const forged = await new SignJWT({ typ: "access", cid: t.companyId, sid: NIL }).setProtectedHeader({ alg: "EdDSA", kid: "k1" }).setIssuer("kkt").setAudience("erp").setSubject(NIL).setIssuedAt().setExpirationTime("15m").sign(privateKey);
    const r = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: forged });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("INVALID_TOKEN");
    const { signAccessToken } = await import("../../src/lib/jwt.js");
    const real = await signAccessToken({ sub: NIL, aud: "erp", cid: t.companyId, sid: NIL });
    const ghost = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: real });
    expect(ghost.status).toBe(401); // valid signature, subject no longer exists
  });

  it("a scoped Project Admin gets 404 (never 403) for a foreign project id in filters and scope assignments", async () => {
    const projectA = await createProject(t, "Scope A", "SCA");
    const projectB = await createProject(t, "Scope B", "SCB");
    const admin = await t.loginAs("admin");
    const [pm] = await t.app.sql<{ id: string; version: number }[]>`select id, version from users where email = ${CREDS.projects.email}`;
    expect((await t.request("PUT", `/api/v1/users/${pm!.id}/scope`, { token: admin.access_token, body: { version: pm!.version, all_projects: false, project_ids: [projectA] } })).status).toBe(200);
    const pa = await t.loginAs("projects");
    const own = await t.request("GET", `/api/v1/masters/payment-plans?project_id=${projectA}`, { token: pa.access_token });
    expect(own.status).toBe(200);
    const foreign = await t.request<ErrorBody>("GET", `/api/v1/masters/payment-plans?project_id=${projectB}`, { token: pa.access_token });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("NOT_FOUND");
    expect((await t.request("GET", `/api/v1/masters/payment-plans?project_id=${projectB}`, { token: admin.access_token })).status).toBe(200);
    // a scoped user who may manage users still cannot hand out projects outside their own scope
    const role = await t.request<{ id: string }>("POST", "/api/v1/roles", { token: admin.access_token, body: { name: "Scoped user admin", permissions: ["dashboard.view", "users.manage", "project.read"] } });
    expect(role.status).toBe(201);
    const scopedAdmin = await newStaff("scoped.admin@sgb.in", "Scoped-Admin-1", "Scoped user admin");
    expect((await t.request("PUT", `/api/v1/users/${scopedAdmin.id}/scope`, { token: admin.access_token, body: { version: scopedAdmin.version, all_projects: false, project_ids: [projectA] } })).status).toBe(200);
    const sa = await t.login("scoped.admin@sgb.in", "Scoped-Admin-1");
    const target = await newStaff("scope.target@sgb.in", "Scope-Target-1", "Employee");
    const leak = await t.request<ErrorBody>("PUT", `/api/v1/users/${target.id}/scope`, { token: sa.access_token, body: { version: target.version, all_projects: false, project_ids: [projectB] } });
    expect(leak.status).toBe(404);
    expect((await t.request<ErrorBody>("GET", `/api/v1/users?project_id=${projectB}`, { token: sa.access_token })).status).toBe(404);
    expect((await t.request("GET", `/api/v1/users?project_id=${projectA}`, { token: sa.access_token })).status).toBe(200);
  });

  it("must_change_password blocks every staff route except change-password, logout and me", async () => {
    await newStaff("forced@sgb.in", "Forced-Pass-123", "Super Admin", true);
    const forced = await t.login("forced@sgb.in", "Forced-Pass-123");
    expect(forced.must_change_password).toBe(true);
    const exempt = new Set(["/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/auth/change-password"]);
    const staffRoutes = t.app.routeRegistry.filter((r) => r.audience === "erp" && !r.public && !r.url.startsWith("/api/v1/_test"));
    expect(staffRoutes.length).toBeGreaterThan(80);
    for (const r of staffRoutes.filter((x) => !exempt.has(x.url))) {
      const res = await t.request<ErrorBody>(r.method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE", concrete(r.url), { token: forced.access_token, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.url}`).toBe(403);
      expect(res.body.error.code, `${r.method} ${r.url}`).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    expect((await t.request("GET", "/api/v1/auth/me", { token: forced.access_token })).status).toBe(200);
    const badChange = await t.request<ErrorBody>("POST", "/api/v1/auth/change-password", { token: forced.access_token, body: {} });
    expect(badChange.status).toBe(400); // reached the handler's validation, not the password gate
    expect((await t.request("POST", "/api/v1/auth/logout", { token: forced.access_token, body: {} })).status).toBe(204);
  });

  it("must_change_password blocks every portal route except change-password, logout and me", async () => {
    const { createPortalCustomer } = await import("./fixtures.js");
    await createPortalCustomer(t, { phone: "9876543298", name: "Forced Customer", mustChangePassword: true });
    const login = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", { body: { phone: "9876543298", password: "Welcome@123" } });
    expect(login.status).toBe(200);
    const exempt = new Set(["/api/v1/portal/auth/me", "/api/v1/portal/auth/logout", "/api/v1/portal/auth/change-password"]);
    const portalRoutes = t.app.routeRegistry.filter((r) => r.audience === "portal" && !r.public);
    for (const r of portalRoutes.filter((x) => !exempt.has(x.url))) {
      const res = await t.request<ErrorBody>(r.method as "GET" | "POST" | "DELETE", concrete(r.url), { token: login.body.access_token, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.url}`).toBe(403);
      expect(res.body.error.code, `${r.method} ${r.url}`).toBe("PASSWORD_CHANGE_REQUIRED");
    }
    expect((await t.request("GET", "/api/v1/portal/auth/me", { token: login.body.access_token })).status).toBe(200);
  });

  it("a role cannot drop dashboard.view (it gates sign-in self-service) or carry zero permissions", async () => {
    const admin = await t.loginAs("admin");
    const noDash = await t.request<ErrorBody>("POST", "/api/v1/roles", { token: admin.access_token, body: { name: "Audit only", permissions: ["audit.view"] } });
    expect(noDash.status).toBe(400);
    expect(noDash.body.error.details?.["required"]).toBe("dashboard.view");
    const empty = await t.request<ErrorBody>("POST", "/api/v1/roles", { token: admin.access_token, body: { name: "Nothing", permissions: [] } });
    expect(empty.status).toBe(400);
  });
});

describe("secrets", () => {
  it("passwords, hashes, account numbers and MFA secrets never appear in any response or audit row", async () => {
    const admin = await t.loginAs("admin");
    const user = await t.request<{ id: string }>("POST", "/api/v1/users", { token: admin.access_token, body: { name: "Leak Probe", email: "leak.probe@sgb.in", role_id: (await t.app.sql<{ id: string }[]>`select id from roles where name = 'Sales'`)[0]!.id, password: "Leak-Probe-Pass-77" } });
    expect(user.status).toBe(201);
    const bank = await t.request<{ id: string }>("POST", "/api/v1/masters/bank-accounts", { token: admin.access_token, body: { bank_name: "Axis Bank", account_name: "SGB Collections", account_number: "911010012345678", ifsc: "UTIB0000123" } });
    expect(bank.status).toBe(201);
    const enroll = await t.request<{ secret: string }>("POST", "/api/v1/auth/mfa/enroll", { token: admin.access_token });
    expect(enroll.status).toBe(200);
    const probe = await t.login("leak.probe@sgb.in", "Leak-Probe-Pass-77");
    await t.request("POST", "/api/v1/auth/change-password", { token: probe.access_token, body: { current_password: "Leak-Probe-Pass-77", new_password: "Leak-Probe-Pass-88" } });
    const forbidden = ["Leak-Probe-Pass-77", "Leak-Probe-Pass-88", "Admin@12345", "$argon2", "911010012345678", enroll.body.secret, "password_hash", "mfa_secret", "token_hash", probe.refresh_token, admin.refresh_token];
    const audit = await t.app.sql<{ before: unknown; after: unknown; action: string }[]>`select before, after, action from audit_logs`;
    expect(audit.length).toBeGreaterThan(5);
    const auditJson = JSON.stringify(audit);
    for (const f of forbidden) expect(auditJson, `audit rows contain ${f.slice(0, 12)}…`).not.toContain(f);
    const urls = ["/api/v1/users?include_inactive=true&page_size=200", `/api/v1/users/${user.body.id}`, "/api/v1/auth/me", "/api/v1/masters/bank-accounts", "/api/v1/masters/bank-accounts?format=csv", "/api/v1/audit-logs?page_size=200", "/api/v1/audit-logs/login-events", "/api/v1/roles", "/api/v1/users?format=csv"];
    for (const url of urls) {
      const res = await t.request("GET", url, { token: admin.access_token });
      expect(res.status, url).toBe(200);
      for (const f of forbidden) expect(res.text, `${url} contains ${f.slice(0, 12)}…`).not.toContain(f);
    }
    const [enc] = await t.app.sql<{ account_number_enc: string }[]>`select account_number_enc from bank_accounts where id = ${bank.body.id}`;
    expect(enc!.account_number_enc).toMatch(/^k1\./);
    expect(enc!.account_number_enc).not.toContain("911010012345678");
    const csv = await t.request("GET", "/api/v1/masters/bank-accounts?format=csv", { token: admin.access_token });
    expect(csv.text).toContain("XXXXXXXXXXX5678");
    // the server never echoes the stack or internal message of an unexpected error
    const boom = await t.request<ErrorBody>("GET", "/api/v1/_test/boom", { token: admin.access_token });
    expect(boom.status).toBe(500);
    expect(boom.text).not.toContain("kaboom");
    expect(boom.text).not.toContain("secret internals");
  });

  it("an admin password reset still counts the replaced password against the history rule", async () => {
    const created = await newStaff("history@sgb.in", "History-Pass-11", "Employee");
    const admin = await t.loginAs("admin");
    const reset = await t.request<{ temp_password: string; version: number }>("POST", `/api/v1/users/${created.id}/reset-password`, { token: admin.access_token, body: { version: created.version, must_change_password: false } });
    expect(reset.status).toBe(200);
    const login = await t.login("history@sgb.in", reset.body.temp_password);
    const back = await t.request<ErrorBody>("POST", "/api/v1/auth/change-password", { token: login.access_token, body: { current_password: reset.body.temp_password, new_password: "History-Pass-11" } });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe("PASSWORD_POLICY");
  });
});

describe("concurrency", () => {
  it("five concurrent identical POSTs with one Idempotency-Key create exactly one row and all receive the same response", async () => {
    const admin = await t.loginAs("admin");
    const body = { name: "Concurrent Room", code: "CONCURRENT", sort_order: 42 };
    const results = await Promise.all(Array.from({ length: 5 }, () => t.request<{ id: string }>("POST", "/api/v1/masters/room-types", { token: admin.access_token, body, headers: { "idempotency-key": "concurrent-0001" } })));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => r.headers["idempotent-replayed"] === "true")).toHaveLength(4);
    const [n] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where code = 'CONCURRENT'`;
    expect(n!.n).toBe(1);
    const [stored] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from idempotency_keys where key = 'concurrent-0001'`;
    expect(stored!.n).toBe(1);
  });

  it("five concurrent identical POSTs without a key create exactly one row; the rest are 409 DUPLICATE", async () => {
    const admin = await t.loginAs("admin");
    const body = { name: "Racing Room", code: "RACING", sort_order: 43 };
    const results = await Promise.all(Array.from({ length: 5 }, () => t.request<ErrorBody>("POST", "/api/v1/masters/room-types", { token: admin.access_token, body })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === "DUPLICATE")).toBe(true);
    const [n] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where code = 'RACING'`;
    expect(n!.n).toBe(1);
  });

  it("a failed first attempt does not burn the Idempotency-Key, a 4xx is never replayed", async () => {
    const admin = await t.loginAs("admin");
    const bad = await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", { token: admin.access_token, body: { name: "Dup", code: "CONCURRENT" }, headers: { "idempotency-key": "retry-after-409" } });
    expect(bad.status).toBe(409);
    const good = await t.request<{ id: string }>("POST", "/api/v1/masters/room-types", { token: admin.access_token, body: { name: "Fresh", code: "FRESH" }, headers: { "idempotency-key": "retry-after-409" } });
    expect(good.status).toBe(201);
    expect(good.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("a version conflict names who changed the record", async () => {
    const admin = await t.loginAs("admin");
    const other = await newStaff("second.editor@sgb.in", "Second-Editor-1", "Super Admin");
    expect(other.id).toBeTruthy();
    const editor = await t.login("second.editor@sgb.in", "Second-Editor-1");
    const created = await t.request<{ id: string; version: number }>("POST", "/api/v1/masters/amenities", { token: admin.access_token, body: { name: "Conflict Garden" } });
    const byEditor = await t.request("PATCH", `/api/v1/masters/amenities/${created.body.id}`, { token: editor.access_token, body: { category: "Outdoor", version: created.body.version } });
    expect(byEditor.status).toBe(200);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/masters/amenities/${created.body.id}`, { token: admin.access_token, body: { category: "Indoor", version: created.body.version } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(created.body.version + 1);
    expect(stale.body.error.details?.["changed_by"]).toBe("second.editor");
    expect(stale.body.error.message).toContain("second.editor");
  });
});

describe("CSV import", () => {
  it("rejects a row with an invalid code and commits nothing unless partial commit is requested", async () => {
    const admin = await t.loginAs("admin");
    const csv = ["name,code,sort_order", "Pantry,PANTRY,30", "Loft,lo ft!,31", "Garage,GARAGE,32"].join("\n");
    const refused = await t.request<ErrorBody>("POST", "/api/v1/masters/import", { token: admin.access_token, body: { kind: "ROOM_TYPES", csv, commit: true } });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("BUSINESS_RULE");
    expect(refused.body.error.details?.["rule"]).toBe("IMPORT_HAS_ERRORS");
    expect(refused.body.error.details?.["error_lines"]).toEqual([3]);
    const [none] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where code in ('PANTRY', 'GARAGE')`;
    expect(none!.n).toBe(0);
    const partial = await t.request<{ committed: boolean; rows: { line: number; action: string; errors: string[] }[]; summary: Record<string, number> }>("POST", "/api/v1/masters/import", { token: admin.access_token, body: { kind: "ROOM_TYPES", csv, commit: true, partial: true } });
    expect(partial.status, partial.text).toBe(200);
    expect(partial.body.committed).toBe(true);
    expect(partial.body.rows.map((r) => r.action)).toEqual(["CREATE", "ERROR", "CREATE"]);
    expect(partial.body.rows[1]!.errors.join(" ")).toMatch(/code/i);
    expect(partial.body.summary).toEqual({ create: 2, update: 0, skip: 0, error: 1 });
    const [two] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where code in ('PANTRY', 'GARAGE')`;
    expect(two!.n).toBe(2);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where lower(name) = 'loft'`)[0]!.n).toBe(0);
  });
});

describe("error envelope", () => {
  it("has the identical shape for 400, 401, 403, 404, 409, 422, 429 and 500", async () => {
    const admin = await t.loginAs("admin");
    const sales = await t.loginAs("sales");
    const dupBody = { name: "Envelope", code: "ENVELOPE" };
    expect((await t.request("POST", "/api/v1/masters/room-types", { token: admin.access_token, body: dupBody })).status).toBe(201);
    const ip = "198.51.100.42";
    let limited: Awaited<ReturnType<typeof t.request<ErrorBody>>> | null = null;
    for (let i = 0; i < 12 && !limited; i++) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/auth/login", { body: { email: "nobody@sgb.in", password: "Wrong-Pass-1A" }, ip });
      if (r.status === 429) limited = r;
    }
    expect(limited).not.toBeNull();
    const samples: [number, string, Awaited<ReturnType<typeof t.request<ErrorBody>>>][] = [
      [400, "VALIDATION_ERROR", await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", { token: admin.access_token, body: { name: "" } })],
      [400, "VALIDATION_ERROR", await t.request<ErrorBody>("GET", "/api/v1/masters/room-types?unknown_key=1", { token: admin.access_token })],
      [401, "UNAUTHENTICATED", await t.request<ErrorBody>("GET", "/api/v1/masters/room-types")],
      [403, "FORBIDDEN", await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", { token: sales.access_token, body: dupBody })],
      [404, "NOT_FOUND", await t.request<ErrorBody>("GET", `/api/v1/masters/room-types/${NIL}`, { token: admin.access_token })],
      [404, "NOT_FOUND", await t.request<ErrorBody>("GET", "/api/v1/does-not-exist", { token: admin.access_token })],
      [409, "DUPLICATE", await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", { token: admin.access_token, body: dupBody })],
      [422, "BUSINESS_RULE", await t.request<ErrorBody>("POST", "/api/v1/masters/payment-plans", { token: admin.access_token, body: { name: "Half", code: "HALF", plan_type: "CUSTOM", installments: [{ seq: 1, name: "A", percent: 50, trigger_type: "ON_BOOKING" }] } })],
      [429, "RATE_LIMITED", limited!],
      [500, "INTERNAL_ERROR", await t.request<ErrorBody>("GET", "/api/v1/_test/boom", { token: admin.access_token })],
    ];
    for (const [status, code, res] of samples) {
      expect(res.status, `${code}`).toBe(status);
      expect(String(res.headers["content-type"])).toContain("application/json");
      expect(Object.keys(res.body)).toEqual(["error"]);
      const keys = Object.keys(res.body.error).sort();
      expect(keys.every((k) => ["code", "message", "details", "request_id"].includes(k)), `${code}: ${keys.join(",")}`).toBe(true);
      expect(keys).toContain("code");
      expect(keys).toContain("message");
      expect(keys).toContain("request_id");
      expect(res.body.error.code).toBe(code);
      expect(typeof res.body.error.message).toBe("string");
      expect(res.body.error.message.length).toBeGreaterThan(0);
      expect(res.body.error.request_id).toBe(res.headers["x-request-id"]);
      if (res.body.error.details !== undefined) expect(typeof res.body.error.details).toBe("object");
    }
    expect(limited!.headers["retry-after"]).toMatch(/^\d+$/);
    expect(Number(limited!.headers["retry-after"])).toBe(limited!.body.error.details?.["retry_after"]);
    const validation = samples[0]![2].body.error.details?.["issues"] as { path: string; message: string }[];
    expect(validation.some((i) => i.path === "name")).toBe(true);
    expect(validation.some((i) => i.path === "code")).toBe(true);
  });
});
