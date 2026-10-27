import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods, RouteOptions } from "fastify";
import { z } from "zod";
import type { Permission } from "@kkt/contracts";
import type { CachePolicy } from "../plugins/requestContext.js";
import { ApiError } from "./errors.js";

/** Any Zod schema. */
export type AnyZod = z.ZodType;

/** Output type of an optional schema. */
export type Out<S> = S extends AnyZod ? z.output<S> : undefined;

/** A request whose body/query/params are typed from the route's Zod schemas. */
export type TypedRequest<B, Q, P> = Omit<FastifyRequest, "body" | "query" | "params"> & {
  body: Out<B>;
  query: Out<Q>;
  params: Out<P>;
};

/** Route schema: Zod for body/querystring/params and a 2xx response map (compiled serialisation + OpenAPI). */
export interface RouteSchema<B, Q, P> {
  body?: B;
  querystring?: Q;
  params?: P;
  response: Record<number, AnyZod>;
  summary?: string;
  description?: string;
  tags?: string[];
  hide?: boolean;
  /** Explicit OpenAPI operationId (default: derived from method and path, modules/system/openapiEnrich.ts). */
  operationId?: string;
}

/** Route definition accepted by route(). Exactly one of permission (staff), audience (portal) or public must be set. */
export interface RouteDef<B extends AnyZod | undefined, Q extends AnyZod | undefined, P extends AnyZod | undefined> {
  method: HTTPMethods | HTTPMethods[];
  url: string;
  /** One permission, or a list of alternatives of which the caller needs ANY (registered as "a|b" so the registry stays truthful). */
  permission?: Permission | readonly Permission[];
  audience?: "portal";
  public?: boolean;
  schema: RouteSchema<B, Q, P>;
  idempotent?: boolean | "required";
  /**
   * Top-level response fields that carry a ONE-TIME secret (temporary password, bearer link/token). An idempotent route must list them:
   * the idempotency store keeps the response with these fields replaced by "[redacted]", and a replay of the key answers 409
   * IDEMPOTENT_SECRET_REPLAY (details.redacted_fields + the redacted original) instead of re-issuing or persisting the secret.
   */
  oneTimeSecrets?: readonly string[];
  rateLimit?: { limit: number; windowSeconds: number; by?: "ip" | "subject" };
  /**
   * Public CDN caching of an anonymous GET (contract C5, plugins/requestContext.ts): `Cache-Control: public, s-maxage, stale-while-revalidate`,
   * a strong body ETag and 304 on a matching If-None-Match. Without it every response is `no-store`; authenticated requests always are.
   */
  cachePolicy?: CachePolicy;
  /** Request body limit in bytes for this route (default: the app's 2 MB). */
  bodyLimit?: number;
  /**
   * Marks the operation deprecated (docs/VERSIONING.md): every response carries `Deprecation: @<since>` (RFC 9745), `Sunset: <HTTP-date>`
   * (RFC 8594) and `Link` headers, and the OpenAPI operation is flagged `deprecated`. After the sunset date the route is replaced with
   * `goneRoute()` in the next release (410 GONE); it is never silently changed.
   */
  deprecated?: Deprecation;
  handler: (req: TypedRequest<B, Q, P>, reply: FastifyReply) => Promise<unknown>;
}

/** Deprecation metadata of a route. Dates are ISO `YYYY-MM-DD` (UTC midnight) or full ISO timestamps. */
export interface Deprecation {
  /** Date after which the route may be removed (it then answers 410 GONE). */
  sunset: string;
  /** Date the deprecation was announced (default: the sunset date minus the 180-day window). */
  since?: string;
  /** Replacement operation, e.g. `GET /api/v1/bookings?view=compact`. */
  replacement?: string;
  /** Human-readable migration notes (default: the versioning policy). */
  link?: string;
}

/** Deprecation window of the versioning policy (docs/VERSIONING.md). */
export const DEPRECATION_WINDOW_DAYS = 180;
/** Where clients read the policy. */
export const VERSIONING_POLICY_URL = "/api/v1/docs";

function parseDate(v: string, what: string): Date {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) throw new Error(`${what}: invalid date ${v}`);
  return d;
}

/** Response headers for a deprecated route (exported for tests and gone routes). */
export function deprecationHeaders(dep: Deprecation): Record<string, string> {
  const sunset = parseDate(dep.sunset, "deprecated.sunset");
  const since = dep.since
    ? parseDate(dep.since, "deprecated.since")
    : new Date(sunset.getTime() - DEPRECATION_WINDOW_DAYS * 86_400_000);
  if (since.getTime() > sunset.getTime()) throw new Error("deprecated.since must not be after deprecated.sunset");
  const links = [`<${dep.link ?? VERSIONING_POLICY_URL}>; rel="deprecation"; type="text/html"`];
  if (dep.replacement) links.push(`<${dep.replacement.replace(/^[A-Z]+\s+/, "")}>; rel="successor-version"`);
  return {
    Deprecation: `@${Math.floor(since.getTime() / 1000)}`,
    Sunset: sunset.toUTCString(),
    Link: links.join(", "),
  };
}

function tracingEnabled(): boolean {
  return Boolean(process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]);
}

/** Wraps a handler in a span named after the route (only when tracing is on, so the default path has zero overhead). */
function traced(
  def: { method: HTTPMethods | HTTPMethods[]; url: string; permission?: string; audience?: string; public?: boolean },
  handler: RouteOptions["handler"],
): RouteOptions["handler"] {
  if (!tracingEnabled()) return handler;
  const tracer = trace.getTracer("kkt-api");
  const name = `${Array.isArray(def.method) ? def.method.join(",") : def.method} ${def.url}`;
  const attributes = {
    "http.route": def.url,
    "kkt.route": name,
    "kkt.permission": def.permission ?? "",
    "kkt.audience": def.public ? "public" : (def.audience ?? "erp"),
  };
  return async function tracedHandler(this: FastifyInstance, req, reply) {
    return tracer.startActiveSpan(`handler ${name}`, { attributes }, async (span) => {
      try {
        return await (handler as (this: FastifyInstance, r: FastifyRequest, p: FastifyReply) => Promise<unknown>).call(
          this,
          req,
          reply,
        );
      } catch (err) {
        span.recordException(err as Error);
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).name });
        span.setAttribute("kkt.error_code", String((err as { code?: string }).code ?? "INTERNAL_ERROR"));
        throw err;
      } finally {
        span.end();
      }
    });
  } as RouteOptions["handler"];
}

/** One entry of the route registry (used by the permission-coverage test and `GET /system/routes`). */
export interface RegistryEntry {
  method: string;
  url: string;
  permission: string | null;
  audience: "erp" | "portal" | null;
  public: boolean;
  /** Sunset date when the route is deprecated. */
  sunset?: string;
  /** Idempotent POST routes only: the idempotency mode, the declared one-time secret fields and the top-level 2xx response fields. */
  idempotent?: boolean | "required";
  oneTimeSecrets?: readonly string[];
  responseFields?: readonly string[];
}

declare module "fastify" {
  interface FastifyInstance {
    routeRegistry: RegistryEntry[];
  }
}

/** URL prefixes served by third-party plugins (Swagger UI) that cannot carry `config.public`; treated as public everywhere. */
export const PUBLIC_PREFIXES = ["/api/v1/docs"] as const;

/** The OpenAPI document and Swagger UI: public only with DOCS_PUBLIC (default off in production), else a staff token with admin.tools. */
export const DOCS_URLS = ["/api/v1/openapi.json", "/api/v1/docs"] as const;

/** True for the OpenAPI document and every Swagger UI url (page, static assets, /json, /yaml). */
export function isDocsUrl(url: string): boolean {
  return DOCS_URLS.some((p) => url === p || url.startsWith(`${p}/`));
}

/** True when the url is public by prefix (docs). */
export function isPublicPrefix(url: string): boolean {
  return PUBLIC_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`));
}

/** Joins alternative permissions with "|" (the auth plugin accepts any of them). */
export function permissionKey(p: Permission | readonly Permission[]): string {
  return Array.isArray(p) ? (p as readonly string[]).join("|") : String(p);
}

/** Splits a registered permission key back into its alternatives. */
export function permissionAlternatives(key: string): string[] {
  return key
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Unknown query keys are 400 VALIDATION_ERROR (docs/API-CONVENTIONS.md): plain object query schemas are made strict; other shapes are left as declared. */
function strictQuery(schema: AnyZod): AnyZod {
  return schema instanceof z.ZodObject ? schema.strict() : schema;
}

/** Top-level fields of the 2xx response object schemas (route registry: one-time secret coverage of idempotent routes). */
function responseFields(response: Record<number, AnyZod>): string[] {
  const out = new Set<string>();
  for (const schema of Object.values(response))
    if (schema instanceof z.ZodObject) for (const k of Object.keys(schema.shape)) out.add(k);
  return [...out].sort();
}

/** Tag from the first path segment after /api/v1 (for OpenAPI grouping). */
function tagFor(url: string): string {
  const parts = url
    .replace(/^\/api\/v1\/?/, "")
    .split("/")
    .filter(Boolean);
  if (parts[0] === "portal") return `portal-${parts[1] ?? "auth"}`;
  return parts[0] ?? "system";
}

/**
 * Registers a route with Zod validation/serialisation, sets `config.permission|audience|public`, idempotency and rate limit,
 * and types the handler's body/query/params from the schemas.
 */
export function route<
  B extends AnyZod | undefined = undefined,
  Q extends AnyZod | undefined = undefined,
  P extends AnyZod | undefined = undefined,
>(app: FastifyInstance, def: RouteDef<B, Q, P>): void {
  const guards = [def.permission !== undefined, def.audience !== undefined, def.public === true].filter(Boolean).length;
  if (guards !== 1)
    throw new Error(
      `Route ${String(def.method)} ${def.url} must declare exactly one of permission, audience or public`,
    );
  const schema: Record<string, unknown> = { response: def.schema.response, tags: def.schema.tags ?? [tagFor(def.url)] };
  if (def.schema.body) schema["body"] = def.schema.body;
  if (def.schema.querystring) schema["querystring"] = strictQuery(def.schema.querystring);
  if (def.schema.params) schema["params"] = def.schema.params;
  if (def.schema.summary) schema["summary"] = def.schema.summary;
  if (def.schema.description) schema["description"] = def.schema.description;
  if (def.schema.hide) schema["hide"] = true;
  if (def.schema.operationId) schema["operationId"] = def.schema.operationId;
  if (def.permission) schema["security"] = [{ bearerAuth: [] }];
  if (def.audience) schema["security"] = [{ portalBearerAuth: [] }];
  let onSend: RouteOptions["onSend"] | undefined;
  if (def.deprecated) {
    const headers = deprecationHeaders(def.deprecated);
    schema["deprecated"] = true;
    // machine-readable sunset for the OpenAPI compatibility gate (a deprecated operation may disappear only after this date)
    schema["x-sunset"] = parseDate(def.deprecated.sunset, "deprecated.sunset").toISOString().slice(0, 10);
    schema["description"] = [
      def.schema.description,
      `Deprecated. Sunset: ${headers["Sunset"]}${def.deprecated.replacement ? `; use ${def.deprecated.replacement}` : ""}.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    // onSend (not onRequest): route-level onSend hooks also run when a global onRequest hook (authentication, rate limit, load
    // shedding) rejects the request, so a 401/403/429/503 from a deprecated operation still announces the deprecation
    onSend = async (_req, reply, payload) => {
      reply.headers(headers);
      return payload;
    };
  }
  const options: RouteOptions = {
    method: def.method,
    url: def.url,
    schema,
    config: {
      ...(def.permission ? { permission: permissionKey(def.permission) } : {}),
      ...(def.audience ? { audience: def.audience } : {}),
      ...(def.public ? { public: true } : {}),
      ...(def.idempotent ? { idempotent: def.idempotent } : {}),
      ...(def.oneTimeSecrets?.length ? { oneTimeSecrets: def.oneTimeSecrets } : {}),
      ...(def.idempotent ? { responseFields: responseFields(def.schema.response) } : {}),
      ...(def.rateLimit ? { rateLimit: def.rateLimit } : {}),
      ...(def.cachePolicy ? { cachePolicy: def.cachePolicy } : {}),
      ...(def.deprecated ? { sunset: def.deprecated.sunset } : {}),
    },
    ...(onSend ? { onSend } : {}),
    ...(def.bodyLimit ? { bodyLimit: def.bodyLimit } : {}),
    // the span carries the full route pattern (`/api/v1/bookings/:id`), like the server span and the metrics `route` label
    handler: traced(
      {
        ...def,
        url: `${app.prefix ?? ""}${def.url}`,
        ...(def.permission ? { permission: permissionKey(def.permission) } : {}),
      } as Parameters<typeof traced>[0],
      def.handler as unknown as RouteOptions["handler"],
    ),
  };
  app.route(options);
}

/**
 * A retired operation (docs/VERSIONING.md): answers 410 GONE with the replacement in `details`, keeps the Sunset/Link headers, and stays
 * in the route registry (public) so the permission-coverage test and clients can see it. Use it for one release after the sunset date.
 */
export function goneRoute(
  app: FastifyInstance,
  def: { method: HTTPMethods; url: string; sunset: string; replacement?: string; link?: string },
): void {
  const headers = deprecationHeaders({
    sunset: def.sunset,
    ...(def.replacement ? { replacement: def.replacement } : {}),
    ...(def.link ? { link: def.link } : {}),
  });
  app.route({
    method: def.method,
    url: def.url,
    schema: { hide: true },
    config: { public: true, sunset: def.sunset },
    handler: async (_req, reply) => {
      reply.headers(headers);
      throw new ApiError(
        410,
        "GONE",
        `${def.method} ${def.url} was retired on ${headers["Sunset"]}${def.replacement ? `; use ${def.replacement}` : ""}`,
        { sunset: def.sunset, ...(def.replacement ? { replacement: def.replacement } : {}) },
      );
    },
  });
}

/** Decorates `app.routeRegistry` and records every registered route (GET's implicit HEAD twins are skipped). */
export function installRouteRegistry(app: FastifyInstance): void {
  app.decorate("routeRegistry", []);
  app.addHook("onRoute", (r) => {
    if (r.url === "*") return; // CORS preflight catch-all
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    const cfg = (r.config ?? {}) as {
      permission?: string;
      audience?: "portal";
      public?: boolean;
      sunset?: string;
      idempotent?: boolean | "required";
      oneTimeSecrets?: readonly string[];
      responseFields?: readonly string[];
    };
    const isPublic = cfg.public === true || isPublicPrefix(r.url);
    for (const m of methods) {
      if (m === "HEAD") continue;
      app.routeRegistry.push({
        method: m,
        url: r.url,
        permission: cfg.permission ?? null,
        audience: isPublic ? null : (cfg.audience ?? "erp"),
        public: isPublic,
        ...(cfg.sunset ? { sunset: cfg.sunset } : {}),
        ...(cfg.idempotent
          ? {
              idempotent: cfg.idempotent,
              oneTimeSecrets: cfg.oneTimeSecrets ?? [],
              responseFields: cfg.responseFields ?? [],
            }
          : {}),
      });
    }
  });
}
