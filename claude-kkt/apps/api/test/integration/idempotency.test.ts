import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, type ErrorBody, type TestContext } from "./helpers.js";

let t: TestContext;
let counter = 0;
beforeAll(async () => {
  const { route } = await import("../../src/lib/routes.js");
  t = await buildTestApp({
    extraRoutes: (api) => {
      route(api, {
        method: "POST",
        url: "/_test/required",
        permission: "master.write",
        idempotent: "required",
        schema: { body: z.object({ amount: z.number() }), response: { 201: z.object({ n: z.number() }) } },
        handler: async (_req, reply) => {
          counter += 1;
          return reply.code(201).send({ n: counter });
        },
      });
    },
  });
});
afterAll(async () => {
  await t?.close();
});

describe("idempotency", () => {
  it("replays the stored response for the same key + body and creates nothing twice", async () => {
    const admin = await t.loginAs("admin");
    const key = "room-type-create-0001";
    const body = { name: "Pooja", code: "POOJA", sort_order: 9 };
    const first = await t.request<{ id: string }>("POST", "/api/v1/masters/room-types", {
      token: admin.access_token,
      body,
      headers: { "idempotency-key": key },
    });
    expect(first.status).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const second = await t.request<{ id: string }>("POST", "/api/v1/masters/room-types", {
      token: admin.access_token,
      body,
      headers: { "idempotency-key": key },
    });
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    const rows = await t.app.sql<{ n: number }[]>`select count(*)::int as n from room_types where code = 'POOJA'`;
    expect(rows[0]!.n).toBe(1);
    // durable record exists even when the Redis fast path is gone
    await t.app.redis.flushdb();
    const third = await t.request<{ id: string }>("POST", "/api/v1/masters/room-types", {
      token: admin.access_token,
      body,
      headers: { "idempotency-key": key },
    });
    expect(third.status).toBe(201);
    expect(third.headers["idempotent-replayed"]).toBe("true");
    expect(third.body.id).toBe(first.body.id);
  });

  it("same key with a different body is 422 IDEMPOTENCY_MISMATCH", async () => {
    const admin = await t.loginAs("admin");
    const key = "room-type-create-0002";
    const a = await t.request("POST", "/api/v1/masters/room-types", {
      token: admin.access_token,
      body: { name: "Store", code: "STORE" },
      headers: { "idempotency-key": key },
    });
    expect(a.status).toBe(201);
    const b = await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", {
      token: admin.access_token,
      body: { name: "Store 2", code: "STORE2" },
      headers: { "idempotency-key": key },
    });
    expect(b.status).toBe(422);
    expect(b.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("keys are scoped per subject", async () => {
    const admin = await t.loginAs("admin");
    const key = "shared-key-0003";
    const a = await t.request("POST", "/api/v1/masters/room-types", {
      token: admin.access_token,
      body: { name: "Utility", code: "UTILITY" },
      headers: { "idempotency-key": key },
    });
    expect(a.status).toBe(201);
    const [accountsRole] = await t.app.sql<{ id: string }[]>`select id from roles where name = 'Super Admin'`;
    const other = await t.request<{ temp_password: string }>("POST", "/api/v1/users", {
      token: admin.access_token,
      body: { name: "Second Admin", email: "admin2@sgb.in", role_id: accountsRole!.id, must_change_password: false },
    });
    const admin2 = await t.login("admin2@sgb.in", other.body.temp_password);
    const b = await t.request<ErrorBody>("POST", "/api/v1/masters/room-types", {
      token: admin2.access_token,
      body: { name: "Utility", code: "UTILITY" },
      headers: { "idempotency-key": key },
    });
    expect(b.status).toBe(409); // not a replay: a real duplicate-code conflict for the other subject
    expect(b.body.error.code).toBe("DUPLICATE");
  });

  it("routes configured 'required' reject a missing key with 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const admin = await t.loginAs("admin");
    const missing = await t.request<ErrorBody>("POST", "/api/v1/_test/required", {
      token: admin.access_token,
      body: { amount: 1 },
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const ok = await t.request<{ n: number }>("POST", "/api/v1/_test/required", {
      token: admin.access_token,
      body: { amount: 1 },
      headers: { "idempotency-key": "req-0001" },
    });
    expect(ok.status).toBe(201);
    const replay = await t.request<{ n: number }>("POST", "/api/v1/_test/required", {
      token: admin.access_token,
      body: { amount: 1 },
      headers: { "idempotency-key": "req-0001" },
    });
    expect(replay.body.n).toBe(ok.body.n);
    expect(counter).toBe(1);
  });
});
