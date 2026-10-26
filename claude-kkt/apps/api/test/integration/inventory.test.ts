import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FLAT_TYPE_SPECS,
  createInventoryBasics,
  post,
  projectBody,
  rateCardBody,
  towerCBody,
  type InventoryBasics,
} from "./fixtures/inventory.js";
import { buildTestApp, CREDS, type ErrorBody, ifMatch, type TestContext, versionOf } from "./helpers.js";

type UnitCounts = { available: number; hold: number; blocked: number; booked: number; sold: number; total: number };
type ProjectRow = {
  id: string;
  version: number;
  name: string;
  code: string;
  block_count: number;
  unit_counts: UnitCounts;
  amenity_ids: string[];
  team: { user_id: string; user_name: string; role_label: string | null }[];
  stage_sequence: string[];
  is_active: boolean;
  construction_percent: number;
};
type BlockRow = {
  id: string;
  version: number;
  code: string;
  floors: number;
  unit_counts: UnitCounts;
  has_flats: boolean;
  floor_plans: { template_name: string }[];
  stage_sequence: string[];
  refuge_floors: number[];
  skip_floors: number[];
};
type Breakup = { label: string; amount_paise: number }[];
type FlatRow = {
  id: string;
  version: number;
  flat_number: string;
  floor: number;
  position: number;
  status: string;
  flat_type_code: string;
  flat_type_id: string;
  is_corner: boolean;
  facing: string | null;
  rooms_snapshot: { label: string; sqft: number }[];
  areas_snapshot: { area_type_code: string; sqft: number }[];
  carpet_sqft: number;
  builtup_sqft: number;
  super_builtup_sqft: number;
  price_paise: number;
  rate_per_sqft_paise: number | null;
  price_breakup: Breakup;
  rate_card_id: string | null;
  hold_by_user_id: string | null;
  hold_by_name: string | null;
  hold_until: string | null;
  booking_id: string | null;
  parking_slot_numbers: string[];
  notes: string | null;
};
type FlatDetail = FlatRow & {
  specifications: { category: string; name: string }[];
  history: { action: string; actor_name: string | null }[];
};
type List<T> = { items: T[]; total: number; page: number; page_size: number; next_cursor: string | null };
type Grid = {
  positions: number;
  floors: {
    floor: number;
    floor_label: string;
    kind: string;
    cells: { flat_number: string; position: number; status: string; price_band: number }[];
  }[];
  legend: {
    by_status: Record<string, number>;
    by_flat_type: { code: string; count: number }[];
    price_bands: { count: number }[];
  };
  unit_counts: UnitCounts;
};
type RateCard = {
  id: string;
  version: number;
  status: string;
  name: string;
  rates: { flat_type_code: string; rate_per_sqft_paise: number | null }[];
  plc_rules: { plc_type_name: string; calc_mode: string }[];
  applied?: { repriced: number; skipped_not_available: number; skipped_no_rate: number } | null;
};
type Slot = {
  id: string;
  version: number;
  number: string;
  status: string;
  slot_type: string;
  level: string | null;
  price_paise: number;
};

const A3 = FLAT_TYPE_SPECS.A3;
const CORNER = 10_000 * A3.superb; // ₹100/sq ft × 1520
const RISE = 2500 * A3.superb; // ₹25/sq ft/floor × 1520
const A3_BASE = A3.rate * A3.superb;
const NO_ID = "00000000-0000-4000-8000-000000000000";

let t: TestContext;
let admin: string;
let adminId: string;
let sales: string;
let basics: InventoryBasics;
let sgh: ProjectRow;
let ggv: ProjectRow;
let card1: RateCard;
let towerC: BlockRow;
let flatsByNumber: Map<string, FlatRow>;
let paSgh: string; // Project Admin scoped to SGH only

async function reloadFlats(blockId: string): Promise<Map<string, FlatRow>> {
  const r = await t.request<List<FlatRow>>("GET", `/api/v1/flats?block_id=${blockId}&page_size=200&sort=flat_number`, {
    token: admin,
  });
  expect(r.status, r.text).toBe(200);
  return new Map(r.body.items.map((f) => [f.flat_number, f]));
}

async function getBlock(id: string): Promise<BlockRow> {
  const r = await t.request<BlockRow>("GET", `/api/v1/blocks/${id}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

async function getProject(id: string): Promise<ProjectRow> {
  const r = await t.request<ProjectRow>("GET", `/api/v1/projects/${id}`, { token: admin });
  expect(r.status, r.text).toBe(200);
  return r.body;
}

beforeAll(async () => {
  t = await buildTestApp();
  const a = await t.loginAs("admin");
  admin = a.access_token;
  adminId = a.user.id;
  sales = (await t.loginAs("sales")).access_token;
  basics = await createInventoryBasics(t, admin);
});
afterAll(async () => {
  await t?.close();
});

describe("projects (SPEC §4)", () => {
  it("creates projects with amenities, team, approvals, landmarks and a default stage sequence from the master order", async () => {
    const [salesUser] = await t.app.sql<{ id: string }[]>`select id from users where email = ${CREDS.sales.email}`;
    const created = await t.request<ProjectRow>("POST", "/api/v1/projects", {
      token: admin,
      body: projectBody("Shree Ganesh Heights", "SGH", {
        amenity_ids: basics.amenityIds,
        team: [{ user_id: salesUser!.id, role_label: "Sales lead" }],
      }),
      headers: { "idempotency-key": "proj-sgh-0001" },
    });
    expect(created.status, created.text).toBe(201);
    sgh = created.body;
    expect(sgh.version).toBe(1);
    expect(sgh.block_count).toBe(0);
    expect(sgh.unit_counts).toEqual({ available: 0, hold: 0, blocked: 0, booked: 0, sold: 0, total: 0 });
    expect(sgh.amenity_ids.sort()).toEqual([...basics.amenityIds].sort());
    expect(sgh.team).toEqual([{ user_id: salesUser!.id, user_name: "Ankit Verma", role_label: "Sales lead" }]);
    expect(sgh.stage_sequence).toEqual(basics.stageIds); // master order (sort_order)
    const replay = await t.request<ProjectRow>("POST", "/api/v1/projects", {
      token: admin,
      body: projectBody("Shree Ganesh Heights", "SGH", {
        amenity_ids: basics.amenityIds,
        team: [{ user_id: salesUser!.id, role_label: "Sales lead" }],
      }),
      headers: { "idempotency-key": "proj-sgh-0001" },
    });
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.id).toBe(sgh.id);
    const dup = await t.request<ErrorBody>("POST", "/api/v1/projects", {
      token: admin,
      body: projectBody("Another", "SGH"),
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
    ggv = (
      await t.request<ProjectRow>("POST", "/api/v1/projects", {
        token: admin,
        body: projectBody("Ganesh Green Villas", "GGV", {
          status: "READY",
          stage_sequence: [basics.stageIds[0], basics.possessionStageId],
        }),
      })
    ).body;
    expect(ggv.stage_sequence).toEqual([basics.stageIds[0], basics.possessionStageId]);
    const badDates = await t.request<ErrorBody>("POST", "/api/v1/projects", {
      token: admin,
      body: projectBody("Bad", "BAD", { launch_date: "2026-01-01", possession_date: "2025-01-01" }),
    });
    expect(badDates.status).toBe(400);
    const unknownAmenity = await t.request<ErrorBody>("POST", "/api/v1/projects", {
      token: admin,
      body: projectBody("Bad", "BAD2", { amenity_ids: [NO_ID] }),
    });
    expect(unknownAmenity.status).toBe(400);
  });

  it("lists, searches, sorts and exports projects; get returns the row", async () => {
    const list = await t.request<List<ProjectRow>>("GET", "/api/v1/projects?search=ganesh&sort=code", { token: admin });
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((p) => p.code)).toEqual(["GGV", "SGH"]);
    const filtered = await t.request<List<ProjectRow>>("GET", "/api/v1/projects?status=READY", { token: admin });
    expect(filtered.body.items.map((p) => p.code)).toEqual(["GGV"]);
    const csv = await t.request("GET", "/api/v1/projects?format=csv", { token: admin });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(csv.text).toContain("SGH");
    expect((await t.request("GET", `/api/v1/projects/${NO_ID}`, { token: admin })).status).toBe(404);
    const bad = await t.request<ErrorBody>("GET", "/api/v1/projects?sort=password_hash", { token: admin });
    expect(bad.status).toBe(400);
  });

  it("patches with version (If-Match too), rejects stale versions, and edits the stage sequence while every block stage is pending", async () => {
    const patched = await t.request<ProjectRow>("PATCH", `/api/v1/projects/${sgh.id}`, {
      token: admin,
      body: {
        version: sgh.version,
        description: "Premium towers on Bailey Road",
        amenity_ids: [basics.amenityIds[0]],
        landmarks: [{ name: "Airport", distance_km: 4 }],
      },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.version).toBe(2);
    expect(patched.body.amenity_ids).toEqual([basics.amenityIds[0]]);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${sgh.id}`, {
      token: admin,
      body: { version: 1, description: "x" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(2);
    const seq = await t.request<ProjectRow>("POST", `/api/v1/projects/${sgh.id}/stage-sequence`, {
      token: admin,
      body: { stage_sequence: [...basics.stageIds].reverse() },
      headers: { "if-match": '"2"' },
    });
    expect(seq.status, seq.text).toBe(200);
    expect(seq.body.stage_sequence).toEqual([...basics.stageIds].reverse());
    const back = await t.request<ProjectRow>("PATCH", `/api/v1/projects/${sgh.id}`, {
      token: admin,
      body: { version: 3, stage_sequence: basics.stageIds },
    });
    expect(back.status, back.text).toBe(200);
    sgh = back.body;
    expect(sgh.version).toBe(4);
    const noVersion = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${sgh.id}`, {
      token: admin,
      body: { description: "x" },
    });
    expect(noVersion.status).toBe(428);
    const forbidden = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${sgh.id}`, {
      token: sales,
      body: { version: 4, description: "x" },
    });
    expect(forbidden.status).toBe(403);
  });
});

describe("rate cards (SPEC §5)", () => {
  it("creates a Draft card with rates and PLC rules, edits it, then activates it", async () => {
    const created = await t.request<RateCard>("POST", "/api/v1/rate-cards", {
      token: admin,
      body: rateCardBody(sgh.id, basics, "SGH-2025"),
    });
    expect(created.status, created.text).toBe(201);
    card1 = created.body;
    expect(card1.status).toBe("DRAFT");
    expect(card1.rates).toHaveLength(4);
    expect(card1.plc_rules.map((r) => r.plc_type_name)).toEqual(["Floor Rise", "Corner"]);
    const unknownType = await t.request<ErrorBody>("POST", "/api/v1/rate-cards", {
      token: admin,
      body: { ...rateCardBody(sgh.id, basics, "Bad"), rates: [{ flat_type_id: NO_ID, rate_per_sqft_paise: 1 }] },
    });
    expect(unknownType.status).toBe(400);
    const bothRate = await t.request<ErrorBody>("POST", "/api/v1/rate-cards", {
      token: admin,
      body: {
        ...rateCardBody(sgh.id, basics, "Bad"),
        rates: [{ flat_type_id: basics.flatTypes.A3, rate_per_sqft_paise: 1, lump_sum_paise: 1 }],
      },
    });
    expect(bothRate.status).toBe(400);
    const patched = await t.request<RateCard>("PATCH", `/api/v1/rate-cards/${card1.id}`, {
      token: admin,
      body: { version: 1, name: "SGH-2025 (launch)" },
    });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.name).toBe("SGH-2025 (launch)");
    expect(patched.body.plc_rules).toHaveLength(2); // children untouched when not sent
    const applyDraft = await t.request<ErrorBody>("POST", `/api/v1/rate-cards/${card1.id}/apply`, {
      token: admin,
      body: {},
    });
    expect(applyDraft.status).toBe(422);
    expect(applyDraft.body.error.details?.["rule"]).toBe("RATE_CARD_NOT_ACTIVE");
    const activated = await t.request<RateCard>("POST", `/api/v1/rate-cards/${card1.id}/activate`, {
      token: admin,
      body: { version: 2 },
    });
    expect(activated.status, activated.text).toBe(200);
    expect(activated.body.status).toBe("ACTIVE");
    expect(activated.body.applied).toEqual({
      rate_card_id: card1.id,
      dry_run: false,
      repriced: 0,
      skipped_not_available: 0,
      skipped_no_rate: 0,
    });
    card1 = activated.body;
    const editActive = await t.request<ErrorBody>("PATCH", `/api/v1/rate-cards/${card1.id}`, {
      token: admin,
      body: { version: card1.version, name: "x" },
    });
    expect(editActive.status).toBe(422);
    expect(editActive.body.error.details?.["rule"]).toBe("RATE_CARD_NOT_DRAFT");
    const noPerm = await t.request<ErrorBody>("POST", "/api/v1/rate-cards", {
      token: sales,
      body: rateCardBody(sgh.id, basics, "X"),
    });
    expect(noPerm.status).toBe(403);
  });
});

describe("blocks & flat generation (SPEC §4, §18 scenario 2)", () => {
  it("Tower C: 15 floors, skip 13, refuge 7 → exactly 52 flats, numbered C-101…C-1504 with no C-13xx / C-7xx, snapshots and PLC breakups", async () => {
    const created = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(sgh.id, basics),
    });
    expect(created.status, created.text).toBe(201);
    towerC = created.body;
    expect(towerC.has_flats).toBe(true);
    expect(towerC.unit_counts).toEqual({ available: 52, hold: 0, blocked: 0, booked: 0, sold: 0, total: 52 });
    expect(towerC.floor_plans.map((p) => p.template_name)).toEqual(["FP-4", "FP-4-PREMIUM"]);
    expect(towerC.stage_sequence).toEqual(basics.stageIds); // defaults to the project's sequence
    const stages = await t.app.sql<
      { stage_id: string; status: string; sort_order: number }[]
    >`select stage_id, status, sort_order from block_stages where block_id = ${towerC.id} order by sort_order`;
    expect(stages.map((s) => s.stage_id)).toEqual(basics.stageIds);
    expect(stages.every((s) => s.status === "PENDING")).toBe(true);

    flatsByNumber = await reloadFlats(towerC.id);
    expect(flatsByNumber.size).toBe(52);
    const numbers = [...flatsByNumber.keys()];
    expect(numbers.every((n) => /^C-\d{3,4}$/.test(n))).toBe(true);
    expect(numbers.some((n) => n.startsWith("C-13"))).toBe(false);
    expect(numbers.some((n) => n.startsWith("C-7"))).toBe(false);
    for (const n of ["C-101", "C-104", "C-601", "C-1201", "C-1401", "C-1504"])
      expect(flatsByNumber.has(n), n).toBe(true);
    const floors = new Set([...flatsByNumber.values()].map((f) => f.floor));
    expect([...floors].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15]);

    const c101 = flatsByNumber.get("C-101")!;
    expect(c101.flat_type_code).toBe("3BHK-A");
    expect(c101.is_corner).toBe(true);
    expect(c101.facing).toBe("E");
    expect(c101.rooms_snapshot.map((r) => [r.label, r.sqft])).toEqual([
      ["Master Bedroom", 168],
      ["Bedroom 2", 132],
    ]);
    expect(c101.areas_snapshot.map((a) => [a.area_type_code, a.sqft])).toEqual([
      ["CARPET", 1050],
      ["BUILT_UP", 1250],
      ["SUPER_BUILT_UP", 1520],
    ]);
    expect([c101.carpet_sqft, c101.builtup_sqft, c101.super_builtup_sqft]).toEqual([1050, 1250, 1520]);
    expect(c101.rate_card_id).toBe(card1.id);
    expect(c101.rate_per_sqft_paise).toBe(A3.rate);
    expect(c101.price_breakup.map((l) => l.label)).toEqual([expect.stringContaining("Base price"), "Corner"]); // floor 1 → no floor rise
    expect(c101.price_paise).toBe(A3_BASE + CORNER);

    const c1504 = flatsByNumber.get("C-1504")!;
    expect(c1504.price_breakup.map((l) => l.label)).toEqual([
      expect.stringContaining("Base price"),
      "Floor Rise",
      "Corner",
    ]);
    expect(c1504.price_breakup.find((l) => l.label === "Floor Rise")!.amount_paise).toBe(14 * RISE);
    expect(c1504.price_paise).toBe(A3_BASE + 14 * RISE + CORNER);
    expect(c1504.price_breakup.reduce((s, l) => s + l.amount_paise, 0)).toBe(c1504.price_paise);

    const c102 = flatsByNumber.get("C-102")!;
    expect(c102.flat_type_code).toBe("2BHK-A");
    expect(c102.is_corner).toBe(false);
    expect(c102.price_paise).toBe(FLAT_TYPE_SPECS.A2.rate * FLAT_TYPE_SPECS.A2.superb);
    expect(c102.price_breakup.some((l) => l.label === "Corner")).toBe(false);

    const project = await getProject(sgh.id);
    expect(project.block_count).toBe(1);
    expect(project.unit_counts.total).toBe(52);
    const dupCode = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(sgh.id, basics),
    });
    expect(dupCode.status).toBe(409);
    expect(dupCode.body.error.code).toBe("DUPLICATE");
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from flats where project_id = ${sgh.id}`)[0]!.n,
    ).toBe(52); // failed create wrote nothing
  });

  it("rejects structures with uncovered floors or unknown templates (400) and inactive flat types (422) without creating anything", async () => {
    const gap = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(sgh.id, basics, {
        code: "G",
        floor_plans: [{ from_floor: 1, to_floor: 5, floor_plan_template_id: basics.templates.FP4 }],
      }),
    });
    expect(gap.status).toBe(400);
    const unknownTemplate = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(sgh.id, basics, {
        code: "G",
        floor_plans: [{ from_floor: 1, to_floor: 15, floor_plan_template_id: NO_ID }],
      }),
    });
    expect(unknownTemplate.status).toBe(400);
    const preview = await t.request<{
      total_flats: number;
      floors: { floor: number; kind: string; cells: unknown[] }[];
      total_value_paise: number;
    }>("POST", "/api/v1/blocks/preview", { token: admin, body: { ...towerCBody(sgh.id, basics), code: "Z" } });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.total_flats).toBe(52);
    expect(preview.body.floors[0]!.floor).toBe(15);
    expect(preview.body.floors.find((f) => f.floor === 7)!.kind).toBe("REFUGE");
    expect(
      (await t.app.sql<{ n: number }[]>`select count(*)::int as n from blocks where project_id = ${sgh.id}`)[0]!.n,
    ).toBe(1);
  });

  it("grid: floors descending, 4 positions across, refuge row flagged with no cells, legend counts", async () => {
    const r = await t.request<Grid>("GET", `/api/v1/blocks/${towerC.id}/grid`, { token: admin });
    expect(r.status, r.text).toBe(200);
    const g = r.body;
    expect(g.positions).toBe(4);
    expect(g.floors.map((f) => f.floor)).toEqual([15, 14, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const refuge = g.floors.find((f) => f.floor === 7)!;
    expect(refuge.kind).toBe("REFUGE");
    expect(refuge.cells).toEqual([]);
    expect(g.floors.filter((f) => f.kind === "UNITS")).toHaveLength(13);
    expect(g.floors[0]!.cells.map((c) => c.flat_number)).toEqual(["C-1501", "C-1502", "C-1503", "C-1504"]);
    expect(g.legend.by_status).toEqual({ AVAILABLE: 52, HOLD: 0, BLOCKED: 0, BOOKED: 0, SOLD: 0 });
    expect(g.legend.by_flat_type.map((x) => [x.code, x.count])).toEqual([
      ["2BHK-A", 5],
      ["2BHK-B", 5],
      ["3BHK-A", 37],
      ["3BHK-B", 5],
    ]);
    expect(g.legend.price_bands.reduce((s, b) => s + b.count, 0)).toBe(52);
    expect(g.unit_counts.total).toBe(52);
    const byType = await t.request<Grid>("GET", `/api/v1/blocks/${towerC.id}/grid?colour_by=FLAT_TYPE`, {
      token: admin,
    });
    expect(byType.status).toBe(200);
  });

  it("flat drawer: specifications from the type's spec items, history from the audit log, price breakup, no booking", async () => {
    const c101 = flatsByNumber.get("C-101")!;
    const r = await t.request<FlatDetail>("GET", `/api/v1/flats/${c101.id}`, { token: admin });
    expect(r.status, r.text).toBe(200);
    expect(r.body.specifications).toEqual([
      { category: "Flooring", name: "Vitrified tiles", description: "800x800 double charged" },
    ]);
    expect(r.body.history.map((h) => h.action)).toContain("flat.generate");
    expect(r.body.booking_id).toBeNull();
    expect(r.body.parking_slot_numbers).toEqual([]);
    expect(r.body.price_breakup).toHaveLength(2);
    expect((await t.request("GET", `/api/v1/flats/${NO_ID}`, { token: admin })).status).toBe(404);
  });
});

describe("flat status transitions (SPEC §4)", () => {
  it("HOLD records hold_by/hold_until (company default 48 h); BOOKED/SOLD rejected 422; another user's HOLD needs settings.manage; AVAILABLE releases", async () => {
    const roles = await t.request<List<{ id: string; name: string }>>("GET", "/api/v1/roles", { token: admin });
    const paRole = roles.body.items.find((r) => r.name === "Project Admin")!;
    const pa = await t.request<{ id: string }>("POST", "/api/v1/users", {
      token: admin,
      body: {
        name: "PA SGH",
        email: "pa.sgh@sgb.in",
        role_id: paRole.id,
        all_projects: false,
        project_ids: [sgh.id],
        password: "Project@12345",
        must_change_password: false,
      },
    });
    expect(pa.status, pa.text).toBe(201);
    paSgh = (await t.login("pa.sgh@sgb.in", "Project@12345")).access_token;

    const c301 = flatsByNumber.get("C-301")!;
    const before = Date.now();
    const hold = await t.request<FlatRow>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: admin,
      body: { version: c301.version, status: "HOLD", reason: "Token advance expected" },
    });
    expect(hold.status, hold.text).toBe(200);
    expect(hold.body.status).toBe("HOLD");
    expect(hold.body.hold_by_user_id).toBe(adminId);
    expect(hold.body.hold_by_name).toBe("Suresh Agarwal");
    const until = new Date(hold.body.hold_until!).getTime() - before;
    expect(until).toBeGreaterThan(47.5 * 3600_000);
    expect(until).toBeLessThan(48.5 * 3600_000);
    expect(hold.body.notes).toBe("Token advance expected");

    const booked = await t.request<ErrorBody>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: admin,
      body: { version: hold.body.version, status: "BOOKED" },
    });
    expect(booked.status).toBe(422);
    expect(booked.body.error.code).toBe("BUSINESS_RULE");
    expect(booked.body.error.message).toContain("booking engine");
    const sold = await t.request<ErrorBody>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: admin,
      body: { version: hold.body.version, status: "SOLD" },
    });
    expect(sold.status).toBe(422);

    const foreignRelease = await t.request<ErrorBody>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: paSgh,
      body: { version: hold.body.version, status: "AVAILABLE" },
    });
    expect(foreignRelease.status).toBe(403);
    expect(foreignRelease.body.error.details?.["permission"]).toBe("settings.manage");
    const salesNoPerm = await t.request<ErrorBody>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: sales,
      body: { version: hold.body.version, status: "BLOCKED" },
    });
    expect(salesNoPerm.status).toBe(403);

    const released = await t.request<FlatRow>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: admin,
      body: { status: "AVAILABLE" },
      headers: { "if-match": `"${hold.body.version}"` },
    });
    expect(released.status, released.text).toBe(200);
    expect(released.body.status).toBe("AVAILABLE");
    expect(released.body.hold_by_user_id).toBeNull();
    expect(released.body.hold_until).toBeNull();
    const same = await t.request<ErrorBody>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: admin,
      body: { version: released.body.version, status: "AVAILABLE" },
    });
    expect(same.status).toBe(422);
    expect(same.body.error.details?.["rule"]).toBe("NO_CHANGE");

    // the scoped Project Admin may hold a flat of their own project; explicit hold_until is honoured
    const own = await t.request<FlatRow>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: paSgh,
      body: { version: released.body.version, status: "HOLD", hold_until: "2030-01-01T00:00:00.000Z" },
    });
    expect(own.status, own.text).toBe(200);
    expect(own.body.hold_until).toBe("2030-01-01T00:00:00.000Z");
    const adminReleases = await t.request<FlatRow>("POST", `/api/v1/flats/${c301.id}/status`, {
      token: admin,
      body: { version: own.body.version, status: "HOLD" },
    });
    expect(adminReleases.status, adminReleases.text).toBe(200); // settings.manage may take over a hold
    expect(adminReleases.body.hold_by_user_id).toBe(adminId);

    const block = await getBlock(towerC.id);
    expect(block.unit_counts).toEqual({ available: 51, hold: 1, blocked: 0, booked: 0, sold: 0, total: 52 });
    expect((await getProject(sgh.id)).unit_counts.hold).toBe(1);
    const detail = await t.request<FlatDetail>("GET", `/api/v1/flats/${c301.id}`, { token: admin });
    expect(detail.body.history.filter((h) => h.action === "flat.status").length).toBeGreaterThanOrEqual(4);
    flatsByNumber = await reloadFlats(towerC.id);
  });

  it("regenerate is blocked (409 REGENERATE_BLOCKED) once a flat is on HOLD; structural edits too", async () => {
    const block = await getBlock(towerC.id);
    const r = await t.request<ErrorBody>("POST", `/api/v1/blocks/${towerC.id}/generate-flats`, {
      token: admin,
      body: { version: block.version, regenerate: true },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("REGENERATE_BLOCKED");
    expect(r.body.error.details?.["non_available"]).toBe(1);
    expect(r.body.error.details?.["total"]).toBe(52);
    expect(flatsByNumber.size).toBe(52);
    const structural = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${towerC.id}`, {
      token: admin,
      body: { version: block.version, skip_floors: [13, 4] },
    });
    expect(structural.status).toBe(422);
    expect(structural.body.error.details?.["rule"]).toBe("FLATS_NOT_AVAILABLE");
    const deact = await t.request<ErrorBody>("POST", `/api/v1/blocks/${towerC.id}/deactivate`, {
      token: admin,
      body: {},
      headers: ifMatch(await versionOf(t, `/api/v1/blocks/${towerC.id}`, admin)),
    });
    expect(deact.status).toBe(409);
    expect(deact.body.error.code).toBe("IN_USE");
  });

  it("regenerate works on a block whose flats are all Available (and generate on a block created without flats)", async () => {
    const d = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(sgh.id, basics, {
        name: "Tower D",
        code: "D",
        floors: 2,
        skip_floors: [],
        refuge_floors: [],
        floor_plans: [{ from_floor: 1, to_floor: 2, floor_plan_template_id: basics.templates.FP4 }],
        generate_flats: false,
      }),
    });
    expect(d.status, d.text).toBe(201);
    expect(d.body.has_flats).toBe(false);
    expect(d.body.unit_counts.total).toBe(0);
    const gen = await t.request<{ flats_created: number; floors_with_units: number; version: number }>(
      "POST",
      `/api/v1/blocks/${d.body.id}/generate-flats`,
      { token: admin, body: { version: d.body.version } },
    );
    expect(gen.status, gen.text).toBe(200);
    expect(gen.body.flats_created).toBe(8);
    expect(gen.body.floors_with_units).toBe(2);
    const again = await t.request<ErrorBody>("POST", `/api/v1/blocks/${d.body.id}/generate-flats`, {
      token: admin,
      body: { version: gen.body.version },
    });
    expect(again.status).toBe(422);
    expect(again.body.error.details?.["rule"]).toBe("REGENERATE_REQUIRED");
    const regen = await t.request<{ flats_created: number; version: number }>(
      "POST",
      `/api/v1/blocks/${d.body.id}/generate-flats`,
      { token: admin, body: { version: gen.body.version, regenerate: true } },
    );
    expect(regen.status, regen.text).toBe(200);
    expect(regen.body.flats_created).toBe(8);
    expect((await getProject(sgh.id)).block_count).toBe(2);
    const deact = await t.request<{ is_active: boolean }>("POST", `/api/v1/blocks/${d.body.id}/deactivate`, {
      token: admin,
      body: {},
      headers: ifMatch(await versionOf(t, `/api/v1/blocks/${d.body.id}`, admin)),
    });
    expect(deact.status, deact.text).toBe(200);
    const proj = await getProject(sgh.id);
    expect(proj.block_count).toBe(1);
    expect(proj.unit_counts.total).toBe(52);
    expect(
      (await t.request<List<BlockRow>>("GET", `/api/v1/blocks?project_id=${sgh.id}`, { token: admin })).body.items.map(
        (b) => b.code,
      ),
    ).toEqual(["C"]);
    expect(
      (
        await t.request<List<BlockRow>>("GET", `/api/v1/blocks?project_id=${sgh.id}&include_inactive=true`, {
          token: admin,
        })
      ).body.total,
    ).toBe(2);
  });

  it("append floors adds exactly 4 more flats and keeps the existing ones", async () => {
    const block = await getBlock(towerC.id);
    const bad = await t.request<ErrorBody>("POST", `/api/v1/blocks/${towerC.id}/floors`, {
      token: admin,
      body: {
        version: block.version,
        new_floors: 1,
        floor_plans: [{ from_floor: 15, to_floor: 16, floor_plan_template_id: basics.templates.FP4P }],
      },
    });
    expect(bad.status).toBe(400);
    const r = await t.request<{ flats_created: number; floors_with_units: number; version: number }>(
      "POST",
      `/api/v1/blocks/${towerC.id}/floors`,
      {
        token: admin,
        body: {
          version: block.version,
          new_floors: 1,
          floor_plans: [{ from_floor: 16, to_floor: 16, floor_plan_template_id: basics.templates.FP4P }],
        },
      },
    );
    expect(r.status, r.text).toBe(200);
    expect(r.body.flats_created).toBe(4);
    expect(r.body.floors_with_units).toBe(14);
    expect(r.body.version).toBe(block.version + 1);
    flatsByNumber = await reloadFlats(towerC.id);
    expect(flatsByNumber.size).toBe(56);
    for (const n of ["C-1601", "C-1602", "C-1603", "C-1604"]) expect(flatsByNumber.has(n), n).toBe(true);
    expect(flatsByNumber.get("C-1601")!.price_paise).toBe(A3_BASE + 15 * RISE + CORNER);
    expect(flatsByNumber.get("C-301")!.status).toBe("HOLD"); // untouched
    const after = await getBlock(towerC.id);
    expect(after.floors).toBe(16);
    expect(after.unit_counts).toEqual({ available: 55, hold: 1, blocked: 0, booked: 0, sold: 0, total: 56 });
    const grid = await t.request<Grid>("GET", `/api/v1/blocks/${towerC.id}/grid`, { token: admin });
    expect(grid.body.floors[0]!.floor).toBe(16);
    expect(grid.body.floors).toHaveLength(15);
  });

  it("block PATCH honours version (409 VERSION_CONFLICT with current and changed_by) and If-Match", async () => {
    const block = await getBlock(towerC.id);
    const ok = await t.request<BlockRow>("PATCH", `/api/v1/blocks/${towerC.id}`, {
      token: admin,
      body: { version: block.version, name: "Tower C (Lake View)" },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.version).toBe(block.version + 1);
    const stale = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${towerC.id}`, {
      token: admin,
      body: { version: block.version, name: "Tower C" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.details?.["current"]).toBe(block.version + 1);
    expect(stale.body.error.details?.["changed_by"]).toBe("Suresh Agarwal");
    const header = await t.request<BlockRow>("PATCH", `/api/v1/blocks/${towerC.id}`, {
      token: admin,
      body: { name: "Tower C" },
      headers: { "if-match": `"${block.version + 1}"` },
    });
    expect(header.status, header.text).toBe(200);
    expect(header.body.version).toBe(block.version + 2);
    const noVersion = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${towerC.id}`, {
      token: admin,
      body: { name: "x" },
    });
    expect(noVersion.status).toBe(428);
    const forbidden = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${towerC.id}`, {
      token: sales,
      body: { version: block.version + 2, name: "x" },
    });
    expect(forbidden.status).toBe(403);
  });

  it("bulk-status and bulk-price (floor-rise step) touch only eligible flats and refresh unit counts", async () => {
    const floor4 = [...flatsByNumber.values()]
      .filter((f) => f.floor === 4)
      .slice(0, 2)
      .map((f) => f.id);
    const c301 = flatsByNumber.get("C-301")!;
    // the scoped Project Admin may block Available flats but cannot touch the admin's HOLD (skipped, not failed)
    const bulk = await t.request<{ updated: number; skipped: number; skipped_ids: string[] }>(
      "POST",
      `/api/v1/blocks/${towerC.id}/bulk-status`,
      { token: paSgh, body: { flat_ids: [...floor4, c301.id], status: "BLOCKED", reason: "Reserved for landowner" } },
    );
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body.updated).toBe(2);
    expect(bulk.body.skipped).toBe(1);
    expect(bulk.body.skipped_ids).toEqual([c301.id]);
    const block = await getBlock(towerC.id);
    expect(block.unit_counts).toEqual({ available: 53, hold: 1, blocked: 2, booked: 0, sold: 0, total: 56 });
    expect((await getProject(sgh.id)).unit_counts.blocked).toBe(2);
    const otherBlock = await t.request<ErrorBody>("POST", `/api/v1/blocks/${NO_ID}/bulk-status`, {
      token: admin,
      body: { flat_ids: floor4, status: "AVAILABLE" },
    });
    expect(otherBlock.status).toBe(404);

    const price = await t.request<{ updated: number; skipped: number }>(
      "POST",
      `/api/v1/blocks/${towerC.id}/bulk-price`,
      {
        token: admin,
        body: { block_id: towerC.id, floors: [2], rate_per_sqft_paise: 600_000, floor_rise_step_paise: 1000 },
      },
    );
    expect(price.status, price.text).toBe(200);
    expect(price.body).toMatchObject({ updated: 4, skipped: 0 });
    flatsByNumber = await reloadFlats(towerC.id);
    const c201 = flatsByNumber.get("C-201")!;
    expect(c201.price_paise).toBe(600_000 * A3.superb + 1000 * 1 * A3.superb);
    expect(c201.price_breakup.map((l) => l.label)).toEqual([expect.stringContaining("Base price"), "Floor rise"]);
    expect(c201.rate_card_id).toBeNull();
    const skipHold = await t.request<{ updated: number; skipped: number; skipped_ids: string[] }>(
      "POST",
      `/api/v1/blocks/${towerC.id}/bulk-price`,
      { token: admin, body: { block_id: towerC.id, flat_ids: [c301.id, c201.id], price_paise: 1 } },
    );
    expect(skipHold.status, skipHold.text).toBe(200);
    expect(skipHold.body.updated).toBe(1);
    expect(skipHold.body.skipped_ids).toEqual([c301.id]);
    flatsByNumber = await reloadFlats(towerC.id);
    expect(flatsByNumber.get("C-301")!.price_paise).toBe(A3_BASE + 2 * RISE + CORNER); // HOLD keeps its price
    expect(flatsByNumber.get("C-201")!.price_paise).toBe(1);
    const mismatch = await t.request<ErrorBody>("POST", `/api/v1/blocks/${towerC.id}/bulk-price`, {
      token: admin,
      body: { block_id: NO_ID, price_paise: 1 },
    });
    expect(mismatch.status).toBe(400);
  });

  it("flat PATCH (notes), direct price with breakup (flat.write), and flat-type change re-snapshots only while Available", async () => {
    const c102 = flatsByNumber.get("C-102")!;
    const notes = await t.request<FlatRow>("PATCH", `/api/v1/flats/${c102.id}`, {
      token: admin,
      body: { version: c102.version, notes: "Corner view", is_corner: true },
    });
    expect(notes.status, notes.text).toBe(200);
    expect(notes.body.notes).toBe("Corner view");
    expect(notes.body.is_corner).toBe(true);
    const badBreakup = await t.request<ErrorBody>("POST", `/api/v1/flats/${c102.id}/price`, {
      token: admin,
      body: { version: notes.body.version, price_paise: 100, price_breakup: [{ label: "Base", amount_paise: 90 }] },
    });
    expect(badBreakup.status).toBe(400);
    const priced = await t.request<FlatRow>("POST", `/api/v1/flats/${c102.id}/price`, {
      token: admin,
      body: {
        version: notes.body.version,
        price_paise: 50_000_000_000,
        price_breakup: [
          { label: "Base", amount_paise: 49_000_000_000 },
          { label: "Garden PLC", amount_paise: 1_000_000_000 },
        ],
        reason: "Negotiated",
      },
    });
    expect(priced.status, priced.text).toBe(200);
    expect(priced.body.price_paise).toBe(50_000_000_000);
    expect(priced.body.price_breakup).toHaveLength(2);
    const salesPrice = await t.request<ErrorBody>("POST", `/api/v1/flats/${c102.id}/price`, {
      token: sales,
      body: { version: priced.body.version, price_paise: 1 },
    });
    expect(salesPrice.status).toBe(403);

    const changed = await t.request<FlatRow>("POST", `/api/v1/flats/${c102.id}/flat-type`, {
      token: admin,
      body: { version: priced.body.version, flat_type_id: basics.flatTypes.A3 },
    });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body.flat_type_code).toBe("3BHK-A");
    expect(changed.body.super_builtup_sqft).toBe(1520);
    expect(changed.body.areas_snapshot.map((a) => a.sqft)).toEqual([1050, 1250, 1520]);
    expect(changed.body.price_paise).toBe(A3_BASE + CORNER); // repriced with the active card (floor 1, corner flag set above)
    expect(changed.body.rate_card_id).toBe(card1.id);
    const c301 = flatsByNumber.get("C-301")!;
    const held = await t.request<ErrorBody>("POST", `/api/v1/flats/${c301.id}/flat-type`, {
      token: admin,
      body: { version: c301.version, flat_type_id: basics.flatTypes.A2 },
    });
    expect(held.status).toBe(422);
    expect(held.body.error.details?.["rule"]).toBe("FLAT_NOT_AVAILABLE");
    const unknown = await t.request<ErrorBody>("POST", `/api/v1/flats/${c102.id}/flat-type`, {
      token: admin,
      body: { version: changed.body.version, flat_type_id: NO_ID },
    });
    expect(unknown.status).toBe(400);
    flatsByNumber = await reloadFlats(towerC.id);
  });

  it("flats list: filters, search by number, keyset paging and CSV export", async () => {
    const byFloor = await t.request<List<FlatRow>>("GET", `/api/v1/flats?project_id=${sgh.id}&floor=15`, {
      token: admin,
    });
    expect(byFloor.status, byFloor.text).toBe(200);
    expect(byFloor.body.items.map((f) => f.flat_number)).toEqual(["C-1501", "C-1502", "C-1503", "C-1504"]);
    const byStatus = await t.request<List<FlatRow>>("GET", `/api/v1/flats?block_id=${towerC.id}&status=HOLD`, {
      token: admin,
    });
    expect(byStatus.body.items.map((f) => f.flat_number)).toEqual(["C-301"]);
    const byType = await t.request<List<FlatRow>>(
      "GET",
      `/api/v1/flats?block_id=${towerC.id}&flat_type_id=${basics.flatTypes.B3}`,
      { token: admin },
    );
    expect(byType.body.total).toBe(5);
    const search = await t.request<List<FlatRow>>("GET", `/api/v1/flats?search=C-16`, { token: admin });
    expect(search.body.total).toBe(4);
    const corner = await t.request<List<FlatRow>>(
      "GET",
      `/api/v1/flats?block_id=${towerC.id}&is_corner=true&min_price_paise=900000000`,
      { token: admin },
    );
    expect(corner.body.items.every((f) => f.is_corner && f.price_paise >= 900_000_000)).toBe(true);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const page: { body: List<FlatRow> } = await t.request<List<FlatRow>>(
        "GET",
        `/api/v1/flats?block_id=${towerC.id}&limit=25&sort=-price_paise${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { token: admin },
      );
      seen.push(...page.body.items.map((f) => f.id));
      cursor = page.body.next_cursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(56);
    const csv = await t.request("GET", `/api/v1/flats?block_id=${towerC.id}&format=csv`, { token: admin });
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    expect(String(csv.headers["content-disposition"])).toContain("flats.csv");
    const lines = csv.text.trim().split("\r\n");
    expect(lines[0]!.split(",")).toEqual(
      expect.arrayContaining(["flat_number", "block_name", "status", "price_paise", "super_builtup_sqft"]),
    );
    expect(lines).toHaveLength(57);
    expect(csv.text).toContain("C-1504");
    const unknownKey = await t.request<ErrorBody>("GET", "/api/v1/flats?colour=red", { token: admin });
    expect(unknownKey.status).toBe(400);
  });
});

describe("pricing engine (SPEC §5)", () => {
  it("preview prices a hypothetical flat and an existing flat with a chosen card or the Active one", async () => {
    const hypo = await t.request<{
      total_paise: number;
      base_paise: number;
      breakup: Breakup;
      rate_card_id: string | null;
      flat_id: string | null;
      rate_per_sqft_paise: number | null;
    }>("POST", "/api/v1/rate-cards/preview", {
      token: admin,
      body: {
        project_id: sgh.id,
        rate_card_id: card1.id,
        flat_type_id: basics.flatTypes.A3,
        floor: 10,
        is_corner: true,
        facing: "E",
      },
    });
    expect(hypo.status, hypo.text).toBe(200);
    expect(hypo.body.base_paise).toBe(A3_BASE);
    expect(hypo.body.total_paise).toBe(A3_BASE + 9 * RISE + CORNER);
    expect(hypo.body.breakup.map((l) => l.label)).toEqual([
      expect.stringContaining("Base price"),
      "Floor Rise",
      "Corner",
    ]);
    expect(hypo.body.rate_card_id).toBe(card1.id);
    expect(hypo.body.flat_id).toBeNull();
    expect(hypo.body.rate_per_sqft_paise).toBe(A3.rate);
    const c1504 = flatsByNumber.get("C-1504")!;
    const existing = await t.request<{ total_paise: number; flat_id: string }>("POST", "/api/v1/rate-cards/preview", {
      token: admin,
      body: { project_id: sgh.id, flat_id: c1504.id },
    });
    expect(existing.status, existing.text).toBe(200);
    expect(existing.body.total_paise).toBe(c1504.price_paise);
    const viaGet = await t.request<{ total_paise: number; breakup: Breakup }>(
      "GET",
      `/api/v1/rate-cards/preview?flat_id=${c1504.id}`,
      { token: admin },
    );
    expect(viaGet.status, viaGet.text).toBe(200);
    expect(viaGet.body.total_paise).toBe(c1504.price_paise);
    const neither = await t.request<ErrorBody>("POST", "/api/v1/rate-cards/preview", {
      token: admin,
      body: { project_id: sgh.id },
    });
    expect(neither.status).toBe(400);
    // no card → flat type base (rate × super built-up), no PLC lines
    const base = await t.request<{ total_paise: number; rate_card_id: string | null; breakup: Breakup }>(
      "POST",
      "/api/v1/rate-cards/preview",
      { token: admin, body: { project_id: ggv.id, flat_type_id: basics.flatTypes.A3, floor: 5, is_corner: true } },
    );
    expect(base.status, base.text).toBe(200);
    expect(base.body.rate_card_id).toBeNull();
    expect(base.body.total_paise).toBe(A3_BASE);
    expect(base.body.breakup).toHaveLength(1);
  });

  it("activating a second card supersedes the first in the same transaction and re-prices ONLY Available flats (a HOLD flat keeps its price)", async () => {
    const c301 = flatsByNumber.get("C-301")!;
    const c1504 = flatsByNumber.get("C-1504")!;
    expect(c301.status).toBe("HOLD");
    const card2 = await post<RateCard>(t, admin, "/api/v1/rate-cards", rateCardBody(sgh.id, basics, "SGH-2026", 1.1));
    const list = await t.request<List<RateCard>>("GET", `/api/v1/rate-cards?project_id=${sgh.id}`, { token: admin });
    expect(list.body.items.map((c) => c.status).sort()).toEqual(["ACTIVE", "DRAFT"]);
    const activated = await t.request<RateCard>("POST", `/api/v1/rate-cards/${card2.id}/activate`, {
      token: admin,
      body: { version: card2.version },
    });
    expect(activated.status, activated.text).toBe(200);
    expect(activated.body.status).toBe("ACTIVE");
    expect(activated.body.applied!.repriced).toBe(61); // Tower C: 56 − HOLD − 2 BLOCKED = 53, plus the 8 Available flats of the deactivated Tower D
    expect(activated.body.applied!.skipped_not_available).toBe(3);
    expect(activated.body.applied!.skipped_no_rate).toBe(0);
    const old = await t.request<RateCard>("GET", `/api/v1/rate-cards/${card1.id}`, { token: admin });
    expect(old.body.status).toBe("SUPERSEDED");
    expect(
      (
        await t.app.sql<
          { n: number }[]
        >`select count(*)::int as n from rate_cards where project_id = ${sgh.id} and status = 'ACTIVE'`
      )[0]!.n,
    ).toBe(1);
    flatsByNumber = await reloadFlats(towerC.id);
    const held = flatsByNumber.get("C-301")!;
    expect(held.price_paise).toBe(c301.price_paise);
    expect(held.rate_card_id).toBe(card1.id);
    const repriced = flatsByNumber.get("C-1504")!;
    expect(repriced.price_paise).toBe(Math.round(A3.rate * 1.1) * A3.superb + 14 * RISE + CORNER);
    expect(repriced.price_paise).not.toBe(c1504.price_paise);
    expect(repriced.rate_card_id).toBe(card2.id);
    expect(repriced.version).toBe(c1504.version + 1);

    const dry = await t.request<{ repriced: number; dry_run: boolean; skipped_not_available: number }>(
      "POST",
      `/api/v1/rate-cards/${card2.id}/apply`,
      { token: admin, body: { dry_run: true, block_id: towerC.id } },
    );
    expect(dry.status, dry.text).toBe(200);
    expect(dry.body).toMatchObject({ dry_run: true, repriced: 53, skipped_not_available: 3 });
    const applySuperseded = await t.request<ErrorBody>("POST", `/api/v1/rate-cards/${card1.id}/apply`, {
      token: admin,
      body: {},
    });
    expect(applySuperseded.status).toBe(422);
    const reactivate = await t.request<ErrorBody>("POST", `/api/v1/rate-cards/${card1.id}/activate`, {
      token: admin,
      body: { version: old.body.version },
    });
    expect(reactivate.status).toBe(422);
    expect(reactivate.body.error.details?.["rule"]).toBe("RATE_CARD_SUPERSEDED");
    const history = await t.request<FlatDetail>("GET", `/api/v1/flats/${c1504.id}`, { token: admin });
    expect(history.body.history.filter((h) => h.action === "flat.price").length).toBeGreaterThanOrEqual(1);
    const noScope = await t.request<ErrorBody>("POST", `/api/v1/rate-cards/${card2.id}/activate`, {
      token: sales,
      body: { version: 1 },
    });
    expect(noScope.status).toBe(403);
  });
});

describe("parking inventory (SPEC §4)", () => {
  it("bulk-generates, creates, lists, blocks and refuses ALLOTTED by hand", async () => {
    const gen = await t.request<{ created: number; skipped_existing: string[] }>(
      "POST",
      `/api/v1/projects/${sgh.id}/parking/bulk-generate`,
      {
        token: admin,
        body: {
          project_id: sgh.id,
          prefix: "B1-",
          from_number: 1,
          to_number: 10,
          pad: 2,
          slot_type: "COVERED",
          level: "B1",
          price_paise: 30_000_000,
        },
      },
    );
    expect(gen.status, gen.text).toBe(201);
    expect(gen.body).toEqual({ created: 10, skipped_existing: [] });
    const again = await t.request<{ created: number; skipped_existing: string[] }>(
      "POST",
      `/api/v1/projects/${sgh.id}/parking/bulk-generate`,
      {
        token: admin,
        body: {
          project_id: sgh.id,
          prefix: "B1-",
          from_number: 8,
          to_number: 12,
          pad: 2,
          slot_type: "COVERED",
          level: "B1",
          price_paise: 30_000_000,
        },
      },
    );
    expect(again.body).toEqual({ created: 2, skipped_existing: ["B1-08", "B1-09", "B1-10"] });
    const one = await t.request<Slot>("POST", `/api/v1/projects/${sgh.id}/parking`, {
      token: admin,
      body: { project_id: sgh.id, number: "S-01", slot_type: "OPEN", price_paise: 15_000_000 },
    });
    expect(one.status, one.text).toBe(201);
    expect(one.body.status).toBe("AVAILABLE");
    const dup = await t.request<ErrorBody>("POST", `/api/v1/projects/${sgh.id}/parking`, {
      token: admin,
      body: { project_id: sgh.id, number: "S-01", slot_type: "OPEN" },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
    const mismatch = await t.request<ErrorBody>("POST", `/api/v1/projects/${sgh.id}/parking`, {
      token: admin,
      body: { project_id: ggv.id, number: "S-02", slot_type: "OPEN" },
    });
    expect(mismatch.status).toBe(400);
    const list = await t.request<List<Slot>>(
      "GET",
      `/api/v1/projects/${sgh.id}/parking?slot_type=COVERED&sort=number`,
      { token: admin },
    );
    expect(list.status, list.text).toBe(200);
    expect(list.body.total).toBe(12);
    expect(list.body.items[0]!.number).toBe("B1-01");
    const blocked = await t.request<Slot>("PATCH", `/api/v1/projects/${sgh.id}/parking/${one.body.id}`, {
      token: admin,
      body: { version: one.body.version, status: "BLOCKED", level: "Stilt" },
    });
    expect(blocked.status, blocked.text).toBe(200);
    expect(blocked.body.status).toBe("BLOCKED");
    expect(blocked.body.level).toBe("Stilt");
    expect(blocked.body.price_paise).toBe(15_000_000); // omitted fields stay unchanged
    expect(blocked.body.version).toBe(2);
    const allotted = await t.request<ErrorBody>("PATCH", `/api/v1/projects/${sgh.id}/parking/${one.body.id}`, {
      token: admin,
      body: { version: 2, status: "ALLOTTED" },
    });
    expect(allotted.status).toBe(422);
    expect(allotted.body.error.message).toContain("booking engine");
    const viaStatus = await t.request<Slot>("POST", `/api/v1/projects/${sgh.id}/parking/${one.body.id}/status`, {
      token: admin,
      body: { version: 2, status: "AVAILABLE", reason: "Released" },
    });
    expect(viaStatus.status, viaStatus.text).toBe(200);
    expect(viaStatus.body.status).toBe("AVAILABLE");
    const stale = await t.request<ErrorBody>("POST", `/api/v1/projects/${sgh.id}/parking/${one.body.id}/status`, {
      token: admin,
      body: { version: 2, status: "BLOCKED" },
    });
    expect(stale.status).toBe(409);
    const bulk = await t.request<{ updated: number; skipped: number }>(
      "POST",
      `/api/v1/projects/${sgh.id}/parking/bulk-status`,
      { token: admin, body: { slot_ids: list.body.items.slice(0, 3).map((s) => s.id), status: "BLOCKED" } },
    );
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body).toMatchObject({ updated: 3, skipped: 0 });
    expect(
      (await t.request<List<Slot>>("GET", `/api/v1/projects/${sgh.id}/parking?status=BLOCKED`, { token: admin })).body
        .total,
    ).toBe(3);
    // a slot allotted by the booking engine is frozen for manual status
    await t.app.sql`update parking_slots set status = 'ALLOTTED' where id = ${one.body.id}`;
    const frozen = await t.request<ErrorBody>("POST", `/api/v1/projects/${sgh.id}/parking/${one.body.id}/status`, {
      token: admin,
      body: { version: 3, status: "BLOCKED" },
    });
    expect(frozen.status).toBe(422);
    const csv = await t.request("GET", `/api/v1/projects/${sgh.id}/parking?format=csv`, { token: admin });
    expect(String(csv.headers["content-type"])).toContain("text/csv");
    const noPerm = await t.request<ErrorBody>("POST", `/api/v1/projects/${sgh.id}/parking`, {
      token: sales,
      body: { project_id: sgh.id, number: "S-09", slot_type: "OPEN" },
    });
    expect(noPerm.status).toBe(403);
    expect((await t.request("GET", `/api/v1/projects/${sgh.id}/parking/${NO_ID}`, { token: admin })).status).toBe(404);
  });
});

describe("scope, permissions, idempotency", () => {
  it("a scoped user gets 404 (never 403) on a foreign project, its blocks, flats, grid, parking and rate cards", async () => {
    const [pm] = await t.app.sql<
      { id: string; version: number }[]
    >`select id, version from users where email = ${CREDS.projects.email}`;
    const scoped = await t.request("PUT", `/api/v1/users/${pm!.id}/scope`, {
      token: admin,
      body: { version: pm!.version, all_projects: false, project_ids: [ggv.id] },
    });
    expect(scoped.status, scoped.text).toBe(200);
    const projects = (await t.loginAs("projects")).access_token;
    const c101 = flatsByNumber.get("C-101")!;
    for (const url of [
      `/api/v1/projects/${sgh.id}`,
      `/api/v1/blocks/${towerC.id}`,
      `/api/v1/blocks/${towerC.id}/grid`,
      `/api/v1/flats/${c101.id}`,
      `/api/v1/projects/${sgh.id}/parking`,
      `/api/v1/rate-cards/${card1.id}`,
    ]) {
      const r = await t.request<ErrorBody>("GET", url, { token: projects });
      expect(r.status, url).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    }
    for (const url of [
      `/api/v1/blocks?project_id=${sgh.id}`,
      `/api/v1/flats?project_id=${sgh.id}`,
      `/api/v1/rate-cards?project_id=${sgh.id}`,
    ])
      expect((await t.request("GET", url, { token: projects })).status, url).toBe(404);
    const visible = await t.request<List<ProjectRow>>("GET", "/api/v1/projects", { token: projects });
    expect(visible.body.items.map((p) => p.code)).toEqual(["GGV"]);
    expect((await t.request<List<FlatRow>>("GET", "/api/v1/flats", { token: projects })).body.total).toBe(0);
    const write = await t.request<ErrorBody>("POST", `/api/v1/flats/${c101.id}/status`, {
      token: projects,
      body: { version: c101.version, status: "HOLD" },
    });
    expect(write.status).toBe(404);
    const foreignBlock = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
      token: projects,
      body: towerCBody(sgh.id, basics, { code: "X" }),
    });
    expect(foreignBlock.status).toBe(404);
    expect((await t.request("GET", `/api/v1/projects/${ggv.id}`, { token: projects })).status).toBe(200);
    expect((await t.request("GET", `/api/v1/blocks/${towerC.id}`, { token: paSgh })).status).toBe(200);
  });

  it("Sales (no block.write) gets 403; POST /blocks replays with Idempotency-Key", async () => {
    const forbidden = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
      token: sales,
      body: towerCBody(sgh.id, basics, { code: "E" }),
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.details?.["permission"]).toBe("block.write");
    const body = towerCBody(sgh.id, basics, {
      name: "Tower E",
      code: "E",
      floors: 1,
      skip_floors: [],
      refuge_floors: [],
      floor_plans: [{ from_floor: 1, to_floor: 1, floor_plan_template_id: basics.templates.FP4 }],
    });
    const first = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: admin,
      body,
      headers: { "idempotency-key": "block-e-0001" },
    });
    expect(first.status, first.text).toBe(201);
    const replay = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: admin,
      body,
      headers: { "idempotency-key": "block-e-0001" },
    });
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.id).toBe(first.body.id);
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from blocks where code = 'E'`)[0]!.n).toBe(1);
    const mismatch = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
      token: admin,
      body: { ...body, name: "Tower E2" },
      headers: { "idempotency-key": "block-e-0001" },
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("a project with blocks cannot be deactivated (409 IN_USE); one without blocks can, and is restored", async () => {
    const inUse = await t.request<ErrorBody>("POST", `/api/v1/projects/${sgh.id}/deactivate`, {
      token: admin,
      body: {},
      headers: ifMatch(await versionOf(t, `/api/v1/projects/${sgh.id}`, admin)),
    });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe("IN_USE");
    const ok = await t.request<{ is_active: boolean; version: number }>(
      "POST",
      `/api/v1/projects/${ggv.id}/deactivate`,
      { token: admin, body: { version: ggv.version } },
    );
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.is_active).toBe(false);
    const hidden = await t.request<List<ProjectRow>>("GET", "/api/v1/projects", { token: admin });
    expect(hidden.body.items.map((p) => p.code)).not.toContain("GGV");
    const inactiveBlock = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(ggv.id, basics, { code: "P" }),
    });
    expect(inactiveBlock.status).toBe(422);
    const restored = await t.request<{ is_active: boolean }>("POST", `/api/v1/projects/${ggv.id}/activate`, {
      token: admin,
      body: {},
      headers: ifMatch(await versionOf(t, `/api/v1/projects/${ggv.id}`, admin)),
    });
    expect(restored.status).toBe(200);
    expect(restored.body.is_active).toBe(true);
    // every inventory route is a staff route with a permission code (registry built by lib/routes)
    const inv = t.app.routeRegistry.filter((r) => /^\/api\/v1\/(projects|blocks|flats|rate-cards)(\/|$)/.test(r.url));
    expect(inv.length).toBeGreaterThan(30);
    expect(inv.filter((r) => r.permission === null || r.public)).toEqual([]);
  });
});
