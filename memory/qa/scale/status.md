# Phase J — scale (2026-10-27)

| Item | Status | Evidence |
|---|---|---|
| K#17 async exports | DONE | routers/exports.py, pages/Exports.jsx, tests/test_phase_j_exports.py, phase_j_exports_page.jpeg (12,000-row export → DONE → signed download, header comment + TOTAL row) |
| K#18 self-score | DONE | memory/qa/audit80/self_score.md (734/1000 overall, top-10 gaps) |
| K paginate() budget | DONE | utils.paginate(budget_ms) + smart_count |
| K third clean pass | DONE (one clean pass per J8) | full_suite.log: 540 passed, 2 skipped; the single failure was the OpenAPI snapshot (intentional change, regenerated, 7/7 green after) |
| J1 1M+ fixture | DONE | tools/scale_seed.py; seed_report.json: 6.66 M rows, 289 s, 1,007 MB, integrity sample 200/0 mismatches |
| J2 explain audit | DONE | tools/explain_audit.py; explain_report.md: 100 shapes, 84 → 0 flagged; indexes ported to db.ensure_indexes |
| J3 lists/reports at volume | DONE | estimated totals >10k (`exact=true` override, `total_estimated` flag), cursor + budgets, X-Export-* headers, Exports page |
| J4 photos & documents pipeline | **NOT DONE** | no resumable uploads, magic bytes, EXIF strip, WebP variants, signed URLs, virtualised galleries, retention/legal-hold flag (documents fixture carries `legal_hold` field only) |
| J5 load profile | DONE (targets partly missed) | load_report.md: 0 non-shed 5xx ✓; p95 ≤ 300 ms ✗ on sandbox (1 worker); top-5 hot paths fixed; tier estimate given |
| J6 memory/connections | PARTIAL | pool 100 + WaitQueueTimeout → DB_TIMEOUT ✓, pool/cache cards ✓, ttlcache bounded LRU + single-flight ✓, gzip ✓; RSS ≤ 350 MB ✗ (568 MB → 1.87 GB at 600 users); orjson not used |
| J7 self-score | DONE | see above |
| J8 proof | PARTIAL | explain_report ✓ load_report ✓ Exports Playwright ✓ headline 3/3 ✓ integrity ok ✓ registry 0 unmapped ✓ health 0.20 s ✓ deployment agent: warn (CORS_ORIGINS empty, same-origin by design) ✓; photo-upload Playwright ✗ (J4 not done) |

Flaky tests fixed deterministically: pagination walk now re-reads the total after the walk and accepts the [min,max] window (concurrent xdist writers); restore-drill/p0 async tests run in subprocesses (motor binds to the first loop). The login-timing test remains deselected from the parallel run (passes alone).

Regression found & fixed during J: K.3's `route_perms.json` regeneration had dropped the 37 legacy role codes (LEGACY_EXPANSION) → role users (Sales/Accounts/Project Admin) lost permissions on preview. Restored from bc703d1; 23 → 0 failures.
