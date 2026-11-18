# Phase I reports — tie-out status · DB `test_database` · 2026-11-18T12:47:44+05:30

## collections-v2 — DONE
- **PASS** net Jama (receipt basis, all time) == Σ cleared receipts · report=`37948222000` raw=`37948222000`
- **PASS** net Jama == Σ ledger Jama rows (receipts + reversals) · report=`37948222000` raw=`37948222000`
- **PASS** FY total (receipt basis) == raw payments by receipt date · report=`17513355400` raw=`17513355400`
- **PASS** basis label present (receipt) · report=`Date basis: receipt date` raw=`Date basis: receipt date`
- **PASS** FY total (clearance basis) == raw payments by clearance date · report=`17513355400` raw=`17513355400`
- **PASS** basis label present (clearance) · report=`Date basis: clearance date` raw=`Date basis: clearance date`
- **PASS** receipt basis == legacy collections (payment_date, Cleared) · report=`17513355400` raw=`17513355400`
- **PASS** Σ by project == total (total_paise) · report=`37948222000` raw=`37948222000`
- **PASS** Σ by block == total (total_paise) · report=`37948222000` raw=`37948222000`
- **PASS** Σ by bucket == total (total_paise) · report=`37948222000` raw=`37948222000`
- **PASS** Σ by mode == total (total_paise) · report=`37948222000` raw=`37948222000`
- **PASS** Σ by bank == total (total_paise) · report=`37948222000` raw=`37948222000`
- **PASS** Σ by rm == total (total_paise) · report=`37948222000` raw=`37948222000`
- **PASS** Σ by day == total (total_paise) · report=`37948222000` raw=`37948222000`

## outstanding-v2 — DONE
- **PASS** outstanding == Σ definitions.outstanding(summary) · report=`4497664300` raw=`4497664300`
- **PASS** advance held == Σ definitions.advance · report=`73622600` raw=`73622600`
- **PASS** net == outstanding − advance == Σ Udhar − Σ Jama (received + waived) · report=`(4424041700, 4424041700)` raw=`(4424041700, 4424041700)`
- **PASS** per booking: report net == ledger net == summary net; report outstanding == summary outstanding · report=`[]` raw=`[]`
- **PASS** outstanding == Home outstanding tile · report=`4497664300` raw=`4497664300`
- **PASS** bands Σ == outstanding · report=`4497664300` raw=`4497664300`
- **PASS** report bands == Σ definitions.ageing_bands · report=`{'Not due': 2385916200, '0-30': 445882700, '31-60': 29413220` raw=`{'Not due': 2385916200, '0-30': 445882700, '31-60': 29413220`
- **PASS** Σ by customer == total (outstanding_paise) · report=`4497664300` raw=`4497664300`
- **PASS** Σ by customer == total (net_balance_paise) · report=`4424041700` raw=`4424041700`
- **PASS** Σ by project == total (outstanding_paise) · report=`4497664300` raw=`4497664300`
- **PASS** Σ by project == total (net_balance_paise) · report=`4424041700` raw=`4424041700`
- **PASS** Σ by block == total (outstanding_paise) · report=`4497664300` raw=`4497664300`
- **PASS** Σ by block == total (net_balance_paise) · report=`4424041700` raw=`4424041700`

## demand-vs-collection — DONE
- **PASS** demanded == Σ non-void demands · report=`38062956400` raw=`38062956400`
- **PASS** collected == Σ demand.paid · report=`34088638300` raw=`34088638300`

## cash-vs-account — DONE
- **PASS** cash raised == Σ summary.cash_order_raised · report=`16358874700` raw=`16358874700`
- **PASS** account received == Σ summary.account_paid · report=`19761301500` raw=`19761301500`
- **PASS** cash agreed == Σ booking.cash_agreed · report=`23689818500` raw=`23689818500`
- **PASS** Σ by project == total (cash_balance_paise) · report=`2063084700` raw=`2063084700`
- **PASS** Σ by block == total (cash_balance_paise) · report=`2063084700` raw=`2063084700`
- **PASS** new sheet == cash-vs-account (group_by=project): 8 money totals · report=`{'cash_agreed_paise': 23689818500, 'cash_raised_paise': 1635` raw=`{'cash_agreed_paise': 23689818500, 'cash_raised_paise': 1635`
- **PASS** new sheet == cash-vs-account (group_by=booking): 8 money totals · report=`{'cash_agreed_paise': 23689818500, 'cash_raised_paise': 1635` raw=`{'cash_agreed_paise': 23689818500, 'cash_raised_paise': 1635`

## cheques — DONE
- **PASS** rows == cheque/DD payments · report=`144` raw=`144`
- **PASS** amount == Σ instrument amounts · report=`5329442800` raw=`5329442800`
- **PASS** new sheet == cheques: 1 money totals · report=`{'amount_paise': 5329442800}` raw=`{'amount_paise': 5329442800}`

## receivables-forecast — DONE
- **PASS** Σ forecast + Σ raised == Σ agreement (live bookings) · report=`50630770000` raw=`50630770000`
- **PASS** per booking: forecast == agreement − raised · report=`0` raw=`0`
- **PASS** Σ by project == total (expected_paise) · report=`12613790500` raw=`12613790500`
- **PASS** Σ by block == total (expected_paise) · report=`12613790500` raw=`12613790500`
- **PASS** Σ by booking == total (expected_paise) · report=`12613790500` raw=`12613790500`
- **PASS** Σ by stage == total (expected_paise) · report=`12613790500` raw=`12613790500`
- **PASS** Σ by month == total (expected_paise) · report=`12613790500` raw=`12613790500`
- **PASS** default grouping is tower → stage when no planned dates · report=`True` raw=`True`
- **PASS** stage grouping: one row per tower·stage, Σ == total · report=`12613790500` raw=`12613790500`
- **PASS** new sheet == receivables-forecast (group_by=stage): 3 money totals · report=`{'cash_paise': 7330943775, 'account_paise': 5282846725, 'exp` raw=`{'cash_paise': 7330943775, 'account_paise': 5282846725, 'exp`
- **PASS** new sheet == receivables-forecast (group_by=booking): 3 money totals · report=`{'cash_paise': 7330943775, 'account_paise': 5282846725, 'exp` raw=`{'cash_paise': 7330943775, 'account_paise': 5282846725, 'exp`

## cancellations — DONE
- **PASS** rows == Cancelled bookings · report=`2` raw=`2`
- **PASS** refund paid == Σ paid refunds · report=`42289200` raw=`42289200`
- **PASS** ledger REFUND rows == Σ paid refunds · report=`42289200` raw=`42289200`
- **PASS** Σ refund payable == existing Cancellations report · report=`42289200` raw=`42289200`
- **PASS** Σ refund paid == existing Cancellations report · report=`42289200` raw=`42289200`

## bank-receipts — DONE
- **PASS** cleared == Σ non-cash cleared · report=`28918736200` raw=`28918736200`
- **PASS** pending == Σ non-cash pending · report=`4000000` raw=`4000000`
- **PASS** new sheet == bank-receipts: 3 money totals · report=`{'cleared_paise': 14600783900, 'pending_paise': 4000000, 'to` raw=`{'cleared_paise': 14600783900, 'pending_paise': 4000000, 'to`
- **PASS** Collections == Bank-wise total − pending + cash receipts − reversals (this FY, to the paisa) · report=`20434866600` raw=`20434866600`
- **PASS** bridge has no unexplained remainder · report=`0` raw=`0`

## other-charges — DONE
- **PASS** demanded == Σ other_charges.demanded · report=`4266533200` raw=`4266533200`
- **PASS** collected == Σ other_charges.(paid − waived) · report=`3757202700` raw=`3757202700`
- **PASS** collected == Σ Other ledger Jama (OTHER_CHARGE_PAYMENT + Other reversals/refunds) · report=`3757202700` raw=`3757202700`
- **PASS** Σ by project == total (demanded_paise) · report=`4266533200` raw=`4266533200`
- **PASS** Σ by booking == total (demanded_paise) · report=`4266533200` raw=`4266533200`
- **PASS** new sheet == other-charges (group_by=charge): 4 money totals · report=`{'agreed_paise': 5663441200, 'demanded_paise': 4266533200, '` raw=`{'agreed_paise': 5663441200, 'demanded_paise': 4266533200, '`
- **PASS** new sheet == other-charges (group_by=booking): 4 money totals · report=`{'agreed_paise': 5663441200, 'demanded_paise': 4266533200, '` raw=`{'agreed_paise': 5663441200, 'demanded_paise': 4266533200, '`

## roznamcha-summary — DONE
- **PASS** cash received == Σ cleared CASH receipts · report=`9029485800` raw=`9029485800`
- **PASS** deposits == Σ contra DEPOSIT · report=`9095500000` raw=`9095500000`
- **PASS** closing == opening + cash in − deposits + withdrawals − cash refunds · report=`-66014200` raw=`-66014200`
- **PASS** Σ by month == range total (cash in) · report=`9029485800` raw=`9029485800`
- **PASS** monthly closing == daily closing · report=`-66014200` raw=`-66014200`

## inventory — DONE
- **PASS** units by status == flats · report=`{'Available': 102, 'Blocked': 1, 'Booked': 79, 'Hold': 3, 'S` raw=`{'Available': 102, 'Blocked': 1, 'Booked': 79, 'Hold': 3, 'S`
- **PASS** sold value == Σ price of booked/sold flats · report=`50655770000` raw=`50655770000`

## sales-leads — DONE
- **PASS** leads == leads collection · report=`135` raw=`135`
- **PASS** converted == Converted leads · report=`92` raw=`92`

## site-visits — DONE
- **PASS** visits == site_visits · report=`87` raw=`87`
- **PASS** completed == Completed visits · report=`83` raw=`83`
- **PASS** Σ by project == total (scheduled) · report=`87` raw=`87`
- **PASS** Σ by month == total (scheduled) · report=`87` raw=`87`

## sales-team — DONE
- **PASS** sold value == Σ live agreement values · report=`50630770000` raw=`50630770000`
- **PASS** collections == Σ cleared receipts of live bookings · report=`37856346000` raw=`37856346000`
- **PASS** overdue == outstanding report overdue · report=`2111748100` raw=`2111748100`
- **PASS** Σ sold (all dates) == existing Sales team report · report=`50630770000` raw=`50630770000`
- **PASS** Σ bookings (all dates) == existing Sales team report · report=`80` raw=`80`

## construction-vs-plan — DONE
- **PASS** stage rows == Σ stages of active towers · report=`57` raw=`57`
- **PASS** stage demands == Σ ON_STAGE/ON_POSSESSION demands · report=`31627242400` raw=`31627242400`
- **PASS** subtotals == Σ their stage rows (demanded) · report=`31627242400` raw=`31627242400`
- **PASS** no tower name with leading/trailing space · report=`[]` raw=`[]`
- **PASS** GET /payments/demands honours block_id · report=`[]` raw=`[]`
- **PASS** Σ demanded == existing Construction vs plan · report=`31627242400` raw=`31627242400`
- **PASS** Σ collected == existing Construction vs plan · report=`27693829300` raw=`27693829300`
- **PASS** Σ balance == existing Construction vs plan · report=`3933413100` raw=`3933413100`

## service-sla — DONE
- **PASS** tickets == service_requests · report=`14` raw=`14`
- **PASS** requests / open / resolved == existing Service requests & SLA · report=`(14, 8, 6)` raw=`(14, 8, 6)`

## activity — DONE
- **PASS** audit actions == audit_logs (live log) · report=`169190` raw=`169190`

## data-quality — DONE
- **PASS** open demands on cancelled bookings == 0 (integrity) · report=`0` raw=`0`
- **PASS** towers without stage plan excludes inactive towers · report=`0` raw=`0`
- **PASS** payment plans not summing 100 == 0 · report=`0` raw=`0`
- **PASS** integrity report ok · report=`True` raw=`True`

## customer-status — DONE
- **PASS** Σ Account dues + Σ Cash dues == instalment outstanding · report=`3988958800` raw=`3988958800`
- **PASS** rows == live bookings · report=`80` raw=`80`
- **PASS** Σ bills raised == Σ Cash + Account order raised · report=`38016979500` raw=`38016979500`
- **PASS** formula: raised − received − waived + advance == dues · report=`3988958800` raw=`3988958800`
- **PASS** final status kind == customer card, every booking · report=`0` raw=`0`
- **PASS** overdue days == customer card, every booking · report=`0` raw=`0`
- **PASS** ledger share state today == booking summary (as-of path) · report=`0` raw=`0`
- **PASS** as of 2026-03-31: instalment net dues == ledger rows on that day · report=`1592227100` raw=`1592227100`
- **PASS** as of 2026-03-31 instalment net + other-charge net == carried from before at 2026-04-01 · report=`1934453800` raw=`1934453800`
- **PASS** Σ project subtotals == total dues · report=`3988958800` raw=`3988958800`
- **PASS** Σ tower subtotals == project subtotal · report=`2` raw=`2`
- **PASS** formula bridge: total due == Overdue & ageing total due · report=`4497664300` raw=`4497664300`
- **PASS** Customer status bridge line == Bills vs Collection bridge · report=`(38062956400, 44888000, -1088900)` raw=`(38062956400, 44888000, -1088900)`

## customer-ageing — DONE
- **PASS** Σ bands == Σ total due · report=`4497664300` raw=`4497664300`
- **PASS** Σ total due == Σ outstanding (definitions) of live bookings · report=`4497664300` raw=`4497664300`
- **PASS** rows == live bookings with dues · report=`42` raw=`42`
- **PASS** Σ total due == Outstanding & ageing report total · report=`4497664300` raw=`4497664300`

## advance-holders — DONE
- **PASS** Σ advance == Σ booking advance (definitions) · report=`73622600` raw=`73622600`

## call-list — DONE
- **PASS** Σ due == ageing Σ total due · report=`4497664300` raw=`4497664300`
- **PASS** Σ overdue == ageing Σ overdue · report=`2111748100` raw=`2111748100`
- **PASS** sorted oldest first · report=`True` raw=`True`

## kyc-pending — DONE
- **PASS** agreement pending == live bookings without signed agreement · report=`0` raw=`0`

## payment-behaviour — DONE
- **PASS** customers == customers with live bookings · report=`80` raw=`80`
- **PASS** on time ≤ bills due on every row · report=`True` raw=`True`

## customer-directory — DONE
- **PASS** rows == customers (not deleted) · report=`82` raw=`82`

## cancelled-customers — DONE
- **PASS** Σ refund payable == Σ cancellation refund · report=`42289200` raw=`42289200`
- **PASS** Σ refund paid == Σ refunds paid on cancelled bookings · report=`42289200` raw=`42289200`

## customer-statement — DONE
- **PASS** bills − received − waived == Σ last running balance · report=`423135400` raw=`423135400`
- **PASS** Σ bills == Σ booking Udhar · report=`425760400` raw=`425760400`

## collections — DONE
- **PASS** new sheet == collections-v2 (group_by=month): 5 money totals · report=`{'cash_paise': 9438250900, 'account_paise': 9176222400, 'oth` raw=`{'cash_paise': 9438250900, 'account_paise': 9176222400, 'oth`
- **PASS** new sheet == collections-v2 (group_by=receipt): 5 money totals · report=`{'cash_paise': 9438250900, 'account_paise': 9176222400, 'oth` raw=`{'cash_paise': 9438250900, 'account_paise': 9176222400, 'oth`
- **PASS** period 2026-04-01…2026-09-30 == existing report same period · report=`15331664100` raw=`15331664100`

## day-book — DONE
- **PASS** new sheet == roznamcha-summary (group_by=month): 5 money totals · report=`{'cash_in_paise': 5834082700, 'bank_in_paise': 14600783900, ` raw=`{'cash_in_paise': 5834082700, 'bank_in_paise': 14600783900, `
- **PASS** new sheet == roznamcha-summary (group_by=day): 5 money totals · report=`{'cash_in_paise': 5834082700, 'bank_in_paise': 14600783900, ` raw=`{'cash_in_paise': 5834082700, 'bank_in_paise': 14600783900, `

## bills-vs-collection — DONE
- **PASS** new sheet == demand-vs-collection: 4 money totals · report=`{'cash_demand_paise': 16401537100, 'account_demand_paise': 2` raw=`{'cash_demand_paise': 16401537100, 'account_demand_paise': 2`
- **PASS** bill raised − on cancelled/transferred ± transfer adjustments == Customer status bills raised · report=`38016979500` raw=`38016979500`

## outstanding — DONE
- **PASS** new sheet == outstanding-v2 (group_by=project): 7 money totals · report=`{'udhar_paise': 42283512700, 'jama_paise': 37856346000, 'wai` raw=`{'udhar_paise': 42283512700, 'jama_paise': 37856346000, 'wai`
- **PASS** new sheet == outstanding-v2 (group_by=booking): 7 money totals · report=`{'udhar_paise': 42283512700, 'jama_paise': 37856346000, 'wai` raw=`{'udhar_paise': 42283512700, 'jama_paise': 37856346000, 'wai`
- **PASS** filtered by one project == existing report filtered the same way · report=`158437200` raw=`158437200`

## waivers — DONE
- **PASS** new sheet == waiver-register: 2 money totals · report=`{'amount_paise': 4700000, 'gst_paise': 125000}` raw=`{'amount_paise': 4700000, 'gst_paise': 125000}`

## booking-register — DONE
- **PASS** Σ agreement value (Active + Completed) == bookings collection · report=`50630770000` raw=`50630770000`

## sales-summary — DONE
- **PASS** Σ bookings this FY == booking register (not cancelled) this FY · report=`26` raw=`26`
- **PASS** Σ agreement value this FY == booking register this FY · report=`15485610000` raw=`15485610000`

## discount-register — DONE
- **PASS** Σ discount (all dates) == existing Discount register · report=`28630000` raw=`28630000`
- **PASS** Σ discount (all dates) == booking register discount (Active + Completed) · report=`28630000` raw=`28630000`

## plan-position — DONE
- **PASS** Σ bills raised == Customer status · report=`38016979500` raw=`38016979500`
- **PASS** Σ received == Customer status Account + Cash received · report=`34099143300` raw=`34099143300`

## agreements — DONE
- **PASS** signed + pending == live bookings · report=`80` raw=`80`
- **PASS** signed == live bookings with an accepted plan · report=`80` raw=`80`

## transfers — DONE
- **PASS** changes == transfers + revisions + price events on bookings + plan changes in audit log (bookings that exist) · report=`7` raw=`7`

## realised-rate — DONE
- **PASS** Σ agreement value == Plan & stage position · report=`50630770000` raw=`50630770000`
- **PASS** Σ list − Σ agreement == Σ discount · report=`28630000` raw=`28630000`

## booking-health — DONE
- **PASS** Σ overdue == Customer status overdue · report=`2111748100` raw=`2111748100`
- **PASS** Σ total due == Customer status total due · report=`4497664300` raw=`4497664300`
- **PASS** healthy + watch + at risk == live bookings · report=`80` raw=`80`

## project-statement — DONE
- **PASS** SGH Σ bill raised == existing Project statement · report=`29169133100` raw=`29169133100`
- **PASS** SGH Σ received == existing Project statement · report=`24900403600` raw=`24900403600`
- **PASS** SGH Σ balance signed == existing Project statement · report=`-4265604500` raw=`-4265604500`

## inventory-status — DONE
- **PASS** Available flats (real layer) == existing Inventory control · report=`102` raw=`102`
- **PASS** Hold flats (real layer) == existing Inventory control · report=`3` raw=`3`
- **PASS** Blocked flats (real layer) == existing Inventory control · report=`1` raw=`1`
- **PASS** Booked flats (real layer) == existing Inventory control · report=`79` raw=`79`
- **PASS** Sold flats (real layer) == existing Inventory control · report=`1` raw=`1`
- **PASS** Available flats for a display-layer viewer == shown-as available in Inventory control · report=`102` raw=`102`
- **PASS** Hold flats for a display-layer viewer == shown-as hold in Inventory control · report=`3` raw=`3`
- **PASS** Sold flats for a display-layer viewer == shown-as sold in Inventory control · report=`81` raw=`81`
- **PASS** display-layer viewer sees no Booked / Blocked · report=`0` raw=`0`
- **PASS** Available flats for Sales (display layer) == shown-as available in Inventory control · report=`102` raw=`102`
- **PASS** Hold flats for Sales (display layer) == shown-as hold in Inventory control · report=`3` raw=`3`
- **PASS** Sold flats for Sales (display layer) == shown-as sold in Inventory control · report=`81` raw=`81`

## stacking-plan — DONE
- **PASS** cells == flats in Inventory status · report=`186` raw=`186`

## price-list — DONE
- **PASS** Σ list price of available flats == existing Inventory available value · report=`58403910000` raw=`58403910000`
- **PASS** unsold == available + hold in Inventory status · report=`105` raw=`105`

## hold-register — DONE
- **PASS** active holds == flats on Hold in the flats master · report=`3` raw=`3`
- **PASS** holds == existing Hold register active holds · report=`3` raw=`3`
- **PASS** lapsing within 48 h == existing Hold register expiring · report=`1` raw=`1`

## landowner — DONE
- **PASS** landowner units == existing Landowner share · report=`0` raw=`0`
- **PASS** masked units == existing Masked inventory · report=`0` raw=`0`

## parking — DONE
- **PASS** Allotted slots == parking slots master · report=`37` raw=`37`
- **PASS** Attached slots == parking slots master · report=`2` raw=`2`
- **PASS** Available slots == parking slots master · report=`93` raw=`93`

## stage-bills — DONE
- **PASS** Σ bills raised == Customer status · report=`38016979500` raw=`38016979500`
- **PASS** Σ received == Customer status Account + Cash · report=`34099143300` raw=`34099143300`
- **PASS** Σ instalment dues == Customer status · report=`3988958800` raw=`3988958800`

## sales-velocity — DONE
- **PASS** Σ unsold == Inventory status available + hold · report=`105` raw=`105`
- **PASS** Σ booked in the last 12 months == booking register same window · report=`44` raw=`44`

## lead-funnel — DONE
- **PASS** New (this FY) == existing Sales & leads funnel · report=`7` raw=`7`
- **PASS** Contacted (this FY) == existing Sales & leads funnel · report=`6` raw=`6`
- **PASS** Site Visit Scheduled (this FY) == existing Sales & leads funnel · report=`6` raw=`6`
- **PASS** Site Visit Done (this FY) == existing Sales & leads funnel · report=`1` raw=`1`
- **PASS** Negotiation (this FY) == existing Sales & leads funnel · report=`4` raw=`4`
- **PASS** Converted (this FY) == existing Sales & leads funnel · report=`35` raw=`35`
- **PASS** Lost (this FY) == existing Sales & leads funnel · report=`5` raw=`5`
- **PASS** Σ leads (this FY) == existing Sales & leads · report=`64` raw=`64`

## source-performance — DONE
- **PASS** Website leads / converted == existing Sales & leads · report=`(13, 4)` raw=`(13, 4)`
- **PASS** Walk-in leads / converted == existing Sales & leads · report=`(21, 17)` raw=`(21, 17)`
- **PASS** Brochure leads / converted == existing Sales & leads · report=`(7, 3)` raw=`(7, 3)`
- **PASS** Referral leads / converted == existing Sales & leads · report=`(10, 5)` raw=`(10, 5)`
- **PASS** Broker leads / converted == existing Sales & leads · report=`(10, 6)` raw=`(10, 6)`
- **PASS** Campaign leads / converted == existing Sales & leads · report=`(3, 0)` raw=`(3, 0)`

## lead-register — DONE
- **PASS** leads == leads master (live) · report=`135` raw=`135`

## follow-ups — DONE
- **PASS** overdue == existing Sales & leads follow-ups overdue (all dates) · report=`1` raw=`1`

## visit-register — DONE
- **PASS** completed / no-show / cancelled (this FY) == existing Site visit conversion · report=`(24, 1, 1)` raw=`(24, 1, 1)`
- **PASS** visits (this FY) == existing scheduled · report=`27` raw=`27`
- **PASS** booked after visit (this FY) == existing converted · report=`23` raw=`23`

## visit-conversion — DONE
- **PASS** scheduled / completed / booked == existing Site visit conversion · report=`(27, 24, 23)` raw=`(27, 24, 23)`

## lost-leads — DONE
- **PASS** lost == leads master status Lost · report=`9` raw=`9`

## response-time — DONE
- **PASS** responded + not yet == leads this FY (Lead funnel) · report=`64` raw=`64`
- **PASS** average first response (this FY) == existing Sales & leads avg_response_hours · report=`125.4` raw=`125.4`

## lead-ageing — DONE
- **PASS** open leads == leads master open stages · report=`34` raw=`34`

## team-pipeline — DONE
- **PASS** Σ open == Lead ageing open leads · report=`34` raw=`34`
- **PASS** Σ follow-ups overdue == Follow-ups overdue · report=`1` raw=`1`

**212/212 PASS**
