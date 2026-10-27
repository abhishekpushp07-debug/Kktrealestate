import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

/**
 * Public caching of one route (contract C5). A route opts in with Fastify route config `{ cachePolicy: { public: true, sMaxAge,
 * staleWhileRevalidate } }` (lib/routes.ts `route({ cachePolicy })` sets it): an anonymous 200 then carries
 * `Cache-Control: public, s-maxage=<sMaxAge>, stale-while-revalidate=<staleWhileRevalidate>`, a strong ETag over the body, and a matching
 * `If-None-Match` is answered 304. Everything else stays `no-store`, and an authenticated request is always `no-store`.
 */
export interface CachePolicy {
  public: true;
  /** Seconds a shared cache (CDN) may serve the response without revalidating. */
  sMaxAge: number;
  /** Seconds a shared cache may keep serving a stale copy while it revalidates in the background. */
  staleWhileRevalidate: number;
}

declare module "fastify" {
  interface FastifyContextConfig {
    cachePolicy?: CachePolicy;
  }
}

/** Idempotency claim of the running request (plugins/idempotency.ts) as the transaction wrapper sees it. */
export interface IdempotencyClaimState {
  /** idempotency_keys.id of the claim row. */
  id: string;
  /** True once a transaction that marked the claim committed (in-memory mirror of `committed_at`). */
  committed: boolean;
  /** True when the handler ran a write statement outside any transaction (autocommit): the outcome can no longer be undone. */
  autocommitWrite: boolean;
}

/** Per-request async context (AsyncLocalStorage): what code deep in a handler needs to know about the request it serves. */
export interface RequestStore {
  requestId: string;
  idempotency?: IdempotencyClaimState | undefined;
}

const storage = new AsyncLocalStorage<RequestStore>();
const RESOURCE = Symbol("kkt.requestContext.resource");
type WithResource = { [RESOURCE]?: AsyncResource };

/** The store of the request whose code is running now (undefined outside a request: jobs, boot, tests calling services directly). */
export function requestStore(): RequestStore | undefined {
  return storage.getStore();
}

/** Runs `fn` inside a request store (jobs and tests that call request-scoped code directly). */
export function runWithRequestStore<T>(store: RequestStore, fn: () => T): T {
  return storage.run(store, fn);
}

/** Cache-Control of a public cache policy. */
export function publicCacheControl(p: CachePolicy): string {
  return `public, s-maxage=${Math.max(0, Math.floor(p.sMaxAge))}, stale-while-revalidate=${Math.max(0, Math.floor(p.staleWhileRevalidate))}`;
}

/** Strong ETag over a response body (sha256, base64url, quoted). */
export function bodyEtag(payload: string | Buffer): string {
  return `"${createHash("sha256").update(payload).digest("base64url")}"`;
}

/** True when an If-None-Match header value matches `tag` (a list, `*`, and weak spellings are honoured). */
export function etagMatches(header: string | string[] | undefined, tag: string): boolean {
  if (!header) return false;
  const values = (Array.isArray(header) ? header.join(",") : header).split(",").map((v) => v.trim());
  const bare = tag.replace(/^W\//, "");
  return values.some((v) => v === "*" || v.replace(/^W\//, "") === bare);
}

/** True when the request carried credentials or was authenticated (its response must never land in a shared cache). */
function isAuthenticated(req: FastifyRequest): boolean {
  const r = req as FastifyRequest & { user?: unknown; customer?: unknown };
  return Boolean(r.user || r.customer || req.headers.authorization || req.headers.cookie?.includes("kkt_"));
}

/**
 * Request id propagation, server timing header, the request's async context (AsyncLocalStorage, used by the idempotency transaction
 * hook) and the cache policy of every response (contract C5).
 */
export default fp(
  async (app) => {
    app.addHook("onRequest", (req, reply, done) => {
      reply.header("X-Request-Id", req.id);
      (req as unknown as { startedAt: number }).startedAt = performance.now();
      // the store must wrap everything that follows; preValidation re-enters it because body parsing resumes the request from the
      // socket's 'end' event, which runs in the socket's async context (the same fix @fastify/request-context applies)
      storage.run({ requestId: String(req.id) }, () => {
        const resource = new AsyncResource("kkt-request");
        (req as unknown as WithResource)[RESOURCE] = resource;
        resource.runInAsyncScope(done, req.raw);
      });
    });
    app.addHook("preValidation", (req, _reply, done) => {
      const resource = (req as unknown as WithResource)[RESOURCE];
      if (resource) resource.runInAsyncScope(done, req.raw);
      else done();
    });
    app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload) => {
      const started = (req as unknown as { startedAt?: number }).startedAt;
      if (started) reply.header("X-Response-Time", `${(performance.now() - started).toFixed(1)}ms`);
      const policy = req.routeOptions.config?.cachePolicy;
      const authenticated = isAuthenticated(req);
      if (policy?.public && !authenticated && (req.method === "GET" || req.method === "HEAD")) {
        if (reply.statusCode === 200 || reply.statusCode === 304) {
          reply.header("Cache-Control", publicCacheControl(policy));
          // the tenant can come from x-kkt-company (contract C4): a shared cache must key on it
          reply.header("Vary", appendVary(reply.getHeader("Vary"), "x-kkt-company"));
          if (reply.statusCode === 200 && (typeof payload === "string" || Buffer.isBuffer(payload))) {
            const current = reply.getHeader("ETag");
            // a version tag ("v<n>", contract C6) promises the record, not this body: public caching needs the body hash
            const tag =
              typeof current === "string" && current.length > 0 && !current.startsWith('"v')
                ? current
                : bodyEtag(payload);
            reply.header("ETag", tag);
            if (etagMatches(req.headers["if-none-match"], tag)) {
              reply.code(304);
              reply.removeHeader("Content-Length");
              return "";
            }
          }
          return payload;
        }
        reply.header("Cache-Control", "no-store");
        return payload;
      }
      const set = reply.getHeader("Cache-Control");
      // an authenticated response never lands in a shared cache, whatever the route set
      if (authenticated && typeof set === "string" && /\bpublic\b|s-maxage/i.test(set))
        reply.header("Cache-Control", "no-store");
      else reply.header("Cache-Control", set ?? "no-store");
      return payload;
    });
  },
  { name: "request-context" },
);

function appendVary(existing: unknown, value: string): string {
  const parts = String(existing ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (!parts.some((p) => p.toLowerCase() === value.toLowerCase())) parts.push(value);
  return parts.join(", ");
}

/** Generate request ids (honours an inbound X-Request-Id of sane length). */
export function genReqId(headers: Record<string, string | string[] | undefined>): string {
  const inbound = headers["x-request-id"];
  const v = Array.isArray(inbound) ? inbound[0] : inbound;
  if (v && /^[A-Za-z0-9._-]{8,64}$/.test(v)) return v;
  return randomUUID().replace(/-/g, "").slice(0, 20);
}
