# Phase 7 — track OPS, CI & DEPLOY

Scope: the ops findings of the v3 audit (docs/AUDIT-80-FACTORS-V3.md: A8 supply chain, F9 CI/CD, H6 operations blind spots, H7 deployment,
B9 backups, D "restore accepts unsigned archives") — CI gates, deploy/rollback, worker operations, paging, encrypted and signed
backups with an executed restore drill, and the contract C9 key rings in every deploy asset. Everything is in the working tree under
/home/user/Kktrealestate/claude-kkt; nothing is committed. Databases: `kkt_p7_o` (integration, Redis 14); scratch databases of the drill
(`kkt_p7_o_src`, `kkt_p7_o_cli`, `kkt_p7_o_dump`, `<test db>_restore*`) and a scratch cluster under `/var/lib/postgresql/kkt_p7_o_pitr`
were removed afterwards. Resume note: the previous attempt had left no ops changes (the WIP checkpoint only carried another track's
`apps/web/Dockerfile` CSP-hook edit, kept), so everything below was done in this run.

## Changes (file list)

**CI (`.github/`, `scripts/ci/`, `renovate.json`)**

- `.github/actions/setup/action.yml` (new) — local composite action: `actions/setup-node` (SHA-pinned) → `corepack enable` (pnpm from
  `packageManager`) → `actions/cache` of the pnpm store (SHA-pinned) → `pnpm install --frozen-lockfile`. Replaces `pnpm/action-setup`.
- `.github/workflows/ci.yml` — every action SHA-pinned; new jobs **supply-chain** (audit gate, pin gate, CI-script tests), **secrets**
  (gitleaks 8.21.2 release binary, checksum-verified, over the pushed/PR commits and the working tree), **migration-lint**; build smoke now
  runs in production mode **with the C9 rings** (generated per run) and starts the **worker** too (C8 `:9465/health` = ok, heartbeat
  metric, API `/health` ok, `/health/live`, `/health/ready`, both stop on SIGTERM); infra job renders compose with `IMAGE_TAG` and fails on
  `:latest`, renders kustomize with a SHA tag and fails on `:latest`, `amtool check-config` with secret-file stand-ins, backup encryption
  round trip (age + openssl, tamper refusal), backup image build; **images** job = plain `docker buildx` (docker-container driver),
  `--sbom=true --provenance=mode=max`, tags `:<git sha>` only (no `:latest`), registry build cache, SPDX SBOM per image (api, erp, web,
  portal, backup) checked and uploaded as an artifact (90 days); images need every other job.
- `.github/workflows/codeql.yml` (new) — CodeQL javascript-typescript, `security-extended`, push/PR/weekly.
- `.github/workflows/deploy.yml` (new) — `workflow_dispatch` (environment staging|production, image tag = full git SHA), GitHub
  environment (required reviewers + `KUBECONFIG_B64` configured in repo settings), checkout at the image commit, image existence check,
  kubectl/kustomize with checksum verification, render with SHA tags (fails on `:latest`/placeholder), server-side dry run, migrate Job
  first (delete old, apply, poll complete/failed), apply, `rollout status` of every Deployment, smoke (API `/health/ready` + full
  `/health` ok, every worker `:9465/health` ok), automatic `kubectl rollout undo --to-revision=<recorded>` of every Deployment the run
  changed, summary before/after.
- `.github/workflows/nightly.yml` — SHA pins + setup action; production-grade secrets (HASH_KEY ≥ 32 bytes, HASH_KEYS, LINK_SIGNING_KEYS,
  generated Ed25519 JWT key: the old values would now be refused at boot); scale seed via `pnpm --filter @kkt/api seed:scale` when that
  script exists (else demo seed, with a notice); **load gate** `scripts/ci/load-gate.mjs` with per-route p95 limits; the website starts
  with `pnpm --filter @kkt/web start` (CSP hook, domain track Needs 1).
- `.github/gitleaks.toml` (new) — default rules; allowlist only CI-only/dev-only values, `CHANGE-ME` templates, test fixtures, docs.
- `scripts/ci/audit-gate.mjs` + `audit-allowlist.json` (new) — `pnpm audit --prod --json` gate: high/critical fail unless allowlisted
  (id + module + optional paths + reason ≥ 20 chars + expiry); expired entries fail; unused entries warn. One entry:
  GHSA-86w9-cpqp-85rv node-forge via `apps__portal>expo>@expo/cli`, expires 2027-01-31 (no patched release exists).
- `scripts/ci/check-action-pins.mjs` + `action-pins-pending.json` (new) — every third-party `uses:` must be `@<40-hex> # vX`; docker
  actions need `@sha256`; pending entries (CodeQL init/analyze) accepted until 2026-12-31, then the gate fails.
- `scripts/ci/lint-migrations.mjs` + `migration-lint-exemptions.json` (new) — rules `index-not-concurrent`, `constraint-not-valid`
  (incl. `ADD COLUMN … REFERENCES`), `unique-without-index`, `alter-column-type`, `set-not-null` (needs a prior validated
  `CHECK (col IS NOT NULL)`, tracked across files); a table created in the same file is "new"; inline
  `-- lint-migrations: allow <rule> — <reason>`; exemptions file holds one entry (0005 `companies.slug SET NOT NULL`, one row per
  tenant). `--base <ref>` lints files added since the ref; `--all` reports (it finds the 0002 blocking DDL the audit cited).
- `scripts/ci/load-gate.mjs` + `load-thresholds.json` (new) — parses the last table of the load-test report; p95 limits per route
  (public cached 100 ms, `/auth/me` 150, lists/details/304 300, `POST /payments` 800), ≤ 1% non-2xx, ≥ 10 scenarios.
- `scripts/ci/ci-scripts.test.mjs` (new) — `node --test` suite for the four scripts (13 tests).
- `renovate.json` (new) — weekly (Mon before 06:00 IST), grouped (Actions, container images, prod/dev non-major npm, OpenTelemetry, AWS
  SDK, Fastify, Expo SDK, React, Drizzle), lockfile maintenance, `helpers:pinGitHubActionDigests` + `docker:pinDigests`, vulnerability
  alerts any time, `sharp` any time, major postgres/redis/node disabled.

**Deploy assets**

- `docker-compose.prod.yml` — images `${KKT_IMAGE_PREFIX:-kkt}-<app>:${IMAGE_TAG:?}` (no `:latest`), `GIT_SHA=IMAGE_TAG`; rings + internal
  tokens as `_FILE` secrets (`jwt_signing_keys`, `link_signing_keys`, `hash_keys`, `internal_api_token`, `web_revalidate_token`);
  `UV_THREADPOOL_SIZE=16`, `WEB_REVALIDATE_URL=http://web:3000/api/revalidate`; API container health check `/api/v1/health/live`;
  **two workers** (`WORKER_REPLICAS`), C8 health check `wget :9465/health`, `WORKER_HEALTH_PORT=9465`, `WORKER_DRAIN_TIMEOUT_MS=120000`,
  `stop_grace_period: 180s`; postgres + backup on the `kkt-backup:16` image, `archive_command=sh /opt/kkt/backup.sh wal-push %p %f`, both
  with `backup_encryption_key`; web gets the token files + `KKT_COMPANY_SLUG`; alertmanager gets `pagerduty_routing_key` /
  `opsgenie_api_key`.
- `docker-compose.yml` (quick start) — required `JWT_SIGNING_KEYS` / `LINK_SIGNING_KEYS` / `HASH_KEYS` (with generation commands in the
  header), optional internal/revalidate tokens, `UV_THREADPOOL_SIZE`, two workers with the C8 health check and 180 s grace.
- `apps/api/Dockerfile` — `UV_THREADPOOL_SIZE=16`, `WORKER_HEALTH_PORT=9465`, `WORKER_DRAIN_TIMEOUT_MS=120000`, `EXPOSE 9465`, HEALTHCHECK
  `/api/v1/health/live`, restore CLI usage line. `apps/web/Dockerfile` — `kkt-file-env` entrypoint (`INTERNAL_API_TOKEN_FILE`,
  `WEB_REVALIDATE_TOKEN_FILE` → variables), the CSP-hook CMD of the other track kept.
- `infra/backup/Dockerfile` (new) — `postgres:16-alpine` + `age` + `openssl`, `backup.sh` baked in.
- `infra/backup/backup.sh` — rewritten: encryption (age identity → `.age`; any other ≥ 32-char key → AES-256-CTR/PBKDF2 + HMAC-SHA256
  sidecar `.enc` + `.hmac`, verified before decrypting; `BACKUP_ENCRYPTION=none` explicit dev opt-out, else refuses without a key);
  streaming encrypted dump (no plaintext on disk, pipeline exit codes checked without `pipefail`), drill decrypts on the fly (scratch name
  `RESTORE_CHECK_DB`), encrypted base backup as one tar with fetched WAL (`-D - -Ft -X fetch | gzip | encrypt`), `WAL_START` from the
  archived `.backup.age` (waits up to 60 s), retention with `pg_archivecleanup -x <ext>` + sidecar cleanup, without `ls` loops;
  commands `once | drill | prune | wal-push | wal-fetch | encrypt | decrypt`; logs on stderr; `kkt_backup_encrypted` gauge.
- `infra/k8s/*` — workloads reference bare `kkt-*` images; `kustomization.yaml` newTag placeholder `set-by-deploy-workflow`; api probes
  startup/liveness `/api/v1/health/live`, readiness `/api/v1/health/ready`; **worker.yaml** rewritten: 2 replicas, RollingUpdate
  maxUnavailable 0 / maxSurge 1, port `health` 9465, startup/readiness/liveness `httpGet /health` (liveness 8 × 30 s > grace),
  `terminationGracePeriodSeconds: 180`, prometheus annotations on 9465, topology spread, PDB `minAvailable: 1`; ring/token `_FILE` env on
  api, worker, migrate; web mounts only its two token keys; ConfigMap `UV_THREADPOOL_SIZE`, `WORKER_HEALTH_PORT`,
  `WORKER_DRAIN_TIMEOUT_MS`, `WEB_REVALIDATE_URL`; secret template gains the rings and tokens (with generation commands); network
  policies `allow-api-to-web-revalidate`, `allow-worker-metrics-scrape`.
- `infra/scripts/validate-k8s.mjs` — new checks: api probe paths, no tags on kkt images / every kkt image listed in kustomize / no
  `:latest`, third-party images tagged, worker ≥ 2 replicas + probes on 9465 + grace ≥ drain + 30 s + liveness window > grace + PDB,
  C9 ring `_FILE` env on api/worker/migrate.
- `infra/scripts/gen-secrets.sh` — `jwt_signing_keys` (`j1:` Ed25519 PKCS8 via openssl), `link_signing_keys` (`l1:`), `hash_keys`
  (`h1:<hash_key>`), `internal_api_token`, `web_revalidate_token`, `backup_encryption_key` (age identity if `age-keygen` exists, else 32
  random bytes hex), `pagerduty_routing_key` / `opsgenie_api_key` placeholders.
- `.env.example` — rings with generation commands, `REFRESH_ABSOLUTE_TTL_DAYS`, `WEB_REVALIDATE_URL/TOKEN`, `UV_THREADPOOL_SIZE`,
  `WORKER_HEALTH_PORT`, `WORKER_DRAIN_TIMEOUT_MS`, deployment block (`IMAGE_TAG`, `KKT_IMAGE_PREFIX`, `WORKER_REPLICAS`,
  `KKT_COMPANY_SLUG`), `_FILE` list extended.

**Alerting (`infra/prometheus/`)**

- `alertmanager.yml` — `severity=critical` → receiver `pager` (PagerDuty Events v2, `routing_key_file`; Opsgenie block with
  `api_key_file` commented in) with `continue: true` then also Slack; everything else → `slack` (`api_url_file`); inhibit rules: ApiDown →
  component api; 5xx critical → 5xx warning; disk critical → disk low / fill; WorkerHeartbeatStale → replica down, backlog, daily-job
  stale, seal stale, integrity stale; AuditSealFailed → JobFailed (same job_name); Db/Redis down → api/jobs/money/frontend warnings.
- `alerts.yml` — new: `KktWorkerHeartbeatStale` (critical: `time() - max(heartbeat) > 60 or absent(heartbeat)`, 2 m),
  `KktWorkerReplicaDown`, `KktDuesBookingFailures` (increase over 1 d, plus first-appearance branch `x unless x offset 1d`),
  `KktClientErrorRateHigh` (> 10/min per app, 10 m), `KktProcessErrors`, `KktAuditSealFailed` (critical), `KktAuditSealStale` (> 1 h),
  `KktStorageDeletionGaveUp`, `KktAlertmanagerNotificationsFailing`; backlog description updated for two workers.
- `alerts.test.yml` — 10 new test groups (every new alert; series sampled every minute; annotations rendered from alerts.yml and
  cross-checked by script: 35 annotations, 0 mismatches).
- `prometheus.yml` — scrape jobs `kkt-worker` (dns `worker:9465`, metrics token) and `alertmanager`.

**Application backup export (`apps/api`)**

- `src/modules/admin/backup.ts` — format `kkt-backup/3`; `manifest.sig` = `{format: "kkt-backup-sig/1", alg: "HMAC-SHA256", kid,
manifest_sha256, signature}` over the exact manifest bytes with the active `LINK_SIGNING_KEYS` key (family `kkt-backup-manifest-v1`);
  exports `signBackupManifest`, `verifyBackupManifest`, `BACKUP_SIGNATURE_FILE`, `BACKUP_SIGNATURE_FORMAT`, `BACKUP_MANIFEST_LABEL`,
  `BACKUP_LINK_LABEL`; backup download tokens moved to the ring (`<kid>.<body>.<sig>` via `signLinkBody`/`verifyLinkBody`, legacy compact
  tokens still verify) — security track Needs 3 for backups done; RESTORE.md text in the archive updated.
- `src/modules/admin/restore.ts` — `verifyBackupArchive(file)` (+ internal `verifyOpenArchive`): signature first (missing / malformed /
  unknown kid / mismatch refused), then format, checksums, and no file outside the signed manifest; `RestoreResult.signed_by`.
- `src/cli/restore.ts` — `--verify-only`, `signed_by` in the summary, usage for the image (`node dist/cli/restore.js`).
- `src/config.ts` — one targeted edit: `WEB_REVALIDATE_TOKEN` added to `SECRET_FILE_VARS` (so Compose/k8s pass it as a file).

**Docs** — `docs/DEPLOY.md` (quick start rings, prod `.env` with `IMAGE_TAG`, encrypted backups, two workers + C8, paging, k8s probes /
worker / policies / web secrets, new sections "Deploying and rolling back", "CI gates", "Secrets and key rotation", worker env table,
backup signing), `docs/RESTORE.md` (Encryption section, encrypted procedures for dump/PITR, signed application archives, executed drill
table), `docs/CAPACITY.md` (two workers, pool formula, nightly gate).

**Tests touched outside my list (targeted edits, all about files this track owns or the registry it changed):**
`apps/api/test/unit/deploy-config.test.ts` (fixtures: real-looking secrets + rings, `IMAGE_TAG`; new assertions — see Tests),
`apps/api/test/integration/admin.test.ts` (archive now has `manifest.sig`, format `kkt-backup/3`: 2 lines),
`apps/api/test/unit/config.test.ts` (`WEB_REVALIDATE_TOKEN` in the `SECRET_FILE_VARS` list: 1 line).

## Tests and validations

| What                                                                                                                                           | Where                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API unit (full)                                                                                                                                | —                             | **169/169** (was 161/164 with the 3 deploy-config failures the security/domain/money reports listed)                                                                                                                                                                                                                                                                                                                                            |
| `deploy-config.test.ts`                                                                                                                        | —                             | 12/12: quick start boots with rings, refuses without each ring; worker C8 check/replicas/grace; prod rings + tokens + UV + revalidate URL from gen-secrets files; images = `IMAGE_TAG`, no `:latest`, `KKT_IMAGE_PREFIX`, refuses without `IMAGE_TAG`; two workers + 9465 + grace ≥ drain + 30; API health check live; postgres `wal-push` + encryption key on postgres/backup; k8s boots with rings, worker port/UV; `validate-k8s.mjs` passes |
| new `test/integration/backup-signing.test.ts`                                                                                                  | kkt_p7_o, Redis 14            | 7/7: manifest.sig over exact bytes with the active key; unsigned + legacy `kkt-backup/2` + garbage sig refused before connecting; edited manifest with recomputed checksums refused (signature) and file-only edit refused (checksum); foreign signature and unknown kid refused; injected file refused; CLI `--verify-only` exit 0 / 1 with reason; ring link tokens, expiry, forgery, legacy compact token                                    |
| backup-restore, admin, admin-adversarial, platform-adversarial                                                                                 | kkt_p7_o, Redis 14            | 44/44 (full API backup → restore round trip incl. CLI with `--allow-stripped`)                                                                                                                                                                                                                                                                                                                                                                  |
| `node --test scripts/ci/*.test.mjs`                                                                                                            | —                             | 13/13                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm audit --prod` gate (live)                                                                                                                | network                       | 0 failures, 1 allowlisted (node-forge); with `--today 2027-02-01` it fails on the expired entry                                                                                                                                                                                                                                                                                                                                                 |
| `check-action-pins.mjs`                                                                                                                        | —                             | 42 references, 0 problems, 2 pending (CodeQL)                                                                                                                                                                                                                                                                                                                                                                                                   |
| `lint-migrations.mjs` on 0005 drizzle + online + 0006_money_guards                                                                             | —                             | 0 problems (0005 SET NOT NULL exempted with reason); `--all` reports the 0002/0004 blocking DDL                                                                                                                                                                                                                                                                                                                                                 |
| `docker compose config -q` (both files, every profile), no `:latest`, all secrets generated                                                    | docker CLI (no daemon needed) | ok                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `validate-k8s.mjs`                                                                                                                             | —                             | 31 objects in 13 files OK; negative copy (latest tag, 1 replica, 130 s grace, old probes, missing ring) → 7 errors                                                                                                                                                                                                                                                                                                                              |
| YAML parse of workflows, compose, k8s, alert rules/tests, alertmanager (receivers, inhibit alert names)                                        | node `yaml`                   | ok                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `backup.sh` (dash): age + openssl cycles, tamper / wrong key / no key, WAL push idempotency + conflict, fetch, prune with `-x` + sidecars      | local PG 16                   | all as expected (RESTORE.md "Drills")                                                                                                                                                                                                                                                                                                                                                                                                           |
| Restore drill (dump + roles script; PITR from encrypted base + WAL; app export → CLI)                                                          | local PG 16                   | identical row counts (82 tables, 2,720 rows), integrity 0 findings on both restores, PITR = `{1,2,3}` (RESTORE.md table)                                                                                                                                                                                                                                                                                                                        |
| Production config of the CI smoke and the nightly secrets                                                                                      | tsx `loadConfig`              | both boot (rings, ≥ 32-byte secrets)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm --filter @kkt/api typecheck`; eslint `--max-warnings 0` on touched API files, `scripts/`, `infra/`; prettier check on every touched file | —                             | clean                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Not runnable here (no binaries, no internet download allowed): `promtool check/test rules`, `amtool check-config`, `kubeconform`,
`kustomize build`, `shellcheck`, `gitleaks`, CodeQL, the image builds/SBOM, and the deploy workflow itself. They run in CI; see "For the
verify stage".

## Decisions

1. **Encryption = age, openssl fallback without GCM.** `openssl enc` refuses AEAD ciphers, so "AES-256-GCM via openssl" is not possible
   in a streaming shell pipeline. age (authenticated, streaming, in Alpine) is the default via a small `kkt-backup:16` image used for
   both postgres (WAL) and backup; the fallback is encrypt-then-MAC (AES-256-CTR + PBKDF2, HMAC-SHA256 sidecar checked before any byte is
   decrypted). The mode follows the key file's content. No key → refuse (explicit `BACKUP_ENCRYPTION=none` only).
2. **No plaintext on disk**: dump and base backup stream through the cipher; pipeline failures are caught with rc files (POSIX sh has no
   pipefail). The base backup is one tar with `-X fetch` (self-contained) instead of base + pg_wal tars.
3. **Manifest signing with the LINK_SIGNING_KEYS ring** (key family `kkt-backup-manifest-v1`) instead of a new `BACKUP_SIGNING_KEY`: no
   new secret to distribute, rotation follows the ring (kid in `manifest.sig`). Restore refuses unsigned archives outright — no
   `--allow-unsigned`: application backups expire from storage after 24 h, so no legacy archive needs it. Files not listed in the signed
   manifest are refused too.
4. **Worker liveness on `/health` with a 4-minute failure window**: `/health` is 503 while draining, so a short window would kill a
   draining worker; 8 × 30 s > the 180 s grace. Readiness and startup use the same endpoint.
5. **Worker RollingUpdate, maxUnavailable 0** (was Recreate): with two replicas a rollout never stops consumption; mixed versions for a
   short time are as safe as for the API (expand-only migrations, BullMQ jobs are per-name handlers).
6. **Heartbeat alert includes `absent()`**: the gauge lives only on the worker's own `/metrics`, so "all workers dead" would otherwise
   make the series disappear and the alert go silent.
7. **Counter alerts with a first-appearance branch** (`x unless x offset <window>`): prom-client emits a labelled counter only after its
   first increment, so `increase()` alone misses the first DAILY_DUES failure / process error / gave-up deletion.
8. **No third-party build/login/buildx/SBOM actions**: plain `docker buildx` + BuildKit's SBOM generator removes four unpinnable actions;
   only checkout/setup-node/cache/upload-artifact remain, pinned to SHAs that appear (with version comments) in workflows vendored in
   `node_modules` (fastify packages, expo-modules-macros); `pnpm/action-setup` replaced by corepack.
9. **CI image tags = git SHA only**, no `:latest` push; compose prod requires `IMAGE_TAG`; k8s manifests carry no tag and an unpullable
   kustomize placeholder.
10. **Deploy rollback undoes only the Deployments this run changed**, to the recorded revision (blind `rollout undo` of unchanged ones
    would roll them back a version).
11. **Migration lint scope**: new files only (vs PR base / previous push); old files predate the rules. Exemptions file for files this
    track cannot annotate (foundation's 0005).
12. **Load thresholds** calibrated from the 200-connection run (lists ≈ 160–330 ms there, nightly uses 50/10 connections): lists 300 ms
    (SPEC), cached public 100 ms, `/auth/me` 150 ms, payments 800 ms.

## Not finished / for the verify stage

- **Action SHAs**: pinned from SHAs found in the repo (`node_modules` workflows), with their comments — verify they are the official
  tags: `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0`, `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 #
v7.0.0`, `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0`, `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
  # v7.0.2`. **Still tag-pinned** (listed in `scripts/ci/action-pins-pending.json`, gate fails after 2026-12-31):
  `github/codeql-action/init@v3`, `github/codeql-action/analyze@v3` — pin to the v3 release SHA and delete the entries.
- Run in CI / a networked box: `promtool test rules infra/prometheus/alerts.test.yml` (10 new groups, reasoned sample by sample but not
  executed), `amtool check-config` (assumes Alertmanager 0.27 supports `routing_key_file` for PagerDuty and `api_key_file` for Opsgenie),
  `shellcheck -s sh -S warning infra/backup/backup.sh`, gitleaks 8.21.2 (`gitleaks git` / `gitleaks dir` subcommands, release asset and
  checksum file names), kubeconform on the rendered manifests, the buildx SBOM paths (pushed: `imagetools inspect --format '{{ json .SBOM
}}'`; PR: `sbom*.json` written by the local exporter), Renovate config validation (`renovate-config-validator`).
- The scale seed (`seed:scale`) is the verify stage's; the nightly picks it up automatically.
- GitHub settings that cannot live in files: environments `staging`/`production` with required reviewers and `KUBECONFIG_B64`; branch
  protection requiring the CI and CodeQL checks.
- The Compose wrappers of the restore procedures were not executed (no Docker daemon); the same commands ran directly against PG 16.

## Needs from other tracks

1. **docs/OBSERVABILITY.md (platform)** — runbook rows for the new alerts (`KktWorkerHeartbeatStale`, `KktWorkerReplicaDown`,
   `KktDuesBookingFailures`, `KktClientErrorRateHigh`, `KktProcessErrors`, `KktAuditSealFailed`, `KktAuditSealStale`,
   `KktStorageDeletionGaveUp`, `KktAlertmanagerNotificationsFailing`), the paging route (critical → PagerDuty/Opsgenie + Slack copy,
   warnings → Slack) and the `kkt-worker` scrape job; `kkt_backup_encrypted` in the metric catalogue.
2. **apps/api/src/jobs/index.ts (platform)** — `AUDIT_SEAL` in `JOB_SCHEDULES` (security Needs 2) if not done yet: `KktAuditSealStale`
   fires an hour after the last successful seal.
3. **apps/api/src/modules/admin/index.ts (admin owner)** — optional re-exports of `verifyBackupArchive`, `signBackupManifest`,
   `verifyBackupManifest`, `BACKUP_SIGNATURE_FILE` (tests import them from `backup.ts` / `restore.ts` directly today).
4. **packages/db (foundation)** — optional: put `-- lint-migrations: allow set-not-null — companies holds one row per tenant` before the
   `companies.slug SET NOT NULL` in `drizzle/0005_online_foundation.sql` and drop the exemption entry; future migrations must pass
   `scripts/ci/lint-migrations.mjs`.
5. **ERP (frontend)** — nothing required: the backup list/link wire shapes are unchanged; archives downloaded from the ERP are now
   `kkt-backup/3` with `manifest.sig`.

## Contract shapes (for other tracks / frontends)

- Worker (C8, unchanged, consumed here): `GET :9465/health` 200/503 `{status, redis, queues, last_heartbeat_at}`; probes and compose
  health checks use it; Prometheus job `kkt-worker`.
- API probes: liveness `/api/v1/health/live`, readiness `/api/v1/health/ready`, full report `/api/v1/health` (dashboards / deploy smoke).
- Backup archive `kkt-backup/3`: entries `tables/*.ndjson`, `manifest.json`, `manifest.sig`, `RESTORE.md`. `manifest.sig` =
  `{"format":"kkt-backup-sig/1","alg":"HMAC-SHA256","kid":"<LINK_SIGNING_KEYS kid>","manifest_sha256":"<hex>","signature":"<base64url
HMAC-SHA256(key(kkt-backup-manifest-v1, kid), manifest.json bytes)>"}`. `RestoreResult.signed_by: string`. CLI:
  `restore --file <zip> --verify-only` → `{ok, format, signed_by, generated_at, company, tables, rows, files_verified}`; full restore
  summary adds `signed_by`.
- Backup download token: `<kid>.<base64url(id 16 B ‖ exp 6 B)>.<base64url HMAC 16 B>` (≤ 100 chars); legacy compact tokens verify.
- Env/secrets: `IMAGE_TAG` (compose prod, required), `KKT_IMAGE_PREFIX`, `WORKER_REPLICAS`, `BACKUP_ENCRYPTION_KEY_FILE`,
  `BACKUP_ENCRYPTION` (`auto|age|openssl|none`), `RESTORE_CHECK_DB`; `WEB_REVALIDATE_TOKEN_FILE` now accepted by the API; the web image
  reads `INTERNAL_API_TOKEN_FILE` / `WEB_REVALIDATE_TOKEN_FILE`.
