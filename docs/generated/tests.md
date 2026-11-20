### 21.1 Test suites (generated from `/app/backend/tests`)

| File | Tests | Covers |
|---|---|---|
| `test_index_audit.py` | 1 | Index audit: every list/search/aggregation query must use an index on seed data (no COLLSCAN). Runs in-process against M |
| `test_kkt_erp.py` | 31 | KKT Real Estate ERP backend tests - covers auth, RBAC, masters, projects, blocks, flats, settings. |
| `test_ledger_example.py` | 3 | Owner's reference ledger: BK-…-0001 (P1, 60L cash / 40L account) must match the 10-row table to the rupee. |
| `test_phase_11a.py` | 10 | Phase 11A — code-review fixes, canonical additions, API packeting, index audit. Run per file (login limiter). |
| `test_phase_11b.py` | 8 | Phase 11B backend tests: dashboard/home + project_setup PUT sections with correct payload shapes. |
| `test_phase_11c.py` | 9 | Phase 11C backend tests — Customers filters/rm-options, Payments demands/idempotency/cap, Customer ledgers combined, Hom |
| `test_phase_11e.py` | 7 | Phase 11E backend smoke: reports CSV + presets, master flat-types usage, roles PATCH, service status, quick-customer cre |
| `test_phase_11f.py` | 4 | Phase 11F regression: catalogue-driven customer profile, project default split, cancel booking. |
| `test_phase_1_5.py` | 15 | Phase 1.5 'Foundation Power-Up' tests for KKT Real Estate ERP. |
| `test_phase_2.py` | 12 | Phase 2 backend regression tests. |
| `test_phase_3.py` | 25 | Phase 3 regression: public website APIs, CMS, enquiries, reseed guard. |
| `test_phase_4.py` | 5 | Phase 4 hardening: every non-public route must reject anonymous requests (401), PDFs are valid, backup RBAC. |
| `test_phase_4_full.py` | 21 | Phase 4 comprehensive: reports (11), presets, PDFs (statement/allotment/receipt/demand), |
| `test_phase_5.py` | 27 | Phase 5 — Customer Portal + ERP support (service req, notices, construction photos, doc share). |
| `test_phase_7.py` | 20 | Phase 7 backend tests: Construction Stage Master, Tower Construction Status, |
| `test_phase_8b.py` | 4 | Phase 8B backend sanity tests: public API, pagination guard, milestones legacy next_seq. |
| `test_phase_9.py` | 7 | Phase 9 — brochure lead gate + site visit scheduler. |
| `test_portal_leaks.py` | 3 | Phase 6C: every /api/portal/* JSON response must be free of internal keys. |
| `test_startup_migrations.py` | 1 | Phase 11A §4: startup migrations/backfills are idempotent against a populated pre-Phase-7 database. |