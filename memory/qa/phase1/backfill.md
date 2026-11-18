# Phase 1 F-4 — paid_parts backfill (preview DB `test_database`, 2026-11-13)

`POST /api/admin/backfill-paid-parts` (also a one-time startup step `backfill_paid_parts`, recorded in `migrations`).

| Run | bookings rebuilt | bookings changed | demands changed | voided bills filled | skipped (outstanding/advance would change) | demands without paid_parts before → after |
|---|---|---|---|---|---|---|
| 1 | 103 | 0 | 0 | 4 | 0 | 4 → 0 |
| 2 | 103 | 0 | 0 | 0 | 0 | 0 → 0 |

The 4 demands without `paid_parts` were all **voided** bills (DM-2627-0294/0296/0298/0300). The ledger rebuild skips voided bills, so the backfill gives them zero `paid_parts` (nothing paid, nothing open). Every live demand already had `paid_parts`. Second run: "0 changed".
