# Phase 7 review — SECURITY track

Adversarial review of the security track (docs/hardening/phase7-security.md) and the audit findings it was assigned (v3 groups B, C, D,
F, G: admin MFA + TOTP replay, customer project scope, tenancy of sign-ins and job results, secret rings (C9), bulk-read audit and
budgets + audit hash chain, cookie sessions (C1), scoped auth-cache versions, public rate-limit groups (C3), DPDP erasure + audit PII
masking, duplicate routes). Diff reviewed: `git diff 34c075e` over the track's files, plus the call sites they serve (export job, list
hooks, job results of every registered job, ERP/portal session clients). Databases `kkt_p7_rsecurity` / `kkt_p7_rsecurity_acc`, Redis 18 / 19.

## Verdict

Most of the track holds under attack: TOTP steps are consumed with a compare-and-set (replays and races fail), MFA is decided by
permissions, the customer scope rule is applied consistently (list/CSV, get, reveal, PATCH, KYC, co-applicants, 360 sections, portal
card and bulk enable, search, CUSTOMER documents), the C1 cookie transport, CSRF guard, absolute family lifetime and reuse detection are
correct, the JWT/link/hash rings verify by kid and boot refuses placeholders in production, the auth cache keys are sound against the
read-version/write-row race, and the reported test counts reproduce (security-phase7: 27/27 on my databases before any change). Five
real defects survived the track, two of them reopening the very audit findings the track closed; all are fixed below, each with a test
that fails on the track's code (verified by running the new test file against a copy of the API with the track's versions of the five
files: 7 of 8 tests fail there, the 8th is a guard that the 401 path still clears the cookie).

## Defects found and fixed

1. **Bulk-read audit and export budget bypassed with `X-Export-Cursor` (audit D "bulk PII reads leave no trail", reopened).** The
   keyset paging header of the EXPORT_CSV job was honoured for every request. Any staff token could send `X-Export-Cursor: start`
   (audited once as an "async" page), take `X-Export-Next-Cursor` and page the whole table 5 000 rows at a time: continuation pages
   wrote **no** audit row (`lib/csv.ts` skips them) and counted only against the 1 200/min read budget, not the 10/min export budget
   (`isExportRequest`) — the exact scrape the audit described, up to ~6 M rows a minute, invisible in the log. Fix
   (`plugins/auth.ts`): `isInProcessRequest(req)` (no network socket — only `app.inject`, i.e. the export job and the POST /exports
   preflight, can produce one); the header is deleted from network requests in the first `onRequest` hook, before the list hooks read
   it, so such a request is an ordinary capped, audited, export-budgeted CSV. The job's own in-process pages no longer spend any budget
   (POST /exports already did; previously the job's first page was counted a second time and could 429 its own export).
2. **Job results leaked tenant data across companies (audit B, same class as the reconciliation finding).** `companyJobResult` only
   understood `by_company` and `company_id`; every other result was shown whole to every tenant admin. DAILY_DUES / DUES_CATCHUP store
   `{<company id>: {demand_numbers, failures: [{booking_number, …}]}}` and NIGHTLY_INTEGRITY `{<company id>: {counts…}}` at the top
   level, HOLD_EXPIRY `flat_numbers` and LEDGER_REBUILD `failed / order_changed` booking lists across companies — all readable by any
   tenant via `/admin/jobs`, `/admin/jobs/runs[/:id]` and `/admin/system`. Fix (`admin/tools.ts`): a `JobResultViewer {companyId,
soleTenant}` (one indexed query); results naming a `company_id` go to that company only; per-company entries (`by_company` or top-level
   keys that are company ids) only to their own company; any other object/array of a cross-company run only when the installation has a
   single company (counters stay visible). Single-company installs see exactly what they saw before.
3. **A transient refresh failure signed the browser user out.** Both refresh routes cleared the `kkt_rt` / `kkt_prt` cookie on _any_
   error — a 409 lock timeout, a 503 overload or a database blip removed the HttpOnly cookie, so the next refresh had nothing to present
   and the user was logged out. Fix (`auth/cookies.ts isDeadSession`, `auth/staff.ts`, `auth/portal.ts`): the cookie is cleared only for a
   401 (invalid, reused, expired, session expired, inactive).
4. **AUDIT_SEAL could seal past an open transaction and then report tampering that never happened.** Rows are sealed by `created_at`
   (= transaction start) once older than 10 minutes. A transaction open longer than that (a long job or bulk import; reserved job
   connections run without a statement timeout) commits rows dated before rows already sealed; verify then counts them inside a sealed
   range and reports `ROW_COUNT` — a permanent false tamper alarm, and those rows are never sealed. Fix (`audit/seal.ts`): rows are sealed
   only below `min(xact_start)` of the other open client sessions of the database (application-role sessions are visible to the
   application role) as well as below the lag.
5. **Erasure rewrote other people's text.** Staff notifications and drafts were matched with `strpos` and scrubbed with an unanchored
   `regexp_replace`, so erasing "Ravi Kumar" rewrote "Call Ravi Kumaran" (another customer) into "Call <erased name>an", and an
   e-mail matched inside a longer one wiped an unrelated booking draft. Fix (`admin/erase.ts`): identifiers match as whole tokens
   (`(?<![[:alnum:]_])…(?![[:alnum:]_])`, case-insensitive) in the filter and the replacement.

## Tests added

`apps/api/test/integration/security-review-phase7.test.ts` (8 tests; listens on a real port for the network cases):

- X-Export-Cursor over the network → whole list, no next cursor, `export.csv` rows with `async_export=false` for both a `start` and a
  continuation cursor; the same header in-process still keyset-pages (export job path).
- Over the network the header no longer dodges the export budget (429 after the limit; the track's code answered 400/200 forever); the
  job's in-process pages never spend it.
- Company B's admin reading a DAILY_DUES run (keyed by company id) and a HOLD_EXPIRY run (flat numbers) through `/admin/jobs/runs/:id`,
  `/admin/jobs/runs`, `/admin/jobs` and `/admin/system` sees neither booking/demand/flat numbers nor company A's id; company A still sees
  its own entry. `companyJobResult` rules (sole tenant, `company_id`, `by_company`).
- Refresh blocked by a row lock (lock timeout) → error, cookie kept; the same cookie refreshes afterwards. A dead (401) refresh still
  clears it.
- An audit row of a transaction still open when later rows are committed: the seal run waits (0 rows), after the commit everything is
  sealed and `verifyAuditChain` is clean (`unsealed_rows` 0).
- Erasing "Ravi Kumar" (with e-mail) leaves a notification about "Ravi Kumaran" / `xravi@…` and a draft naming `xravi@…` untouched,
  and scrubs the one about the erased customer.

## Results

| Suite                                                                                               | Database / Redis               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/api typecheck (`tsc --noEmit`); ESLint `--max-warnings 0` and Prettier on every file I touched | —                              | green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| apps/api unit (full)                                                                                | — / Redis 19                   | 27 files, 172/172                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| new `security-review-phase7.test.ts`                                                                | kkt_p7_rsecurity, Redis 18     | 8/8 (7 of them fail on the track's code)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `security-phase7.test.ts` (the track's own)                                                         | kkt_p7_rsecurity, Redis 18     | 27/27 before and after the fixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| apps/api integration (full, `--no-file-parallelism`, 62 files)                                      | kkt_p7_rsecurity, Redis 18     | 769/770. The one failure, `documents-phase7` "export interrupted … resumes at its checkpoint", came from the platform reviewer editing `documents/exports.ts` (new `exportPartKey(…, run, n)`) while the suite ran; re-run afterwards: 9/9. A later re-run of `documents.test.ts` shows "stores a real PNG … `_thumb.webp`" failing against the platform reviewer's in-progress `documents/renditions.ts` / `service.ts` (rendition key naming, edited 04:01; it passed in my full run) — not in my files |
| apps/api acceptance (13 files)                                                                      | kkt_p7_rsecurity_acc, Redis 19 | 55/55                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

No contract, enum, error-code, env var or migration change; packages/contracts untouched (its suite unaffected).

## Reviewed and left as is (with reasons)

- **C4 lenient lookup.** Without a named company in a multi-company install the identifier is looked up across companies; only an
  identifier present in several companies answers 400 `COMPANY_REQUIRED` (C4's last step read strictly would answer 400 for every such
  sign-in). This is the track's documented decision; the only extra signal is "this identifier exists in ≥ 2 companies". Kept; flagged
  here as a deviation from the strict reading of C4.
- **Linking an out-of-scope customer.** Lead convert and booking creation accept any customer id of the company; the duplicate check
  (by design) returns the id of an out-of-scope duplicate, and linking makes the customer in scope. This is the "one person, one record"
  flow (a scoped user could otherwise never sell to a customer of another project: creating a second record is refused as a duplicate).
  Kept.
- **Existing installs keep their stored `force_mfa_for_admins: false`** (the old bootstrap wrote it explicitly). Flipping it in place
  would lock out admins of live installs until they enrol; operators turn it on in settings. Fresh installs are on.
- **Logout needs a valid access token** (as before); the ERP refreshes first, and every role must hold `dashboard.view`, so the cookie is
  always clearable.
- MFA "enrol on first sign-in": an attacker holding an un-enrolled admin's password can enrol their own authenticator — inherent to
  forced enrolment without an out-of-band channel; documented in SECURITY.md.
- Audit fingerprints (`<field>_fp`) use the active hash key: after a HASH_KEYS rotation fingerprints of old and new rows differ. Acceptable
  (they show change between snapshots written under one key).
- `GET /admin/audit/verify` recomputes the whole chain per request (admin.tools only); fine at current sizes, worth a cap later.

## Cross-track items (exact changes, not made: outside my file set)

1. **apps/api/src/app.ts (platform)** — still open from the track: CORS `credentials: true`; `allowedHeaders` += `X-KKT-Session`,
   `x-kkt-company`. Without it a cross-origin ERP/portal (any deployment where the SPA and the API are on different origins, and local dev
   on two ports) cannot log in with contract C1 at all (preflight fails on `X-KKT-Session`; the cookie is never stored).
2. **apps/api/src/modules/documents/exports.ts (platform/documents)** — an export RUNNING when a customer is erased can store pages read
   before the erasure. In `runCsvExport` mark DONE with `.where(and(eq(exportsTable.id, row.id), eq(exportsTable.status, "RUNNING")))`
   and, when no row was updated, remove the stored file (queue it in `storage_deletions`); then `withdrawExports` in admin/erase.ts can
   also set QUEUED/RUNNING exports to FAILED (I will not change erase.ts for that alone: without the job-side guard the job overwrites the
   status).
3. **docs/API-CONVENTIONS.md (platform)** — line 21 (async exports): add "`X-Export-Cursor` is honoured only for the job's in-process
   calls; a network request carrying it is an ordinary capped CSV export (audited, export-budgeted)".
4. **Idempotency store (platform)** — `idempotency_keys.response_body` keeps customer create/update responses (name, phone, e-mail) for
   its TTL; erasure does not scrub them. Either purge the customer's keys in erasure (needs a resource reference on the row) or document
   the TTL as the residual retention in SECURITY.md.

## Files changed

- `apps/api/src/plugins/auth.ts` — `isInProcessRequest`; `X-Export-Cursor` stripped from network requests; job pages exempt from
  subject budgets; `isExportRequest` simplified.
- `apps/api/src/modules/admin/tools.ts` — `JobResultViewer`, `jobResultViewer`, new `companyJobResult` rules; every job_runs reader uses
  them.
- `apps/api/src/modules/auth/cookies.ts` (`isDeadSession`), `auth/staff.ts`, `auth/portal.ts` — cookie cleared on 401 only.
- `apps/api/src/modules/audit/seal.ts` — sealing bounded by the oldest open transaction.
- `apps/api/src/modules/admin/erase.ts` — whole-token matching (`tokenPattern`, `mentions`) for drafts, notifications, ticket messages.
- `apps/api/test/integration/security-review-phase7.test.ts` (new).
- `docs/SECURITY.md` — cookie clearing, seal bound, X-Export-Cursor, job-result tenancy rule, whole-token erasure.

## Contract shapes

No wire contract changed. Behaviour notes for clients: `X-Export-Cursor` is ignored on network requests; a cookie refresh failing with a
non-401 keeps the cookie (the ERP already retries on network errors and signs out on 4xx — a 409/429 from refresh now leaves a cookie
that a later refresh can use). Job results (`AdminJobRunRow.result`) in multi-company installs omit cross-company arrays/objects.
