# Phase N — Inventory control status (2026-10-27)

## Proof
- n_admin_masked_grid.jpeg — admin Ctrl-selected 5 Available flats in Tower B → Set display "Show as Sold"; 5 "M" badges.
- n_hold_sheet.jpeg — Hold action with mandatory expiry + reason + note.
- n_admin_flat_drawer_hold.jpeg — drawer: Real: Hold / Displayed: Show as Hold / BUILDER, "Hold expires … (225 h left)".
- n_sales_grid_shows_sold.jpeg — Sales user: same tower, B-302 reads Sold, 0 masked badges, Booked flats also read Sold (display layer).

## Story data (kkt dev DB)
Tower A 32 flats, 13 Landowner (41 %). Tower C 56 flats: 6 holds, 3 blocked, 8 masked. 1 `flat.hold_expired` audit (expired-and-released hold).

## Tests
tests/test_phase_n_inventory.py — 5 tests (expiry mandatory, masked indistinguishable incl. dashboard/project/search shaping, wizard/booking saleability, expiry sweep, report tie-outs).
Full suite: see full_suite.log.
