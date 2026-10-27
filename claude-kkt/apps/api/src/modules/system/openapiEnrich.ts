/**
 * OpenAPI enrichment (audit F2): the document @fastify/swagger generates from the route schemas carries accurate success schemas but
 * nothing a typed client needs beyond them. This pass adds, deterministically:
 *  - an `operationId` on every operation (explicit `schema.operationId` wins; otherwise derived from method + path, e.g.
 *    `GET /api/v1/bookings/{id}/ledger` → `getBookingsByIdLedger`; routes outside /api/v1 get a `Root` prefix), unique;
 *  - shared components: `ApiError` (the error envelope), `ValidationIssue`, `ListMeta`, `MoneyPaise` / `SignedMoneyPaise` /
 *    `PositiveMoneyPaise` (every matching `*_paise` property references them), `Version`; header parameters `IdempotencyKey`,
 *    `IdempotencyKeyRequired`, `IfMatch`, `IfNoneMatch`; response headers `ETag`, `RetryAfter`, `IdempotentReplayed`; and one response
 *    per error status, each referencing `ApiError`;
 *  - the error responses of every operation (400/401/403/404/409/413/415/422/428/429/500/503 as applicable) and 304 on GETs;
 *  - `Idempotency-Key` on idempotent POSTs, `If-Match` on writes that require a version (contract C6), `If-None-Match` on GETs;
 *  - binary and text media types for the PDF, file, ZIP, CSV, calendar, sitemap and metrics endpoints, and the `text/csv` alternate of
 *    every list that accepts `format=csv` / `export=CSV`.
 * The compatibility checker (openapiDiff.ts) treats all of this as non-breaking.
 */
import { z } from "zod";
import { ApiErrorSchema, ListMetaSchema, ValidationIssueSchema } from "@kkt/contracts";

type Json = Record<string, unknown>;

/** What the enrichment needs to know about a route (from the route registry). */
export interface RouteFacts {
  method: string;
  url: string;
  permission: string | null;
  audience: "erp" | "portal" | null;
  public: boolean;
  idempotent?: boolean | "required";
}

const METHODS = ["get", "put", "post", "delete", "patch"] as const;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Stable operationId for an operation without an explicit one. */
export function operationIdFor(method: string, path: string): string {
  const inApi = path.startsWith("/api/v1");
  const rest = inApi ? path.slice("/api/v1".length) : path;
  const parts: string[] = [];
  for (const seg of rest.split("/").filter(Boolean)) {
    const m = /^\{([^}]+)\}(.*)$/.exec(seg);
    if (m) parts.push("by", ...words(m[1]!), ...words(m[2]!));
    else parts.push(...words(seg));
  }
  return `${method.toLowerCase()}${inApi ? "" : "Root"}${parts.map(cap).join("")}` || method.toLowerCase();
}

/** JSON schema of a Zod schema for components (no `$schema` key). */
function jsonSchema(schema: z.ZodType): Json {
  const out = z.toJSONSchema(schema) as Json;
  delete out["$schema"];
  return out;
}

const PAISE: Record<string, Json> = {
  MoneyPaise: {
    type: "integer",
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    description: "Money in paise (₹1 = 100 paise), an exact integer; never a float",
  },
  SignedMoneyPaise: {
    type: "integer",
    minimum: -Number.MAX_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
    description: "Signed money in paise (credits/reversals may be negative)",
  },
  PositiveMoneyPaise: {
    type: "integer",
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    description: "Money in paise, at least 1",
  },
};

/** Key of a bare integer schema for the money match (description-free). */
function paiseComponent(s: unknown): string | null {
  if (!isObj(s) || s["type"] !== "integer" || Object.keys(s).some((k) => !["type", "minimum", "maximum"].includes(k)))
    return null;
  for (const [name, def] of Object.entries(PAISE))
    if (def["minimum"] === s["minimum"] && def["maximum"] === s["maximum"]) return name;
  return null;
}

/** Replaces money properties (`*_paise`, matching a money component exactly) with a $ref, also inside nullable anyOf branches. */
function refMoney(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(refMoney);
    return;
  }
  if (!isObj(node)) return;
  const props = node["properties"];
  if (isObj(props)) {
    for (const [key, value] of Object.entries(props)) {
      if (!key.endsWith("_paise")) continue;
      const direct = paiseComponent(value);
      if (direct) {
        props[key] = { $ref: `#/components/schemas/${direct}` };
        continue;
      }
      if (isObj(value) && Array.isArray(value["anyOf"]))
        value["anyOf"] = (value["anyOf"] as unknown[]).map((b) => {
          const c = paiseComponent(b);
          return c ? { $ref: `#/components/schemas/${c}` } : b;
        });
    }
  }
  for (const v of Object.values(node)) refMoney(v);
}

/** A list envelope's `meta` property becomes a $ref to ListMeta. */
function refListMeta(schema: unknown): void {
  if (!isObj(schema) || !isObj(schema["properties"])) return;
  const props = schema["properties"];
  if ("meta" in props && "items" in props && "next_cursor" in props)
    props["meta"] = { $ref: "#/components/schemas/ListMeta" };
}

const ERROR_RESPONSES: Record<string, { name: string; description: string; retryAfter?: boolean }> = {
  "400": {
    name: "BadRequest",
    description: "Validation failed (VALIDATION_ERROR with details.issues[]), or a malformed cursor (INVALID_CURSOR)",
  },
  "401": {
    name: "Unauthorized",
    description: "Missing, invalid or expired credentials (UNAUTHENTICATED, TOKEN_EXPIRED, SESSION_REVOKED, …)",
  },
  "403": {
    name: "Forbidden",
    description: "Authenticated but not allowed (FORBIDDEN with details.permission, MFA_REQUIRED, …)",
  },
  "404": { name: "NotFound", description: "No such resource in the caller's company and project scope (NOT_FOUND)" },
  "409": {
    name: "Conflict",
    description:
      "State conflict: VERSION_CONFLICT (details.current_version), DUPLICATE, IN_USE, IDEMPOTENCY_IN_PROGRESS, IDEMPOTENT_OUTCOME_UNKNOWN, CONFLICT_RETRY, …",
  },
  "413": { name: "PayloadTooLarge", description: "Body or file above the limit (PAYLOAD_TOO_LARGE)" },
  "415": {
    name: "UnsupportedMediaType",
    description: "File type outside the allow-list, judged by its bytes (UNSUPPORTED_MEDIA_TYPE)",
  },
  "422": {
    name: "UnprocessableEntity",
    description:
      "A business rule refused the request (BUSINESS_RULE with details.rule, IDEMPOTENCY_MISMATCH, CONSTRAINT_VIOLATION, INVALID_AMOUNT, …)",
  },
  "428": {
    name: "PreconditionRequired",
    description:
      'The write needs the record\'s version: If-Match "v<n>", body version or expected_version (VERSION_REQUIRED)',
  },
  "429": {
    name: "TooManyRequests",
    description: "Rate limited (RATE_LIMITED); retry after Retry-After seconds",
    retryAfter: true,
  },
  "500": {
    name: "InternalError",
    description: "Unexpected server error (INTERNAL_ERROR); the request_id identifies it in the logs",
  },
  "503": {
    name: "ServiceUnavailable",
    description: "Overloaded, draining or a dependency is down (SERVICE_UNAVAILABLE); retry after Retry-After seconds",
    retryAfter: true,
  },
};

/** Binary / text responses by operation (method + OpenAPI path): their 200 content replaces the JSON placeholder. */
const BINARY: Record<string, Record<string, Json>> = {};
const bin = (types: string[]): Record<string, Json> =>
  Object.fromEntries(types.map((t) => [t, { schema: { type: "string", format: "binary" } }]));
const text = (types: string[]): Record<string, Json> =>
  Object.fromEntries(types.map((t) => [t, { schema: { type: "string" } }]));
const IMAGE_OR_PDF = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
for (const p of [
  "/api/v1/bookings/{id}/allotment-letter.pdf",
  "/api/v1/bookings/{id}/demands/{demandId}/letter.pdf",
  "/api/v1/bookings/{id}/statement.pdf",
  "/api/v1/payments/{id}/receipt.pdf",
  "/api/v1/public/brochure/{token}",
])
  BINARY[`get ${p}`] = bin(["application/pdf"]);
BINARY["get /api/v1/files/{token}"] = bin(IMAGE_OR_PDF);
BINARY["get /api/v1/portal/files/{token}"] = bin(IMAGE_OR_PDF);
BINARY["get /api/v1/public/media/{id}"] = bin(["image/jpeg", "image/png", "image/webp"]);
BINARY["get /api/v1/exports/download/{token}"] = text(["text/csv"]);
BINARY["get /api/v1/admin/backups/download/{token}"] = bin(["application/zip"]);
BINARY["get /metrics"] = text(["text/plain"]);
BINARY["get /api/v1/metrics"] = text(["text/plain"]);
BINARY["get /api/v1/public/robots.txt"] = text(["text/plain"]);
BINARY["get /api/v1/public/sitemap.xml"] = text(["application/xml"]);
BINARY["get /api/v1/public/site-visits/{token}.ics"] = text(["text/calendar"]);

/** POST actions that require the record's version (contract C6; docs/hardening/phase7-foundation.md "Versions"). */
const VERSIONED_POST =
  /\/(deactivate|activate|cancel|complete|no-show|outcome|messages|clear|bounce|reverse|plan-change|stage|assign|convert|reset-password|unlock|scope|kyc|status|undo|stage-sequence|generate-flats|floors|price|flat-type|publish|reschedule|agreement-revisions|other-charges|demand)$/;

/** Probe routes: never rate limited, never shed. */
const PROBES = /^\/(api\/v1\/)?(health|ready|metrics)(\/(live|ready))?$/;

function hasBodyVersion(op: Json, doc: Json): boolean {
  const content = isObj(op["requestBody"]) ? (op["requestBody"]["content"] as Json | undefined) : undefined;
  const schema =
    isObj(content) && isObj(content["application/json"]) ? content["application/json"]["schema"] : undefined;
  const resolved = resolveRef(schema, doc);
  return isObj(resolved) && isObj(resolved["properties"]) && "version" in resolved["properties"];
}

function resolveRef(node: unknown, doc: Json): unknown {
  if (!isObj(node) || typeof node["$ref"] !== "string") return node;
  let cur: unknown = doc;
  for (const part of (node["$ref"] as string).replace(/^#\//, "").split("/")) cur = isObj(cur) ? cur[part] : undefined;
  return cur;
}

/** OpenAPI path of a Fastify route url (`:id` → `{id}`). */
export function openApiPath(url: string): string {
  return url.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

/** Adds operationIds, components, error responses, header parameters and media types. Mutates and returns `doc`. */
export function enrichOpenApi(doc: Json, routes: readonly RouteFacts[]): Json {
  const facts = new Map(routes.map((r) => [`${r.method.toLowerCase()} ${openApiPath(r.url)}`, r]));
  const components = (isObj(doc["components"]) ? doc["components"] : (doc["components"] = {})) as Json;
  const schemas = (isObj(components["schemas"]) ? components["schemas"] : (components["schemas"] = {})) as Json;
  Object.assign(schemas, {
    ApiError: jsonSchema(ApiErrorSchema),
    ValidationIssue: jsonSchema(ValidationIssueSchema),
    ListMeta: jsonSchema(ListMetaSchema),
    Version: {
      type: "integer",
      minimum: 1,
      description: 'Optimistic-concurrency version of a record (ETag "v<version>")',
    },
    ...PAISE,
  });
  components["parameters"] = {
    ...(isObj(components["parameters"]) ? components["parameters"] : {}),
    IdempotencyKey: {
      in: "header",
      name: "Idempotency-Key",
      required: false,
      description:
        "Makes the write safe to retry: the same key and body replay the stored answer (Idempotent-Replayed: true); a different body is 422 IDEMPOTENCY_MISMATCH; a committed write whose answer was lost is 409 IDEMPOTENT_OUTCOME_UNKNOWN.",
      schema: { type: "string", minLength: 1, maxLength: 128 },
    },
    IdempotencyKeyRequired: {
      in: "header",
      name: "Idempotency-Key",
      required: true,
      description:
        "Required for this operation (400 IDEMPOTENCY_KEY_REQUIRED without it); semantics as IdempotencyKey.",
      schema: { type: "string", minLength: 1, maxLength: 128 },
    },
    IfMatch: {
      in: "header",
      name: "If-Match",
      required: false,
      description:
        'The record\'s version as its ETag ("v<n>"; legacy "<n>" and W/ forms accepted). Alternatives: body `version` or `expected_version`. Missing → 428 VERSION_REQUIRED, stale → 409 VERSION_CONFLICT (details.current_version).',
      schema: { type: "string", maxLength: 40 },
    },
    IfNoneMatch: {
      in: "header",
      name: "If-None-Match",
      required: false,
      description:
        "ETag of a cached copy: an unchanged response is 304 Not Modified (body-hash ETags only, never version ETags).",
      schema: { type: "string", maxLength: 200 },
    },
  };
  components["headers"] = {
    ...(isObj(components["headers"]) ? components["headers"] : {}),
    ETag: {
      description: 'Version ETag "v<version>" of a single versioned record (send it back as If-Match), or a body hash',
      schema: { type: "string" },
    },
    RetryAfter: { description: "Seconds to wait before retrying", schema: { type: "integer", minimum: 0 } },
    IdempotentReplayed: {
      description: "`true` when the answer is a replay of an earlier request with the same Idempotency-Key",
      schema: { type: "string", enum: ["true"] },
    },
  };
  const responses = (isObj(components["responses"]) ? components["responses"] : (components["responses"] = {})) as Json;
  for (const def of Object.values(ERROR_RESPONSES))
    responses[def.name] = {
      description: def.description,
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
      ...(def.retryAfter ? { headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } } } : {}),
    };
  responses["NotModified"] = { description: "Not modified (If-None-Match matched the current ETag)" };

  const paths = isObj(doc["paths"]) ? doc["paths"] : {};
  const used = new Map<string, string>();
  const keys = Object.keys(paths).sort();
  for (const path of keys) {
    const item = paths[path];
    if (!isObj(item)) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const key = `${method} ${path}`;
      const route = facts.get(key);
      // operationId: explicit or derived, unique
      let id = typeof op["operationId"] === "string" ? op["operationId"] : operationIdFor(method, path);
      if (used.has(id) && used.get(id) !== key) {
        let n = 2;
        while (used.has(`${id}${n}`)) n += 1;
        id = `${id}${n}`;
      }
      used.set(id, key);
      op["operationId"] = id;

      const params = (Array.isArray(op["parameters"]) ? op["parameters"] : (op["parameters"] = [])) as Json[];
      const hasParam = (name: string) =>
        params.some((p) => {
          const r = resolveRef(p, doc);
          return isObj(r) && String(r["name"]).toLowerCase() === name.toLowerCase() && r["in"] === "header";
        });
      const write = method !== "get";
      const isPublic = route ? route.public : !op["security"];
      const probe = PROBES.test(path);
      const versioned =
        (route &&
          !route.public &&
          route.audience !== "portal" &&
          (method === "patch" || method === "delete") &&
          !/\/auth\/sessions/.test(path)) ||
        (method === "post" && !isPublic && (VERSIONED_POST.test(path) || hasBodyVersion(op, doc)));
      const idempotent = route?.idempotent ?? false;
      if (idempotent && method === "post" && !hasParam("Idempotency-Key"))
        params.push({
          $ref: `#/components/parameters/${idempotent === "required" ? "IdempotencyKeyRequired" : "IdempotencyKey"}`,
        });
      if (versioned && !hasParam("If-Match")) params.push({ $ref: "#/components/parameters/IfMatch" });
      const binary = BINARY[key];
      if (method === "get" && !probe && !binary && !hasParam("If-None-Match"))
        params.push({ $ref: "#/components/parameters/IfNoneMatch" });

      const res = (isObj(op["responses"]) ? op["responses"] : (op["responses"] = {})) as Json;
      // media types
      if (binary) {
        const ok = (isObj(res["200"]) ? res["200"] : (res["200"] = { description: "OK" })) as Json;
        const description =
          typeof ok["description"] === "string" && ok["description"] !== "Default Response"
            ? ok["description"]
            : "File";
        res["200"] = { ...ok, description, content: binary };
      } else if (method === "get") {
        const ok = res["200"];
        const csvParam = params.some((p) => {
          const r = resolveRef(p, doc);
          if (!isObj(r) || r["in"] !== "query" || !["format", "export"].includes(String(r["name"]))) return false;
          const en = isObj(r["schema"]) ? (r["schema"]["enum"] as unknown[] | undefined) : undefined;
          return Array.isArray(en) && en.some((v) => String(v).toLowerCase() === "csv");
        });
        if (csvParam && isObj(ok) && isObj(ok["content"]) && !("text/csv" in ok["content"]))
          ok["content"]["text/csv"] = {
            schema: { type: "string", description: "The same rows as CSV (format=csv / export=CSV)" },
          };
        const pdfParam = params.some((p) => {
          const r = resolveRef(p, doc);
          const en = isObj(r) && isObj(r["schema"]) ? (r["schema"]["enum"] as unknown[] | undefined) : undefined;
          return (
            isObj(r) && r["in"] === "query" && Array.isArray(en) && en.some((v) => String(v).toLowerCase() === "pdf")
          );
        });
        if (pdfParam && isObj(ok) && isObj(ok["content"]) && !("application/pdf" in ok["content"]))
          ok["content"]["application/pdf"] = { schema: { type: "string", format: "binary" } };
      }
      // shared schemas and the version header on 2xx bodies
      for (const [status, r] of Object.entries(res)) {
        if (!/^2\d\d$/.test(status) || !isObj(r) || !isObj(r["content"])) continue;
        const json = r["content"]["application/json"];
        if (isObj(json)) {
          refListMeta(json["schema"]);
          refMoney(json["schema"]);
          const s = resolveRef(json["schema"], doc);
          if (isObj(s) && isObj(s["properties"]) && "version" in s["properties"])
            r["headers"] = {
              ...(isObj(r["headers"]) ? r["headers"] : {}),
              ETag: { $ref: "#/components/headers/ETag" },
            };
        }
        if (idempotent && method === "post")
          r["headers"] = {
            ...(isObj(r["headers"]) ? r["headers"] : {}),
            "Idempotent-Replayed": { $ref: "#/components/headers/IdempotentReplayed" },
          };
      }
      if (isObj(op["requestBody"]) && isObj(op["requestBody"]["content"])) refMoney(op["requestBody"]["content"]);

      // error responses
      const want = new Set<string>(["500"]);
      const hasInput =
        params.some((p) => {
          const r = resolveRef(p, doc);
          return isObj(r) && (r["in"] === "query" || r["in"] === "path");
        }) || op["requestBody"] !== undefined;
      if (hasInput || write) want.add("400");
      if (!isPublic) want.add("401");
      if (route?.permission || (!route && !isPublic && op["security"])) want.add("403");
      if (path.includes("{")) want.add("404");
      if (write) {
        want.add("409");
        want.add("422");
      }
      if (versioned) want.add("428");
      const prose = `${String(op["summary"] ?? "")} ${String(op["description"] ?? "")}`.toLowerCase();
      if (prose.includes("multipart")) {
        want.add("413");
        want.add("415");
      }
      if (/client-errors$/.test(path)) want.add("413");
      if (!probe) {
        want.add("429");
        want.add("503");
      }
      for (const status of [...want].sort())
        if (!(status in res)) res[status] = { $ref: `#/components/responses/${ERROR_RESPONSES[status]!.name}` };
      if (method === "get" && !probe && !binary && !("304" in res))
        res["304"] = { $ref: "#/components/responses/NotModified" };
    }
  }
  return doc;
}
