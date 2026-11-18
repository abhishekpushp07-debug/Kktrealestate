# Phase N — Inventory control status (2026-10-27, follow-up complete)

## Proof (first pass)
- n_admin_masked_grid.jpeg — admin Ctrl-selected 5 Available flats in Tower B → Set display "Show as Sold"; 5 "M" badges.
- n_hold_sheet.jpeg — Hold action with mandatory expiry + reason + note.
- n_admin_flat_drawer_hold.jpeg — drawer: Real: Hold / Displayed: Show as Hold / BUILDER, "Hold expires … (225 h left)".
- n_sales_grid_shows_sold.jpeg — Sales user: same tower, B-302 reads Sold, 0 masked badges.

## Proof (follow-up, Tower C)
- n2_sales_towerC_grid.jpeg — Sales: C-304 (masked Available) renders as Sold; 0 "M" badges; no display filter / real toggle offered.
- n2_sales_drawer_C-304.jpeg — Sales drawer: status Sold, no Real/Displayed layer, no hold actions.
- n2_sales_wizard_towerC.jpeg — Sales booking wizard Tower C: 1 tile (C-904) — masked C-304/C-401/C-404, landowner and blocked units excluded.
- n2_sales_masked_report_403.jpeg — /reports/masked-inventory as Sales → Access restricted (API 403).
- n2_admin_hold_register.jpeg — admin Hold Register: 11 active holds (2 legacy without expiry), expiring/expired tabs, hours-left countdown, hold→booking conversion KPI.
- n2_admin_towerC_filter_masked.jpeg — admin display filter "Show as Sold": 42 match, 8 "M" badges.
- n2_admin_masters_flats.jpeg — Masters → Flats with category / real / displayed / hold-expiry columns and filters.

## Story data (kkt dev DB)
Tower A 32 flats, 13 Landowner (41 %). Tower C 56 flats: 6 holds, 3 blocked, 8 masked. 1 `flat.hold_expired` audit (expired-and-released hold).

## Tests
tests/test_phase_n_inventory.py (5), tests/test_phase_n_reports.py (7) — shaping across flats/grid/dashboard/project/blocks/search, expiry mandatory, sweep, saleability, report shape/CSV/PDF/ETag/tie-outs, masked 403.
Full suite: see full_suite.log.
