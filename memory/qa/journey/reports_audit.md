# Phase F — Reports & dashboard tiles audit (2026-10-26, demo DB)

Tie-outs executed with `backend/tools/tieout.py` (read-only; raw table in `tieout_raw.md`). Numbers are paise unless noted.

## 1. Tie-out results

| # | Surface | Formula (as implemented) | Source | Report | Raw | Result |
|---|---|---|---|---|---|---|
| 1 | Collections report FY total | Σ `payments.amount_paise` where status=Cleared, date in range | payments | 14,192,535,000 | 14,192,535,000 | **PASS** |
| 2 | Cheques in hand (count) | status=Pending | payments | 1 | 1 | **PASS** |
| 3 | Cheques in hand (amount) | Σ Pending | payments | 50,000,000 | 50,000,000 | **PASS** |
| 4 | Cheque register rows | default filter `status=Pending` | payments (instrument) | 1 | 90 (Cleared 42 / Reversed 23 / Bounced 24 / Pending 1) | **FAIL (design)** — register defaults to Pending only; no "all" view; totals by status absent |
| 5 | Inventory report by status | count flats by status | flats | A161/H6/B4/S1/Bl2 | same | **PASS** |
| 6 | Home units/available tiles | project read model Σ | flats via read model | 174 / 161 | 174 / 161 | **PASS** |
| 7 | Legacy dashboard inventory | live count | flats | same | same | **PASS** |
| 8 | Outstanding report total due | Σ booking.summary (`due_paise + other_charges_due_paise`) over Active+Completed | bookings | 1,543,850,000 | 1,476,000,000 (Σ cash_due+account_due+other_due) | **FAIL** — report total differs from Σ `booking.summary` by ₹6.79 L on the same Active+Completed scope; formula is `due_paise + other_charges_due_paise` (reports.py:149) while `summary.due_paise` = cash_due+account_due (ledger.py:119), so the gap is a definition/scope drift to be pinned down in Phase G (candidates: bookings whose summary is stale vs. last ledger row, or other-charge demands counted on both sides) |
| 9 | Home overdue tile | Σ project read model `overdue.amount_paise` | demands (all bookings) | 6,104,000,000 | 4,181,500,000 (non-void, due<today, incl. cancelled) · **402,000,000 Active-only** | **FAIL** — read model counts demands of **Cancelled** bookings (129 open/partial rows, ₹5.7 Cr) and reversed-payment demands; true overdue on live bookings is ₹40.2 L |
| 10 | Home outstanding tile | Σ project read model `outstanding.total_paise` | bookings + demands | 1,588,850,000 | 1,476,000,000 | **FAIL** — differs from both the outstanding report (1,543,850,000) and Σ summary; three numbers for one concept |
| 11 | Demand-vs-collection demanded | Σ `total_demand_paise` non-void | demands | 21,788,000,000 | 21,788,000,000 | **PASS** (but includes cancelled bookings' demands — "collected %" 59 % is understated) |
| 12 | Legacy dashboard collections.month | Σ Cleared this month | payments | 802,000,000 | 802,000,000 | **PASS** |
| 13 | Cancellations report rows | status=Cancelled | bookings | 39 | 39 | **PASS** |
| 14 | Sales-leads total | count leads | leads | 214 | 214 | **PASS** |
| 15 | Per-booking: Σ cleared cash receipts == summary.cash_paid | all Active/Completed | payments vs bookings | 0 mismatches | 0 | **PASS** (ledger engine is sound) |

**Verdict**: raw-collection reports tie out; **every surface built on the dashboards read model or on `booking.summary` sums disagrees on outstanding/overdue**, because (a) cancelled bookings' demands are still live rows, (b) `other_charges_due` is counted twice in the outstanding report, (c) the read model and the report use different scopes. This is the single most visible "system feels broken" cause: the Home tile says ₹6.1 Cr overdue, Outstanding report says ₹1.54 Cr due, the sum of booking cards says ₹1.48 Cr.

## 2. Report-by-report (purpose · formula · sources · filters · drill-down · verdict)

| Report | Purpose | Formula / grain | Sources | Filters | Drill-down | Verdict |
|---|---|---|---|---|---|---|
| Collections | daybook of receipts | Cleared payments by day/mode/category | payments | date, project, block, mode, category, status | receipt → booking | ties; CSV/PDF ✔ |
| Roznamcha (day) / range | cash book | receipts + cash-in-hand + cheques pending, per day | payments, roznamcha entries | date | receipt | ties for receipts; **no refund/reversal contra lines** (see matrix D3/C4) |
| Bank receipts | bank reconciliation | Cleared non-cash by bank account | payments, bank-accounts | date, bank | receipt | ties; no "unreconciled" flag (P2) |
| Outstanding | who owes what | per booking summary + ageing buckets | bookings.summary, demands | project, block, as-of | booking | **total drifts ₹6.79 L from Σ summary** (#8); ageing from demand due dates ✔ |
| Demand vs collection | plan realisation per stage | Σ demand by block/milestone vs collected | demands, payments | project, block | — | includes cancelled bookings (P1) |
| Inventory | stock & value | counts & value by status; velocity by month | flats, bookings | project, block | flat | ties |
| Cheques | instrument register | payments with instrument | payments | status (default Pending) | receipt | design gap: default hides 89 rows; no totals by status |
| Cancellations | churn & refunds | cancelled bookings w/ refund/deduction | bookings | date | booking | refund figures never hit cash (P0, matrix C4) |
| Sales & leads | funnel & productivity | funnel counts, response hours, bookings/user, enquiries/project | leads, bookings, users | date | — | no visit→booking conversion; "Converted" self-reported |
| Activity | who did what | audit log | audit_logs | date, user, entity | entity | ✔ |
| Statement (per booking) | customer statement | three ledgers + schedule | ledger_entries, demands | — | PDF | ✔; no transfer/revision narrative lines |
| Construction progress | plan vs actual | % complete per block, demands raised | blocks, demands | project | block | ✔ |
| Service SLA | support health | tickets by status, SLA breaches | service_requests | date | ticket | ✔ |
| Advances | money received before demand | Σ paid − Σ demanded per booking (positive) | bookings.summary | — | booking | formula correct; **not shown on home** |

### Dashboard tiles (Home read model)
`units/available` ✔ · `bookings` (active count) ✔ · `agreement` Σ active ✔ · `paid` Σ cleared ✔ · `collections_mtd` ✔ · `outstanding` **FAIL** (#10) · `overdue`/`overdue_count` **FAIL** (#9) · `pending_cheques` ✔ · `counts.*` (leads_open, visits_today, cheques_pending, tickets_open, followups_due) ✔ · `collections_12m` ✔ · `ageing` **inherits #9** · `attention` list ✔ · widgets (`/dashboard/widgets`, 60 s TTL): collections trend/today/month ✔, ageing/top_overdue **inherit #9**, pending cheques ✔, bounced recent ✔, sales velocity ✔, inventory by project ✔.

## 3. Reports the business needs that do not exist or are shallow (from spec §18 + intent)
1. **Receivables forecast** (next 30/60/90 days from plan snapshots + stage ETA) — absent.
2. **Refunds & deductions register** with cash-out lines — absent (data not even in ledger).
3. **Customer ageing statement pack** (all bookings of a customer, one PDF) — statement is per booking only.
4. **Collection efficiency** (demanded vs collected within due window, per block/RM) — dvc is per stage only, no time dimension.
5. **Bounce register with charges recovered** — bounce exists; charges don't.
6. **Daily cash position / bank balance** (opening + receipts − refunds/expenses = closing) — roznamcha shows receipts only.
7. **Inventory ageing** (days unsold per flat) and **price realisation vs rate card** — partial (`realised_rates` exists in inventory report, no ageing).
8. **Sales funnel with visit conversion and source ROI** — funnel exists; no source/visit conversion.
9. **Possession readiness** (fully paid + stage 100 % + documents complete) — absent.
10. **Audit/exception report**: bookings with revisions, transfers, reversals in period — absent (activity report is flat).
11. **GST/other-charges summary** for accounts — other charges exist (gst_percent) but no tax report.
