# Phase 7 — security, tenancy & privacy track

Scope: the ten security items of the phase 7 task (v3 audit, docs/AUDIT-80-FACTORS-V3.md groups B, C, D, F, G) and contracts C1, C3,
C4 (sign-in side) and C9. Everything is in the working tree; nothing is committed. Databases: `kkt_p7_s` / Redis 6 (integration),
`kkt_p7_s_acc` / Redis 7 (acceptance).

## Changes (file list)

**apps/api — owned**

- `src/config.ts` (secrets part, targeted edits) — `JWT_SIGNING_KEYS` (`parseJwtSigningKeys`: `<kid>:<base64 PKCS8 DER Ed25519>`),
  `LINK_SIGNING_KEYS`, `HASH_KEYS` (+ `HASH_KEY_RING`, `HASH_KEY` = kid `h1`, now optional when `HASH_KEYS` is set),
  `REFRESH_ABSOLUTE_TTL_DAYS` (30), `READ_RATE_LIMIT_PER_MIN` (1200), `EXPORT_RATE_LIMIT_PER_MIN` (10); `_FILE` variants for the three
  rings and `INTERNAL_API_TOKEN`; `productionSecretProblems` / `placeholderProblem`: in production the rings are required and every secret
  is refused when it is a template value (change-me / changeme / example / placeholder / dev-only, the values of
  `infra/k8s/secret.example.yaml` and `.env.example`), one repeated character, or < 32 bytes (metrics token / S3 secret 16); connection
  URLs with a template password are refused too.
- `src/lib/jwt.ts` — ring from `JWT_SIGNING_KEYS` (real Ed25519 key pairs, kid = the configured id, first signs, all verify, all in JWKS;
  an explicit ring verifies by kid only), derived ring from `JWT_SECRET`/`JWT_PREVIOUS_SECRETS` outside production as before; `rid`
  claim (role id).
- `src/lib/crypto.ts` — keyed-hash ring (`keyedHash` active key, `keyedHashes` every key, `keyedHashMatches`, `activeHashKeyId`);
  link ring (`linkKeyRing`, `linkKeys(label)`, `activeLinkKey`, `signLinkBody` / `verifyLinkBody` = `<kid>.<body>.<sig>`, legacy kid-less
  tokens verified against every key); `signPayload` / `verifyPayload` on the link ring (MFA step tokens, visitor tokens).
- `src/lib/cache.ts` — `bumpAuthVersions(redis, {users, portalUsers, roles, companies})`, `authVersionKey`, `AUTH_VERSION_TTL_SECONDS`;
  `bumpPermVersion` kept for reseed/restore only.
- `src/lib/scope.ts` — `customerScopeCondition(user, customerIdSql)`, `MFA_ADMIN_PERMISSIONS`, `requiresAdminMfa(user)`.
- `src/lib/audit.ts` — `redactForAudit` (PII masking + `<field>_fp` keyed fingerprints) used by `writeAudit`; `maskPhone`, `maskEmail`,
  `maskPanForAudit`, `piiFingerprint`.
- `src/lib/csv.ts` — `auditCsvExport`; `sendCsv` writes the `export.csv` audit row before the first data byte.
- `src/plugins/auth.ts` — contract C3 (`effectiveClientIp`, `validInternalToken`, `publicRouteGroup`, buckets per group), per-subject
  read / export budgets (`isExportRequest`), MFA by permission, scoped auth-cache versions (user/portal + role via `rid` + company).
- `src/modules/auth/cookies.ts` (new) — C1 cookie transport (`kkt_rt` / `kkt_prt`), `refreshTokenOf` (CSRF header guard), `tokenPair`.
- `src/modules/auth/service.ts` — absolute family lifetime (`familyExpiresAt`, `family_started_at` copied on rotation, token expiry capped,
  401 `SESSION_EXPIRED` + family revoked), `loginCompanyId` / `pickLoginAccount` (C4), login events carry the resolved company.
- `src/modules/auth/staff.ts`, `portal.ts` — C1 + C4 on login/refresh/logout, TOTP replay protection (`totpStepOf`, `consumeTotp` on
  `users.totp_last_step`, compare-and-set), scoped cache bumps.
- `src/modules/auth/lockout.ts` — `LockTarget.companyId`. `src/modules/auth/reencrypt.ts` — `rehashIdentifiers` (HASH_KEYS rotation),
  result `hash_kid` / `rehashed`, payload `rehash`.
- `src/modules/users/index.ts`, `src/modules/roles/index.ts` — per-user / per-role version bumps; `/permissions` → deprecated alias of
  `/roles/permissions`.
- `src/modules/crm/customers.ts`, `customerService.ts`, `portalAccess.ts` — customer project scope everywhere (list/CSV, get, reveal,
  PATCH, KYC, co-applicants, 360 sections, deactivate, portal card/actions), duplicate-check masking of out-of-scope matches,
  ring-aware duplicate detection, bulk-enable fix, per-portal-user cache bumps; `/customers/:id/erase` is now a deprecated alias that
  delegates to the admin `eraseCustomer` with the canonical request/response schemas and idempotency.
- `src/modules/audit/index.ts`, `src/modules/audit/seal.ts` (new) — `AUDIT_SEAL` job (per-company hash chain), `GET /admin/audit/verify`,
  login events strictly company-scoped.
- `src/modules/search/index.ts` — the customer branch uses the same scope rule.
- `src/modules/admin/erase.ts` — DPDP scrubs (drafts, notifications, ticket text, prior exports), `storage_deletions` queue, canonical
  route `/admin/customers/:id/erase` (`registerCustomerEraseRoute`).
- `src/modules/admin/tools.ts` — `reconciliationJob` per company (`by_company`), `companyJobResult` applied to every job_runs read.
- `src/modules/documents/entities.ts` (scope rules only) — CUSTOMER documents follow the customer scope.
- `src/seed/bootstrap.ts` — production settings force admin MFA; demo settings set it `false` explicitly.

**packages/contracts — owned + registries**

- `modules/auth.ts` — `CompanySlugSchema`; `StaffLoginSchema.company`; `TokenPairSchema.refresh_token` optional; `RefreshTokenSchema`
  token optional; `PortalAuthLoginSchema`, `PortalAuthRefreshSchema`; `SESSION_MODE_HEADER`, `SESSION_COOKIE_MODE`.
- `modules/admin.ts` — `force_mfa_for_admins` default `true`; `AdminCustomerEraseResponse.anonymised` + `booking_drafts`,
  `notifications`, `service_requests`, `exports_removed`, `storage_deletions_queued` (all default 0); `AuditVerifyResponseSchema`,
  `AuditChainMismatchReasonSchema`.
- `errors.ts` — `SESSION_EXPIRED` (401) (targeted edit). `enums.ts` — `AUDIT_SEAL` in `JOB_NAMES` + label (targeted edits).

**Tests** — new `test/integration/security-phase7.test.ts`, `test/unit/secret-rings.test.ts`; updated `test/unit/config.test.ts`
(production secret set with rings, C9 cases), `test/integration/auth.test.ts` (MFA test walks TOTP steps with a faked Date),
`crm.test.ts` (the old "customers are company-scoped" assertions at :1265-1271 replaced by scope assertions), `admin.test.ts`
(per-company reconciliation, erase response fields, storage queue), `crm-adversarial.test.ts` / `security-hardening.test.ts` (erase alias
answers with the admin response + deprecation headers), `portal.test.ts` (profile audit row masked), `first-boot.test.ts` (production
env carries the rings). `apps/api/vitest.config.ts`: `READ_RATE_LIMIT_PER_MIN` / `EXPORT_RATE_LIMIT_PER_MIN` = 100000 for the suites (like
the existing write/public overrides; the reports suite alone exports > 10 CSVs a minute as one user).

**Docs** — `docs/SECURITY.md` (identities/MFA/tenant/tokens/cookies, customer scope, hash & link rings, audit masking + seal, bulk-read
budgets, erasure, transport, public limits + C3, boot refusal, auth cache, rotation runbooks), `docs/API-CONVENTIONS.md` Appendix A
(C1/C4 request/response shapes).

## Item by item

1. **Admin MFA.** Contract default and production bootstrap `true` (the DB default came from the foundation); the demo seed
   (`DEMO_SETTINGS`) sets `false` explicitly so the published demo logins work. The plugin forces MFA for any role holding
   `settings.manage`, `users.manage`, `roles.manage` or `admin.tools`, or the Super Admin system role (`requiresAdminMfa`); a missing
   setting counts as on. Behaviour change: the system Project Admin role holds none of these and is no longer forced (the old rule matched
   the name). TOTP: the accepted step is stored in `users.totp_last_step` with `UPDATE … WHERE totp_last_step IS NULL OR < step`, so the
   same or an older code fails (login, MFA step, enrol, disable), even for racing requests.
2. **Customer scope.** Rule (lib/scope.ts): booking (primary or co-applicant), lead or site visit in an in-scope project, or created by the
   caller and not linked to any project. Applied as listed above; 404 outside scope (reveal included, so `customer.kyc_view` never
   reaches another project's PAN/Aadhaar/bank); 360 sections additionally scoped (bookings, payments + count, leads via
   `leadScopeCondition`, tickets on in-scope bookings or booking-less). Bulk enable: the raw sub-select now spells `b.project_id in (…)`
   (it rendered `"bookings"."project_id"` against alias `b` → 500 for every scoped user); the same bug class was avoided in the 360 ticket
   filter. Duplicate checks keep finding cross-project duplicates but mask them for scoped callers.
3. **Tenancy.** Staff/portal login resolve the company first (C4 order); ambiguity without a company answers like a wrong password, an
   identifier in more than one company is 400 `COMPANY_REQUIRED`; unknown slug 400 `COMPANY_REQUIRED`. Login events carry the resolved
   company and are listed strictly per company. `reconciliationJob` stores `{companies, by_company: {<id>: {...}}}`; every job_runs read
   (`/admin/jobs`, `/admin/jobs/runs`, `/admin/jobs/runs/:id`, `/admin/system`) shows a tenant only its own slice
   (`companyJobResult`; a result naming another `company_id` is hidden).
4. **Secrets (C9).** As listed. In production the rings are required and placeholders refused at boot. JWT verification by kid; JWKS
   publishes all; link tokens carry the kid; hashes looked up under every key, written under the active one, rehashed by
   `REENCRYPT_FIELDS`. Outside production the rings are derived (JWT from `JWT_SECRET`, links from `JWT_SECRET` with fingerprint kids
   `j<8 hex>`, hashes from `HASH_KEY` as `h1`), so existing dev/test data and links keep working.
5. **Bulk PII / tamper evidence.** `export.csv` audit rows for every sync CSV and the first page of every async export (POST /exports
   already writes `export.create`); reveal rows carry `filters` and `row_count`. Budgets per subject: reads 1200/min, exports 10/min (CSV
   lists incl. `export=CSV`, POST /exports; keyset continuation pages count as reads), 429 + Retry-After. `AUDIT_SEAL` + verify as
   described in SECURITY.md (canonical row text hashed by PostgreSQL, per-company chains, 10-minute lag, advisory lock per company).
6. **Sessions (C1).** Implemented exactly; reuse detection unchanged for both transports (a reused cookie revokes the family and clears
   the cookie).
7. **Auth cache.** Row valid only while `perm:version` + `authv:user|portal:<id>` + `authv:role:<rid>` + `authv:company:<cid>` match;
   rows of a token whose `rid` differs from the row's role (role changed since issue) and tokens without `rid` are served from the
   database, never cached. A failed bump is logged; rows then expire within 30 s; revocation never depended on it (markers + DB).
8. **Public limits (C3).** Groups `auth`, `forms`, `brochure`, `visits`, `files`, `catalog`, each its own per-IP bucket of
   `PUBLIC_RATE_LIMIT_PER_MIN`, plus the route's own limit; `x-kkt-client-ip` honoured only with a valid `x-kkt-internal-token`
   (SHA-256 digests compared in constant time); the forwarded IP becomes `req.clientIp` (rate limits, enquiry rows, audit).
9. **DPDP.** As in SECURITY.md. New audit rows mask phone / e-mail / PAN (`ABCDE****F`) / Aadhaar / account numbers / addresses / DOB with
   `<field>_fp` fingerprints. **Existing audit rows are immutable and were not rewritten** (trigger + privileges by design).
   Erasure: drafts (payload containing the id, phones, e-mail, plaintext PAN/Aadhaar → `{erased: true}`), notifications (customer's own
   withdrawn, staff ones scrubbed), ticket text (subject/description/rating comment, customer messages emptied, staff messages scrubbed,
   customer-uploaded ticket attachments removed with the documents), list export files made before the erasure (FAILED with reason,
   files queued). All storage keys are inserted into `storage_deletions` (reason `CUSTOMER_ERASED`) in the erasure transaction, tried
   right after commit (`done_at` on success, `attempts`/`last_error` on failure) and otherwise left to STORAGE_SWEEP. Undecryptable
   identifiers never fail an erasure. Export retention (7 days) did not need shortening: prior exports are withdrawn at erasure.
10. **Duplicates.** `GET /permissions` → deprecated alias of `GET /roles/permissions` (same handler/body); `POST /customers/:id/erase` →
    deprecated alias that delegates to the one implementation (`eraseCustomer`) with the canonical route's idempotency and schemas
    (`AdminCustomerEraseRequest` → `AdminCustomerEraseResponse`); it stays in the CRM module so a CRM-only build (`KKT_MODULES=crm`)
    keeps it. Both: `deprecated: {since 2026-10-26, sunset 2027-04-24, replacement}` → Deprecation / Sunset / Link
    headers via `lib/routes.ts`, `x-sunset` in OpenAPI.

## Decisions

- **Literal C4 ambiguity rule**: an identifier in several companies answers 400 `COMPANY_REQUIRED` before the password check (as the
  contract says); one match signs in; none answers the generic 401. Lockout counters stay per identifier (across companies).
- **Role version via the `rid` claim** (one Redis MGET per request): without it the role key cannot be known before the row is read.
  Transitional cost: tokens minted before this release (≤ 15 min) read the database.
- **Payload tokens keep their `<payload>.<sig>` shape** (the kid is a signed `_k` field inside): the website honeypot must produce
  tokens indistinguishable from real ones (web-adversarial test), and MFA step tokens/visitor tokens stay format-compatible.
- **Derived link kids are fingerprints**, not positions, so a link keeps naming its key when `JWT_SECRET` moves into
  `JWT_PREVIOUS_SECRETS`.
- **Export budget** counts the first page of keyset exports and POST /exports, not continuation pages, so a large async export is not
  throttled by its own pages.
- **Seal lag 10 minutes**: a row's `created_at` is its transaction's start; sealing younger rows could skip one committing later.
  Verify defines seal k as every row after seal k-1's last row up to its own last row, so a back-dated insert changes the count.
- **`/admin/audit/verify` needs `admin.tools`** (it recomputes the whole chain).
- **Duplicate check across scope** still reports the duplicate (one person must not get two records) but without name/full phone.
- **TOTP test**: the existing MFA test used one code four times; it now advances a faked `Date` by one step per use (server and client
  share the clock in `inject`).

## Tests and results

| Suite                                                                                               | Database / Redis      | Result                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| apps/api typecheck (`tsc --noEmit`), ESLint `--max-warnings 0` and Prettier on every file I touched | —                     | green                                                                                                                                                                                                                                                                                                                                                                          |
| packages/contracts typecheck + tests                                                                | —                     | green, 203/203                                                                                                                                                                                                                                                                                                                                                                 |
| apps/erp, apps/web typecheck                                                                        | —                     | green; **apps/portal red** at `src/api/client.ts:87-91` (C1 made `refresh_token` optional; frontend track, see Needs 9)                                                                                                                                                                                                                                                        |
| apps/api unit (full)                                                                                | kkt_p7_s, Redis 6     | 4 failures, all expected and outside my files: `openapi-compat` (deliberate breaks, snapshot needs `--force`, Needs 6) and 3 × `deploy-config` (compose/k8s lack the C9 rings and use one-character fixture secrets, Needs 5). New: `secret-rings.test.ts` (6), C9 cases in `config.test.ts` (4)                                                                               |
| apps/api integration (full, `--no-file-parallelism`, 51 files)                                      | kkt_p7_s, Redis 6     | 661 tests; the last full run had 2 failures in `crm-adversarial` (alias missing in a CRM-only build) — fixed by moving the alias into the CRM module, then the 8 CRM/admin/security/rbac/conventions files re-run: 120/120. Earlier failures in bootstrap / documents / platform / portal / web-adversarial were fixed and re-run: 175/175                                     |
| new `security-phase7.test.ts`                                                                       | kkt_p7_s, Redis 6     | 27/27 (MFA by permission, TOTP replay, customer scope incl. reveal/docs/360/bulk enable/duplicates, C4 staff + portal + job results, HASH_KEYS rotation + rehash, export audit, read/export 429s, audit seal + verify tamper cases, C1 both audiences incl. CSRF/reuse/absolute lifetime, auth-cache isolation, role version, C3, audit masking, erasure scrubs, deprecations) |
| apps/api acceptance (13 files)                                                                      | kkt_p7_s_acc, Redis 7 | **55/55**                                                                                                                                                                                                                                                                                                                                                                      |

Tests changed because their old assertions encoded the behaviour this task removes: `crm.test.ts` (unscoped customers, replaced),
`auth.test.ts` (one TOTP code reused four times), `admin.test.ts` / `platform.test.ts` (flat reconciliation result), `crm-adversarial`
/ `security-hardening` (alias returned `CustomerRow`), `portal.test.ts` (raw PII in the audit row), `documents.test.ts` (an unscoped
CUSTOMER document visible to a scoped user), `first-boot.test.ts` (production env without rings). Of these, `documents.test.ts`,
`platform.test.ts`, `portal.test.ts` and `apps/api/vitest.config.ts` belong to other tracks: each got one targeted edit of the assertion
(or env line) my change invalidated.

## Needs from other tracks

1. **apps/api/src/app.ts (platform)** — CORS for C1: `credentials: true`; `allowedHeaders` += `X-KKT-Session`, `x-kkt-company`.
2. **apps/api/src/jobs/index.ts (platform)** — `JOB_SCHEDULES` += `{ name: "AUDIT_SEAL", cron: "*/15 * * * *", tz: "Asia/Kolkata" }`
   (exported as `AUDIT_SEAL_SCHEDULE` from `modules/audit/index.ts`); optional `JOB_TIMEOUT_MS.AUDIT_SEAL = 10 * 60_000`. Until then the job
   is registered and runnable via `POST /admin/jobs/AUDIT_SEAL/run` but not scheduled.
3. **Link-signing migration (documents / admin backup / portal files)** — replace the `JWT_SECRET`-derived keys with the ring:
   `documents/files.ts` `signFileToken/verifyFileToken(secret, …)` → `signLinkBody(label, body)` / `verifyLinkBody(label, token)` from
   `lib/crypto.ts` with labels `kkt-export-link-v1` (exports.ts:73) and `kkt-backup-link-v1` (backup.ts:501); `documents/service.ts:294`
   label `kkt-files-v1`; `portal/files.ts:45` label `kkt-portal-files-v2`. Tokens become `<kid>.<body>.<sig>` (≤ 8-char kids keep them
   under find-my-way's 100-char param limit); widen the `FILE_TOKEN_RE`-style shape checks to accept the kid. The legacy compact tokens
   MAC'd raw bytes, so cut over (they live 15 minutes) or keep the old verifier for one release. Then `JWT_SECRET` can be retired in
   production.
4. **apps/api/src/modules/web/publicForms.ts (web/domain)** — the brochure signature check `safeEqual(sig, keyedHash(...).slice(0, 32))`
   should become `keyedHashMatches("brochure:" + nonce + ":" + expRaw, sig, 32)`, so brochure links survive a HASH_KEYS rotation. The
   visitor token already uses the ring through `signPayload`.
5. **Deploy/infra** — add `JWT_SIGNING_KEYS`, `LINK_SIGNING_KEYS`, `HASH_KEYS` (and `_FILE`) to `docker-compose.yml`,
   `docker-compose.prod.yml`, `infra/k8s` (Secret + env), `infra/scripts/gen-secrets.sh` and `.env.example`. A JWT key is
   `<kid>:` followed by the output of `openssl genpkey -algorithm ed25519 -outform DER` piped through `base64 -w0`; link and hash secrets
   are random 32+ bytes. `test/unit/deploy-config.test.ts` fails until then (production boot now refuses without the rings), and its
   fixture values `"j".repeat(96)` / `"h".repeat(64)` are now rejected as placeholders, so the fixtures need real-looking values too.
6. **OpenAPI** — the snapshot must be regenerated with `--force` at integration; deliberate breaks (record in VERSIONING.md "Deliberate
   breaks" + CHANGELOG): `refresh_token` optional in the login/refresh/portal-login responses (C1), `POST /customers/:id/erase` now answers
   `AdminCustomerEraseResponse` (deprecated alias, task item 10). Additive: login `company`, refresh body optional, `SESSION_EXPIRED`,
   `GET /admin/audit/verify`, erase counters, `/permissions` deprecation.
7. **packages/contracts/src/modules/portal.ts (portal track)** — add `company: CompanySlugSchema.optional()` to `PortalLoginSchema` and make
   `PortalRefreshSchema.refresh_token` optional (or re-export `PortalAuthLoginSchema` / `PortalAuthRefreshSchema` from auth.ts, which the
   API uses).
8. **apps/web (web track, C3/C4)** — server-side fetches send `x-kkt-internal-token: INTERNAL_API_TOKEN`, `x-kkt-client-ip: <visitor ip>`
   and `x-kkt-company: KKT_COMPANY_SLUG` when set.
9. **ERP / portal (frontend track)** — **portal typecheck is red until this lands**: `apps/portal/src/api/client.ts:87-91` `setTokens`
   assumes `TokenPair.refresh_token: string`, which contract C1 made optional (`refreshToken = pair.refresh_token ?? null`, and persist it
   only when present / use cookie mode on web). ERP and web typecheck green (the ERP declares its own token type).
   Then: C1: send `X-KKT-Session: cookie` with `credentials: "include"` on login/refresh/logout, stop
   persisting the refresh token (ERP localStorage, portal web storage), refresh with an empty body, treat 401 `SESSION_EXPIRED` like a
   logout; optional company field/slug on the login screens (needed only for multi-company installs, answer to 400 `COMPANY_REQUIRED`);
   ERP: `GET /permissions` → `/roles/permissions`, `POST /customers/:id/erase` → `/admin/customers/:id/erase` (body `{confirm, reason?}`,
   response `AdminCustomerEraseResponse`, the dialog only invalidates queries); handle 429 with Retry-After on lists/exports; MFA
   enrolment prompt for admins when `MFA_REQUIRED` (now default-on in production).
10. **admin/settings.ts (platform/domain)** — optional: when a future setting affects authentication beyond `force_mfa_for_admins`
    (which is read through `loadCompany`, already invalidated), call `bumpAuthVersions(app.redis, { companies: [id] })`.

## Contract shapes for other tracks / frontends

- Login (staff): body `{email, password, mfa_code?, device_name?, company?}`; portal `{phone, password, device_name?, company?}`.
- Response `TokenPair`: `{access_token, refresh_token?, token_type: "Bearer", expires_in, audience}` (no `refresh_token` in cookie mode).
- Refresh: body `{refresh_token?}` or none; cookie `kkt_rt` / `kkt_prt` + header `X-KKT-Session: cookie`; errors 401 `INVALID_TOKEN`,
  `TOKEN_REUSED`, `TOKEN_EXPIRED`, `SESSION_EXPIRED`, `USER_INACTIVE`; 403 `FORBIDDEN` `details.reason = SESSION_HEADER_REQUIRED`.
- `Set-Cookie`: `kkt_rt=<token>; Path=/api/v1/auth; Max-Age=<remaining absolute seconds>; HttpOnly; SameSite=Strict[; Secure]`;
  cleared with `Max-Age=0`.
- `GET /api/v1/admin/audit/verify` → `AuditVerifyResponse {ok, company_id, seals_checked, rows_checked, unsealed_rows|null,
last_sealed_at|null, first_mismatch: null | {seal_id, sealed_at, first_audit_id, last_audit_id, reason: CHAIN_BROKEN|BOUNDARY_MISSING|
ROW_COUNT|HASH_MISMATCH, expected?, actual?}, verified_at}`.
- `AdminCustomerEraseResponse.anonymised` adds `booking_drafts, notifications, service_requests, exports_removed,
storage_deletions_queued` (ints, default 0).
- Job results convention: tenant data under `by_company: {<company id>: {...}}`; reads merge the caller's slice into the top level.
- Audit rows: PII fields masked with `<field>_fp` siblings; `export.csv` rows `{route, file_name, filters, params?, row_count,
async_export}`.
- Env: `JWT_SIGNING_KEYS`, `LINK_SIGNING_KEYS`, `HASH_KEYS` (+ `_FILE`), `REFRESH_ABSOLUTE_TTL_DAYS=30`, `READ_RATE_LIMIT_PER_MIN=1200`,
  `EXPORT_RATE_LIMIT_PER_MIN=10`, `INTERNAL_API_TOKEN` (now also `_FILE`).
