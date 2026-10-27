/**
 * Audit v3 G1: master import templates come from GET /masters/{path}/import-template, so the ERP shows exactly the columns the
 * importer validates (the hand-kept lists had wrong names, e.g. default_amount instead of default_amount_paise).
 */
import fs from "node:fs";
import path from "node:path";
import type { MasterImportTemplate } from "@kkt/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, tokens } from "@/lib/api";
import { describeTemplateColumns, masterKeys, unknownColumnLines } from "../api";

const CHARGE_TYPES: MasterImportTemplate = {
  kind: "CHARGE_TYPES",
  path: "charge-types",
  key_field: "code",
  columns: [
    { name: "name", required: true, type: "string", key: false },
    { name: "code", required: true, type: "string", key: true },
    { name: "default_amount_paise", required: false, type: "number", key: false },
    { name: "is_taxable", required: false, type: "boolean", key: false },
    { name: "demand_at", required: false, type: "enum", values: ["ON_BOOKING", "ON_POSSESSION", "MANUAL"], key: false },
    { name: "applies_to", required: false, type: "list", values: ["FLAT", "VILLA"], key: false },
  ],
  header: ["name", "code", "default_amount_paise", "is_taxable", "demand_at", "applies_to"],
  example: { name: "Maintenance", code: "MAINT", default_amount_paise: "5000000" },
  csv: "name,code,default_amount_paise,is_taxable,demand_at,applies_to\nMaintenance,MAINT,5000000,true,ON_POSSESSION,FLAT",
  notes: [],
} as unknown as MasterImportTemplate;

afterEach(() => {
  vi.unstubAllGlobals();
  tokens.clear();
});

describe("master import templates", () => {
  it("are read from the API, per master path", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(CHARGE_TYPES), { headers: { "Content-Type": "application/json" } });
      }),
    );
    tokens.setAccess("t");
    const template = await api.get<MasterImportTemplate>("/masters/charge-types/import-template");
    expect(urls).toEqual(["/api/v1/masters/charge-types/import-template"]);
    expect(template.header).toContain("default_amount_paise");
    expect(masterKeys.importTemplate("charge-types")).toEqual(["/masters/charge-types", "import-template"]);
  });

  it("describes each column: type, enum values, required and the match key", () => {
    expect(describeTemplateColumns(CHARGE_TYPES)).toEqual([
      "name (string, required)",
      "code (string, required, match key)",
      "default_amount_paise (number)",
      "is_taxable (boolean)",
      "demand_at (one of: ON_BOOKING, ON_POSSESSION, MANUAL)",
      'applies_to (list of FLAT | VILLA, "|"-separated)',
    ]);
  });

  it("explains 422 IMPORT_UNKNOWN_COLUMNS with the server's suggestions", () => {
    expect(
      unknownColumnLines({
        kind: "CHARGE_TYPES",
        unknown_columns: ["default_amount", "colour"],
        suggestions: { default_amount: "default_amount_paise" },
        expected_columns: CHARGE_TYPES.header,
        required_columns: ["name", "code"],
      }),
    ).toEqual(["“default_amount” is not a column — did you mean “default_amount_paise”?", "“colour” is not a column."]);
    expect(unknownColumnLines(undefined)).toEqual([]);
  });

  it("the ERP keeps no column lists of its own", () => {
    const dir = path.resolve(__dirname, "..");
    const config = fs.readFileSync(path.join(dir, "masterConfig.ts"), "utf8");
    expect(config).not.toMatch(/\bcsv:\s*\{/);
    expect(config).not.toMatch(/default_amount"/);
    const dialog = fs.readFileSync(path.join(dir, "CsvImportDialog.tsx"), "utf8");
    expect(dialog).toMatch(/useImportTemplate\(/);
  });
});
