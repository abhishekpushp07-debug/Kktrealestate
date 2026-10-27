/**
 * Adversarial review tests of the inventory module: numbering patterns (villas, ground floor), floor-plan range validation on every
 * entry point, generation atomicity, structural edits, status/re-snapshot guards, rate-card activation races, non-negative floor rise,
 * unit_counts after every operation, scope (404) on every route, idempotency and audit rows.
 */
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
import { buildTestApp, type ErrorBody, ifMatch, type TestContext, versionOf } from "./helpers.js";

type UnitCounts = { available: number; hold: number; blocked: number; booked: number; sold: number; total: number };
type ProjectRow = {
  id: string;
  version: number;
  code: string;
  block_count: number;
  unit_counts: UnitCounts;
  stage_sequence: string[];
};
type BlockRow = {
  id: string;
  version: number;
  code: string;
  floors: number;
  floor_start: number;
  ground_floor_label: string;
  unit_counts: UnitCounts;
  has_flats: boolean;
  has_floors: boolean;
  numbering_pattern: string;
};
type FlatRow = {
  id: string;
  version: number;
  flat_number: string;
  floor: number;
  floor_label: string;
  position: number;
  status: string;
  flat_type_code: string;
  price_paise: number;
  price_breakup: { label: string; amount_paise: number }[];
  rate_card_id: string | null;
  hold_until: string | null;
};
type List<T> = { items: T[]; total: number };
type Grid = {
  positions: number;
  floors: { floor: number; floor_label: string; kind: string; cells: { flat_number: string }[] }[];
  legend: { by_status: Record<string, number> };
  unit_counts: UnitCounts;
};
type RateCard = { id: string; version: number; status: string; applied?: { repriced: number } | null };
type Slot = { id: string; version: number; number: string; status: string };
type GenResult = { flats_created: number; floors_with_units: number; version: number };

const A3 = FLAT_TYPE_SPECS.A3;
const CORNER = 10_000 * A3.superb;
const RISE = 2500 * A3.superb;
const A3_BASE = A3.rate * A3.superb;

let t: TestContext;
let admin: string;
let basics: InventoryBasics;
let villaTemplate6: string;
let ggv: ProjectRow; // villa project (no active card)
let sgh: ProjectRow; // tower project with an active rate card
let sghCard: RateCard;
let other: ProjectRow; // the only project a scoped user may see
let scoped: string; // token of a user with every inventory permission but scoped to `other`

async function get<T>(url: string, token = admin): Promise<T> {
  const r = await t.request<T>("GET", url, { token });
  expect(r.status, `${url} → ${r.text}`).toBe(200);
  return r.body;
}
const flatsOf = async (blockId: string) =>
  (await get<List<FlatRow>>(`/api/v1/flats?block_id=${blockId}&page_size=200&sort=flat_number`)).items;
const block = (id: string) => get<BlockRow>(`/api/v1/blocks/${id}`);
const project = (id: string) => get<ProjectRow>(`/api/v1/projects/${id}`);

/** Compares a block's stored unit_counts (and its project's) with the truth in the flats table. */
async function expectCountsTrue(blockId: string): Promise<void> {
  const [truth] = await t.app.sql<UnitCounts[]>`
    select count(*) filter (where status = 'AVAILABLE')::int as available, count(*) filter (where status = 'HOLD')::int as hold, count(*) filter (where status = 'BLOCKED')::int as blocked,
           count(*) filter (where status = 'BOOKED')::int as booked, count(*) filter (where status = 'SOLD')::int as sold, count(*)::int as total from flats where block_id = ${blockId}`;
  const b = await block(blockId);
  expect(b.unit_counts).toEqual(truth);
  const [row] = await t.app.sql<{ project_id: string }[]>`select project_id from blocks where id = ${blockId}`;
  const [ptruth] = await t.app.sql<UnitCounts[]>`
    select count(*) filter (where f.status = 'AVAILABLE')::int as available, count(*) filter (where f.status = 'HOLD')::int as hold, count(*) filter (where f.status = 'BLOCKED')::int as blocked,
           count(*) filter (where f.status = 'BOOKED')::int as booked, count(*) filter (where f.status = 'SOLD')::int as sold, count(*)::int as total
      from flats f join blocks bl on bl.id = f.block_id where f.project_id = ${row!.project_id} and bl.is_active`;
  const [bcount] = await t.app.sql<
    { n: number }[]
  >`select count(*)::int as n from blocks where project_id = ${row!.project_id} and is_active`;
  const p = await project(row!.project_id);
  expect(p.unit_counts).toEqual(ptruth);
  expect(p.block_count).toBe(bcount!.n);
}

async function auditCount(entityType: string, entityId: string): Promise<number> {
  return (
    await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from audit_logs where entity_type = ${entityType} and entity_id = ${entityId}`
  )[0]!.n;
}

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  basics = await createInventoryBasics(t, admin);
  villaTemplate6 = (
    await post<{ id: string }>(t, admin, "/api/v1/masters/floor-plan-templates", {
      name: "FP-VILLA-6",
      code: "FP-VILLA-6",
      positions: Array.from({ length: 6 }, (_, i) => ({
        position: i + 1,
        flat_type_id: basics.flatTypes.B3,
        is_corner: i === 0 || i === 5,
      })),
    })
  ).id;
  ggv = await post<ProjectRow>(
    t,
    admin,
    "/api/v1/projects",
    projectBody("Ganesh Green Villas", "GGV", { status: "READY" }),
  );
  sgh = await post<ProjectRow>(t, admin, "/api/v1/projects", projectBody("Shree Ganesh Heights", "SGH"));
  other = await post<ProjectRow>(t, admin, "/api/v1/projects", projectBody("Other Project", "OTH"));
  const draft = await post<RateCard>(t, admin, "/api/v1/rate-cards", rateCardBody(sgh.id, basics, "SGH-2025"));
  const act = await t.request<RateCard>("POST", `/api/v1/rate-cards/${draft.id}/activate`, {
    token: admin,
    body: { version: draft.version },
  });
  expect(act.status, act.text).toBe(200);
  sghCard = act.body;
  const role = await post<{ id: string }>(t, admin, "/api/v1/roles", {
    name: "Scoped inventory",
    permissions: [
      "dashboard.view",
      "project.read",
      "project.write",
      "block.write",
      "flat.write",
      "flat.status",
      "parking.write",
      "rate_card.write",
    ],
  });
  await post(t, admin, "/api/v1/users", {
    name: "Scoped User",
    email: "scoped@sgb.in",
    role_id: role.id,
    all_projects: false,
    project_ids: [other.id],
    password: "Scoped@12345",
    must_change_password: false,
  });
  scoped = (await t.login("scoped@sgb.in", "Scoped@12345")).access_token;
});
afterAll(async () => {
  await t?.close();
});

describe("numbering patterns, villas and ground floors", () => {
  let villaP: BlockRow;

  it("villa block (has_floors=false, floors=0, floor_start=0) with {block}{seq} → P1…P6 on floor 0 labelled G; grid is one row of 6 positions", async () => {
    const r = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: admin,
      body: {
        project_id: ggv.id,
        block_type_id: basics.villaBlockTypeId,
        name: "Premium Villas",
        code: "P",
        floors: 0,
        floor_start: 0,
        floor_plans: [{ from_floor: 0, to_floor: 0, floor_plan_template_id: villaTemplate6 }],
        numbering_pattern: "{block}{seq}",
        status: "READY",
      },
    });
    expect(r.status, r.text).toBe(201);
    villaP = r.body;
    expect(villaP.has_floors).toBe(false);
    expect(villaP.unit_counts).toEqual({ available: 6, hold: 0, blocked: 0, booked: 0, sold: 0, total: 6 });
    const flats = await flatsOf(villaP.id);
    expect(flats.map((f) => f.flat_number)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(flats.every((f) => f.floor === 0 && f.floor_label === "G")).toBe(true);
    expect(flats.map((f) => f.position)).toEqual([1, 2, 3, 4, 5, 6]);
    // no rate card on GGV → flat type base price, one breakup line, no card reference
    expect(flats[0]!.price_paise).toBe(FLAT_TYPE_SPECS.B3.rate * FLAT_TYPE_SPECS.B3.superb);
    expect(flats[0]!.price_breakup).toHaveLength(1);
    expect(flats[0]!.rate_card_id).toBeNull();
    const grid = await get<Grid>(`/api/v1/blocks/${villaP.id}/grid`);
    expect(grid.positions).toBe(6);
    expect(grid.floors).toHaveLength(1);
    expect(grid.floors[0]).toMatchObject({ floor: 0, floor_label: "G", kind: "UNITS" });
    expect(grid.floors[0]!.cells.map((c) => c.flat_number)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    await expectCountsTrue(villaP.id);
  });

  it("appending a villa row continues the sequence (P7…P12) instead of restarting", async () => {
    const r = await t.request<GenResult>("POST", `/api/v1/blocks/${villaP.id}/floors`, {
      token: admin,
      body: {
        version: villaP.version,
        new_floors: 1,
        floor_plans: [{ from_floor: 1, to_floor: 1, floor_plan_template_id: villaTemplate6 }],
      },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.flats_created).toBe(6);
    const numbers = (await flatsOf(villaP.id))
      .map((f) => f.flat_number)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    expect(numbers).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"]);
    await expectCountsTrue(villaP.id);
    villaP = await block(villaP.id);
  });

  it("{floor}{pos2} with floor_start 0 and a custom ground label → GF01…; floor 0 has no floor rise, floor 1 one step (floor_start honoured)", async () => {
    const r = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(sgh.id, basics, {
        name: "Tower G",
        code: "G",
        floors: 2,
        floor_start: 0,
        ground_floor_label: "GF",
        skip_floors: [],
        refuge_floors: [],
        numbering_pattern: "{floor}{pos2}",
        floor_plans: [{ from_floor: 0, to_floor: 2, floor_plan_template_id: basics.templates.FP4P }],
      }),
    });
    expect(r.status, r.text).toBe(201);
    const flats = await flatsOf(r.body.id);
    expect(flats).toHaveLength(12);
    expect(flats.filter((f) => f.floor === 0).map((f) => [f.flat_number, f.floor_label])).toEqual([
      ["GF01", "GF"],
      ["GF02", "GF"],
      ["GF03", "GF"],
      ["GF04", "GF"],
    ]);
    expect(flats.filter((f) => f.floor === 2).map((f) => f.flat_number)).toEqual(["201", "202", "203", "204"]);
    const gf01 = flats.find((f) => f.flat_number === "GF01")!;
    expect(gf01.price_breakup.map((l) => l.label)).toEqual([expect.stringContaining("Base price"), "Corner"]);
    expect(gf01.price_paise).toBe(A3_BASE + CORNER);
    const f101 = flats.find((f) => f.flat_number === "101")!;
    expect(f101.price_breakup.find((l) => l.label === "Floor Rise")!.amount_paise).toBe(RISE);
    expect(f101.price_paise).toBe(A3_BASE + RISE + CORNER);
    const grid = await get<Grid>(`/api/v1/blocks/${r.body.id}/grid`);
    expect(grid.floors.map((f) => f.floor_label)).toEqual(["2", "1", "GF"]);
    await expectCountsTrue(r.body.id);
  });

  it("{block}-{floor}{pos2} with floor_start 0 and the default label → A-G01; the preview agrees with the generated numbers", async () => {
    const body = towerCBody(sgh.id, basics, {
      name: "Tower A0",
      code: "A0",
      floors: 1,
      floor_start: 0,
      skip_floors: [],
      refuge_floors: [],
      floor_plans: [{ from_floor: 0, to_floor: 1, floor_plan_template_id: basics.templates.FP4 }],
    });
    const preview = await t.request<{
      total_flats: number;
      floors: { floor: number; floor_label: string; cells: { flat_number: string }[] }[];
    }>("POST", "/api/v1/blocks/preview", { token: admin, body });
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.total_flats).toBe(8);
    expect(preview.body.floors.at(-1)!.cells.map((c) => c.flat_number)).toEqual([
      "A0-G01",
      "A0-G02",
      "A0-G03",
      "A0-G04",
    ]);
    const r = await t.request<BlockRow>("POST", "/api/v1/blocks", { token: admin, body });
    expect(r.status, r.text).toBe(201);
    const numbers = (await flatsOf(r.body.id)).map((f) => f.flat_number);
    expect(numbers).toEqual(["A0-101", "A0-102", "A0-103", "A0-104", "A0-G01", "A0-G02", "A0-G03", "A0-G04"]);
  });
});

describe("floor-plan ranges are validated on every entry point", () => {
  let tower: BlockRow;
  const fp = (from: number, to: number, id = basics.templates.FP4) => ({
    from_floor: from,
    to_floor: to,
    floor_plan_template_id: id,
  });

  it("create and preview reject overlapping, gapped and out-of-bounds ranges with 400 and write nothing", async () => {
    const cases: Record<string, unknown>[] = [
      { floor_plans: [fp(1, 10), fp(10, 15, basics.templates.FP4P)] }, // overlap on 10
      { floor_plans: [fp(1, 5), fp(7, 15, basics.templates.FP4P)] }, // gap at 6
      { floor_plans: [fp(1, 16)] }, // beyond floors
      { floor_plans: [fp(0, 15)] }, // below floor_start
    ];
    for (const extra of cases) {
      const create = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
        token: admin,
        body: towerCBody(sgh.id, basics, { code: "BAD", ...extra }),
      });
      expect(create.status, JSON.stringify(extra)).toBe(400);
      expect(create.body.error.code).toBe("VALIDATION_ERROR");
      const preview = await t.request<ErrorBody>("POST", "/api/v1/blocks/preview", {
        token: admin,
        body: towerCBody(sgh.id, basics, { code: "BAD", ...extra }),
      });
      expect(preview.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from blocks where code = 'BAD'`)[0]!.n).toBe(0);
    const created = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(sgh.id, basics, { name: "Tower C", code: "C" }),
    });
    expect(created.status, created.text).toBe(201);
    tower = created.body;
    expect(tower.unit_counts.total).toBe(52);
  });

  it("PATCH rejects overlapping, gapped and out-of-bounds ranges (400) and leaves the block and its flats untouched", async () => {
    const before = await flatsOf(tower.id);
    for (const plans of [
      [fp(1, 10), fp(10, 15, basics.templates.FP4P)],
      [fp(1, 5), fp(7, 15, basics.templates.FP4P)],
      [fp(1, 20)],
      [fp(0, 15)],
    ]) {
      const r = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${tower.id}`, {
        token: admin,
        body: { version: tower.version, floor_plans: plans },
      });
      expect(r.status, JSON.stringify(plans)).toBe(400);
      expect(r.body.error.code).toBe("VALIDATION_ERROR");
    }
    // a skip that removes floor coverage is fine; a floors change that uncovers floors is a gap
    const uncovered = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${tower.id}`, {
      token: admin,
      body: { version: tower.version, floors: 18 },
    });
    expect(uncovered.status).toBe(400);
    expect(String(uncovered.body.error.message)).toContain("16");
    expect(await block(tower.id)).toMatchObject({ version: tower.version, floors: 15 });
    expect((await flatsOf(tower.id)).map((f) => f.id)).toEqual(before.map((f) => f.id));
  });

  it("append floors rejects overlapping new ranges, ranges that reach into existing floors, gaps in the new floors and out-of-range skips (400)", async () => {
    const bad = [
      { new_floors: 2, floor_plans: [fp(16, 17), fp(17, 17)] },
      { new_floors: 2, floor_plans: [fp(15, 17)] },
      { new_floors: 2, floor_plans: [fp(16, 16)] },
      { new_floors: 2, floor_plans: [fp(16, 17)], skip_floors: [3] },
      { new_floors: 1, floor_plans: [fp(16, 18)] },
    ];
    for (const body of bad) {
      const r = await t.request<ErrorBody>("POST", `/api/v1/blocks/${tower.id}/floors`, {
        token: admin,
        body: { version: tower.version, ...body },
      });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await block(tower.id)).floors).toBe(15);
    expect((await flatsOf(tower.id)).length).toBe(52);
    // a skip inside the new floors is honoured: 16 skipped, 17 generated
    const ok = await t.request<GenResult>("POST", `/api/v1/blocks/${tower.id}/floors`, {
      token: admin,
      body: {
        version: tower.version,
        new_floors: 2,
        floor_plans: [fp(17, 17, basics.templates.FP4P)],
        skip_floors: [16],
      },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.flats_created).toBe(4);
    const numbers = (await flatsOf(tower.id)).map((f) => f.flat_number);
    expect(numbers.filter((n) => n.startsWith("C-16"))).toEqual([]);
    expect(numbers.filter((n) => n.startsWith("C-17"))).toEqual(["C-1701", "C-1702", "C-1703", "C-1704"]);
    await expectCountsTrue(tower.id);
  });
});

describe("generation atomicity", () => {
  const trigger = async (flatNumber: string) => {
    await t.app.sql.unsafe(
      `create or replace function kkt_test_fail_flat() returns trigger language plpgsql as $$ begin if new.flat_number = '${flatNumber}' then raise exception 'forced failure on %', new.flat_number; end if; return new; end $$`,
    );
    await t.app.sql.unsafe("drop trigger if exists kkt_test_fail_flat on flats");
    await t.app.sql.unsafe(
      "create trigger kkt_test_fail_flat before insert on flats for each row execute function kkt_test_fail_flat()",
    );
  };
  const dropTrigger = async () => {
    await t.app.sql.unsafe("drop trigger if exists kkt_test_fail_flat on flats");
  };

  it("a failure in the middle of the insert leaves zero flats and no block (POST /blocks) — nothing is created", async () => {
    await trigger("X-301"); // the 9th of 12 flats
    try {
      const r = await t.request<ErrorBody>("POST", "/api/v1/blocks", {
        token: admin,
        body: towerCBody(sgh.id, basics, {
          name: "Tower X",
          code: "X",
          floors: 3,
          skip_floors: [],
          refuge_floors: [],
          floor_plans: [{ from_floor: 1, to_floor: 3, floor_plan_template_id: basics.templates.FP4 }],
        }),
      });
      expect(r.status).toBeGreaterThanOrEqual(500);
      expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from blocks where code = 'X'`)[0]!.n).toBe(0);
      expect(
        (await t.app.sql<{ n: number }[]>`select count(*)::int as n from flats where flat_number like 'X-%'`)[0]!.n,
      ).toBe(0);
      expect(
        (
          await t.app.sql<
            { n: number }[]
          >`select count(*)::int as n from audit_logs where action in ('block.create', 'flat.generate') and after->>'block_code' = 'X'`
        )[0]!.n,
      ).toBe(0);
    } finally {
      await dropTrigger();
    }
  });

  it("the same failure during generate-flats / regenerate / append leaves the block exactly as it was", async () => {
    const created = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: admin,
      body: towerCBody(sgh.id, basics, {
        name: "Tower X",
        code: "X",
        floors: 3,
        skip_floors: [],
        refuge_floors: [],
        floor_plans: [{ from_floor: 1, to_floor: 3, floor_plan_template_id: basics.templates.FP4 }],
        generate_flats: false,
      }),
    });
    expect(created.status, created.text).toBe(201);
    const x = created.body;
    await trigger("X-301");
    try {
      const gen = await t.request<ErrorBody>("POST", `/api/v1/blocks/${x.id}/generate-flats`, {
        token: admin,
        body: { version: x.version },
      });
      expect(gen.status).toBeGreaterThanOrEqual(500);
      expect(await block(x.id)).toMatchObject({ version: x.version, has_flats: false, unit_counts: { total: 0 } });
      expect((await flatsOf(x.id)).length).toBe(0);
    } finally {
      await dropTrigger();
    }
    const ok = await t.request<GenResult>("POST", `/api/v1/blocks/${x.id}/generate-flats`, {
      token: admin,
      body: { version: x.version },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.flats_created).toBe(12);
    const before = await flatsOf(x.id);
    await trigger("X-201");
    try {
      const regen = await t.request<ErrorBody>("POST", `/api/v1/blocks/${x.id}/generate-flats`, {
        token: admin,
        body: { version: ok.body.version, regenerate: true },
      });
      expect(regen.status).toBeGreaterThanOrEqual(500);
      expect((await flatsOf(x.id)).map((f) => f.id)).toEqual(before.map((f) => f.id)); // the delete was rolled back too
      await trigger("X-401");
      const append = await t.request<ErrorBody>("POST", `/api/v1/blocks/${x.id}/floors`, {
        token: admin,
        body: {
          version: ok.body.version,
          new_floors: 1,
          floor_plans: [{ from_floor: 4, to_floor: 4, floor_plan_template_id: basics.templates.FP4 }],
        },
      });
      expect(append.status).toBeGreaterThanOrEqual(500);
      expect(await block(x.id)).toMatchObject({ version: ok.body.version, floors: 3 });
      expect((await flatsOf(x.id)).length).toBe(12);
    } finally {
      await dropTrigger();
    }
    await expectCountsTrue(x.id);
  });
});

describe("structural edits keep flats in sync with the block definition", () => {
  let p: BlockRow;

  it("changing the code of an all-Available block regenerates its flats (P1 → PV1) atomically and refreshes counts", async () => {
    p = (await get<List<BlockRow>>(`/api/v1/blocks?project_id=${ggv.id}`)).items.find((b) => b.code === "P")!;
    const before = await flatsOf(p.id);
    const r = await t.request<BlockRow>("PATCH", `/api/v1/blocks/${p.id}`, {
      token: admin,
      body: { version: p.version, code: "PV" },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.code).toBe("PV");
    expect(r.body.unit_counts.total).toBe(12);
    const after = await flatsOf(p.id);
    expect(after.map((f) => f.flat_number).sort()).toEqual(before.map((f) => `PV${f.flat_number.slice(1)}`).sort());
    expect(after.some((f) => before.some((b) => b.id === f.id))).toBe(false);
    await expectCountsTrue(p.id);
    p = r.body;
  });

  it("shrinking floors drops the flats of the removed floors; a non-structural edit (name) leaves flats alone", async () => {
    const r = await t.request<BlockRow>("PATCH", `/api/v1/blocks/${p.id}`, {
      token: admin,
      body: {
        version: p.version,
        floors: 0,
        floor_plans: [{ from_floor: 0, to_floor: 0, floor_plan_template_id: villaTemplate6 }],
      },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.unit_counts.total).toBe(6);
    const ids = (await flatsOf(p.id)).map((f) => f.id);
    const renamed = await t.request<BlockRow>("PATCH", `/api/v1/blocks/${p.id}`, {
      token: admin,
      body: { version: r.body.version, name: "Premium Villas (Phase 1)" },
    });
    expect(renamed.status, renamed.text).toBe(200);
    expect((await flatsOf(p.id)).map((f) => f.id)).toEqual(ids);
    await expectCountsTrue(p.id);
    p = renamed.body;
  });

  it("the ground-floor label is structural on a block with a floor 0 (numbers change) and blocked once a flat is on HOLD", async () => {
    const flats = await flatsOf(p.id);
    const hold = await t.request<FlatRow>("POST", `/api/v1/flats/${flats[0]!.id}/status`, {
      token: admin,
      body: { version: flats[0]!.version, status: "HOLD" },
    });
    expect(hold.status, hold.text).toBe(200);
    const blocked = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${p.id}`, {
      token: admin,
      body: { version: p.version, ground_floor_label: "Ground" },
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details?.["rule"]).toBe("FLATS_NOT_AVAILABLE");
    const code = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${p.id}`, {
      token: admin,
      body: { version: p.version, code: "Q" },
    });
    expect(code.status).toBe(422);
    const release = await t.request<FlatRow>("POST", `/api/v1/flats/${flats[0]!.id}/status`, {
      token: admin,
      body: { version: hold.body.version, status: "AVAILABLE" },
    });
    expect(release.status, release.text).toBe(200);
    const g = (await get<List<BlockRow>>(`/api/v1/blocks?project_id=${sgh.id}&include_inactive=true`)).items.find(
      (b) => b.code === "G",
    )!;
    const relabel = await t.request<BlockRow>("PATCH", `/api/v1/blocks/${g.id}`, {
      token: admin,
      body: { version: g.version, ground_floor_label: "G" },
    });
    expect(relabel.status, relabel.text).toBe(200);
    expect((await flatsOf(g.id)).filter((f) => f.floor === 0).map((f) => f.flat_number)).toEqual([
      "G01",
      "G02",
      "G03",
      "G04",
    ]);
    await expectCountsTrue(p.id);
  });
});

describe("status guards, re-snapshot and hold windows", () => {
  let c: BlockRow;
  let flats: FlatRow[];

  it("BLOCKED and engine-owned (BOOKED/SOLD) flats refuse a flat-type change, manual status, price and bulk edits; regenerate/deactivate are 409", async () => {
    c = (await get<List<BlockRow>>(`/api/v1/blocks?project_id=${sgh.id}`)).items.find((b) => b.code === "C")!;
    flats = await flatsOf(c.id);
    const c101 = flats.find((f) => f.flat_number === "C-101")!;
    const c102 = flats.find((f) => f.flat_number === "C-102")!;
    const blocked = await t.request<FlatRow>("POST", `/api/v1/flats/${c101.id}/status`, {
      token: admin,
      body: { version: c101.version, status: "BLOCKED", reason: "Landowner share" },
    });
    expect(blocked.status, blocked.text).toBe(200);
    const resnap = await t.request<ErrorBody>("POST", `/api/v1/flats/${c101.id}/flat-type`, {
      token: admin,
      body: { version: blocked.body.version, flat_type_id: basics.flatTypes.A2 },
    });
    expect(resnap.status).toBe(422);
    expect(resnap.body.error.details?.["rule"]).toBe("FLAT_NOT_AVAILABLE");
    // the booking engine marks C-102 BOOKED (and SOLD later) behind the API's back
    await t.app.sql`update flats set status = 'BOOKED' where id = ${c102.id}`;
    for (const [url, body] of [
      [`/api/v1/flats/${c102.id}/flat-type`, { version: c102.version, flat_type_id: basics.flatTypes.A2 }],
      [`/api/v1/flats/${c102.id}/status`, { version: c102.version, status: "AVAILABLE" }],
      [`/api/v1/flats/${c102.id}/status`, { version: c102.version, status: "HOLD" }],
      [`/api/v1/flats/${c102.id}/price`, { version: c102.version, price_paise: 1 }],
    ] as const) {
      const r = await t.request<ErrorBody>("POST", url, { token: admin, body });
      expect(r.status, `${url} ${JSON.stringify(body)}`).toBe(422);
      expect(r.body.error.code).toBe("BUSINESS_RULE");
    }
    const bulkStatus = await t.request<{ updated: number; skipped_ids: string[] }>(
      "POST",
      `/api/v1/blocks/${c.id}/bulk-status`,
      { token: admin, body: { flat_ids: [c102.id, c101.id], status: "AVAILABLE" } },
    );
    expect(bulkStatus.status, bulkStatus.text).toBe(200);
    expect(bulkStatus.body.updated).toBe(1); // C-101 released, C-102 skipped
    expect(bulkStatus.body.skipped_ids).toEqual([c102.id]);
    const bulkPrice = await t.request<{ updated: number; skipped_ids: string[] }>(
      "POST",
      `/api/v1/blocks/${c.id}/bulk-price`,
      { token: admin, body: { block_id: c.id, flat_ids: [c102.id], price_paise: 1, only_available: false } },
    );
    expect(bulkPrice.body).toMatchObject({ updated: 0, skipped_ids: [c102.id] });
    expect((await get<FlatRow>(`/api/v1/flats/${c102.id}`)).price_paise).toBe(c102.price_paise);
    const regen = await t.request<ErrorBody>("POST", `/api/v1/blocks/${c.id}/generate-flats`, {
      token: admin,
      body: { version: c.version, regenerate: true },
    });
    expect(regen.status).toBe(409);
    expect(regen.body.error.code).toBe("REGENERATE_BLOCKED");
    expect(
      (
        await t.request<ErrorBody>("POST", `/api/v1/blocks/${c.id}/deactivate`, {
          token: admin,
          body: {},
          headers: ifMatch(await versionOf(t, `/api/v1/blocks/${c.id}`, admin)),
        })
      ).status,
    ).toBe(409);
    await expectCountsTrue(c.id);
    expect((await block(c.id)).unit_counts.booked).toBe(1);
  });

  it("hold_until in the past is rejected (400) on single and bulk holds; a future one is stored", async () => {
    const c103 = flats.find((f) => f.flat_number === "C-103")!;
    const past = await t.request<ErrorBody>("POST", `/api/v1/flats/${c103.id}/status`, {
      token: admin,
      body: { version: c103.version, status: "HOLD", hold_until: "2020-01-01T00:00:00.000Z" },
    });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe("VALIDATION_ERROR");
    const bulkPast = await t.request<ErrorBody>("POST", `/api/v1/blocks/${c.id}/bulk-status`, {
      token: admin,
      body: { flat_ids: [c103.id], status: "HOLD", hold_until: "2020-01-01T00:00:00.000Z" },
    });
    expect(bulkPast.status).toBe(400);
    expect((await get<FlatRow>(`/api/v1/flats/${c103.id}`)).status).toBe("AVAILABLE");
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const bulk = await t.request<{ updated: number }>("POST", `/api/v1/blocks/${c.id}/bulk-status`, {
      token: admin,
      body: { flat_ids: [c103.id], status: "HOLD", hold_until: future },
    });
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body.updated).toBe(1);
    const held = await get<FlatRow>(`/api/v1/flats/${c103.id}`);
    expect(held.status).toBe("HOLD");
    expect(held.hold_until).toBe(future);
    expect(held.version).toBe(c103.version + 1);
    await expectCountsTrue(c.id);
  });
});

describe("rate card activation race", () => {
  it("two different Draft cards activated concurrently → both succeed in some order and exactly one is ACTIVE afterwards", async () => {
    const d1 = await post<RateCard>(t, admin, "/api/v1/rate-cards", rateCardBody(sgh.id, basics, "Race 1", 1.05));
    const d2 = await post<RateCard>(t, admin, "/api/v1/rate-cards", rateCardBody(sgh.id, basics, "Race 2", 1.07));
    const [r1, r2] = await Promise.all([
      t.request<RateCard>("POST", `/api/v1/rate-cards/${d1.id}/activate`, {
        token: admin,
        body: { version: d1.version, apply_to_available_flats: false },
      }),
      t.request<RateCard>("POST", `/api/v1/rate-cards/${d2.id}/activate`, {
        token: admin,
        body: { version: d2.version, apply_to_available_flats: false },
      }),
    ]);
    expect([r1.status, r2.status], `${r1.text} | ${r2.text}`).toEqual([200, 200]);
    const active = await t.app.sql<
      { id: string }[]
    >`select id from rate_cards where project_id = ${sgh.id} and status = 'ACTIVE'`;
    expect(active).toHaveLength(1);
    const statuses = await t.app.sql<
      { id: string; status: string }[]
    >`select id, status from rate_cards where id in ${t.app.sql([d1.id, d2.id, sghCard.id])}`;
    expect(
      statuses
        .filter((s) => s.status === "SUPERSEDED")
        .map((s) => s.id)
        .sort(),
    ).toEqual([sghCard.id, active[0]!.id === d1.id ? d2.id : d1.id].sort());
  });

  it("the same Draft activated three times at once → exactly one 200, the rest 422, one ACTIVE", async () => {
    const d = await post<RateCard>(t, admin, "/api/v1/rate-cards", rateCardBody(sgh.id, basics, "Race 3", 1.1));
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        t.request<RateCard & ErrorBody>("POST", `/api/v1/rate-cards/${d.id}/activate`, {
          token: admin,
          body: { version: d.version, apply_to_available_flats: false },
        }),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 422, 422]);
    for (const r of results.filter((x) => x.status === 422))
      expect(["RATE_CARD_ALREADY_ACTIVE", "RATE_CARD_SUPERSEDED"]).toContain(r.body.error.details?.["rule"]);
    expect(
      (
        await t.app.sql<
          { n: number }[]
        >`select count(*)::int as n from rate_cards where project_id = ${sgh.id} and status = 'ACTIVE'`
      )[0]!.n,
    ).toBe(1);
    sghCard = await get<RateCard>(`/api/v1/rate-cards/${d.id}`);
    expect(sghCard.status).toBe("ACTIVE");
  });
});

describe("floor rise is never negative", () => {
  it("a hypothetical flat below floor_start and a flat on floor_start get no Floor Rise line (preview, generation, bulk step)", async () => {
    const below = await t.request<{ total_paise: number; breakup: { label: string; amount_paise: number }[] }>(
      "POST",
      "/api/v1/rate-cards/preview",
      {
        token: admin,
        body: {
          project_id: sgh.id,
          rate_card_id: sghCard.id,
          flat_type_id: basics.flatTypes.A3,
          floor: -2,
          floor_start: 1,
          is_corner: false,
        },
      },
    );
    expect(below.status, below.text).toBe(200);
    expect(below.body.breakup.some((l) => l.label === "Floor Rise")).toBe(false);
    expect(below.body.breakup.every((l) => l.amount_paise >= 0)).toBe(true);
    expect(below.body.total_paise).toBe(Math.round(A3.rate * 1.1) * A3.superb);
    const at = await t.request<{ breakup: { label: string }[] }>("POST", "/api/v1/rate-cards/preview", {
      token: admin,
      body: {
        project_id: sgh.id,
        rate_card_id: sghCard.id,
        flat_type_id: basics.flatTypes.A3,
        floor: 0,
        floor_start: 0,
      },
    });
    expect(at.body.breakup.some((l) => l.label === "Floor Rise")).toBe(false);
    // bulk-price with a floor-rise step on a floor_start-0 block: floor 0 gets only the base, floor 2 two steps
    const g = (await get<List<BlockRow>>(`/api/v1/blocks?project_id=${sgh.id}`)).items.find((b) => b.code === "G")!;
    const r = await t.request<{ updated: number }>("POST", `/api/v1/blocks/${g.id}/bulk-price`, {
      token: admin,
      body: { block_id: g.id, rate_per_sqft_paise: 500_000, floor_rise_step_paise: 1000 },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.updated).toBe(12);
    const flats = await flatsOf(g.id);
    expect(flats.find((f) => f.flat_number === "G01")!.price_paise).toBe(500_000 * A3.superb);
    expect(flats.find((f) => f.flat_number === "G01")!.price_breakup).toHaveLength(1);
    expect(flats.find((f) => f.flat_number === "201")!.price_paise).toBe(500_000 * A3.superb + 2 * 1000 * A3.superb);
    expect(flats.every((f) => f.price_breakup.every((l) => l.amount_paise >= 0))).toBe(true);
    // negative values never reach the engine
    const neg = await t.request<ErrorBody>("POST", `/api/v1/blocks/${g.id}/bulk-price`, {
      token: admin,
      body: { block_id: g.id, rate_per_sqft_paise: 500_000, floor_rise_step_paise: -1 },
    });
    expect(neg.status).toBe(400);
  });
});

describe("unit_counts stay true after every operation", () => {
  it("block deactivation excludes its flats from the project; a later status change elsewhere does not pull them back in; reactivation restores them", async () => {
    const blocks = (await get<List<BlockRow>>(`/api/v1/blocks?project_id=${sgh.id}`)).items;
    const c = blocks.find((b) => b.code === "C")!;
    const x = blocks.find((b) => b.code === "X")!;
    const withX = await project(sgh.id);
    const deact = await t.request<{ is_active: boolean }>("POST", `/api/v1/blocks/${x.id}/deactivate`, {
      token: admin,
      body: {},
      headers: ifMatch(await versionOf(t, `/api/v1/blocks/${x.id}`, admin)),
    });
    expect(deact.status, deact.text).toBe(200);
    const withoutX = await project(sgh.id);
    expect(withoutX.unit_counts.total).toBe(withX.unit_counts.total - 12);
    expect(withoutX.block_count).toBe(withX.block_count - 1);
    const c104 = (await flatsOf(c.id)).find((f) => f.flat_number === "C-104")!;
    const hold = await t.request<FlatRow>("POST", `/api/v1/flats/${c104.id}/status`, {
      token: admin,
      body: { version: c104.version, status: "HOLD" },
    });
    expect(hold.status, hold.text).toBe(200);
    const afterHold = await project(sgh.id);
    expect(afterHold.unit_counts.total).toBe(withoutX.unit_counts.total); // inactive block still excluded
    expect(afterHold.unit_counts.hold).toBe(withoutX.unit_counts.hold + 1);
    await expectCountsTrue(c.id);
    const react = await t.request<{ is_active: boolean }>("POST", `/api/v1/blocks/${x.id}/activate`, {
      token: admin,
      body: {},
      headers: ifMatch(await versionOf(t, `/api/v1/blocks/${x.id}`, admin)),
    });
    expect(react.status, react.text).toBe(200);
    expect((await project(sgh.id)).unit_counts.total).toBe(withX.unit_counts.total);
    await expectCountsTrue(x.id);
  });

  it("regenerate, flat-type change, price edits, apply rate card and bulk status all leave block and project counts equal to the flats table", async () => {
    const x = (await get<List<BlockRow>>(`/api/v1/blocks?project_id=${sgh.id}`)).items.find((b) => b.code === "X")!;
    const regen = await t.request<GenResult>("POST", `/api/v1/blocks/${x.id}/generate-flats`, {
      token: admin,
      body: { version: x.version, regenerate: true },
    });
    expect(regen.status, regen.text).toBe(200);
    await expectCountsTrue(x.id);
    const flats = await flatsOf(x.id);
    const typed = await t.request<FlatRow>("POST", `/api/v1/flats/${flats[0]!.id}/flat-type`, {
      token: admin,
      body: { version: flats[0]!.version, flat_type_id: basics.flatTypes.B3 },
    });
    expect(typed.status, typed.text).toBe(200);
    expect(typed.body.flat_type_code).toBe("3BHK-B");
    expect(typed.body.rate_card_id).toBe(sghCard.id);
    await expectCountsTrue(x.id);
    const priced = await t.request<FlatRow>("POST", `/api/v1/flats/${flats[1]!.id}/price`, {
      token: admin,
      body: { version: flats[1]!.version, price_paise: 123 },
    });
    expect(priced.status, priced.text).toBe(200);
    const bulk = await t.request<{ updated: number; skipped: number }>("POST", `/api/v1/blocks/${x.id}/bulk-status`, {
      token: admin,
      body: { flat_ids: flats.slice(2, 6).map((f) => f.id), status: "BLOCKED" },
    });
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body).toMatchObject({ updated: 4, skipped: 0 });
    expect((await flatsOf(x.id)).filter((f) => f.status === "BLOCKED").every((f) => f.version === 2)).toBe(true); // one bump per flat
    await expectCountsTrue(x.id);
    const blockedBefore = await get<FlatRow>(`/api/v1/flats/${flats[2]!.id}`);
    const apply = await t.request<{ repriced: number; skipped_not_available: number }>(
      "POST",
      `/api/v1/rate-cards/${sghCard.id}/apply`,
      { token: admin, body: { block_id: x.id } },
    );
    expect(apply.status, apply.text).toBe(200);
    expect(apply.body).toMatchObject({ repriced: 8, skipped_not_available: 4 });
    const repriced = await get<FlatRow>(`/api/v1/flats/${flats[1]!.id}`);
    expect(repriced.price_paise).not.toBe(123); // Available → repriced
    expect(repriced.rate_card_id).toBe(sghCard.id);
    expect(await get<FlatRow>(`/api/v1/flats/${flats[2]!.id}`)).toMatchObject({
      price_paise: blockedBefore.price_paise,
      version: blockedBefore.version,
    }); // BLOCKED keeps its price
    await expectCountsTrue(x.id);
  });
});

describe("scope → 404 on every inventory route, never 403, nothing written", () => {
  it("a user with every inventory permission but scoped to another project gets 404 on reads and writes of SGH/GGV entities", async () => {
    const c = (await get<List<BlockRow>>(`/api/v1/blocks?project_id=${sgh.id}`)).items.find((b) => b.code === "C")!;
    const flat = (await flatsOf(c.id)).find((f) => f.status === "AVAILABLE")!;
    const slot = await post<Slot>(t, admin, `/api/v1/projects/${sgh.id}/parking`, {
      project_id: sgh.id,
      number: "SC-1",
      slot_type: "OPEN",
    });
    const v = 1;
    const calls: [string, string, unknown?][] = [
      ["GET", `/api/v1/projects/${sgh.id}`],
      ["PATCH", `/api/v1/projects/${sgh.id}`, { version: v, name: "x" }],
      ["POST", `/api/v1/projects/${sgh.id}/stage-sequence`, { version: v, stage_sequence: basics.stageIds }],
      ["POST", `/api/v1/projects/${sgh.id}/deactivate`, {}],
      ["POST", `/api/v1/projects/${sgh.id}/activate`, {}],
      ["GET", `/api/v1/blocks/${c.id}`],
      ["GET", `/api/v1/blocks/${c.id}/grid`],
      ["PATCH", `/api/v1/blocks/${c.id}`, { version: v, name: "x" }],
      ["POST", `/api/v1/blocks/${c.id}/stage-sequence`, { version: v, stage_sequence: basics.stageIds }],
      ["POST", `/api/v1/blocks/${c.id}/generate-flats`, { version: v, regenerate: true }],
      [
        "POST",
        `/api/v1/blocks/${c.id}/floors`,
        {
          version: v,
          new_floors: 1,
          floor_plans: [{ from_floor: 18, to_floor: 18, floor_plan_template_id: basics.templates.FP4 }],
        },
      ],
      ["POST", `/api/v1/blocks/${c.id}/bulk-status`, { flat_ids: [flat.id], status: "BLOCKED" }],
      ["POST", `/api/v1/blocks/${c.id}/bulk-price`, { block_id: c.id, price_paise: 1 }],
      ["POST", `/api/v1/blocks/${c.id}/deactivate`, {}],
      ["POST", `/api/v1/blocks/${c.id}/activate`, {}],
      ["POST", "/api/v1/blocks", towerCBody(sgh.id, basics, { code: "ZZ" })],
      ["POST", "/api/v1/blocks/preview", towerCBody(sgh.id, basics, { code: "ZZ" })],
      ["GET", `/api/v1/blocks?project_id=${sgh.id}`],
      ["GET", `/api/v1/flats?project_id=${sgh.id}`],
      ["GET", `/api/v1/rate-cards?project_id=${sgh.id}`],
      ["GET", `/api/v1/flats/${flat.id}`],
      ["PATCH", `/api/v1/flats/${flat.id}`, { version: v, notes: "x" }],
      ["POST", `/api/v1/flats/${flat.id}/price`, { version: v, price_paise: 1 }],
      ["POST", `/api/v1/flats/${flat.id}/status`, { version: v, status: "HOLD" }],
      ["POST", `/api/v1/flats/${flat.id}/flat-type`, { version: v, flat_type_id: basics.flatTypes.A2 }],
      ["GET", `/api/v1/rate-cards/${sghCard.id}`],
      ["PATCH", `/api/v1/rate-cards/${sghCard.id}`, { version: v, name: "x" }],
      ["POST", `/api/v1/rate-cards/${sghCard.id}/activate`, { version: v }],
      ["POST", `/api/v1/rate-cards/${sghCard.id}/apply`, {}],
      ["POST", "/api/v1/rate-cards", rateCardBody(sgh.id, basics, "Scoped")],
      ["POST", "/api/v1/rate-cards/preview", { project_id: sgh.id, flat_type_id: basics.flatTypes.A3, floor: 1 }],
      ["POST", "/api/v1/rate-cards/preview", { project_id: other.id, flat_id: flat.id }],
      [
        "POST",
        "/api/v1/rate-cards/preview",
        { project_id: other.id, rate_card_id: sghCard.id, flat_type_id: basics.flatTypes.A3, floor: 1 },
      ],
      ["GET", `/api/v1/rate-cards/preview?flat_id=${flat.id}`],
      ["GET", `/api/v1/projects/${sgh.id}/parking`],
      ["POST", `/api/v1/projects/${sgh.id}/parking`, { project_id: sgh.id, number: "SC-2", slot_type: "OPEN" }],
      [
        "POST",
        `/api/v1/projects/${sgh.id}/parking/bulk-generate`,
        { project_id: sgh.id, prefix: "Z", from_number: 1, to_number: 2, slot_type: "OPEN" },
      ],
      ["GET", `/api/v1/projects/${sgh.id}/parking/${slot.id}`],
      ["PATCH", `/api/v1/projects/${sgh.id}/parking/${slot.id}`, { version: v, level: "x" }],
      ["POST", `/api/v1/projects/${sgh.id}/parking/${slot.id}/status`, { version: v, status: "BLOCKED" }],
      ["POST", `/api/v1/projects/${sgh.id}/parking/bulk-status`, { slot_ids: [slot.id], status: "BLOCKED" }],
    ];
    const auditsBefore = (await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs`)[0]!.n;
    for (const [method, url, body] of calls) {
      const r = await t.request<ErrorBody>(method as "GET", url, {
        token: scoped,
        ...(body !== undefined ? { body } : {}),
      });
      expect(r.status, `${method} ${url} → ${r.text}`).toBe(404);
      expect(r.body.error.code).toBe("NOT_FOUND");
    }
    expect((await t.app.sql<{ n: number }[]>`select count(*)::int as n from audit_logs`)[0]!.n).toBe(auditsBefore);
    expect((await get<FlatRow>(`/api/v1/flats/${flat.id}`)).version).toBe(flat.version);
    // the same user works normally inside their scope
    const mine = await t.request<BlockRow>("POST", "/api/v1/blocks", {
      token: scoped,
      body: towerCBody(other.id, basics, {
        name: "Own",
        code: "OWN",
        floors: 1,
        skip_floors: [],
        refuge_floors: [],
        floor_plans: [{ from_floor: 1, to_floor: 1, floor_plan_template_id: basics.templates.FP4 }],
      }),
    });
    expect(mine.status, mine.text).toBe(201);
    expect((await get<List<ProjectRow>>("/api/v1/projects", scoped)).items.map((p) => p.code)).toEqual(["OTH"]);
    expect((await get<List<FlatRow>>("/api/v1/flats", scoped)).total).toBe(4);
  });
});

describe("idempotency, versions and audit rows", () => {
  it("generate-flats and append floors replay with Idempotency-Key without creating twice; stale versions are 409", async () => {
    const created = await post<BlockRow>(
      t,
      admin,
      "/api/v1/blocks",
      towerCBody(sgh.id, basics, {
        name: "Tower I",
        code: "I",
        floors: 2,
        skip_floors: [],
        refuge_floors: [],
        floor_plans: [{ from_floor: 1, to_floor: 2, floor_plan_template_id: basics.templates.FP4 }],
        generate_flats: false,
      }),
    );
    const first = await t.request<GenResult>("POST", `/api/v1/blocks/${created.id}/generate-flats`, {
      token: admin,
      body: { version: created.version },
      headers: { "idempotency-key": "gen-i-1" },
    });
    expect(first.status, first.text).toBe(200);
    const replay = await t.request<GenResult>("POST", `/api/v1/blocks/${created.id}/generate-flats`, {
      token: admin,
      body: { version: created.version },
      headers: { "idempotency-key": "gen-i-1" },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body).toEqual(first.body);
    expect((await flatsOf(created.id)).length).toBe(8);
    const stale = await t.request<ErrorBody>("POST", `/api/v1/blocks/${created.id}/floors`, {
      token: admin,
      body: {
        version: created.version,
        new_floors: 1,
        floor_plans: [{ from_floor: 3, to_floor: 3, floor_plan_template_id: basics.templates.FP4 }],
      },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const app1 = await t.request<GenResult>("POST", `/api/v1/blocks/${created.id}/floors`, {
      token: admin,
      body: {
        version: first.body.version,
        new_floors: 1,
        floor_plans: [{ from_floor: 3, to_floor: 3, floor_plan_template_id: basics.templates.FP4 }],
      },
      headers: { "idempotency-key": "floors-i-1" },
    });
    expect(app1.status, app1.text).toBe(200);
    const app2 = await t.request<GenResult>("POST", `/api/v1/blocks/${created.id}/floors`, {
      token: admin,
      body: {
        version: first.body.version,
        new_floors: 1,
        floor_plans: [{ from_floor: 3, to_floor: 3, floor_plan_template_id: basics.templates.FP4 }],
      },
      headers: { "idempotency-key": "floors-i-1" },
    });
    expect(app2.headers["idempotent-replayed"]).toBe("true");
    expect((await flatsOf(created.id)).length).toBe(12);
    await expectCountsTrue(created.id);
  });

  it("every mutation leaves at least one audit row for its entity (projects, blocks, flats, rate cards, parking)", async () => {
    const i = (await get<List<BlockRow>>(`/api/v1/blocks?project_id=${sgh.id}`)).items.find((b) => b.code === "I")!;
    const flats = await flatsOf(i.id);
    const f = flats[0]!;
    expect(await auditCount("flat", f.id)).toBeGreaterThanOrEqual(1); // flat.generate
    const n0 = await auditCount("flat", f.id);
    expect(
      (await t.request("PATCH", `/api/v1/flats/${f.id}`, { token: admin, body: { version: f.version, notes: "n" } }))
        .status,
    ).toBe(200);
    expect(
      (
        await t.request("POST", `/api/v1/flats/${f.id}/price`, {
          token: admin,
          body: { version: f.version + 1, price_paise: 5 },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.request("POST", `/api/v1/flats/${f.id}/status`, {
          token: admin,
          body: { version: f.version + 2, status: "BLOCKED" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.request("POST", `/api/v1/flats/${f.id}/status`, {
          token: admin,
          body: { version: f.version + 3, status: "AVAILABLE" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.request("POST", `/api/v1/flats/${f.id}/flat-type`, {
          token: admin,
          body: { version: f.version + 4, flat_type_id: basics.flatTypes.A2 },
        })
      ).status,
    ).toBe(200);
    expect(await auditCount("flat", f.id)).toBe(n0 + 5);
    const b0 = await auditCount("block", i.id);
    expect(
      (
        await t.request("PATCH", `/api/v1/blocks/${i.id}`, {
          token: admin,
          body: { version: i.version, name: "Tower I (renamed)" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.request("POST", `/api/v1/blocks/${i.id}/stage-sequence`, {
          token: admin,
          body: { version: i.version + 1, stage_sequence: [...basics.stageIds].reverse() },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.request("POST", `/api/v1/blocks/${i.id}/bulk-price`, {
          token: admin,
          body: { block_id: i.id, price_paise: 7 },
        })
      ).status,
    ).toBe(200);
    expect(await auditCount("block", i.id)).toBe(b0 + 3);
    const p0 = await auditCount("project", sgh.id);
    const proj = await project(sgh.id);
    expect(
      (
        await t.request("PATCH", `/api/v1/projects/${sgh.id}`, {
          token: admin,
          body: { version: proj.version, description: "d" },
        })
      ).status,
    ).toBe(200);
    expect(await auditCount("project", sgh.id)).toBe(p0 + 1);
    const slot = await post<Slot>(t, admin, `/api/v1/projects/${sgh.id}/parking`, {
      project_id: sgh.id,
      number: "AU-1",
      slot_type: "OPEN",
    });
    expect(await auditCount("parking_slot", slot.id)).toBe(1);
    expect(
      (
        await t.request("PATCH", `/api/v1/projects/${sgh.id}/parking/${slot.id}`, {
          token: admin,
          body: { version: 1, level: "L1", status: "BLOCKED" },
        })
      ).status,
    ).toBe(200);
    expect(await auditCount("parking_slot", slot.id)).toBe(3); // status + update
    expect(
      (
        await t.request("POST", `/api/v1/projects/${sgh.id}/parking/bulk-status`, {
          token: admin,
          body: { slot_ids: [slot.id], status: "AVAILABLE" },
        })
      ).status,
    ).toBe(200);
    expect(await auditCount("parking_slot", slot.id)).toBe(4);
    const rc0 = await auditCount("rate_card", sghCard.id);
    expect(
      (await t.request("POST", `/api/v1/rate-cards/${sghCard.id}/apply`, { token: admin, body: { dry_run: true } }))
        .status,
    ).toBe(200);
    expect(await auditCount("rate_card", sghCard.id)).toBe(rc0); // dry runs write nothing
    expect((await t.request("POST", `/api/v1/rate-cards/${sghCard.id}/apply`, { token: admin, body: {} })).status).toBe(
      200,
    );
    expect(await auditCount("rate_card", sghCard.id)).toBe(rc0 + 1);
  });
});
