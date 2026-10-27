import { createHash } from "node:crypto";
import { sql as dsql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Redis } from "ioredis";
import type { Sql } from "postgres";
import type { DB, Executor } from "@kkt/db";
import { config } from "../config.js";
import { registerJob } from "../jobs/index.js";
import { redisUsable } from "../lib/cache.js";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { idempotencyOutcomeUnknownTotal } from "../lib/metrics.js";
import { installVersionPolicy } from "../lib/version.js";
import { requestStore, type IdempotencyClaimState } from "./requestContext.js";

declare module "fastify" {
  interface FastifyInstance {
    sql: Sql;
  }
  interface FastifyContextConfig {
    idempotent?: boolean | "required";
    oneTimeSecrets?: readonly string[];
    permission?: string;
    audience?: "erp" | "portal";
    public?: boolean;
    rateLimit?: { limit: number; windowSeconds: number; by?: "ip" | "subject" };
  }
}

const TTL_SECONDS = 24 * 3600;
/** How long a concurrent duplicate waits for the in-flight request to finish before giving up with 409. */
const WAIT_MS = 10_000;
/**
 * Legacy rule for claims written before leases existed (`lease_expires_at` NULL): such an IN_PROGRESS record older than this is
 * considered abandoned. Current claims carry a lease renewed by a heartbeat (IDEMPOTENCY_LEASE_SECONDS) instead.
 */
export const IDEMPOTENCY_ABANDON_SECONDS = 60;
/** Budget of one Redis round trip on the idempotency fast path (Redis is only a cache; Postgres decides). */
const REDIS_BUDGET_MS = 200;
/** Rows deleted per statement by IDEMPOTENCY_PURGE. */
export const IDEMPOTENCY_PURGE_BATCH = 5_000;

interface StoredResponse {
  request_hash: string;
  status_code: number;
  response_body: unknown;
  path: string;
}

/** Marker key of a stored response whose one-time secrets were redacted (the route declared `oneTimeSecrets`). */
export const SECRET_REDACTED_MARKER = "__kkt_secret_redacted";
/** Value written in place of a one-time secret in the idempotency store. */
export const REDACTED_VALUE = "[redacted]";

/**
 * The body the idempotency store keeps for a route that returns one-time secrets: every listed top-level field that is present and not
 * null is replaced by "[redacted]", and the whole body is wrapped with the redaction marker so a replay is recognised.
 */
export function redactOneTimeSecrets(
  body: unknown,
  fields: readonly string[],
): { [SECRET_REDACTED_MARKER]: string[]; body: unknown } {
  const redacted: string[] = [];
  let out = body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const f of fields) {
      if (copy[f] === undefined || copy[f] === null) continue;
      copy[f] = REDACTED_VALUE;
      redacted.push(f);
    }
    out = copy;
  }
  return { [SECRET_REDACTED_MARKER]: redacted, body: out };
}

function isRedactedRecord(body: unknown): body is { [SECRET_REDACTED_MARKER]: string[]; body: unknown } {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as Record<string, unknown>)[SECRET_REDACTED_MARKER])
  );
}
interface Row {
  request_hash: string;
  status_code: number | null;
  response_body: unknown;
  path: string;
  committed_at: Date | string | null;
  lease_lapsed: boolean;
}

/**
 * Route-provided request fingerprints (docs/TODO-integration.md item 2). Multipart bodies are streamed, so `req.body` is empty and
 * every upload would hash alike; routes that parse a multipart body before preHandler register a digest of the fields and file bytes
 * here and the Idempotency-Key fingerprint covers the actual upload (same key + different file → 422 IDEMPOTENCY_MISMATCH).
 */
const fingerprints = new WeakMap<FastifyRequest, unknown>();

/** Sets the value the idempotency plugin hashes for this request instead of `req.body` (call from a preValidation hook). */
export function setIdempotencyFingerprint(req: FastifyRequest, value: unknown): void {
  fingerprints.set(req, value);
}

/** The value the idempotency plugin hashes for this request (route fingerprint when set, else the JSON body). */
export function idempotencyFingerprint(req: FastifyRequest): unknown {
  return fingerprints.has(req) ? fingerprints.get(req) : (req.body ?? null);
}

function requestHash(req: FastifyRequest): string {
  return createHash("sha256")
    .update(req.method)
    .update(req.url)
    .update(JSON.stringify(idempotencyFingerprint(req) ?? null))
    .digest("hex");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs a Redis call within REDIS_BUDGET_MS; undefined when Redis is down (disconnected clients are skipped at once), slow or errors. */
async function redisTry<T>(what: string, fn: () => Promise<T>, client?: Pick<Redis, "status">): Promise<T | undefined> {
  if (client && !redisUsable(client)) return undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), REDIS_BUDGET_MS);
      }),
    ]);
  } catch (err) {
    logger.warn({ err: (err as Error).message, what }, "idempotency: Redis unavailable; Postgres answers");
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Deletes expired idempotency records in batches of IDEMPOTENCY_PURGE_BATCH (job IDEMPOTENCY_PURGE, hourly). */
export async function purgeExpiredIdempotencyKeys(
  sql: Sql,
  batch = IDEMPOTENCY_PURGE_BATCH,
): Promise<{ deleted: number; batches: number }> {
  let deleted = 0;
  let batches = 0;
  for (;;) {
    const rows =
      await sql`delete from idempotency_keys where id in (select id from idempotency_keys where expires_at <= now() limit ${batch}) returning 1`;
    batches += 1;
    deleted += rows.length;
    if (rows.length < batch) break;
  }
  return { deleted, batches };
}

/** Marker key of a stored outcome that is NOT a response: the write committed but its answer was lost (a 5xx after COMMIT). */
export const OUTCOME_UNKNOWN_MARKER = "__kkt_outcome_unknown";

/**
 * Marker of a stored response withdrawn by a DPDP erasure (admin/erase.ts): the request did succeed, but its body named the erased
 * customer, so the store keeps only the original status. A replay answers 410 GONE (never a re-execution, never the erased data).
 */
export const ERASED_MARKER = "__kkt_erased";

function isErasedRecord(body: unknown): body is { [ERASED_MARKER]: true; original_status: number | null } {
  return typeof body === "object" && body !== null && (body as Record<string, unknown>)[ERASED_MARKER] === true;
}

/** Redis key of the cached copy of an idempotent response. */
export function idempotencyCacheKey(scopeKey: string, key: string): string {
  return `idem:${scopeKey}:${key}`;
}

/**
 * Withdraws every live stored response that mentions `subjectId` (a customer create/update/KYC answer holds the id with the name,
 * phone and e-mail), keeping the record — and so the key's "already done" protection — but not the personal data. Returns the Redis keys
 * of their cached copies, which the caller deletes after COMMIT (dropCachedResponses).
 */
export async function scrubIdempotencyResponses(tx: Executor, subjectId: string): Promise<string[]> {
  const rows = await tx.execute<{ scope_key: string; key: string }>(dsql`
    update idempotency_keys
       set response_body = jsonb_build_object(${ERASED_MARKER}::text, true, 'original_status', status_code)
     where expires_at > now()
       and response_body is not null
       and not (response_body ? ${ERASED_MARKER}::text)
       and strpos(response_body::text, ${subjectId}) > 0
    returning scope_key, key`);
  return rows.map((r) => idempotencyCacheKey(r.scope_key, r.key));
}

/** Deletes cached copies of scrubbed responses (best effort; a copy that survives a Redis outage expires with the record's TTL). */
export async function dropCachedResponses(
  redis: Pick<Redis, "del" | "status">,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  await redisTry("del", () => redis.del(...keys), redis);
}

/** Lease of an IN_PROGRESS claim in seconds (IDEMPOTENCY_LEASE_SECONDS); the running request renews it every third of it. */
export function idempotencyLeaseSeconds(): number {
  return config.IDEMPOTENCY_LEASE_SECONDS;
}

function isOutcomeUnknown(
  body: unknown,
): body is { [OUTCOME_UNKNOWN_MARKER]: true; original_status: number; request_id: string | null } {
  return (
    typeof body === "object" && body !== null && (body as Record<string, unknown>)[OUTCOME_UNKNOWN_MARKER] === true
  );
}

/** 409 IDEMPOTENT_OUTCOME_UNKNOWN: the first attempt committed, its response was lost; look the resource up instead of re-sending. */
function outcomeUnknown(details: Record<string, unknown>): ApiError {
  return new ApiError(
    409,
    "IDEMPOTENT_OUTCOME_UNKNOWN",
    "A request with this Idempotency-Key already committed its changes, but its response was lost. Do not retry with a new key: look the resource up (list or GET) to see what was created or changed.",
    { ...details, retry_with_new_key: false, action: "LOOKUP_RESOURCE" },
  );
}

/** Statements that write (a write outside a transaction commits on its own and can no longer be released for a retry). */
const WRITE_SQL = /^\s*(with\b[\s\S]*?\)\s*)?(insert|update|delete|merge)\b/i;

/**
 * Idempotency for creates. Routes opt in with `config.idempotent: true | "required"`. Scope = authenticated subject id (or client IP for
 * public routes) + key. Postgres is the source of truth and Redis only a cache:
 *  - preHandler claims the key with an IN_PROGRESS row (`status_code IS NULL`, insert … on conflict) holding a lease
 *    (`lease_expires_at`, IDEMPOTENCY_LEASE_SECONDS) that a heartbeat renews while the request runs; concurrent duplicates on any instance
 *    wait for it and replay its response, with or without Redis;
 *  - every transaction the handler opens through `app.db.transaction` (directly, withTransactionRetry or moneyTransaction) marks the
 *    claim `committed_at` as its last statement, so the mark commits exactly when the write does (the request's AsyncLocalStorage
 *    store, plugins/requestContext.ts, tells the transaction which claim is running);
 *  - onSend stores a 2xx response in the row (and in Redis). A non-2xx response releases the claim only when nothing committed
 *    (`committed_at IS NULL`, checked in the same DELETE, and no autocommit write ran); after a commit a 4xx is stored and replayed like a
 *    success, and a 5xx is stored as "outcome unknown": a retry with the key answers 409 IDEMPOTENT_OUTCOME_UNKNOWN;
 *  - a claim whose lease lapsed (its instance died) is taken over by a retry with the same body only when it never committed; a committed
 *    claim without a stored response answers 409 IDEMPOTENT_OUTCOME_UNKNOWN.
 * Replays carry `Idempotent-Replayed: true`; the same key with a different body is 422 IDEMPOTENCY_MISMATCH.
 */
export default fp(
  async (app) => {
    const sql = app.sql as Sql;
    installVersionPolicy(app);
    registerJob("IDEMPOTENCY_PURGE", async () => purgeExpiredIdempotencyKeys(sql));
    installCommitMarker(app);

    async function cachedResponse(redisKey: string): Promise<StoredResponse | null> {
      const raw = await redisTry("get", () => app.redis.get(redisKey), app.redis);
      return raw ? (JSON.parse(raw) as StoredResponse) : null;
    }

    /**
     * Claims the key: inserts the IN_PROGRESS row, or takes over an expired one, or one with the same request hash whose lease lapsed and
     * that never committed (rows written before leases existed fall back to the old 60 s age rule).
     */
    async function claim(scopeKey: string, key: string, req: FastifyRequest, hash: string): Promise<string | null> {
      const lease = idempotencyLeaseSeconds();
      const rows = await sql<{ id: string }[]>`
      insert into idempotency_keys (scope_key, key, method, path, request_hash, status_code, response_body, expires_at, lease_expires_at)
      values (${scopeKey}, ${key}, ${req.method}, ${req.url}, ${hash}, null, null, now() + make_interval(secs => ${TTL_SECONDS}),
              now() + make_interval(secs => ${lease}))
      on conflict (scope_key, key) do update
        set method = excluded.method, path = excluded.path, request_hash = excluded.request_hash, status_code = null, response_body = null,
            created_at = now(), expires_at = excluded.expires_at, lease_expires_at = excluded.lease_expires_at, committed_at = null
        where idempotency_keys.expires_at <= now()
           or (idempotency_keys.status_code is null and idempotency_keys.committed_at is null
               and idempotency_keys.request_hash = excluded.request_hash
               and (idempotency_keys.lease_expires_at < now()
                    or (idempotency_keys.lease_expires_at is null
                        and idempotency_keys.created_at < now() - make_interval(secs => ${IDEMPOTENCY_ABANDON_SECONDS}))))
      returning id`;
      return rows[0]?.id ?? null;
    }

    async function current(scopeKey: string, key: string): Promise<Row | null> {
      const rows = await sql<Row[]>`
        select request_hash, status_code, response_body, path, committed_at,
               (lease_expires_at is not null and lease_expires_at < now()) as lease_lapsed
        from idempotency_keys where scope_key = ${scopeKey} and key = ${key} and expires_at > now()`;
      return rows[0] ?? null;
    }

    function replay(reply: FastifyReply, stored: StoredResponse, hash: string): FastifyReply {
      if (stored.request_hash !== hash)
        throw new ApiError(422, "IDEMPOTENCY_MISMATCH", "Idempotency-Key was already used with a different request");
      reply.header("Idempotent-Replayed", "true");
      if (isOutcomeUnknown(stored.response_body)) {
        throw outcomeUnknown({
          original_status: stored.response_body.original_status,
          original_request_id: stored.response_body.request_id,
          path: stored.path,
        });
      }
      if (isErasedRecord(stored.response_body)) {
        throw new ApiError(
          410,
          "GONE",
          "This request already succeeded, but the data it returned was erased (DPDP). Do not retry it; look the record up instead.",
          { original_status: stored.response_body.original_status },
        );
      }
      if (isRedactedRecord(stored.response_body)) {
        // the original response carried a one-time secret that is never stored: the request DID succeed, but its secret cannot be shown again
        throw new ApiError(
          409,
          "IDEMPOTENT_SECRET_REPLAY",
          "This request already succeeded, but its one-time secret is not stored and cannot be shown again. Issue a new one (for example reset the password) instead of retrying.",
          {
            original_status: stored.status_code,
            redacted_fields: stored.response_body[SECRET_REDACTED_MARKER],
            original: stored.response_body.body,
          },
        );
      }
      return reply.status(stored.status_code).send(stored.response_body);
    }

    /** Renews the claim's lease every third of the lease while the request runs (stops on its own after the record's TTL). */
    function startHeartbeat(id: string): NodeJS.Timeout {
      const lease = idempotencyLeaseSeconds();
      const started = Date.now();
      const timer = setInterval(
        () => {
          if (Date.now() - started > TTL_SECONDS * 1000) {
            clearInterval(timer);
            return;
          }
          sql`update idempotency_keys set lease_expires_at = now() + make_interval(secs => ${lease})
              where id = ${id} and status_code is null`.catch((err: unknown) =>
            logger.warn({ err: (err as Error).message }, "idempotency: lease renewal failed"),
          );
        },
        Math.max(250, Math.floor((lease * 1000) / 3)),
      );
      timer.unref();
      return timer;
    }

    app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      const mode = req.routeOptions.config.idempotent;
      if (!mode || req.method !== "POST") return;
      const key = req.headers["idempotency-key"];
      const keyStr = Array.isArray(key) ? key[0] : key;
      if (!keyStr) {
        if (mode === "required")
          throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required for this operation");
        return;
      }
      if (keyStr.length > 128) throw ApiError.badRequest("Idempotency-Key too long");
      const scopeKey = req.subjectId ?? req.clientIp;
      const hash = requestHash(req);
      const redisKey = idempotencyCacheKey(scopeKey, keyStr);
      const cached = await cachedResponse(redisKey);
      if (cached) return replay(reply, cached, hash);
      const deadline = Date.now() + WAIT_MS;
      let pause = 25;
      for (;;) {
        const id = await claim(scopeKey, keyStr, req, hash);
        if (id) {
          const state: IdempotencyClaimState = { id, committed: false, autocommitWrite: false };
          req.idempotency = { scopeKey, key: keyStr, hash, redisKey, id, state, heartbeat: startHeartbeat(id) };
          const store = requestStore();
          if (store) store.idempotency = state;
          return;
        }
        const row = await current(scopeKey, keyStr);
        if (row && row.request_hash !== hash)
          throw new ApiError(422, "IDEMPOTENCY_MISMATCH", "Idempotency-Key was already used with a different request");
        if (row && row.status_code !== null)
          return replay(
            reply,
            {
              request_hash: row.request_hash,
              status_code: row.status_code,
              response_body: row.response_body,
              path: row.path,
            },
            hash,
          );
        // committed, but the instance died before it stored the response (its lease lapsed): never run it again
        if (row && row.committed_at !== null && row.lease_lapsed)
          throw outcomeUnknown({
            original_status: null,
            committed_at: new Date(row.committed_at).toISOString(),
            path: row.path,
          });
        // IN_PROGRESS on this or another instance (or released a moment ago): wait and look again
        if (Date.now() > deadline)
          throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "An identical request is already being processed");
        await sleep(pause);
        pause = Math.min(pause * 2, 250);
        const late = await cachedResponse(redisKey);
        if (late) return replay(reply, late, hash);
      }
    });

    /** Stops the lease heartbeat and detaches the claim from the request's async context. */
    function release(req: FastifyRequest): void {
      const ctx = req.idempotency;
      if (!ctx) return;
      clearInterval(ctx.heartbeat);
      const store = requestStore();
      if (store?.idempotency === ctx.state) store.idempotency = undefined;
    }

    app.addHook("onSend", async (req, reply, payload) => {
      const ctx = req.idempotency;
      if (!ctx) return payload;
      release(req);
      req.idempotency = undefined;
      try {
        const status = reply.statusCode;
        if (status >= 200 && status < 300) {
          const parsed: unknown = typeof payload === "string" && payload.length > 0 ? JSON.parse(payload) : null;
          // one-time secrets (temporary passwords, bearer links) never reach the store: neither the row nor the Redis copy
          const secrets = req.routeOptions.config.oneTimeSecrets;
          const redacted = secrets?.length ? redactOneTimeSecrets(parsed, secrets) : null;
          // a response that carried no secret this time (e.g. POST /users with an explicit password) is stored and replayed normally
          const body: unknown = redacted && redacted[SECRET_REDACTED_MARKER].length > 0 ? redacted : parsed;
          await storeOutcome(ctx, req, status, body, true);
          return payload;
        }
        if (!ctx.state.autocommitWrite) {
          // nothing committed (checked in the same statement): release the claim so the client may retry with the same key
          const released = await sql`delete from idempotency_keys
            where id = ${ctx.id} and status_code is null and committed_at is null returning 1`;
          if (released.length > 0) return payload;
        }
        // the write committed but this response is an error: never release the key for a re-run
        if (status >= 500) {
          idempotencyOutcomeUnknownTotal.inc();
          await storeOutcome(
            ctx,
            req,
            status,
            { [OUTCOME_UNKNOWN_MARKER]: true, original_status: status, request_id: String(req.id) },
            false,
          );
        } else {
          const parsed: unknown = typeof payload === "string" && payload.length > 0 ? safeJson(payload) : null;
          await storeOutcome(ctx, req, status, parsed, true);
        }
        req.log.warn(
          { status, idempotency_key: ctx.key, outcome: status >= 500 ? "unknown" : "stored" },
          "idempotency: error response after the request committed; the key is kept",
        );
      } catch (err) {
        // the claim stays IN_PROGRESS; when it committed a retry answers IDEMPOTENT_OUTCOME_UNKNOWN once its lease lapses
        req.log.error({ err }, "idempotency: failed to store the response");
      }
      return payload;
    });

    // belt and braces: whatever path the response took, the heartbeat stops with it (a client abort does not stop it: the handler may
    // still be running, and its lease must stay alive until it finishes)
    app.addHook("onResponse", async (req) => release(req));

    async function storeOutcome(
      ctx: NonNullable<FastifyRequest["idempotency"]>,
      req: FastifyRequest,
      status: number,
      body: unknown,
      cache: boolean,
    ): Promise<void> {
      await sql`update idempotency_keys set status_code = ${status}, response_body = ${JSON.stringify(body)}::jsonb, path = ${req.url},
                  lease_expires_at = null
                where id = ${ctx.id} and request_hash = ${ctx.hash}`;
      if (!cache) return;
      const record: StoredResponse = {
        request_hash: ctx.hash,
        status_code: status,
        response_body: body,
        path: req.url,
      };
      await redisTry("set", () => app.redis.set(ctx.redisKey, JSON.stringify(record), "EX", TTL_SECONDS), app.redis);
    }
  },
  { name: "idempotency", dependencies: ["redis", "db", "request-context"] },
);

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

/**
 * Commit marker (audit F3): wraps `app.db.transaction` so that, while the running request holds an idempotency claim, the transaction's
 * last statement sets `committed_at` on the claim — it commits (or rolls back) together with the handler's own writes. A write statement
 * outside any transaction (autocommit) flags the claim too, since it cannot be undone either. Requests without a claim, jobs and tests
 * pay one AsyncLocalStorage lookup per transaction.
 */
export function installCommitMarker(app: FastifyInstance): void {
  try {
    wrapTransactions(app);
  } catch {
    // an offline app (OpenAPI generation) has stub handles that throw on use: nothing to mark there
  }
}

function wrapTransactions(app: FastifyInstance): void {
  const db = app.db as unknown as { transaction?: unknown };
  if (typeof db.transaction !== "function" || MARKED.has(db)) return;
  MARKED.add(db);
  const original = (db.transaction as DB["transaction"]).bind(app.db);
  const wrapped: DB["transaction"] = (fn, txConfig) => {
    const claim = requestStore()?.idempotency;
    // a READ ONLY transaction cannot write (and would fail on the mark with 25006): there is nothing to mark
    if (!claim || txConfig?.accessMode === "read only") return original(fn, txConfig);
    return original(async (tx) => {
      const result = await fn(tx);
      await tx.execute(
        dsql`update idempotency_keys set committed_at = coalesce(committed_at, now()) where id = ${claim.id}`,
      );
      return result;
    }, txConfig).then((result) => {
      claim.committed = true;
      return result;
    });
  };
  (db as { transaction: DB["transaction"] }).transaction = wrapped;
  // autocommit writes: drizzle runs every pooled (non-transaction) statement through `sql.unsafe`
  const client = app.sql as unknown as { unsafe?: (...a: unknown[]) => unknown };
  if (typeof client.unsafe !== "function") return;
  const unsafe = client.unsafe.bind(app.sql) as (...a: unknown[]) => unknown;
  const sql = app.sql;
  client.unsafe = (...args: unknown[]) => {
    const claim = requestStore()?.idempotency;
    if (claim && !claim.autocommitWrite && typeof args[0] === "string" && WRITE_SQL.test(args[0])) {
      claim.autocommitWrite = true;
      // durable too (not only in this process's memory): if the instance dies before it stores the response, a retry after the lease
      // lapsed must answer IDEMPOTENT_OUTCOME_UNKNOWN instead of taking the claim over and writing again. Sent ahead of the write (the
      // query object must be returned as is), on the tagged-template path, which does not come back through this wrapper.
      void sql`update idempotency_keys set committed_at = coalesce(committed_at, now()) where id = ${claim.id}`.catch(
        (err: unknown) => logger.warn({ err: (err as Error).message }, "idempotency: autocommit mark failed"),
      );
    }
    return unsafe(...args);
  };
}

const MARKED = new WeakSet<object>();

declare module "fastify" {
  interface FastifyRequest {
    idempotency?:
      | {
          scopeKey: string;
          key: string;
          hash: string;
          redisKey: string;
          /** idempotency_keys.id of the claim. */
          id: string;
          /** Shared with the request's async store (commit marker). */
          state: IdempotencyClaimState;
          heartbeat: NodeJS.Timeout;
        }
      | undefined;
    subjectId?: string;
    clientIp: string;
  }
}
