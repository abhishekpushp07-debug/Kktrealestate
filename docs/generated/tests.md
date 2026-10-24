### 21.1 Test suites (generated from `/app/backend/tests`)

| File | Tests | Covers |
|---|---|---|
| `test_kkt_erp.py` | 31 | KKT Real Estate ERP backend tests - covers auth, RBAC, masters, projects, blocks, flats, settings. |
| `test_ledger_example.py` | 3 | Owner's reference ledger: BK-…-0001 (P1, 60L cash / 40L account) must match the 10-row table to the rupee. |
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