import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOB_NAMES } from "@kkt/contracts";
import { nextSequence } from "@kkt/db";
import { financialYear, todayIST } from "@kkt/domain";
import { createPortalCustomer, createProject } from "./fixtures.js";
import { createActiveBooking } from "./fixtures/crm.js";
import { buildTestApp, freshIp, type ErrorBody, type TestContext } from "./helpers.js";
import { startTestWorker, waitFor, waitForExport, waitForRun, type TestWorker } from "./worker.js";

type Settings = {
  id: string;
  name: string;
  version: number;
  fy_start_month: number;
  numbering: Record<string, { prefix: string; format?: string }>;
  settings: {
    demand_due_days: number;
    default_gst_percent: number;
    round_robin_enabled: boolean;
    force_mfa_for_admins: boolean;
    sla_hours: Record<string, number>;
    booking_hold_hours: number;
  };
  numbering_preview: { scope: string; fy: string; last_sequence: number; next_number: string }[];
};
type Backup = {
  id: string;
  status: string;
  run_id: string | null;
  file_name: string | null;
  size_bytes: number | null;
  table_count: number | null;
  row_count: number | null;
  include_sensitive: boolean;
  finished_at: string | null;
  storage_expires_at: string | null;
  error: string | null;
};
type BackupLink = { download_url: string; expires_at: string; file_name: string; size_bytes: number | null };
type JobRun = {
  id: string;
  job_name: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
};
type Mismatch = { booking_id: string; booking_number: string; field: string; stored: number; recomputed: number };

let t: TestContext;
let admin: string;
let accounts: string;
let sales: string;
let ops: string; // custom role holding admin.tools + settings.manage but NOT the Super Admin role
let worker: TestWorker;
const fy = financialYear(todayIST(), 4).label;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  accounts = (await t.loginAs("accounts")).access_token;
  sales = (await t.loginAs("sales")).access_token;
  const role = await t.request<{ id: string }>("POST", "/api/v1/roles", {
    token: admin,
    body: { name: "Ops Tools", permissions: ["dashboard.view", "admin.tools", "settings.manage", "booking.read"] },
  });
  expect(role.status, role.text).toBe(201);
  const user = await t.request<{ id: string }>("POST", "/api/v1/users", {
    token: admin,
    body: {
      name: "Ops Person",
      email: "ops@sgb.in",
      role_id: role.body.id,
      all_projects: true,
      password: "OpsTools@2025",
      must_change_password: false,
    },
  });
  expect(user.status, user.text).toBe(201);
  ops = (await t.login("ops@sgb.in", "OpsTools@2025")).access_token;
  worker = await startTestWorker(t.app);
});
afterAll(async () => {
  await worker?.close();
  await t?.close();
});

async function auditRows(
  action: string,
): Promise<
  { before: Record<string, unknown> | null; after: Record<string, unknown> | null; entity_id: string | null }[]
> {
  return t.app.sql<
    { before: Record<string, unknown> | null; after: Record<string, unknown> | null; entity_id: string | null }[]
  >`select before, after, entity_id from audit_logs where action = ${action} order by created_at`;
}

describe("admin · company settings", () => {
  it("GET needs settings.manage and previews the next number per scope for the current FY (CUST-2526/0001 style)", async () => {
    expect((await t.request("GET", "/api/v1/settings/company", { token: sales })).status).toBe(403);
    const r = await t.request<Settings>("GET", "/api/v1/settings/company", { token: admin });
    expect(r.status, r.text).toBe(200);
    expect(r.body.name).toBe("Shree Ganesh Builders");
    expect(r.body.version).toBe(1);
    expect(r.body.numbering_preview.map((p) => p.scope)).toEqual([
      "customer",
      "booking",
      "demand",
      "receipt",
      "ticket",
      "visit",
    ]);
    const cust = r.body.numbering_preview.find((p) => p.scope === "customer")!;
    expect(cust).toEqual({ scope: "customer", fy, last_sequence: 0, next_number: `CUST-${fy}/0001` });
    expect(cust.next_number).toMatch(/^CUST-\d{4}\/0001$/);
    expect(r.body.numbering_preview.find((p) => p.scope === "receipt")!.next_number).toBe(`SGB/${fy}/0001`);
    // the preview never consumes a number, and follows the sequence once one is allocated
    await nextSequence(t.app.db, t.companyId, "customer", fy);
    const again = await t.request<Settings>("GET", "/api/v1/settings/company", { token: admin });
    expect(again.body.numbering_preview.find((p) => p.scope === "customer")).toMatchObject({
      last_sequence: 1,
      next_number: `CUST-${fy}/0002`,
    });
  });

  it("PATCH honours the version (body or If-Match), audits, invalidates the company cache and re-previews numbering", async () => {
    const { loadCompany } = await import("../../src/lib/company.js");
    const primed = await loadCompany(t.app.db, t.app.redis, t.companyId);
    expect(primed.settings.demand_due_days).toBe(15);
    const current = (await t.request<Settings>("GET", "/api/v1/settings/company", { token: admin })).body;

    const stale = await t.request<ErrorBody>("PATCH", "/api/v1/settings/company", {
      token: admin,
      body: { version: 99, name: "Nope" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(current.version);

    const noVersion = await t.request<ErrorBody>("PATCH", "/api/v1/settings/company", {
      token: admin,
      body: { name: "Nope" },
    });
    expect(noVersion.status).toBe(428);

    const unknown = await t.request<ErrorBody>("PATCH", "/api/v1/settings/company", {
      token: admin,
      body: { version: current.version, bogus: 1 },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("VALIDATION_ERROR");

    const badLogo = await t.request<ErrorBody>("PATCH", "/api/v1/settings/company", {
      token: admin,
      body: { version: current.version, logo_document_id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(badLogo.status).toBe(400);

    const patched = await t.request<Settings>("PATCH", "/api/v1/settings/company", {
      token: admin,
      body: {
        version: current.version,
        numbering: { ...current.numbering, customer: { prefix: "CU-" } },
        settings: { ...current.settings, demand_due_days: 21, booking_hold_hours: 24 },
      },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.version).toBe(current.version + 1);
    expect(patched.body.settings.demand_due_days).toBe(21);
    expect(patched.body.settings.booking_hold_hours).toBe(24);
    expect(patched.body.numbering_preview.find((p) => p.scope === "customer")!.next_number).toBe(`CU-${fy}/0002`);

    const fresh = await loadCompany(t.app.db, t.app.redis, t.companyId);
    expect(fresh.settings.demand_due_days).toBe(21);
    expect(fresh.numbering.customer.prefix).toBe("CU-");

    const viaHeader = await t.request<Settings>("PATCH", "/api/v1/settings/company", {
      token: admin,
      body: { name: "Shree Ganesh Builders Pvt Ltd", letterhead: { tagline: "Homes with heart" } },
      headers: { "if-match": `"${patched.body.version}"` },
    });
    expect(viaHeader.status, viaHeader.text).toBe(200);
    expect(viaHeader.body.name).toBe("Shree Ganesh Builders Pvt Ltd");
    expect(viaHeader.body.version).toBe(patched.body.version + 1);

    const audits = await auditRows("company.update");
    expect(audits).toHaveLength(2);
    expect(audits[0]!.before?.["settings"]).toMatchObject({ demand_due_days: 15 });
    expect(audits[0]!.after?.["settings"]).toMatchObject({ demand_due_days: 21 });
    expect(audits[1]!.after?.["name"]).toBe("Shree Ganesh Builders Pvt Ltd");

    const ok = await t.request<Settings>("PATCH", "/api/v1/settings/company", {
      token: ops,
      body: { version: viaHeader.body.version, numbering: { ...current.numbering } },
    });
    expect(ok.status, ok.text).toBe(200); // settings.manage is enough for settings (no Super Admin requirement)
  });
});

describe("admin · backup", () => {
  let first: Backup;
  let firstLink: BackupLink;
  let zipFile: string;

  async function download(url: string): Promise<{ status: number; headers: Record<string, unknown>; bytes: Buffer }> {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const res = await t.app.inject({ method: "GET", url: path, headers: { "x-forwarded-for": freshIp() } });
    return { status: res.statusCode, headers: res.headers as Record<string, unknown>, bytes: res.rawPayload };
  }

  async function finished(id: string): Promise<Backup> {
    await waitForExport(t.app, id, 120_000);
    const list = await t.request<{ items: Backup[] }>("GET", "/api/v1/admin/backups", { token: admin });
    return list.body.items.find((i) => i.id === id)!;
  }

  it("Accounts (no admin.tools) → 403 FORBIDDEN; admin.tools without the Super Admin role → 403 SUPER_ADMIN_ONLY", async () => {
    const a = await t.request<ErrorBody>("POST", "/api/v1/admin/backup", { token: accounts, body: {} });
    expect(a.status).toBe(403);
    expect(a.body.error.code).toBe("FORBIDDEN");
    const o = await t.request<ErrorBody>("POST", "/api/v1/admin/backup", { token: ops, body: {} });
    expect(o.status).toBe(403);
    expect(o.body.error.code).toBe("SUPER_ADMIN_ONLY");
    const l = await t.request<ErrorBody>("GET", "/api/v1/admin/backups", { token: ops });
    expect(l.status).toBe(403);
    expect(l.body.error.code).toBe("SUPER_ADMIN_ONLY");
  });

  it("Super Admin queues BACKUP_EXPORT (202); the worker streams a ZIP with manifest, RESTORE.md and one NDJSON per table; sensitive columns stripped; `unzip -t` passes", async () => {
    await t.app
      .sql`insert into customers (company_id, customer_code, full_name, phone, pan_enc, pan_hash, pan_last4) values (${t.companyId}, 'CUST-BK01', 'Backup Subject', '9876500001', 'k1.iv.tag.ct', 'hash', '234F')`;
    const { backupTables, readZipEntries, readZipText } = await import("../../src/modules/admin/index.js");
    const tables = backupTables();
    expect(tables.length).toBeGreaterThanOrEqual(77);

    const r = await t.request<Backup>("POST", "/api/v1/admin/backup", {
      token: admin,
      body: {},
      headers: { "idempotency-key": "bk-1" },
    });
    expect(r.status, r.text).toBe(202);
    expect(r.body).toMatchObject({
      status: "QUEUED",
      include_sensitive: false,
      file_name: null,
      generated_by: expect.any(String),
    });
    expect(r.body.run_id).toMatch(/^[0-9a-f-]{36}$/);
    const replay = await t.request<Backup>("POST", "/api/v1/admin/backup", {
      token: admin,
      body: {},
      headers: { "idempotency-key": "bk-1" },
    });
    expect(replay.status).toBe(202);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.id).toBe(r.body.id);

    first = await finished(r.body.id);
    expect(first.status, first.error ?? "").toBe("DONE");
    expect(first.table_count).toBe(tables.length);
    expect(first.file_name).toMatch(/^kkt-backup-\d{8}-\d{6}Z-[0-9a-f]{8}\.zip$/);
    expect(new Date(first.storage_expires_at!).getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
    const run = await waitForRun(t.app, r.body.run_id!);
    expect(run).toMatchObject({ job_name: "BACKUP_EXPORT", status: "OK" });

    const link = await t.request<BackupLink>("POST", `/api/v1/admin/backups/${first.id}/link`, { token: admin });
    expect(link.status, link.text).toBe(200);
    firstLink = link.body;
    expect(firstLink.download_url).toContain("/api/v1/admin/backups/download/");
    expect(new Date(firstLink.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000 + 2000);
    expect((await t.request<ErrorBody>("POST", `/api/v1/admin/backups/${first.id}/link`, { token: ops })).status).toBe(
      403,
    );

    const dl = await download(firstLink.download_url);
    expect(dl.status).toBe(200);
    expect(String(dl.headers["content-type"])).toContain("application/zip");
    expect(String(dl.headers["content-disposition"])).toContain(first.file_name!);
    expect(dl.bytes.length).toBe(first.size_bytes);
    expect(dl.bytes.subarray(0, 4).toString("hex")).toBe("504b0304");

    zipFile = join(mkdtempSync(join(tmpdir(), "kkt-backup-")), first.file_name!);
    writeFileSync(zipFile, dl.bytes);
    try {
      expect(execFileSync("unzip", ["-t", zipFile], { encoding: "utf8" })).toContain("No errors detected");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    const names = (await readZipEntries(zipFile)).map((e) => e.name);
    // + manifest.json, manifest.sig (HMAC of the manifest under LINK_SIGNING_KEYS), RESTORE.md
    expect(names).toHaveLength(tables.length + 3);
    expect(names).toEqual(expect.arrayContaining(["manifest.json", "manifest.sig", "RESTORE.md"]));
    for (const tbl of tables) expect(names).toContain(`tables/${tbl.name}.ndjson`);
    const manifest = JSON.parse(await readZipText(zipFile, "manifest.json")) as {
      format: string;
      include_sensitive: boolean;
      table_count: number;
      row_count: number;
      tables: { name: string; rows: number; stripped_columns: string[] }[];
    };
    expect(manifest.format).toBe("kkt-backup/3");
    expect(manifest.include_sensitive).toBe(false);
    expect(manifest.table_count).toBe(tables.length);
    expect(manifest.row_count).toBe(first.row_count);
    expect(manifest.tables.find((x) => x.name === "users")!.stripped_columns).toEqual(
      expect.arrayContaining(["password_hash", "mfa_secret_enc", "mfa_pending_secret_enc"]),
    );
    expect(manifest.tables.find((x) => x.name === "refresh_tokens")!.stripped_columns).toContain("token_hash");
    expect(manifest.tables.find((x) => x.name === "customers")!.stripped_columns).toEqual(
      expect.arrayContaining(["pan_enc", "aadhaar_enc"]),
    );
    const ndjson = async (table: string) =>
      (await readZipText(zipFile, `tables/${table}.ndjson`))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    const users = await ndjson("users");
    expect(users.length).toBeGreaterThanOrEqual(6);
    for (const u of users) {
      expect(u).not.toHaveProperty("password_hash");
      expect(u).toHaveProperty("email");
      expect(u).toHaveProperty("role_id");
    }
    const subject = (await ndjson("customers")).find((c) => c["customer_code"] === "CUST-BK01")!;
    expect(subject).toBeDefined();
    expect(subject).not.toHaveProperty("pan_enc");
    expect(subject["pan_last4"]).toBe("234F");
    const restoreMd = await readZipText(zipFile, "RESTORE.md");
    expect(restoreMd).toContain("Restoring a KKT backup");
    expect(restoreMd).toContain("pnpm --filter @kkt/api restore");
    expect(restoreMd).not.toContain("session_replication_role");

    const audits = await auditRows("backup.export");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ backup_id: first.id, include_sensitive: false });
    const [bell] = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from notifications where type = 'EXPORT_READY' and entity_id = ${first.id}`;
    expect(bell!.n).toBe(1);
  });

  it("a backup that is not finished has no link (409 EXPORT_NOT_READY); another company's backup is 404", async () => {
    const [queued] = await t.app.sql<
      { id: string }[]
    >`insert into exports (company_id, user_id, path, query, status) select ${t.companyId}, id, 'admin:backup', '{"kind":"backup","include_sensitive":false}'::jsonb, 'RUNNING' from users where email = 'admin@sgb.in' returning id`;
    const r = await t.request<ErrorBody>("POST", `/api/v1/admin/backups/${queued!.id}/link`, { token: admin });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("EXPORT_NOT_READY");
    await t.app.sql`delete from exports where id = ${queued!.id}`;
    expect(
      (await t.request("POST", "/api/v1/admin/backups/11111111-1111-4111-8111-111111111111/link", { token: admin }))
        .status,
    ).toBe(404);
  });

  it("include_sensitive keeps the encrypted/hashed columns; the list shows both backups newest first with their status", async () => {
    const r = await t.request<Backup>("POST", "/api/v1/admin/backup", {
      token: admin,
      body: { include_sensitive: true },
    });
    expect(r.status, r.text).toBe(202);
    const done = await finished(r.body.id);
    expect(done).toMatchObject({ status: "DONE", include_sensitive: true });
    const link = await t.request<BackupLink>("POST", `/api/v1/admin/backups/${done.id}/link`, { token: admin });
    const dl = await download(link.body.download_url);
    expect(dl.status).toBe(200);
    const file = join(mkdtempSync(join(tmpdir(), "kkt-backup-")), "sens.zip");
    writeFileSync(file, dl.bytes);
    const { readZipText } = await import("../../src/modules/admin/index.js");
    const ndjson = async (table: string) =>
      (await readZipText(file, `tables/${table}.ndjson`))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(
      (await ndjson("users")).every(
        (u) => typeof u["password_hash"] === "string" && (u["password_hash"] as string).startsWith("$argon2"),
      ),
    ).toBe(true);
    expect((await ndjson("customers")).find((c) => c["customer_code"] === "CUST-BK01")!["pan_enc"]).toBe(
      "k1.iv.tag.ct",
    );
    const manifest = JSON.parse(await readZipText(file, "manifest.json")) as {
      tables: { name: string; stripped_columns: string[] }[];
    };
    expect(manifest.tables.every((x) => x.stripped_columns.length === 0)).toBe(true);

    const list = await t.request<{ items: Backup[] }>("GET", "/api/v1/admin/backups", { token: admin });
    expect(list.status).toBe(200);
    expect(list.body.items.map((i) => i.id)).toEqual([r.body.id, first.id]);
    expect(list.body.items[1]).toMatchObject({
      status: "DONE",
      file_name: first.file_name,
      size_bytes: first.size_bytes,
      include_sensitive: false,
    });
  });

  it("download links are signed: a forged, expired, unknown or storage-expired token is 404; the fresh link still works", async () => {
    const forged = `${firstLink.download_url.slice(0, -2)}xx`;
    expect((await download(forged)).status).toBe(404);
    const { signBackupToken } = await import("../../src/modules/admin/index.js");
    const now = Math.floor(Date.now() / 1000);
    // the same link 15 minutes later
    expect((await download(`/api/v1/admin/backups/download/${signBackupToken(first.id, now - 1)}`)).status).toBe(404);
    // a valid signature for a backup that does not exist
    expect(
      (
        await download(
          `/api/v1/admin/backups/download/${signBackupToken("11111111-1111-4111-8111-111111111111", now + 60)}`,
        )
      ).status,
    ).toBe(404);
    // tampered body with the original signature
    const [body, sig] = firstLink.download_url.split("/").at(-1)!.split(".");
    const tampered = `${body!.slice(0, 5)}${body![5] === "A" ? "B" : "A"}${body!.slice(6)}.${sig}`;
    expect((await download(`/api/v1/admin/backups/download/${tampered}`)).status).toBe(404);
    expect((await download(firstLink.download_url)).status).toBe(200);
    // storage TTL (24 h): once the backup has expired the archive is gone even with a fresh signature
    await t.app.sql`update exports set expires_at = now() - interval '1 second' where id = ${first.id}`;
    expect((await download(firstLink.download_url)).status).toBe(404);
    expect((await t.request("POST", `/api/v1/admin/backups/${first.id}/link`, { token: admin })).status).toBe(404);
  });
});

describe("admin · right to erasure", () => {
  const phone = "9876543230";
  let projectId: string;
  let customerId: string;
  let bookingId: string;
  let docKey: string;
  let coApplicantId: string;

  beforeAll(async () => {
    projectId = await createProject(t, "Erase Project", "ERP");
    const c = await createPortalCustomer(t, { phone, name: "Erase Me Kumar" });
    customerId = c.customerId;
    await t.app
      .sql`update customers set email = 'erase@example.com', pan_enc = 'k1.a.b.c', pan_hash = 'h', pan_last4 = '1234', aadhaar_enc = 'k1.d.e.f', aadhaar_hash = 'ah', aadhaar_last4 = '5678',
      address_current = '{"line1":"12 Lane","city":"Patna","state":"Bihar","pincode":"800001"}'::jsonb, bank = '{"bank_name":"HDFC","ifsc":"HDFC0000001","holder_name":"Erase Me","account_enc":"k1.x","account_last4":"9999"}'::jsonb,
      nominee = '{"name":"Nominee","relation":"Wife"}'::jsonb, notes = 'vip', tags = '{vip}' where id = ${customerId}`;
    const [ca] = await t.app.sql<
      { id: string }[]
    >`insert into co_applicants (company_id, customer_id, full_name, relation, phone, email, pan_enc, pan_last4) values (${t.companyId}, ${customerId}, 'Spouse Kumar', 'Wife', '9876543231', 'spouse@example.com', 'k1.s.p.o', '4321') returning id`;
    coApplicantId = ca!.id;
    docKey = `documents/test/erase-${customerId.slice(0, 8)}.pdf`;
    const { createStorage } = await import("../../src/lib/storage.js");
    await createStorage().put(docKey, Buffer.from("%PDF-1.4 fake"), "application/pdf");
    await t.app
      .sql`insert into documents (company_id, entity_type, entity_id, file_name, mime, size_bytes, sha256, storage_key, uploaded_by_type, is_sensitive) values (${t.companyId}, 'CUSTOMER', ${customerId}, 'pan.pdf', 'application/pdf', 13, 'deadbeef', ${docKey}, 'STAFF', true)`;
    await t.app
      .sql`insert into leads (company_id, lead_number, full_name, phone, email, message, customer_id, stage) values (${t.companyId}, 'LD-ERASE/0001', 'Erase Me Kumar', ${phone}, 'erase@example.com', 'Looking for 3BHK', ${customerId}, 'CONVERTED')`;
    bookingId = (await createActiveBooking(t, customerId, projectId)).bookingId;
  });

  it("is refused while the customer is on an ACTIVE booking (primary or co-applicant) → 409 HAS_ACTIVE_BOOKING", async () => {
    const r = await t.request<ErrorBody>("POST", `/api/v1/admin/customers/${customerId}/erase`, {
      token: admin,
      body: { confirm: "ERASE" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("HAS_ACTIVE_BOOKING");
    const other = await createPortalCustomer(t, { phone: "9876543232", name: "Co Applicant" });
    const primary = await createPortalCustomer(t, { phone: "9876543233", name: "Primary Buyer" });
    await createActiveBooking(t, primary.customerId, projectId, { coApplicantId: other.customerId });
    const asCo = await t.request<ErrorBody>("POST", `/api/v1/admin/customers/${other.customerId}/erase`, {
      token: admin,
      body: { confirm: "ERASE" },
    });
    expect(asCo.status).toBe(409);
    expect(asCo.body.error.code).toBe("HAS_ACTIVE_BOOKING");
    const [row] = await t.app.sql<
      { erased_at: string | null; full_name: string }[]
    >`select erased_at, full_name from customers where id = ${customerId}`;
    expect(row!.erased_at).toBeNull();
    expect(row!.full_name).toBe("Erase Me Kumar");
  });

  it("guards: wrong confirm → 400; Accounts → 403 FORBIDDEN; admin.tools without Super Admin → 403 SUPER_ADMIN_ONLY; unknown → 404", async () => {
    expect(
      (
        await t.request("POST", `/api/v1/admin/customers/${customerId}/erase`, {
          token: admin,
          body: { confirm: "erase" },
        })
      ).status,
    ).toBe(400);
    const a = await t.request<ErrorBody>("POST", `/api/v1/admin/customers/${customerId}/erase`, {
      token: accounts,
      body: { confirm: "ERASE" },
    });
    expect(a.status).toBe(403);
    expect(a.body.error.code).toBe("FORBIDDEN");
    const o = await t.request<ErrorBody>("POST", `/api/v1/admin/customers/${customerId}/erase`, {
      token: ops,
      body: { confirm: "ERASE" },
    });
    expect(o.status).toBe(403);
    expect(o.body.error.code).toBe("SUPER_ADMIN_ONLY");
    expect(
      (
        await t.request("POST", "/api/v1/admin/customers/11111111-1111-4111-8111-111111111111/erase", {
          token: admin,
          body: { confirm: "ERASE" },
        })
      ).status,
    ).toBe(404);
  });

  it("succeeds once the booking is no longer ACTIVE: PII gone everywhere, portal shut, documents removed, payments and bookings intact, audited", async () => {
    await t.app.sql`update bookings set status = 'CANCELLED' where id = ${bookingId}`;
    const [mode] = await t.app.sql<
      { id: string }[]
    >`insert into payment_modes (company_id, name, code, is_cash) values (${t.companyId}, 'Cash', 'CASH', true) returning id`;
    const [b] = await t.app.sql<{ block_id: string }[]>`select block_id from bookings where id = ${bookingId}`;
    await t.app
      .sql`insert into payments (company_id, booking_id, project_id, block_id, customer_id, receipt_number, against, bucket, amount_paise, payment_date, payment_mode_id, mode_code, status, cleared_at)
      values (${t.companyId}, ${bookingId}, ${projectId}, ${b!.block_id}, ${customerId}, 'SGB/ERASE/0001', 'FLAT_VALUE', 'CASH', 500000, current_date, ${mode!.id}, 'CASH', 'CLEARED', now())`;
    const portalBefore = await t.request<{ access_token: string }>("POST", "/api/v1/portal/auth/login", {
      body: { phone, password: "Welcome@123" },
    });
    expect(portalBefore.status, portalBefore.text).toBe(200);
    const { createStorage } = await import("../../src/lib/storage.js");
    expect(await createStorage().exists(docKey)).toBe(true);

    const r = await t.request<{
      id: string;
      customer_code: string;
      full_name: string;
      erased_at: string;
      version: number;
      anonymised: Record<string, unknown>;
      financial_rows_kept: { bookings: number; payments: number };
    }>("POST", `/api/v1/admin/customers/${customerId}/erase`, {
      token: admin,
      body: { confirm: "ERASE", reason: "Customer requested erasure under DPDP" },
      headers: { "idempotency-key": "erase-1" },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.customer_code).toBe("CUST-3230");
    expect(r.body.full_name).toBe("Erased customer CUST-3230");
    expect(r.body.anonymised).toEqual({
      co_applicants: 1,
      documents: 1,
      leads: 1,
      site_visits: 0,
      enquiries: 0,
      testimonials: 0,
      portal_disabled: true,
      sessions_revoked: 1,
      booking_drafts: 0,
      notifications: 0,
      service_requests: 0,
      exports_removed: 0,
      storage_deletions_queued: 1,
    });
    expect(r.body.financial_rows_kept).toEqual({ bookings: 1, payments: 1, demands: 0, ledger_entries: 0 });
    // the document's bytes were queued for deletion in the erasure transaction and removed right after (marked done)
    const queued = await t.app.sql<
      { key: string; reason: string; done: boolean }[]
    >`select key, reason, done_at is not null as done from storage_deletions where key = ${docKey}`;
    expect(queued).toEqual([{ key: docKey, reason: "CUSTOMER_ERASED", done: true }]);

    const [c] = await t.app.sql<Record<string, unknown>[]>`select * from customers where id = ${customerId}`;
    expect(c!["full_name"]).toBe("Erased customer CUST-3230");
    expect(c!["phone"]).not.toBe(phone);
    expect(String(c!["phone"])).toMatch(/^0\d{9}$/);
    for (const k of [
      "email",
      "pan_enc",
      "pan_hash",
      "pan_last4",
      "aadhaar_enc",
      "aadhaar_hash",
      "aadhaar_last4",
      "address_current",
      "bank",
      "nominee",
      "notes",
      "dob",
      "father_or_spouse_name",
    ])
      expect(c![k], k).toBeNull();
    expect(c!["tags"]).toEqual([]);
    expect(c!["is_active"]).toBe(false);
    expect(c!["erased_at"]).not.toBeNull();
    expect(c!["version"]).toBe(r.body.version);

    const [ca] = await t.app.sql<Record<string, unknown>[]>`select * from co_applicants where id = ${coApplicantId}`;
    expect(ca!["full_name"]).toBe("Erased co-applicant");
    for (const k of ["phone", "email", "pan_enc", "pan_last4"]) expect(ca![k], k).toBeNull();

    const [pu] = await t.app.sql<
      { is_enabled: boolean; phone: string }[]
    >`select is_enabled, phone from portal_users where customer_id = ${customerId}`;
    expect(pu!.is_enabled).toBe(false);
    expect(pu!.phone).toBe(c!["phone"]);
    const portalAfter = await t.request<ErrorBody>("POST", "/api/v1/portal/auth/login", {
      body: { phone, password: "Welcome@123" },
    });
    expect(portalAfter.status).toBe(401);
    const [tok] = await t.app.sql<
      { live: number }[]
    >`select count(*)::int as live from refresh_tokens rt join portal_users p on p.id = rt.subject_id where p.customer_id = ${customerId} and rt.revoked_at is null`;
    expect(tok!.live).toBe(0);

    const [doc] = await t.app.sql<
      { is_deleted: boolean }[]
    >`select is_deleted from documents where entity_type = 'CUSTOMER' and entity_id = ${customerId}`;
    expect(doc!.is_deleted).toBe(true);
    expect(await createStorage().exists(docKey)).toBe(false);

    const [lead] = await t.app.sql<
      { full_name: string; email: string | null; message: string | null; phone: string }[]
    >`select full_name, email, message, phone from leads where customer_id = ${customerId}`;
    expect(lead).toMatchObject({
      full_name: "Erased customer CUST-3230",
      email: null,
      message: null,
      phone: c!["phone"],
    });

    const [pay] = await t.app.sql<
      { customer_id: string; amount_paise: string | number; status: string }[]
    >`select customer_id, amount_paise, status from payments where booking_id = ${bookingId}`;
    expect(pay).toMatchObject({ customer_id: customerId, status: "CLEARED" });
    expect(Number(pay!.amount_paise)).toBe(500000);
    const [bk] = await t.app.sql<
      { customer_id: string; status: string; agreement_value_paise: string | number }[]
    >`select customer_id, status, agreement_value_paise from bookings where id = ${bookingId}`;
    expect(bk).toMatchObject({ customer_id: customerId, status: "CANCELLED" });
    expect(Number(bk!.agreement_value_paise)).toBe(650000000);

    const audits = await auditRows("customer.erased");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.entity_id).toBe(customerId);
    expect(audits[0]!.after).toMatchObject({
      reason: "Customer requested erasure under DPDP",
      documents_removed: 1,
      portal_disabled: true,
    });
    expect(JSON.stringify(audits[0])).not.toContain("Erase Me");
    expect(JSON.stringify(audits[0])).not.toContain(phone);

    const replay = await t.request<{ id: string }>("POST", `/api/v1/admin/customers/${customerId}/erase`, {
      token: admin,
      body: { confirm: "ERASE", reason: "Customer requested erasure under DPDP" },
      headers: { "idempotency-key": "erase-1" },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    const again = await t.request<ErrorBody>("POST", `/api/v1/admin/customers/${customerId}/erase`, {
      token: admin,
      body: { confirm: "ERASE" },
    });
    expect(again.status).toBe(422);
    expect(again.body.error.details?.["rule"]).toBe("ALREADY_ERASED");
  });
});

describe("admin · recompute / reconcile", () => {
  let projectId: string;
  let bookingId: string;

  beforeAll(async () => {
    projectId = await createProject(t, "Recompute Project", "RCP");
    const c = await createPortalCustomer(t, { phone: "9876543240", name: "Ledger Owner" });
    bookingId = (await createActiveBooking(t, c.customerId, projectId)).bookingId;
  });

  it("reports zero mismatches on consistent data and validates its scope", async () => {
    const dry = await t.request<{ bookings_checked: number; bookings_with_mismatches: number; mismatches: Mismatch[] }>(
      "POST",
      "/api/v1/admin/reconcile",
      { token: admin, body: { project_id: projectId } },
    );
    expect(dry.status, dry.text).toBe(200);
    expect(dry.body).toEqual({ bookings_checked: 1, bookings_with_mismatches: 0, mismatches: [] });
    const re = await t.request<{
      bookings_rebuilt: number;
      ledger_rows_rewritten: number;
      mismatches_found: Mismatch[];
    }>("POST", "/api/v1/admin/recompute", { token: admin, body: { booking_id: bookingId } });
    expect(re.status, re.text).toBe(200);
    expect(re.body).toEqual({ bookings_rebuilt: 1, ledger_rows_rewritten: 0, mismatches_found: [] });
    const empty = await t.request<ErrorBody>("POST", "/api/v1/admin/recompute", { token: admin, body: {} });
    expect(empty.status).toBe(400);
    expect(
      (
        await t.request("POST", "/api/v1/admin/recompute", {
          token: admin,
          body: { booking_id: "11111111-1111-4111-8111-111111111111" },
        })
      ).status,
    ).toBe(404);
    expect((await t.request("POST", "/api/v1/admin/recompute", { token: sales, body: { all: true } })).status).toBe(
      403,
    );
    // a project-scoped user with admin.tools cannot even learn that another project exists (404, never 403)
    const otherProject = await createProject(t, "Other Project", "OTH");
    const roleId = (
      await t.request<{ items: { id: string; name: string }[] }>("GET", "/api/v1/roles", { token: admin })
    ).body.items.find((r) => r.name === "Ops Tools")!.id;
    const scoped = await t.request<{ id: string }>("POST", "/api/v1/users", {
      token: admin,
      body: {
        name: "Scoped Ops",
        email: "ops-scoped@sgb.in",
        role_id: roleId,
        all_projects: false,
        project_ids: [otherProject],
        password: "OpsTools@2025",
        must_change_password: false,
      },
    });
    expect(scoped.status, scoped.text).toBe(201);
    const scopedToken = (await t.login("ops-scoped@sgb.in", "OpsTools@2025")).access_token;
    expect(
      (await t.request("POST", "/api/v1/admin/recompute", { token: scopedToken, body: { project_id: projectId } }))
        .status,
    ).toBe(404);
    expect(
      (await t.request("POST", "/api/v1/admin/recompute", { token: scopedToken, body: { booking_id: bookingId } }))
        .status,
    ).toBe(404);
    const scopedAll = await t.request<{ bookings_rebuilt: number }>("POST", "/api/v1/admin/recompute", {
      token: scopedToken,
      body: { all: true },
    });
    expect(scopedAll.status, scopedAll.text).toBe(200);
    expect(scopedAll.body.bookings_rebuilt).toBe(0); // nothing in their scope
  });

  it("reconcile only reports a manufactured summary drift; recompute fixes it and lists what changed", async () => {
    await t.app
      .sql`update bookings set cash_paid_paise = 500, account_order_raised_paise = 700 where id = ${bookingId}`;
    const dry = await t.request<{ bookings_checked: number; bookings_with_mismatches: number; mismatches: Mismatch[] }>(
      "POST",
      "/api/v1/admin/reconcile",
      { token: ops, body: { booking_id: bookingId } },
    );
    expect(dry.status, dry.text).toBe(200);
    expect(dry.body.bookings_with_mismatches).toBe(1);
    expect(dry.body.mismatches.map((m) => [m.field, m.stored, m.recomputed]).sort()).toEqual([
      ["account_order_raised_paise", 700, 0],
      ["cash_paid_paise", 500, 0],
    ]);
    const [still] = await t.app.sql<
      { cash_paid_paise: string | number }[]
    >`select cash_paid_paise from bookings where id = ${bookingId}`;
    expect(Number(still!.cash_paid_paise)).toBe(500); // dry run wrote nothing

    const fixed = await t.request<{
      bookings_rebuilt: number;
      ledger_rows_rewritten: number;
      mismatches_found: Mismatch[];
    }>("POST", "/api/v1/admin/recompute", { token: admin, body: { project_id: projectId } });
    expect(fixed.status, fixed.text).toBe(200);
    expect(fixed.body.bookings_rebuilt).toBe(1);
    expect(fixed.body.mismatches_found).toHaveLength(2);
    expect(fixed.body.mismatches_found[0]).toMatchObject({
      booking_id: bookingId,
      booking_number: expect.stringMatching(/^BK-TEST\//),
    });
    const [after] = await t.app.sql<
      { cash_paid_paise: string | number; account_order_raised_paise: string | number }[]
    >`select cash_paid_paise, account_order_raised_paise from bookings where id = ${bookingId}`;
    expect(Number(after!.cash_paid_paise)).toBe(0);
    expect(Number(after!.account_order_raised_paise)).toBe(0);
    const clean = await t.request<{ mismatches: Mismatch[] }>("POST", "/api/v1/admin/reconcile", {
      token: admin,
      body: { all: true },
    });
    expect(clean.body.mismatches.filter((m) => m.booking_id === bookingId)).toEqual([]);
    const audits = await auditRows("admin.recompute");
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.at(-1)!.after).toMatchObject({ bookings_rebuilt: 1, mismatches_fixed: 2 });
  });
});

describe("admin · jobs", () => {
  type JobInfo = {
    name: string;
    registered: boolean;
    cron: string | null;
    schedule_enabled: boolean;
    last_run: JobRun | null;
    last_success: JobRun | null;
    failure_count_24h: number;
    failures_since_success: number;
    next_run_at: string | null;
  };
  it("lists every job with handler/schedule state, last run, last success, failure counts and next run; run-now enqueues (202) and the worker records job_runs", async () => {
    const list = await t.request<{ jobs: JobInfo[]; recent_runs: JobRun[]; links: Record<string, string> }>(
      "GET",
      "/api/v1/admin/jobs",
      { token: admin },
    );
    expect(list.status, list.text).toBe(200);
    expect(list.body.jobs.map((j) => j.name).sort()).toEqual([...JOB_NAMES].sort());
    const recon = list.body.jobs.find((j) => j.name === "STARTUP_RECONCILIATION")!;
    expect(recon).toMatchObject({
      registered: true,
      last_run: null,
      last_success: null,
      failure_count_24h: 0,
      failures_since_success: 0,
    });
    expect(list.body.jobs.find((j) => j.name === "DAILY_DUES")!.cron).toBe("30 0 * * *");
    expect(list.body.jobs.find((j) => j.name === "PARTITION_MAINTENANCE")).toMatchObject({
      registered: true,
      schedule_enabled: false,
      next_run_at: null,
    });
    for (const name of ["NOTIFICATION_SWEEP", "IDEMPOTENCY_PURGE", "EXPORT_CSV", "EXPORT_CLEANUP", "BACKUP_EXPORT"])
      expect(list.body.jobs.find((j) => j.name === name)!.registered, name).toBe(true);
    expect(list.body.links["run_dues_now"]).toBe("/api/v1/dues/run");
    expect((await t.request("GET", "/api/v1/admin/jobs", { token: sales })).status).toBe(403);

    const run = await t.request<{
      run_id: string;
      job_id: string;
      job_name: string;
      status: string;
      queued_at: string;
    }>("POST", "/api/v1/admin/jobs/STARTUP_RECONCILIATION/run", { token: admin, body: {} });
    expect(run.status, run.text).toBe(202);
    expect(run.body).toMatchObject({ job_name: "STARTUP_RECONCILIATION", status: "QUEUED" });
    const done = await waitForRun(t.app, run.body.run_id);
    expect(done).toMatchObject({ status: "OK", error: null });
    // stored per company (audit B): the raw job_runs row keeps every tenant's findings apart …
    expect(done.result).toMatchObject({
      companies: 1,
      by_company: { [t.companyId]: { bookings_checked: expect.any(Number) } },
    });
    const one = await t.request<JobRun>("GET", `/api/v1/admin/jobs/runs/${run.body.run_id}`, { token: admin });
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: run.body.run_id, status: "OK" });
    // … and the API shows a tenant admin only their own company's slice, flattened
    expect(one.body.result).toMatchObject({ companies: 1, bookings_checked: expect.any(Number) });
    expect(one.body.result).not.toHaveProperty("by_company");
    expect(
      (await t.request("GET", "/api/v1/admin/jobs/runs/11111111-1111-4111-8111-111111111111", { token: admin })).status,
    ).toBe(404);

    const after = await t.request<{ jobs: JobInfo[]; recent_runs: JobRun[] }>("GET", "/api/v1/admin/jobs", {
      token: admin,
    });
    const reconAfter = after.body.jobs.find((j) => j.name === "STARTUP_RECONCILIATION")!;
    expect(reconAfter.last_run?.id).toBe(run.body.run_id);
    expect(reconAfter.last_success?.id).toBe(run.body.run_id);

    const runs = await t.request<{ items: JobRun[]; total: number }>(
      "GET",
      "/api/v1/admin/jobs/runs?job_name=STARTUP_RECONCILIATION&status=OK",
      { token: admin },
    );
    expect(runs.status, runs.text).toBe(200);
    expect(runs.body.total).toBe(1);
    const csv = await t.request("GET", "/api/v1/admin/jobs/runs?format=csv", { token: admin });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.text.split("\r\n")[0]).toBe("started_at,job_name,status,finished_at,error");

    const audits = await auditRows("job.enqueue");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ job_name: "STARTUP_RECONCILIATION" });
  });

  it("refuses unknown names (400) and jobs without a handler in this process (422 JOB_NOT_REGISTERED)", async () => {
    expect((await t.request("POST", "/api/v1/admin/jobs/BOGUS/run", { token: admin, body: {} })).status).toBe(400);
    const { registeredJobs } = await import("../../src/jobs/index.js");
    const unregistered = JOB_NAMES.find((n) => !registeredJobs().includes(n));
    if (unregistered) {
      const r = await t.request<ErrorBody>("POST", `/api/v1/admin/jobs/${unregistered}/run`, {
        token: admin,
        body: {},
      });
      expect(r.status).toBe(422);
      expect(r.body.error.details?.["rule"]).toBe("JOB_NOT_REGISTERED");
    }
    await waitFor("idle queue", async () => (await t.app.jobQueue().getActiveCount()) === 0);
  });
});

describe("admin · reseed guard and system facts", () => {
  it("reseed: confirm literal, admin.tools + Super Admin; 501 NOT_IMPLEMENTED until seed/run.ts exports reseed(db)", async () => {
    expect((await t.request("POST", "/api/v1/admin/reseed", { token: admin, body: { confirm: "yes" } })).status).toBe(
      400,
    );
    const a = await t.request<ErrorBody>("POST", "/api/v1/admin/reseed", {
      token: accounts,
      body: { confirm: "RESEED" },
    });
    expect(a.status).toBe(403);
    expect(a.body.error.code).toBe("FORBIDDEN");
    const o = await t.request<ErrorBody>("POST", "/api/v1/admin/reseed", { token: ops, body: { confirm: "RESEED" } });
    expect(o.status).toBe(403);
    expect(o.body.error.code).toBe("SUPER_ADMIN_ONLY");
    const r = await t.request<ErrorBody & { counts?: Record<string, number>; integrity?: { ok: boolean } }>(
      "POST",
      "/api/v1/admin/reseed",
      { token: admin, body: { confirm: "RESEED" } },
    );
    expect([200, 501], r.text).toContain(r.status);
    if (r.status === 501) {
      expect(r.body.error.code).toBe("NOT_IMPLEMENTED");
      expect(r.body.error.message).toContain("reseed(db)");
    } else {
      expect(r.body.integrity?.ok).toBe(true);
    }
  });

  it("GET /admin/system reports versions, database size and counts, loaded modules and job health", async () => {
    const r = await t.request<{
      app_version: string;
      node_version: string;
      postgres_version: string | null;
      redis_version: string | null;
      uptime_seconds: number;
      modules: string[];
      database: { name: string; size_bytes: number; table_count: number; table_rows_estimated: Record<string, number> };
      redis: { used_memory_bytes: number | null };
      jobs: { registered: string[]; runs_last_24h: number; failed_last_24h: number };
    }>("GET", "/api/v1/admin/system", { token: admin });
    expect(r.status, r.text).toBe(200);
    expect(r.body.node_version).toBe(process.version);
    expect(r.body.postgres_version).toContain("PostgreSQL");
    expect(r.body.redis_version).toMatch(/^\d+\./);
    expect(r.body.database.size_bytes).toBeGreaterThan(0);
    expect(r.body.database.table_count).toBeGreaterThanOrEqual(77);
    expect(r.body.database.table_rows_estimated).toHaveProperty("users");
    expect(r.body.modules).toEqual(expect.arrayContaining(["auth", "admin"]));
    expect(r.body.jobs.registered).toContain("STARTUP_RECONCILIATION");
    expect(r.body.jobs.runs_last_24h).toBeGreaterThanOrEqual(1);
    expect(r.body.jobs.failed_last_24h).toBe(0);
    expect((await t.request("GET", "/api/v1/admin/system", { token: accounts })).status).toBe(403);
  });
});
