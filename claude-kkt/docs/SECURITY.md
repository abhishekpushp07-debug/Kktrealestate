# KKT v2 — Security model

## Identities and tokens
* **Staff** (`users`): email + password (argon2id, m=64 MiB, t=3, p=1). Optional TOTP (otplib, 30 s, ±1 window); `settings.force_mfa_for_admins` enforces enrolment for Super Admin / Project Admin.
* **Customers** (`portal_users`): 10-digit phone + password set by staff (temporary password shown once, `must_change_password` until changed).
* Access token: JWT (EdDSA Ed25519 key pair derived from `JWT_SECRET`; HS256 fallback in dev), 15 min, claims `sub`, `aud` (`erp` | `portal`), `cid` (company), `sid` (session/family id), `typ: access`.
* Refresh token: 256-bit random, stored as SHA-256 hash with `family_id`; every refresh rotates (`replaced_by_id`). Presenting a revoked/replaced token → the whole family is revoked (`revoke_reason = REUSE_DETECTED`) and the event is audited. Sessions are listed/revoked per subject.
* Lockout: 5 failures → 15 minutes (`locked_until`), reported as 423 LOCKED. Login endpoints are rate-limited per IP (10/min) via Redis.
* Password policy: ≥ 10 chars, upper, lower, digit; last 5 hashes kept in `password_history`; forced change flag honoured by every protected route except `change-password`/`logout`.

## Authorisation
* Every staff route declares `config.permission`; a registry test enumerates routes and fails if one is missing. Permissions are strings from `@kkt/contracts`; roles are bundles; custom roles allowed; system roles immutable.
* Project scope: users with `all_projects=false` only see rows whose `project_id ∈ user_project_scopes`; direct access outside scope → **404**.
* Portal: every query is constrained to bookings where the customer is primary or a co-applicant; everything else (including PDFs) → 404.

## Data protection
* AES-256-GCM (`FIELD_ENCRYPTION_KEY`, 12-byte IV, key id prefix for rotation) for PAN, Aadhaar, bank account numbers; HMAC-SHA256 (`HASH_KEY`) keyed hashes for duplicate detection. Only masked values leave the API unless `reveal=true` + `customer.kyc_view`; each reveal writes `customer.kyc_reveal` to the audit log.
* Documents: magic-byte validation (`file-type`), 15 MB cap, uuid storage keys, no original path stored, signed 15-minute download URLs (HMAC), KYC-flagged documents gated by `customer.kyc_view` and never shareable with customers.
* Audit log: append-only (DB trigger), stores actor, action, entity, before/after (sensitive fields stripped), IP, request id. Portal actions carry `actor_type = CUSTOMER`.
* Right to erasure anonymises PII (name, phone, email, addresses, encrypted fields, documents) when the customer has no ACTIVE booking; financial rows keep the customer code.
* Backups: Super Admin export (JSON per table, zipped) via 15-minute signed link; sensitive fields encrypted at rest remain encrypted in the export.

## Transport & browser
* Helmet headers (CSP for API docs only, HSTS, nosniff, frame-deny, referrer policy), CORS allow-list per surface (`ERP_ORIGIN`, `WEB_ORIGIN`, `PORTAL_ORIGIN`), bearer tokens only (no cookies → no CSRF), 2 MB JSON body cap, 15 MB multipart cap.
* Public API: allow-listed serialisers, no internal ids of users/customers, costs or storage keys; `Cache-Control: public, max-age=60, s-maxage=60`; 300 req/min/IP reads; 5/min/IP forms with honeypot (`website` field) silently dropped.

## Operational
* Secrets via environment only; startup validates presence and length; key ids allow rotation without downtime.
* Request ids on every log line and error body; failed logins recorded in `login_events`; `/metrics` exposes Prometheus counters/histograms (auth required).
