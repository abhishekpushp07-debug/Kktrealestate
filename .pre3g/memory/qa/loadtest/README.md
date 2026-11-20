# Load test + production reseed runbook (Phase L)

**Status: PREPARED ONLY. Nothing here has been run against https://billpe.com. Wait for the owner's explicit "GO".**

## 1. What the journey load tool does (`backend/tools/loadtest_journeys.py`)
- API-only (no DB access). Logs in as the owner, creates ONE project `LOADTEST-<ts>` with `load_test=true`
  (hidden by default from reports, dashboards, Demand Register, Project Statement scope — covered by
  `tests/test_phase_ps_pricing.py::test_reports_hide_loadtest_projects`), 4 towers, mixed floors, priced flats,
  attached parking, stage plan + payment plan, GST 5 %, parking/maintenance heads.
- Each virtual user runs the connected journey: lead → convert to customer (+ co-applicant) → breakdown preview →
  booking → first payment → Customer 360 → booking ledger → receipt PDF → Demand Register → Project Statement JSON,
  with propagation assertions (flat Booked, ledger bill-raised/received, C360 shows booking, integrity report clean).
  1 in 50 VUs is an admin journey (complete next stage → demand count within [active-before, active-after] → Documents Register).
- Stages ramp (`--stages 50,200,500,1000,2000 --stage-min 3`); a stage stops early after two consecutive minutes with
  error rate > 2 % or p95 > 3 s. Per-endpoint-group p50/p95/p99/error-rate/RPS land in `/app/memory/qa/loadtest/<ts>/stage_<n>.json`.
- Cleanup (`--cleanup` runs automatically at the end): cancels every loadtest booking via the audited cancel API, detaches
  slots, deactivates loadtest customers/leads and the project, re-checks integrity and compares headline numbers
  (dashboard outstanding / collections MTD) to the pre-test snapshot. Result in `cleanup.json`.

### Environment (never printed)
```
LT_BASE_URL=https://billpe.com      # target
LT_EMAIL=<owner login>              # falls back to OWNER_BOOTSTRAP_EMAIL
LT_PASSWORD=<owner password>        # falls back to OWNER_BOOTSTRAP_PASSWORD
LOGIN_RATE_LIMIT_BYPASS_TOKEN=<same value the API process has>   # REQUIRED: write limit is 120/min per user
```
The production API process must carry the same `LOGIN_RATE_LIMIT_BYPASS_TOKEN` (process env, not .env) for the duration of
the test, otherwise a single owner account hits the 120 writes/min limit at ~5 VUs. Remove it afterwards.

### Preview dry-run (done, 2026-11-13, preview pod, generator on the same shared CPU)
Generator → private uvicorn on the preview pod (bypass token), same preview DB. Latencies therefore **exclude** nginx/ingress
and include client-side queueing on a shared CPU.

| stage | requests | rps | errors | failed assertions | notes |
|---|---|---|---|---|---|
| 20 VUs · 1 min | 1636 | 25.3 | 0 (18 RemoteProtocolError = server disconnects under uvicorn single worker) | 18 (booking POST cut by disconnect) | manifest `20261113_083038` |
| 50 VUs · 1 min | 1074 (0.5 min smoke) | 33.7 | 0 | 1 (stage-demand race, fixed) | manifest `20261113_0836xx` |

Cleanup of the dry-runs: bookings cancelled, integrity ok, headline numbers unchanged. Three dry-run projects left by earlier,
pre-fix runs were removed with the audited `POST /api/admin/load-test/purge` (Super Admin, `{"confirm":"PURGE"}`), which refuses
if any non-loadtest lineage would be touched.

Caveat: the 2000-VU ramp has NOT been run anywhere. The preview pod cannot generate that load; a production run needs a separate
generator host and the owner's GO.

## 2. Production reseed (NOT performed)
1. **Snapshot first** (GET with owner token): `/api/health` (note `build`), `/api/dashboard/home` (outstanding, collections MTD),
   `/api/reports/outstanding`, `/api/admin/backups` (confirm last backup < 24 h; take a fresh one via `POST /api/admin/backups`).
   Save the JSON under `/app/memory/qa/loadtest/<ts>/prod_pre_snapshot.json`.
2. **Reseed call** (Super Admin only, irreversible):
   ```
   POST https://billpe.com/api/admin/reseed
   {"confirm": "RESEED", "story": true, "as_of": "<YYYY-MM-DD>"}
   ```
   Wipes every business collection (bookings, payments, demands, ledger, customers, leads, documents, messages …) and
   **preserves**: audit logs, company, users/roles, masters (flat types, stages, charge heads, modes, banks, templates), projects/
   towers/flats, stage/payment plans. Story mode then drives ~80 bookings and their lifecycle through the API in the background
   (`GET /api/admin/reseed/status` until `done`). Expected counts after the story: 2 projects, 6 towers (SGH A/B/C + GGV V …),
   ~80 bookings, integrity report clean, Project Statement ties out (verified on a scratch DB in Phase PS; re-verify on prod).
3. Idempotence: a second reseed with the same `as_of` produces the same counts; the templates seed (`seed_s1_templates`) and
   `migrate_templates` run inside reseed and are keyed on `settings` flags, so they never duplicate.
4. **Gate**: do not run steps 2–3 until the owner replies "GO" in writing. Report pre/post snapshot deltas and the `build` sha.
