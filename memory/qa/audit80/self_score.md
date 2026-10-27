# Self-score against the 80-factor audit (AUDIT-80-FACTORS-V3 groups A–H) — 2026-10-27

Scored by the implementing agent against OUR repo (`/app`). Each row: factor · score/1000 · evidence (path:line) · honest gap. Reference scores from the external doc are shown for context only; our score is independent and deliberately conservative where proof is thin (no external pen-test, no multi-node deployment, sandbox-only load numbers).

## Group A — Architecture & Backend — **7,210 / 10,000**
| # | Factor | Score | Evidence | Gap |
|---|---|---|---|---|
| A1 | Service architecture & modularity | 740 | `backend/routers/` (38 routers), `backend/services/` (definitions, ledger, ledgers, dues_engine, job_runs, invariants, immutable, alerts) | monolith; services share one `db`; no bounded contexts enforced by imports |
| A2 | Framework & async correctness | 760 | FastAPI + Motor; `server.py:261` global handler maps Mongo errors; `services/loadshed.py:35` loop-lag probe | blocking `mongodump` only in jobs via `to_thread`; some CPU-heavy report loops stay on the event loop |
| A3 | Transaction integrity / atomicity | 800 | bucket caps `services/caps.py`; one Active booking/flat unique partial index `services/invariants.py:29`; idempotency claims `infra.py:193` | no multi-doc transactions (single-node Mongo); compensations instead |
| A4 | Domain logic isolation | 780 | `services/definitions.py:38` (outstanding/advance/net law), `services/ledger.py` | some routers still hold business rules (payments.py headroom warning) |
| A5 | Error envelope consistency | 800 | `errors.py` registry + `tests/test_error_registry.py` source scan; `server.py:235-275` | two codes carry two statuses (INVALID_CREDENTIALS 400/401, MFA_INVALID) |
| A6 | Config & env | 760 | `.env` only, no defaults for MONGO_URL/DB_NAME; `API_MAX_INFLIGHT`, `QUERY_BUDGET_*`, `BACKUP_*`, `TTLCACHE_MAX` | no schema validation of env at boot |
| A7 | Background jobs robustness | 790 | `services/job_runs.py:42` run_isolated, sweep → ABANDONED, stale 26 h alert; `tools/backup.py`, `tools/restore_drill.py` | single-process scheduler (no leader election for multi-worker) |
| A8 | Dependency hygiene | 600 | `requirements.txt` pinned via pip freeze | passlib/bcrypt `__about__` warning noise; no SCA scan |
| A9 | Code quality | 680 | ruff clean (lint gate); 62 test files | long routers (reports.py 650+ lines); dense one-liners |
| A10 | Type safety & validation | 760 | Pydantic `StrictModel`s; `_strict_params`; Mongo `$jsonSchema` + `$expr` validators `services/validators.py` | `Any` in list envelopes (`models_out.py`) |

## Group B — Data — **7,380 / 10,000**
| # | Factor | Score | Evidence | Gap |
|---|---|---|---|---|
| B1 | Document store fit for ledger | 800 | append-only `ledger_entries` (projection rebuilt from source rows `services/ledger.py:20`); three ledgers Udhar/Jama | ledger is a derived projection, not the system of record |
| B2 | Referential integrity & constraints | 790 | `services/invariants.py` unique partial indexes + money validators; `tests/test_phase_k_p0.py` 20-parallel proof | no FK cascade semantics; orphans caught only by integrity report |
| B3 | Indexing & query efficiency | 800 | `tools/explain_audit.py` → `memory/qa/scale/explain_report.md` 100 shapes 0 COLLSCAN/0 mem-sort on 6.6 M rows; `db.py` keyset indexes | report aggregations are O(matched rows) (collections by month 450 ms warm at 1 M payments) |
| B4 | Money representation | 870 | integer paise everywhere; `present_money`; `inr()` | — |
| B5 | Canonical forms | 780 | phone/PAN canonicalisation in `routers/customers.py:73-119`; tower name trimming | email not lower-cased at every entry |
| B6 | Snapshotting & versioning | 790 | `payment_plan_snapshot`, `flat_snapshot`, `version` optimistic concurrency (`lib/api.js` guard) | snapshot drift not diffed automatically |
| B7 | Migrations | 700 | `migrate_phase*.py` idempotent, startup-run | no migration ledger table with checksums |
| B8 | Soft delete / audit immutability | 760 | `services/immutable.py:55` GuardedDatabase (app-layer append-only); `changed_fields` audit | **no DB-level insert-only role** (connection lacks admin rights) |
| B9 | Backup/restore/erasure | 740 | `tools/backup.py` + nightly BACKUP; `tools/restore_drill.py` proven in test; `docs/RESTORE.md` | backups to local dir unless object storage mounted; erasure workflow manual |
| B10 | Multi-tenancy | 620 | `company_id` on every doc + scope filters | single company in practice; no per-tenant limits/encryption keys |

## Group C — Performance & Scale — **5,760 / 10,000**
| # | Factor | Score | Evidence | Gap |
|---|---|---|---|---|
| C1 | Measured latency vs targets | 420 | `memory/qa/scale/loadmix_*.md`: on kkt_scale, 1 sandbox worker, 100 users: p95 16 s (target 300 ms) | **target missed in sandbox**; server db p95 for home 163 ms, booking ledger 200 ms — latency is CPU/queueing of one worker |
| C2 | Throughput & concurrency | 560 | load shedding `services/loadshed.py`; 0 non-shed 5xx at 100/300/600 users | ~13 rps mixed per sandbox worker at 1 M payments |
| C3 | Caching | 720 | `services/ttlcache.py` bounded LRU + single-flight + event-bus invalidation; ETag/304 | per-process only without Redis |
| C4 | Horizontal scalability | 700 | stateless JWT; idempotency claims in Mongo; Redis optional | scheduler/alerts loop not leader-elected |
| C5 | Hot-path efficiency | 640 | fixed: payments totals cache, outstanding report cache, home single-flight (`routers/payments.py:124`, `routers/reports.py:195`) | customer_create 4.7 s db p95 under 100-user contention (audit write amplification on 3 M rows) |
| C6 | Pagination & large lists | 800 | keyset `utils.py:152`; estimated totals >10k `utils.py:136`; async exports `routers/exports.py:52` | UI tables not virtualised |
| C7 | Connection pooling | 700 | pool 100, waitQueue 5 s → 503 DB_TIMEOUT retryable; pool stats in ops | pool exhaustion observed at 100 users before fix |
| C8 | Readiness for 5 lakh | 500 | kkt_scale fixture 6.6 M rows built in 289 s; explain 0 flagged | load targets not met on sandbox; multi-worker numbers are estimates |
| C9 | Frontend performance | 700 | Lighthouse reports hub 99/100/100 (Phase I) | no virtualised galleries/lists |
| C10 | Load-testing rigor | 720 | `tools/loadtest.py` (mix, Server-Timing hot paths, RSS, measured vs estimated) | single sandbox box; no distributed load |

## Group D — Security — **7,540 / 10,000**
| # | Factor | Score | Evidence | Gap |
|---|---|---|---|---|
| D1 | Authentication | 820 | refresh reuse `routers/auth.py:232`; (identifier, IP) lockout + dummy bcrypt; sessions list/revoke | MFA optional |
| D2 | Authorization coverage | 800 | `deps.py:79` require(); route-permission registry 268 routes 0 unmapped; anti-escalation `services/access_guard.py:46` | — |
| D3 | Field encryption/masking | 740 | PAN masked, audited reveal | at-rest field encryption not universal |
| D4 | Input validation | 800 | Strict models, `_strict_params`, regex anchors | — |
| D5 | Rate limiting | 760 | `enforce_rate_limit`, load shedding | per-process limiter without Redis |
| D6 | Secrets | 700 | `.env`, secrets tool | no rotation procedure |
| D7 | Audit completeness/immutability | 760 | `write_audit` `utils.py:216`; guard | app-layer only (see B8) |
| D8 | Public API allow-listing | 820 | `routers/public.py` explicit fields | — |
| D9 | File upload safety | 600 | size/type checks in upload routers | **no magic-byte validation, no EXIF strip, no resumable upload (J4 not done)** |
| D10 | Headers & CORS | 740 | `infra.py:157` security headers | CSP permissive |

## Group E — Domain engines — **8,100 / 10,000**
| # | Factor | Score | Evidence | Gap |
|---|---|---|---|---|
| E1 | Flat generation | 800 | Masters Flats generation (Phase M) | — |
| E2 | Pricing | 760 | rate cards | no versioned price history UI |
| E3 | Payment plan validation | 820 | inline validation (Phase M) | — |
| E4 | Auto-dues engine | 820 | `services/dues_engine.py` isolated per booking (job_runs) | — |
| E5 | Ledger engine | 830 | three ledgers; Outstanding/Advance/Net law; 82/82 tie-outs | — |
| E6 | Bucket cap rule | 850 | caps unchanged; PENDING_WOULD_EXCEED_CAP warning | — |
| E7 | Cheque lifecycle | 820 | pending/cleared/bounced/reversal on reversal date | — |
| E8 | Construction stages | 800 | planned dates audited (Phase I.1) | — |
| E9 | Booking lock/cancel/handover | 820 | unique Active booking per flat (DB-enforced) | — |
| E10 | Integrity report & repair | 780 | `services/integrity.py:34`; nightly; restore drill runs it | — |

## Group F — API & Engineering — **7,560 / 10,000**
| # | Factor | Score | Evidence | Gap |
|---|---|---|---|---|
| F1 | REST consistency | 760 | `/api` prefix, list envelopes | some legacy routes |
| F2 | OpenAPI accuracy | 760 | `backend/docs/openapi/v1.json` + breaking-diff test | descriptions sparse |
| F3 | Idempotency | 840 | durable claims with all branches tested | — |
| F4 | Optimistic concurrency | 780 | `version` on PATCH enforced client+server | — |
| F5 | List capabilities | 800 | allow-listed sorts, strict params, CSV with formula neutralisation `utils.csv_safe` | — |
| F6 | Error codes | 800 | registry test | see A5 |
| F7 | API versioning | 660 | v1 snapshot | no v2 strategy |
| F8 | Testing | 780 | 540+ tests on kkt_test; tie-outs; headline | timing test flaky under xdist (deselected) |
| F9 | CI/CD, lint | 620 | ruff gate; no CI pipeline file | — |
| F10 | Onboarding | 760 | PRD, RESTORE.md, status files | — |

## Group G — Product — **7,900 / 10,000**
| G1–G10 | Masters, inventory grid, Customer 360, leads, booking wizard, reports (18 + exports page), website, brochure gate, portal, notifications | 790 avg | `frontend/src/pages/*`, `routers/reports_i.py`, `pages/Exports.jsx` | galleries not lazy/virtualised; exports page new |

## Group H — UX & Ops — **7,300 / 10,000**
| # | Factor | Score | Evidence | Gap |
|---|---|---|---|---|
| H1–H5 | Design system, 390 px, forms, states, Indian localisation | 760 avg | Lighthouse a11y 100 on hub; INR/IST helpers | — |
| H6 | Observability | 800 | ring buffer, Server-Timing, job_runs, alerts.yaml, pool/cache cards | no tracing export |
| H7 | Deployment architecture | 640 | supervisor single worker; env-driven | **multi-worker scheduler leadership + Redis required for 2,000 staff** |
| H8 | Seed coherence | 850 | story headline stable through K/J | — |
| H9 | Documentation honesty | 800 | this file; status.md files with "not done" first | — |
| H10 | Production readiness today | 640 | all above | sandbox-only load evidence |

## Totals
A 7,210 · B 7,380 · C 5,760 · D 7,540 · E 8,100 · F 7,560 · G 7,900 · H 7,300 → **58,750 / 80,000 (734/1000)**

## Top-10 gaps → backlog
1. C1/C8 latency at volume: multi-worker deployment + Redis cache/limiter; re-measure p95 ≤ 300 ms at 100 users per worker.
2. D9/J4 upload pipeline: magic-byte validation, EXIF strip, WebP variants job, resumable multipart, signed URLs for private files.
3. B8/D7 DB-level insert-only role for audit/ledger (needs admin on the Mongo deployment).
4. H7 scheduler leader election (jobs/alerts) for >1 worker.
5. C5 customer_create write amplification on large audit_logs (fewer indexes / partial indexes).
6. A5 split INVALID_CREDENTIALS 400 vs 401 into two codes.
7. F9 CI pipeline (ruff, tests, OpenAPI snapshot, explain audit on kkt_scale).
8. C9 virtualised galleries/lists for photos/documents.
9. B10 per-tenant limits & key separation.
10. F8 make the login-timing test deterministic (server-side timing assertion instead of client-measured).
