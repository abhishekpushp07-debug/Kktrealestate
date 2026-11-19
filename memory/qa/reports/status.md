# Phase I reports — tie-out status · DB `kkt_volume` · 2026-11-19T16:32:16+05:30

## collections-v2 — DONE
- **PASS** net Jama (receipt basis, all time) == Σ cleared receipts · report=`427987735000` raw=`427987735000`
- **PASS** net Jama == Σ ledger Jama rows (receipts + reversals) · report=`427987735000` raw=`427987735000`
- **PASS** FY total (cleared basis) == raw payments by cleared date · report=`174093335000` raw=`174093335000`
- **PASS** basis label present (cleared) · report=`Date basis: cleared` raw=`Date basis: cleared`
- **PASS** FY total (receipt basis) == raw payments by receipt date · report=`203061135000` raw=`203061135000`
- **PASS** basis label present (receipt) · report=`Date basis: receipt` raw=`Date basis: receipt`
- **PASS** FY total (clearance basis) == raw payments by clearance date · report=`2864535000` raw=`2864535000`
- **PASS** basis label present (clearance) · report=`Date basis: clearance` raw=`Date basis: clearance`
- **PASS** cleared basis == legacy collections (both: cheque on its clearing day) · report=`174093335000` raw=`174093335000`
- **PASS** Σ by project == total (total_paise) · report=`427987735000` raw=`427987735000`
- **PASS** Σ by block == total (total_paise) · report=`427987735000` raw=`427987735000`
- **PASS** Σ by bucket == total (total_paise) · report=`427987735000` raw=`427987735000`
- **PASS** Σ by mode == total (total_paise) · report=`427987735000` raw=`427987735000`
- **PASS** Σ by bank == total (total_paise) · report=`427987735000` raw=`427987735000`
- **PASS** Σ by rm == total (total_paise) · report=`427987735000` raw=`427987735000`
- **PASS** Σ by day == total (total_paise) · report=`427987735000` raw=`427987735000`

## outstanding-v2 — DONE
- **PASS** outstanding == Σ definitions.outstanding(summary) · report=`117646512400` raw=`117646512400`
- **PASS** advance held == Σ definitions.advance · report=`109839870000` raw=`109839870000`
- **PASS** net == outstanding − advance == Σ Udhar − Σ Jama (received + waived) · report=`(7806642400, 7806642400)` raw=`(7806642400, 7806642400)`
- **PASS** per booking: report net == ledger net == summary net; report outstanding == summary outstanding · report=`[]` raw=`[]`
- **PASS** outstanding == Home outstanding tile · report=`117646512400` raw=`117646512400`
- **PASS** bands Σ == outstanding · report=`117646512400` raw=`117646512400`
- **PASS** report bands == Σ definitions.ageing_bands · report=`{'Not due': 7063799600, '0-30': 4099566300, '31-60': 4028544` raw=`{'Not due': 7063799600, '0-30': 4099566300, '31-60': 4028544`
- **PASS** Σ by customer == total (outstanding_paise) · report=`117646512400` raw=`117646512400`
- **PASS** Σ by customer == total (net_balance_paise) · report=`7806642400` raw=`7806642400`
- **PASS** Σ by project == total (outstanding_paise) · report=`117646512400` raw=`117646512400`
- **PASS** Σ by project == total (net_balance_paise) · report=`7806642400` raw=`7806642400`
- **PASS** Σ by block == total (outstanding_paise) · report=`117646512400` raw=`117646512400`
- **PASS** Σ by block == total (net_balance_paise) · report=`7806642400` raw=`7806642400`

## demand-vs-collection — DONE
- **PASS** demanded == Σ non-void demands on live bookings + transfer / revision adjustments · report=`409897470000` raw=`409897470000`
- **PASS** collected == Σ demand.paid (live bookings) · report=`317940830000` raw=`317940830000`
- **PASS** Include cancelled − default == bridge line Cancelled bookings · report=`787500000` raw=`787500000`

## cash-vs-account — DONE
- **PASS** cash raised == Σ summary.cash_order_raised · report=`123034945000` raw=`123034945000`
- **PASS** account received == Σ summary.account_paid · report=`310856600000` raw=`310856600000`
- **PASS** cash agreed == Σ booking.cash_agreed · report=`208895300000` raw=`208895300000`
- **PASS** Σ by project == total (cash_balance_paise) · report=`32208660000` raw=`32208660000`
- **PASS** Σ by block == total (cash_balance_paise) · report=`32208660000` raw=`32208660000`
- **PASS** new sheet == cash-vs-account (group_by=project): 8 money totals · report=`{'cash_agreed_paise': 208895300000, 'cash_raised_paise': 123` raw=`{'cash_agreed_paise': 208895300000, 'cash_raised_paise': 123`
- **PASS** new sheet == cash-vs-account (group_by=booking): 8 money totals · report=`{'cash_agreed_paise': 208895300000, 'cash_raised_paise': 123` raw=`{'cash_agreed_paise': 208895300000, 'cash_raised_paise': 123`

## cheques — DONE
- **PASS** rows == cheque/DD payments · report=`3585` raw=`3585`
- **PASS** amount == Σ instrument amounts · report=`103632100000` raw=`103632100000`
- **PASS** new sheet == cheques: 1 money totals · report=`{'amount_paise': 103632100000}` raw=`{'amount_paise': 103632100000}`

## receivables-forecast — DONE
- **PASS** Σ forecast + Σ raised == Σ agreement (live bookings) · report=`692218900000` raw=`692218900000`
- **PASS** per booking: forecast == agreement − raised · report=`0` raw=`0`
- **PASS** Σ by project == total (expected_paise) · report=`282321430000` raw=`282321430000`
- **PASS** Σ by block == total (expected_paise) · report=`282321430000` raw=`282321430000`
- **PASS** Σ by booking == total (expected_paise) · report=`282321430000` raw=`282321430000`
- **PASS** Σ by stage == total (expected_paise) · report=`282321430000` raw=`282321430000`
- **PASS** Σ by month == total (expected_paise) · report=`282321430000` raw=`282321430000`
- **PASS** default grouping is tower → stage when no planned dates · report=`True` raw=`True`
- **PASS** stage grouping: one row per tower·stage, Σ == total · report=`282321430000` raw=`282321430000`
- **PASS** new sheet == receivables-forecast (group_by=stage): 3 money totals · report=`{'cash_paise': 85860355000, 'account_paise': 196461075000, '` raw=`{'cash_paise': 85860355000, 'account_paise': 196461075000, '`
- **PASS** new sheet == receivables-forecast (group_by=booking): 3 money totals · report=`{'cash_paise': 85860355000, 'account_paise': 196461075000, '` raw=`{'cash_paise': 85860355000, 'account_paise': 196461075000, '`

## cancellations — DONE
- **PASS** rows == Cancelled bookings · report=`1` raw=`1`
- **PASS** refund paid == Σ paid refunds · report=`0` raw=`0`
- **PASS** ledger REFUND rows == Σ paid refunds · report=`0` raw=`0`
- **PASS** Σ refund payable == existing Cancellations report · report=`140000000` raw=`140000000`
- **PASS** Σ refund paid == existing Cancellations report · report=`0` raw=`0`

## bank-receipts — DONE
- **PASS** cleared == Σ non-cash receipts received (cleared day) in range · report=`311063635000` raw=`311063635000`
- **PASS** cheques in hand == Σ receipts in hand at range end · report=`26053300000` raw=`26053300000`
- **PASS** Bank-wise + Cash == Collections (one identity, to the paisa) · report=`427987735000` raw=`427987735000`
- **PASS** new sheet == bank-receipts: 3 money totals · report=`{'cleared_paise': 191064500000, 'reversed_paise': 0, 'total_` raw=`{'cleared_paise': 191064500000, 'reversed_paise': 0, 'total_`
- **PASS** Collections == Bank-wise + Cash (this FY, to the paisa) · report=`252659600000` raw=`252659600000`
- **PASS** identity has no unnamed remainder · report=`0` raw=`0`

## other-charges — DONE
- **PASS** demanded == Σ other_charges.demanded · report=`25746907400` raw=`25746907400`
- **PASS** collected == Σ other_charges.(paid − waived) · report=`57035000` raw=`57035000`
- **PASS** collected == Σ Other ledger Jama (OTHER_CHARGE_PAYMENT + Other reversals/refunds) · report=`57035000` raw=`57035000`
- **PASS** Σ by project == total (demanded_paise) · report=`25746907400` raw=`25746907400`
- **PASS** Σ by booking == total (demanded_paise) · report=`25746907400` raw=`25746907400`
- **PASS** new sheet == other-charges (group_by=charge): 4 money totals · report=`{'agreed_paise': 39710035000, 'demanded_paise': 25746907400,` raw=`{'agreed_paise': 39710035000, 'demanded_paise': 25746907400,`
- **PASS** new sheet == other-charges (group_by=booking): 4 money totals · report=`{'agreed_paise': 39710035000, 'demanded_paise': 25746907400,` raw=`{'agreed_paise': 39710035000, 'demanded_paise': 25746907400,`

## roznamcha-summary — DONE
- **PASS** cash received == Σ cleared CASH receipts · report=`116924100000` raw=`116924100000`
- **PASS** deposits == Σ contra DEPOSIT · report=`50000000` raw=`50000000`
- **PASS** closing == opening + cash in − deposits + withdrawals − cash refunds · report=`116874100000` raw=`116874100000`
- **PASS** Σ by month == range total (cash in) · report=`116924100000` raw=`116924100000`
- **PASS** monthly closing == daily closing · report=`116874100000` raw=`116874100000`

## inventory — DONE
- **PASS** units by status == flats · report=`{'Booked': 1498, 'Available': 665, 'Hold': 4, 'Blocked': 2, ` raw=`{'Booked': 1498, 'Available': 665, 'Hold': 4, 'Blocked': 2, `
- **PASS** sold value == Σ price of booked/sold flats · report=`60034425000` raw=`60034425000`

## sales-leads — DONE
- **PASS** leads == leads collection · report=`1498` raw=`1498`
- **PASS** converted == Converted leads · report=`1490` raw=`1490`

## site-visits — DONE
- **PASS** visits == site_visits · report=`74` raw=`74`
- **PASS** completed == Completed visits · report=`2` raw=`2`
- **PASS** Σ by project == total (scheduled) · report=`74` raw=`74`
- **PASS** Σ by month == total (scheduled) · report=`74` raw=`74`

## sales-team — DONE
- **PASS** sold value == Σ live agreement values · report=`692218900000` raw=`692218900000`
- **PASS** collections == Σ cleared receipts of live bookings · report=`427837735000` raw=`427837735000`
- **PASS** overdue == outstanding report overdue · report=`110582712800` raw=`110582712800`
- **PASS** Σ sold (all dates) == existing Sales team report · report=`692218900000` raw=`692218900000`
- **PASS** Σ bookings (all dates) == existing Sales team report · report=`1499` raw=`1499`

## construction-vs-plan — DONE
- **PASS** stage rows == Σ stages of active towers · report=`46` raw=`46`
- **PASS** stage demands == Σ ON_STAGE/ON_POSSESSION demands · report=`11982060000` raw=`11982060000`
- **PASS** subtotals == Σ their stage rows (demanded) · report=`11982060000` raw=`11982060000`
- **PASS** no tower name with leading/trailing space · report=`[]` raw=`[]`
- **PASS** GET /payments/demands honours block_id · report=`[]` raw=`[]`
- **PASS** Σ demanded == existing Construction vs plan · report=`11982060000` raw=`11982060000`
- **PASS** Σ collected == existing Construction vs plan · report=`9665780000` raw=`9665780000`
- **PASS** Σ balance == existing Construction vs plan · report=`2316280000` raw=`2316280000`

## service-sla — DONE
- **PASS** tickets == service_requests · report=`200` raw=`200`
- **PASS** requests / open / resolved == existing Service requests & SLA · report=`(200, 198, 2)` raw=`(200, 198, 2)`

## activity — DONE
- **PASS** audit actions == audit_logs (live log) · report=`60045` raw=`60045`

## data-quality — DONE
- **PASS** open demands on cancelled bookings == 0 (integrity) · report=`0` raw=`0`
- **PASS** towers without stage plan excludes inactive towers · report=`0` raw=`0`
- **PASS** payment plans not summing 100 == 0 · report=`0` raw=`0`
- **PASS** integrity report ok · report=`True` raw=`True`

## customer-status — DONE
- **PASS** Σ Account dues + Σ Cash dues == instalment outstanding · report=`91956640000` raw=`91956640000`
- **PASS** rows == live bookings · report=`1499` raw=`1499`
- **PASS** Σ bills raised == Σ Cash + Account order raised · report=`409897470000` raw=`409897470000`
- **PASS** formula: raised − received − waived + advance == dues · report=`91956640000` raw=`91956640000`
- **PASS** final status kind == customer card, every booking · report=`0` raw=`0`
- **PASS** overdue days == customer card, every booking · report=`0` raw=`0`
- **PASS** ledger share state today == booking summary (as-of path) · report=`0` raw=`0`
- **PASS** as of 2026-03-31: instalment net dues == ledger rows dated on / before that day · report=`-172343600000` raw=`-172343600000`
- **PASS** as of 2026-03-31 instalment net + other-charge net == carried from before at 2026-04-01 · report=`-172278995000` raw=`-172278995000`
- **PASS** Σ project subtotals == total dues · report=`91956640000` raw=`91956640000`
- **PASS** Σ tower subtotals == project subtotal · report=`6` raw=`6`
- **PASS** formula bridge: total due == Overdue & ageing total due · report=`117646512400` raw=`117646512400`
- **PASS** Customer status bridge line == Bills vs Collection · report=`409897470000` raw=`409897470000`

## customer-ageing — DONE
- **PASS** Σ bands == Σ total due · report=`117646512400` raw=`117646512400`
- **PASS** Σ total due == Σ outstanding (definitions) of live bookings · report=`117646512400` raw=`117646512400`
- **PASS** rows == live bookings with dues · report=`1497` raw=`1497`
- **PASS** Σ total due == Outstanding & ageing report total · report=`117646512400` raw=`117646512400`

## advance-holders — DONE
- **PASS** Σ advance == Σ booking advance (definitions) · report=`109839870000` raw=`109839870000`

## call-list — DONE
- **PASS** Σ due == ageing Σ total due · report=`117646512400` raw=`117646512400`
- **PASS** Σ overdue == ageing Σ overdue · report=`110582712800` raw=`110582712800`
- **PASS** sorted oldest first · report=`True` raw=`True`

## kyc-pending — DONE
- **PASS** agreement pending == live bookings without signed agreement · report=`0` raw=`0`

## payment-behaviour — DONE
- **PASS** customers == customers with live bookings · report=`1490` raw=`1490`
- **PASS** on time ≤ bills due on every row · report=`True` raw=`True`

## customer-directory — DONE
- **PASS** rows == customers (not deleted) · report=`1975` raw=`1975`

## cancelled-customers — DONE
- **PASS** Σ refund payable == Σ cancellation refund · report=`140000000` raw=`140000000`
- **PASS** Σ refund paid == Σ refunds paid on cancelled bookings · report=`0` raw=`0`

## customer-statement — DONE
- **PASS** bills − received − waived == Σ last running balance · report=`163945300` raw=`163945300`
- **PASS** Σ bills == Σ booking Udhar · report=`466745300` raw=`466745300`

## collections — DONE
- **PASS** new sheet == collections-v2 (group_by=month): 7 money totals · report=`{'cash_paise': 61595100000, 'account_paise': 191058500000, '` raw=`{'cash_paise': 61595100000, 'account_paise': 191058500000, '`
- **PASS** new sheet == collections-v2 (group_by=receipt): 7 money totals · report=`{'cash_paise': 61595100000, 'account_paise': 191058500000, '` raw=`{'cash_paise': 61595100000, 'account_paise': 191058500000, '`
- **PASS** period 2026-04-01…2026-09-30 == existing report same period · report=`154139200000` raw=`154139200000`
- **PASS** identity: bank modes + cash mode == Collections · report=`252659600000` raw=`252659600000`
- **PASS** cheques in hand line == Bank-wise cheques in hand · report=`26053300000` raw=`26053300000`

## day-book — DONE
- **PASS** new sheet == roznamcha-summary (group_by=month): 5 money totals · report=`{'cash_in_paise': 61595100000, 'bank_in_paise': 161816400000` raw=`{'cash_in_paise': 61595100000, 'bank_in_paise': 161816400000`
- **PASS** new sheet == roznamcha-summary (group_by=day): 5 money totals · report=`{'cash_in_paise': 61595100000, 'bank_in_paise': 161816400000` raw=`{'cash_in_paise': 61595100000, 'bank_in_paise': 161816400000`

## bills-vs-collection — DONE
- **PASS** new sheet == demand-vs-collection: 5 money totals · report=`{'cash_demand_paise': 123034945000, 'account_demand_paise': ` raw=`{'cash_demand_paise': 123034945000, 'account_demand_paise': `
- **PASS** default bill raised == Customer status bills raised · report=`409897470000` raw=`409897470000`
- **PASS** default view has no cancelled bookings · report=`0` raw=`0`

## outstanding — DONE
- **PASS** new sheet == outstanding-v2 (group_by=project): 7 money totals · report=`{'udhar_paise': 435644377400, 'jama_paise': 427837735000, 'w` raw=`{'udhar_paise': 435644377400, 'jama_paise': 427837735000, 'w`
- **PASS** new sheet == outstanding-v2 (group_by=booking): 7 money totals · report=`{'udhar_paise': 435644377400, 'jama_paise': 427837735000, 'w` raw=`{'udhar_paise': 435644377400, 'jama_paise': 427837735000, 'w`
- **PASS** filtered by one project == existing report filtered the same way · report=`3243427100` raw=`3243427100`

## waivers — DONE
- **PASS** new sheet == waiver-register: 2 money totals · report=`{'amount_paise': 0, 'gst_paise': 0}` raw=`{'amount_paise': 0, 'gst_paise': 0}`

## booking-register — DONE
- **PASS** Σ agreement value (Active + Completed) == bookings collection · report=`692218900000` raw=`692218900000`

## sales-summary — DONE
- **PASS** Σ bookings this FY == booking register (not cancelled) this FY · report=`357` raw=`357`
- **PASS** Σ agreement value this FY == booking register this FY · report=`166217800000` raw=`166217800000`

## discount-register — DONE
- **PASS** Σ discount (all dates) == existing Discount register · report=`77125000` raw=`77125000`
- **PASS** Σ discount (all dates) == booking register discount (Active + Completed) · report=`77125000` raw=`77125000`

## plan-position — DONE
- **PASS** Σ bills raised == Customer status · report=`409897470000` raw=`409897470000`
- **PASS** Σ received == Customer status Account + Cash received · report=`427780700000` raw=`427780700000`

## agreements — DONE
- **PASS** signed + pending == live bookings · report=`1499` raw=`1499`
- **PASS** signed == live bookings with an accepted plan · report=`1499` raw=`1499`

## transfers — DONE
- **PASS** changes == transfers + revisions + price events on bookings + plan changes in audit log (bookings that exist) · report=`2` raw=`2`

## realised-rate — DONE
- **PASS** Σ agreement value == Plan & stage position · report=`692218900000` raw=`692218900000`
- **PASS** Σ list − Σ agreement == Σ discount · report=`77125000` raw=`77125000`

## booking-health — DONE
- **PASS** Σ overdue == Customer status overdue · report=`110582712800` raw=`110582712800`
- **PASS** Σ total due == Customer status total due · report=`117646512400` raw=`117646512400`
- **PASS** healthy + watch + at risk == live bookings · report=`1499` raw=`1499`

## project-statement — DONE
- **PASS** SGH Σ bill raised == existing Project statement · report=`22590862100` raw=`22590862100`
- **PASS** SGH Σ received == existing Project statement · report=`63858235000` raw=`63858235000`
- **PASS** SGH Σ balance signed == existing Project statement · report=`41267372900` raw=`41267372900`

## inventory-status — DONE
- **PASS** Available flats (real layer) == existing Inventory control · report=`665` raw=`665`
- **PASS** Hold flats (real layer) == existing Inventory control · report=`4` raw=`4`
- **PASS** Blocked flats (real layer) == existing Inventory control · report=`2` raw=`2`
- **PASS** Booked flats (real layer) == existing Inventory control · report=`1498` raw=`1498`
- **PASS** Sold flats (real layer) == existing Inventory control · report=`1` raw=`1`
- **PASS** Available flats for a display-layer viewer == shown-as available in Inventory control · report=`665` raw=`665`
- **PASS** Hold flats for a display-layer viewer == shown-as hold in Inventory control · report=`4` raw=`4`
- **PASS** Sold flats for a display-layer viewer == shown-as sold in Inventory control · report=`1501` raw=`1501`
- **PASS** display-layer viewer sees no Booked / Blocked · report=`0` raw=`0`
- **PASS** Available flats for Sales (display layer) == shown-as available in Inventory control · report=`665` raw=`665`
- **PASS** Hold flats for Sales (display layer) == shown-as hold in Inventory control · report=`4` raw=`4`
- **PASS** Sold flats for Sales (display layer) == shown-as sold in Inventory control · report=`1501` raw=`1501`

## stacking-plan — DONE
- **PASS** cells == flats in Inventory status · report=`2170` raw=`2170`

## price-list — DONE
- **PASS** Σ list price of available flats == existing Inventory available value · report=`25078350000` raw=`25078350000`
- **PASS** unsold == available + hold in Inventory status · report=`669` raw=`669`

## hold-register — DONE
- **PASS** active holds == flats on Hold in the flats master · report=`4` raw=`4`
- **PASS** holds == existing Hold register active holds · report=`4` raw=`4`
- **PASS** lapsing within 48 h == existing Hold register expiring · report=`0` raw=`0`

## landowner — DONE
- **PASS** landowner units == existing Landowner share · report=`0` raw=`0`
- **PASS** masked units == existing Masked inventory · report=`0` raw=`0`

## parking — DONE
- **PASS** Allotted slots == parking slots master · report=`6` raw=`6`
- **PASS** Available slots == parking slots master · report=`126` raw=`126`

## stage-bills — DONE
- **PASS** Σ bills raised == Customer status · report=`409897470000` raw=`409897470000`
- **PASS** Σ received == Customer status Account + Cash · report=`427780700000` raw=`427780700000`
- **PASS** Σ instalment dues == Customer status · report=`91956640000` raw=`91956640000`

## sales-velocity — DONE
- **PASS** Σ unsold == Inventory status available + hold · report=`669` raw=`669`
- **PASS** Σ booked in the last 12 months == booking register same window · report=`569` raw=`569`

## lead-funnel — DONE
- **PASS** New (this FY) == existing Sales & leads funnel · report=`2` raw=`2`
- **PASS** Contacted (this FY) == existing Sales & leads funnel · report=`2` raw=`2`
- **PASS** Site Visit Scheduled (this FY) == existing Sales & leads funnel · report=`1` raw=`1`
- **PASS** Site Visit Done (this FY) == existing Sales & leads funnel · report=`1` raw=`1`
- **PASS** Negotiation (this FY) == existing Sales & leads funnel · report=`1` raw=`1`
- **PASS** Converted (this FY) == existing Sales & leads funnel · report=`1490` raw=`1490`
- **PASS** Lost (this FY) == existing Sales & leads funnel · report=`1` raw=`1`
- **PASS** Σ leads (this FY) == existing Sales & leads · report=`1498` raw=`1498`

## source-performance — DONE
- **PASS** Website leads / converted == existing Sales & leads · report=`(2, 0)` raw=`(2, 0)`
- **PASS** Walk-in leads / converted == existing Sales & leads · report=`(1492, 1490)` raw=`(1492, 1490)`
- **PASS** Referral leads / converted == existing Sales & leads · report=`(2, 0)` raw=`(2, 0)`
- **PASS** Broker leads / converted == existing Sales & leads · report=`(1, 0)` raw=`(1, 0)`
- **PASS** Campaign leads / converted == existing Sales & leads · report=`(1, 0)` raw=`(1, 0)`

## lead-register — DONE
- **PASS** leads == leads master (live) · report=`1498` raw=`1498`

## follow-ups — DONE
- **PASS** overdue == existing Sales & leads follow-ups overdue (all dates) · report=`3` raw=`3`

## visit-register — DONE
- **PASS** completed / no-show / cancelled (this FY) == existing Site visit conversion · report=`(2, 1, 0)` raw=`(2, 1, 0)`
- **PASS** visits (this FY) == existing scheduled · report=`9` raw=`9`
- **PASS** booked after visit (this FY) == existing converted · report=`0` raw=`0`

## visit-conversion — DONE
- **PASS** scheduled / completed / booked == existing Site visit conversion · report=`(9, 2, 0)` raw=`(9, 2, 0)`

## lost-leads — DONE
- **PASS** lost == leads master status Lost · report=`1` raw=`1`

## response-time — DONE
- **PASS** responded + not yet == leads this FY (Lead funnel) · report=`1498` raw=`1498`
- **PASS** average first response (this FY) == existing Sales & leads avg_response_hours · report=`-1.6` raw=`-1.6`

## lead-ageing — DONE
- **PASS** open leads == leads master open stages · report=`7` raw=`7`

## team-pipeline — DONE
- **PASS** Σ open == Lead ageing open leads · report=`7` raw=`7`
- **PASS** Σ follow-ups overdue == Follow-ups overdue · report=`3` raw=`3`

**217/217 PASS**
