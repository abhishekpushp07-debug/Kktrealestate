import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBasics, type Basics } from "./fixtures.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
let token: string;
let basics: Basics;
beforeAll(async () => {
  t = await buildTestApp();
  token = (await t.loginAs("admin")).access_token;
  basics = await createBasics(t, token);
});
afterAll(async () => { await t?.close(); });

type Row = Record<string, unknown> & { id: string; version: number; is_active: boolean };

interface KindCase { path: string; create: () => Record<string, unknown>; patch: Record<string, unknown>; key: string; searchField: string }

const cases: KindCase[] = [
  { path: "room-types", key: "code", searchField: "name", create: () => ({ name: "Kitchen", code: "KITCHEN", sort_order: 2 }), patch: { name: "Modular Kitchen" } },
  { path: "area-types", key: "code", searchField: "name", create: () => ({ name: "Balcony", code: "BALCONY", sort_order: 4 }), patch: { sort_order: 5 } },
  { path: "flat-types", key: "code", searchField: "name", create: () => ({ name: "2BHK-A", code: "2BHK-A", bhk: 2, rooms: [{ room_type_id: basics.roomTypeId, label: "Bedroom 1", length_ft: 10, width_ft: 12 }], areas: [{ area_type_id: basics.areaTypes.CARPET, sqft: 720 }, { area_type_id: basics.areaTypes.BUILT_UP, sqft: 860 }, { area_type_id: basics.areaTypes.SUPER_BUILT_UP, sqft: 1050 }], base_rate_per_sqft_paise: 520000 }), patch: { facing: "North" } },
  { path: "block-types", key: "code", searchField: "name", create: () => ({ name: "Tower", code: "TOWER", has_floors: true }), patch: { name: "High-rise Tower" } },
  { path: "floor-plan-templates", key: "code", searchField: "name", create: () => ({ name: "FP-2", code: "FP-2", positions: [{ position: 1, flat_type_id: basics.flatTypeId, facing: "E", is_corner: true }, { position: 2, flat_type_id: basics.flatTypeId }] }), patch: { name: "FP-2 Premium" } },
  { path: "amenities", key: "name", searchField: "name", create: () => ({ name: "Swimming Pool", category: "Leisure", icon: "pool" }), patch: { icon: "waves" } },
  { path: "construction-stages", key: "code", searchField: "name", create: () => ({ name: "Brickwork", code: "BRICKWORK", sort_order: 90 }), patch: { sort_order: 95 } },
  { path: "payment-plans", key: "code", searchField: "name", create: () => ({ name: "Down Payment 10:85:5", code: "DP-10-85-5", plan_type: "DOWN_PAYMENT", installments: [{ seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" }, { seq: 2, name: "30 days", percent: 85, trigger_type: "DAYS_AFTER_BOOKING", trigger_days: 30 }, { seq: 3, name: "Possession", percent: 5, trigger_type: "ON_POSSESSION" }] }), patch: { grace_days: 7 } },
  { path: "charge-types", key: "code", searchField: "name", create: () => ({ name: "Car Parking", code: "PARKING", default_amount_paise: 30000000, is_taxable: true, default_gst_percent: 5, demand_at: "ON_BOOKING" }), patch: { default_amount_paise: 35000000 } },
  { path: "payment-modes", key: "code", searchField: "name", create: () => ({ name: "Cheque", code: "CHEQUE", sort_order: 2 }), patch: { sort_order: 3 } },
  { path: "bank-accounts", key: "account_name", searchField: "bank_name", create: () => ({ bank_name: "HDFC Bank", branch: "Boring Road", account_name: "Shree Ganesh Builders", account_number: "50100123456789", ifsc: "HDFC0000123", is_default: true }), patch: { branch: "Boring Road, Patna" } },
  { path: "document-types", key: "code", searchField: "name", create: () => ({ name: "PAN Card", code: "PAN", applies_to: ["CUSTOMER"], is_kyc: true }), patch: { name: "PAN" } },
  { path: "plc-types", key: "code", searchField: "name", create: () => ({ name: "Corner", code: "CORNER", calc_mode: "PER_SQFT" }), patch: { name: "Corner Unit" } },
  { path: "spec-categories", key: "name", searchField: "name", create: () => ({ name: "Kitchen", sort_order: 2 }), patch: { sort_order: 3 } },
  { path: "spec-items", key: "name", searchField: "name", create: () => ({ category_id: basics.specCategoryId, name: "Vitrified tiles", description: "800x800 double charged", sort_order: 1 }), patch: { description: "600x600 vitrified" } },
  { path: "service-categories", key: "name", searchField: "name", create: () => ({ name: "Payment query", sort_order: 1, default_priority: "HIGH" }), patch: { default_priority: "MEDIUM" } },
];

describe.each(cases)("masters/$path", (c) => {
  it("create, read, list, update (version), conflict, deactivate, restore, usage", async () => {
    const url = `/api/v1/masters/${c.path}`;
    const body = c.create();
    const created = await t.request<Row>("POST", url, { token, body });
    expect(created.status, created.text).toBe(201);
    expect(created.body.version).toBe(1);
    expect(created.body.is_active).toBe(true);
    expect(created.body[c.key]).toBe(body[c.key]);
    const got = await t.request<Row>("GET", `${url}/${created.body.id}`, { token });
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(created.body.id);
    const list = await t.request<{ items: Row[]; total: number; page: number; page_size: number; next_cursor: string | null }>("GET", `${url}?search=${encodeURIComponent(String(body[c.searchField]).slice(0, 4))}`, { token });
    expect(list.status).toBe(200);
    expect(list.body.items.map((i) => i.id)).toContain(created.body.id);
    expect(list.body.page).toBe(1);
    const dup = await t.request<ErrorBody>("POST", url, { token, body });
    expect(dup.status, dup.text).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
    const patched = await t.request<Row>("PATCH", `${url}/${created.body.id}`, { token, body: { ...c.patch, version: 1 } });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.version).toBe(2);
    for (const [k, v] of Object.entries(c.patch)) expect(patched.body[k]).toEqual(v);
    const stale = await t.request<ErrorBody>("PATCH", `${url}/${created.body.id}`, { token, body: { ...c.patch, version: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(2);
    expect(stale.body.error.details?.["changed_by"]).toBe("Suresh Agarwal");
    const viaHeader = await t.request<Row>("PATCH", `${url}/${created.body.id}`, { token, body: c.patch, headers: { "if-match": '"2"' } });
    expect(viaHeader.status, viaHeader.text).toBe(200);
    expect(viaHeader.body.version).toBe(3);
    const noVersion = await t.request<ErrorBody>("PATCH", `${url}/${created.body.id}`, { token, body: c.patch });
    expect(noVersion.status).toBe(400);
    const usage = await t.request<{ usage_count: number; used_by: unknown[] }>("GET", `${url}/${created.body.id}/usage`, { token });
    expect(usage.status).toBe(200);
    expect(usage.body.usage_count).toBe(0);
    const deact = await t.request<{ is_active: boolean; version: number }>("POST", `${url}/${created.body.id}/deactivate`, { token, body: { version: 3 } });
    expect(deact.status, deact.text).toBe(200);
    expect(deact.body.is_active).toBe(false);
    const hidden = await t.request<{ items: Row[] }>("GET", `${url}?page_size=200`, { token });
    expect(hidden.body.items.map((i) => i.id)).not.toContain(created.body.id);
    const shown = await t.request<{ items: Row[] }>("GET", `${url}?include_inactive=true&page_size=200`, { token });
    expect(shown.body.items.map((i) => i.id)).toContain(created.body.id);
    const restored = await t.request<{ is_active: boolean }>("POST", `${url}/${created.body.id}/activate`, { token, body: {} });
    expect(restored.status).toBe(200);
    expect(restored.body.is_active).toBe(true);
    const missing = await t.request<ErrorBody>("GET", `${url}/00000000-0000-4000-8000-000000000000`, { token });
    expect(missing.status).toBe(404);
    const csv = await t.request("GET", `${url}?format=csv`, { token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(String(csv.headers["content-disposition"])).toContain(`${c.path}.csv`);
    expect(csv.text.split("\r\n")[0]).toContain("id");
  });
});

describe("list conventions", () => {
  it("sorts by allow-listed fields, rejects others, paginates by offset and by cursor", async () => {
    const url = "/api/v1/masters/room-types";
    for (const [i, name] of ["Living", "Dining", "Toilet", "Balcony"].entries()) await t.request("POST", url, { token, body: { name, code: name.toUpperCase(), sort_order: 10 + i } });
    const sorted = await t.request<{ items: { name: string }[] }>("GET", `${url}?sort=-name`, { token });
    const names = sorted.body.items.map((i) => i.name);
    expect(names).toEqual([...names].sort().reverse());
    const bad = await t.request<ErrorBody>("GET", `${url}?sort=password_hash`, { token });
    expect(bad.status).toBe(400);
    const p1 = await t.request<{ items: { id: string }[]; total: number; page_size: number }>("GET", `${url}?page=1&page_size=2&sort=name`, { token });
    const p2 = await t.request<{ items: { id: string }[]; page: number }>("GET", `${url}?page=2&page_size=2&sort=name`, { token });
    expect(p1.body.items).toHaveLength(2);
    expect(p2.body.page).toBe(2);
    expect(p1.body.items[0]!.id).not.toBe(p2.body.items[0]!.id);
    expect(p1.body.total).toBeGreaterThanOrEqual(5);
    // keyset
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r: { status: number; text: string; body: { items: { id: string }[]; next_cursor: string | null } } = await t.request<{ items: { id: string }[]; next_cursor: string | null }>("GET", `${url}?limit=2&sort=name${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { token });
      expect(r.status, r.text).toBe(200);
      seen.push(...r.body.items.map((x: { id: string }) => x.id));
      cursor = r.body.next_cursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(p1.body.total);
    const badCursor = await t.request<ErrorBody>("GET", `${url}?limit=2&cursor=not-base64`, { token });
    expect(badCursor.status).toBe(400);
    // ETag / 304 on lists
    const first = await t.request("GET", `${url}?sort=name`, { token });
    expect(first.headers["etag"]).toBeTruthy();
    const again = await t.request("GET", `${url}?sort=name`, { token, headers: { "if-none-match": String(first.headers["etag"]) } });
    expect(again.status).toBe(304);
    // escaped search: a literal % must not match everything
    const pct = await t.request<{ total: number }>("GET", `${url}?search=%25`, { token });
    expect(pct.body.total).toBe(0);
  });
});

describe("kind-specific rules", () => {
  it("flat types: computes room sq ft, denormalises areas and enforces super ≥ built-up ≥ carpet", async () => {
    const url = "/api/v1/masters/flat-types";
    const ok = await t.request<{ rooms: { sqft: number; room_type_name: string }[]; carpet_sqft: number; builtup_sqft: number; super_builtup_sqft: number; areas: { area_type_code: string }[] }>("POST", url, { token, body: {
      name: "2BHK-B", code: "2BHK-B", bhk: 2, rooms: [{ room_type_id: basics.roomTypeId, label: "Bedroom", length_ft: 11.5, width_ft: 12 }],
      areas: [{ area_type_id: basics.areaTypes.CARPET, sqft: 780 }, { area_type_id: basics.areaTypes.BUILT_UP, sqft: 930 }, { area_type_id: basics.areaTypes.SUPER_BUILT_UP, sqft: 1130 }], base_price_paise: 650000000,
    } });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.rooms[0]!.sqft).toBe(138);
    expect(ok.body.rooms[0]!.room_type_name).toBe("Bedroom");
    expect(ok.body.carpet_sqft).toBe(780);
    expect(ok.body.builtup_sqft).toBe(930);
    expect(ok.body.super_builtup_sqft).toBe(1130);
    expect(ok.body.areas.map((a) => a.area_type_code)).toEqual(["CARPET", "BUILT_UP", "SUPER_BUILT_UP"]);
    const badOrder = await t.request<ErrorBody>("POST", url, { token, body: {
      name: "Bad", code: "BAD", bhk: 1, rooms: [{ room_type_id: basics.roomTypeId, label: "Room", length_ft: 10, width_ft: 10 }],
      areas: [{ area_type_id: basics.areaTypes.CARPET, sqft: 900 }, { area_type_id: basics.areaTypes.SUPER_BUILT_UP, sqft: 800 }],
    } });
    expect(badOrder.status).toBe(422);
    expect(badOrder.body.error.code).toBe("BUSINESS_RULE");
    expect(badOrder.body.error.details?.["rule"]).toBe("FLAT_TYPE_INVALID");
    expect(JSON.stringify(badOrder.body.error.details)).toContain("AREA_ORDER");
    const both = await t.request<ErrorBody>("POST", url, { token, body: { name: "Both", code: "BOTH", bhk: 1, rooms: [{ room_type_id: basics.roomTypeId, label: "R", length_ft: 10, width_ft: 10 }], areas: [{ area_type_id: basics.areaTypes.CARPET, sqft: 100 }], base_rate_per_sqft_paise: 1, base_price_paise: 1 } });
    expect(both.status).toBe(400);
    const noRooms = await t.request<ErrorBody>("POST", url, { token, body: { name: "NR", code: "NR", bhk: 1, rooms: [], areas: [{ area_type_id: basics.areaTypes.CARPET, sqft: 100 }] } });
    expect(noRooms.status).toBe(400);
    const unknownRoom = await t.request<ErrorBody>("POST", url, { token, body: { name: "UR", code: "UR", bhk: 1, rooms: [{ room_type_id: "00000000-0000-4000-8000-000000000000", label: "R", length_ft: 10, width_ft: 10 }], areas: [{ area_type_id: basics.areaTypes.CARPET, sqft: 100 }] } });
    expect(unknownRoom.status).toBe(400);
  });

  it("a master used elsewhere cannot be deactivated (409 IN_USE with usage details)", async () => {
    const r = await t.request<ErrorBody>("POST", `/api/v1/masters/room-types/${basics.roomTypeId}/deactivate`, { token, body: {} });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("IN_USE");
    expect(Number(r.body.error.details?.["usage_count"])).toBeGreaterThanOrEqual(1);
    expect((r.body.error.details?.["used_by"] as { entity_type: string; count: number }[])[0]!.entity_type).toBe("flat_types");
    const cat = await t.request<ErrorBody>("POST", `/api/v1/masters/spec-categories/${basics.specCategoryId}/deactivate`, { token, body: {} });
    expect(cat.status).toBe(409);
    const usedBy = cat.body.error.details?.["used_by"] as { entity_type: string; count: number }[];
    expect(usedBy[0]!.entity_type).toBe("spec_items");
    expect(usedBy[0]!.count).toBeGreaterThanOrEqual(1);
    const usage = await t.request<{ usage_count: number; used_by: { entity_type: string; count: number }[] }>("GET", `/api/v1/masters/flat-types/${basics.flatTypeId}/usage`, { token });
    expect(usage.body.used_by).toEqual([{ entity_type: "floor_plan_templates", count: 1 }]);
    const stage = await t.request<ErrorBody>("POST", `/api/v1/masters/construction-stages/${basics.stageIds[2]}/deactivate`, { token, body: {} });
    expect(stage.status).toBe(200); // not referenced yet
    expect((await t.request("POST", `/api/v1/masters/construction-stages/${basics.stageIds[2]}/activate`, { token, body: {} })).status).toBe(200);
  });

  it("construction stages: exactly one possession stage; reorder rewrites sort order", async () => {
    const before = await t.request<{ is_possession: boolean }>("GET", `/api/v1/masters/construction-stages/${basics.possessionStageId}`, { token });
    expect(before.body.is_possession).toBe(true);
    const handover = await t.request<{ id: string; is_possession: boolean }>("POST", "/api/v1/masters/construction-stages", { token, body: { name: "Handover", code: "HANDOVER", sort_order: 150, is_possession: true } });
    expect(handover.status, handover.text).toBe(201);
    expect(handover.body.is_possession).toBe(true);
    const after = await t.request<{ is_possession: boolean }>("GET", `/api/v1/masters/construction-stages/${basics.possessionStageId}`, { token });
    expect(after.body.is_possession).toBe(false);
    const rows = await t.app.sql<{ n: number }[]>`select count(*)::int as n from construction_stages where is_possession`;
    expect(rows[0]!.n).toBe(1);
    const ids = [handover.body.id, basics.possessionStageId, ...basics.stageIds];
    const reorder = await t.request<{ items: { id: string; sort_order: number }[] }>("POST", "/api/v1/masters/construction-stages/reorder", { token, body: { stage_ids: ids } });
    expect(reorder.status, reorder.text).toBe(200);
    const order = reorder.body.items.filter((i) => ids.includes(i.id)).map((i) => i.id);
    expect(order).toEqual(ids);
  });

  it("payment plans: percents must total 100.00 and stages must exist (422 with structured errors)", async () => {
    const url = "/api/v1/masters/payment-plans";
    const bad = await t.request<ErrorBody>("POST", url, { token, body: { name: "Broken", code: "BROKEN", plan_type: "CUSTOM", installments: [{ seq: 1, name: "A", percent: 10, trigger_type: "ON_BOOKING" }, { seq: 2, name: "B", percent: 80, trigger_type: "ON_POSSESSION" }] } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("BUSINESS_RULE");
    expect(bad.body.error.details?.["rule"]).toBe("PAYMENT_PLAN_INVALID");
    expect((bad.body.error.details?.["errors"] as { code: string }[]).map((e) => e.code)).toContain("PERCENT_SUM");
    expect(bad.body.error.details?.["total_percent"]).toBe(90);
    const unknownStage = await t.request<ErrorBody>("POST", url, { token, body: { name: "Ghost stage", code: "GHOST", plan_type: "CONSTRUCTION_LINKED", installments: [{ seq: 1, name: "A", percent: 50, trigger_type: "ON_BOOKING" }, { seq: 2, name: "B", percent: 50, trigger_type: "ON_STAGE", trigger_stage_id: "00000000-0000-4000-8000-000000000000" }] } });
    expect(unknownStage.status).toBe(422);
    expect((unknownStage.body.error.details?.["errors"] as { code: string }[]).map((e) => e.code)).toContain("UNKNOWN_STAGE");
    const ok = await t.request<{ id: string; version: number; installments: { seq: number; cumulative_percent: number; trigger_label: string; trigger_stage_name: string | null }[]; assignment_count: number; booking_count: number }>("POST", url, { token, body: {
      name: "Standard CLP", code: "CLP", plan_type: "CONSTRUCTION_LINKED",
      installments: [{ seq: 1, name: "On booking", percent: 10, trigger_type: "ON_BOOKING" }, { seq: 2, name: "Excavation", percent: 40, trigger_type: "ON_STAGE", trigger_stage_id: basics.stageIds[0] }, { seq: 3, name: "Possession", percent: 50, trigger_type: "ON_POSSESSION" }],
    } });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.installments.map((i) => i.cumulative_percent)).toEqual([10, 50, 100]);
    expect(ok.body.installments[1]!.trigger_stage_name).toBe("Excavation");
    expect(ok.body.installments[1]!.trigger_label).toBe("On Excavation");
    expect(ok.body.assignment_count).toBe(0);
    // stage now in use by a plan
    const inUse = await t.request<ErrorBody>("POST", `/api/v1/masters/construction-stages/${basics.stageIds[0]}/deactivate`, { token, body: {} });
    expect(inUse.status).toBe(409);
    // replacing installments on update
    const upd = await t.request<{ installments: { seq: number }[] }>("PATCH", `${url}/${ok.body.id}`, { token, body: { version: ok.body.version, installments: [{ seq: 1, name: "On booking", percent: 100, trigger_type: "ON_BOOKING" }] } });
    expect(upd.status, upd.text).toBe(200);
    expect(upd.body.installments).toHaveLength(1);
    const dupNames = await t.request<ErrorBody>("POST", url, { token, body: { name: "Dup", code: "DUPN", plan_type: "CUSTOM", installments: [{ seq: 1, name: "Same", percent: 50, trigger_type: "ON_BOOKING" }, { seq: 2, name: "same", percent: 50, trigger_type: "ON_POSSESSION" }] } });
    expect(dupNames.status).toBe(422);
    const filtered = await t.request<{ total: number }>("GET", `${url}?plan_type=CONSTRUCTION_LINKED`, { token });
    expect(filtered.body.total).toBe(1);
  });

  it("bank accounts: encrypted at rest, masked on the wire, one default per company", async () => {
    const url = "/api/v1/masters/bank-accounts";
    const a = await t.request<{ id: string; account_number_masked: string; is_default: boolean }>("POST", url, { token, body: { bank_name: "SBI", branch: "Patna Main", account_name: "SGB Escrow", account_number: "30123456789012", ifsc: "SBIN0001234", is_default: true } });
    expect(a.status, a.text).toBe(201);
    expect(a.body.account_number_masked).toBe("XXXXXXXXXX9012");
    expect(a.body.is_default).toBe(true);
    expect(a.text).not.toContain("30123456789012");
    const raw = await t.app.sql<{ account_number_enc: string; account_number_last4: string }[]>`select account_number_enc, account_number_last4 from bank_accounts where id = ${a.body.id}`;
    expect(raw[0]!.account_number_enc).not.toContain("30123456789012");
    expect(raw[0]!.account_number_enc.startsWith("k1.")).toBe(true);
    expect(raw[0]!.account_number_last4).toBe("9012");
    const { decryptField } = await import("../../src/lib/crypto.js");
    expect(decryptField(raw[0]!.account_number_enc)).toBe("30123456789012");
    const defaults = await t.app.sql<{ n: number }[]>`select count(*)::int as n from bank_accounts where is_default`;
    expect(defaults[0]!.n).toBe(1);
    const list = await t.request("GET", url, { token });
    expect(list.text).not.toContain("account_number_enc");
  });

  it("payment modes: codes come from the fixed set and carry the mode's default behaviour", async () => {
    const url = "/api/v1/masters/payment-modes";
    const dd = await t.request<{ requires_instrument: boolean; clears_immediately: boolean; is_cash: boolean }>("POST", url, { token, body: { name: "Demand Draft", code: "DD" } });
    expect(dd.status, dd.text).toBe(201);
    expect(dd.body).toMatchObject({ requires_instrument: true, clears_immediately: false, is_cash: false });
    const cash = await t.request<{ is_cash: boolean; clears_immediately: boolean }>("POST", url, { token, body: { name: "Cash", code: "CASH" } });
    expect(cash.body).toMatchObject({ is_cash: true, clears_immediately: true, requires_instrument: false });
    const bad = await t.request<ErrorBody>("POST", url, { token, body: { name: "Crypto", code: "BITCOIN" } });
    expect(bad.status).toBe(400);
  });

  it("CSV import: previews CREATE/UPDATE/ERROR rows and commits atomically", async () => {
    const csv = ["name,code,sort_order", "Study,STUDY,20", "Kitchen,KITCHEN,2", "Bad Row,,x", "Servant Room,SERVANT,21", "Study Again,STUDY,22"].join("\n");
    const preview = await t.request<{ committed: boolean; rows: { line: number; action: string; errors: string[] }[]; summary: Record<string, number> }>("POST", "/api/v1/masters/import", { token, body: { kind: "ROOM_TYPES", csv } });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.committed).toBe(false);
    expect(preview.body.rows.map((r) => r.action)).toEqual(["CREATE", "UPDATE", "ERROR", "CREATE", "SKIP"]);
    expect(preview.body.rows[2]!.errors.length).toBeGreaterThan(0);
    expect(preview.body.summary).toEqual({ create: 2, update: 1, skip: 1, error: 1 });
    const none = await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where code in ('STUDY', 'SERVANT')`;
    expect(none[0]!.n).toBe(0);
    const refused = await t.request<ErrorBody>("POST", "/api/v1/masters/import", { token, body: { kind: "ROOM_TYPES", csv, commit: true } });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details?.["rule"]).toBe("IMPORT_HAS_ERRORS");
    const good = ["name,code,sort_order", "Study,STUDY,20", "Kitchen (Modular),KITCHEN,2", "Servant Room,SERVANT,21"].join("\r\n");
    const commit = await t.request<{ committed: boolean; summary: Record<string, number> }>("POST", "/api/v1/masters/import", { token, body: { kind: "ROOM_TYPES", csv: good, commit: true } });
    expect(commit.status, commit.text).toBe(200);
    expect(commit.body.committed).toBe(true);
    expect(commit.body.summary).toEqual({ create: 2, update: 1, skip: 0, error: 0 });
    const after = await t.app.sql<{ code: string; name: string }[]>`select code, name from room_types where code in ('STUDY', 'SERVANT', 'KITCHEN') order by code`;
    expect(after.map((r) => r.code)).toEqual(["KITCHEN", "SERVANT", "STUDY"]);
    expect(after.find((r) => r.code === "KITCHEN")!.name).toBe("Kitchen (Modular)");
    const audits = await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs where action in ('room_type.create', 'room_type.update')`;
    expect(audits[0]!.n).toBeGreaterThanOrEqual(3);
    // quoted fields and booleans/arrays for a richer kind
    const docs = 'name,code,applies_to,is_kyc\n"Aadhaar, front",AADHAAR,CUSTOMER|BOOKING,yes\n';
    const docPreview = await t.request<{ rows: { action: string; data: Record<string, unknown> }[] }>("POST", "/api/v1/masters/import", { token, body: { kind: "DOCUMENT_TYPES", csv: docs } });
    expect(docPreview.status, docPreview.text).toBe(200);
    expect(docPreview.body.rows[0]!.action).toBe("CREATE");
    expect(docPreview.body.rows[0]!.data).toMatchObject({ name: "Aadhaar, front", applies_to: ["CUSTOMER", "BOOKING"], is_kyc: true });
  });

  it("validation errors use the uniform envelope", async () => {
    const r = await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", { token, body: { name: "", code: "lower case!" } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION_ERROR");
    const issues = r.body.error.details?.["issues"] as { path: string; message: string }[];
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.map((i) => i.path).sort()).toEqual(["code", "name"]);
    expect(r.body.error.request_id).toBeTruthy();
  });
});
