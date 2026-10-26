import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateOpenApi, OPENAPI_SNAPSHOT, readSnapshot } from "../../src/modules/system/openapi.js";
import { diffOpenApi, formatDiff } from "../../src/modules/system/openapiDiff.js";

/**
 * API compatibility gate (docs/VERSIONING.md): the document generated from the code must be a compatible evolution of the committed
 * snapshot docs/openapi/v1.json. Regenerate the snapshot with `pnpm --filter @kkt/api openapi` after an additive change.
 */

type Json = Record<string, unknown>;

/** A minimal OpenAPI document with one operation per entry. */
function doc(ops: Record<string, { body?: Json; params?: Json[]; response?: Json; status?: string }>): Json {
  const paths: Json = {};
  for (const [key, o] of Object.entries(ops)) {
    const [method, path] = key.split(" ") as [string, string];
    const op: Json = {
      responses: {
        [o.status ?? "200"]: {
          description: "ok",
          content: { "application/json": { schema: o.response ?? { type: "object" } } },
        },
      },
    };
    if (o.body) op["requestBody"] = { required: true, content: { "application/json": { schema: o.body } } };
    if (o.params) op["parameters"] = o.params;
    paths[path] = { ...((paths[path] as Json) ?? {}), [method.toLowerCase()]: op };
  }
  return { openapi: "3.1.0", info: { title: "t", version: "1" }, paths };
}

const booking = (extra: Json = {}, required: string[] = ["id", "status"]) => ({
  type: "object",
  required,
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["ACTIVE", "CANCELLED", "COMPLETED"] },
    amount_paise: { type: "integer" },
    ...extra,
  },
});

describe("OpenAPI compatibility rules", () => {
  it("identical documents have no differences", () => {
    const d = doc({ "GET /api/v1/bookings": { response: booking() } });
    expect(diffOpenApi(d, d)).toEqual({ breaking: [], additive: [], notices: [] });
  });

  it("removed paths and operations are breaking; new ones are additive", () => {
    const base = doc({ "GET /api/v1/a": {}, "POST /api/v1/a": {}, "GET /api/v1/b": {} });
    const cur = doc({ "GET /api/v1/a": {}, "GET /api/v1/c": {} });
    const d = diffOpenApi(base, cur);
    expect(d.breaking).toEqual(["POST /api/v1/a: operation removed", "GET /api/v1/b: operation removed"]);
    expect(d.additive).toEqual(["GET /api/v1/c: operation added"]);
  });

  it("removed response properties (also nested in arrays) are breaking; added ones are additive", () => {
    const base = doc({
      "GET /api/v1/bookings": {
        response: {
          type: "object",
          properties: { items: { type: "array", items: booking() }, total: { type: "integer" } },
        },
      },
    });
    const cur = doc({
      "GET /api/v1/bookings": {
        response: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                ...booking(),
                properties: {
                  id: { type: "string" },
                  status: booking().properties.status,
                  flat_label: { type: "string" },
                },
              },
            },
          },
        },
      },
    });
    const d = diffOpenApi(base, cur);
    expect(d.breaking).toContain('GET /api/v1/bookings: response 200 property "total" removed');
    expect(d.breaking).toContain('GET /api/v1/bookings: response 200 property "items[].amount_paise" removed');
    expect(d.additive).toContain('GET /api/v1/bookings: response 200 property "items[].flat_label" added');
  });

  it("a removed subtree is reported once, at its top", () => {
    const base = doc({
      "GET /x": {
        response: {
          type: "object",
          properties: { summary: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" } } } },
        },
      },
    });
    const cur = doc({ "GET /x": { response: { type: "object", properties: {} } } });
    expect(diffOpenApi(base, cur).breaking).toEqual(['GET /x: response 200 property "summary" removed']);
  });

  it("request properties that become required, new required properties and new required parameters are breaking", () => {
    const base = doc({
      "POST /api/v1/payments": {
        body: {
          type: "object",
          required: ["amount_paise"],
          properties: { amount_paise: { type: "integer" }, remarks: { type: "string" } },
        },
        params: [{ name: "page", in: "query", required: false, schema: { type: "integer" } }],
      },
    });
    const cur = doc({
      "POST /api/v1/payments": {
        body: {
          type: "object",
          required: ["amount_paise", "remarks", "mode"],
          properties: {
            amount_paise: { type: "integer" },
            remarks: { type: "string" },
            mode: { type: "string" },
            note: { type: "string" },
          },
        },
        params: [
          { name: "page", in: "query", required: true, schema: { type: "integer" } },
          { name: "as_of", in: "query", required: true, schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
      },
    });
    const d = diffOpenApi(base, cur);
    expect(d.breaking).toEqual(
      expect.arrayContaining([
        'POST /api/v1/payments: request "body.remarks" became required',
        'POST /api/v1/payments: request "body.mode" added as required',
        'POST /api/v1/payments: request "query:page" became required',
        'POST /api/v1/payments: request "query:as_of" added as required',
      ]),
    );
    expect(d.breaking).toHaveLength(4);
    expect(d.additive).toEqual(
      expect.arrayContaining([
        'POST /api/v1/payments: request "body.note" added (optional)',
        'POST /api/v1/payments: request "query:q" added (optional)',
      ]),
    );
  });

  it("required fields inside a new optional request object are not breaking", () => {
    const base = doc({ "POST /x": { body: { type: "object", properties: { a: { type: "string" } } } } });
    const cur = doc({
      "POST /x": {
        body: {
          type: "object",
          properties: {
            a: { type: "string" },
            meta: { type: "object", required: ["k"], properties: { k: { type: "string" } } },
          },
        },
      },
    });
    const d = diffOpenApi(base, cur);
    expect(d.breaking).toEqual([]);
    expect(d.additive).toEqual(['POST /x: request "body.meta" added (optional)']);
  });

  it("removed request properties are breaking (strict request schemas reject them from old clients)", () => {
    const base = doc({
      "PATCH /x": {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { a: { type: "string" }, b: { type: "string" } },
        },
      },
    });
    const cur = doc({
      "PATCH /x": { body: { type: "object", additionalProperties: false, properties: { a: { type: "string" } } } },
    });
    expect(diffOpenApi(base, cur).breaking).toEqual([
      'PATCH /x: request "body.b" removed (strict request schemas reject it from old clients)',
    ]);
  });

  it("removed enum values are breaking in requests and responses; added response values are notices", () => {
    const base = doc({
      "POST /x": {
        body: { type: "object", properties: { mode: { type: "string", enum: ["CASH", "CHEQUE", "UPI"] } } },
        response: booking(),
      },
    });
    const cur = doc({
      "POST /x": {
        body: { type: "object", properties: { mode: { type: "string", enum: ["CASH", "UPI", "NEFT"] } } },
        response: booking({ status: { type: "string", enum: ["ACTIVE", "COMPLETED", "ON_HOLD"] } }),
      },
    });
    const d = diffOpenApi(base, cur);
    expect(d.breaking).toEqual(
      expect.arrayContaining([
        'POST /x: request "body.mode" enum values removed: "CHEQUE"',
        'POST /x: response 200 property "status" enum values removed: "CANCELLED"',
      ]),
    );
    expect(d.additive).toContain('POST /x: request "body.mode" enum values added: "NEFT"');
    expect(d.notices).toContain('POST /x: response 200 property "status" enum values added: "ON_HOLD"');
  });

  it("type changes are breaking; a lost success status is breaking", () => {
    const base = doc({
      "GET /x": { response: { type: "object", properties: { n: { type: "integer" } } } },
      "POST /y": { status: "201" },
    });
    const cur = doc({
      "GET /x": { response: { type: "object", properties: { n: { type: "string" } } } },
      "POST /y": { status: "200" },
    });
    const d = diffOpenApi(base, cur);
    expect(d.breaking).toEqual(
      expect.arrayContaining([
        'GET /x: response 200 property "n" type integer → string',
        "POST /y: success response 201 removed",
      ]),
    );
  });

  it("resolves $ref to components and to the schema's own $defs", () => {
    const base: Json = {
      ...doc({}),
      paths: {
        "/x": {
          get: {
            responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/X" } } } } },
          },
        },
      },
      components: {
        schemas: {
          X: { type: "object", properties: { a: { type: "string" }, b: { $ref: "#/components/schemas/Y" } } },
          Y: { type: "object", properties: { c: { type: "string" } } },
        },
      },
    };
    const cur = JSON.parse(JSON.stringify(base)) as Json;
    delete ((((cur["components"] as Json)["schemas"] as Json)["Y"] as Json)["properties"] as Json)["c"];
    expect(diffOpenApi(base, cur).breaking).toEqual(['GET /x: response 200 property "b.c" removed']);
    const defs = {
      type: "object",
      properties: { k: { $ref: "#/$defs/K" } },
      $defs: { K: { type: "string", enum: ["A", "B"] } },
    };
    const defs2 = { ...defs, $defs: { K: { type: "string", enum: ["A"] } } };
    expect(diffOpenApi(doc({ "GET /z": { response: defs } }), doc({ "GET /z": { response: defs2 } })).breaking).toEqual(
      ['GET /z: response 200 property "k" enum values removed: "B"'],
    );
  });

  it("a deprecated operation may disappear only after its x-sunset date (retirement); earlier it is a breaking removal", () => {
    const base = doc({ "GET /api/v1/old": {}, "GET /api/v1/new": {} });
    const op = ((base["paths"] as Json)["/api/v1/old"] as Json)["get"] as Json;
    op["deprecated"] = true;
    op["x-sunset"] = "2027-06-30";
    const cur = doc({ "GET /api/v1/new": {} });
    expect(diffOpenApi(base, cur, { now: new Date("2027-07-01T00:00:00Z") })).toMatchObject({
      breaking: [],
      notices: ["GET /api/v1/old: retired (deprecated, sunset 2027-06-30)"],
    });
    expect(diffOpenApi(base, cur, { now: new Date("2027-06-29T00:00:00Z") }).breaking).toEqual([
      "GET /api/v1/old: operation removed before its sunset 2027-06-30",
    ]);
    // deprecated without a sunset, or not deprecated at all: always breaking
    delete op["x-sunset"];
    expect(diffOpenApi(base, cur, { now: new Date("2030-01-01T00:00:00Z") }).breaking).toEqual([
      "GET /api/v1/old: operation removed",
    ]);
  });

  it("a response property that stops being required is breaking (clients rely on its presence)", () => {
    const base = doc({ "GET /x": { response: booking() } });
    const cur = doc({ "GET /x": { response: booking({}, ["id"]) } });
    expect(diffOpenApi(base, cur).breaking).toEqual(['GET /x: response 200 property "status" is no longer required']);
    // the reverse (optional → required) only strengthens the promise
    expect(diffOpenApi(cur, base).breaking).toEqual([]);
  });

  it("a free request value that becomes an enum is breaking; tightened request bounds are breaking, loosened ones are not", () => {
    const base = doc({
      "POST /x": {
        body: {
          type: "object",
          properties: {
            sort: { type: "string" },
            name: { type: "string", maxLength: 200 },
            qty: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    });
    const cur = doc({
      "POST /x": {
        body: {
          type: "object",
          properties: {
            sort: { type: "string", enum: ["name", "-name"] },
            name: { type: "string", maxLength: 120, minLength: 2 },
            qty: { type: "integer", minimum: 1, maximum: 50 },
          },
        },
      },
    });
    expect(diffOpenApi(base, cur).breaking).toEqual([
      'POST /x: request "body.sort" restricted to enum values "name", "-name"',
      'POST /x: request "body.name" bounds tightened: maxLength 200 → 120, minLength none → 2',
      'POST /x: request "body.qty" bounds tightened: maximum 100 → 50',
    ]);
    expect(diffOpenApi(cur, base).breaking).toEqual([]);
    // bounds of a nullable union are the loosest branch's
    const nullable = (max: number) =>
      doc({
        "POST /y": {
          body: {
            type: "object",
            properties: { note: { anyOf: [{ type: "string", maxLength: max }, { type: "null" }] } },
          },
        },
      });
    expect(diffOpenApi(nullable(500), nullable(500)).breaking).toEqual([]);
    expect(diffOpenApi(nullable(500), nullable(100)).breaking).toEqual([
      'POST /y: request "body.note" bounds tightened: maxLength 500 → 100',
    ]);
  });

  it("formats a readable report", () => {
    expect(formatDiff({ breaking: ["a"], additive: [], notices: ["n"] })).toBe(
      "BREAKING (1):\n  - a\nAdditive: none\nNotices (1):\n  - n",
    );
  });
});

describe("generated document vs the committed snapshot (docs/openapi/v1.json)", () => {
  it("has no breaking changes", async () => {
    expect(existsSync(OPENAPI_SNAPSHOT), "docs/openapi/v1.json is missing: run pnpm --filter @kkt/api openapi").toBe(
      true,
    );
    const current = await generateOpenApi();
    const diff = diffOpenApi(readSnapshot(), current);
    // print the full diff so a failing CI run shows exactly what changed (and additive changes that need a snapshot refresh)
    console.log(`OpenAPI compatibility vs docs/openapi/v1.json\n${formatDiff(diff)}`);
    expect(diff.breaking, formatDiff(diff)).toEqual([]);
    expect(Object.keys(current["paths"] as Json).length).toBeGreaterThan(300);
  }, 120_000);
});
