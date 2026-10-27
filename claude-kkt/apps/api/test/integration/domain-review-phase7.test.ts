/**
 * Phase 7 adversarial review of the domain track (docs/hardening/phase7-review-domain.md):
 * 1. rate-card activation with apply serialised activations with `FOR UPDATE` on the project row: a concurrent booking (flat locked
 *    first, then the bookings INSERT whose project FK takes FOR KEY SHARE on that row) deadlocked with it (40P01 → 409 for one side).
 *    The lock is now FOR NO KEY UPDATE, which still serialises activations but never blocks a booking's FK check.
 * 2. master CSV import: a header named like an Object.prototype member (`constructor`, `toString`, `__proto__`) passed the header
 *    check (`in` sees inherited keys) and crashed the row coercion with a 500; it is now 422 IMPORT_UNKNOWN_COLUMNS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rateCardBody } from "./fixtures/inventory.js";
import { createMoneyWorld, type MoneyWorld } from "./fixtures/money.js";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
let admin: string;
let w: MoneyWorld;

beforeAll(async () => {
  t = await buildTestApp();
  admin = (await t.loginAs("admin")).access_token;
  w = await createMoneyWorld(t, admin);
}, 180_000);

afterAll(async () => {
  await t?.close();
});

/** Waits until some backend of this database waits on a heavyweight lock. */
async function waitForLockWaiter(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [r] = await t.app.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`;
    if ((r?.n ?? 0) > 0) return;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error("no backend ever waited on the lock");
}

describe("1. rate-card activation (with apply) vs a concurrent booking", () => {
  it("does not deadlock: the booking's project FK check is not blocked by the activation's project lock", async () => {
    const created = await t.request<{ id: string; version: number }>("POST", "/api/v1/rate-cards", {
      token: admin,
      body: rateCardBody(w.sgh.id, w.basics, "SGH review card", 3),
    });
    expect(created.status, created.text).toBe(201);
    const [target] = await t.app.sql<{ id: string; price: string }[]>`
      select id, price_paise::text as price from flats
       where block_id = ${w.sgh.towerId} and status = 'AVAILABLE' order by id limit 1`;
    expect(target).toBeDefined();

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    // the booking engine's order: lock the flat, ... , INSERT bookings (project_id FK → FOR KEY SHARE on the project row), flat BOOKED
    const holder = t.app.sql.begin(async (tx) => {
      await tx`select id from flats where id = ${target!.id} for update`;
      locked();
      await gate;
      await tx`select id from projects where id = ${w.sgh.id} for key share`;
      await tx`update flats set status = 'BLOCKED', version = version + 1 where id = ${target!.id}`;
    });
    await isLocked;
    const activation = t.request<{ status: string; applied: { repriced: number; skipped_not_available: number } }>(
      "POST",
      `/api/v1/rate-cards/${created.body.id}/activate`,
      { token: admin, body: { version: created.body.version, apply_to_available_flats: true } },
    );
    await waitForLockWaiter(); // the activation holds the project row and waits for the flat
    release();
    await holder; // a deadlock would abort one of the two with 40P01
    const res = await activation;
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.applied.skipped_not_available).toBeGreaterThanOrEqual(1);
    const [after] = await t.app.sql<{ price: string; status: string }[]>`
      select price_paise::text as price, status::text as status from flats where id = ${target!.id}`;
    expect(after!.status).toBe("BLOCKED");
    expect(after!.price).toBe(target!.price); // taken off AVAILABLE meanwhile: never re-priced
    await t.app.sql`update flats set status = 'AVAILABLE', version = version + 1 where id = ${target!.id}`;
  });

  it("parking bulk status (project lock → slots) vs a booking holding a slot: no deadlock either", async () => {
    const slotId = w.sgh.parkingIds[w.sgh.parkingIds.length - 1]!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    // booking order: flat → block → parking slots (FOR UPDATE) → INSERT bookings (FOR KEY SHARE on the project)
    const holder = t.app.sql.begin(async (tx) => {
      await tx`select id from parking_slots where id = ${slotId} for update`;
      locked();
      await gate;
      await tx`select id from projects where id = ${w.sgh.id} for key share`;
    });
    await isLocked;
    const bulk = t.request<{ updated: number }>("POST", `/api/v1/projects/${w.sgh.id}/parking/bulk-status`, {
      token: admin,
      body: { slot_ids: [slotId], status: "BLOCKED", reason: "Review: lock order" },
    });
    await waitForLockWaiter();
    release();
    await holder;
    const res = await bulk;
    expect(res.status, res.text).toBe(200);
    await t.request("POST", `/api/v1/projects/${w.sgh.id}/parking/bulk-status`, {
      token: admin,
      body: { slot_ids: [slotId], status: "AVAILABLE" },
    });
  });

  it("activations of the same project are still serialised (the second waits for the first, then sees it ACTIVE)", async () => {
    const a = await t.request<{ id: string; version: number }>("POST", "/api/v1/rate-cards", {
      token: admin,
      body: rateCardBody(w.sgh.id, w.basics, "SGH review card A", 2),
    });
    const b = await t.request<{ id: string; version: number }>("POST", "/api/v1/rate-cards", {
      token: admin,
      body: rateCardBody(w.sgh.id, w.basics, "SGH review card B", 2),
    });
    expect(a.status, a.text).toBe(201);
    expect(b.status, b.text).toBe(201);
    const [ra, rb] = await Promise.all(
      [a.body, b.body].map((c) =>
        t.request<{ status: string }>("POST", `/api/v1/rate-cards/${c.id}/activate`, {
          token: admin,
          body: { version: c.version, apply_to_available_flats: false },
        }),
      ),
    );
    expect(ra!.status, ra!.text).toBe(200);
    expect(rb!.status, rb!.text).toBe(200);
    const [n] = await t.app.sql<{ n: number }[]>`
      select count(*)::int as n from rate_cards where project_id = ${w.sgh.id} and status = 'ACTIVE'`;
    expect(n!.n).toBe(1);
  });
});

describe("2. master CSV import: headers named like Object.prototype members", () => {
  for (const header of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    it(`a "${header}" column is 422 IMPORT_UNKNOWN_COLUMNS, never a 500`, async () => {
      const r = await t.request<ErrorBody>("POST", "/api/v1/masters/import", {
        token: admin,
        body: { kind: "ROOM_TYPES", csv: `name,code,${header}\nStudy Room,STUDY_X,1\n`, commit: false },
      });
      expect(r.status, r.text).toBe(422);
      expect(r.body.error.code).toBe("IMPORT_UNKNOWN_COLUMNS");
      expect((r.body.error.details as { unknown_columns: string[] }).unknown_columns).toEqual([header]);
    });
  }
});
