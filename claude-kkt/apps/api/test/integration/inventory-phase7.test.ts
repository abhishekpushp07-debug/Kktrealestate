/**
 * Phase 7 domain track — inventory (docs/hardening/phase7-domain.md, items 1–3):
 * 1. rate-card apply locks the flats it re-prices (FOR UPDATE, id order) and updates only flats still AVAILABLE: a flat booked
 *    concurrently keeps its booked price;
 * 2. regenerating / structurally editing a block whose flats have booking history (a cancelled booking) is 409
 *    FLAT_HAS_BOOKING_HISTORY listing the flats when the change would delete them, and works (regenerating them in place) otherwise;
 * 3. a stored PERCENT PLC with 3+ decimals (older rows; the contract refuses new ones) is a 422 INVALID_AMOUNT on generation,
 *    activation, apply and preview — never a 500.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FlatHasBookingHistoryDetailsSchema } from "@kkt/contracts";
import { todayIST } from "@kkt/domain";
import { rateCardBody } from "./fixtures/inventory.js";
import { createMoneyWorld, LIST_PRICE_PAISE, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

const L = 10_000_000;
const CR = 100 * L;

let t: TestContext;
let admin: string;
let w: MoneyWorld;
let today: string;
let keyN = 0;
const key = (): string => `inv-p7-${Date.now()}-${++keyN}`;

type FlatRow = { id: string; flat_number: string; status: string; price_paise: number; version: number };
type ApplyResult = { repriced: number; skipped_not_available: number; skipped_no_rate: number };

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  today = todayIST();
  w = await createMoneyWorld(t, admin);
}, 180_000);

afterAll(async () => {
  await t?.close();
});

async function flatsOf(blockId: string): Promise<Map<string, FlatRow>> {
  const r = await t.request<{ items: FlatRow[] }>("GET", `/api/v1/flats?block_id=${blockId}&page_size=200`, {
    token: admin,
  });
  expect(r.status, r.text).toBe(200);
  return new Map(r.body.items.map((f) => [f.flat_number, f]));
}

async function book(flatId: string, customer: string): Promise<{ status: number; id?: string; text: string }> {
  const b = await t.request<{ id: string }>("POST", "/api/v1/bookings", {
    token: admin,
    headers: { "idempotency-key": key() },
    body: {
      flat_id: flatId,
      customer_id: customer,
      booking_date: today,
      agreement_value_paise: CR,
      cash_agreed_paise: 60 * L,
      account_agreed_paise: 40 * L,
      plan_acceptance_mode: "IN_PERSON",
      plan_accepted_on: today,
      // the list price may have moved under a concurrent rate-card apply; the deviation is allowed with a reason
      price_deviation_reason: "Price agreed before the rate card change",
    },
  });
  return { status: b.status, id: b.body.id, text: b.text };
}

async function cancel(bookingId: string): Promise<void> {
  const cur = await t.request<{ version: number }>("GET", `/api/v1/bookings/${bookingId}`, { token: admin });
  const c = await t.request("POST", `/api/v1/bookings/${bookingId}/cancel`, {
    token: admin,
    body: { version: cur.body.version, reason: "Customer withdrew the booking" },
  });
  expect(c.status, c.text).toBe(200);
}

/** Waits until some backend waits on a row lock (the API request queued behind the test's open transaction). */
async function waitForLockWaiter(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [r] = await t.app.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`;
    if ((r?.n ?? 0) > 0) return;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error("no backend ever waited on the lock");
}

describe("1. rate-card apply vs a concurrent booking", () => {
  let cardId: string;

  beforeAll(async () => {
    const created = await t.request<{ id: string; version: number }>("POST", "/api/v1/rate-cards", {
      token: admin,
      body: rateCardBody(w.sgh.id, w.basics, "SGH P7 card", 2),
    });
    expect(created.status, created.text).toBe(201);
    const act = await t.request<{ status: string }>("POST", `/api/v1/rate-cards/${created.body.id}/activate`, {
      token: admin,
      body: { version: created.body.version, apply_to_available_flats: false },
    });
    expect(act.status, act.text).toBe(200);
    cardId = created.body.id;
  });

  it("a flat locked and taken off AVAILABLE by another transaction keeps its price; apply waits for the lock, then skips it", async () => {
    const before = await flatsOf(w.sgh.towerId);
    const target = before.get("A-101")!;
    const [avail] = await t.app.sql<{ n: number }[]>`
      select count(*)::int as n from flats where project_id = ${w.sgh.id} and status = 'AVAILABLE'`;
    expect(target.status).toBe("AVAILABLE");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    // the booking engine's unit of work: lock the flat, change its status, commit later
    const holder = t.app.sql.begin(async (tx) => {
      await tx`select id from flats where id = ${target.id} for update`;
      await tx`update flats set status = 'BLOCKED', version = version + 1 where id = ${target.id}`;
      locked();
      await gate;
    });
    await isLocked;
    const apply = t.request<ApplyResult>("POST", `/api/v1/rate-cards/${cardId}/apply`, {
      token: admin,
      body: { dry_run: false },
    });
    await waitForLockWaiter();
    release();
    await holder;
    const res = await apply;
    expect(res.status, res.text).toBe(200);
    const after = await flatsOf(w.sgh.towerId);
    expect(after.get("A-101")!.price_paise).toBe(target.price_paise);
    expect(after.get("A-101")!.status).toBe("BLOCKED");
    const available = [...before.values()].filter((f) => f.status === "AVAILABLE");
    expect(res.body.repriced).toBe(avail!.n - 1); // every AVAILABLE flat of the project but the one taken meanwhile
    expect(res.body.skipped_not_available).toBeGreaterThanOrEqual(1);
    for (const f of available.filter((x) => x.flat_number !== "A-101"))
      expect(after.get(f.flat_number)!.price_paise).not.toBe(f.price_paise); // card × 2 re-priced them
    await t.app.sql`update flats set status = 'AVAILABLE', version = version + 1 where id = ${target.id}`;
  });

  it("the UPDATE itself re-checks AVAILABLE (applyPriceUpdates never re-prices a BOOKED/SOLD flat)", async () => {
    const { applyPriceUpdates } = await import("../../src/modules/inventory/service.js");
    const flats = await flatsOf(w.sgh.towerId);
    const f = flats.get("A-102")!;
    await t.app.sql`update flats set status = 'BOOKED' where id = ${f.id}`;
    try {
      const written = await t.app.db.transaction((tx) =>
        applyPriceUpdates(tx, [{ id: f.id, price: 1, rate: null, breakup: [] }], null),
      );
      expect(written).toEqual([]);
      const [row] = await t.app.sql<{ p: number }[]>`select price_paise::int8 as p from flats where id = ${f.id}`;
      expect(Number(row!.p)).toBe(f.price_paise);
    } finally {
      await t.app.sql`update flats set status = 'AVAILABLE' where id = ${f.id}`;
    }
  });

  it("racing a real booking against apply: the booked flat's price always equals the booking's list price", async () => {
    // fresh prices so the booking and the apply disagree on the price
    await t.app
      .sql`update flats set price_paise = ${LIST_PRICE_PAISE}, rate_card_id = null where block_id = ${w.sgh.towerId} and status = 'AVAILABLE'`;
    const flats = await flatsOf(w.sgh.towerId);
    const targets = ["A-201", "A-202", "A-203"].map((n) => flats.get(n)!);
    for (const [i, target] of targets.entries()) {
      const [b, a] = await Promise.all([
        book(target.id, w.customers[i]!),
        t.request<ApplyResult>("POST", `/api/v1/rate-cards/${cardId}/apply`, {
          token: admin,
          body: { dry_run: false },
        }),
      ]);
      expect(b.status, b.text).toBe(201);
      expect(a.status, a.text).toBe(200);
      const [row] = await t.app.sql<{ price: string; list: string; status: string }[]>`
        select f.price_paise::text as price, b.list_price_paise::text as list, f.status::text as status
          from flats f join bookings b on b.id = f.booking_id where f.id = ${target.id}`;
      expect(row!.status).toBe("BOOKED");
      expect(row!.price).toBe(row!.list);
      await cancel(b.id!);
    }
  });
});

describe("2. booking history guards regeneration (409 FLAT_HAS_BOOKING_HISTORY, never 500)", () => {
  let historyFlatId: string;

  beforeAll(async () => {
    const flat = w.ggv.flats.get("G-101")!;
    const b = await book(flat.id, w.customers[3]!);
    expect(b.status, b.text).toBe(201);
    await cancel(b.id!);
    historyFlatId = flat.id;
    const [r] = await t.app.sql<{ status: string }[]>`select status::text from flats where id = ${flat.id}`;
    expect(r!.status).toBe("AVAILABLE");
  });

  async function blockVersion(): Promise<number> {
    const r = await t.request<{ version: number }>("GET", `/api/v1/blocks/${w.ggv.towerId}`, { token: admin });
    return r.body.version;
  }

  it("regenerate keeps the flat with history in place (same id) and replaces the rest", async () => {
    const before = await flatsOf(w.ggv.towerId);
    const regen = await t.request<{ flats_created: number; flats_preserved: number }>(
      "POST",
      `/api/v1/blocks/${w.ggv.towerId}/generate-flats`,
      {
        token: admin,
        headers: { "idempotency-key": key() },
        body: { version: await blockVersion(), regenerate: true },
      },
    );
    expect(regen.status, regen.text).toBe(200);
    expect(regen.body.flats_preserved).toBe(1);
    expect(regen.body.flats_created).toBe(before.size);
    const after = await flatsOf(w.ggv.towerId);
    expect(after.get("G-101")!.id).toBe(historyFlatId);
    expect(after.get("G-102")!.id).not.toBe(before.get("G-102")!.id);
    const [n] = await t.app.sql<
      { n: number }[]
    >`select count(*)::int as n from bookings where flat_id = ${historyFlatId}`;
    expect(n!.n).toBe(1);
  });

  it("a structural edit that renumbers the flats (new block code) is 409 listing the flat; nothing changes", async () => {
    const res = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${w.ggv.towerId}`, {
      token: admin,
      body: { version: await blockVersion(), code: "H" },
    });
    expect(res.status, res.text).toBe(409);
    expect(res.body.error.code).toBe("FLAT_HAS_BOOKING_HISTORY");
    const details = FlatHasBookingHistoryDetailsSchema.parse(res.body.error.details);
    expect(details.flats).toEqual([{ id: historyFlatId, flat_number: "G-101", floor: 1, position: 1, bookings: 1 }]);
    const after = await flatsOf(w.ggv.towerId);
    expect(after.get("G-101")!.id).toBe(historyFlatId);
  });

  it("a structural edit that removes the flat's floor is 409 too", async () => {
    const res = await t.request<ErrorBody>("PATCH", `/api/v1/blocks/${w.ggv.towerId}`, {
      token: admin,
      body: {
        version: await blockVersion(),
        floor_start: 2,
        floor_plans: [{ from_floor: 2, to_floor: 2, floor_plan_template_id: w.basics.templates.FP4 }],
      },
    });
    expect(res.status, res.text).toBe(409);
    expect(res.body.error.code).toBe("FLAT_HAS_BOOKING_HISTORY");
  });

  it("a structural edit that keeps the flat (adding a floor) works; the flat keeps its id", async () => {
    const res = await t.request<{ floors: number; unit_counts: { total: number } }>(
      "PATCH",
      `/api/v1/blocks/${w.ggv.towerId}`,
      {
        token: admin,
        body: {
          version: await blockVersion(),
          floors: 3,
          floor_plans: [{ from_floor: 1, to_floor: 3, floor_plan_template_id: w.basics.templates.FP4 }],
        },
      },
    );
    expect(res.status, res.text).toBe(200);
    expect(res.body.floors).toBe(3);
    expect(res.body.unit_counts.total).toBe(12);
    const after = await flatsOf(w.ggv.towerId);
    expect(after.size).toBe(12);
    expect(after.get("G-101")!.id).toBe(historyFlatId);
    const audit = await t.app.sql<{ action: string }[]>`
      select action from audit_logs where entity_id = ${historyFlatId} and action = 'flat.regenerate_in_place'`;
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe("3. a stored 3-decimal PERCENT PLC is 422 INVALID_AMOUNT everywhere (never 500)", () => {
  let draftId: string;
  let projectFlat: FlatRow;

  beforeAll(async () => {
    // a Draft card for GGV, then an old-style bad rule written straight into the table (the contract refuses it now)
    const created = await t.request<{ id: string }>("POST", "/api/v1/rate-cards", {
      token: admin,
      body: rateCardBody(w.ggv.id, w.basics, "GGV bad PLC"),
    });
    expect(created.status, created.text).toBe(201);
    draftId = created.body.id;
    await t.app.sql`
      insert into rate_card_plc_rules (rate_card_id, plc_type_id, calc_mode, value, applies_to, sort_order)
      values (${draftId}, ${w.basics.plc.topFloor}, 'PERCENT', 1.125, 'ALL', 9)`;
    projectFlat = (await flatsOf(w.ggv.towerId)).get("G-102")!;
  });

  function expectInvalidAmount(res: { status: number; text: string; body: unknown }): void {
    expect(res.status, res.text).toBe(422);
    const err = (res.body as ErrorBody).error;
    expect(err.code).toBe("INVALID_AMOUNT");
    expect(err.message).toMatch(/more than 2 decimal places/);
    expect(err.details).toMatchObject({ rate_card_id: draftId, issues: [{ path: "plc_rules", code: "money" }] });
  }

  it("preview (POST and GET) against the card", async () => {
    expectInvalidAmount(
      await t.request("POST", "/api/v1/rate-cards/preview", {
        token: admin,
        body: { project_id: w.ggv.id, rate_card_id: draftId, flat_id: projectFlat.id },
      }),
    );
    expectInvalidAmount(
      await t.request("GET", `/api/v1/rate-cards/preview?flat_id=${projectFlat.id}&rate_card_id=${draftId}`, {
        token: admin,
      }),
    );
  });

  it("activation with apply rolls back (the card stays Draft)", async () => {
    const cur = await t.request<{ version: number }>("GET", `/api/v1/rate-cards/${draftId}`, { token: admin });
    expectInvalidAmount(
      await t.request("POST", `/api/v1/rate-cards/${draftId}/activate`, {
        token: admin,
        body: { version: cur.body.version, apply_to_available_flats: true },
      }),
    );
    const after = await t.request<{ status: string }>("GET", `/api/v1/rate-cards/${draftId}`, { token: admin });
    expect(after.body.status).toBe("DRAFT");
  });

  it("once Active (activated without apply), apply and flat generation answer 422", async () => {
    const cur = await t.request<{ version: number }>("GET", `/api/v1/rate-cards/${draftId}`, { token: admin });
    const act = await t.request("POST", `/api/v1/rate-cards/${draftId}/activate`, {
      token: admin,
      body: { version: cur.body.version, apply_to_available_flats: false },
    });
    expect(act.status, act.text).toBe(200);
    expectInvalidAmount(
      await t.request("POST", `/api/v1/rate-cards/${draftId}/apply`, { token: admin, body: { dry_run: true } }),
    );
    expectInvalidAmount(
      await t.request("POST", `/api/v1/rate-cards/${draftId}/apply`, { token: admin, body: { dry_run: false } }),
    );
    const block = await t.request<{ version: number }>("GET", `/api/v1/blocks/${w.ggv.towerId}`, { token: admin });
    expectInvalidAmount(
      await t.request("POST", `/api/v1/blocks/${w.ggv.towerId}/generate-flats`, {
        token: admin,
        headers: { "idempotency-key": key() },
        body: { version: block.body.version, regenerate: true },
      }),
    );
    // the active-card preview path too
    expectInvalidAmount(
      await t.request("POST", "/api/v1/rate-cards/preview", {
        token: admin,
        body: { project_id: w.ggv.id, flat_type_id: w.basics.flatTypes.A3, floor: 2 },
      }),
    );
  });
});
