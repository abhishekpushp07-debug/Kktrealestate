import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject } from "./fixtures.js";
import { validAadhaar } from "./fixtures/crm.js";
import { buildTestApp, type ErrorBody, ifMatch, type LoginResult, type TestContext, versionOf } from "./helpers.js";

process.env["KKT_MODULES"] ??= "crm";

/**
 * Adversarial review of the CRM module: canonical duplicate keys, concurrency, reveal auditing, temporary-password hygiene,
 * erasure, round robin edge cases, LOST re-open, convert idempotency, unread counts, project scope and permission boundaries.
 */

let t: TestContext;
let admin: LoginResult;
let salesA: LoginResult;
let salesB: LoginResult;
// sales-c@sgb.in: Sales scoped to project B only (salesCId)
let scopedPA: LoginResult; // Project Admin scoped to project B only
let salesBId = "";
let salesCId = "";
let projectA = "";
let projectB = "";

type Lead = {
  id: string;
  version: number;
  lead_number: string;
  stage: string;
  previous_stage: string | null;
  assigned_user_id: string | null;
  lost_reason: string | null;
  customer_id: string | null;
  is_read: boolean;
  phone: string;
  project_id: string | null;
  consent: boolean;
};
type Customer = Record<string, unknown> & {
  id: string;
  version: number;
  customer_code: string;
  phone: string;
  full_name: string;
  pan_masked: string | null;
  aadhaar_masked: string | null;
  kyc_status: string;
  is_active: boolean;
  portal_enabled: boolean;
  co_applicants: { id: string; pan_masked: string | null; aadhaar_masked: string | null }[];
};
type PortalCard = {
  customer_id: string;
  phone: string;
  is_enabled: boolean;
  must_change_password: boolean;
  temp_password: string | null;
  active_sessions: number;
};

let phoneSeq = 0;
function phone(): string {
  phoneSeq += 1;
  return `97${String(phoneSeq).padStart(8, "0")}`;
}

function customerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: "Adversarial Customer",
    phone: phone(),
    address_current: { line1: "1 Fraser Road", city: "Patna", state: "Bihar", pincode: "800001" },
    ...overrides,
  };
}

async function countRows(table: string, where = "true"): Promise<number> {
  const rows = await t.app.sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table} where ${where}`);
  return Number(rows[0]?.n ?? 0);
}

async function auditTextFor(action: string): Promise<string> {
  const rows = await t.app.sql<
    { before: unknown; after: unknown }[]
  >`select before, after from audit_logs where action = ${action}`;
  return JSON.stringify(rows);
}

async function createUser(
  name: string,
  email: string,
  password: string,
  roleName: string,
  projectIds: string[] | null,
): Promise<{ id: string; login: LoginResult }> {
  const roles = await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles", {
    token: admin.access_token,
  });
  const role = roles.body.items.find((r) => r.name === roleName)!;
  const created = await t.request<{ id: string }>("POST", "/api/v1/users", {
    token: admin.access_token,
    body: {
      name,
      email,
      password,
      role_id: role.id,
      all_projects: projectIds === null,
      project_ids: projectIds ?? [],
      must_change_password: false,
    },
  });
  expect(created.status, created.text).toBe(201);
  return { id: created.body.id, login: await t.login(email, password) };
}

async function setUserActive(id: string, active: boolean): Promise<void> {
  const r = await t.request("POST", `/api/v1/users/${id}/${active ? "activate" : "deactivate"}`, {
    token: admin.access_token,
    body: {},
    headers: ifMatch(await versionOf(t, `/api/v1/users/${id}`, admin.access_token)),
  });
  expect(r.status, r.text).toBe(200);
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = await t.loginAs("admin");
  salesA = await t.loginAs("sales");
  projectA = await createProject(t, "Shree Ganesh Heights", "SGH");
  projectB = await createProject(t, "Ganesh Green Villas", "GGV");
  const b = await createUser("Bela Sales", "sales-b@sgb.in", "SalesB@12345", "Sales", null);
  salesB = b.login;
  salesBId = b.id;
  const c = await createUser("Chetan Sales", "sales-c@sgb.in", "SalesC@12345", "Sales", [projectB]);
  salesCId = c.id;
  scopedPA = (await createUser("Scoped PA", "pa-b@sgb.in", "ScopedPA@12345", "Project Admin", [projectB])).login;
});
afterAll(async () => {
  await t?.close();
});

// ---------------------------------------------------------------------------
// Duplicate keys: canonical forms + concurrency
// ---------------------------------------------------------------------------
describe("duplicate detection is canonical and race-free", () => {
  it("catches the same phone and PAN regardless of formatting (spaces, +91, 0 prefix, lower case)", async () => {
    const first = await t.request<Customer>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({ phone: "+91-98111-22333", pan: "zzabc1234k" }),
    });
    expect(first.status, first.text).toBe(201);
    expect(first.body.phone).toBe("9811122333");
    expect(first.body.pan_masked).toBe("XXXXX1234K");
    for (const p of ["09811122333", "98111 22333", "+919811122333", "9811122333"]) {
      const dup = await t.request<ErrorBody>("POST", "/api/v1/customers", {
        token: salesA.access_token,
        body: customerBody({ phone: p }),
      });
      expect(dup.status, `${p}: ${dup.text}`).toBe(409);
      expect(dup.body.error.code).toBe("DUPLICATE_CUSTOMER");
      expect(dup.body.error.details?.["existing"]).toMatchObject({ id: first.body.id, matched_on: "PHONE" });
    }
    for (const pan of ["ZZABC1234K", "zzabc1234k", " Zzabc1234K "]) {
      const dup = await t.request<ErrorBody>("POST", "/api/v1/customers", {
        token: salesA.access_token,
        body: customerBody({ pan }),
      });
      expect(dup.status, `${pan}: ${dup.text}`).toBe(409);
      expect(dup.body.error.details?.["existing"]).toMatchObject({ id: first.body.id, matched_on: "PAN" });
    }
    const check = await t.request<{ matches: { customer_id: string; matched_on: string }[] }>(
      "POST",
      "/api/v1/customers/duplicate-check",
      { token: salesA.access_token, body: { phone: "+91 98111 22333", pan: "zzabc1234k" } },
    );
    expect(check.body.matches).toHaveLength(1);
    expect(check.body.matches[0]).toMatchObject({ customer_id: first.body.id });
    // the keyed hash at rest is the hash of the canonical PAN, so every spelling above maps onto one value
    const [row] = await t.app.sql<
      { pan_hash: string; phone: string }[]
    >`select pan_hash, phone from customers where id = ${first.body.id}`;
    expect(row!.pan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.phone).toBe("9811122333");
    // PATCH to a phone another live customer holds is refused, with any formatting
    const second = await t.request<Customer>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({ full_name: "Second" }),
    });
    const clash = await t.request<ErrorBody>("PATCH", `/api/v1/customers/${second.body.id}`, {
      token: salesA.access_token,
      body: { version: 1, phone: "+91 98111 22333" },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("DUPLICATE_CUSTOMER");
  });

  it("two simultaneous creates of the same phone → exactly one 201 and one 409 (advisory lock on company + phone)", async () => {
    const p = phone();
    const before = await countRows("customers");
    const results = await Promise.all([
      t.request<Customer | ErrorBody>("POST", "/api/v1/customers", {
        token: salesA.access_token,
        body: customerBody({ full_name: "Racer One", phone: p }),
      }),
      t.request<Customer | ErrorBody>("POST", "/api/v1/customers", {
        token: salesB.access_token,
        body: customerBody({ full_name: "Racer Two", phone: `+91${p}` }),
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await countRows("customers", `phone = '${p}'`)).toBe(1);
    expect(await countRows("customers")).toBe(before + 1);
    const loser = results.find((r) => r.status === 409)!.body as ErrorBody;
    expect(loser.error.code).toBe("DUPLICATE_CUSTOMER");
    // the same race on PAN (different phones)
    const pan = "RACER1234P";
    const panResults = await Promise.all([
      t.request("POST", "/api/v1/customers", { token: salesA.access_token, body: customerBody({ pan }) }),
      t.request("POST", "/api/v1/customers", {
        token: salesB.access_token,
        body: customerBody({ pan: pan.toLowerCase() }),
      }),
    ]);
    expect(panResults.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("two simultaneous website enquiries from one phone for one project create exactly one lead", async () => {
    const { createOrTouchLead } = await import("../../src/modules/crm/index.js");
    const p = phone();
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        t.app.db.transaction((tx) =>
          createOrTouchLead(tx, {
            companyId: t.companyId,
            phone: p,
            name: `Racer ${i}`,
            projectId: projectA,
            source: "WEBSITE",
            activityType: "ENQUIRY",
            redis: t.app.redis,
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.lead.id)).size).toBe(1);
    expect(await countRows("leads", `phone = '${p}'`)).toBe(1);
    // one ENQUIRY activity from the create and one per touched enquiry: nothing lost, nothing duplicated
    expect(await countRows("lead_activities", `lead_id = '${results[0]!.lead.id}' and type = 'ENQUIRY'`)).toBe(3);
    expect(await countRows("lead_activities", `lead_id = '${results[0]!.lead.id}' and type = 'CREATED'`)).toBe(1);
  });

  it("ERP lead create for a phone that already has an open lead in the same project → 409 DUPLICATE_LEAD (never a silent merge)", async () => {
    const p = phone();
    const first = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Walk In", phone: p, source: "WALK_IN", project_id: projectA },
    });
    expect(first.status, first.text).toBe(201);
    const dup = await t.request<ErrorBody>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Walk In Again", phone: `+91 ${p}`, source: "REFERRAL", project_id: projectA },
    });
    expect(dup.status, dup.text).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_LEAD");
    expect(dup.body.error.details?.["existing"]).toMatchObject({
      id: first.body.id,
      lead_number: first.body.lead_number,
      stage: "NEW",
    });
    expect(await countRows("leads", `phone = '${p}'`)).toBe(1);
    // a different project is a different lead; once the first is LOST the phone is free again in project A
    const other = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Walk In", phone: p, source: "WALK_IN", project_id: projectB },
    });
    expect(other.status, other.text).toBe(201);
    const lost = await t.request<Lead>("POST", `/api/v1/leads/${first.body.id}/stage`, {
      token: salesA.access_token,
      body: { version: 1, stage: "LOST", lost_reason: "Went elsewhere" },
    });
    expect(lost.status, lost.text).toBe(200);
    const again = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Walk In", phone: p, source: "WALK_IN", project_id: projectA },
    });
    expect(again.status, again.text).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// KYC reveal auditing and temp-password hygiene
// ---------------------------------------------------------------------------
describe("reveal auditing and secrets hygiene", () => {
  let cid = "";
  let temp = "";

  it("reveal is logged exactly once per revealing request and never otherwise (plain GET, reveal=false, 403, 404)", async () => {
    const created = await t.request<Customer>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({ pan: "REVEA1234L", aadhaar: validAadhaar("56789012345") }),
    });
    expect(created.status, created.text).toBe(201);
    cid = created.body.id;
    const revealAudits = () => countRows("audit_logs", `action = 'customer.kyc_reveal' and entity_id = '${cid}'`);
    expect((await t.request("GET", `/api/v1/customers/${cid}`, { token: admin.access_token })).status).toBe(200);
    expect(
      (await t.request("GET", `/api/v1/customers/${cid}?reveal=false`, { token: admin.access_token })).status,
    ).toBe(200);
    expect((await t.request("GET", `/api/v1/customers/${cid}/360`, { token: admin.access_token })).status).toBe(200);
    expect((await t.request("GET", `/api/v1/customers?search=REVEA`, { token: admin.access_token })).status).toBe(200);
    expect(await revealAudits()).toBe(0);
    expect(
      (await t.request("GET", `/api/v1/customers/${cid}?reveal=true`, { token: salesA.access_token })).status,
    ).toBe(403);
    expect(await revealAudits()).toBe(0);
    expect(
      (
        await t.request("GET", `/api/v1/customers/00000000-0000-4000-8000-000000000000?reveal=true`, {
          token: admin.access_token,
        })
      ).status,
    ).toBe(404);
    expect(
      await countRows(
        "audit_logs",
        `action = 'customer.kyc_reveal' and entity_id = '00000000-0000-4000-8000-000000000000'`,
      ),
    ).toBe(0);
    const r1 = await t.request<{ pan: string; aadhaar: string }>("GET", `/api/v1/customers/${cid}?reveal=true`, {
      token: admin.access_token,
    });
    expect(r1.status, r1.text).toBe(200);
    expect(r1.body.pan).toBe("REVEA1234L");
    expect(await revealAudits()).toBe(1);
    const r2 = await t.request<{ pan: string }>("GET", `/api/v1/customers/${cid}?reveal=1`, {
      token: admin.access_token,
    });
    expect(r2.status, r2.text).toBe(200);
    expect(await revealAudits()).toBe(2);
    // the audit row names the fields but never the values
    const text = await auditTextFor("customer.kyc_reveal");
    expect(text).not.toContain("REVEA1234L");
    expect(text).not.toContain(validAadhaar("56789012345"));
  });

  it("the temporary password appears in the enable/reset response only: never in audit rows, lists, 360, the card or the idempotency store", async () => {
    const enabled = await t.request<PortalCard>("POST", `/api/v1/customers/${cid}/portal/enable`, {
      token: admin.access_token,
      body: {},
      headers: { "idempotency-key": "enable-once" },
    });
    expect(enabled.status, enabled.text).toBe(200);
    temp = enabled.body.temp_password!;
    expect(temp).toMatch(/^.{12}$/);
    // the enable endpoint is deliberately not idempotency-stored (that store would keep the password 24 h): a retry is a clean 422
    const retry = await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/portal/enable`, {
      token: admin.access_token,
      body: {},
      headers: { "idempotency-key": "enable-once" },
    });
    expect(retry.status).toBe(422);
    expect(retry.headers["idempotent-replayed"]).toBeUndefined();
    expect(await countRows("idempotency_keys", `response_body::text like '%${temp}%'`)).toBe(0);
    expect(
      await t.app.redis.keys("idem:*").then(async (keys) => {
        for (const k of keys) {
          const v = await t.app.redis.get(k);
          if (v?.includes(temp)) return 1;
        }
        return 0;
      }),
    ).toBe(0);
    const allAudit = await t.app.sql<{ before: unknown; after: unknown }[]>`select before, after from audit_logs`;
    expect(JSON.stringify(allAudit)).not.toContain(temp);
    for (const url of [
      `/api/v1/customers/${cid}`,
      `/api/v1/customers/${cid}/portal`,
      `/api/v1/customers/${cid}/360`,
      `/api/v1/customers?include_inactive=true&page_size=200`,
      `/api/v1/customers?search=REVEA&format=csv`,
    ]) {
      const r = await t.request("GET", url, { token: admin.access_token });
      expect(r.status, url).toBe(200);
      expect(r.text, url).not.toContain(temp);
    }
    const [pu] = await t.app.sql<
      { password_hash: string; phone: string }[]
    >`select password_hash, phone from portal_users where customer_id = ${cid}`;
    expect(pu!.password_hash).not.toContain(temp);
    expect(pu!.password_hash.startsWith("$argon2")).toBe(true);
    // reset: a fresh password, again only in the response
    const reset = await t.request<PortalCard>("POST", `/api/v1/customers/${cid}/portal/reset-password`, {
      token: admin.access_token,
      body: {},
    });
    expect(reset.status).toBe(200);
    expect(reset.body.temp_password).not.toBe(temp);
    expect(JSON.stringify(await t.app.sql`select before, after from audit_logs`)).not.toContain(
      reset.body.temp_password!,
    );
    temp = reset.body.temp_password!;
  });

  it("changing the customer's phone keeps the portal login in step; deactivation switches the portal off (login refused), restoring does not switch it back on", async () => {
    const cust = await t.request<Customer>("GET", `/api/v1/customers/${cid}`, { token: admin.access_token });
    const newPhone = phone();
    const patched = await t.request<Customer>("PATCH", `/api/v1/customers/${cid}`, {
      token: admin.access_token,
      body: { version: cust.body.version, phone: newPhone },
    });
    expect(patched.status, patched.text).toBe(200);
    const card = await t.request<PortalCard>("GET", `/api/v1/customers/${cid}/portal`, { token: admin.access_token });
    expect(card.body.phone).toBe(newPhone);
    expect(
      (await t.request("POST", "/api/v1/portal/auth/login", { body: { phone: cust.body.phone, password: temp } }))
        .status,
    ).toBe(401);
    const login = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", {
      body: { phone: newPhone, password: temp },
    });
    expect(login.status, login.text).toBe(200);
    const deact = await t.request<{ is_active: boolean }>("POST", `/api/v1/customers/${cid}/deactivate`, {
      token: admin.access_token,
      body: {},
      headers: ifMatch(await versionOf(t, `/api/v1/customers/${cid}`, admin.access_token)),
    });
    expect(deact.status, deact.text).toBe(200);
    const refused = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
      body: { phone: newPhone, password: temp },
    });
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe("USER_INACTIVE");
    expect((await t.request("GET", "/api/v1/portal/auth/me", { token: login.body.access_token })).status).toBe(401);
    expect(
      (await t.request<PortalCard>("GET", `/api/v1/customers/${cid}/portal`, { token: admin.access_token })).body
        .is_enabled,
    ).toBe(false);
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/portal/enable`, {
          token: admin.access_token,
          body: {},
        })
      ).body.error.details?.["rule"],
    ).toBe("CUSTOMER_INACTIVE");
    const restored = await t.request<{ is_active: boolean }>("POST", `/api/v1/customers/${cid}/activate`, {
      token: admin.access_token,
      body: {},
      headers: ifMatch(await versionOf(t, `/api/v1/customers/${cid}`, admin.access_token)),
    });
    expect(restored.body.is_active).toBe(true);
    expect(
      (await t.request<PortalCard>("GET", `/api/v1/customers/${cid}/portal`, { token: admin.access_token })).body
        .is_enabled,
    ).toBe(false);
    expect(
      (await t.request("POST", "/api/v1/portal/auth/login", { body: { phone: newPhone, password: temp } })).status,
    ).toBe(401);
    const reenabled = await t.request<PortalCard>("POST", `/api/v1/customers/${cid}/portal/enable`, {
      token: admin.access_token,
      body: {},
    });
    expect(reenabled.status, reenabled.text).toBe(200);
    expect(reenabled.body.temp_password).toMatch(/^.{12}$/);
    expect(
      (
        await t.request("POST", "/api/v1/portal/auth/login", {
          body: { phone: newPhone, password: reenabled.body.temp_password! },
        })
      ).status,
    ).toBe(200);
  });

  it("KYC VERIFIED/REJECTED need customer.kyc_view (Sales can only mark SUBMITTED)", async () => {
    const cust = await t.request<Customer>("GET", `/api/v1/customers/${cid}`, { token: admin.access_token });
    const denied = await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/kyc`, {
      token: salesA.access_token,
      body: { version: cust.body.version, kyc_status: "VERIFIED" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.details?.["permission"]).toBe("customer.kyc_view");
    const rejectedDenied = await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/kyc`, {
      token: salesA.access_token,
      body: { version: cust.body.version, kyc_status: "REJECTED", kyc_remarks: "blurry scan" },
    });
    expect(rejectedDenied.status).toBe(403);
    await t.app
      .sql`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, uploaded_by, is_sensitive)
      values (${t.companyId}, 'CUSTOMER', ${cid}, 'aadhaar.jpg', 'image/jpeg', 100, 'sha-kyc-adv', 'k/aadhaar-adv.jpg', 'STAFF', ${salesA.user.id}, true)`;
    const submitted = await t.request<Customer>("POST", `/api/v1/customers/${cid}/kyc`, {
      token: salesA.access_token,
      body: { version: cust.body.version, kyc_status: "SUBMITTED" },
    });
    expect(submitted.status, submitted.text).toBe(200);
    const verified = await t.request<Customer & { kyc_verified_by: string }>("POST", `/api/v1/customers/${cid}/kyc`, {
      token: admin.access_token,
      body: { version: submitted.body.version, kyc_status: "VERIFIED" },
    });
    expect(verified.status, verified.text).toBe(200);
    expect(verified.body.kyc_verified_by).toBe(admin.user.id);
  });
});

// ---------------------------------------------------------------------------
// Co-applicants
// ---------------------------------------------------------------------------
describe("co-applicant KYC is encrypted and hashed like the primary applicant's", () => {
  it("inline co-applicants on create: ciphertext + keyed hash at rest, masked in every response, plain only under reveal", async () => {
    const coPan = "COAPP1234Q";
    const coAadhaar = validAadhaar("67890123456");
    const r = await t.request<Customer>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({
        co_applicants: [
          {
            full_name: "Co One",
            relation: "Brother",
            phone: "+91 97000 11111",
            pan: coPan.toLowerCase(),
            aadhaar: `${coAadhaar.slice(0, 4)} ${coAadhaar.slice(4, 8)} ${coAadhaar.slice(8)}`,
          },
        ],
      }),
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body.co_applicants).toHaveLength(1);
    expect(r.body.co_applicants[0]!.pan_masked).toBe("XXXXX1234Q");
    expect(r.body.co_applicants[0]!.aadhaar_masked).toBe(`XXXX XXXX ${coAadhaar.slice(-4)}`);
    expect(r.text).not.toContain(coPan);
    expect(r.text).not.toContain(coAadhaar);
    const [row] = await t.app.sql<
      { pan_enc: string; pan_hash: string; aadhaar_enc: string; aadhaar_last4: string; phone: string }[]
    >`select pan_enc, pan_hash, aadhaar_enc, aadhaar_last4, phone from co_applicants where customer_id = ${r.body.id}`;
    expect(row!.pan_enc.startsWith("k1.")).toBe(true);
    expect(row!.pan_enc).not.toContain(coPan);
    expect(row!.pan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.aadhaar_enc.startsWith("k1.")).toBe(true);
    expect(row!.aadhaar_last4).toBe(coAadhaar.slice(-4));
    expect(row!.phone).toBe("9700011111");
    // the create audit snapshot is masked too
    expect(await auditTextFor("customer.create")).not.toContain(coPan);
    expect(await auditTextFor("customer.create")).not.toContain("k1.");
    const revealed = await t.request<{ co_applicants_revealed: { pan: string; aadhaar: string }[] }>(
      "GET",
      `/api/v1/customers/${r.body.id}?reveal=true`,
      { token: admin.access_token },
    );
    expect(revealed.body.co_applicants_revealed[0]).toMatchObject({ pan: coPan, aadhaar: coAadhaar });
    // replacing the set through PATCH keeps known ids, re-encrypts changed identifiers, drops omitted rows
    const caId = r.body.co_applicants[0]!.id;
    const patched = await t.request<Customer>("PATCH", `/api/v1/customers/${r.body.id}`, {
      token: salesA.access_token,
      body: {
        version: 1,
        co_applicants: [
          { id: caId, full_name: "Co One", relation: "Brother", pan: "COTWO5678R" },
          { full_name: "Co Two", relation: "Sister" },
        ],
      },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.co_applicants.map((c) => c.pan_masked)).toEqual(["XXXXX5678R", null]);
    expect(patched.body.co_applicants[0]!.id).toBe(caId);
    expect(await countRows("co_applicants", `customer_id = '${r.body.id}'`)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Erasure
// ---------------------------------------------------------------------------
describe("right to erasure", () => {
  it("anonymises the customer, the portal login and the converted lead; erased customers vanish from search and lists and cannot be edited, restored or re-enabled", async () => {
    const p = phone();
    const lead = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: {
        full_name: "Erase Me",
        phone: p,
        email: "erase@example.com",
        source: "WALK_IN",
        project_id: projectA,
        message: "secret note",
      },
    });
    expect(lead.status, lead.text).toBe(201);
    const conv = await t.request<{ customer_id: string; customer_code: string }>(
      "POST",
      `/api/v1/leads/${lead.body.id}/convert`,
      {
        token: salesA.access_token,
        body: {
          version: 1,
          customer: { full_name: "Erase Me", phone: p, email: "erase@example.com", pan: "ERASE1234M" },
        },
      },
    );
    expect(conv.status, conv.text).toBe(200);
    const cid = conv.body.customer_id;
    const enabled = await t.request<PortalCard>("POST", `/api/v1/customers/${cid}/portal/enable`, {
      token: admin.access_token,
      body: {},
    });
    expect(enabled.status).toBe(200);
    expect(
      (await t.request<{ results: unknown[] }>("GET", `/api/v1/search?q=${p}`, { token: admin.access_token })).body
        .results,
    ).toHaveLength(1);
    const denied = await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/erase`, {
      token: salesA.access_token,
      body: { confirm: "ERASE", reason: "Customer request" },
    });
    expect(denied.status).toBe(403);
    const erased = await t.request<Customer & { erased_at: string | null; email: string | null }>(
      "POST",
      `/api/v1/customers/${cid}/erase`,
      { token: admin.access_token, body: { confirm: "ERASE", reason: "Customer request under DPDP" } },
    );
    expect(erased.status, erased.text).toBe(200);
    expect(erased.body.erased_at).toBeTruthy();
    expect(erased.body.is_active).toBe(false);
    expect(erased.body.full_name).toBe(`Erased customer ${conv.body.customer_code}`);
    expect(erased.body.phone).not.toBe(p);
    expect(erased.body.email).toBeNull();
    expect(erased.body.pan_masked).toBeNull();
    expect(erased.body.portal_enabled).toBe(false);
    const [pu] = await t.app.sql<
      { phone: string; is_enabled: boolean }[]
    >`select phone, is_enabled from portal_users where customer_id = ${cid}`;
    expect(pu!.phone).not.toBe(p);
    expect(pu!.is_enabled).toBe(false);
    expect(
      (
        await t.request("POST", "/api/v1/portal/auth/login", {
          body: { phone: p, password: enabled.body.temp_password! },
        })
      ).status,
    ).toBe(401);
    const [l] = await t.app.sql<
      { full_name: string; phone: string; email: string | null; message: string | null }[]
    >`select full_name, phone, email, message from leads where id = ${lead.body.id}`;
    expect(l!.phone).not.toBe(p);
    expect(l!.full_name).not.toBe("Erase Me");
    expect(l!.email).toBeNull();
    expect(l!.message).toBeNull();
    // gone from search, lists and duplicate checks
    expect(
      (await t.request<{ results: unknown[] }>("GET", `/api/v1/search?q=${p}`, { token: admin.access_token })).body
        .results,
    ).toEqual([]);
    expect(
      (await t.request<{ results: unknown[] }>("GET", `/api/v1/search?q=Erase%20Me`, { token: admin.access_token }))
        .body.results,
    ).toEqual([]);
    expect(
      (await t.request<{ total: number }>("GET", `/api/v1/customers?search=${p}`, { token: admin.access_token })).body
        .total,
    ).toBe(0);
    expect(
      (
        await t.request<{ total: number }>("GET", `/api/v1/customers?search=Erase&include_inactive=true`, {
          token: admin.access_token,
        })
      ).body.total,
    ).toBe(1);
    expect(
      (
        await t.request<{ matches: unknown[] }>("POST", "/api/v1/customers/duplicate-check", {
          token: salesA.access_token,
          body: { phone: p, pan: "ERASE1234M" },
        })
      ).body.matches,
    ).toEqual([]);
    // frozen: no edits, no restore, no KYC, no portal, no new conversions onto it
    const cust = await t.request<Customer>("GET", `/api/v1/customers/${cid}`, { token: admin.access_token });
    expect(
      (
        await t.request<ErrorBody>("PATCH", `/api/v1/customers/${cid}`, {
          token: admin.access_token,
          body: { version: cust.body.version, notes: "x" },
        })
      ).body.error.details?.["rule"],
    ).toBe("CUSTOMER_ERASED");
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/activate`, {
          token: admin.access_token,
          body: {},
          headers: ifMatch(await versionOf(t, `/api/v1/customers/${cid}`, admin.access_token)),
        })
      ).body.error.details?.["rule"],
    ).toBe("CUSTOMER_ERASED");
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/kyc`, {
          token: admin.access_token,
          body: { version: cust.body.version, kyc_status: "VERIFIED" },
        })
      ).body.error.details?.["rule"],
    ).toBe("CUSTOMER_ERASED");
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/portal/enable`, {
          token: admin.access_token,
          body: {},
        })
      ).body.error.details?.["rule"],
    ).toBe("CUSTOMER_INACTIVE");
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/customers/${cid}/erase`, {
          token: admin.access_token,
          body: { confirm: "ERASE", reason: "again" },
        })
      ).body.error.details?.["rule"],
    ).toBe("ALREADY_ERASED");
    const newLead = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Fresh", phone: phone(), source: "WALK_IN" },
    });
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/leads/${newLead.body.id}/convert`, {
          token: salesA.access_token,
          body: { version: 1, customer_id: cid },
        })
      ).body.error.details?.["rule"],
    ).toBe("CUSTOMER_INACTIVE");
    // the phone and PAN are free for a genuinely new customer, including portal access on that phone
    const fresh = await t.request<Customer>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody({ full_name: "New Owner Of Phone", phone: p, pan: "ERASE1234M" }),
    });
    expect(fresh.status, fresh.text).toBe(201);
    expect(
      (
        await t.request<PortalCard>("POST", `/api/v1/customers/${fresh.body.id}/portal/enable`, {
          token: admin.access_token,
          body: {},
        })
      ).status,
    ).toBe(200);
    // the erase audit row holds the reason, not the PII
    const text = await auditTextFor("customer.erased"); // the single erasure implementation (admin/erase.ts) writes customer.erased
    expect(text).toContain("DPDP");
    expect(text).not.toContain(p);
    expect(text).not.toContain("erase@example.com");
  });
});

// ---------------------------------------------------------------------------
// Round robin, LOST re-open, convert idempotency, unread counts
// ---------------------------------------------------------------------------
describe("lead pipeline edge cases", () => {
  it("round robin skips inactive Sales users and Sales users scoped to other projects, and leaves the lead unassigned when nobody is eligible", async () => {
    const assignedFor = async (projectId: string | null): Promise<string | null> => {
      const r = await t.request<Lead>("POST", "/api/v1/leads", {
        token: admin.access_token,
        body: { full_name: "RR", phone: phone(), source: "CAMPAIGN", ...(projectId ? { project_id: projectId } : {}) },
      });
      expect(r.status, r.text).toBe(201);
      return r.body.assigned_user_id;
    };
    // project A: Chetan (scoped to B) must never receive one; A and B alternate
    const forA = await Promise.all([0, 1, 2, 3].map(() => assignedFor(projectA)));
    expect(forA.every((u) => u === salesA.user.id || u === salesBId)).toBe(true);
    expect(new Set(forA).size).toBe(2);
    // project B: all three are eligible
    const forB: (string | null)[] = [];
    for (let i = 0; i < 6; i++) forB.push(await assignedFor(projectB));
    expect(new Set(forB)).toEqual(new Set([salesA.user.id, salesBId, salesCId]));
    // deactivate B: project A leads all go to A
    await setUserActive(salesBId, false);
    for (let i = 0; i < 3; i++) expect(await assignedFor(projectA)).toBe(salesA.user.id);
    // deactivate A as well: no eligible Sales user for project A → unassigned (Chetan is still active but scoped to B)
    await setUserActive(salesA.user.id, false);
    expect(await assignedFor(projectA)).toBeNull();
    expect(await assignedFor(projectB)).toBe(salesCId);
    await setUserActive(salesCId, false);
    expect(await assignedFor(null)).toBeNull();
    expect(await assignedFor(projectB)).toBeNull();
    await setUserActive(salesA.user.id, true);
    await setUserActive(salesBId, true);
    await setUserActive(salesCId, true);
    salesA = await t.loginAs("sales");
    salesB = await t.login("sales-b@sgb.in", "SalesB@12345");
    await t.login("sales-c@sgb.in", "SalesC@12345");
    // an explicit inactive assignee is refused up front
    await setUserActive(salesCId, false);
    const bad = await t.request<ErrorBody>("POST", "/api/v1/leads", {
      token: admin.access_token,
      body: { full_name: "RR", phone: phone(), source: "CAMPAIGN", assigned_user_id: salesCId },
    });
    expect(bad.status).toBe(400);
    await setUserActive(salesCId, true);
    await t.login("sales-c@sgb.in", "SalesC@12345");
  });

  it("LOST can be re-opened to NEW or CONTACTED only; the lost reason is cleared; follow-ups are refused on closed leads", async () => {
    const lead = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Lost Soul", phone: phone(), source: "BROKER", project_id: projectA },
    });
    const id = lead.body.id;
    const negotiating = await t.request<Lead>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 1, stage: "NEGOTIATION" },
    });
    expect(negotiating.status).toBe(200);
    const lost = await t.request<Lead>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 2, stage: "LOST", lost_reason: "Chose a competitor" },
    });
    expect(lost.status, lost.text).toBe(200);
    expect(lost.body.lost_reason).toBe("Chose a competitor");
    expect(lost.body.previous_stage).toBe("NEGOTIATION");
    const followUp = await t.request<ErrorBody>("POST", `/api/v1/leads/${id}/follow-ups`, {
      token: salesA.access_token,
      body: { note: "nope" },
    });
    expect(followUp.status).toBe(422);
    expect(followUp.body.error.details?.["rule"]).toBe("LEAD_CLOSED");
    for (const stage of ["NEGOTIATION", "SITE_VISIT_DONE", "SITE_VISIT_SCHEDULED", "LOST"]) {
      const r = await t.request<ErrorBody>("POST", `/api/v1/leads/${id}/stage`, {
        token: salesA.access_token,
        body: { version: 3, stage, lost_reason: "x y z" },
      });
      expect(r.status, stage).toBe(422);
      expect(["LEAD_CLOSED", "SAME_STAGE"]).toContain(r.body.error.details?.["rule"]);
    }
    const reopened = await t.request<Lead>("POST", `/api/v1/leads/${id}/stage`, {
      token: salesA.access_token,
      body: { version: 3, stage: "CONTACTED", note: "Came back" },
    });
    expect(reopened.status, reopened.text).toBe(200);
    expect(reopened.body.stage).toBe("CONTACTED");
    expect(reopened.body.lost_reason).toBeNull();
    expect(reopened.body.previous_stage).toBe("LOST");
    expect(reopened.body.version).toBe(4);
    const ok = await t.request("POST", `/api/v1/leads/${id}/follow-ups`, {
      token: salesA.access_token,
      body: { note: "Back in play", next_at: new Date().toISOString() },
    });
    expect(ok.status).toBe(201);
    const detail = await t.request<{ stage_history: { to_stage: string; reason: string | null }[] }>(
      "GET",
      `/api/v1/leads/${id}`,
      { token: salesA.access_token },
    );
    expect(detail.body.stage_history.map((h) => h.to_stage)).toEqual(["CONTACTED", "LOST", "NEGOTIATION", "NEW"]);
    expect(detail.body.stage_history[0]!.reason).toBe("Came back");
    expect(await countRows("audit_logs", `action = 'lead.stage' and entity_id = '${id}'`)).toBe(3);
  });

  it("convert is idempotent for the same customer, refuses another target, and a converted lead cannot move or be re-assigned", async () => {
    const p = phone();
    const lead = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Convert Twice", phone: p, source: "SITE_VISIT", project_id: projectA },
    });
    const first = await t.request<{ customer_id: string; customer_code: string; lead: Lead }>(
      "POST",
      `/api/v1/leads/${lead.body.id}/convert`,
      {
        token: salesA.access_token,
        body: { version: 1, customer: { full_name: "Convert Twice", phone: p }, start_booking: true },
        headers: { "idempotency-key": "conv-1" },
      },
    );
    expect(first.status, first.text).toBe(200);
    expect(first.body.lead.version).toBe(2);
    const replay = await t.request<{ customer_id: string }>("POST", `/api/v1/leads/${lead.body.id}/convert`, {
      token: salesA.access_token,
      body: { version: 1, customer: { full_name: "Convert Twice", phone: p }, start_booking: true },
      headers: { "idempotency-key": "conv-1" },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.customer_id).toBe(first.body.customer_id);
    const same = await t.request<{ customer_id: string; booking_draft_id: string | null }>(
      "POST",
      `/api/v1/leads/${lead.body.id}/convert`,
      { token: salesA.access_token, body: { version: 2, customer_id: first.body.customer_id } },
    );
    expect(same.status, same.text).toBe(200);
    expect(same.body.customer_id).toBe(first.body.customer_id);
    const otherCustomer = await t.request<Customer>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody(),
    });
    const other = await t.request<ErrorBody>("POST", `/api/v1/leads/${lead.body.id}/convert`, {
      token: salesA.access_token,
      body: { version: 2, customer_id: otherCustomer.body.id },
    });
    expect(other.status).toBe(422);
    expect(other.body.error.details?.["rule"]).toBe("LEAD_CLOSED");
    expect(other.body.error.details?.["customer_id"]).toBe(first.body.customer_id);
    const inline = await t.request<ErrorBody>("POST", `/api/v1/leads/${lead.body.id}/convert`, {
      token: salesA.access_token,
      body: { version: 2, customer: { full_name: "Dup", phone: phone() } },
    });
    expect(inline.status).toBe(422);
    expect(await countRows("customers", `phone = '${p}'`)).toBe(1);
    expect(await countRows("lead_stage_history", `lead_id = '${lead.body.id}' and to_stage = 'CONVERTED'`)).toBe(1);
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/leads/${lead.body.id}/stage`, {
          token: salesA.access_token,
          body: { version: 2, stage: "NEW" },
        })
      ).body.error.details?.["rule"],
    ).toBe("LEAD_CLOSED");
    // the converted customer's phone is now taken: converting another lead inline with it → 409 DUPLICATE_CUSTOMER
    const lead2 = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Convert Twice", phone: p, source: "REFERRAL", project_id: projectB },
    });
    const dup = await t.request<ErrorBody>("POST", `/api/v1/leads/${lead2.body.id}/convert`, {
      token: salesA.access_token,
      body: { version: 1, customer: { full_name: "Convert Twice", phone: p } },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_CUSTOMER");
    expect(
      (await t.request<Lead>("GET", `/api/v1/leads/${lead2.body.id}`, { token: salesA.access_token })).body.stage,
    ).toBe("NEW");
  });

  it("enquiry unread counts move exactly with reads, ignore unknown ids and respect project scope; consent is never assumed", async () => {
    const { createEnquiry } = await import("../../src/modules/crm/index.js");
    const base = (
      await t.request<{ unread: number }>("GET", "/api/v1/enquiries/unread-count", { token: admin.access_token })
    ).body.unread;
    const e1 = await t.app.db.transaction((tx) =>
      createEnquiry(tx, {
        companyId: t.companyId,
        name: "Web A",
        phone: phone(),
        projectId: projectA,
        message: "A",
        redis: t.app.redis,
      }),
    );
    const e2 = await t.app.db.transaction((tx) =>
      createEnquiry(tx, {
        companyId: t.companyId,
        name: "Web B",
        phone: phone(),
        projectId: projectB,
        message: "B",
        consent: true,
        redis: t.app.redis,
      }),
    );
    const e3 = await t.app.db.transaction((tx) =>
      createEnquiry(tx, {
        companyId: t.companyId,
        name: "Web None",
        phone: phone(),
        message: "no project",
        redis: t.app.redis,
      }),
    );
    expect(e1.lead.consent).toBe(false);
    expect(e2.lead.consent).toBe(true);
    const unread = () =>
      t
        .request<{ unread: number }>("GET", "/api/v1/enquiries/unread-count", { token: admin.access_token })
        .then((r) => r.body.unread);
    expect(await unread()).toBe(base + 3);
    // scoped PA (project B) sees B and the project-less one only
    const scopedList = await t.request<{ items: { id: string }[]; total: number }>(
      "GET",
      "/api/v1/enquiries?page_size=100",
      { token: scopedPA.access_token },
    );
    expect(scopedList.body.items.map((i) => i.id).sort()).toEqual([e2.enquiry.id, e3.enquiry.id].sort());
    expect(
      (await t.request<{ unread: number }>("GET", "/api/v1/enquiries/unread-count", { token: scopedPA.access_token }))
        .body.unread,
    ).toBe(2);
    expect(
      (await t.request("GET", `/api/v1/enquiries/${e1.enquiry.id}`, { token: scopedPA.access_token })).status,
    ).toBe(404);
    expect(
      (await t.request("POST", `/api/v1/enquiries/${e1.enquiry.id}/read`, { token: scopedPA.access_token, body: {} }))
        .status,
    ).toBe(404);
    const scopedBulk = await t.request<{ updated: number }>("POST", "/api/v1/enquiries/mark-read", {
      token: scopedPA.access_token,
      body: { ids: [e1.enquiry.id, e2.enquiry.id] },
    });
    expect(scopedBulk.body.updated).toBe(1); // only the project-B one
    expect(await unread()).toBe(base + 2);
    const twice = await t.request<{ updated: number }>("POST", "/api/v1/enquiries/mark-read", {
      token: admin.access_token,
      body: { ids: [e2.enquiry.id, e3.enquiry.id, "00000000-0000-4000-8000-000000000000"] },
    });
    expect(twice.body.updated).toBe(1);
    expect(await unread()).toBe(base + 1);
    const unreadAgain = await t.request<{ updated: number }>("POST", "/api/v1/enquiries/mark-read", {
      token: admin.access_token,
      body: { ids: [e2.enquiry.id, e3.enquiry.id], is_read: false },
    });
    expect(unreadAgain.body.updated).toBe(2);
    expect(await unread()).toBe(base + 3);
    // opening an enquiry also clears its lead's unread flag
    expect(
      (await t.request<Lead>("GET", `/api/v1/leads/${e1.lead.id}`, { token: admin.access_token })).body.is_read,
    ).toBe(false);
    expect(
      (await t.request("POST", `/api/v1/enquiries/${e1.enquiry.id}/read`, { token: admin.access_token, body: {} }))
        .status,
    ).toBe(200);
    expect(
      (await t.request<Lead>("GET", `/api/v1/leads/${e1.lead.id}`, { token: admin.access_token })).body.is_read,
    ).toBe(true);
    expect(await unread()).toBe(base + 2);
  });
});

// ---------------------------------------------------------------------------
// Project scope (404, never 403) and permissions
// ---------------------------------------------------------------------------
describe("scope and permissions", () => {
  it("a scoped Project Admin sees only leads of their projects (plus project-less leads) in list/board/due/unread and gets 404 on anything else", async () => {
    const pa = await t.request<Lead>("POST", "/api/v1/leads", {
      token: admin.access_token,
      body: {
        full_name: "Scope A",
        phone: phone(),
        source: "WALK_IN",
        project_id: projectA,
        next_follow_up_at: new Date().toISOString(),
        assigned_user_id: salesA.user.id,
      },
    });
    const pb = await t.request<Lead>("POST", "/api/v1/leads", {
      token: admin.access_token,
      body: { full_name: "Scope B", phone: phone(), source: "WALK_IN", project_id: projectB },
    });
    const pn = await t.request<Lead>("POST", "/api/v1/leads", {
      token: admin.access_token,
      body: { full_name: "Scope None", phone: phone(), source: "WALK_IN" },
    });
    expect([pa.status, pb.status, pn.status]).toEqual([201, 201, 201]);
    const list = await t.request<{ items: Lead[] }>("GET", "/api/v1/leads?page_size=200", {
      token: scopedPA.access_token,
    });
    expect(list.status).toBe(200);
    const ids = list.body.items.map((l) => l.id);
    expect(ids).toContain(pb.body.id);
    expect(ids).toContain(pn.body.id);
    expect(ids).not.toContain(pa.body.id);
    expect(list.body.items.every((l) => l.project_id === null || l.project_id === projectB)).toBe(true);
    const board = await t.request<{ columns: { leads: Lead[]; count: number }[] }>("GET", "/api/v1/leads/board", {
      token: scopedPA.access_token,
    });
    expect(
      board.body.columns.flatMap((c) => c.leads).every((l) => l.project_id === null || l.project_id === projectB),
    ).toBe(true);
    const adminBoard = await t.request<{ columns: { count: number }[] }>("GET", "/api/v1/leads/board", {
      token: admin.access_token,
    });
    expect(board.body.columns.reduce((s, c) => s + c.count, 0)).toBeLessThan(
      adminBoard.body.columns.reduce((s, c) => s + c.count, 0),
    );
    const due = await t.request<{ items: Lead[] }>("GET", "/api/v1/leads/follow-ups/due?all=true", {
      token: scopedPA.access_token,
    });
    expect(due.body.items.map((l) => l.id)).not.toContain(pa.body.id);
    const unreadScoped = (
      await t.request<{ unread: number }>("GET", "/api/v1/leads/unread-count", { token: scopedPA.access_token })
    ).body.unread;
    const unreadAdmin = (
      await t.request<{ unread: number }>("GET", "/api/v1/leads/unread-count", { token: admin.access_token })
    ).body.unread;
    expect(unreadScoped).toBeLessThan(unreadAdmin);
    for (const [method, url, body] of [
      ["GET", `/api/v1/leads/${pa.body.id}`, undefined],
      ["GET", `/api/v1/leads/${pa.body.id}/customer`, undefined],
      ["PATCH", `/api/v1/leads/${pa.body.id}`, { version: 1, message: "peek" }],
      ["POST", `/api/v1/leads/${pa.body.id}/stage`, { version: 1, stage: "CONTACTED" }],
      ["POST", `/api/v1/leads/${pa.body.id}/follow-ups`, { note: "peek" }],
      ["POST", `/api/v1/leads/${pa.body.id}/assign`, { version: 1, assigned_user_id: null }],
      ["POST", `/api/v1/leads/${pa.body.id}/read`, {}],
      ["POST", `/api/v1/leads/${pa.body.id}/convert`, { version: 1, customer: { full_name: "x y", phone: phone() } }],
      ["PATCH", `/api/v1/leads/${pb.body.id}`, { version: 1, project_id: projectA }],
      ["POST", "/api/v1/leads", { full_name: "x y", phone: phone(), source: "WALK_IN", project_id: projectA }],
    ] as const) {
      const r = await t.request<ErrorBody>(method, url, { token: scopedPA.access_token, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${url}: ${r.text}`).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    }
    expect(
      (await t.request<Lead>("GET", `/api/v1/leads/${pa.body.id}`, { token: admin.access_token })).body.stage,
    ).toBe("NEW");
    expect((await t.request("GET", `/api/v1/leads/${pb.body.id}`, { token: scopedPA.access_token })).status).toBe(200);
    expect((await t.request("GET", `/api/v1/leads/${pn.body.id}`, { token: scopedPA.access_token })).status).toBe(200);
  });

  it("every CRM route is permission-guarded, mutations are audited and version-checked", async () => {
    const crm = t.app.routeRegistry.filter((r) => /^\/api\/v1\/(customers|leads|enquiries)/.test(r.url));
    expect(crm.filter((r) => !r.permission).map((r) => `${r.method} ${r.url}`)).toEqual([]);
    const byUrl = new Map(crm.map((r) => [`${r.method} ${r.url}`, r.permission]));
    expect(byUrl.get("POST /api/v1/customers/:id/erase")).toBe("admin.tools");
    expect(byUrl.get("POST /api/v1/customers/:id/portal/enable")).toBe("customer.portal_manage");
    expect(byUrl.get("POST /api/v1/customers/portal/bulk-enable")).toBe("customer.portal_manage");
    expect(byUrl.get("POST /api/v1/customers")).toBe("customer.write");
    expect(byUrl.get("POST /api/v1/leads/:id/convert")).toBe("lead.write");
    // Marketing (lead.read only) may read leads and enquiries but not write; Accounts has none of it
    const marketing = await t.loginAs("marketing");
    const accounts = await t.loginAs("accounts");
    const anyLead = (await t.request<{ items: Lead[] }>("GET", "/api/v1/leads", { token: marketing.access_token })).body
      .items[0]!;
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/leads/${anyLead.id}/stage`, {
          token: marketing.access_token,
          body: { version: anyLead.version, stage: "CONTACTED" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.request<ErrorBody>("POST", "/api/v1/leads", {
          token: marketing.access_token,
          body: { full_name: "x y", phone: phone(), source: "WALK_IN" },
        })
      ).status,
    ).toBe(403);
    expect((await t.request<ErrorBody>("GET", "/api/v1/leads", { token: accounts.access_token })).status).toBe(403);
    expect(
      (await t.request<ErrorBody>("POST", "/api/v1/customers", { token: accounts.access_token, body: customerBody() }))
        .status,
    ).toBe(403);
    expect((await t.request("GET", "/api/v1/customers", { token: accounts.access_token })).status).toBe(200);
    // stale versions on every versioned mutation
    const c = await t.request<Customer>("POST", "/api/v1/customers", {
      token: salesA.access_token,
      body: customerBody(),
    });
    const l = await t.request<Lead>("POST", "/api/v1/leads", {
      token: salesA.access_token,
      body: { full_name: "Versioned", phone: phone(), source: "WALK_IN" },
    });
    for (const [method, url, body] of [
      ["PATCH", `/api/v1/customers/${c.body.id}`, { version: 9, notes: "x" }],
      ["POST", `/api/v1/customers/${c.body.id}/kyc`, { version: 9, kyc_status: "SUBMITTED" }],
      ["POST", `/api/v1/customers/${c.body.id}/deactivate`, { version: 9 }],
      ["PATCH", `/api/v1/leads/${l.body.id}`, { version: 9, message: "x" }],
      ["POST", `/api/v1/leads/${l.body.id}/stage`, { version: 9, stage: "CONTACTED" }],
      ["POST", `/api/v1/leads/${l.body.id}/assign`, { version: 9, assigned_user_id: null }],
      ["POST", `/api/v1/leads/${l.body.id}/convert`, { version: 9, customer_id: c.body.id }],
    ] as const) {
      const r = await t.request<ErrorBody>(method, url, { token: salesA.access_token, body });
      expect(r.status, `${method} ${url}: ${r.text}`).toBe(409);
      expect(r.body.error.code).toBe("VERSION_CONFLICT");
      expect(r.body.error.details?.["current"]).toBe(1);
    }
    // nothing changed and no audit rows were written by the refused attempts
    expect(await countRows("audit_logs", `entity_id = '${l.body.id}'`)).toBe(1); // lead.create only
    expect(await countRows("audit_logs", `entity_id = '${c.body.id}'`)).toBe(1); // customer.create only
    // and every successful mutation leaves exactly one row
    expect(
      (
        await t.request("POST", `/api/v1/leads/${l.body.id}/assign`, {
          token: salesA.access_token,
          body: { version: 1, assigned_user_id: salesBId },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.request("POST", `/api/v1/leads/${l.body.id}/stage`, {
          token: salesA.access_token,
          body: { version: 2, stage: "CONTACTED" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.request("POST", `/api/v1/leads/${l.body.id}/follow-ups`, {
          token: salesA.access_token,
          body: { note: "called" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.request("PATCH", `/api/v1/leads/${l.body.id}`, {
          token: salesA.access_token,
          body: { version: 3, message: "x" },
        })
      ).status,
    ).toBe(200);
    const actions = await t.app.sql<
      { action: string }[]
    >`select action from audit_logs where entity_id = ${l.body.id} order by created_at`;
    expect(actions.map((a) => a.action)).toEqual([
      "lead.create",
      "lead.assign",
      "lead.stage",
      "lead.follow_up",
      "lead.update",
    ]);
  });
});
