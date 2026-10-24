import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods, RouteOptions } from "fastify";
import { z } from "zod";
import type { Permission } from "@kkt/contracts";

/** Any Zod schema. */
export type AnyZod = z.ZodType;

/** Output type of an optional schema. */
export type Out<S> = S extends AnyZod ? z.output<S> : undefined;

/** A request whose body/query/params are typed from the route's Zod schemas. */
export type TypedRequest<B, Q, P> = Omit<FastifyRequest, "body" | "query" | "params"> & { body: Out<B>; query: Out<Q>; params: Out<P> };

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
}

/** Route definition accepted by route(). Exactly one of permission (staff), audience (portal) or public must be set. */
export interface RouteDef<B extends AnyZod | undefined, Q extends AnyZod | undefined, P extends AnyZod | undefined> {
  method: HTTPMethods | HTTPMethods[];
  url: string;
  permission?: Permission;
  audience?: "portal";
  public?: boolean;
  schema: RouteSchema<B, Q, P>;
  idempotent?: boolean | "required";
  rateLimit?: { limit: number; windowSeconds: number; by?: "ip" | "subject" };
  handler: (req: TypedRequest<B, Q, P>, reply: FastifyReply) => Promise<unknown>;
}

/** One entry of the route registry (used by the permission-coverage test and `GET /system/routes`). */
export interface RegistryEntry {
  method: string;
  url: string;
  permission: string | null;
  audience: "erp" | "portal" | null;
  public: boolean;
}

declare module "fastify" {
  interface FastifyInstance { routeRegistry: RegistryEntry[] }
}

/** URL prefixes served by third-party plugins (Swagger UI) that cannot carry `config.public`; treated as public everywhere. */
export const PUBLIC_PREFIXES = ["/api/v1/docs"] as const;

/** True when the url is public by prefix (docs). */
export function isPublicPrefix(url: string): boolean {
  return PUBLIC_PREFIXES.some((p) => url === p || url.startsWith(`${p}/`));
}

/** Unknown query keys are 400 VALIDATION_ERROR (docs/API-CONVENTIONS.md): plain object query schemas are made strict; other shapes are left as declared. */
function strictQuery(schema: AnyZod): AnyZod {
  return schema instanceof z.ZodObject ? schema.strict() : schema;
}

/** Tag from the first path segment after /api/v1 (for OpenAPI grouping). */
function tagFor(url: string): string {
  const parts = url.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "portal") return `portal-${parts[1] ?? "auth"}`;
  return parts[0] ?? "system";
}

/**
 * Registers a route with Zod validation/serialisation, sets `config.permission|audience|public`, idempotency and rate limit,
 * and types the handler's body/query/params from the schemas.
 */
export function route<B extends AnyZod | undefined = undefined, Q extends AnyZod | undefined = undefined, P extends AnyZod | undefined = undefined>(app: FastifyInstance, def: RouteDef<B, Q, P>): void {
  const guards = [def.permission !== undefined, def.audience !== undefined, def.public === true].filter(Boolean).length;
  if (guards !== 1) throw new Error(`Route ${String(def.method)} ${def.url} must declare exactly one of permission, audience or public`);
  const schema: Record<string, unknown> = { response: def.schema.response, tags: def.schema.tags ?? [tagFor(def.url)] };
  if (def.schema.body) schema["body"] = def.schema.body;
  if (def.schema.querystring) schema["querystring"] = strictQuery(def.schema.querystring);
  if (def.schema.params) schema["params"] = def.schema.params;
  if (def.schema.summary) schema["summary"] = def.schema.summary;
  if (def.schema.description) schema["description"] = def.schema.description;
  if (def.schema.hide) schema["hide"] = true;
  if (def.permission) schema["security"] = [{ bearerAuth: [] }];
  if (def.audience) schema["security"] = [{ portalBearerAuth: [] }];
  const options: RouteOptions = {
    method: def.method,
    url: def.url,
    schema,
    config: {
      ...(def.permission ? { permission: def.permission } : {}),
      ...(def.audience ? { audience: def.audience } : {}),
      ...(def.public ? { public: true } : {}),
      ...(def.idempotent ? { idempotent: def.idempotent } : {}),
      ...(def.rateLimit ? { rateLimit: def.rateLimit } : {}),
    },
    handler: def.handler as unknown as RouteOptions["handler"],
  };
  app.route(options);
}

/** Decorates `app.routeRegistry` and records every registered route (GET's implicit HEAD twins are skipped). */
export function installRouteRegistry(app: FastifyInstance): void {
  app.decorate("routeRegistry", []);
  app.addHook("onRoute", (r) => {
    if (r.url === "*") return; // CORS preflight catch-all
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    const cfg = (r.config ?? {}) as { permission?: string; audience?: "portal"; public?: boolean };
    const isPublic = cfg.public === true || isPublicPrefix(r.url);
    for (const m of methods) {
      if (m === "HEAD") continue;
      app.routeRegistry.push({ method: m, url: r.url, permission: cfg.permission ?? null, audience: isPublic ? null : (cfg.audience ?? "erp"), public: isPublic });
    }
  });
}
