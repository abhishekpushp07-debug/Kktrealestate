# Phase 7 platform report

Scope: the PLATFORM track of phase 7 (v3 audit, docs/AUDIT-80-FACTORS-V3.md): worker robustness (A7, contract C8), documents outside DB
transactions (A2/C5/D9), idempotency (F3), lists (C6/D), public caching (C5), client error reporting (C2), health, OpenAPI (F2).
Everything is in the working tree under /home/user/Kktrealestate/claude-kkt; nothing is committed. Databases used: `kkt_p7_p`
(integration, Redis 8) and `kkt_p7_p_acc` (acceptance, Redis 9).

## Changes (file list)

**apps/api/src**

- `worker.ts` (rewritten) — two consumers: CRITICAL `kkt-jobs` (`WORKER_CRITICAL_CONCURRENCY`, default 2) and HEAVY `kkt-jobs-heavy`
  (`WORKER_HEAVY_CONCURRENCY`, default 1) with explicit `lockDuration` / `stalledInterval` / `maxStalledCount` (`WORKER_SETTINGS`);
  per-attempt AbortSignal; `drain(timeoutMs)`: stop fetching, interrupt heavy jobs (they checkpoint, `job.moveToWait` + `WaitingError`, no
  attempt used), wait up to `WORKER_DRAIN_TIMEOUT_MS` for critical jobs, then interrupt them too, force-close only a handler that ignores
  its signal (exit 1); Redis heartbeat every 15 s (`kkt:worker:heartbeat` + per-process key, gauge
  `kkt_worker_heartbeat_timestamp_seconds`); C8 health listener (`GET /health`, `GET /metrics`) on `WORKER_HEALTH_PORT`; fatal hooks;
  deterministic run ids per (job, attempt) so a resumed attempt keeps its `job_runs` row.
- `jobs/index.ts` — `HEAVY_JOBS`, `queueKindOf`/`queueNameOf`, `WORKER_SETTINGS`, `JobTimeoutError`, `JobInterruptedError`,
  `JobContext.signal | checkpoint | saveCheckpoint`, `runJob` options `signal | jobKey | timeoutMs | abortGraceMs | heartbeatMs`, time
  budget abort + grace (`settleWithin`), `job_runs.heartbeat_at` every 15 s, checkpoint load (`loadCheckpoint`, keyed by queue + job id)
  and clear on OK, interruption parking (`result.interrupted`), `attemptRunId`; `JOB_RUN_SWEEP` also abandons runs whose heartbeat is
  older than 3 minutes (never parked ones); schedules `AUDIT_SEAL` (`*/15`, security track's need #2) and `STORAGE_SWEEP` (`*/10`);
  budgets for AUDIT_SEAL, DOCUMENT_RENDITIONS, STORAGE_SWEEP.
- `jobs/queue.ts` — `queueFor(queue, name)` routes heavy jobs to a sibling heavy queue (closed with its critical queue), used by
  `enqueueJob` (so `app.jobQueue()` callers are unchanged); schedules stay on the critical queue (idempotent by scheduler id).
- `server.ts` — preload first import; `installProcessErrorHandlers` in every HTTP process and the cluster primary (uncaught exception →
  graceful shutdown → exit 1); in-process jobs drain within the HTTP shutdown deadline.
- `preload.ts` (new) — `UV_THREADPOOL_SIZE` (default 16, valid env override) set before the libuv pool is used; imported first by
  `telemetry.ts` (the production `--import`), `server.ts` and `worker.ts`.
- `telemetry.ts` — imports the preload first; `/health/live|ready` not traced.
- `lib/processErrors.ts` (new) — `installProcessErrorHandlers({role, log, shutdown, exit?, deadlineMs?, target?})`, `describeReason`.
- `lib/list.ts` — keyset mode runs no `count(*)`/`EXPLAIN` unless `includeTotal`/`exact`; `meta {total_is_estimate, total_included}`;
  cursors carry their sort (`[v, id, sort]`) and are validated against the sort/id column types → 400 `INVALID_CURSOR`
  (`invalidCursor`, `decodeCursor`, `checkCursorValue`, `encodeCursor` exported); keyset CSV export pages never count
  (`X-Export-Total` omitted there); `ListQueryLike` (hand-built queries may omit `include_total`).
- `lib/routes.ts` — `route({ cachePolicy, bodyLimit })`, `schema.operationId`.
- `lib/metrics.ts` — `kkt_client_errors_total{app}`, `kkt_process_errors_total{kind,role}`, `kkt_worker_heartbeat_timestamp_seconds`,
  `kkt_job_interruptions_total{job_name,reason}`, `kkt_storage_sweep_objects_total{action}`, `kkt_idempotency_outcome_unknown_total`;
  `kkt_jobs_queue_depth` gains a `queue` label (both queues).
- `lib/storage.ts` — `healthKey`, `probeStorage` (real put + head).
- `plugins/requestContext.ts` (rewritten) — per-request AsyncLocalStorage store (`requestStore`, `runWithRequestStore`; re-entered at
  preValidation like @fastify/request-context), contract C5 cache policy (`publicCacheControl`, `bodyEtag`, `etagMatches`).
- `plugins/idempotency.ts` — commit marker (`installCommitMarker`: wraps `app.db.transaction`; last statement of every transaction run
  under a claim sets `committed_at`; autocommit writes through `sql.unsafe` flag the claim), release only when nothing committed, stored
  4xx after commit, 409 `IDEMPOTENT_OUTCOME_UNKNOWN` for a 5xx after commit or a dead committed claim, leases
  (`lease_expires_at`, heartbeat every lease/3), takeover only of lapsed, never-committed claims.
- `plugins/loadShed.ts` — `/health/live`, `/health/ready` never shed.
- `modules/documents/service.ts` — `prepareUpload` (validation + header dimensions, no transaction) → `stageUpload` (pending record,
  then the original) → `insertStagedDocument` (row + pending record cleared, inside the caller's transaction) → `discardStagedUpload`;
  `uploadDocument(app, input, inTx, {before})` runs them and enqueues renditions after COMMIT; `storeBuffer` removed; `renditions` in
  `DocumentRow`; thumb/medium URLs serve the original until renditions exist; `streamDocument` falls back to the original
  (`fallback: true`); document links signed with the LINK_SIGNING_KEYS ring (security track's need #3, documents part).
- `modules/documents/renditions.ts` (new) — `Semaphore`, `imageSlots` (IMAGE_CONCURRENCY), `sharp.concurrency(CPUs / pipelines)`,
  `makeVariants`, `renderDocument`, `renditionsJob` (DOCUMENT_RENDITIONS), `requestRenditions`, `storageSweep` (STORAGE_SWEEP),
  `deletionBackoffMs`, `renditionStatus`, `recordPendingObject` / `clearPendingObjects`.
- `modules/documents/routes.ts` — upload through `uploadDocument` (entity check before the write and again in the transaction); link
  route links the original for an image without renditions; `/files/:token` answers a fallback with `private, no-cache`.
- `modules/documents/exports.ts` — EXPORT_CSV stores each page as a part object (pending-recorded) and checkpoints `{cursor, rows,
pages}` after it; a re-run resumes when every part is still there; parts joined, stored, removed; export links on the ring.
- `modules/documents/files.ts` — `signRingFileToken` / `verifyRingFileToken` (LINK_SIGNING_KEYS ring, ≤ 100 chars).
- `modules/documents/index.ts` — exports; registers DOCUMENT_RENDITIONS and STORAGE_SWEEP.
- `modules/portal/requests.ts`, `modules/web/cms.ts` — ONLY the storeBuffer call sites, now `uploadDocument` (portal: ticket pre-check
  before the storage write, authoritative check under the row lock).
- `modules/system/index.ts` (rewritten health) — `/health` (full report, 503/`degraded`), `/health/live`, `/health/ready` (+ `/ready`),
  `POST /api/v1/client-errors` (C2), enriched `/api/v1/openapi.json`; `resetStorageProbe`, `stripQuery`.
- `modules/system/openapiEnrich.ts` (new), `openapi.ts`, `openapiDiff.ts` — OpenAPI enrichment and the compatibility rules (below).
- `config.ts` (one targeted edit) — `WORKER_HEALTH_PORT` 9465, `WORKER_DRAIN_TIMEOUT_MS` 120000, `WORKER_CRITICAL_CONCURRENCY` 2,
  `WORKER_HEAVY_CONCURRENCY` 1, `UV_THREADPOOL_SIZE` 16, `IMAGE_CONCURRENCY` 2, `IDEMPOTENCY_LEASE_SECONDS` 30,
  `CLIENT_ERROR_RATE_LIMIT_PER_MIN` 30, `HEALTH_WORKER_STALE_SECONDS` 90.

**packages/contracts** — `common.ts` (`ListMetaSchema`, `meta` on `listEnvelope`/`ListEnvelope`, `include_total` on `ListQuerySchema`);
`modules/system.ts` (new: `LivenessResponseSchema`, `ReadinessResponseSchema`, `HealthCheckSchema`, `SystemHealthResponseSchema`,
`WorkerHealthResponseSchema`, `ClientErrorReportSchema`, `ClientErrorAcceptedSchema`, `CLIENT_ERROR_APPS`, `CLIENT_ERROR_LIMITS`) and one
export line in `index.ts`; `modules/documents.ts` (`DocumentRow.renditions`); `errors.ts` (targeted: `INVALID_CURSOR` 400,
`IDEMPOTENT_OUTCOME_UNKNOWN` 409); `enums.ts` (targeted: `DOCUMENT_RENDITIONS`, `STORAGE_SWEEP` + labels).

**docs** — `API-CONVENTIONS.md` (lists/totals/cursors, idempotency semantics, C5 caching, OpenAPI, uploads and renditions, health and
client errors), `OBSERVABILITY.md` (health signals, metric catalogue incl. the money track's `kkt_dues_booking_failures_total`, job worker
section), `openapi/v1.json` (regenerated with `--force`, see below), this report.

**Tests** — new: `test/integration/platform-phase7.test.ts`, `documents-phase7.test.ts`, `worker-phase7.test.ts`,
`test/unit/platform-phase7.test.ts`, `test/unit/openapi-doc.test.ts`. Updated (behaviour changes of this track): `conventions.test.ts`
(envelope `meta`, keyset totals, INVALID_CURSOR, page hint), `platform.test.ts` (lease instead of the 60 s age), `platform-adversarial.test.ts`
(heavy jobs on the heavy queue), `system.test.ts` (health shape), `documents.test.ts` (renditions in a job, `uploadDocument`),
`portal.test.ts` / `portal-adversarial.test.ts` (`uploadDocument` instead of `storeBuffer`, 3 call sites), `fixtures/web.ts` (plays the
renditions job after an image upload), `unit/jobs.test.ts` (schedules), `unit/metrics.test.ts` (queue label).

## Decisions

1. **Commit marker via AsyncLocalStorage + a `db.transaction` wrapper** (not a hook in withTransactionRetry): 150 call sites open
   transactions as `app.db.transaction`, `withTransactionRetry(app.db, …)` or `moneyTransaction(app.db, …)` — all three end in the same
   method, so one wrapper covers them without touching any module. The marker is the transaction's last statement, so it commits or rolls
   back with the handler's writes, and the release DELETE checks `committed_at IS NULL` itself (a COMMIT whose acknowledgement was lost is
   still safe). Writes outside a transaction are caught at the driver (`sql.unsafe`) and also keep the key. Cost for requests without a
   claim: one ALS lookup per transaction.
2. **4xx after a commit is replayed, 5xx after a commit is "outcome unknown"**: a 4xx is a deterministic answer; a 5xx says nothing about
   what the client should see. The 409 tells the client to look the resource up rather than retry with a new key (which would duplicate).
3. **Heavy jobs are interrupted, not waited for**, on shutdown: they move back to `wait` without consuming an attempt and resume from their
   checkpoint under the same `job_runs` row (status stays RUNNING with `result.interrupted`, so no failure alert per deploy; the sweep
   leaves parked rows alone until twice their budget).
4. **A timed-out handler that ignores its signal is given up after 30 s** (the attempt fails and BullMQ retries); it cannot be killed
   in-process. Critical handlers are idempotent and lock-protected; heavy ones resume from checkpoints.
5. **Renditions status lives in `documents.variants` jsonb** (`renditions: PENDING|READY|FAILED`) — no migration needed; the TS type in
   packages/db is cast locally (see Needs). Thumb/medium URLs point at the original's URL until ready (not a fallback stream under the
   rendition's URL), so CDN/immutable caches never keep the original under the rendition address.
6. **Orphans become `storage_deletions` rows in one statement** (`DELETE … RETURNING` → `INSERT`), so the deletion retry/backoff logic is
   one path for erasure, failed uploads and abandoned export parts. Deletions are claimed with `FOR UPDATE SKIP LOCKED` and a 10-minute
   lease; backoff 1 min · 2^attempts capped at a day; rows are never dropped (`deletion_gave_up` counts 10+ failures).
7. **Keyset `total` without `include_total` = rows of the page** (with `meta.total_included = false`) instead of a nullable `total`:
   making `total` nullable would break every typed client; no frontend uses cursor mode today.
8. **Cursors are bound to their sort** (`[v, id, sort]`): the old test accepted a skewed page; now 400 INVALID_CURSOR. Old two-element
   cursors still decode.
9. **Health:** liveness never touches dependencies; readiness = DB + Redis + not draining; the full report's storage probe is a real put +
   head cached 15 s per process; migrations are reported (`checks.migrations`) but do not change the status (the task fixes 503 to
   DB/Redis/storage and `degraded` to the heartbeat).
10. **OpenAPI enrichment is a post-processing pass** (`openapiEnrich.ts`) applied to the snapshot and `/api/v1/openapi.json`, not to each
    route file: it needs no change in the other tracks' route modules. Binary endpoints are listed explicitly (method + path); version
    requirements follow `requiresVersion` (staff PATCH/DELETE) plus the foundation's list of versioned POST actions and any body with a
    `version`. 412 is not documented: this API answers stale versions with 409 (C6).
11. **Document and export links moved to the LINK_SIGNING_KEYS ring** (security track's need #3, the parts in documents/**): the
    derivation of the old keys equals the ring's derived non-production key, so links already issued keep verifying.

## Contract shapes for other tracks and the frontends

- List envelope: `{items, total, page, page_size, next_cursor, meta?: {total_is_estimate: boolean, total_included: boolean}}`; query
  `include_total` (bool, keyset only). 400 `INVALID_CURSOR` `details.issues[0] = {path: "cursor", code: "invalid_cursor"}`.
- 409 `IDEMPOTENT_OUTCOME_UNKNOWN` `details {original_status: number|null, original_request_id?, committed_at?, path, retry_with_new_key:
false, action: "LOOKUP_RESOURCE"}` (header `Idempotent-Replayed: true`). Frontends: refresh the list/resource, never resend with a new key.
- `DocumentRow.renditions: "NONE" | "PENDING" | "READY" | "FAILED"`; `has_variants` true only when READY; thumb/medium URLs are the
  original's while PENDING/FAILED (images).
- C2: `POST /api/v1/client-errors` body `ClientErrorReportSchema` (strict), 202 `{accepted: true}`, 400/413/429.
- C5: `route({ cachePolicy: { public: true, sMaxAge, staleWhileRevalidate } })` (or Fastify route config `cachePolicy`).
- C8: worker `GET /health` → `WorkerHealthResponseSchema` `{status: "ok"|"down", redis, queues: {critical|heavy: {waiting, delayed,
active, consuming}}, last_heartbeat_at}`; Redis key `kkt:worker:heartbeat` = `{at, host, pid, queues, version}`.
- Health: `SystemHealthResponseSchema` (`status` adds `"down"`; `checks` adds `worker`, `migrations`; `details`).
- Jobs: `JobContext.signal?: AbortSignal`, `checkpoint?: Record<string, unknown> | null`, `saveCheckpoint?(cp)`; job names
  `DOCUMENT_RENDITIONS` (heavy, data `{document_id, company_id}`), `STORAGE_SWEEP` (critical, `*/10`).
- Documents API for other modules: `uploadDocument(app, input, inTx, {before?})`, `prepareUpload`, `stageUpload`,
  `insertStagedDocument`, `discardStagedUpload`, `renderDocument`, `requestRenditions`; `signRingFileToken` / `verifyRingFileToken`.

## Needs from other tracks

1. **apps/api/src/app.ts** — (a) security's C1 CORS change is still open there: `credentials: true`, `allowedHeaders` +=
   `X-KKT-Session`, `x-kkt-company`; (b) optional: `swagger({ …, transformObject: ({ openapiObject }) => enrichOpenApi(openapiObject,
app.routeRegistry) })` so `/api/v1/docs/json` (Swagger UI) shows the same enriched document as `/api/v1/openapi.json`.
2. **packages/db/src/schema/json.ts** — `DocumentVariants` += `renditions?: "PENDING" | "READY" | "FAILED" | null` (the documents module
   casts through its own `StoredVariants` until then).
3. **Heavy job handlers (money: LEDGER_REBUILD in modules/money/jobs.ts; admin: BACKUP_EXPORT in modules/admin/backup.ts; auth:
   REENCRYPT_FIELDS in modules/auth/reencrypt.ts)** — use the new context: process in batches ordered by id, start after
   `ctx.checkpoint?.last_id`, call `await ctx.saveCheckpoint?.({ last_id, done })` after each batch and `ctx.signal?.throwIfAborted()`
   before the next. Without it they still get the time budget and are interrupted on shutdown, but restart from the beginning (BACKUP_EXPORT
   builds one ZIP: checkpointing it needs parts like EXPORT_CSV's).
4. **admin/backup.ts and portal/files.ts** — move their link tokens to the ring: `signRingFileToken("kkt-backup-link-v1", id, exp)` /
   `verifyRingFileToken(...)` from `modules/documents/files.ts` (backup); the portal file token is its own format (`signLinkBody`).
5. **web/publicContent.ts (public media, ~line 1308)** — when `streamDocument(...)` returns `fallback: true`, answer
   `Cache-Control: public, max-age=60` instead of the immutable year (rows built by `toDocumentRow` already point at the original URL).
6. **Deploy / infra** — liveness probes to `/api/v1/health/live` (k8s `api.yaml`; `infra/scripts/validate-k8s.mjs` asserts
   `/api/v1/health` today — `/api/v1/health` now answers 503 when a dependency is down and would restart pods); readiness stays
   `/api/v1/ready` (or `/api/v1/health/ready`). Worker: Compose healthcheck `wget -qO- http://127.0.0.1:9465/health` (replace
   `healthcheck: { disable: true }`), k8s worker liveness/readiness `httpGet :9465/health` (replace the `pgrep` probe), Prometheus scrape
   of the worker on 9465 `/metrics`; `terminationGracePeriodSeconds` / `stop_grace_period` of the worker ≥ WORKER_DRAIN_TIMEOUT_MS + 60 s
   (≈ 180 s). Alerts: `time() - max(kkt_worker_heartbeat_timestamp_seconds) > 60` (critical), `increase(kkt_process_errors_total[10m]) > 0`,
   `increase(kkt_dues_booking_failures_total[1d]) > 0`, `increase(kkt_storage_sweep_objects_total{action="deletion_gave_up"}[1d]) > 0`;
   `kkt_jobs_queue_depth` has a `queue` label now (existing `max(...)` / `max by (state)` queries keep working). New env vars in
   `.env.example` / DEPLOY.md: the nine listed under config.ts above.
7. **docs/VERSIONING.md / CHANGELOG** — record the regenerated snapshot's deliberate breaks (all from the security track: `refresh_token`
   optional in login/refresh responses (C1), `POST /customers/:id/erase` now answers `AdminCustomerEraseResponse`).
8. **Frontends** — handle `INVALID_CURSOR` (restart paging), `IDEMPOTENT_OUTCOME_UNKNOWN` (refresh, do not resubmit), show estimated totals
   as "about n" (`meta.total_is_estimate`), show a placeholder while `renditions === "PENDING"`, report errors to `/api/v1/client-errors`
   (the website already does).

## OpenAPI

`docs/openapi/v1.json` regenerated with `--force` (394 paths, 498 operations). The only BREAKING entries (46) are the security track's
deliberate ones (item 7 above); this track adds operationIds (498, unique), components (`ApiError`, `ValidationIssue`, `ListMeta`,
`Version`, three money schemas, four parameters, three headers, thirteen responses incl. 304), error responses on every operation, header parameters
(Idempotency-Key 68, If-Match 138, If-None-Match 228) and media types, all reported as additive/notices by the checker.
`openapi:check` is clean against the new snapshot.

## Tests and results

| Suite                                                                                                                       | Database / Redis      | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| apps/api integration, full (`--dir test/integration --no-file-parallelism`, 58 files incl. the other tracks' phase-7 files) | kkt_p7_p, Redis 8     | **745/745**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| — new `platform-phase7.test.ts`                                                                                             | kkt_p7_p, Redis 8     | 14/14: serialisation failure after COMMIT → 409 IDEMPOTENT_OUTCOME_UNKNOWN (also without Redis), rollback releases the key, 4xx after commit replayed, autocommit write kept, dead committed claim never re-run, slow handler past 2 short leases keeps its claim (concurrent retry waits and replays, one write); keyset pages run no count/EXPLAIN (query log), estimate flag; C5 headers/ETag/304/no-store; C2 accept/log without query/attribution/metric, validation 400/413, per-IP 429; health ok/degraded/down for storage, DB and Redis, live/ready |
| — new `documents-phase7.test.ts`                                                                                            | kkt_p7_p, Redis 8     | 9/9: upload answers PENDING with no storage write while a transaction is open, job enqueued on the heavy queue, job → READY, idempotent; undecodable image → FAILED with the original served; IMAGE_CONCURRENCY bound; failure after the storage write cleans up at once; a crash between write and COMMIT is swept after an hour (object gone, deletion done); committed objects never swept; deletion backoff + attempts; EXPORT_CSV resumes at its checkpoint (every row once, parts removed)                                                             |
| — new `worker-phase7.test.ts`                                                                                               | kkt_p7_p, Redis 8     | 9/9: queues/concurrency/lock settings, heavy job never blocks a critical one, deduplicated schedules with two workers, time budget abort + grace, heartbeat_at, heartbeat-aware sweep, drain checkpoints a heavy job which resumes on the next worker without using an attempt, drain waits for critical jobs, stubborn critical job returned to the queue, C8 health/metrics over HTTP and the API seeing the heartbeat                                                                                                                                     |
| — updated conventions, platform, platform-adversarial, system, documents, portal, portal-adversarial, web fixtures          | kkt_p7_p, Redis 8     | all green in the full run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| apps/api acceptance (13 files)                                                                                              | kkt_p7_p_acc, Redis 9 | **55/55**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| apps/api unit                                                                                                               | —                     | 161/164: new `platform-phase7.test.ts` (11: fatal hooks, preload incl. a spawned `--import` process, cursor validation, C5/C2 helpers, run ids, link ring rotation) and `openapi-doc.test.ts` (6) green; the 3 failures are `deploy-config.test.ts` (production boot needs JWT_SIGNING_KEYS / LINK_SIGNING_KEYS / HASH_KEYS in compose/k8s — the security track's open infra need #5, unchanged by this track)                                                                                                                                               |
| packages/contracts tests                                                                                                    | —                     | 203/203                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tsc --noEmit`: api, contracts, erp, web                                                                                    | —                     | green (portal: 2 pre-existing errors in `src/api/client.ts` from contract C1's optional `refresh_token`, security track's need #9)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ESLint `--max-warnings 0` apps/api (src + test), packages/contracts; Prettier on every touched file                         | —                     | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `openapi:check` against the regenerated snapshot                                                                            | —                     | BREAKING none, Additive none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Nothing was installed or downloaded.

## Not done / follow-ups

- LEDGER_REBUILD, BACKUP_EXPORT and REENCRYPT_FIELDS do not checkpoint yet (handlers belong to other tracks; Needs 3). They run on the
  heavy queue with time budgets and shutdown interruption; on resume they start over.
- The Swagger UI JSON (`/api/v1/docs/json`) is the un-enriched document until app.ts adopts `transformObject` (Needs 1b).
- No Idempotency-Key format/minimum-length check and no key-order canonicalisation of the request hash (audit F3 side notes, not in this
  task's list).
