import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject } from "./fixtures.js";
import { createActiveBooking } from "./fixtures/crm.js";
import { buildTestApp, CREDS, type ErrorBody, type TestContext } from "./helpers.js";

/**
 * Security & privacy hardening (audit group D and the security items of A, B and G): privilege escalation through user/role management,
 * search PII gating, CSV formula injection, client IP handling, login enumeration and lockout DoS.
 */
let t: TestContext;
let admin: string;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
});
afterAll(async () => {
  await t?.close();
});

async function roleId(name: string): Promise<string> {
  const [r] = await t.app.sql<
    { id: string }[]
  >`select id from roles where name = ${name} and company_id = ${t.companyId}`;
  return r!.id;
}

async function newStaff(
  email: string,
  password: string,
  roleName: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const r = await t.request<{ id: string; version: number }>("POST", "/api/v1/users", {
    token: admin,
    body: {
      name: email.split("@")[0],
      email,
      role_id: await roleId(roleName),
      password,
      must_change_password: false,
      ...extra,
    },
  });
  if (r.status !== 201) throw new Error(`user create failed: ${r.text}`);
  return r.body;
}

async function userVersion(id: string): Promise<number> {
  const [u] = await t.app.sql<{ version: number }[]>`select version from users where id = ${id}`;
  return u!.version;
}

function reason(r: { body: ErrorBody }): unknown {
  return r.body.error.details?.["reason"];
}

describe("privilege escalation through user and role management", () => {
  let ua: string;
  let uaId: string;
  let customRoleId: string;

  beforeAll(async () => {
    // A user administrator who holds users.manage and roles.manage but nothing else of consequence.
    const role = await t.request<{ id: string }>("POST", "/api/v1/roles", {
      token: admin,
      body: {
        name: "User administrator",
        permissions: [
          "dashboard.view",
          "notification.read",
          "master.read",
          "project.read",
          "users.manage",
          "roles.manage",
        ],
      },
    });
    expect(role.status).toBe(201);
    customRoleId = role.body.id;
    const created = await newStaff("useradmin@sgb.in", "User-Admin-123", "User administrator");
    uaId = created.id;
    ua = (await t.login("useradmin@sgb.in", "User-Admin-123")).access_token;
  });

  it("cannot change their own role, project scope or active state (403 SELF_CHANGE), but may edit their own name", async () => {
    const toSuper = await t.request<ErrorBody>("PATCH", `/api/v1/users/${uaId}`, {
      token: ua,
      body: { version: await userVersion(uaId), role_id: await roleId("Super Admin") },
    });
    expect(toSuper.status).toBe(403);
    expect(toSuper.body.error.code).toBe("FORBIDDEN");
    expect(reason(toSuper)).toBe("SELF_CHANGE");
    const scope = await t.request<ErrorBody>("PUT", `/api/v1/users/${uaId}/scope`, {
      token: ua,
      body: { version: await userVersion(uaId), all_projects: true, project_ids: [] },
    });
    expect(scope.status).toBe(403);
    expect(reason(scope)).toBe("SELF_CHANGE");
    const off = await t.request<ErrorBody>("POST", `/api/v1/users/${uaId}/deactivate`, { token: ua, body: {} });
    expect(off.status).toBe(403);
    expect(reason(off)).toBe("SELF_CHANGE");
    const rename = await t.request<{ name: string; role_name: string }>("PATCH", `/api/v1/users/${uaId}`, {
      token: ua,
      body: { version: await userVersion(uaId), name: "User Admin", role_id: customRoleId },
    });
    expect(rename.status).toBe(200); // the unchanged role_id re-sent by an edit form is not a change
    expect(rename.body.role_name).toBe("User administrator");
    // nothing changed behind the 403s
    const [row] = await t.app.sql<
      { role_id: string; is_active: boolean }[]
    >`select role_id, is_active from users where id = ${uaId}`;
    expect(row!.role_id).toBe(customRoleId);
    expect(row!.is_active).toBe(true);
  });

  it("cannot grant a role carrying permissions they do not hold (403 PERMISSION_ESCALATION)", async () => {
    const sa = await t.request<ErrorBody>("POST", "/api/v1/users", {
      token: ua,
      body: {
        name: "Sneaky",
        email: "sneaky@sgb.in",
        role_id: await roleId("Super Admin"),
        password: "Sneaky-Pass-123",
        must_change_password: false,
      },
    });
    expect(sa.status).toBe(403);
    expect(reason(sa)).toBe("PERMISSION_ESCALATION");
    expect((sa.body.error.details?.["missing"] as string[]).length).toBeGreaterThan(10);
    const emp = await t.request<{ id: string; version: number }>("POST", "/api/v1/users", {
      token: ua,
      body: {
        name: "Plain employee",
        email: "plain.emp@sgb.in",
        role_id: await roleId("Employee"),
        password: "Plain-Emp-1234",
        must_change_password: false,
      },
    });
    expect(emp.status).toBe(201);
    const promote = await t.request<ErrorBody>("PATCH", `/api/v1/users/${emp.body.id}`, {
      token: ua,
      body: { version: emp.body.version, role_id: await roleId("Sales") },
    });
    expect(promote.status).toBe(403);
    expect(reason(promote)).toBe("PERMISSION_ESCALATION");
    expect(promote.body.error.details?.["missing"]).toContain("customer.read");
  });

  it("cannot create or edit a custom role carrying permissions they do not hold", async () => {
    const bad = await t.request<ErrorBody>("POST", "/api/v1/roles", {
      token: ua,
      body: { name: "Cashier plus", permissions: ["dashboard.view", "payment.post"] },
    });
    expect(bad.status).toBe(403);
    expect(reason(bad)).toBe("PERMISSION_ESCALATION");
    expect(bad.body.error.details?.["missing"]).toEqual(["payment.post"]);
    const ok = await t.request<{ id: string; version: number }>("POST", "/api/v1/roles", {
      token: ua,
      body: { name: "Viewer", permissions: ["dashboard.view", "project.read"] },
    });
    expect(ok.status).toBe(201);
    const widen = await t.request<ErrorBody>("PATCH", `/api/v1/roles/${ok.body.id}`, {
      token: ua,
      body: { version: ok.body.version, permissions: ["dashboard.view", "project.read", "audit.view"] },
    });
    expect(widen.status).toBe(403);
    expect(reason(widen)).toBe("PERMISSION_ESCALATION");
    // its own role cannot be widened either
    const [own] = await t.app.sql<{ version: number }[]>`select version from roles where id = ${customRoleId}`;
    const self = await t.request<ErrorBody>("PATCH", `/api/v1/roles/${customRoleId}`, {
      token: ua,
      body: {
        version: own!.version,
        permissions: ["dashboard.view", "users.manage", "roles.manage", "settings.manage"],
      },
    });
    expect(self.status).toBe(403);
    // the Super Admin may grant anything
    const sup = await t.request("POST", "/api/v1/roles", {
      token: admin,
      body: { name: "Cashier plus", permissions: ["dashboard.view", "payment.post"] },
    });
    expect(sup.status).toBe(201);
  });

  it("only a Super Admin may edit or deactivate a Super Admin, or edit a system role", async () => {
    const [sa] = await t.app.sql<
      { id: string; version: number }[]
    >`select id, version from users where email = ${CREDS.admin.email}`;
    for (const [method, url, body] of [
      ["PATCH", `/api/v1/users/${sa!.id}`, { version: sa!.version, name: "Hijacked" }],
      ["POST", `/api/v1/users/${sa!.id}/deactivate`, {}],
      [
        "POST",
        `/api/v1/users/${sa!.id}/reset-password`,
        { version: sa!.version, new_password: "Hijacked-Pass-1", must_change_password: false },
      ],
      ["POST", `/api/v1/users/${sa!.id}/unlock`, { version: sa!.version }],
    ] as const) {
      const r = await t.request<ErrorBody>(method, url, { token: ua, body });
      expect(r.status, `${method} ${url}`).toBe(403);
      expect(reason(r)).toBe("SUPER_ADMIN_TARGET");
    }
    // an account holding more permissions than the caller (Sales) is out of reach as well: a password reset would hand its role over
    const sales = await newStaff("sales.two@sgb.in", "Sales-Two-1234", "Sales");
    const reset = await t.request<ErrorBody>("POST", `/api/v1/users/${sales.id}/reset-password`, {
      token: ua,
      body: { version: sales.version, must_change_password: true },
    });
    expect(reset.status).toBe(403);
    expect(reason(reset)).toBe("TARGET_OUTRANKS_CALLER");
    // system roles: Super Admin only (description is the only editable field)
    const [emp] = await t.app.sql<
      { id: string; version: number }[]
    >`select id, version from roles where name = 'Employee' and company_id = ${t.companyId}`;
    const sys = await t.request<ErrorBody>("PATCH", `/api/v1/roles/${emp!.id}`, {
      token: ua,
      body: { version: emp!.version, description: "Changed" },
    });
    expect(sys.status).toBe(403);
    expect(reason(sys)).toBe("SYSTEM_ROLE_SUPER_ADMIN_ONLY");
    expect(
      (
        await t.request("PATCH", `/api/v1/roles/${emp!.id}`, {
          token: admin,
          body: { version: emp!.version, description: "Read-only dashboard and inventory." },
        })
      ).status,
    ).toBe(200);
  });

  it("a project-scoped user administrator cannot hand out all-project access (403 SCOPE_ESCALATION)", async () => {
    const p = await createProject(t, "Scope Escalation Heights", "SEH");
    const scoped = await newStaff("scoped.ua@sgb.in", "Scoped-Admin-123", "User administrator", {
      all_projects: false,
      project_ids: [p],
    });
    expect(scoped.id).toBeTruthy();
    const tok = (await t.login("scoped.ua@sgb.in", "Scoped-Admin-123")).access_token;
    const wide = await t.request<ErrorBody>("POST", "/api/v1/users", {
      token: tok,
      body: {
        name: "Wide",
        email: "wide@sgb.in",
        role_id: await roleId("Employee"),
        password: "Wide-Pass-1234",
        all_projects: true,
        project_ids: [],
        must_change_password: false,
      },
    });
    expect(wide.status).toBe(403);
    expect(reason(wide)).toBe("SCOPE_ESCALATION");
    const narrow = await t.request("POST", "/api/v1/users", {
      token: tok,
      body: {
        name: "Narrow",
        email: "narrow@sgb.in",
        role_id: await roleId("Employee"),
        password: "Narrow-Pass-123",
        all_projects: false,
        project_ids: [p],
        must_change_password: false,
      },
    });
    expect(narrow.status).toBe(201);
  });
});

describe("GET /search gates each entity type by its own read permission and scope", () => {
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    projectA = await createProject(t, "Searchable Alpha", "SRA");
    projectB = await createProject(t, "Searchable Beta", "SRB");
    const mk = async (name: string, phone: string) => {
      const r = await t.request<{ id: string }>("POST", "/api/v1/customers", {
        token: admin,
        body: { full_name: name, phone },
      });
      if (r.status !== 201) throw new Error(r.text);
      return r.body.id;
    };
    const inA = await mk("Zorawar InScope", "9811100001");
    const inB = await mk("Zorawar OutScope", "9811100002");
    const viaLead = await mk("Zorawar LeadLinked", "9811100003");
    await mk("Zorawar Unlinked", "9811100004");
    await createActiveBooking(t, inA, projectA);
    await createActiveBooking(t, inB, projectB);
    await t.app
      .sql`insert into leads (company_id, lead_number, full_name, phone, source, stage, project_id, customer_id) values (${t.companyId}, 'LD-SRCH-1', 'Zorawar LeadLinked', '9811100003', 'WALK_IN', 'NEW', ${projectA}, ${viaLead})`;
  });

  async function search(token: string, q: string) {
    const r = await t.request<{ results: { type: string; label: string; sublabel: string | null }[] }>(
      "GET",
      `/api/v1/search?q=${encodeURIComponent(q)}`,
      { token },
    );
    expect(r.status).toBe(200);
    return r.body.results;
  }

  it("Employee (no customer.read / booking.read) finds no customers or bookings — names and phones never leak", async () => {
    const emp = (await t.loginAs("employee")).access_token;
    const byName = await search(emp, "Zorawar");
    expect(byName.filter((r) => r.type === "CUSTOMER" || r.type === "BOOKING")).toEqual([]);
    expect(await search(emp, "98111")).toEqual([]);
    const bookings = await search(emp, "BK-TEST");
    expect(bookings.filter((r) => r.type === "BOOKING")).toEqual([]);
    // projects are still searchable (project.read)
    expect((await search(emp, "Searchable")).some((r) => r.type === "PROJECT")).toBe(true);
  });

  it("an all-project Sales user sees every customer; a scoped Project Admin only customers linked to their projects", async () => {
    const sales = (await t.loginAs("sales")).access_token;
    expect(
      (await search(sales, "Zorawar"))
        .filter((r) => r.type === "CUSTOMER")
        .map((r) => r.label)
        .sort(),
    ).toEqual(["Zorawar InScope", "Zorawar LeadLinked", "Zorawar OutScope", "Zorawar Unlinked"]);
    const pa = await newStaff("search.pa@sgb.in", "Search-Admin-12", "Project Admin", {
      all_projects: false,
      project_ids: [projectA],
    });
    expect(pa.id).toBeTruthy();
    const tok = (await t.login("search.pa@sgb.in", "Search-Admin-12")).access_token;
    const customers = (await search(tok, "Zorawar"))
      .filter((r) => r.type === "CUSTOMER")
      .map((r) => r.label)
      .sort();
    expect(customers).toEqual(["Zorawar InScope", "Zorawar LeadLinked"]);
    const bookings = (await search(tok, "BK-TEST")).filter((r) => r.type === "BOOKING");
    expect(bookings.length).toBe(1);
    expect(bookings[0]!.sublabel).toContain("Zorawar InScope");
  });
});

describe("CSV exports neutralise spreadsheet formulas", () => {
  it("a public enquiry named =HYPERLINK(...) is exported as text by GET /leads?format=csv", async () => {
    const evil = '=HYPERLINK("http://evil.example","Click")';
    const r = await t.request("POST", "/api/v1/public/enquiries", {
      body: { name: evil, phone: "9822200001", message: "@SUM(1+1)", consent: true },
    });
    expect([200, 201]).toContain(r.status);
    const csv = await t.request("GET", "/api/v1/leads?format=csv", { token: admin });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    expect(csv.text).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });
});

describe("client IP is Fastify's proxy-aware req.ip", () => {
  async function loginFrom(remoteAddress: string, xff: string | null, email: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (xff) headers["x-forwarded-for"] = xff;
    return t.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress,
      headers,
      payload: JSON.stringify({ email, password: "Wrong-Pass-1A" }),
    });
  }

  it("ignores X-Forwarded-For from an untrusted peer and honours it (right-most untrusted hop) from a trusted proxy", async () => {
    // TRUST_PROXY defaults to loopback: a direct client cannot choose its own IP
    await loginFrom("203.0.113.7", "1.2.3.4", "ip.direct@sgb.in");
    await loginFrom("127.0.0.1", "198.51.100.23", "ip.proxied@sgb.in");
    // a client that prepends a fake hop through the trusted proxy still gets its real address
    await loginFrom("127.0.0.1", "6.6.6.6, 198.51.100.24", "ip.spoof@sgb.in");
    const rows = await t.app.sql<
      { identifier: string; ip: string }[]
    >`select identifier, ip from login_events where identifier like 'ip.%@sgb.in' order by identifier`;
    expect(Object.fromEntries(rows.map((r) => [r.identifier, r.ip]))).toEqual({
      "ip.direct@sgb.in": "203.0.113.7",
      "ip.proxied@sgb.in": "198.51.100.23",
      "ip.spoof@sgb.in": "198.51.100.24",
    });
  });

  it("a spoofed header cannot dodge the per-IP lockout", async () => {
    for (let i = 0; i < 5; i++) await loginFrom("203.0.113.8", `9.9.9.${i}`, CREDS.employee.email);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "203.0.113.8",
      headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.99" },
      payload: JSON.stringify(CREDS.employee),
    });
    expect(res.statusCode).toBe(423);
    await t.app
      .sql`update login_events set created_at = created_at - interval '1 hour' where identifier = ${CREDS.employee.email}`;
  });
});

describe("login lockout per (account, client IP) plus an account-wide threshold", () => {
  it("5 failures from one IP lock only that IP: the owner signs in from another IP (no lockout DoS)", async () => {
    const attacker = "10.250.1.1";
    for (let i = 0; i < 4; i++)
      expect(
        (
          await t.request("POST", "/api/v1/auth/login", {
            ip: attacker,
            body: { email: CREDS.accounts.email, password: "Wrong-Pass-1A" },
          })
        ).status,
      ).toBe(401);
    const fifth = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      ip: attacker,
      body: { email: CREDS.accounts.email, password: "Wrong-Pass-1A" },
    });
    expect(fifth.status).toBe(423);
    // the attacker's IP is locked even with the right password …
    expect((await t.request("POST", "/api/v1/auth/login", { ip: attacker, body: CREDS.accounts })).status).toBe(423);
    // … while the real user, elsewhere, is not
    expect((await t.request("POST", "/api/v1/auth/login", { ip: "10.250.1.2", body: CREDS.accounts })).status).toBe(
      200,
    );
    const [u] = await t.app.sql<
      { locked_until: Date | null }[]
    >`select locked_until from users where email = ${CREDS.accounts.email}`;
    expect(u!.locked_until).toBeNull();
    const audit = await t.app.sql<
      { after: { scope: string; ip: string } }[]
    >`select after from audit_logs where action = 'auth.locked' and after->>'scope' = 'PAIR' and after->>'ip' = ${attacker}`;
    expect(audit.length).toBe(1);
  });

  it("20 failures across IPs lock the account itself, notify the Super Admins, and an admin unlock clears it", async () => {
    const email = CREDS.marketing.email;
    let last = 0;
    for (let i = 0; i < 20; i++) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
        ip: `10.251.${Math.floor(i / 4)}.1`,
        body: { email, password: "Wrong-Pass-1A" },
      });
      last = r.status;
      if (i < 19) expect(r.status).toBe(401);
    }
    expect(last).toBe(423);
    // a fresh IP with the right password is refused now: the account itself is locked
    const fresh = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      ip: "10.251.99.1",
      body: CREDS.marketing,
    });
    expect(fresh.status).toBe(423);
    const [u] = await t.app.sql<
      { id: string; locked_until: string | null; version: number }[]
    >`select id, locked_until, version from users where email = ${email}`;
    expect(new Date(u!.locked_until!).getTime()).toBeGreaterThan(Date.now());
    const notes = await t.app.sql<
      { title: string; type: string }[]
    >`select n.title, n.type from notifications n join users x on x.id = n.recipient_id where x.email = ${CREDS.admin.email} and n.entity_id = ${u!.id}`;
    expect(notes.length).toBe(1);
    expect(notes[0]!.title).toMatch(/locked after 20 failed sign-ins/);
    expect(notes[0]!.type).toBe("SECURITY_ALERT"); // its own bell type, not INTEGRITY_FINDINGS
    // the staff bell list accepts the type (its response schema validates against NOTIFICATION_TYPES)
    const bells = await t.request<{ items: { type: string }[] }>("GET", "/api/v1/notifications?page_size=50", {
      token: admin,
    });
    expect(bells.status, bells.text).toBe(200);
    expect(bells.body.items.some((b) => b.type === "SECURITY_ALERT")).toBe(true);
    const audit = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from audit_logs where action = 'auth.locked' and entity_id = ${u!.id} and after->>'scope' = 'ACCOUNT'`;
    expect(audit[0]!.n).toBe(1);
    const unlock = await t.request("POST", `/api/v1/users/${u!.id}/unlock`, {
      token: admin,
      body: { version: u!.version },
    });
    expect(unlock.status).toBe(200);
    expect((await t.request("POST", "/api/v1/auth/login", { ip: "10.251.0.1", body: CREDS.marketing })).status).toBe(
      200,
    );
  });

  it("portal: unknown phone and wrong password answer identically, including the 423", async () => {
    const strip = (b: ErrorBody) => ({
      code: b.error.code,
      message: b.error.message,
      details: b.error.details ? Object.keys(b.error.details).sort() : null,
    });
    const { createPortalCustomer } = await import("./fixtures.js");
    await createPortalCustomer(t, { phone: "9833300001", name: "Lockout Buyer" });
    for (let i = 1; i <= 6; i++) {
      const unknown = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
        ip: "10.252.0.1",
        body: { phone: "9833300009", password: "Wrong-Pass-1A" },
      });
      const wrong = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
        ip: "10.252.0.2",
        body: { phone: "9833300001", password: "Wrong-Pass-1A" },
      });
      expect(unknown.status).toBe(wrong.status);
      expect(unknown.status).toBe(i < 5 ? 401 : 423);
      expect(strip(unknown.body)).toEqual(strip(wrong.body));
    }
    // the buyer can still sign in from their own phone's network
    expect(
      (
        await t.request("POST", "/api/v1/portal/auth/login", {
          ip: "10.252.0.3",
          body: { phone: "9833300001", password: "Welcome@123" },
        })
      ).status,
    ).toBe(200);
  });
});

describe("authentication survives a Redis outage (database fallback)", () => {
  it("authenticates from the database and still enforces revocation when the security Redis is unreachable", async () => {
    const { Redis } = await import("ioredis");
    const dead = new Redis("redis://127.0.0.1:1", {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on("error", () => undefined); // connection refused is the point of the test
    const host = t.app as unknown as { redisSecurity?: unknown; redis: unknown };
    const hadSecurity = Object.prototype.hasOwnProperty.call(host, "redisSecurity");
    const previousSecurity = host.redisSecurity;
    const ip = "10.253.0.1";
    const login = await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", { ip, body: CREDS.sales });
    expect(login.status).toBe(200);
    host.redisSecurity = dead;
    try {
      const me = await t.request("GET", "/api/v1/auth/me", { token: login.body.access_token });
      expect(me.status).toBe(200);
      expect(
        (await t.request("POST", "/api/v1/auth/logout", { token: login.body.access_token, body: {} })).status,
      ).toBe(204);
      // the marker could not be written nor read: the database says the family is revoked
      const after = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: login.body.access_token });
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe("SESSION_REVOKED");

      // both Redis clients down: sign-in, authenticated reads and revocation still work from PostgreSQL
      const cache = host.redis;
      host.redis = dead;
      try {
        const again = await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", {
          ip,
          body: CREDS.sales,
        });
        expect(again.status).toBe(200);
        const me2 = await t.request<{ user: { email: string } }>("GET", "/api/v1/auth/me", {
          token: again.body.access_token,
        });
        expect(me2.status).toBe(200);
        expect(me2.body.user.email).toBe(CREDS.sales.email);
        const sessions = await t.request<{ items: { id: string; is_current: boolean }[] }>(
          "GET",
          "/api/v1/auth/sessions",
          { token: again.body.access_token },
        );
        expect(sessions.status).toBe(200);
      } finally {
        host.redis = cache;
      }
    } finally {
      if (hadSecurity) host.redisSecurity = previousSecurity;
      else delete host.redisSecurity;
      dead.disconnect();
    }
    // with Redis back, the revoked token stays revoked
    expect((await t.request("GET", "/api/v1/auth/me", { token: login.body.access_token })).status).toBe(401);
  });
});

describe("customer privacy and integrity", () => {
  async function aadhaar(base11: string): Promise<string> {
    const m = await import("./fixtures/crm.js");
    return m.validAadhaar(base11);
  }

  async function newCustomer(
    name: string,
    phone: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; version: number; customer_code: string }> {
    const r = await t.request<{ id: string; version: number; customer_code: string }>("POST", "/api/v1/customers", {
      token: admin,
      body: { full_name: name, phone, ...extra },
    });
    if (r.status !== 201) throw new Error(r.text);
    return r.body;
  }

  async function kycDoc(customerId: string, name: string): Promise<void> {
    await t.app
      .sql`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, is_sensitive)
      values (${t.companyId}, 'CUSTOMER', ${customerId}, ${name}, 'image/jpeg', 100, ${`sha-${name}`}, ${`k/${name}`}, 'STAFF', true)`;
  }

  async function kyc(token: string, id: string, body: Record<string, unknown>) {
    const [c] = await t.app.sql<{ version: number }[]>`select version from customers where id = ${id}`;
    return t.request<
      ErrorBody & {
        kyc_status: string;
        kyc_submitted_by: string | null;
        kyc_verified_by: string | null;
        version: number;
      }
    >("POST", `/api/v1/customers/${id}/kyc`, { token, body: { version: c!.version, ...body } });
  }

  it("KYC is a maker-checker workflow with evidence", async () => {
    const sales = await t.loginAs("sales");
    const accounts = await t.loginAs("accounts");
    const c = await newCustomer("Kyc Workflow", "9844400001");
    // nothing on file
    const empty = await kyc(sales.access_token, c.id, { kyc_status: "SUBMITTED" });
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe("KYC_INCOMPLETE");
    expect(empty.body.error.details?.["missing"]).toEqual(["pan", "aadhaar", "kyc_document"]);
    // PENDING → VERIFIED is not a move (kyc_view holder)
    const jump = await kyc(admin, c.id, { kyc_status: "VERIFIED" });
    expect(jump.status).toBe(409);
    expect(jump.body.error.code).toBe("KYC_TRANSITION_INVALID");
    // evidence, then submit (maker = Sales)
    const [cur] = await t.app.sql<{ version: number }[]>`select version from customers where id = ${c.id}`;
    expect(
      (
        await t.request("PATCH", `/api/v1/customers/${c.id}`, {
          token: sales.access_token,
          body: { version: cur!.version, pan: "KYCWF1234K", aadhaar: await aadhaar("34567890123") },
        })
      ).status,
    ).toBe(200);
    await kycDoc(c.id, "kyc-wf-pan.jpg");
    const submitted = await kyc(sales.access_token, c.id, { kyc_status: "SUBMITTED" });
    expect(submitted.status, submitted.text).toBe(200);
    expect(submitted.body.kyc_submitted_by).toBe(sales.user.id);
    // Sales cannot verify (no customer.kyc_view); a kyc_view holder who submitted cannot verify their own submission
    expect((await kyc(sales.access_token, c.id, { kyc_status: "VERIFIED" })).status).toBe(403);
    await t.app.sql`update customers set kyc_submitted_by = ${(await t.loginAs("admin")).user.id} where id = ${c.id}`;
    const self = await kyc(admin, c.id, { kyc_status: "VERIFIED" });
    expect(self.status).toBe(403);
    expect(self.body.error.details?.["reason"]).toBe("KYC_MAKER_CHECKER");
    await t.app.sql`update customers set kyc_submitted_by = ${sales.user.id} where id = ${c.id}`;
    // the checker rejects; resubmitting without any change is refused, after an edit it is allowed
    const rejected = await kyc(admin, c.id, { kyc_status: "REJECTED", kyc_remarks: "Scan unreadable" });
    expect(rejected.status, rejected.text).toBe(200);
    expect(rejected.body.kyc_verified_by).toBeTruthy();
    const unchanged = await kyc(sales.access_token, c.id, { kyc_status: "SUBMITTED" });
    expect(unchanged.status).toBe(409);
    expect(unchanged.body.error.details?.["reason"]).toBe("UNCHANGED_SINCE_REJECTION");
    expect((await kyc(admin, c.id, { kyc_status: "VERIFIED" })).body.error.code).toBe("KYC_TRANSITION_INVALID"); // REJECTED → VERIFIED
    await kycDoc(c.id, "kyc-wf-pan-clear.jpg");
    expect((await kyc(sales.access_token, c.id, { kyc_status: "SUBMITTED" })).status).toBe(200);
    const verified = await kyc(admin, c.id, { kyc_status: "VERIFIED" });
    expect(verified.status, verified.text).toBe(200);
    // a VERIFIED status changes only with settings.manage and a reason
    expect((await kyc(accounts.access_token, c.id, { kyc_status: "REJECTED", kyc_remarks: "x x x" })).status).toBe(403);
    const noReason = await kyc(admin, c.id, { kyc_status: "SUBMITTED" });
    expect(noReason.status).toBe(400);
    const reopened = await kyc(admin, c.id, { kyc_status: "SUBMITTED", reason: "Aadhaar re-issued by UIDAI" });
    expect(reopened.status, reopened.text).toBe(200);
    const [audit] = await t.app.sql<
      { after: { reason: string } }[]
    >`select after from audit_logs where action = 'customer.kyc_reopened' and entity_id = ${c.id}`;
    expect(audit!.after.reason).toBe("Aadhaar re-issued by UIDAI");
  });

  it("concurrent creates of one phone: exactly one 201 and one 409 DUPLICATE_CUSTOMER naming the existing customer", async () => {
    const body = { full_name: "Race Twin", phone: "9844400002" };
    const [a, b] = await Promise.all([
      t.request<{ id: string } & ErrorBody>("POST", "/api/v1/customers", { token: admin, body }),
      t.request<{ id: string } & ErrorBody>("POST", "/api/v1/customers", { token: admin, body }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    const winner = a.status === 201 ? a : b;
    expect(loser.body.error.code).toBe("DUPLICATE_CUSTOMER");
    expect((loser.body.error.details?.["existing"] as { id: string }).id).toBe(winner.body.id);
  });

  it("a writer that slipped past the application check hits the unique index: still 409 DUPLICATE_CUSTOMER with details.existing", async () => {
    // An uncommitted row from another writer that never took the advisory lock: the API's duplicate check cannot see it, its INSERT
    // waits on the unique index, and fails with 23505 once the other writer commits.
    const other = await t.app.sql.reserve();
    try {
      await other`begin`;
      const [row] = await other<
        { id: string }[]
      >`insert into customers (company_id, customer_code, full_name, phone) values (${t.companyId}, 'CUST-RACE-1', 'Direct Insert', '9844400003') returning id`;
      const pending = t.request<ErrorBody>("POST", "/api/v1/customers", {
        token: admin,
        body: { full_name: "Api Insert", phone: "9844400003" },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other`commit`;
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DUPLICATE_CUSTOMER");
      expect(res.body.error.details?.["existing"]).toMatchObject({
        id: row!.id,
        customer_code: "CUST-RACE-1",
        matched_on: "PHONE",
      });
    } finally {
      other.release();
    }
  });

  it("POST /customers/:id/erase is the admin erasure: co-applicants anonymised (not deleted), financial rows kept, one customer.erased audit", async () => {
    const p = await createProject(t, "Erase Heights", "ERH");
    const c = await newCustomer("Erase Delegate", "9844400004", {
      co_applicants: [{ full_name: "Co Erase", relation: "Wife", phone: "9844400005", pan: "COERA1234E" }],
    });
    const { bookingId } = await createActiveBooking(t, c.id, p);
    await t.app
      .sql`insert into login_events (company_id, subject_type, identifier, success, reason, ip) values (${t.companyId}, 'CUSTOMER', '9844400004', false, 'BAD_PASSWORD', '10.1.1.1')`;
    const active = await t.request<ErrorBody>("POST", `/api/v1/customers/${c.id}/erase`, {
      token: admin,
      body: { confirm: "ERASE", reason: "Customer request" },
    });
    expect(active.status).toBe(409);
    expect(active.body.error.code).toBe("HAS_ACTIVE_BOOKING");
    await t.app.sql`update bookings set status = 'CANCELLED' where id = ${bookingId}`;
    // admin.tools alone is not enough: Super Admin only, as on the admin route
    const role = await t.request<{ id: string }>("POST", "/api/v1/roles", {
      token: admin,
      body: { name: "Tools only", permissions: ["dashboard.view", "admin.tools"] },
    });
    await newStaff("tools.only@sgb.in", "Tools-Only-1234", "Tools only");
    expect(role.status).toBe(201);
    const tools = (await t.login("tools.only@sgb.in", "Tools-Only-1234")).access_token;
    const denied = await t.request<ErrorBody>("POST", `/api/v1/customers/${c.id}/erase`, {
      token: tools,
      body: { confirm: "ERASE", reason: "Customer request" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("SUPER_ADMIN_ONLY");
    const erased = await t.request<{
      full_name: string;
      erased_at: string;
      co_applicants: { full_name: string; phone: string | null; pan_masked: string | null }[];
    }>("POST", `/api/v1/customers/${c.id}/erase`, {
      token: admin,
      body: { confirm: "ERASE", reason: "Customer request under DPDP" },
    });
    expect(erased.status).toBe(200);
    expect(erased.body.full_name).toMatch(/^Erased customer /);
    expect(erased.body.co_applicants).toEqual([
      expect.objectContaining({ full_name: "Erased co-applicant", phone: null, pan_masked: null }),
    ]);
    const [kept] = await t.app.sql<{ bookings: number; cas: number; events: number }[]>`select
      (select count(*)::int from bookings where customer_id = ${c.id}) as bookings,
      (select count(*)::int from co_applicants where customer_id = ${c.id}) as cas,
      (select count(*)::int from login_events where identifier = '9844400004') as events`;
    expect(kept).toEqual({ bookings: 1, cas: 1, events: 0 });
    const audits = await t.app.sql<
      { action: string }[]
    >`select action from audit_logs where entity_id = ${c.id} and action like 'customer.eras%'`;
    expect(audits.map((a) => a.action)).toEqual(["customer.erased"]);
  });

  it("bulk portal enable returns the one-time credentials once (JSON or CSV) and audits counts only", async () => {
    const p = await createProject(t, "Bulk Portal Towers", "BPT");
    const c1 = await newCustomer("Bulk One", "9844400011");
    const c2 = await newCustomer("Bulk Two", "9844400012");
    await createActiveBooking(t, c1.id, p);
    await createActiveBooking(t, c2.id, p);
    const json = await t.request<{
      enabled: number;
      credentials: {
        customer_id: string;
        customer_code: string;
        full_name: string;
        phone: string;
        temporary_password: string;
      }[];
    }>("POST", "/api/v1/customers/portal/bulk-enable", { token: admin, body: { project_id: p } });
    expect(json.status, json.text).toBe(200);
    expect(json.body.enabled).toBe(1 + 1);
    const one = json.body.credentials.find((x) => x.customer_id === c1.id)!;
    expect(one).toMatchObject({ customer_code: c1.customer_code, full_name: "Bulk One", phone: "9844400011" });
    expect(one.temporary_password).toMatch(/^.{12}$/);
    // the password works (forced change), and is stored nowhere but as a hash
    const login = await t.request<{ user: { must_change_password: boolean } }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: "9844400011", password: one.temporary_password },
    });
    expect(login.status).toBe(200);
    expect(login.body.user.must_change_password).toBe(true);
    const leak = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from audit_logs where after::text like ${`%${one.temporary_password}%`} or before::text like ${`%${one.temporary_password}%`}`;
    expect(leak[0]!.n).toBe(0);
    const [batch] = await t.app.sql<
      { after: Record<string, unknown> }[]
    >`select after from audit_logs where action = 'customer.portal_bulk_enable' order by created_at desc limit 1`;
    expect(Object.keys(batch!.after).sort()).toEqual(["already_enabled", "enabled", "failed", "format", "project_id"]);
    // CSV on the same call: a third customer
    const c3 = await newCustomer("=Bulk Three", "9844400013");
    await createActiveBooking(t, c3.id, p);
    const csv = await t.request("POST", "/api/v1/customers/portal/bulk-enable?format=csv", {
      token: admin,
      body: { project_id: p },
    });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(String(csv.headers["cache-control"])).toBe("no-store");
    const lines = csv.text.trim().split(/\r\n/);
    expect(lines[0]).toBe("customer_code,full_name,phone,temporary_password,customer_id");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=Bulk Three"); // formula-neutralised like every export
    expect(lines[1]).toContain(c3.id);
  });
});

describe("field-encryption key rotation (REENCRYPT_FIELDS)", () => {
  it("re-encrypts PAN/Aadhaar/bank/MFA secrets to the active key in batches; values still decrypt", async () => {
    const { config } = await import("../../src/config.js");
    const { runJob } = await import("../../src/jobs/index.js");
    const { validAadhaar } = await import("./fixtures/crm.js");
    const original = config.FIELD_KEY_RING;
    const c = await t.request<{ id: string }>("POST", "/api/v1/customers", {
      token: admin,
      body: {
        full_name: "Rotate Me",
        phone: "9844400021",
        pan: "ROTAT1234R",
        aadhaar: validAadhaar("56789012345"),
        bank: { bank_name: "SBI", ifsc: "SBIN0001234", holder_name: "Rotate Me", account_number: "123456789012" },
      },
    });
    expect(c.status, c.text).toBe(201);
    await t.app
      .sql`update users set mfa_pending_secret_enc = ${(await import("../../src/lib/crypto.js")).encryptField("JBSWY3DPEHPK3PXP")} where email = ${CREDS.employee.email}`;
    try {
      config.FIELD_KEY_RING = [{ kid: "k2", secret: "rotation-test-field-key-0123456789abcdef-k2" }, ...original];
      const result = await runJob(t.app.db, "REENCRYPT_FIELDS", { batch_size: 2 });
      expect(result.status).toBe("OK");
      expect(result.result).toMatchObject({ active_kid: "k2", remaining: 0 });
      expect((result.result!["updated"] as Record<string, number>)["customers"]).toBeGreaterThanOrEqual(1);
      const [row] = await t.app.sql<
        { pan_enc: string; aadhaar_enc: string; account: string }[]
      >`select pan_enc, aadhaar_enc, bank->>'account_enc' as account from customers where id = ${c.body.id}`;
      for (const v of [row!.pan_enc, row!.aadhaar_enc, row!.account]) expect(v.startsWith("k2.")).toBe(true);
      const [mfa] = await t.app.sql<
        { s: string }[]
      >`select mfa_pending_secret_enc as s from users where email = ${CREDS.employee.email}`;
      expect(mfa!.s.startsWith("k2.")).toBe(true);
      const revealed = await t.request<{ pan: string; bank_account_number: string }>(
        "GET",
        `/api/v1/customers/${c.body.id}?reveal=true`,
        { token: admin },
      );
      expect(revealed.body.pan).toBe("ROTAT1234R");
      expect(revealed.body.bank_account_number).toBe("123456789012");
      // a second pass has nothing left to do
      const again = await runJob(t.app.db, "REENCRYPT_FIELDS");
      expect(Object.values(again.result!["updated"] as Record<string, number>).every((n) => n === 0)).toBe(true);
    } finally {
      // keep k2 readable for anything later in this file
      config.FIELD_KEY_RING = [...original, { kid: "k2", secret: "rotation-test-field-key-0123456789abcdef-k2" }];
    }
  });
});
