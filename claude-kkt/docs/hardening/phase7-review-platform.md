# Phase 7 review — PLATFORM track

Adversarial review of the platform track (docs/hardening/phase7-platform.md) and the v3 audit findings it was assigned: A7 worker
robustness (C8), A2/C5/D9 documents outside DB transactions, F3 idempotency, C6 lists, C5 public caching, C2 client errors, health,
F2 OpenAPI, UV_THREADPOOL_SIZE. Diff reviewed: `git diff 34c075e` restricted to the track's files. Databases: `kkt_p7_rplatform`
(integration, Redis 20) and `kkt_p7_rplatform_acc` (acceptance, Redis 21).

Every defect below has a test in `apps/api/test/integration/platform-review-phase7.test.ts` or
`apps/api/test/unit/platform-review-phase7.test.ts`. To prove the tests pin real defects, they were also run against a copy of the API
with the six touched source files restored from HEAD (the track's state, in a scratch copy outside the workspace globs, so no other
agent's checkout was touched): **all 13 new tests fail there and pass on the reviewed code.**

## Defects found and fixed

1. **Failed uploads pinned their Idempotency-Key (F3 × A2, high).** `stageUpload` records the storage key in `storage_pending_objects`
   with an autocommit INSERT before the transaction, and `discardStagedUpload` deletes it again. Under an idempotency claim the commit
   marker's `sql.unsafe` hook took those bookkeeping writes for the request's outcome (`autocommitWrite = true`), so after ANY failure
   once the upload was staged the key was never released: a storage outage (500) answered every retry with **409
   IDEMPOTENT_OUTCOME_UNKNOWN although nothing committed**, and a 4xx raised inside the transaction (entity removed, message not found,
   10-attachment cap, ticket closed under the lock) was stored and replayed for 24 h. All three upload routes (`POST /documents`,
   `POST /cms/media`, `POST /portal/requests/:id/attachments`) are idempotent.
   Fix: `plugins/requestContext.ts` `withoutCommitTracking(fn)` runs `fn` with the claim hidden from the marker; `recordPendingObject`
   (renditions.ts) and the pending-record delete in `discardStagedUpload` (service.ts) run under it (awaited inside the scope — a drizzle
   query executes when awaited, not when built).
2. **Commit marker inside READ ONLY transactions (F3, medium).** The `app.db.transaction` wrapper appended its UPDATE to every
   transaction under a claim, including `{accessMode: "read only"}` ones (money/integrity `onSnapshot`, reached by the idempotent
   `POST /admin/reseed` when the seed returns no integrity report) → 25006 "cannot execute UPDATE in a read-only transaction" → 500.
   Fix: read-only transactions are not marked (they cannot write).
3. **Autocommit writes were "committed" only in process memory (F3, medium).** The track flagged an autocommit write in memory only.
   If the instance died (or failed to store the response) after such a write, the claim kept `committed_at = NULL`, its lease lapsed,
   and a retry with the same key **took the claim over and executed the write again** — exactly the double execution F3 is about.
   Fix: the `sql.unsafe` hook also sets `committed_at` in the database (tagged-template path, which does not re-enter the hook; sent
   ahead of the write because the query object must be returned unchanged). Test: while the handler is still running after its
   autocommit write, the claim already reads committed; after a simulated crash the retry answers 409 IDEMPOTENT_OUTCOME_UNKNOWN and the
   write ran once.
4. **Deterministic rendition keys let a queued orphan deletion destroy live renditions (A2/D9, medium).** Keys were
   `<stem>_thumb.webp` / `<stem>_medium.webp` on every run. Run 1 writes, then fails (its keys stay pending) → an hour later STORAGE_SWEEP
   turns them into `storage_deletions`; if that delete fails once (backoff) and run 2 (retry or the sweep's re-enqueue) succeeds with the
   SAME keys, the due deletion later removes the objects the READY row points at. Fix: `renditionKeys()` adds a per-run nonce
   (`<stem>_thumb_<12 hex>.webp`), and the recording UPDATE only applies to a live row without renditions, so a concurrent loser can never
   overwrite the winner's keys (its own objects stay pending and are swept).
5. **EXPORT_CSV parts were swept from under a live or resumed build (A7/A2, medium).** Part objects are recorded as pending
   (`export-part`) and never referenced by `documents`, so STORAGE_SWEEP treats any part older than an hour as an orphan. A build that was
   interrupted by a deploy and resumed (or that waited in the heavy queue) lost its early parts mid-build → the join failed with ENOENT →
   retry → the checkpoint was useless; and a restarted build re-used the same part keys, so a deletion queued for the old part could delete
   the new one. Fix (exports.ts): part keys carry a per-build nonce kept in the checkpoint (`exportPartKey(company, export, run, n)`);
   `touchExportParts` refreshes the parts' pending records at every page; a resume first refreshes, then requires every part to be both
   still recorded and present, otherwise it restarts under a new nonce.
6. **Cursor values Postgres refuses still reached Postgres (C6/D, low).** `checkCursorValue` accepted `2024-02-30` (V8's Date.parse
   rolls it over), `24:00:00`, year 0, offsets beyond ±15:59, int4 values ≥ 2^31, int8 strings beyond 2^63, enum values the column does
   not have and NUL characters — they answered 400 `VALIDATION_ERROR` (22008/22003/22P02/22021 mapping) instead of the specific
   `INVALID_CURSOR` the task asked for. Fix: strict calendar/clock validation, per-type integer ranges, BigInt range for int8, enum
   membership, NUL rejection (also for non-uuid id columns).
7. **`kkt_idempotency_outcome_unknown_total` was declared and documented but never incremented (observability, low).** Now counted
   when a 5xx after COMMIT is stored as "outcome unknown".

Test-only adjustments for the new key format: `documents.test.ts` (rendition key regex) and `documents-phase7.test.ts` (part keys with
the run nonce; the "no rendition written yet" check now matches the new key shape instead of being vacuous).

## Checked and found sound

- Commit marker: last statement of the handler's transaction, rolls back with it; `withTransactionRetry` re-marks per attempt; the release
  DELETE re-checks `committed_at IS NULL`; 4xx-after-commit replay; lease + heartbeat; takeover only of lapsed, uncommitted claims with the
  same hash; ALS store per request (inner `app.inject` requests get their own store); jobs see no claim.
- Worker: two queues with explicit lock/stall settings, AbortSignal budget + grace, `moveToWait` + `WaitingError` without using an attempt,
  deterministic run ids per (job, attempt) so stall recovery and resumes keep their row and checkpoint, heartbeat-aware JOB_RUN_SWEEP that
  leaves parked runs alone, C8 health/metrics listener, fatal hooks in API, cluster primary and worker. The ops track's k8s probes
  (liveness 8×30 s) do not kill a draining worker.
- Preload: verified empirically that `--import ./dist/telemetry.js` (which imports preload first) sizes the libuv pool before use: with 6
  blocked threadpool operations a 7th still completes under the preload and blocks without it (Node 22 loads the import graph
  synchronously, so no pool thread is started before the preload runs).
- C5 (route-level compression runs after the app-level ETag/cache hooks, so compressed responses keep the body ETag and 304s),
  C2 (strict body, 16 KB limit, per-IP limit, bearer attribution only, URL query stripped), C8, health 503/degraded semantics,
  OpenAPI enrichment (`openapi:check` clean: no breaking, no additive drift against the committed snapshot).

## Not fixed here (other owners) — cross-track items

1. **apps/api/src/plugins/auth.ts** (security): health probes are public routes and consume the per-IP `catalog` rate-limit bucket (and a
   Redis round trip), although loadShed and the OpenAPI document treat them as never limited. Exact change: in the public branch of the
   onRequest hook, before `rateLimit(...)`, add
   `if (/^\/(api\/v1\/)?(health|ready)(\/(live|ready))?$/.test(url)) return;`.
2. **apps/api/src/modules/admin/erase.ts:222** (security): the documents select of an erasure is not `FOR UPDATE`. A DOCUMENT_RENDITIONS
   run that commits its keys between that select and the soft-delete leaves the erased customer's rendition objects out of
   `storage_deletions` (their pending records were cleared by the rendition transaction), so they are never deleted (DPDP). Change: add
   `.for("update")` to that `tx.select({ id, storageKey, variants }).from(documents)…` query (READ COMMITTED then re-reads the committed
   variants after waiting for the rendition transaction).
3. **apps/api/src/modules/web/publicContent.ts:1346** (domain; the platform report's need 5, still open): `GET /public/media/:id?variant=`
   answers the original as a stand-in with `IMMUTABLE_CACHE_CONTROL`, so a CDN can keep the full-size original under the thumb URL for a
   year. Change: `reply.header("Cache-Control", file.fallback ? "public, max-age=60" : IMMUTABLE_CACHE_CONTROL)`.
4. **packages/db** (foundation): `documents.storage_key` has no index. `discardStagedUpload` and both STORAGE_SWEEP queries look objects
   up by it (the sweep with `OR variants->>'thumb_key' / 'medium_key'`), i.e. a sequential scan of `documents` per pending row — fine
   while orphans are rare, minutes per sweep at 5-lakh scale after an outage. Change: an online migration
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_storage_key_idx ON documents (storage_key)`; the sweep can then split the OR into
   three `NOT EXISTS` (or derive rendition stems from the storage key).

## Observations (no change)

- A handler that hangs (no request timeout is configured) keeps its claim's lease alive for up to the 24 h record TTL; retries get
  409 IDEMPOTENCY_IN_PROGRESS meanwhile. Bounding the heartbeat (e.g. 15 min) would trade that for a possible takeover of a stuck request.
- Any committed transaction marks the claim, including one that only read; a 5xx afterwards is then reported as "outcome unknown" though
  nothing was written (conservative, never unsafe). `txid_current_if_assigned()` could make the mark precise if this proves noisy.
- `WORKER_HEAVY_CONCURRENCY` defaults to 1, so a 2-hour BACKUP_EXPORT delays image renditions (the original is served meanwhile).

## Contract shapes (unchanged externally)

No wire contract changed. Internal: `exportPartKey(companyId, exportId, run, n)` (new `run` argument); EXPORT_CSV checkpoint
`{run, cursor, rows, pages}`; rendition keys `<stem>_thumb_<nonce>.webp` / `<stem>_medium_<nonce>.webp`; new exports
`withoutCommitTracking` (plugins/requestContext.ts), `renditionKeys` (documents/renditions.ts), `touchExportParts` (documents/exports.ts).

## Files changed

- apps/api/src/plugins/requestContext.ts — `withoutCommitTracking`.
- apps/api/src/plugins/idempotency.ts — no mark in READ ONLY transactions; durable autocommit mark; outcome-unknown counter.
- apps/api/src/modules/documents/renditions.ts — untracked `recordPendingObject`; nonce rendition keys; guarded recording UPDATE.
- apps/api/src/modules/documents/service.ts — untracked pending-record delete in `discardStagedUpload`.
- apps/api/src/modules/documents/exports.ts — part keys with a build nonce, `touchExportParts`, safe resume.
- apps/api/src/lib/list.ts — stricter `checkCursorValue`.
- docs/API-CONVENTIONS.md (idempotency commit marker, cursors, uploads/renditions), docs/OBSERVABILITY.md (EXPORT_CSV checkpoints).
- Tests: new `test/integration/platform-review-phase7.test.ts` (10), `test/unit/platform-review-phase7.test.ts` (4); updated
  `test/integration/documents.test.ts`, `test/integration/documents-phase7.test.ts`.

## Test results

| Suite                                                                                                                                  | Database / Redis               | Result                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/api integration, full (`--dir test/integration --no-file-parallelism`, 63 files incl. every track's and reviewer's phase-7 files) | kkt_p7_rplatform, Redis 20     | 779/780; the one failure was `documents.test.ts` asserting the old `_thumb.webp` key shape, updated; re-run of documents, documents-phase7, platform-phase7, platform-review-phase7, portal, web: **112/112** |
| new `platform-review-phase7.test.ts`                                                                                                   | kkt_p7_rplatform, Redis 20     | 10/10 (all fail against the track's code)                                                                                                                                                                     |
| apps/api acceptance (13 files)                                                                                                         | kkt_p7_rplatform_acc, Redis 21 | **55/55**                                                                                                                                                                                                     |
| apps/api unit (`--dir test/unit`, incl. new `platform-review-phase7.test.ts`, 4)                                                       | —                              | **180/180** (176 before the new file + 4)                                                                                                                                                                     |
| packages/contracts tests                                                                                                               | —                              | 244/244                                                                                                                                                                                                       |
| `tsc --noEmit` apps/api, packages/contracts                                                                                            | —                              | green                                                                                                                                                                                                         |
| ESLint `--max-warnings 0` apps/api; Prettier on every touched file                                                                     | —                              | clean                                                                                                                                                                                                         |
| `openapi:check`                                                                                                                        | —                              | BREAKING none, Additive none (no route changed; snapshot not regenerated)                                                                                                                                     |

Nothing was installed or downloaded.
