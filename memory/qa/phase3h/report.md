# Phase 3H — Reports close-out (F-57) · phase report

## 1 · The two gaps, traced before any rule changed (REQ-325 / REQ-331)

Tool: `backend/tools/trace_3h_gaps.py --db test_database` (read-only), run on the preview data as it was at 3G close.

### Gap 1 — ₹15,000: Collections vs Bank-wise + Cash
- **Receipt:** `KKT/2526/23102` · **Cash** · ₹15,000 · dated 21 Mar 2026 · status **Reversed** (reversed later).
- **Cause:** Collections showed the receipt on 21 Mar and took it back on its reversal day (net 0). Bank-wise left reversed
  receipts out completely, and Cash counted cleared cash only. The old "bridge" took the reversal (−₹15,000) away a
  second time, so the unnamed "± other" line came to **₹15,000**. Nothing was paid twice and no money figure was wrong; only
  the reconciliation sentence was.
- **Fix (owner decision 1):** Bank-wise now reads **the same cleared row set** as Collections (`reports_i.received_rows`):
  each receipt on the day its money was received (cash / online → receipt day, cheque / DD → clearing day), and each
  reversal as a minus row on its reversal day. Bank-wise = non-cash rows, Cash = cash rows, so **Bank-wise + Cash =
  Collections to the paisa, by construction**. The line reads "Bank-wise ₹A + Cash ₹B = Collections ₹C". If any remainder
  ever appears it is a red "Unexplained remainder" line, and the tie-out fails.

### Gap 2 — ≈ ₹4.6 lakh: Bills vs Collection vs Customer status
The bridge tuple `(42054546400, 44888000, -1088900)` breaks down as:
- **₹4,48,880:** bills of **BK-2526-3268**, a **cancelled** booking (today's refreshed copy: BK-2526-3382, same story).
  Bills vs Collection counted every bill; Customer status counts live bookings only.
- **−₹10,889:** a **transfer / price-revision step** on live booking **BK-2526-3247** (ledger `TRANSFER` row, 23 Mar 2026).
  Customer status's bills raised include it; Bills vs Collection read instalment bills only.
- **Total: ₹4,59,769.**
- **Fix (owner decision 2):** By default Bills vs Collection shows live bookings only. Each tower gets a named row,
  "Transfer / price revision adjustment". **Default bills raised = Customer status bills raised to the paisa** (tie-out check).
  The "Include cancelled" switch adds cancelled bookings' bills as their own rows (tower "· cancelled"), with the line
  "Cancelled bookings ₹X". A bill closed by the cancellation still counts as a bill that was raised.

## 2 · What changed (one rule each, one place each)
| Rule | Where |
|---|---|
| Received = cleared. Cheque / DD on its clearing day; cash / online on its receipt day; bounced never counts | `definitions.received_on / received_match / received_day_expr / in_hand_on / cheques_in_hand` |
| The ledger dates a receipt row on that same day; a back-dated cash entry now shows on its receipt day. Row order, and so allocation, is unchanged (by posting time). One-time startup step `redate_receipt_rows` rebuilds old ledgers | `ledger._row_day`, `server.py` |
| Collections (default basis "cleared"), legacy Collections, Home "received", Dashboard, Trends buckets (rebuilt once, `basis` marker) | `reports_i`, `reports.py`, `home_defs`, `dashboard`, `trends` |
| Cheques in hand ₹X (n cheques) — one line on Collections, Bank-wise and Outstanding, tap → Cheque register "In hand" | `registry._received_lines` |
| Refunds paid out −₹R — its own line on Collections, never netted from Received | `reports_i.money_lines` |
| Cancellation deduction kept = other income (Cancellations column + Cash vs Account line) | `registry`, `bridges.forfeits` |
| Outstanding As of D: a row's step counts only if dated ≤ D. Fixes an old bug: past dates counted other-charge lines **not yet billed** (and back-dated rows posted earlier leaked in) | `definitions.shares_as_of` |
| A cancelled booking is never live on any As of date | `customers._live_at` |
| A future As of is refused: "As of can't be after today" (server and date picker) | `reports_v3`, `FilterBar.jsx` |
| Manual bill paid beyond the agreed share: share cap = agreed + manual bills (owner decision 5) | `services.ledger.share_cap` |
| Project → Tower → Floor → Flat → Booking levels on Outstanding and Collections | `registry._DRILL` |
| Outstanding PDF on A4 landscape. Money, dates, codes and numbers sized to their widest value (never wrap); text shortened with "…" | `engine.fit_widths / _clip` (all PDFs) |
| No customer reference on the stacking plan for any role | `no_customer_ids` |
| Booking register headline "N live · M cancelled" (each opens its list) | `bookings.register_lines` |
| System Health "All n uniqueness rules applied" | `SystemHealth.jsx` |
| v3 Collections: a reversal row keeps its receipt's mode (a reversed cash receipt was counted under Bank-wise) | `reports_v3.finance.collections` |
| Story seeder: a completed visit now carries an outcome (REQ-223). The demo refresh had been failing | `tools/story_seed.py` |

## 3 · Per-requirement status
| REQ | Status | Evidence |
|---|---|---|
| 319 received = cleared | Done | `definitions.received_on/received_match`; tieout "collections FY total == Σ cleared receipts" PASS on all 3 DBs |
| 320 cheques in hand line | Done | Collections / Bank-wise / Outstanding line "Cheques in hand ₹X (n cheques)"; tieout "cheques-in-hand count == Pending payments" PASS ×3 |
| 321 tap → cheque list | Done | link `/reports/v3/cheques?in_hand_on=<day>` (iteration 52 HIGH fixed: links were legacy `/reports/…`) |
| 322 bounced never received | Done | bounced status outside `CLEARED`; reversal minus row on its day; matrix bounce cells green |
| 323 Collections = Bank-wise + Cash | Done | identity line; `br_rest == 0` test; tieout PASS ×3 |
| 324 named remainder | Done | red "Unexplained remainder" line only if non-zero (never appears today) |
| 325 ₹15,000 traced | Done | §1 Gap 1 |
| 326 cancelled receipts stay | Done | receipts keep their month; tieout PASS |
| 327 refunds line | Done | "Refunds paid out −₹R" (Feb 2026 on preview −₹4,22,892) |
| 328/329 Bills vs Collection live / Include cancelled | Done | default live only; switch adds "· cancelled" rows + "Cancelled bookings ₹23,28,400" (preview) |
| 330 default = Customer status | Done | tieout_reports "Customer status bridge line == Bills vs Collection" PASS ×3 |
| 331 ₹4.6 lakh traced | Done | §1 Gap 2 |
| 332 forfeit = other income | Done | Cancellations column "Deduction kept (other income)"; Cash vs Account line |
| 333–339 As of | Done | `tools/asof_replay.py` independent replay: **0 mismatches** on preview, medium, volume (`asof_replay_*.md`); real bug fixed (other charges not yet billed counted on past dates) |
| 340 Outstanding As of = Customer status As of | Done | same replay, report total vs Customer status: 0 mismatches |
| 341 As-of in sentence / PDF / Excel / link | Done | PDF header "80 bookings · as of 19 Nov 2026" |
| 342 future refused | Done | 422 "As of can't be after today"; picker disables future days. Minor: a future date typed in the URL shows the error card instead of falling back to today |
| 343/344 manual bill payment | Done | `services.ledger.share_cap`; `test_phase3h_reports.py::test_manual_bill_paid_beyond_agreed_share` + over-pay refusal. Preview has 0 manual bills, so UI not exercised there |
| 345 hierarchy | Done | Project → Tower → Floor → Flat → Booking group levels |
| 346 Outstanding PDF A4 landscape, no wrap | Done | 841.9 × 595.3 pt, `pdf_nowrap.py` 0 wrapped cells; full flat label, in-hand line printed (iteration 52 design notes fixed). `exports_*.md` 50 × 2 formats, 0 problems ×3 |
| 347 no CUST- on stacking plan | Done | API + UI checked by iteration 52 |
| 348 "N live · M cancelled" | Done | "80 live · 2 cancelled" |
| 349 "All n uniqueness rules applied" | Done | "All 5 uniqueness rules applied" |
| 350 re-proof of 50 reports | Done, with the speed note in §5 | tieout/report tieout/As-of/exports on 3 DBs, 200 screens |
| 351 connection-matrix cells | Done | cheque received → in-hand up, cleared/bounced → down; matrix 780/780 green |
| 352 demo refresh first | Done | demo refresh OK (story seeder fixed: visit outcome, REQ-223) |

## 4 · Gates
| Gate | Result | Artifact |
|---|---|---|
| Tie-out | preview / medium / volume 0 FAIL | `tieout_preview.md`, `tieout_kkt_medium.md`, `tieout_kkt_volume.md` |
| Report tie-out | 219/219, 219/219, 217/217 PASS | `tieout_reports_*.log` |
| As-of replay | 0 mismatches ×3 | `asof_replay_*.md` |
| Exports (50 × xlsx + pdf) | 0 problems ×3 | `exports_*.md` |
| Integrity / chronology (preview) | 0 findings / 0 problems | `integrity_preview.json`, `chronology_preview.log` |
| Screens + phone sweep | 200 shots, 0 horizontal overflow | `screens/`, `sweep.md` |
| ESLint / `CI=true yarn build` | 0 / built | `fe_lint.log`, `fe_build.log` |
| Full pytest (sequential, `-n 0`) | **953 passed, 5 skipped, 0 failed** (23 min 59 s) | `pytest_full_3h.log` |

## 5 · Speed (REQ-350) — Elite set-up, same as `baseline_3g_elite.md`
- Full run `perf_elite_reports.md`: 12 reports showed a first-open p95 > 10 % above baseline. Re-run of exactly those 12
  (`perf_elite_reports_recheck.md`): **all 12 at or below baseline** (e.g. outstanding 475 vs 605 ms, booking-health 468 vs 764,
  follow-ups 67 vs 79). The full-run outliers were single slow samples (p95 of 10). Repeat opens: every report ≤ 41 ms, as in 3G.
- Hot reads unchanged (`perf_elite_budget.md`).
- **Writes are slower than 3G** (not a report, still listed): Post payment p95 224 vs 111 ms, Create booking 555 vs 259,
  Stage complete 654 vs 526 ms (**over the 600 ms write budget in this run**). Cause measured: each write refreshes the
  trend buckets, and the received-day query (cash by receipt day, cheque by clearing time) costs ≈ +40 ms per scope
  (120 → 165 ms company scope on `kkt_volume`). Left for Phase 3I as instructed (no speed work in 3H).
- Runner fix: orphaned uvicorn workers of the scratch server kept writing a scheduler lock into the scratch DB, which made
  the next `mongorestore` fail (duplicate `locks.name`). `run_perf.sh` now reaps them between steps.

## 6 · Not verified
- Payment against a manual bill in the UI on preview (0 manual bills there); covered by pytest only.
- Future As of typed into the URL falls to an error card (no fallback to today) — low, left as is.
- Write timings above the 3G baseline (§5).

## 7 · Tester seed facts (preview after the nightly refresh 18 Nov 21:30 UTC, business date 19 Nov 2026)
- Cheque in hand: **KKT/2627/42976** ₹40,000 (dated 17 Nov 2026) on **BK-2526-3401**. As of 31 Oct: ₹3,43,288 (2 cheques) — KKT/2627/42726 on BK-2526-3433, KKT/2627/42875 (DD) on BK-2627-3029.
- Cancelled with refund: **BK-2526-3428** (cancelled 27 Jan 2026, refunds 26 Feb 2026 ₹2,81,928 + ₹1,40,964). Cancelled, no refund: BK-2526-3438 (3 Mar 2026).
- Past month-end: **Outstanding As of 31 Oct 2026 = ₹3,50,43,498 (78 bookings)** = Customer status As of 31 Oct. Today ₹4,50,09,812 (80).
- Waiver on a known date: **WV-2627-0052** ₹25,000 on **BK-2627-3030**, approved 19 Nov 2026 03:05 IST (As of 18 Nov ignores it).
