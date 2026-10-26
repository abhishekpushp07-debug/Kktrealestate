import { authenticator } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPortalCustomer } from "./fixtures.js";
import { buildTestApp, CREDS, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe("staff login", () => {
  it("returns tokens and the user for valid credentials", async () => {
    const r = await t.request<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
      audience: string;
      user: { email: string; role_name: string; permissions: string[] };
      must_change_password: boolean;
    }>("POST", "/api/v1/auth/login", { body: CREDS.admin });
    expect(r.status).toBe(200);
    expect(r.body.token_type).toBe("Bearer");
    expect(r.body.audience).toBe("erp");
    expect(r.body.expires_in).toBe(900);
    expect(r.body.user.email).toBe("admin@sgb.in");
    expect(r.body.user.role_name).toBe("Super Admin");
    expect(r.body.user.permissions).toContain("users.manage");
    expect(r.body.must_change_password).toBe(false);
    expect(r.body.refresh_token.startsWith("rt_")).toBe(true);
  });

  it("rejects a wrong password with a generic error and records the attempt", async () => {
    const r = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { email: CREDS.admin.email, password: "nope-nope-1A" },
    });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("INVALID_CREDENTIALS");
    const unknown = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { email: "ghost@sgb.in", password: "whatever-1A" },
    });
    expect(unknown.status).toBe(401);
    const events = await t.app.sql<{ n: number }[]>`select count(*)::int as n from login_events where success = false`;
    expect(events[0]!.n).toBeGreaterThanOrEqual(2);
  });

  it("rejects unknown body keys with VALIDATION_ERROR", async () => {
    const r = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      body: { email: CREDS.admin.email, password: "x", extra: 1 },
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("locks the account after 5 failures from one IP (423) and unlocks when the window passes", async () => {
    const ip = "10.240.0.1";
    for (let i = 1; i <= 4; i++) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
        ip,
        body: { email: CREDS.employee.email, password: "wrong-pass-1A" },
      });
      expect(r.status).toBe(401);
    }
    const fifth = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
      ip,
      body: { email: CREDS.employee.email, password: "wrong-pass-1A" },
    });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe("LOCKED");
    expect(typeof fifth.body.error.details?.["locked_until"]).toBe("string");
    const correctButLocked = await t.request<ErrorBody>("POST", "/api/v1/auth/login", { ip, body: CREDS.employee });
    expect(correctButLocked.status).toBe(423);
    // time travel: the lockout window has passed (the failures are older than 15 minutes)
    await t.app
      .sql`update login_events set created_at = created_at - interval '16 minutes' where identifier = ${CREDS.employee.email}`;
    const ok = await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", { ip, body: CREDS.employee });
    expect(ok.status).toBe(200);
    const [row] = await t.app.sql<
      { failed_attempts: number; locked_until: string | null }[]
    >`select failed_attempts, locked_until from users where email = ${CREDS.employee.email}`;
    expect(row!.failed_attempts).toBe(0);
    expect(row!.locked_until).toBeNull();
  });

  it("rate-limits the login endpoint per IP (10/min)", async () => {
    const ip = "203.0.113.7";
    let limited: { status: number; headers: Record<string, unknown> } | null = null;
    for (let i = 0; i < 12; i++) {
      const r = await t.request<ErrorBody>("POST", "/api/v1/auth/login", {
        body: { email: "nobody@sgb.in", password: "wrong-pass-1A" },
        ip,
      });
      if (r.status === 429) {
        limited = r;
        expect(r.body.error.code).toBe("RATE_LIMITED");
        break;
      }
    }
    expect(limited).not.toBeNull();
    expect(limited!.headers["retry-after"]).toBeTruthy();
  });
});

describe("tokens and sessions", () => {
  it("rotates refresh tokens and revokes the whole family on reuse", async () => {
    const login = await t.loginAs("accounts");
    const r1 = await t.request<{ access_token: string; refresh_token: string }>("POST", "/api/v1/auth/refresh", {
      body: { refresh_token: login.refresh_token },
    });
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(login.refresh_token);
    const me = await t.request("GET", "/api/v1/auth/me", { token: r1.body.access_token });
    expect(me.status).toBe(200);
    // reuse of the old token
    const reuse = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      body: { refresh_token: login.refresh_token },
    });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("TOKEN_REUSED");
    // the legitimately rotated token is now dead too
    const dead = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      body: { refresh_token: r1.body.refresh_token },
    });
    expect(dead.status).toBe(401);
    // and access tokens of that family stop working immediately
    const revoked = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: r1.body.access_token });
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe("SESSION_REVOKED");
    const audit = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from audit_logs where action = 'auth.refresh_reuse'`;
    expect(audit[0]!.n).toBeGreaterThanOrEqual(1);
    const family = await t.app.sql<
      { revoke_reason: string | null }[]
    >`select revoke_reason from refresh_tokens where subject_id = ${login.user.id} and revoked_at is not null`;
    expect(family.length).toBeGreaterThanOrEqual(2);
    expect(family.every((f) => f.revoke_reason === "REUSE_DETECTED")).toBe(true);
  });

  it("invalid refresh tokens are rejected", async () => {
    const r = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      body: { refresh_token: "rt_definitely-not-a-real-token-value" },
    });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("INVALID_TOKEN");
  });

  it("logout revokes the session so the access token stops working", async () => {
    const login = await t.loginAs("sales");
    const out = await t.request("POST", "/api/v1/auth/logout", { token: login.access_token, body: {} });
    expect(out.status).toBe(204);
    const me = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: login.access_token });
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe("SESSION_REVOKED");
    const refresh = await t.request<ErrorBody>("POST", "/api/v1/auth/refresh", {
      body: { refresh_token: login.refresh_token },
    });
    expect(refresh.status).toBe(401);
  });

  it("me returns user and company settings", async () => {
    const login = await t.loginAs("admin");
    const r = await t.request<{
      user: { email: string; project_ids: string[]; all_projects: boolean };
      company: { name: string; fy_start_month: number; settings: { force_mfa_for_admins: boolean } };
    }>("GET", "/api/v1/auth/me", { token: login.access_token });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe("admin@sgb.in");
    expect(r.body.user.all_projects).toBe(true);
    expect(r.body.company.name).toBe("Shree Ganesh Builders");
    expect(r.body.company.fy_start_month).toBe(4);
    expect(r.body.company.settings.force_mfa_for_admins).toBe(false);
  });

  it("missing, garbage and expired-style tokens are 401 with distinct codes", async () => {
    const none = await t.request<ErrorBody>("GET", "/api/v1/auth/me");
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe("UNAUTHENTICATED");
    const garbage = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: "abc.def.ghi" });
    expect(garbage.status).toBe(401);
    expect(garbage.body.error.code).toBe("INVALID_TOKEN");
    const { signAccessToken } = await import("../../src/lib/jwt.js");
    const expired = await signAccessToken(
      { sub: "00000000-0000-0000-0000-000000000000", aud: "erp", cid: t.companyId, sid: "x" },
      -5,
    );
    const exp = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: expired });
    expect(exp.status).toBe(401);
    expect(exp.body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("lists and revokes sessions", async () => {
    const a = await t.loginAs("marketing");
    const b = await t.loginAs("marketing");
    const list = await t.request<{ items: { id: string; is_current: boolean; family_id: string }[] }>(
      "GET",
      "/api/v1/auth/sessions",
      { token: a.access_token },
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.filter((s) => s.is_current)).toHaveLength(1);
    const other = list.body.items.find((s) => !s.is_current)!;
    const del = await t.request("DELETE", `/api/v1/auth/sessions/${other.id}`, { token: a.access_token });
    expect(del.status).toBe(204);
    const bDead = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: b.access_token });
    expect(bDead.status).toBe(401);
    const c = await t.loginAs("marketing");
    const all = await t.request<{ revoked: number }>("DELETE", "/api/v1/auth/sessions", { token: a.access_token });
    expect(all.status).toBe(200);
    expect(all.body.revoked).toBe(1);
    expect((await t.request("GET", "/api/v1/auth/me", { token: c.access_token })).status).toBe(401);
    expect((await t.request("GET", "/api/v1/auth/me", { token: a.access_token })).status).toBe(200);
    const unknown = await t.request<ErrorBody>("DELETE", `/api/v1/auth/sessions/00000000-0000-0000-0000-000000000000`, {
      token: a.access_token,
    });
    expect(unknown.status).toBe(404);
  });
});

describe("password change", () => {
  it("enforces policy, history and clears must_change_password", async () => {
    const login = await t.loginAs("employee");
    const weak = await t.request<ErrorBody>("POST", "/api/v1/auth/change-password", {
      token: login.access_token,
      body: { current_password: CREDS.employee.password, new_password: "short" },
    });
    expect(weak.status).toBe(400); // contracts PasswordSchema
    const wrongCurrent = await t.request<ErrorBody>("POST", "/api/v1/auth/change-password", {
      token: login.access_token,
      body: { current_password: "Not-the-one-1", new_password: "Brand-New-Pass-1" },
    });
    expect(wrongCurrent.status).toBe(401);
    const ok = await t.request("POST", "/api/v1/auth/change-password", {
      token: login.access_token,
      body: { current_password: CREDS.employee.password, new_password: "Brand-New-Pass-1" },
    });
    expect(ok.status).toBe(200);
    // history: going back to the previous password is refused
    const back = await t.request<ErrorBody>("POST", "/api/v1/auth/change-password", {
      token: login.access_token,
      body: { current_password: "Brand-New-Pass-1", new_password: CREDS.employee.password },
    });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe("PASSWORD_POLICY");
    // forced change flag blocks everything except the exempt routes
    await t.app.sql`update users set must_change_password = true where email = ${CREDS.employee.email}`;
    await t.app.redis.incr("perm:version");
    const forced = await t.login(CREDS.employee.email, "Brand-New-Pass-1");
    expect(forced.must_change_password).toBe(true);
    const blocked = await t.request<ErrorBody>("GET", "/api/v1/notifications", { token: forced.access_token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await t.request("GET", "/api/v1/auth/me", { token: forced.access_token })).status).toBe(200);
    const changed = await t.request("POST", "/api/v1/auth/change-password", {
      token: forced.access_token,
      body: { current_password: "Brand-New-Pass-1", new_password: "Another-Pass-22" },
    });
    expect(changed.status).toBe(200);
    expect((await t.request("GET", "/api/v1/notifications", { token: forced.access_token })).status).toBe(200);
    const history = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from password_history where subject_id = ${login.user.id}`;
    expect(history[0]!.n).toBe(2);
  });
});

describe("MFA", () => {
  it("enrols, verifies, requires the code at login and can be disabled", async () => {
    const login = await t.loginAs("accounts");
    const enroll = await t.request<{ secret: string; otpauth_url: string }>("POST", "/api/v1/auth/mfa/enroll", {
      token: login.access_token,
    });
    expect(enroll.status).toBe(200);
    expect(enroll.body.otpauth_url).toContain("otpauth://totp/");
    const bad = await t.request<ErrorBody>("POST", "/api/v1/auth/mfa/verify", {
      token: login.access_token,
      body: { code: "000000" },
    });
    expect(bad.status).toBe(422);
    const verify = await t.request("POST", "/api/v1/auth/mfa/verify", {
      token: login.access_token,
      body: { code: authenticator.generate(enroll.body.secret) },
    });
    expect(verify.status).toBe(200);
    const ip = "10.243.0.1";
    const step1 = await t.request<{ mfa_required: boolean; mfa_token: string }>("POST", "/api/v1/auth/login", {
      ip,
      body: CREDS.accounts,
    });
    expect(step1.status).toBe(200);
    expect(step1.body.mfa_required).toBe(true);
    const wrong = await t.request<ErrorBody>("POST", "/api/v1/auth/login/mfa", {
      ip,
      body: { mfa_token: step1.body.mfa_token, code: "123456" },
    });
    expect(wrong.status).toBe(401);
    // the MFA token is bound to the client IP of the password step
    const elsewhere = await t.request<ErrorBody>("POST", "/api/v1/auth/login/mfa", {
      ip: "10.243.0.2",
      body: { mfa_token: step1.body.mfa_token, code: authenticator.generate(enroll.body.secret) },
    });
    expect(elsewhere.status).toBe(401);
    expect(elsewhere.body.error.code).toBe("INVALID_TOKEN");
    const step2 = await t.request<{ access_token: string; user: { mfa_enabled: boolean } }>(
      "POST",
      "/api/v1/auth/login/mfa",
      { ip, body: { mfa_token: step1.body.mfa_token, code: authenticator.generate(enroll.body.secret) } },
    );
    expect(step2.status).toBe(200);
    expect(step2.body.user.mfa_enabled).toBe(true);
    const inline = await t.request<{ access_token: string }>("POST", "/api/v1/auth/login", {
      body: { ...CREDS.accounts, mfa_code: authenticator.generate(enroll.body.secret) },
    });
    expect(inline.status).toBe(200);
    expect(inline.body.access_token).toBeTruthy();
    const disable = await t.request("POST", "/api/v1/auth/mfa/disable", {
      token: step2.body.access_token,
      body: { password: CREDS.accounts.password, code: authenticator.generate(enroll.body.secret) },
    });
    expect(disable.status).toBe(200);
    const plain = await t.request<{ access_token: string; mfa_required?: boolean }>("POST", "/api/v1/auth/login", {
      body: CREDS.accounts,
    });
    expect(plain.status).toBe(200);
    expect(plain.body.access_token).toBeTruthy();
    const [row] = await t.app.sql<
      { mfa_secret_enc: string | null }[]
    >`select mfa_secret_enc from users where email = ${CREDS.accounts.email}`;
    expect(row!.mfa_secret_enc).toBeNull();
  });

  it("force_mfa_for_admins blocks admins without MFA (403 MFA_REQUIRED) except the enrolment routes", async () => {
    await t.app
      .sql`update companies set settings = settings || '{"force_mfa_for_admins": true}'::jsonb where id = ${t.companyId}`;
    await t.app.redis.del(`company:${t.companyId}`);
    const admin = await t.loginAs("admin");
    const blocked = await t.request<ErrorBody>("GET", "/api/v1/users", { token: admin.access_token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("MFA_REQUIRED");
    expect((await t.request("POST", "/api/v1/auth/mfa/enroll", { token: admin.access_token })).status).toBe(200);
    const sales = await t.loginAs("sales");
    expect((await t.request("GET", "/api/v1/notifications", { token: sales.access_token })).status).toBe(200);
    await t.app
      .sql`update companies set settings = settings || '{"force_mfa_for_admins": false}'::jsonb where id = ${t.companyId}`;
    await t.app.redis.del(`company:${t.companyId}`);
  });
});

describe("portal auth", () => {
  it("logs a customer in with a normalised phone, forces the first password change and keeps audiences apart", async () => {
    await createPortalCustomer(t, { phone: "9876543210", password: "Welcome@123", mustChangePassword: true });
    const bad = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
      body: { phone: "9876543210", password: "nope-nope-1A" },
    });
    expect(bad.status).toBe(401);
    const login = await t.request<{
      access_token: string;
      refresh_token: string;
      audience: string;
      user: { phone: string; must_change_password: boolean; full_name: string };
    }>("POST", "/api/v1/portal/auth/login", { body: { phone: "+91 98765 43210", password: "Welcome@123" } });
    expect(login.status).toBe(200);
    expect(login.body.audience).toBe("portal");
    expect(login.body.user.phone).toBe("9876543210");
    expect(login.body.user.must_change_password).toBe(true);
    const blocked = await t.request<ErrorBody>("GET", "/api/v1/portal/notifications", {
      token: login.body.access_token,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await t.request("GET", "/api/v1/portal/auth/me", { token: login.body.access_token })).status).toBe(200);
    const change = await t.request("POST", "/api/v1/portal/auth/change-password", {
      token: login.body.access_token,
      body: { current_password: "Welcome@123", new_password: "Customer-Pass-9" },
    });
    expect(change.status).toBe(200);
    const me = await t.request<{ must_change_password: boolean; booking_count: number }>(
      "GET",
      "/api/v1/portal/auth/me",
      { token: login.body.access_token },
    );
    expect(me.status).toBe(200);
    expect(me.body.must_change_password).toBe(false);
    expect(me.body.booking_count).toBe(0);
    expect((await t.request("GET", "/api/v1/portal/notifications", { token: login.body.access_token })).status).toBe(
      200,
    );
    // audiences never cross
    const staff = await t.loginAs("admin");
    const cross1 = await t.request<ErrorBody>("GET", "/api/v1/portal/auth/me", { token: staff.access_token });
    expect(cross1.status).toBe(401);
    expect(cross1.body.error.code).toBe("INVALID_AUDIENCE");
    const cross2 = await t.request<ErrorBody>("GET", "/api/v1/auth/me", { token: login.body.access_token });
    expect(cross2.status).toBe(401);
    expect(cross2.body.error.code).toBe("INVALID_AUDIENCE");
    // refresh + sessions + logout
    const refreshed = await t.request<{ access_token: string; refresh_token: string }>(
      "POST",
      "/api/v1/portal/auth/refresh",
      { body: { refresh_token: login.body.refresh_token } },
    );
    expect(refreshed.status).toBe(200);
    const sessions = await t.request<unknown[]>("GET", "/api/v1/portal/auth/sessions", {
      token: refreshed.body.access_token,
    });
    expect(sessions.status).toBe(200);
    expect(Array.isArray(sessions.body)).toBe(true); // Appendix C additions: bare array
    expect(sessions.body).toHaveLength(1);
    expect(
      (await t.request("POST", "/api/v1/portal/auth/logout", { token: refreshed.body.access_token, body: {} })).status,
    ).toBe(204);
    expect((await t.request("GET", "/api/v1/portal/auth/me", { token: refreshed.body.access_token })).status).toBe(401);
  });

  it("locks a customer after 5 failures", async () => {
    await createPortalCustomer(t, { phone: "9876543211", name: "Priya Verma" });
    const ip = "10.240.0.2";
    for (let i = 0; i < 4; i++)
      await t.request("POST", "/api/v1/portal/auth/login", {
        ip,
        body: { phone: "9876543211", password: "wrong-pass-1A" },
      });
    const locked = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
      ip,
      body: { phone: "9876543211", password: "wrong-pass-1A" },
    });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe("LOCKED");
  });
});
