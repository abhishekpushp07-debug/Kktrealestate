import { beforeAll, describe, expect, it } from "vitest";
import { generateOpenApi } from "../../src/modules/system/openapi.js";
import { diffOpenApi } from "../../src/modules/system/openapiDiff.js";
import { enrichOpenApi, operationIdFor } from "../../src/modules/system/openapiEnrich.js";

/**
 * The generated OpenAPI document can drive typed clients (audit F2): every operation has a unique operationId and documented error
 * responses that reference the shared ApiError envelope; idempotent and versioned writes declare their headers; binary and CSV
 * endpoints carry their real media types.
 */
type Json = Record<string, unknown>;
let doc: Json;
let ops: { method: string; path: string; op: Json }[];

beforeAll(async () => {
  doc = await generateOpenApi();
  ops = [];
  for (const [path, item] of Object.entries(doc["paths"] as Record<string, Json>))
    for (const method of ["get", "post", "put", "patch", "delete"])
      if (item[method]) ops.push({ method, path, op: item[method] as Json });
}, 60_000);

const refOf = (x: unknown) => (x as { $ref?: string }).$ref;
const params = (op: Json) =>
  ((op["parameters"] as Json[] | undefined) ?? []).map((p) => refOf(p) ?? `${String(p["in"])}:${String(p["name"])}`);

describe("generated OpenAPI document", () => {
  it("every operation has a unique, stable operationId", () => {
    expect(ops.length).toBeGreaterThan(400);
    const ids = ops.map((o) => o.op["operationId"]);
    expect(ids.every((id) => typeof id === "string" && /^[a-z][A-Za-z0-9]+$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const ledger = ops.find((o) => o.method === "get" && o.path === "/api/v1/bookings/{id}/ledger");
    expect(ledger?.op["operationId"]).toBe("getBookingsByIdLedger");
    expect(operationIdFor("get", "/health")).toBe("getRootHealth");
    expect(operationIdFor("get", "/api/v1/public/site-visits/{token}.ics")).toBe("getPublicSiteVisitsByTokenIcs");
  });

  it("every operation documents its error responses, all referencing the shared ApiError envelope", () => {
    const components = doc["components"] as { schemas: Json; responses: Record<string, Json> };
    expect(components.schemas["ApiError"]).toBeTruthy();
    for (const { method, path, op } of ops) {
      const responses = op["responses"] as Record<string, unknown>;
      const errors = Object.keys(responses).filter((s) => /^[45]\d\d$/.test(s));
      expect(errors.length, `${method} ${path}`).toBeGreaterThan(0);
      expect(errors, `${method} ${path}`).toContain("500");
      for (const s of errors) {
        const ref = refOf(responses[s]);
        if (!ref) continue; // a route's own declared error schema (e.g. the 503 health report)
        const name = ref.split("/").pop()!;
        const content = components.responses[name]!["content"] as Json | undefined;
        expect(refOf((content!["application/json"] as Json)["schema"]), `${method} ${path} ${s}`).toBe(
          "#/components/schemas/ApiError",
        );
      }
    }
    const patch = ops.find((o) => o.method === "patch" && o.path === "/api/v1/customers/{id}")!;
    expect(Object.keys(patch.op["responses"] as Json)).toEqual(
      expect.arrayContaining(["400", "401", "403", "404", "409", "422", "428", "429", "500", "503"]),
    );
    const publicList = ops.find((o) => o.method === "get" && o.path === "/api/v1/public/projects")!;
    expect(Object.keys(publicList.op["responses"] as Json)).not.toContain("401");
  });

  it("declares Idempotency-Key on idempotent POSTs (required on payments), If-Match on versioned writes, If-None-Match on GETs", () => {
    const pay = ops.find((o) => o.method === "post" && o.path === "/api/v1/payments")!;
    expect(params(pay.op)).toContain("#/components/parameters/IdempotencyKeyRequired");
    const room = ops.find((o) => o.method === "post" && o.path === "/api/v1/masters/room-types")!;
    expect(params(room.op)).toContain("#/components/parameters/IdempotencyKey");
    for (const { method, path, op } of ops.filter((o) => o.method === "patch" && !o.path.startsWith("/api/v1/portal")))
      expect(params(op), `${method} ${path}`).toContain("#/components/parameters/IfMatch");
    const cancel = ops.find((o) => o.method === "post" && o.path === "/api/v1/bookings/{id}/cancel")!;
    expect(params(cancel.op)).toContain("#/components/parameters/IfMatch");
    const list = ops.find((o) => o.method === "get" && o.path === "/api/v1/bookings")!;
    expect(params(list.op)).toContain("#/components/parameters/IfNoneMatch");
  });

  it("types PDF, file, ZIP, CSV and text endpoints with their real media types; lists offer their text/csv alternate", () => {
    const content = (method: string, path: string) =>
      ((ops.find((o) => o.method === method && o.path === path)!.op["responses"] as Json)["200"] as Json)[
        "content"
      ] as Json;
    expect(Object.keys(content("get", "/api/v1/bookings/{id}/statement.pdf"))).toEqual(["application/pdf"]);
    expect((content("get", "/api/v1/bookings/{id}/statement.pdf")["application/pdf"] as Json)["schema"]).toEqual({
      type: "string",
      format: "binary",
    });
    expect(Object.keys(content("get", "/api/v1/files/{token}"))).toEqual(
      expect.arrayContaining(["application/pdf", "image/png", "image/webp"]),
    );
    expect(Object.keys(content("get", "/api/v1/admin/backups/download/{token}"))).toEqual(["application/zip"]);
    expect(Object.keys(content("get", "/api/v1/exports/download/{token}"))).toEqual(["text/csv"]);
    expect(Object.keys(content("get", "/api/v1/public/sitemap.xml"))).toEqual(["application/xml"]);
    expect(Object.keys(content("get", "/api/v1/masters/room-types"))).toEqual(["application/json", "text/csv"]);
    // nothing claims JSON with an empty schema any more
    for (const { method, path, op } of ops) {
      const ok = (op["responses"] as Json)["200"] as Json | undefined;
      const json = ok && (ok["content"] as Json | undefined)?.["application/json"];
      if (json) expect(JSON.stringify((json as Json)["schema"]), `${method} ${path}`).not.toBe("{}");
    }
  });

  it("references the shared money and list-meta components", () => {
    const text = JSON.stringify(doc["paths"]);
    expect(text).toContain('"#/components/schemas/MoneyPaise"');
    expect(text).toContain('"#/components/schemas/SignedMoneyPaise"');
    expect(text).toContain('"#/components/schemas/ListMeta"');
  });
});

describe("compatibility checker and the enrichment", () => {
  it("added operationIds, components, error responses and protocol headers are never breaking", () => {
    const base: Json = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/api/v1/things": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: { type: "object", properties: { amount_paise: { type: "integer" } } } },
              },
            },
            responses: {
              "201": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
            },
          },
        },
        "/api/v1/things/{id}": {
          patch: {
            parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
            responses: {
              "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
            },
          },
        },
      },
    };
    const enriched = enrichOpenApi(JSON.parse(JSON.stringify(base)) as Json, [
      {
        method: "POST",
        url: "/api/v1/things",
        permission: "master.write",
        audience: "erp",
        public: false,
        idempotent: "required",
      },
      { method: "PATCH", url: "/api/v1/things/:id", permission: "master.write", audience: "erp", public: false },
    ]);
    const d = diffOpenApi(base, enriched);
    expect(d.breaking).toEqual([]);
    expect(d.notices.join("\n")).toMatch(/Idempotency-Key.*documented \(required\)/i);
    const post = ((enriched["paths"] as Json)["/api/v1/things"] as Json)["post"] as Json;
    expect(post["operationId"]).toBe("postThings");
    expect(Object.keys(post["responses"] as Json)).toEqual(
      expect.arrayContaining(["400", "401", "403", "409", "422", "500"]),
    );
    // a genuinely new required parameter is still breaking
    const tightened = JSON.parse(JSON.stringify(enriched)) as Json;
    (((tightened["paths"] as Json)["/api/v1/things"] as Json)["post"] as Json)["parameters"] = [
      { in: "query", name: "mode", required: true, schema: { type: "string" } },
    ];
    expect(diffOpenApi(enriched, tightened).breaking.join("\n")).toMatch(/query:mode" added as required/);
  });
});
