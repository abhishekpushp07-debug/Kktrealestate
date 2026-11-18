# Phase K — hardening practices (2026-10-27)

| # | Item | Status | Enforced where | Proof |
|---|------|--------|----------------|-------|
| 1 | Dues job isolation + job_runs + sweep + stale flag | DONE | services/job_runs.py, dues_engine.run_dues_for_all, server nightly loop, routers/ops.py | tests/test_phase_k_p0.py (poisoned booking → FAILED, 1 item error; sweep → ABANDONED), phase_k_system_health.jpeg |
| 2 | Mongo invariants | DONE | services/invariants.py (unique partial indexes; money `$expr` merged with existing `$jsonSchema`) | test_invariant_indexes_and_validators_reject_bad_docs, 20-parallel-bookings → exactly 1 |
| 3 | Insert-only audit/ledger | DONE (app-layer) | services/immutable.py GuardedDatabase wraps `db` in db.py; audit_logs allow `$set` of propagation/snapshot metadata only; ledger_entries no updates; deletes only via `.raw(reason)` (archiver, rebuild). **No DB-level role**: connection string has no admin rights; documented in module docstring | test_app_connection_cannot_update_or_delete_audit_rows |
| 4 | Durable idempotency claims | DONE | infra.IdempotencyMiddleware → idempotency_claims (unique owner+key, TTL 24 h) | mismatch 422, reuse 422, in-progress 409 + Retry-After, abandoned takeover, secret replay 409, 5 concurrent dupes → 1 create |
| 5 | Error-code registry | DONE | errors.py + tests/test_error_registry.py (source scan) | green |
| 6 | Cap headroom warning | DONE | payments._headroom_warnings → `warnings[]`; PostPayment amber banner | test_pending_cheque_headroom_warning, phase_k_payment_headroom_warning.jpeg |
| 7 | Load shedding | DONE | services/loadshed.py (API_MAX_INFLIGHT, lag probe → 25 % cap floor 8, probes exempt, throttled log), ops.load_shed | test_loadshed_*, health 0.13 s |
| 8 | Query budgets | DONE | services/budgets.py; search finds `.max_time_ms(SEARCH_MS)`, reports `aggregate(maxTimeMS=REPORT_MS)`; ExecutionTimeout → 503 QUERY_TIMEOUT Retry-After 5 | test_query_timeout_envelope, test_budgets_wired. **Not done:** shared `paginate()` does not yet accept a budget |
| 9 | Anti-escalation R1–R4 | DONE | services/access_guard.py in users.py + access.py; UI disabled with reason | test_r1_*, test_r2_r3_r4_*, phase_k_access_self_disabled.jpeg |
| 10 | Auth lockout (identifier, IP) + constant time | DONE | auth.login: login_events count per (email, ip); dummy bcrypt verify for unknown users | test_pair_lockout, timing test (median diff < 150 ms; deselected in xdist full run — flaky under load, passes alone) |
| 11 | Retryable DB envelopes + GET retry | DONE | server.unhandled_exc_handler (DB_TIMEOUT 503 / CONFLICT_RETRY 409 / QUERY_TIMEOUT 503), api.js retries idempotent GET once | test_transient_db_errors_* |
| 12 | Backup + restore drill | DONE | tools/backup.py, tools/restore_drill.py, nightly BACKUP job, ops.backup card, docs/RESTORE.md | test_backup_manifest_and_restore_drill (restore into scratch DB, counts + ledger totals match, integrity run) |
| 13 | Alerts as code | DONE | backend/ops/alerts.yaml (10 rules), services/alerts.py loop every 60 s → Super Admin notification (deduped/day) + Alerts card | test_each_alert_rule_fires_on_synthetic_data |
| 14 | OpenAPI snapshot | DONE | backend/docs/openapi/v1.json, tools/openapi_snapshot.py (`--write` to regenerate), tests/test_openapi_snapshot.py | green |
| 15 | Load runner | DONE | tools/loadtest.py → memory/qa/load/*.json/.md | run: health 578 rps p95 7.7 ms; bookings 189 rps p95 22 ms; writes hit 429 RATE_LIMITED (recorded honestly) |
| 16 | CSV formula neutralisation | DONE | utils.csv_safe in to_csv + report CSV | tests/test_csv_safe.py |
| 17 | Async large exports | NOT DONE | — | pending |
| 18 | 80-factor self-score | NOT DONE | — | pending |

Full suite (kkt_test): 534 passed, 2 skipped (2 transient: pagination walk under concurrent writers + restore-drill loop issue — both fixed/pass alone). Headline 3/3. Tie-outs 82/82. Integrity ok, 0 findings. Registry 268 routes, 0 unmapped.
