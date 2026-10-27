# KKT v2 — Security model

## Identities and tokens

- **Staff** (`users`): email + password (argon2id, m=64 MiB, t=3, p=1). Optional TOTP (otplib, 30 s, ±1 window). Each accepted code
  consumes its time step: `users.totp_last_step` is advanced with a compare-and-set update and a step ≤ the last accepted one is refused
  (login, MFA step, enrolment and disable alike), so a code — or an older one — never works twice, not even for two racing requests.
  `settings.force_mfa_for_admins` (default **on**: contract default, production bootstrap and the 0005 DB default; only the demo seed sets
  it `false`, explicitly, so its published logins work without an authenticator) forces enrolment for every role that holds
  `settings.manage`, `users.manage`, `roles.manage` or `admin.tools`, and for the Super Admin system role — decided by permissions, never
  by role names (a renamed or custom all-powerful role cannot escape it). Until enrolled such a user only reaches the self-service routes
  (me, change-password, logout, sessions, MFA enrol/verify/disable): 403 `MFA_REQUIRED`.
- **Tenant of a sign-in (contract C4)**: staff and portal login resolve the company first — body `company` (slug), header `x-kkt-company`,
  the request Host in `companies.hosts`, else the only company — and then look the e-mail / phone up in that company only (they are unique
  per company). An unknown slug is 400 `COMPANY_REQUIRED`. When several companies exist and nothing names one, the identifier is looked up
  across companies: no match answers exactly like a wrong password (same 401 body, same argon2 cost, counted by the lockout), one match
  signs in, and an identifier present in more than one company is 400 `COMPANY_REQUIRED` (the client must name the company). Login events
  record the resolved company (unknown identifiers included), and `GET /audit-logs/login-events` shows the caller's company only.
- **Job results across tenants** (`job_runs` is a platform table; `admin/tools.ts companyJobResult`): `/admin/jobs`, `/admin/jobs/runs`,
  `/admin/jobs/runs/:id` and `/admin/system` show a tenant admin only what is theirs — a result naming a `company_id` only to that
  company; per-company entries (`by_company: {<id>: …}`, merged into the top level, or top-level keys that are company ids, as the dues and
  integrity jobs write them) only to their own company; and any other object or array of a cross-company run (booking numbers, flat
  numbers, failures) only when the installation has a single company. With several, the scalar counters stay visible.
- **Customers** (`portal_users`): 10-digit phone + password set by staff (temporary password shown once, `must_change_password` until changed).
- Access token: JWT (EdDSA), 15 min, claims `sub`, `aud` (`erp` | `portal`), `cid` (company), `sid` (session/family id), `typ: access`,
  and for staff `rid` (role id, keys the auth cache's role version). Keys (contract C9): `JWT_SIGNING_KEYS` = comma list of
  `<kid>:<base64 PKCS8 DER Ed25519 private key>` — real key pairs, the first signs, every key verifies the tokens whose header names its
  `kid` (an explicit ring never guesses: an unknown or missing kid is invalid), and `GET /api/v1/auth/jwks` publishes all of them, current
  first. Required in production; outside production, when unset, the ring is derived from `JWT_SECRET` (+ `JWT_PREVIOUS_SECRETS`) with
  fingerprint kids as before. Generate a key: `openssl genpkey -algorithm ed25519 -outform DER | base64 -w0`.
- Refresh token: 256-bit random, stored as SHA-256 hash with `family_id`; every refresh rotates (`replaced_by_id`). Presenting a revoked/replaced token → the whole family is revoked (`revoke_reason = REUSE_DETECTED`) and the event is audited. Sessions are listed/revoked per subject.
  A family has an **absolute lifetime** (`REFRESH_ABSOLUTE_TTL_DAYS`, default 30, from `family_started_at`): rotation copies the start and
  never extends it (each token lives `REFRESH_TOKEN_DAYS` but never past the family's end); past it refresh answers 401 `SESSION_EXPIRED`
  and the family is revoked (`revoke_reason = SESSION_EXPIRED`).
- **Cookie sessions (contract C1)** for browsers: a login/refresh/logout with header `X-KKT-Session: cookie` keeps the refresh token in an
  HttpOnly, `SameSite=Strict` cookie — `kkt_rt` on `Path=/api/v1/auth` (staff) or `kkt_prt` on `Path=/api/v1/portal/auth` (portal) —
  `Secure` everywhere except development/test, `Max-Age` = the family's remaining absolute lifetime, and leaves `refresh_token` out of the
  JSON body. Refresh reads the cookie when the body has no `refresh_token`, but only together with the `X-KKT-Session: cookie` header
  (CSRF guard: a cookie alone → 403 `FORBIDDEN`, `details.reason = SESSION_HEADER_REQUIRED`); a cookie refresh that fails because the
  session is dead (401: invalid, reused, expired, inactive) and every logout with the header clear the cookie — a transient failure (409
  lock timeout, 429, 5xx) keeps it, so the next refresh can still succeed. Reuse detection works the same for both transports. Body mode stays for native apps and API clients.
- Lockout (staff and buyers alike, counted from `login_events`, no Redis needed): 5 failures for one (identifier, client IP) inside 15 minutes lock that **pair** for 15 minutes after the 5th failure — the owner can still sign in from their own network, so a stranger cannot lock them out. 20 failures for one identifier across all IPs inside 15 minutes lock the **account** (`locked_until`), write an `auth.locked` / `portal_auth.locked` audit row (scope ACCOUNT) and notify every Super Admin. A successful sign-in resets that IP's pair counter; an admin unlock or password reset (`locked_until = now()`) resets both. Parallel bursts cannot outrun the counters: each attempt reserves an in-flight slot per (identifier, IP) and per identifier, and an attempt that would push in-flight + counted failures past 5 (pair) or 20 (account) is refused at once with 429 `RATE_LIMITED` (no password check, never queued) — the same for known and unknown identifiers. Unknown identifiers are counted exactly like real ones: 401 `INVALID_CREDENTIALS` with the same message and no `details` (no `attempts_left`), then 423 `LOCKED` with `details.locked_until` after the 5th attempt from an IP — the wire never reveals whether an account exists; unknown identifiers also pay the same argon2 cost. The MFA step token is bound to the client IP of the password step. Login endpoints are additionally rate-limited per IP (10/min) via Redis.
- Client IP (rate limits, lockouts, audit rows, login events) is Fastify's proxy-aware `req.ip`. `TRUST_PROXY` (default `loopback`) lists the peers allowed to set `X-Forwarded-For` (`false`, `true`, or proxy-addr names/IPs/CIDRs); the client is the right-most untrusted hop, so a caller reaching the API directly cannot choose its own IP.
- Password policy: ≥ 10 chars, upper, lower, digit; last 5 hashes kept in `password_history`; forced change flag honoured by every protected route except `change-password`/`logout`.

## Authorisation

- Every staff route declares `config.permission`; a registry test enumerates routes and fails if one is missing. Permissions are strings from `@kkt/contracts`; roles are bundles; custom roles allowed; system roles immutable.
- No privilege escalation through user/role management (403 `FORBIDDEN` with `details.reason`): nobody changes their own role, project scope, forced-change flag or active state, or resets their own password through `POST /users/:id/reset-password` (`SELF_CHANGE`; name/e-mail/phone may change; one's own password changes only via `change-password`, which needs the current one); nobody grants a role, or creates/edits a custom role, carrying a permission they do not hold (`PERMISSION_ESCALATION`, `details.missing`); a project-scoped administrator cannot hand out all-project access, nor edit, reset, unlock or deactivate an account whose access reaches beyond their own projects (all-projects or another project; `SCOPE_ESCALATION`); only a Super Admin grants the Super Admin role, or edits, resets, unlocks or deactivates a Super Admin (`SUPER_ADMIN_TARGET`) — holding every permission is not enough or edits a system role (`SYSTEM_ROLE_SUPER_ADMIN_ONLY`), and nobody manages an account holding permissions they lack (`TARGET_OUTRANKS_CALLER`). Super Admin = the _system_ role of that name.
- Global search (`GET /search`) gates each entity type by its own read permission — PROJECT/BLOCK/FLAT `project.read`, CUSTOMER `customer.read`, BOOKING `booking.read` — and the caller's scope: a project-scoped user only finds customers who are applicant/co-applicant on a booking, or the customer of a lead, in one of their projects. Employee finds no customers or bookings.
- Project scope: users with `all_projects=false` only see rows whose `project_id ∈ user_project_scopes`; direct access outside scope → **404**.
- **Customers follow the project scope** (SPEC §1; `lib/scope.ts customerScopeCondition`): a scoped user sees a customer who is primary or
  co-applicant on a booking in one of their projects, the customer of a lead or a site visit for one, or a record they created themselves
  that is not linked to any project yet. This covers the list (and its CSV), `GET /customers/:id` (with `?reveal=true` — PAN, Aadhaar, bank:
  404 outside scope even with `customer.kyc_view`), PATCH, KYC, co-applicants, deactivate/activate, portal access and bulk enable, the 360
  (bookings, payments and `payments_count`, leads, tickets — each limited to the scope as well), global search, and CUSTOMER documents
  including KYC scans (`documents/entities.ts`; list, metadata, links). A duplicate check still finds another project's customer (one
  person, one record) but names them only as "Existing customer (outside your projects)" with a masked phone.
- Portal: every query is constrained to bookings where the customer is primary or a co-applicant; everything else (including PDFs) → 404.

## Data protection

- AES-256-GCM (12-byte IV) for PAN, Aadhaar, bank account numbers (customers, co-applicants, company bank accounts) and TOTP secrets; every ciphertext is `<kid>.<iv>.<tag>.<ct>`. The key ring is `FIELD_ENCRYPTION_KEYS` (`kid:secret,…`, first = active for new values) plus `FIELD_ENCRYPTION_KEY` as kid `k1`; any configured kid decrypts. Only masked values leave the API unless `reveal=true` + `customer.kyc_view`; each reveal writes `customer.kyc_reveal` to the audit log (fields, filters, row count).
- Keyed hashes (HMAC-SHA256) for duplicate detection come from the **`HASH_KEYS` ring** (contract C9; `kid:secret,…`, first = active,
  `HASH_KEY` is kid `h1`; required in production): new writes use the active key; lookups and duplicate checks compute the hash under
  every ring key, so values hashed before a rotation are still found; `REENCRYPT_FIELDS` also rehashes PAN/Aadhaar hashes to the active key.
- **Signed links** (downloads, exports, backups, portal file links, MFA step tokens, visitor tokens) use the **`LINK_SIGNING_KEYS` ring** (contract C9;
  `kid:secret,…`, first signs, older keys verify; required in production, derived from `JWT_SECRET` outside it). The kid travels in the
  link — compact binary links as `<kid>.<body>.<sig>` (`lib/crypto.ts signLinkBody/verifyLinkBody`), JSON payload tokens as a signed
  `_k` field inside `<payload>.<sig>` (`signPayload/verifyPayload`, so their shape is unchanged) — and a rotation keeps every outstanding
  link valid until its key is dropped.
- Duplicate customers: an advisory lock + check per (company, phone) and (company, PAN hash), backed by the partial unique indexes `customers_company_phone_live_uq` / `customers_company_pan_hash_live_uq`; a writer that slips past the check gets the same 409 `DUPLICATE_CUSTOMER` with `details.existing`.
- KYC is a maker-checker workflow: SUBMITTED needs PAN, Aadhaar and at least one KYC document (sensitive, or of a KYC document type) — else 422 `KYC_INCOMPLETE` (`details.missing`); VERIFIED/REJECTED only from SUBMITTED, by a `customer.kyc_view` holder who is not the submitter (403 `details.reason = KYC_MAKER_CHECKER`); a REJECTED file is resubmitted only after an edit or a new document; other moves are 409 `KYC_TRANSITION_INVALID`; changing a VERIFIED status needs `settings.manage` and a `reason` (audited as `customer.kyc_reopened`); changing the PAN or Aadhaar of a SUBMITTED or VERIFIED file sends it back to PENDING (submitter/verifier cleared, audited as `customer.kyc_reset`), so new identifiers are always verified afresh. An erased customer accepts no edit, co-applicant or KYC change (422 `CUSTOMER_ERASED`). `kyc_submitted_by/at` and `kyc_verified_by/at` are recorded.
- One-time passwords (user create/reset, portal enable/reset, bulk enable) are sent with `Cache-Control: no-store` and never written to the audit log; a bulk enable that hits an unexpected error stops, still returns the credentials already issued and reports the rest as `failed`.
- CSV exports (every list, reports, audit, login events, portal credentials) neutralise spreadsheet formulas: a text cell starting with `=`, `+`, `-`, `@`, TAB or CR gets a leading `'` (plain numbers such as `-1250.50` stay numeric).
- Documents: magic-byte validation (`file-type`), 15 MB cap, uuid storage keys, no original path stored, signed 15-minute download URLs (HMAC), KYC-flagged documents gated by `customer.kyc_view` and never shareable with customers.
- Audit log: append-only (DB trigger), stores actor, action, entity, before/after (sensitive fields stripped), IP, request id. Portal actions carry `actor_type = CUSTOMER`.
  New rows hold PII **masked** (`lib/audit.ts redactForAudit`, DPDP): phone `******3210`, e-mail `r***@g***.com`, PAN `ABCDE****F`,
  Aadhaar / account numbers last 4, addresses and dates of birth `[redacted]` — each with a sibling `<field>_fp` keyed fingerprint (HMAC,
  16 hex) so a change between two snapshots stays visible without storing the value. Rows written before this release keep what they
  recorded: they are immutable by design and cannot be rewritten (erasure leaves them untouched).
- **Tamper evidence**: job `AUDIT_SEAL` (every 15 minutes) chains each company's new audit rows into `audit_seals`:
  `hash = SHA-256(prev_hash ‖ digest(row)…)` over the canonical row text (every column, computed by PostgreSQL), in batches, rows older than
  10 minutes only and never past the start of the oldest transaction still open (a long transaction commits rows dated at its start; sealing
  past it would make verify report them as back-dated). `GET /api/v1/admin/audit/verify` (admin.tools) recomputes the caller's chain and reports the
  first mismatch: `CHAIN_BROKEN` (a seal removed or forged), `BOUNDARY_MISSING`, `ROW_COUNT` (a row removed or back-dated in), or
  `HASH_MISMATCH` (a row changed), plus the rows not sealed yet. `audit_seals` is append-only and outside the application role's reach.
- **Bulk reads**: every CSV export — each `format=csv` list (`lib/csv.ts sendCsv`) and the first page of an asynchronous export — writes an
  `export.csv` audit row (route, file name, filters, row count, `async_export`) before the first data byte leaves; POST /exports writes
  `export.create`. The keyset paging header of asynchronous exports (`X-Export-Cursor`) is honoured only for the EXPORT_CSV job's
  in-process calls (`plugins/auth.ts isInProcessRequest`: no network socket); a network client sending it gets an ordinary, capped,
  audited and export-budgeted CSV, so it cannot page a whole table past the budget and the audit row. The job's own pages are not counted
  against any budget (POST /exports was). Authenticated subjects have per-minute budgets: writes `WRITE_RATE_LIMIT_PER_MIN` (120), reads
  `READ_RATE_LIMIT_PER_MIN` (1200 GET) and exports `EXPORT_RATE_LIMIT_PER_MIN` (10: CSV lists and POST /exports) — 429 `RATE_LIMITED` with
  `Retry-After`.
- Database privileges of the application role (migration 0005; `infra/postgres/init/01-roles.sql` and `packages/db/src/sql/0002_privileges.sql`,
  applied by every migration when `kkt_app` exists): no UPDATE, DELETE or TRUNCATE on `ledger_entries`, `audit_logs`, `audit_seals`,
  `ledger_rebuilds`; no DELETE or TRUNCATE on `payments` and `demands`; no TRUNCATE, REFERENCES or TRIGGER anywhere. A compromised API
  process therefore cannot rewrite or remove the books, only append to them; the append-only triggers are a second line. `audit_seals`
  (hash chain over `audit_logs`) is append-only like the log.
- Right to erasure has ONE implementation (`modules/admin/erase.ts`, Super Admin only): `POST /admin/customers/:id/erase` is canonical and
  `POST /customers/:id/erase` is a deprecated alias of the same route definition (same body, response, idempotency; Deprecation / Sunset
  2027-04-24 / Link headers). When no booking is ACTIVE (409 `HAS_ACTIVE_BOOKING`) it anonymises the customer, their co-applicants (never
  deleted), the portal login (sessions revoked), documents (soft-deleted) including the customer's own ticket attachments, leads, site
  visits, enquiries, testimonials and portal login-event identifiers, **and** booking-wizard drafts whose payload names the customer
  (emptied), the customer's notifications (withdrawn) and staff notifications about them (name/phone/e-mail replaced; identifiers match
  as whole tokens only, so erasing "Ravi Kumar" never rewrites "Ravi Kumaran"), the text of their
  service requests (subject, description, rating comment, their own messages; staff messages scrubbed of the identifiers), list export
  files made before the erasure (marked FAILED with the reason — QUEUED and RUNNING exports too: the EXPORT_CSV job publishes only an
  export still RUNNING, otherwise its file goes to `storage_deletions`), and stored idempotent responses that name the customer (body
  replaced by an "erased" marker, Redis copy deleted; a retry answers 410 `GONE`, never the data and never a re-run). The customer's
  documents are locked `FOR UPDATE` first, so a rendition run committing meanwhile is waited for and its new keys are deleted too. Every storage object involved is queued in `storage_deletions` inside the
  same transaction; the deletes are tried right after commit and anything that fails is retried by `STORAGE_SWEEP`. Bookings, payments,
  demands and ledger rows keep the customer code; one `customer.erased` audit row records counts and the reason, never the PII. Backups are
  not rewritten: they expire with their own retention.
- Backups: Super Admin export (JSON per table, zipped) via 15-minute signed link; sensitive fields encrypted at rest remain encrypted in the export.

## Transport & browser

- API documentation exposure: `GET /api/v1/openapi.json` and Swagger UI (`/api/v1/docs`, including `/api/v1/docs/json` and its static assets) are public only with `DOCS_PUBLIC=true` (the default outside production). In production the default is `false`: they then require a staff bearer token holding `admin.tools` (anonymous → 401, other staff → 403), checked by the auth plugin like any staff route, and the document is served `Cache-Control: private, no-store`.
- Helmet headers (HSTS, nosniff, frame-deny, referrer policy), CSP on every API response (`default-src 'none'; frame-ancestors 'none'`; the Swagger UI pages get a policy allowing exactly their own scripts and styles; the ERP and portal web hosts set their own CSP), CORS allow-list per surface (`ERP_ORIGIN`, `WEB_ORIGIN`, `PORTAL_ORIGIN`; credentialed, so the C1 cookies work cross-origin, and `X-KKT-Session` / `X-KKT-Company` allowed; never `*`), bearer access tokens; the only cookies are the refresh cookies of contract C1 (HttpOnly, SameSite=Strict, path-scoped to the auth routes, honoured only with the `X-KKT-Session: cookie` header — the CSRF guard), 2 MB JSON body cap, 15 MB multipart cap.
- Website (`apps/web`): no script runs unless the server vouched for it, with two policies from `middleware.ts` / `lib/csp.ts`. Pages rendered per request (`/visit/<token>`, `/projects`, `/blog`) get a per-request nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`). ISR pages (static HTML shared by everybody, CDN-cacheable) cannot carry a nonce, so they get `script-src 'self'` plus the SHA-256 hash of each inline script of the exact HTML sent that is Next's RSC payload and nothing else (`self.__next_f.push(<JSON data>)`; any other inline script — e.g. one injected into the markup — gets no hash and is blocked, so the hook never vouches for code merely because it is in the response), computed by `apps/web/csp-hook.cjs` (loaded with `node --require` by `pnpm start` and the Docker CMD; Next's own gzip is off so it sees the plain body; a 304 drops the policy so the browser keeps the one stored with the 200). Without the hook the `'kkt-inline-hashes'` placeholder reaches the browser and every inline script is blocked (fail closed). Never `'unsafe-inline'` or `'unsafe-eval'` outside `next dev`. Both: `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`, `frame-src https:` for the click-to-load embeds only after a click, plus `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy, HSTS (apps/web/README.md). Server-side calls send `x-kkt-internal-token` (contract C3) and `x-kkt-company` (C4); per-visitor (uncached) calls add `x-kkt-client-ip` and the sanitised `X-Forwarded-For`, so public per-IP limits apply per visitor. `POST /api/revalidate` (on-demand ISR) needs `x-kkt-revalidate-token` = `WEB_REVALIDATE_TOKEN` (constant-time; 404 when unset). Front-end errors are reported to `POST /api/v1/client-errors` without query strings, form contents or the visit manage token (contract C2).
- Public API: allow-listed serialisers, no internal ids of users/customers, costs or storage keys; contract C5 caching (`public, s-maxage=60|300, stale-while-revalidate`, never on authenticated requests); the company comes from contract C4 (`x-kkt-company` / Host / the only company — never the first company created; the API's public cache is keyed by company); the brochure visitor token is opaque (a signed lead reference + expiry, no PII; the server looks the visitor up); 5/min/IP forms with honeypot (`website` field) silently dropped. Per-IP budgets (`PUBLIC_RATE_LIMIT_PER_MIN`, 300) are kept **per route group** (contract C3: catalog reads, forms, brochure, visits, files, sign-in), so a burst on one group never starves another; routes with their own limit (forms 5/min, login 10/min) count that too.
- **Website server-side calls (contract C3)**: the Next.js server sends `x-kkt-internal-token: <INTERNAL_API_TOKEN>` and
  `x-kkt-client-ip: <visitor ip>`. With a valid token (constant-time comparison of SHA-256 digests) the API uses the forwarded visitor IP for
  rate limits, enquiry/visit rows and audit; without a valid token both headers are ignored (the Next server's own IP counts). A valid
  token WITHOUT `x-kkt-client-ip` (an ISR regeneration has no visitor) counts against a separate `internal` budget per route group
  (`INTERNAL_RATE_LIMIT_PER_MIN`, 6000), so regenerations neither spend nor are starved by the visitor budget of the web server's IP.
  Health/readiness probes are never rate-limited.
- Site-visit manage links are bearer tokens stored as SHA-256 hashes with `manage_token_expires_at` = visit end + 24 h (IST); cancelling expires the link at once and every reschedule (visitor `POST /public/site-visits/:token/reschedule` or ERP) rotates it — the old link stops working and the new one is returned once. Expired, cancelled and replaced links answer 410 `LINK_EXPIRED` (the visit keeps only the SHA-256 of its last 20 replaced tokens, `site_visits.superseded_token_hashes`, never a token itself); a token that never existed answers 404.
- Service-request attachments: a thread may only carry live, non-sensitive, non-KYC-type documents of the ticket itself, its customer, or its booking when already shared with the customer; a buyer (portal) may only carry their own uploads or files shared with them.

## Operational

- Secrets via environment (or `<NAME>_FILE`); startup validates presence and length. In production (contract C9) the process refuses to
  boot when `JWT_SIGNING_KEYS`, `LINK_SIGNING_KEYS` or `HASH_KEYS` is missing, or when any secret is a template value — the
  `CHANGE-ME…` values of `infra/k8s/secret.example.yaml`, the `change-me…` values of `.env.example`, anything containing change-me /
  changeme / example / placeholder, a single repeated character (`x`, `xxxx…`) — or shorter than 32 bytes (metrics token and S3 secret: 16);
  connection URLs with a template password are refused too.
- Auth cache (`plugins/auth.ts`): the 30 s cached staff/portal row is valid only while its versions match — `authv:user:<id>` /
  `authv:portal:<id>` (password, sessions, state), `authv:role:<id>` (permission edits; the token's `rid`) and `authv:company:<id>` — plus the
  global `perm:version` kept for reseed/restore only. A change bumps exactly its subject (`lib/cache.ts bumpAuthVersions`), so one
  customer's password change no longer sends every principal to the database.
- First boot in production (`NODE_ENV=production`, `SEED_DEMO` not true): bootstrap creates only the company (`BOOTSTRAP_COMPANY_NAME`), the six system roles and ONE Super Admin from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (password policy enforced, `must_change_password = true`); on a fresh database without them the process refuses to start. Demo logins and the demo dataset are never created in production unless `SEED_DEMO=true`; reseed is always refused there. Bootstrap runs under a transaction-scoped advisory lock and the demo seed under a session advisory lock, so replicas booting together create one company and seed once. No code path disables triggers (`session_replication_role`), so the API can run as a non-superuser role.
- Redis outage: authentication falls back to PostgreSQL (user/role/permissions from the tables, session revocation from `refresh_tokens.revoked_at`); revocation markers live in `app.redisSecurity` when configured (`REDIS_SECURITY_URL`), else `app.redis`. A marker that cannot be written is enforced by the revoking process at once and retried in the background; rate limits fail open (logged) within the same 250 ms budget as the other Redis calls on the auth path, while the DB-backed lockout keeps working. A client that is known to be disconnected is skipped without any wait (`lib/cache.ts` `redisUsable`), and read-through caches (`cached()`: company, public pages) give a slow Redis at most 150 ms, so `/auth/me` answers in well under 300 ms during an outage (test: `cross-track.test.ts`).
- One-time secrets (temporary passwords, visit manage links) are returned once and never persisted by the idempotency store: declared fields are redacted in the stored replay and a replay is 409 `IDEMPOTENT_SECRET_REPLAY` (docs/API-CONVENTIONS.md "Headers"). An account lock across IPs notifies the Super Admins with a `SECURITY_ALERT` bell.

## Key rotation runbook

**JWT signing key (no forced logout; contract C9):**

1. Generate a key pair: `openssl genpkey -algorithm ed25519 -outform DER | base64 -w0`. Deploy with the new key FIRST in
   `JWT_SIGNING_KEYS` and the old one after it (`2027-01:<new>,2026-10:<old>`). New tokens carry the new `kid`; tokens with the old kid keep
   verifying; `/api/v1/auth/jwks` publishes both.
2. After at least `ACCESS_TOKEN_MINUTES` + 1 minute (internal export tokens: 5 minutes), drop the old key and deploy again. Refresh
   tokens are opaque database rows and are not affected. (Outside production, without `JWT_SIGNING_KEYS`, the same works with `JWT_SECRET`
   and `JWT_PREVIOUS_SECRETS`.)

**Link-signing key (contract C9):** put the new key first in `LINK_SIGNING_KEYS` (`l2:<new>,l1:<old>`), deploy, and drop the old one once
the longest-lived link signed with it has expired (download/export/backup links 15 minutes, MFA step tokens 5 minutes, website visitor
tokens 180 days — drop it earlier to force visitors to re-enter their details). Moving from the derived non-production ring to an explicit
one keeps old links valid only if the old `JWT_SECRET` is listed as a second entry.

**Keyed-hash key (contract C9):** put the new key first in `HASH_KEYS` (`h2:<new>,h1:<old>`; `HASH_KEY` is always `h1`), deploy — new
hashes use h2 and every lookup also tries h1 — then run `REENCRYPT_FIELDS` (it rehashes PAN/Aadhaar hashes to the active key, reported as
`rehashed`; payload `{"rehash": true}` forces a pass with a single key). Drop h1 at the next deploy.

**Field-encryption key:**

1. Generate a new 32-byte key (`openssl rand -base64 32`). Deploy with `FIELD_ENCRYPTION_KEYS=k2:<new>` (the old `FIELD_ENCRYPTION_KEY` stays configured as `k1`; with several old keys list them after the new one: `k3:<new>,k2:<old>`). New values are written under the first kid; every configured kid still decrypts.
2. Run the job `REENCRYPT_FIELDS` (payload `{ "batch_size": 200 }` optional) — it walks customers (PAN, Aadhaar, bank account), co-applicants, company bank accounts and users (MFA secrets) in id order, one short transaction per batch, without touching `version`. Each row is written compare-and-set (only if its ciphertexts are still the ones read), so a value a user saves while the job runs is never overwritten; it is already under the new key. Its result reports `updated`/`failed` per table and `remaining` (must be 0).
3. Only when `remaining = 0`, retire the old key at the next deploy. `FIELD_ENCRYPTION_KEY` is always kid `k1` and stays required, so when the retired key is `k1` set `FIELD_ENCRYPTION_KEY=<new secret>` too (nothing is written under `k1` any more) and keep `FIELD_ENCRYPTION_KEYS=k2:<new>`; a retired `k2`, `k3`, … is simply removed from the list. A ciphertext whose kid is no longer configured cannot be read, so never drop a key before the job reports 0 (re-run it right before the deploy).
   (`HASH_KEY` rotates through the `HASH_KEYS` ring above.)

- Request ids on every log line and error body; failed logins recorded in `login_events`; `/metrics` exposes Prometheus counters/histograms (auth required).

## Dependency advisories

`pnpm audit --prod` is run on every dependency change. As of 2026-10-26 the only open advisory is
`node-forge <=1.4.0` (high, no patched release) reached through `apps/portal > expo > @expo/cli`.
`@expo/cli` is build-time tooling for `expo export`/`expo start`; it is not part of the exported
portal bundle or any server image, so the advisory has no runtime exposure. It is re-checked on each
Expo SDK upgrade. Fixed in this round: `sharp` raised to 0.35.5 in the API and pinned for Next.js
(`next>sharp`), `@fastify/static` and `postcss` forced to patched versions through `pnpm.overrides`,
and four unused API dependencies removed (`@fastify/rate-limit`, `@fastify/static`,
`@fastify/under-pressure`, `ics`).
