/**
 * Adversarial review of the admin module: tenant isolation and memory bounds of the backup, ZIP validity (CRC-32, sizes, UTF-8 names,
 * streamed entries), erasure keeping financial rows + audit history and reaching every PII copy, settings validation (SLA, GST, prefixes,
 * number patterns, partial patches) with the company cache visible through GET /auth/me, and the production reseed guard.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialYear, todayIST } from "@kkt/domain";
import { createPortalCustomer, createProject } from "./fixtures.js";
import { createActiveBooking } from "./fixtures/crm.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

type Settings = {
  id: string; name: string; version: number;
  numbering: Record<string, { prefix: string; format?: string }>;
  settings: { demand_due_days: number; default_gst_percent: number; round_robin_enabled: boolean; force_mfa_for_admins: boolean; sla_hours: Record<string, number>; booking_hold_hours: number };
  numbering_preview: { scope: string; fy: string; last_sequence: number; next_number: string }[];
};
type Manifest = {
  format: string; include_sensitive: boolean; max_rows_per_table: number; truncated_tables: string[]; row_count: number;
  tables: { name: string; file: string; rows: number; total_rows: number; truncated: boolean; scope: string; note: string | null; columns: string[]; stripped_columns: string[] }[];
};

let t: TestContext;
let admin: string;
const fy = financialYear(todayIST(), 4).label;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
});
afterAll(async () => { await t?.close(); });

async function current(): Promise<Settings> {
  const r = await t.request<Settings>("GET", "/api/v1/settings/company", { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

describe("settings · validation and merge semantics", () => {
  it("rejects GST above 28 %, non-positive SLA hours, unsafe prefixes and number patterns without {seq}", async () => {
    const c = await current();
    const bad = async (patch: Record<string, unknown>, pathHint: string) => {
      const r = await t.request<ErrorBody>("PATCH", "/api/v1/settings/company", { token: admin, body: { version: c.version, ...patch } });
      expect(r.status, `${pathHint}: ${r.text}`).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(r.body.error.details ?? {})).toContain(pathHint);
    };
    await bad({ settings: { ...c.settings, default_gst_percent: 30 } }, "default_gst_percent");
    await bad({ settings: { ...c.settings, default_gst_percent: -1 } }, "default_gst_percent");
    await bad({ settings: { ...c.settings, sla_hours: { ...c.settings.sla_hours, LOW: 0 } } }, "LOW");
    await bad({ settings: { ...c.settings, sla_hours: { ...c.settings.sla_hours, URGENT: -5 } } }, "URGENT");
    await bad({ settings: { ...c.settings, booking_hold_hours: 0 } }, "booking_hold_hours");
    await bad({ numbering: { ...c.numbering, customer: { prefix: "CU$T-" } } }, "prefix");
    await bad({ numbering: { ...c.numbering, customer: { prefix: "CU T-" } } }, "prefix");
    await bad({ numbering: { ...c.numbering, customer: { prefix: "<script>" } } }, "prefix");
    await bad({ numbering: { ...c.numbering, customer: { prefix: "CU-", format: "CUST-{fy}" } } }, "format");
    await bad({ numbering: { ...c.numbering, customer: { prefix: "CU-", format: "{prefix}{seq:4} {evil}" } } }, "format");
    await bad({ numbering: { ...c.numbering, customer: { prefix: "CU-", format: "" } } }, "format");
    // nothing above was stored, and the preview still renders
    const after = await current();
    expect(after.version).toBe(c.version);
    expect(after.numbering_preview.find((p) => p.scope === "customer")!.next_number).toBe(`CUST-${fy}/0001`);
  });

  it("accepts a valid custom pattern and safe prefixes (slash, dash, underscore, dot) and previews with it", async () => {
    const c = await current();
    const r = await t.request<Settings>("PATCH", "/api/v1/settings/company", { token: admin, body: { version: c.version, numbering: { ...c.numbering, receipt: { prefix: "SGB/A_1.", format: "{prefix}{fy}-{seq:5}" } } } });
    expect(r.status, r.text).toBe(200);
    expect(r.body.numbering_preview.find((p) => p.scope === "receipt")!.next_number).toBe(`SGB/A_1.${fy}-00001`);
  });

  it("a partial settings/numbering patch merges onto the stored values instead of resetting omitted keys to defaults", async () => {
    const c = await current();
    const full = await t.request<Settings>("PATCH", "/api/v1/settings/company", { token: admin, body: { version: c.version, settings: { ...c.settings, force_mfa_for_admins: false, demand_due_days: 30, round_robin_enabled: false, sla_hours: { LOW: 100, MEDIUM: 50, HIGH: 20, URGENT: 4 } } } });
    expect(full.status, full.text).toBe(200);
    const partial = await t.request<Settings>("PATCH", "/api/v1/settings/company", { token: admin, body: { version: full.body.version, settings: { sla_hours: { HIGH: 12 } }, numbering: { ticket: { prefix: "TKT-" } } } });
    expect(partial.status, partial.text).toBe(200);
    expect(partial.body.settings).toEqual({ demand_due_days: 30, default_gst_percent: c.settings.default_gst_percent, round_robin_enabled: false, force_mfa_for_admins: false, sla_hours: { LOW: 100, MEDIUM: 50, HIGH: 12, URGENT: 4 }, booking_hold_hours: c.settings.booking_hold_hours });
    expect(partial.body.numbering.ticket).toEqual({ prefix: "TKT-" });
    expect(partial.body.numbering.receipt).toEqual(full.body.numbering.receipt); // untouched scopes survive
    expect(partial.body.numbering.customer).toEqual(c.numbering.customer);
    const [row] = await t.app.sql<{ settings: Settings["settings"] }[]>`select settings from companies where id = ${t.companyId}`;
    expect(row!.settings.sla_hours).toEqual({ LOW: 100, MEDIUM: 50, HIGH: 12, URGENT: 4 });
    expect(row!.settings.demand_due_days).toBe(30);
  });

  it("the company cache is dropped on PATCH: GET /auth/me shows the new name and settings on the very next request", async () => {
    type Me = { company: { name: string; settings: { demand_due_days: number; booking_hold_hours: number; round_robin_enabled: boolean } } };
    const primed = await t.request<Me>("GET", "/api/v1/auth/me", { token: admin });
    expect(primed.status).toBe(200);
    const c = await current();
    expect(primed.body.company.settings.demand_due_days).toBe(c.settings.demand_due_days);
    const r = await t.request<Settings>("PATCH", "/api/v1/settings/company", { token: admin, body: { version: c.version, name: "Cache Busters Pvt Ltd", settings: { demand_due_days: 7, booking_hold_hours: 12, round_robin_enabled: true } } });
    expect(r.status, r.text).toBe(200);
    const me = await t.request<Me>("GET", "/api/v1/auth/me", { token: admin });
    expect(me.status).toBe(200);
    expect(me.body.company.name).toBe("Cache Busters Pvt Ltd");
    expect(me.body.company.settings).toMatchObject({ demand_due_days: 7, booking_hold_hours: 12, round_robin_enabled: true });
  });
});

describe("backup · tenant isolation, memory bounds and ZIP validity", () => {
  let otherCompanyId: string;
  let otherLeadId: string;

  beforeAll(async () => {
    const [oc] = await t.app.sql<{ id: string }[]>`insert into companies (name) values ('Other Builder') returning id`;
    otherCompanyId = oc!.id;
    await t.app.sql`insert into customers (company_id, customer_code, full_name, phone, pan_hash, aadhaar_hash) values (${otherCompanyId}, 'CUST-OTHER', 'Other Tenant Customer', '9999900001', 'otherhash', 'otheraadhaar')`;
    const [lead] = await t.app.sql<{ id: string }[]>`insert into leads (company_id, lead_number, full_name, phone) values (${otherCompanyId}, 'LD-OTHER/0001', 'Other Lead', '9999900002') returning id`;
    otherLeadId = lead!.id;
    await t.app.sql`insert into lead_activities (lead_id, type, payload) values (${otherLeadId}, 'NOTE', '{"text":"other tenant"}'::jsonb)`;
    const [mine] = await t.app.sql<{ id: string }[]>`insert into leads (company_id, lead_number, full_name, phone) values (${t.companyId}, 'LD-MINE/0001', 'My Lead', '9876500011') returning id`;
    await t.app.sql`insert into lead_activities (lead_id, type, payload) values (${mine!.id}, 'NOTE', '{"text":"mine"}'::jsonb)`;
    await t.app.sql`insert into customers (company_id, customer_code, full_name, phone, pan_hash, aadhaar_hash) values (${t.companyId}, 'CUST-HASH', 'Hash Subject', '9876500012', 'myhash', 'myaadhaar')`;
    for (let i = 0; i < 5; i++) await t.app.sql`insert into customers (company_id, customer_code, full_name, phone) values (${t.companyId}, ${`CUST-BULK${i}`}, ${`Bulk ${i}`}, ${`98765001${20 + i}`})`;
  });

  function entriesOf(zip: Buffer) {
    return import("../../src/modules/admin/index.js").then(({ readCentralDirectory, readZipEntry }) => {
      const entries = readCentralDirectory(zip);
      const read = (name: string) => { const e = entries.find((x) => x.name === name); if (!e) throw new Error(`missing ${name}`); return readZipEntry(zip, e); };
      const json = <T,>(name: string) => JSON.parse(read(name).toString("utf8")) as T;
      return { entries, read, json };
    });
  }

  it("exports only the caller's tenant: companies, users, customers, leads and child tables of another company never appear; PII hashes are stripped", async () => {
    const { buildBackup } = await import("../../src/modules/admin/index.js");
    const built = await buildBackup(t.app.db, { companyId: t.companyId, companyName: "SGB", includeSensitive: false });
    const { json } = await entriesOf(built.zip);
    const companies = json<{ id: string }[]>("tables/companies.json");
    expect(companies.map((c) => c.id)).toEqual([t.companyId]);
    const customers = json<Record<string, unknown>[]>("tables/customers.json");
    expect(customers.every((c) => c["company_id"] === t.companyId)).toBe(true);
    expect(customers.some((c) => c["customer_code"] === "CUST-OTHER")).toBe(false);
    expect(customers.find((c) => c["customer_code"] === "CUST-HASH")).toBeDefined();
    for (const c of customers) { expect(c).not.toHaveProperty("pan_hash"); expect(c).not.toHaveProperty("aadhaar_hash"); }
    const leads = json<{ id: string; company_id: string }[]>("tables/leads.json");
    expect(leads.every((l) => l.company_id === t.companyId)).toBe(true);
    const myLeadIds = new Set(leads.map((l) => l.id));
    const acts = json<{ lead_id: string }[]>("tables/lead_activities.json");
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every((a) => myLeadIds.has(a.lead_id))).toBe(true);
    expect(acts.some((a) => a.lead_id === otherLeadId)).toBe(false);
    const manifest = built.manifest as unknown as Manifest;
    expect(manifest.tables.find((x) => x.name === "customers")!.stripped_columns).toEqual(expect.arrayContaining(["pan_hash", "aadhaar_hash", "pan_enc", "aadhaar_enc"]));
    expect(manifest.tables.find((x) => x.name === "lead_activities")!.scope).toBe("parent");
    expect(manifest.tables.find((x) => x.name === "companies")!.scope).toBe("company");
    expect(manifest.tables.find((x) => x.name === "job_runs")!.scope).toBe("global");
    // the sensitive export keeps the hashes but is still tenant-scoped
    const sens = await buildBackup(t.app.db, { companyId: t.companyId, companyName: "SGB", includeSensitive: true });
    const s = await entriesOf(sens.zip);
    expect(s.json<{ id: string }[]>("tables/companies.json").map((c) => c.id)).toEqual([t.companyId]);
    expect(s.json<Record<string, unknown>[]>("tables/customers.json").find((c) => c["customer_code"] === "CUST-HASH")!["pan_hash"]).toBe("myhash");
  });

  it("streams tables in batches and caps each table at max_rows_per_table, saying so in the manifest", async () => {
    const { buildBackup, BACKUP_MAX_ROWS_PER_TABLE } = await import("../../src/modules/admin/index.js");
    expect(BACKUP_MAX_ROWS_PER_TABLE).toBe(200_000);
    const [n] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from customers where company_id = ${t.companyId}`;
    expect(n!.n).toBeGreaterThanOrEqual(6);
    const built = await buildBackup(t.app.db, { companyId: t.companyId, companyName: "SGB", includeSensitive: false, maxRowsPerTable: 3, batchSize: 2 });
    const { json, entries } = await entriesOf(built.zip);
    const manifest = json<Manifest>("manifest.json");
    expect(manifest.max_rows_per_table).toBe(3);
    const cust = manifest.tables.find((x) => x.name === "customers")!;
    expect(cust).toMatchObject({ rows: 3, total_rows: n!.n, truncated: true });
    expect(cust.note).toMatch(/3 of \d+ rows/);
    expect(manifest.truncated_tables).toContain("customers");
    expect(json<unknown[]>("tables/customers.json")).toHaveLength(3);
    const users = manifest.tables.find((x) => x.name === "users")!;
    expect(users.truncated).toBe(true); // 6 seeded users > 3
    const roles = manifest.tables.find((x) => x.name === "sequences")!;
    expect(roles.truncated).toBe(false);
    expect(manifest.row_count).toBe(manifest.tables.reduce((s, x) => s + x.rows, 0));
    // batched streaming still yields valid JSON and matching CRCs for every entry
    for (const e of entries) expect((await entriesOf(built.zip)).read(e.name).length).toBe(e.uncompressedSize);
    const bigger = await buildBackup(t.app.db, { companyId: t.companyId, companyName: "SGB", includeSensitive: false, batchSize: 2 });
    const m2 = (await entriesOf(bigger.zip)).json<Manifest>("manifest.json");
    expect(m2.tables.find((x) => x.name === "customers")).toMatchObject({ rows: n!.n, total_rows: n!.n, truncated: false, note: null });
    expect(m2.truncated_tables).toEqual([]);
  });

  it("ZipWriter: streamed entries, UTF-8 names (flag bit 11), empty entries and stored-vs-deflated choice all read back; `unzip -t` agrees; junk input fails cleanly", async () => {
    const { ZipWriter, readCentralDirectory, readZipEntry, crc32 } = await import("../../src/modules/admin/index.js");
    const w = new ZipWriter(new Date("2026-03-31T18:29:59Z"));
    const name = "tables/ünïcødé-टेबल.json";
    const s = w.stream(name);
    const parts = ["[\n", JSON.stringify({ a: "é".repeat(1000) }), ",\n", JSON.stringify({ b: 2 }), "\n]\n"];
    for (const p of parts) await s.write(p);
    await s.end();
    w.file("empty.txt", "");
    w.file("random.bin", Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 7919) & 0xff)));
    const dup = () => w.file(name, "x");
    expect(dup).toThrow(/Duplicate/);
    expect(() => w.file("../escape.txt", "x")).toThrow(/Invalid/);
    expect(() => w.file("/abs.txt", "x")).toThrow(/Invalid/);
    const zip = w.build();
    const entries = readCentralDirectory(zip);
    expect(entries.map((e) => e.name)).toEqual([name, "empty.txt", "random.bin"]);
    const u = entries[0]!;
    const expected = Buffer.from(parts.join(""), "utf8");
    expect(u.uncompressedSize).toBe(expected.length);
    expect(u.crc).toBe(crc32(expected));
    expect(u.method).toBe(8);
    expect(readZipEntry(zip, u).equals(expected)).toBe(true);
    expect(zip.readUInt16LE(u.localHeaderOffset + 6) & 0x0800).toBe(0x0800);
    expect(zip.readUInt16LE(u.localHeaderOffset + 26)).toBe(Buffer.byteLength(name, "utf8"));
    expect(entries[1]).toMatchObject({ uncompressedSize: 0, compressedSize: 0, crc: 0, method: 0 });
    expect(readZipEntry(zip, entries[1]!).length).toBe(0);
    expect(readZipEntry(zip, entries[2]!)).toHaveLength(512);
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926); // the CRC-32 check value
    const dir = mkdtempSync(join(tmpdir(), "kkt-zip-"));
    const file = join(dir, "t.zip");
    writeFileSync(file, zip);
    try {
      const listing = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
      expect(listing).toContain("No errors detected");
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
    expect(() => readCentralDirectory(Buffer.alloc(0))).toThrow(/ZIP/);
    expect(() => readCentralDirectory(Buffer.from("not a zip at all, honestly"))).toThrow(/ZIP/);
    const corrupt = Buffer.from(zip);
    const flip = u.localHeaderOffset + 30 + Buffer.byteLength(name, "utf8") + 3;
    corrupt[flip] = (corrupt[flip] ?? 0) ^ 0xff;
    expect(() => readZipEntry(corrupt, u)).toThrow(/CRC|ZIP|unexpected|invalid/i);
  });
});

describe("erasure · financial integrity, audit immutability and every PII copy", () => {
  let projectId: string;
  let customerId: string;
  let bookingId: string;
  let coOnlyId: string;
  const phone = "9876543250";

  beforeAll(async () => {
    projectId = await createProject(t, "Erase Deep", "ERD");
    customerId = (await createPortalCustomer(t, { phone, name: "Deep Erase Devi" })).customerId;
    const b = await createActiveBooking(t, customerId, projectId);
    bookingId = b.bookingId;
    const [mode] = await t.app.sql<{ id: string }[]>`insert into payment_modes (company_id, name, code, is_cash) values (${t.companyId}, 'Cash2', 'CASH2', true) returning id`;
    await t.app.sql`insert into payments (company_id, booking_id, project_id, block_id, customer_id, receipt_number, against, bucket, amount_paise, payment_date, payment_mode_id, mode_code, status, cleared_at)
      values (${t.companyId}, ${bookingId}, ${projectId}, ${b.blockId}, ${customerId}, 'SGB/DEEP/0001', 'FLAT_VALUE', 'CASH', 700000, current_date, ${mode!.id}, 'CASH', 'CLEARED', now())`;
    await t.app.sql`insert into demands (company_id, booking_id, project_id, block_id, customer_id, demand_number, installment_seq, installment_name, trigger_type, percent, cumulative_percent, cash_demand_paise, account_demand_paise, total_demand_paise, demand_date, due_date)
      values (${t.companyId}, ${bookingId}, ${projectId}, ${b.blockId}, ${customerId}, 'DM-DEEP/0001', 1, 'On booking', 'ON_BOOKING', 10, 10, 40000000, 25000000, 65000000, current_date, current_date + 15)`;
    // ledger rows from the source records
    const re = await t.request("POST", "/api/v1/admin/recompute", { token: admin, body: { booking_id: bookingId } });
    expect(re.status, re.text).toBe(200);
    await t.app.sql`update bookings set status = 'COMPLETED' where id = ${bookingId}`;
    await t.app.sql`insert into site_visits (company_id, visit_number, project_id, customer_id, visit_date, slot_start, slot_end, name, phone, email, message, status, source)
      values (${t.companyId}, 'SV-DEEP/0001', ${projectId}, ${customerId}, current_date, '10:00', '11:00', 'Deep Erase Devi', ${phone}, 'deep@example.com', 'Call before coming', 'COMPLETED', 'ERP')`;
    await t.app.sql`insert into enquiries (company_id, project_id, name, phone, email, message, reference_number) values (${t.companyId}, ${projectId}, 'Deep Erase Devi', ${phone}, 'deep@example.com', 'Interested in 3BHK', 'ENQ-DEEP-1')`;
    await t.app.sql`insert into cms_testimonials (company_id, customer_id, name, quote, is_published) values (${t.companyId}, ${customerId}, 'Deep Erase Devi', 'Loved the experience!', true)`;
    await t.app.sql`insert into leads (company_id, lead_number, full_name, phone, email) values (${t.companyId}, 'LD-DEEP/0001', 'Deep Erase Devi', ${phone}, 'deep@example.com')`; // same phone, never linked
    // a co-applicant whose only booking is CANCELLED
    coOnlyId = (await createPortalCustomer(t, { phone: "9876543251", name: "Cancelled Co" })).customerId;
    const primary = await createPortalCustomer(t, { phone: "9876543252", name: "Primary Two" });
    const cb = await createActiveBooking(t, primary.customerId, projectId, { coApplicantId: coOnlyId });
    await t.app.sql`update bookings set status = 'CANCELLED' where id = ${cb.bookingId}`;
  });

  it("keeps demands, payments and ledger rows pointing at the erased customer and leaves existing audit rows byte-for-byte untouched", async () => {
    const auditBefore = await t.app.sql<Record<string, unknown>[]>`select id, action, before, after, actor_name, entity_id from audit_logs where company_id = ${t.companyId} order by created_at, id`;
    expect(auditBefore.length).toBeGreaterThan(0);
    const [ledgerBefore] = await t.app.sql<{ n: number; sum: string | number }[]>`select count(*)::int as n, coalesce(sum(amount_paise),0) as sum from ledger_entries where booking_id = ${bookingId}`;
    expect(ledgerBefore!.n).toBeGreaterThan(0);

    const r = await t.request<{ financial_rows_kept: { bookings: number; payments: number; demands: number; ledger_entries: number }; anonymised: Record<string, unknown> }>("POST", `/api/v1/admin/customers/${customerId}/erase`, { token: admin, body: { confirm: "ERASE", reason: "DPDP request" } });
    expect(r.status, r.text).toBe(200);
    expect(r.body.financial_rows_kept).toEqual({ bookings: 1, payments: 1, demands: 1, ledger_entries: ledgerBefore!.n });
    expect(r.body.anonymised).toMatchObject({ site_visits: 1, enquiries: 1, testimonials: 1, leads: 1, portal_disabled: true });

    const [d] = await t.app.sql<{ customer_id: string; status: string; total_demand_paise: string | number }[]>`select customer_id, status, total_demand_paise from demands where booking_id = ${bookingId}`;
    expect(d).toMatchObject({ customer_id: customerId, status: "OPEN" });
    expect(Number(d!.total_demand_paise)).toBe(65000000);
    const [p] = await t.app.sql<{ customer_id: string; amount_paise: string | number }[]>`select customer_id, amount_paise from payments where booking_id = ${bookingId}`;
    expect(p!.customer_id).toBe(customerId);
    expect(Number(p!.amount_paise)).toBe(700000);
    const [ledgerAfter] = await t.app.sql<{ n: number; sum: string | number }[]>`select count(*)::int as n, coalesce(sum(amount_paise),0) as sum from ledger_entries where booking_id = ${bookingId}`;
    expect(ledgerAfter).toEqual(ledgerBefore);
    const [fk] = await t.app.sql<{ ok: boolean }[]>`select exists(select 1 from customers c join bookings b on b.customer_id = c.id where c.id = ${customerId} and c.erased_at is not null) as ok`;
    expect(fk!.ok).toBe(true);

    const auditAfter = await t.app.sql<Record<string, unknown>[]>`select id, action, before, after, actor_name, entity_id from audit_logs where company_id = ${t.companyId} order by created_at, id`;
    expect(auditAfter.length).toBe(auditBefore.length + 1);
    expect(auditAfter.slice(0, auditBefore.length)).toEqual(auditBefore);
    expect(auditAfter.at(-1)!["action"]).toBe("customer.erased");
  });

  it("anonymises the customer's site visits, website enquiries, testimonials and unlinked leads with the same phone", async () => {
    const [sv] = await t.app.sql<{ name: string; phone: string; email: string | null; message: string | null; status: string }[]>`select name, phone, email, message, status from site_visits where customer_id = ${customerId}`;
    expect(sv!.name).not.toContain("Deep");
    expect(sv!.phone).not.toBe(phone);
    expect(sv!.email).toBeNull();
    expect(sv!.message).toBeNull();
    expect(sv!.status).toBe("COMPLETED"); // the visit record (a business fact) stays
    const [enq] = await t.app.sql<{ name: string; phone: string; email: string | null; message: string | null }[]>`select name, phone, email, message from enquiries where reference_number = 'ENQ-DEEP-1'`;
    expect(enq!.name).not.toContain("Deep");
    expect(enq!.phone).not.toBe(phone);
    expect(enq!.email).toBeNull();
    const [tm] = await t.app.sql<{ name: string; quote: string; is_published: boolean }[]>`select name, quote, is_published from cms_testimonials where customer_id = ${customerId}`;
    expect(tm!.is_published).toBe(false);
    expect(tm!.name).not.toContain("Deep");
    expect(tm!.quote).not.toContain("Loved");
    const [ld] = await t.app.sql<{ full_name: string; phone: string; email: string | null }[]>`select full_name, phone, email from leads where lead_number = 'LD-DEEP/0001'`;
    expect(ld!.full_name).not.toContain("Deep");
    expect(ld!.phone).not.toBe(phone);
    expect(ld!.email).toBeNull();
    const [cnt] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from (
      select full_name as v from customers where id = ${customerId} union all select name from site_visits where customer_id = ${customerId}
      union all select name from enquiries where reference_number = 'ENQ-DEEP-1' union all select name from cms_testimonials where customer_id = ${customerId}) x where v ilike '%Deep Erase%'`;
    expect(cnt!.n).toBe(0);
  });

  it("a co-applicant whose only booking is CANCELLED can be erased; the booking_co_applicants link survives", async () => {
    const r = await t.request<{ anonymised: Record<string, unknown> }>("POST", `/api/v1/admin/customers/${coOnlyId}/erase`, { token: admin, body: { confirm: "ERASE" } });
    expect(r.status, r.text).toBe(200);
    const [link] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from booking_co_applicants where customer_id = ${coOnlyId}`;
    expect(link!.n).toBe(1);
  });
});

describe("reseed · production guard", () => {
  it("refuses with 422 RESEED_DISABLED when NODE_ENV=production, before touching anything", async () => {
    const { config } = await import("../../src/config.js");
    const before = config.NODE_ENV;
    const [countBefore] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from customers`;
    (config as { NODE_ENV: string }).NODE_ENV = "production";
    try {
      const r = await t.request<ErrorBody>("POST", "/api/v1/admin/reseed", { token: admin, body: { confirm: "RESEED" } });
      expect(r.status, r.text).toBe(422);
      expect(r.body.error.code).toBe("BUSINESS_RULE");
      expect(r.body.error.details?.["rule"]).toBe("RESEED_DISABLED");
    } finally {
      (config as { NODE_ENV: string }).NODE_ENV = before;
    }
    const [countAfter] = await t.app.sql<{ n: number }[]>`select count(*)::int as n from customers`;
    expect(countAfter).toEqual(countBefore);
    const audits = await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs where action = 'admin.reseed'`;
    expect(audits[0]!.n).toBe(0);
  });
});
