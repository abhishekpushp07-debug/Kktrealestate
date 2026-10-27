# Phase 7 — adversarial review of the OPS track (CI, deploy, worker operations, alerting, backups)

Scope: `docs/hardening/phase7-ops.md` and the audit findings it was assigned (A8 supply chain, F9 CI/CD, H6 operations blind spots, H7
deployment, B9 backups, D "restore accepts unsigned archives"). Diff reviewed: `git diff 34c075e` over `.github/**`, `infra/**`,
`docker-compose*.yml`, `apps/*/Dockerfile`, `renovate.json`, `scripts/ci/**`, `apps/api/src/modules/admin/{backup,restore}.ts`,
`apps/api/src/cli/restore.ts`, `docs/{DEPLOY,RESTORE,CAPACITY}.md`. Databases: `kkt_p7_rops` (integration, Redis 26), `kkt_p7_rops_acc`
(acceptance, Redis 27); scratch databases `kkt_p7_rops_smoke`, `kkt_p7_rops_bk`, `kkt_p7_rops_restore_check` were dropped afterwards.
Nothing is committed.

The track's work is broadly sound (I re-ran its CI production smoke, compose renders, k8s validation, the signing tests and a real
encrypted dump + restore drill in both modes). The defects below were found by trying to break it; each one is fixed with a test.

## Defects found and fixed

1. **backup.sh recorded a failed `pg_dump` as a successful backup** (`infra/backup/backup.sh` `dump()`). `dump` runs inside
   `if dump && verify`, where `set -e` is suspended, so the failing `encrypt_from` was ignored: the script logged "pg_dump done",
   wrote a `.sha256` of a missing file and — with `VERIFY_RESTORE=false` — wrote `status: ok` and a fresh
   `kkt_backup_last_success_timestamp_seconds`, so **KktBackupStale could never fire**. Reproduced with a stub `pg_dump` that exits 1.
   Fix: every step of `dump` is checked explicitly (`pg_dump FAILED (dump or encryption)` / `(checksum)` → return 1, partial files
   removed).
2. **A cipher failing at the end of the stream published a truncated, authenticated backup.** `encrypt_file` ran its steps without
   checks in the same `set -e`-suspended context (`… | encrypt_file - out || enc_ok=0`): when `openssl enc`/`age` failed after
   `pg_dump` had already exited 0 (ENOSPC on the last block — the classic backup failure), the function still computed the HMAC over the
   truncated ciphertext, renamed it into place and returned 0. Reproduced (1,000-byte "dump" with a valid `.hmac`, status ok). Base
   backups are never drilled, so a truncated base backup would have gone unnoticed until a PITR. Fix: every step of `encrypt_file`
   returns 1 on failure (cipher, recipient, MAC — `mac_of` is a pipeline whose status is `cut`'s, so the digest is checked to be 64 hex
   characters — and the rename); the partial file is removed first. WAL archiving gets the same guarantee (non-zero exit → Postgres
   retries, nothing archived under the segment name).
3. **`decrypt … -` / `encrypt - …` failed when stdout/stdin is a socket** (`openssl enc -out /dev/stdout` → ENXIO "No such device or
   address"), e.g. the helper commands run from node, systemd or a container runtime with socket stdio. Found by the new test harness.
   Fix: stdin/stdout are openssl's defaults, so they are no longer named.
4. **A failed weekly base backup was silent.** `cycle` logs "pg_basebackup FAILED" and still reports the run as ok — correct for the
   dump, but nothing measured the age of the PITR starting point. Fix: `status.prom` gains
   `kkt_backup_last_base_backup_timestamp_seconds` (newest complete base backup, 0 = none), new alert **KktBaseBackupStale** (> 8 days,
   warning, `component: backup`) with promtool tests, and a `backup.sh base` command to take one on demand (it refreshes the status
   without claiming a dump success). A base backup is now also taken whenever no _complete_ one exists (crashed `.partial` directories
   no longer count), and `.partial` directories older than a day are pruned.
5. **The documented in-image restore could not run** (`apps/api/src/cli/restore.ts`). RESTORE.md / the Dockerfile tell operators to run
   `node dist/cli/restore.js --file … --database-url … --confirm` inside the API image "with the installation's environment", where
   `DATABASE_URL_FILE` is set; the CLI then added `DATABASE_URL` from `--database-url` and the configuration refused to load ("set either
   DATABASE_URL or DATABASE_URL_FILE, not both"). Reproduced with the built CLI. Fix: the CLI only sets `DATABASE_URL` when neither
   variable is present (the restore always connects to `--database-url`). Test: `backup-signing.test.ts` runs the CLI with
   `DATABASE_URL_FILE` and no `DATABASE_URL` (restore path refuses for the archive's reason, `--verify-only` answers 0).
6. **The deploy workflow needed cluster-wide rights it is documented not to have.** `deploy.yml` applied the whole render, including
   the cluster-scoped `Namespace`, while DEPLOY.md prescribes "a deploy service account limited to namespace `kkt`": the server dry run
   and every apply would be refused (`cannot get resource "namespaces" at the cluster scope`). Fix: `namespace.yaml` carries
   `app.kubernetes.io/component: namespace` (created once at bootstrap, as DEPLOY.md already says), every apply in the workflow uses
   `-l app.kubernetes.io/component!=namespace` (the shared-objects apply excludes it too), `validate-k8s.mjs` enforces the label on the
   Namespace (and only there), and DEPLOY.md lists the namespaced Role the service account needs (incl. `pods/exec` for the smoke).
7. **The deploy smoke check would roll back good deployments.** After `kubectl rollout status` the old worker pods may still be
   terminating — draining critical jobs for up to 180 s, with `/health` = 503 — and `kubectl get pods -l app.kubernetes.io/name=worker`
   lists them, so the smoke failed and the automatic `rollout undo` fired. With no worker pod at all the loop passed vacuously; `exec
deploy/api` could also land on a terminating API pod. Fix: the smoke selects pods without a `deletionTimestamp` (go-template), fails
   when there is no running API or worker pod, and says which worker is unhealthy. Static test in `scripts/ci/ci-scripts.test.mjs`.
8. **KktAuditSealFailed paged hourly for 24 h after one transient failure.** `kkt_job_failures_24h{job_name="AUDIT_SEAL"} > 0` stays
   true for a day after a single failed attempt even when the retry or the next run (every 15 min) succeeded; with the critical route's
   `repeat_interval: 1h` that is up to 24 pages for a blip. Fix: page only while there were failures **and** no seal succeeded for 30
   minutes (two scheduled runs), or never succeeded (no success series): `… > 0 unless on (job_name) (time() - max by (job_name)
(kkt_job_last_success_timestamp_seconds{job_name="AUDIT_SEAL"}) <= 1800)`. Tests: blip followed by successes (no page), two missed
   runs (page at 36 min), never succeeded (page). KktAuditSealFailed is also inhibited by KktWorkerHeartbeatStale (no worker explains
   it; one page for the cause).
9. **KktWorkerReplicaDown could not fire for a stopped worker.** `up{job="kkt-worker"} == 0` needs a failing target, but the workers are
   discovered by DNS (Compose) or pod annotations (Kubernetes): a stopped/deleted worker is no target at all. Fix: `count(up == 1) <
max_over_time(count(up)[6h:1m])` (fewer workers answering than in the last 6 h — covers hung and vanished workers; an intentional
   scale-down clears within 6 h). Tests for both cases.
10. **The migration lint missed unnamed constraints and DO blocks** (`scripts/ci/lint-migrations.mjs`). `ALTER TABLE t ADD CHECK (…)`,
    `ADD UNIQUE (…)`, `ADD PRIMARY KEY (…)` passed (they fell into the `ADD COLUMN` branch), `ADD FOREIGN KEY … NOT VALID` was wrongly
    flagged, and anything inside `DO $$ BEGIN … EXCEPTION WHEN duplicate_object … END $$` — the usual idempotent form of a constraint
    add in hand-written `src/sql` files — was never linted. Fix: optional `CONSTRAINT name`; DO-block bodies are expanded (after
    `BEGIN`, `IF … THEN`, `ELSE`) and linted with the block's allow comment. Tests added; the current tree still passes.
11. **The quick start could exhaust Postgres connections.** `docker-compose.yml` has no PgBouncer; the second worker (pool 20) brought
    2 API replicas × 8 cores × 10 + 2 × 20 to 200 = `max_connections`. Fix: the quick-start workers use `DATABASE_POOL_MAX
${WORKER_DATABASE_POOL_MAX:-8}` (176 on an 8-core host); `deploy-config.test.ts` checks the budget (fails with the old value);
    CAPACITY.md §2/§5 corrected ("worker 4" was stale).
12. **gitleaks would very likely have failed CI on public CI/dev values.** The allowlist covered `ci-only-…`/`nightly-only-…`/`dev-only-…`
    as text, but the base64 `FIELD_ENCRYPTION_KEY`s of ci.yml, nightly.yml and the dev default in `config.ts` encode those prefixes (no
    textual match), and `ci-metrics-token-…`, the quick-start example password and the ERP `__tests__` fixtures were not covered. An
    approximation of gitleaks' generic-api-key rule (regex + entropy ≥ 3.5) over the tracked files flags exactly these. Fix: allowlist
    regexes for the base64 prefixes and those two values; `__tests__/` and `*.test.*` paths. (gitleaks itself cannot run here.)
13. Smaller: the CI step that installed age ran `apt-get install` without `apt-get update` (stale index on hosted runners); it now runs the
    new `backup-sh.test.mjs` with age installed, and the backup-image step runs a WAL/encrypt/prune round trip under the image's busybox
    shell. `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` in the setup action; CodeQL job gets `actions: read` (needed on private repositories);
    the test-file headers said `node --test scripts/ci/` (fails on Node 22) — now `scripts/ci/*.test.mjs` like CI.

## Changes (file list)

- `infra/backup/backup.sh` — fixes 1–4 (checked `encrypt_file`/`dump`, stdio defaults, base-backup metric, `base` command,
  `has_base_backup`, `.partial` pruning; portable `find -exec … \;`).
- `scripts/ci/backup-sh.test.mjs` (new, 13 tests) — stubbed PostgreSQL tools on PATH: good cycle (dump and base backup decrypt to the
  originals, no plaintext marker anywhere on disk, status values), failing `pg_dump`, cipher failing at the end (dump and WAL), failed
  base backup, WAL push/fetch/idempotency/conflict, tamper + missing MAC, retention (keep 2, `pg_archivecleanup -x` arguments, crashed
  `.partial` > 1 day removed, fresh one kept), no key / wrong mode, `base`; age cases skip where age is missing. Against the track's
  `backup.sh` 7 of the 13 fail.
- `infra/prometheus/alerts.yml` — KktAuditSealFailed (fix 8), KktWorkerReplicaDown (fix 9), new KktBaseBackupStale (fix 4).
- `infra/prometheus/alerts.test.yml` — seal: 3 groups (blip, two missed runs + stale, never succeeded); replica: hung + vanished;
  base backup: stale + fresh.
- `infra/prometheus/alertmanager.yml` — KktAuditSealFailed in the heartbeat inhibit list.
- `.github/workflows/deploy.yml` — fixes 6, 7 (`NOT_NAMESPACE` selector, `live_pods`).
- `infra/k8s/namespace.yaml` — `app.kubernetes.io/component: namespace`.
- `infra/scripts/validate-k8s.mjs` — the Namespace (and only it) carries that label.
- `.github/workflows/ci.yml` — infra job: `backup-sh.test.mjs` with age; backup image busybox round trip.
- `.github/workflows/codeql.yml` — `actions: read`. `.github/actions/setup/action.yml` — corepack prompt off. `.github/gitleaks.toml`
  — fix 12.
- `scripts/ci/lint-migrations.mjs` — fix 10. `scripts/ci/ci-scripts.test.mjs` — linter tests (unnamed constraints, DO blocks), deploy
  workflow static test, header.
- `apps/api/src/cli/restore.ts` — fix 5. `apps/api/test/integration/backup-signing.test.ts` — CLI with `DATABASE_URL_FILE`.
- `docker-compose.yml` — quick-start worker pool (fix 11). `apps/api/test/unit/deploy-config.test.ts` — connection budget test.
- `docs/DEPLOY.md` (deploy RBAC + Namespace, smoke pod selection, CI infra text), `docs/RESTORE.md` (`base` command, failure semantics,
  base-backup metric/alert, CLI environment), `docs/CAPACITY.md` (worker pools, quick-start budget).

## Tests and validations (this review)

| What                                                                                                                                             | Result                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `node --test scripts/ci/*.test.mjs`                                                                                                              | 29/29 (13 new backup.sh, 2 new lint, 1 deploy workflow), age cases executed (age 1.1.1)              |
| `pnpm --filter @kkt/api typecheck`                                                                                                               | clean                                                                                                |
| API unit (`pnpm --filter @kkt/api test`)                                                                                                         | 181/181 (incl. the new quick-start budget test)                                                      |
| API integration, full (`kkt_p7_rops`, Redis 26, serial, incl. the new CLI test)                                                                  | 788/788 in 64 files (875 s)                                                                          |
| Acceptance (`kkt_p7_rops_acc`, Redis 27)                                                                                                         | 55/55 in 13 files                                                                                    |
| CI production smoke, re-run locally from a private build (API 2 HTTP workers + worker, rings, ports moved)                                       | live/ready/C8 health ok, heartbeat metric, full `/health` ok, metrics, pool 40, both stop on SIGTERM |
| Real `backup.sh once` against a seeded scratch database (dash, real pg_dump/pg_restore), age and openssl                                         | dump 674 KB, drill ok (82 tables, 1 company) in ≈ 2.7 s each; tampered `.enc` → drill FAILED, exit 1 |
| Image busybox round trip, simulated with dash                                                                                                    | ok                                                                                                   |
| `docker compose config -q` (both files, all profiles), no `:latest`, every mounted secret from gen-secrets.sh                                    | ok                                                                                                   |
| `validate-k8s.mjs` (+ negative copy without the Namespace label → 1 error)                                                                       | ok                                                                                                   |
| YAML parse of workflows/compose/k8s/alerts/alertmanager; inhibit rules name only existing alerts; alert-test annotations rendered from the rules | ok (all new/changed expectations match)                                                              |
| prettier `--check` and eslint `--max-warnings 0` on every touched file                                                                           | clean                                                                                                |

Not runnable here (no binaries, no downloads): promtool (the new/changed alert tests were reasoned sample by sample against Prometheus
2.55's closed 5-minute lookback), amtool, kubeconform, kustomize, shellcheck, gitleaks, CodeQL, image builds, the deploy workflow.

## Reviewed and found sound (no change)

- Manifest signing: per-label key derivation (`kkt-backup-manifest-v1` ≠ link tokens), signature checked over the exact bytes before
  parsing, unknown kid / foreign key / unsigned / injected files refused before connecting; duplicate ZIP entry names cannot split
  verification from loading (both use the same entry map). Backup link tokens on the ring with expiry.
- CI: images need every job; SHA-pinned actions (found with version comments in vendored fastify workflows; CodeQL still pending until
  2026-12-31 as reported); audit gate semantics (expiry, unused entries, path matching); load gate parsing.
- Worker C8 assets: probes on 9465, grace 180 s = drain 120 + 60 (the worker's own hard deadline is drain + 30 + 30 = 180 s, so both
  coincide; the clean path ends ≈ 151 s), PDB, RollingUpdate maxUnavailable 0, `/health/live` and `/health/ready` for the API.
- Alertmanager routing (critical → pager with `continue`, copy to Slack), and the track's other promtool tests (re-derived).

## Decisions

- Base-backup staleness is a **warning** at 8 days (weekly schedule + a day), not critical: the nightly dump still bounds the RPO at 24 h.
- KktAuditSealFailed keeps its critical severity but pages only for a _current_ failure (30 min without a successful seal), not for any
  failure in the last 24 h; the 1-hour KktAuditSealStale warning is unchanged.
- KktWorkerReplicaDown compares against the 6-hour maximum instead of a hard-coded replica count (`WORKER_REPLICAS` is configurable).
- Quick-start worker pool 8 rather than lowering the API pool: three concurrent jobs plus their follow-up queries and the health checks
  fit; production compose and Kubernetes go through PgBouncer and keep their pools.
- The deploy workflow skips the Namespace rather than requiring cluster rights; the Namespace and the Secret stay bootstrap steps.

## Not finished / limitations

- The automatic rollback undoes Deployments only; ConfigMap / Service / policy changes applied by the same run stay (expand-only by
  convention). Documented behaviour, not changed.
- Restoring an application export on **another** installation needs the source's `LINK_SIGNING_KEYS` entry in the target's ring (HMAC:
  the verifying key is the signing key). RESTORE.md says to keep the ring; an asymmetric manifest signature would remove the need.
- The worker's own hard-exit deadline equals the 180 s grace period; raising both to ~200 s would let the worker always exit itself.

## Cross-track items

- **docs/OBSERVABILITY.md (platform)**: runbook rows are still missing for KktWorkerHeartbeatStale, KktWorkerReplicaDown (fires on
  fewer answering workers than in the last 6 h), KktDuesBookingFailures, KktClientErrorRateHigh, KktProcessErrors, KktAuditSealFailed
  (pages only while no seal succeeded for 30 min), KktAuditSealStale, KktStorageDeletionGaveUp, KktAlertmanagerNotificationsFailing and
  the new KktBaseBackupStale (`docker compose exec backup sh /opt/kkt/backup.sh base`); the metric catalogue should list
  `kkt_backup_last_base_backup_timestamp_seconds` and `kkt_backup_encrypted` under `kkt_backup_*`; the paging route (critical →
  PagerDuty/Opsgenie + Slack copy) and the `kkt-worker` scrape job.
- **.env.example (owner unclear)**: optionally document `WORKER_DATABASE_POOL_MAX=8` (quick-start worker pool) next to `WORKER_REPLICAS`.
