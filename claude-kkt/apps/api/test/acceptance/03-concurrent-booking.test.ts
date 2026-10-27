import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  blockByCode,
  BOOT_TIMEOUT,
  bookingBody,
  bootAcceptance,
  customerByPhone,
  flatsOf,
  getFlat,
  key,
  listAtCr,
  projectByCode,
  type Booking,
  type ErrorBody,
  type Harness,
  type List,
} from "./harness.js";

/**
 * SPEC §18 scenario 3 (L244): "Two simultaneous bookings for the same flat → exactly one succeeds."
 * SPEC L190 ATOMIC FLAT LOCK: the flat flips to Booked in one atomic operation conditioned on its current status; the loser is rejected.
 */

let h: Harness;
let admin: string;
let sales: string;

beforeAll(async () => {
  h = await bootAcceptance();
  admin = (await h.loginAs("admin")).access_token;
  sales = (await h.loginAs("sales")).access_token;
}, BOOT_TIMEOUT);
afterAll(async () => {
  await h?.close();
});

describe("scenario 3 — two simultaneous bookings of one flat", () => {
  it("two concurrent POST /bookings for the same Available flat: exactly one 201, the other 409 FLAT_NOT_AVAILABLE; the flat is BOOKED by the winner", async () => {
    const sgh = await projectByCode(h, admin, "SGH");
    const towerC = await blockByCode(h, admin, sgh.id, "C");
    const flat = (await flatsOf(h, admin, towerC.id)).get("C-1001")!;
    expect(flat.status).toBe("AVAILABLE");
    await listAtCr(h, admin, [flat.id]);
    const kavita = await customerByPhone(h, admin, "9876543221");
    const sanjay = await customerByPhone(h, admin, "9876543220");
    const [r1, r2] = await Promise.all([
      h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", {
        token: sales,
        body: bookingBody(h, flat.id, kavita.id),
        headers: { "idempotency-key": key() },
      }),
      h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", {
        token: admin,
        body: bookingBody(h, flat.id, sanjay.id),
        headers: { "idempotency-key": key() },
      }),
    ]);
    // SPEC L190: "two concurrent bookings of the same flat can never both succeed"
    expect([r1.status, r2.status].sort(), `${r1.text}\n${r2.text}`).toEqual([201, 409]);
    const winner = r1.status === 201 ? r1 : r2;
    const loser = r1.status === 201 ? r2 : r1;
    // API-CONVENTIONS: 409 FLAT_NOT_AVAILABLE names the booking that holds the flat
    expect(loser.body.error.code).toBe("FLAT_NOT_AVAILABLE");
    expect(loser.body.error.details?.["booking_number"]).toBe(winner.body.booking_number);
    expect(winner.body.status).toBe("ACTIVE");
    expect(winner.body.summary.raised_percent).toBe(15); // SPEC L191: ON_BOOKING (10 %) + catch-up of Excavation (5 %, Tower C is past it per SEED.md)
    // the flat is Booked exactly once, by the winner (SPEC L83: Booked is set only by the booking engine)
    const after = await getFlat(h, admin, flat.id);
    expect(after.status).toBe("BOOKED");
    expect(after.booking_id).toBe(winner.body.id);
    const active = await h.request<List<{ id: string; status: string }>>(
      "GET",
      `/api/v1/bookings?flat_id=${flat.id}&page_size=10`,
      { token: admin },
    );
    if (active.status === 200) {
      expect(active.body.items.filter((b) => b.status === "ACTIVE").map((b) => b.id)).toEqual([winner.body.id]);
    }
    // a later attempt on the same flat is refused the same way (the lock is a state rule, not a race artefact)
    const late = await h.request<ErrorBody>("POST", "/api/v1/bookings", {
      token: sales,
      body: bookingBody(h, flat.id, sanjay.id),
      headers: { "idempotency-key": key() },
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("FLAT_NOT_AVAILABLE");
  });

  it("five simultaneous attempts on another flat still produce exactly one booking", async () => {
    const sgh = await projectByCode(h, admin, "SGH");
    const towerC = await blockByCode(h, admin, sgh.id, "C");
    const flat = (await flatsOf(h, admin, towerC.id)).get("C-1002")!;
    expect(flat.status).toBe("AVAILABLE");
    await listAtCr(h, admin, [flat.id]);
    const customers = await h.request<List<{ id: string }>>("GET", "/api/v1/customers?page_size=20", { token: admin });
    const ids = customers.body.items.slice(0, 5).map((c) => c.id);
    const results = await Promise.all(
      ids.map((customerId, i) =>
        h.request<Booking & ErrorBody>("POST", "/api/v1/bookings", {
          token: i % 2 ? admin : sales,
          body: bookingBody(h, flat.id, customerId),
          headers: { "idempotency-key": key() },
        }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    // SPEC L244: exactly one succeeds
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe("FLAT_NOT_AVAILABLE");
    const winner = results.find((r) => r.status === 201)!;
    expect((await getFlat(h, admin, flat.id)).booking_id).toBe(winner.body.id);
    // nothing leaked: the losers created no demand, ledger row or audit trail for a booking that does not exist
    const bookings = await h.request<List<{ id: string; flat_id: string }>>("GET", "/api/v1/bookings?page_size=100", {
      token: admin,
    });
    expect(bookings.body.items.filter((b) => b.flat_id === flat.id)).toHaveLength(1);
  });
});
