/**
 * Phase 7 domain track — master CSV import (docs/hardening/phase7-domain.md, item 4):
 * - UPDATE rows apply only the columns present in the CSV (no create-time defaults): re-importing charge types with a subset of columns
 *   leaves amount / GST / demand_at / taxable untouched, flat types keep spec_item_ids;
 * - unknown or misnamed columns are 422 IMPORT_UNKNOWN_COLUMNS listing them with the expected names (+ a suggestion); export-only
 *   columns (id, version, is_active, looked-up names) are accepted and ignored;
 * - GET /masters/{path}/import-template returns the canonical header and an example row for every master, and importing the template's
 *   own CSV succeeds (round trip), for all 16 kinds;
 * - PATCH never resets an omitted field to its create default (payment plan grace_days).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImportUnknownColumnsDetailsSchema, MasterImportTemplateSchema } from "@kkt/contracts";
import { MASTER_KIND_DEFS } from "../../src/modules/masters/kinds.js";
import { createBasics, type Basics } from "./fixtures.js";
import { buildTestApp, ifMatch, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
let token: string;
let basics: Basics;

type ImportResult = {
  committed: boolean;
  rows: { line: number; action: string; data: Record<string, unknown>; errors: string[] }[];
  summary: { create: number; update: number; skip: number; error: number };
  ignored_columns?: string[];
};

beforeAll(async () => {
  t = await buildTestApp();
  token = (await t.loginAs("admin")).access_token;
  basics = await createBasics(t, token);
}, 120_000);

afterAll(async () => {
  await t?.close();
});

const importCsv = (kind: string, csv: string, commit = false) =>
  t.request<ImportResult>("POST", "/api/v1/masters/import", { token, body: { kind, csv, commit } });

describe("UPDATE rows write only the CSV's columns", () => {
  it("re-importing charge types with a subset of columns leaves the other columns unchanged", async () => {
    const created = await t.request<{ id: string }>("POST", "/api/v1/masters/charge-types", {
      token,
      body: {
        name: "Car Parking",
        code: "PARKING",
        default_amount_paise: 30_000_000,
        is_taxable: true,
        default_gst_percent: 18,
        demand_at: "ON_BOOKING",
      },
    });
    expect(created.status, created.text).toBe(201);
    const preview = await importCsv("CHARGE_TYPES", "code,name\nPARKING,Covered Car Parking\nCLUB,Club House\n");
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.rows.map((r) => r.action)).toEqual(["UPDATE", "CREATE"]);
    // the UPDATE row carries only what the CSV says; the CREATE row gets the create defaults
    expect(preview.body.rows[0]!.data).toEqual({ code: "PARKING", name: "Covered Car Parking" });
    expect(preview.body.rows[1]!.data).toMatchObject({ code: "CLUB", default_amount_paise: 0, demand_at: "MANUAL" });
    const commit = await importCsv("CHARGE_TYPES", "code,name\nPARKING,Covered Car Parking\nCLUB,Club House\n", true);
    expect(commit.status, commit.text).toBe(200);
    expect(commit.body.summary).toEqual({ create: 1, update: 1, skip: 0, error: 0 });
    const row = await t.request<Record<string, unknown>>("GET", `/api/v1/masters/charge-types/${created.body.id}`, {
      token,
    });
    expect(row.body).toMatchObject({
      name: "Covered Car Parking",
      default_amount_paise: 30_000_000,
      is_taxable: true,
      default_gst_percent: 18,
      demand_at: "ON_BOOKING",
    });
    // an empty cell also means "unchanged"
    const partialCells = await importCsv("CHARGE_TYPES", "code,name,default_gst_percent\nPARKING,,5\n", true);
    expect(partialCells.status, partialCells.text).toBe(200);
    const again = await t.request<Record<string, unknown>>("GET", `/api/v1/masters/charge-types/${created.body.id}`, {
      token,
    });
    expect(again.body).toMatchObject({
      name: "Covered Car Parking",
      default_gst_percent: 5,
      default_amount_paise: 30_000_000,
    });
  });

  it("flat types re-imported without spec_item_ids keep them", async () => {
    const item = await t.request<{ id: string }>("POST", "/api/v1/masters/spec-items", {
      token,
      body: { category_id: basics.specCategoryId, name: "Vitrified tiles" },
    });
    expect(item.status, item.text).toBe(201);
    const cur = await t.request<{ version: number; code: string }>(
      "GET",
      `/api/v1/masters/flat-types/${basics.flatTypeId}`,
      { token },
    );
    const patched = await t.request("PATCH", `/api/v1/masters/flat-types/${basics.flatTypeId}`, {
      token,
      headers: ifMatch(cur.body.version),
      body: { spec_item_ids: [item.body.id] },
    });
    expect(patched.status, patched.text).toBe(200);
    const res = await importCsv("FLAT_TYPES", `code,name,bhk\n${cur.body.code},3 BHK Premium,3\n`, true);
    expect(res.status, res.text).toBe(200);
    expect(res.body.summary.update).toBe(1);
    const after = await t.request<{ name: string; spec_item_ids: string[]; rooms: unknown[] }>(
      "GET",
      `/api/v1/masters/flat-types/${basics.flatTypeId}`,
      { token },
    );
    expect(after.body.name).toBe("3 BHK Premium");
    expect(after.body.spec_item_ids).toEqual([item.body.id]);
    expect(after.body.rooms.length).toBe(1);
  });
});

describe("header check", () => {
  it("unknown / misnamed columns are 422 IMPORT_UNKNOWN_COLUMNS with the expected names and a suggestion", async () => {
    const res = await t.request<ErrorBody>("POST", "/api/v1/masters/import", {
      token,
      body: { kind: "CHARGE_TYPES", csv: "code,name,default_amount,colour\nPARKING,Parking,100\n" },
    });
    expect(res.status, res.text).toBe(422);
    expect(res.body.error.code).toBe("IMPORT_UNKNOWN_COLUMNS");
    const details = ImportUnknownColumnsDetailsSchema.parse(res.body.error.details);
    expect(details.unknown_columns).toEqual(["default_amount", "colour"]);
    expect(details.suggestions).toEqual({ default_amount: "default_amount_paise" });
    expect(details.expected_columns).toEqual([
      "name",
      "code",
      "default_amount_paise",
      "is_taxable",
      "default_gst_percent",
      "demand_at",
    ]);
    expect(details.required_columns).toEqual(["name", "code"]);
    expect(res.body.error.message).toMatch(/default_amount \(did you mean default_amount_paise\?\)/);
  });

  it("export-only columns (id, version, is_active, looked-up names) are accepted and ignored", async () => {
    const res = await importCsv(
      "ROOM_TYPES",
      "id,name,code,sort_order,is_active,version\n,Pooja Room,POOJA,5,true,1\n",
    );
    expect(res.status, res.text).toBe(200);
    expect(res.body.ignored_columns).toEqual(["id", "is_active", "version"]);
    expect(res.body.rows[0]!.action).toBe("CREATE");
  });
});

describe("import templates (every master round-trips)", () => {
  it.each(MASTER_KIND_DEFS.map((d) => [d.kind, d.path] as const))(
    "%s: the template's example row imports",
    async (kind, path) => {
      const res = await t.request("GET", `/api/v1/masters/${path}/import-template`, { token });
      expect(res.status, res.text).toBe(200);
      const tpl = MasterImportTemplateSchema.parse(res.body);
      expect(tpl.kind).toBe(kind);
      expect(tpl.notes).toEqual([]);
      expect(tpl.columns.filter((c) => c.key).map((c) => c.name)).toEqual([tpl.key_field]);
      expect(tpl.csv.split("\r\n")[0]).toBe(tpl.header.join(","));
      const preview = await importCsv(kind, tpl.csv);
      expect(preview.status, preview.text).toBe(200);
      expect(preview.body.rows.length).toBe(1);
      expect(preview.body.rows[0]!.errors).toEqual([]);
      const commit = await importCsv(kind, tpl.csv, true);
      expect(commit.status, commit.text).toBe(200);
      expect(commit.body.summary.error).toBe(0);
      expect(commit.body.summary.create + commit.body.summary.update).toBe(1);
      // importing it again is an UPDATE of the same row
      const again = await importCsv(kind, tpl.csv, true);
      expect(again.status, again.text).toBe(200);
      expect(again.body.summary.update).toBe(1);
    },
  );

  it("?format=csv downloads the same header and example", async () => {
    const json = await t.request<{ csv: string }>("GET", "/api/v1/masters/charge-types/import-template", { token });
    const csv = await t.request("GET", "/api/v1/masters/charge-types/import-template?format=csv", { token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toMatch(/text\/csv/);
    expect(String(csv.headers["content-disposition"])).toMatch(/charge-types-import-template\.csv/);
    expect(csv.text).toBe(json.body.csv);
  });

  it("the example notes what to create first when a referenced master is missing", async () => {
    await t.app.sql`update spec_categories set is_active = false where company_id = ${t.companyId}`;
    try {
      const res = await t.request<{ notes: string[] }>("GET", "/api/v1/masters/spec-items/import-template", {
        token,
      });
      expect(res.status).toBe(200);
      expect(res.body.notes.join(" ")).toMatch(/specification category/);
    } finally {
      await t.app.sql`update spec_categories set is_active = true where company_id = ${t.companyId}`;
    }
  });
});

describe("PATCH keeps omitted fields", () => {
  it("a payment plan PATCH without grace_days keeps it (Zod 4 default inside partial)", async () => {
    const created = await t.request<{ id: string; version: number; grace_days: number }>(
      "POST",
      "/api/v1/masters/payment-plans",
      {
        token,
        body: {
          name: "Grace plan",
          code: "GRACE",
          plan_type: "DOWN_PAYMENT",
          grace_days: 10,
          installments: [
            { seq: 1, name: "On booking", percent: 20, trigger_type: "ON_BOOKING" },
            { seq: 2, name: "On possession", percent: 80, trigger_type: "ON_POSSESSION" },
          ],
        },
      },
    );
    expect(created.status, created.text).toBe(201);
    const patched = await t.request<{ grace_days: number; name: string }>(
      "PATCH",
      `/api/v1/masters/payment-plans/${created.body.id}`,
      { token, headers: ifMatch(created.body.version), body: { name: "Grace plan (renamed)" } },
    );
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body).toMatchObject({ name: "Grace plan (renamed)", grace_days: 10 });
  });
});
