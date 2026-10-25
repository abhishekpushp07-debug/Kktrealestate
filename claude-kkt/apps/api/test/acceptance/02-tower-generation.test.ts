import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOOT_TIMEOUT, blockByCode, bootAcceptance, flatsOf, key, masterByCode, projectByCode, type Block, type ErrorBody, type Flat, type Harness } from "./harness.js";

/**
 * SPEC §18 scenario 2 (L243): "Creating a 15-floor tower with skip 13 and refuge 7 yields the correct flat count and numbering, with
 * rooms/areas snapshotted and prices with PLC breakups; regenerate blocked once a flat is on Hold."
 * Proven twice: on the seeded Tower C (docs/SEED.md) and on a brand-new tower generated through POST /blocks in this file.
 */

// docs/SEED.md masters: 3BHK-A ₹5,600/sq ft × 1520 sq ft super built-up; 2BHK-A ₹5,200 × 1050; Floor Rise ₹25/sq ft/floor; Corner ₹100/sq ft; Top Floor ₹1,50,000 fixed (floors ≥ 15)
const A3 = { rate: 560_000, superb: 1520, carpet: 1050, builtup: 1250 };
const A2 = { rate: 520_000, superb: 1050 };
const B3 = { rate: 580_000, superb: 1700 };
const RISE_PER_FLOOR = 2_500;
const CORNER_PER_SQFT = 10_000;
const TOP_FLOOR_FIXED = 150_000_00;

let h: Harness;
let admin: string;
let sghId: string;

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  sghId = (await projectByCode(h, admin, "SGH")).id;
}, BOOT_TIMEOUT);
afterAll(async () => { await h?.close(); });

/** The generation facts every 15/skip-13/refuge-7 tower built from FP-4 (1–5) + FP-4-PREMIUM (6–15) must satisfy. */
function assertTowerFacts(code: string, flats: Map<string, Flat>): void {
  // SPEC L75 step 1: physical floors = 1..15 minus skip 13, refuge 7 has no units → 13 unit floors × 4 positions = 52 flats (SEED.md)
  expect(flats.size).toBe(52);
  const floors = [...new Set([...flats.values()].map((f) => f.floor))].sort((a, b) => a - b);
  expect(floors).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15]);
  // SPEC L72 numbering pattern {block}-{floor}{pos2} → C-101 … C-1504, never 13xx or 7xx
  const numbers = [...flats.keys()];
  expect(numbers.every((n) => new RegExp(`^${code}-(\\d{1,2})(0[1-4])$`).test(n))).toBe(true);
  expect(numbers.some((n) => n.startsWith(`${code}-13`) || n.startsWith(`${code}-7`))).toBe(false);
  for (const n of ["101", "104", "501", "601", "801", "1201", "1401", "1504"]) expect(flats.has(`${code}-${n}`), `${code}-${n}`).toBe(true);
  for (const floor of floors) for (const pos of [1, 2, 3, 4]) expect(flats.get(`${code}-${floor}0${pos}`)?.position, `${code}-${floor}0${pos}`).toBe(pos);

  // SPEC L76–77: floors 1–5 use FP-4 (3BHK-A E corner, 2BHK-A N, 2BHK-B S, 3BHK-B W corner); 6–15 use FP-4-PREMIUM (4 × 3BHK-A, corners at 1 and 4)
  for (const floor of [1, 2, 3, 4, 5]) {
    expect(flats.get(`${code}-${floor}01`)).toMatchObject({ flat_type_code: "3BHK-A", facing: "E", is_corner: true });
    expect(flats.get(`${code}-${floor}02`)).toMatchObject({ flat_type_code: "2BHK-A", facing: "N", is_corner: false });
    expect(flats.get(`${code}-${floor}03`)).toMatchObject({ flat_type_code: "2BHK-B", facing: "S", is_corner: false });
    expect(flats.get(`${code}-${floor}04`)).toMatchObject({ flat_type_code: "3BHK-B", facing: "W", is_corner: true });
  }
  for (const floor of [6, 8, 9, 10, 11, 12, 14, 15]) {
    for (const pos of [1, 2, 3, 4]) expect(flats.get(`${code}-${floor}0${pos}`)?.flat_type_code, `${code}-${floor}0${pos}`).toBe("3BHK-A");
    expect(flats.get(`${code}-${floor}01`)?.is_corner).toBe(true);
    expect(flats.get(`${code}-${floor}02`)?.is_corner).toBe(false);
    expect(flats.get(`${code}-${floor}04`)?.is_corner).toBe(true);
  }

  // SPEC L78: rooms and areas SNAPSHOTTED into the flat (carpet / built-up / super built-up stored)
  const c101 = flats.get(`${code}-101`)!;
  expect(c101.rooms_snapshot.length).toBeGreaterThanOrEqual(10); // 3BHK-A: 7 base rooms + Bedroom 3 + Dining + Pooja (SEED.md)
  expect(c101.rooms_snapshot.find((r) => r.label === "Master Bedroom")?.sqft).toBe(12 * 11); // auto sq ft = L × W (SPEC L53)
  expect(c101.rooms_snapshot.find((r) => r.label === "Pooja")?.sqft).toBe(16);
  expect(c101.areas_snapshot.find((a) => a.area_type_code === "CARPET")?.sqft).toBe(A3.carpet);
  expect(c101.areas_snapshot.find((a) => a.area_type_code === "BUILT_UP")?.sqft).toBe(A3.builtup);
  expect(c101.areas_snapshot.find((a) => a.area_type_code === "SUPER_BUILT_UP")?.sqft).toBe(A3.superb);
  expect([c101.carpet_sqft, c101.builtup_sqft, c101.super_builtup_sqft]).toEqual([A3.carpet, A3.builtup, A3.superb]);
  expect(c101.super_builtup_sqft).toBeGreaterThanOrEqual(c101.builtup_sqft); // SPEC L53: super built-up ≥ built-up ≥ carpet
  expect(c101.builtup_sqft).toBeGreaterThanOrEqual(c101.carpet_sqft);

  // SPEC L79 + L93: price = rate × super built-up, plus every PLC rule the flat satisfies, stored as [label, amount] lines and a total
  const base = A3.rate * A3.superb;
  const corner = CORNER_PER_SQFT * A3.superb;
  expect(c101.rate_per_sqft_paise).toBe(A3.rate);
  expect(c101.price_breakup.map((l) => l.label)).toEqual([expect.stringContaining("Base price"), "Corner"]); // floor 1 → no floor rise
  expect(c101.price_breakup.find((l) => l.label === "Corner")?.amount_paise).toBe(corner);
  expect(c101.price_paise).toBe(base + corner);
  const c102 = flats.get(`${code}-102`)!; // 2BHK-A, not a corner, floor 1
  expect(c102.price_paise).toBe(A2.rate * A2.superb);
  expect(c102.price_breakup.some((l) => l.label === "Corner")).toBe(false);
  const c504 = flats.get(`${code}-504`)!; // 3BHK-B corner on floor 5: floor rise × 4 floors
  expect(c504.price_breakup.find((l) => l.label === "Floor Rise")?.amount_paise).toBe(RISE_PER_FLOOR * 4 * B3.superb);
  expect(c504.price_paise).toBe(B3.rate * B3.superb + RISE_PER_FLOOR * 4 * B3.superb + CORNER_PER_SQFT * B3.superb);
  const c1402 = flats.get(`${code}-1402`)!; // floor 14, no corner, no top floor
  expect(c1402.price_breakup.map((l) => l.label)).toEqual([expect.stringContaining("Base price"), "Floor Rise"]);
  expect(c1402.price_paise).toBe(base + RISE_PER_FLOOR * 13 * A3.superb);
  const c1504 = flats.get(`${code}-1504`)!; // top floor corner: floor rise × 14 + corner + top-floor fixed PLC
  expect(c1504.price_breakup.map((l) => l.label)).toEqual([expect.stringContaining("Base price"), "Floor Rise", "Corner", "Top Floor"]);
  expect(c1504.price_breakup.find((l) => l.label === "Floor Rise")?.amount_paise).toBe(RISE_PER_FLOOR * 14 * A3.superb);
  expect(c1504.price_breakup.find((l) => l.label === "Top Floor")?.amount_paise).toBe(TOP_FLOOR_FIXED);
  expect(c1504.price_paise).toBe(base + RISE_PER_FLOOR * 14 * A3.superb + corner + TOP_FLOOR_FIXED);
  // every flat: the line items add up to the stored total (SPEC L93 "store a line-item breakup and the total")
  for (const f of flats.values()) expect(f.price_breakup.reduce((s, l) => s + l.amount_paise, 0), f.flat_number).toBe(f.price_paise);
}

/** Puts one Available flat on HOLD, proves regenerate is blocked, releases it again. */
async function assertRegenerateGuard(block: Block, flats: Map<string, Flat>, flatNumber: string, otherNonAvailable: number): Promise<void> {
  const flat = flats.get(flatNumber)!;
  expect(flat.status).toBe("AVAILABLE");
  const hold = await h.request<Flat & ErrorBody>("POST", `/api/v1/flats/${flat.id}/status`, { token: admin, body: { version: flat.version, status: "HOLD", reason: "Token advance expected" } });
  expect(hold.status, hold.text).toBe(200);
  expect(hold.body.status).toBe("HOLD"); // SPEC L83: Available ↔ Hold is a manual transition
  const current = await h.request<Block>("GET", `/api/v1/blocks/${block.id}`, { token: admin });
  const blocked = await h.request<ErrorBody>("POST", `/api/v1/blocks/${block.id}/generate-flats`, { token: admin, body: { version: current.body.version, regenerate: true }, headers: { "idempotency-key": key() } });
  // SPEC L81: "regenerate is blocked if any flat is not 'Available'"
  expect(blocked.status).toBe(409);
  expect(blocked.body.error.code).toBe("REGENERATE_BLOCKED");
  expect(blocked.body.error.details?.["non_available"]).toBe(otherNonAvailable + 1); // the HOLD flat counts (plus any already-booked ones)
  expect(blocked.body.error.details?.["total"]).toBe(52);
  // nothing changed: still 52 flats, the HOLD flat untouched (SPEC L80 atomic — nothing is created on failure)
  const after = await flatsOf(h, admin, block.id);
  expect(after.size).toBe(52);
  expect(after.get(flatNumber)?.id).toBe(flat.id);
  expect(after.get(flatNumber)?.status).toBe("HOLD");
  const release = await h.request<Flat>("POST", `/api/v1/flats/${flat.id}/status`, { token: admin, body: { version: hold.body.version, status: "AVAILABLE" } });
  expect(release.status, release.text).toBe(200);
  expect(release.body.status).toBe("AVAILABLE");
}

describe("scenario 2 — the seeded Tower C", () => {
  it("has 52 correctly numbered flats with snapshots and PLC breakups; regenerate is blocked once a flat is on Hold", async () => {
    const towerC = await blockByCode(h, admin, sghId, "C");
    expect(towerC.floors).toBe(15);
    expect(towerC.unit_counts.total).toBe(52); // derived unit counts (SPEC L72)
    const flats = await flatsOf(h, admin, towerC.id);
    assertTowerFacts("C", flats);
    await assertRegenerateGuard(towerC, flats, "C-1203", 1); // C-502 carries the seeded Flexi booking #7 (SEED.md)
  });
});

describe("scenario 2 — a new 15-floor tower generated through the API", () => {
  it("POST /blocks with skip 13 and refuge 7 creates exactly 52 priced, snapshotted flats atomically; Hold blocks regenerate; all-Available regenerate works", async () => {
    const towerType = await masterByCode<{ id: string; code: string }>(h, admin, "block-types", "TOWER");
    const fp4 = await masterByCode<{ id: string; code: string }>(h, admin, "floor-plan-templates", "FP-4");
    const fp4p = await masterByCode<{ id: string; code: string }>(h, admin, "floor-plan-templates", "FP-4-PREMIUM");
    const body = {
      project_id: sghId, block_type_id: towerType.id, name: "Tower T", code: "T", floors: 15, floor_start: 1, ground_floor_label: "G",
      skip_floors: [13], refuge_floors: [7], podium_floors: [],
      floor_plans: [{ from_floor: 1, to_floor: 5, floor_plan_template_id: fp4.id }, { from_floor: 6, to_floor: 15, floor_plan_template_id: fp4p.id }],
      numbering_pattern: "{block}-{floor}{pos2}", status: "UNDER_CONSTRUCTION",
    };
    // SPEC L74: generation runs when the block is created
    const created = await h.request<Block & ErrorBody>("POST", "/api/v1/blocks", { token: admin, body, headers: { "idempotency-key": key() } });
    expect(created.status, created.text).toBe(201);
    expect(created.body.has_flats).toBe(true);
    expect(created.body.unit_counts).toEqual({ available: 52, hold: 0, blocked: 0, booked: 0, sold: 0, total: 52 });
    const flats = await flatsOf(h, admin, created.body.id);
    assertTowerFacts("T", flats);
    // SPEC L80: a failed create writes nothing — a duplicate code is refused and the project still has exactly one Tower T
    const dup = await h.request<ErrorBody>("POST", "/api/v1/blocks", { token: admin, body, headers: { "idempotency-key": key() } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");
    const blocks = await h.request<{ items: { code: string }[] }>("GET", `/api/v1/blocks?project_id=${sghId}&page_size=50`, { token: admin });
    expect(blocks.body.items.filter((b) => b.code === "T")).toHaveLength(1);
    // SPEC L81 guard on the new tower, then a regenerate with every flat Available succeeds and re-creates 52
    await assertRegenerateGuard(created.body, flats, "T-1001", 0);
    const block = await h.request<Block>("GET", `/api/v1/blocks/${created.body.id}`, { token: admin });
    const regen = await h.request<{ flats_created: number; floors_with_units: number } & ErrorBody>("POST", `/api/v1/blocks/${created.body.id}/generate-flats`, { token: admin, body: { version: block.body.version, regenerate: true }, headers: { "idempotency-key": key() } });
    expect(regen.status, regen.text).toBe(200);
    expect(regen.body.flats_created).toBe(52);
    expect(regen.body.floors_with_units).toBe(13);
    assertTowerFacts("T", await flatsOf(h, admin, created.body.id));
    // SPEC L83: Booked / Sold are set only by the booking engine — a manual attempt is rejected
    const any = (await flatsOf(h, admin, created.body.id)).get("T-101")!;
    const manual = await h.request<ErrorBody>("POST", `/api/v1/flats/${any.id}/status`, { token: admin, body: { version: any.version, status: "BOOKED" } });
    expect(manual.status).toBe(422);
  });
});
