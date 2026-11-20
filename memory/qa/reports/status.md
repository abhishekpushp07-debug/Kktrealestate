# Phase I reports — tie-out status · DB `test_database` · 2026-11-20T03:04:10+05:30

## collections-v2 — DONE
- **PASS** net Jama (receipt basis, all time) == Σ cleared receipts · report=`37444037500` raw=`37444037500`
- **PASS** net Jama == Σ ledger Jama rows (receipts + reversals) · report=`37444037500` raw=`37444037500`
- **PASS** FY total (cleared basis) == raw payments by cleared date · report=`17307631000` raw=`17307631000`
- **PASS** basis label present (cleared) · report=`Date basis: cleared` raw=`Date basis: cleared`
- **PASS** FY total (receipt basis) == raw payments by receipt date · report=`17307631000` raw=`17307631000`
- **PASS** basis label present (receipt) · report=`Date basis: receipt` raw=`Date basis: receipt`
- **PASS** FY total (clearance basis) == raw payments by clearance date · report=`17307631000` raw=`17307631000`
- **PASS** basis label present (clearance) · report=`Date basis: clearance` raw=`Date basis: clearance`
- **PASS** cleared basis == legacy collections (both: cheque on its clearing day) · report=`17307631000` raw=`17307631000`
- **PASS** Σ by project == total (total_paise) · report=`37444037500` raw=`37444037500`
- **PASS** Σ by block == total (total_paise) · report=`37444037500` raw=`37444037500`
- **PASS** Σ by bucket == total (total_paise) · report=`37444037500` raw=`37444037500`
- **PASS** Σ by mode == total (total_paise) · report=`37444037500` raw=`37444037500`
- **PASS** Σ by bank == total (total_paise) · report=`37444037500` raw=`37444037500`
- **PASS** Σ by rm == total (total_paise) · report=`37444037500` raw=`37444037500`
- **PASS** Σ by day == total (total_paise) · report=`37444037500` raw=`37444037500`

## outstanding-v2 — DONE
- **PASS** outstanding == Σ definitions.outstanding(summary) · report=`4671717200` raw=`4671717200`
- **PASS** advance held == Σ definitions.advance · report=`73698050` raw=`73698050`
- **PASS** net == outstanding − advance == Σ Udhar − Σ Jama (received + waived) · report=`(4598019150, 4598019150)` raw=`(4598019150, 4598019150)`
- **PASS** per booking: report net == ledger net == summary net; report outstanding == summary outstanding · report=`[]` raw=`[]`
- **PASS** outstanding == Home outstanding tile · report=`4671717200` raw=`4671717200`
- **PASS** bands Σ == outstanding · report=`4671717200` raw=`4671717200`
- **PASS** report bands == Σ definitions.ageing_bands · report=`{'Not due': 2398387400, '0-30': 484930000, '31-60': 26476310` raw=`{'Not due': 2398387400, '0-30': 484930000, '31-60': 26476310`
- **PASS** Σ by customer == total (outstanding_paise) · report=`4671717200` raw=`4671717200`
- **PASS** Σ by customer == total (net_balance_paise) · report=`4598019150` raw=`4598019150`
- **PASS** Σ by project == total (outstanding_paise) · report=`4671717200` raw=`4671717200`
- **PASS** Σ by project == total (net_balance_paise) · report=`4598019150` raw=`4598019150`
- **PASS** Σ by block == total (outstanding_paise) · report=`4671717200` raw=`4671717200`
- **PASS** Σ by block == total (net_balance_paise) · report=`4598019150` raw=`4598019150`

## demand-vs-collection — DONE
- **PASS** demanded == Σ non-void demands on live bookings + transfer / revision adjustments · report=`37703997000` raw=`37703997000`
- **PASS** collected == Σ demand.paid (live bookings) · report=`33710327200` raw=`33710327200`
- **PASS** Include cancelled − default == bridge line Cancelled bookings · report=`232840000` raw=`232840000`

## cash-vs-account — DONE
- **PASS** cash raised == Σ summary.cash_order_raised · report=`16171085200` raw=`16171085200`
- **PASS** account received == Σ summary.account_paid · report=`19623415700` raw=`19623415700`
- **PASS** cash agreed == Σ booking.cash_agreed · report=`23432118500` raw=`23432118500`
- **PASS** Σ by project == total (cash_balance_paise) · report=`2069332500` raw=`2069332500`
- **PASS** Σ by block == total (cash_balance_paise) · report=`2069332500` raw=`2069332500`
- **PASS** new sheet == cash-vs-account (group_by=project): 8 money totals · report=`{'cash_agreed_paise': 23432118500, 'cash_raised_paise': 1617` raw=`{'cash_agreed_paise': 23432118500, 'cash_raised_paise': 1617`
- **PASS** new sheet == cash-vs-account (group_by=booking): 8 money totals · report=`{'cash_agreed_paise': 23432118500, 'cash_raised_paise': 1617` raw=`{'cash_agreed_paise': 23432118500, 'cash_raised_paise': 1617`

## cheques — DONE
- **PASS** rows == cheque/DD payments · report=`147` raw=`147`
- **PASS** amount == Σ instrument amounts · report=`5381151800` raw=`5381151800`
- **PASS** new sheet == cheques: 1 money totals · report=`{'amount_paise': 5381151800}` raw=`{'amount_paise': 5381151800}`

## receivables-forecast — DONE
- **PASS** Σ forecast + Σ raised == Σ agreement (live bookings) · report=`50201270000` raw=`50201270000`
- **PASS** per booking: forecast == agreement − raised · report=`0` raw=`0`
- **PASS** Σ by project == total (expected_paise) · report=`12497273000` raw=`12497273000`
- **PASS** Σ by block == total (expected_paise) · report=`12497273000` raw=`12497273000`
- **PASS** Σ by booking == total (expected_paise) · report=`12497273000` raw=`12497273000`
- **PASS** Σ by stage == total (expected_paise) · report=`12497273000` raw=`12497273000`
- **PASS** Σ by month == total (expected_paise) · report=`12497273000` raw=`12497273000`
- **PASS** default grouping is tower → stage when no planned dates · report=`True` raw=`True`
- **PASS** stage grouping: one row per tower·stage, Σ == total · report=`12497273000` raw=`12497273000`
- **PASS** new sheet == receivables-forecast (group_by=stage): 3 money totals · report=`{'cash_paise': 7261033275, 'account_paise': 5236239725, 'exp` raw=`{'cash_paise': 7261033275, 'account_paise': 5236239725, 'exp`
- **PASS** new sheet == receivables-forecast (group_by=booking): 3 money totals · report=`{'cash_paise': 7261033275, 'account_paise': 5236239725, 'exp` raw=`{'cash_paise': 7261033275, 'account_paise': 5236239725, 'exp`

## cancellations — DONE
- **PASS** rows == Cancelled bookings · report=`2` raw=`2`
- **PASS** refund paid == Σ paid refunds · report=`42289200` raw=`42289200`
- **PASS** ledger REFUND rows == Σ paid refunds · report=`42289200` raw=`42289200`
- **PASS** Σ refund payable == existing Cancellations report · report=`42289200` raw=`42289200`
- **PASS** Σ refund paid == existing Cancellations report · report=`42289200` raw=`42289200`

## bank-receipts — DONE
- **PASS** cleared == Σ non-cash receipts received (cleared day) in range · report=`28113699400` raw=`28113699400`
- **PASS** cheques in hand == Σ receipts in hand at range end · report=`23215200` raw=`23215200`
- **PASS** Bank-wise + Cash == Collections (one identity, to the paisa) · report=`37444037500` raw=`37444037500`
- **PASS** new sheet == bank-receipts: 3 money totals · report=`{'cleared_paise': 14001471500, 'reversed_paise': 0, 'total_p` raw=`{'cleared_paise': 14001471500, 'reversed_paise': 0, 'total_p`
- **PASS** Collections == Bank-wise + Cash (this FY, to the paisa) · report=`20136406500` raw=`20136406500`
- **PASS** identity has no unnamed remainder · report=`0` raw=`0`

## other-charges — DONE
- **PASS** demanded == Σ other_charges.demanded · report=`4250884100` raw=`4250884100`
- **PASS** collected == Σ other_charges.(paid − waived) · report=`3586441300` raw=`3586441300`
- **PASS** collected == Σ Other ledger Jama (OTHER_CHARGE_PAYMENT + Other reversals/refunds) · report=`3586441300` raw=`3586441300`
- **PASS** Σ by project == total (demanded_paise) · report=`4250884100` raw=`4250884100`
- **PASS** Σ by booking == total (demanded_paise) · report=`4250884100` raw=`4250884100`
- **PASS** new sheet == other-charges (group_by=charge): 4 money totals · report=`{'agreed_paise': 5636302200, 'demanded_paise': 4250884100, '` raw=`{'agreed_paise': 5636302200, 'demanded_paise': 4250884100, '`
- **PASS** new sheet == other-charges (group_by=booking): 4 money totals · report=`{'agreed_paise': 5636302200, 'demanded_paise': 4250884100, '` raw=`{'agreed_paise': 5636302200, 'demanded_paise': 4250884100, '`

## roznamcha-summary — DONE
- **PASS** cash received == Σ cleared CASH receipts · report=`9330338100` raw=`9330338100`
- **PASS** deposits == Σ contra DEPOSIT · report=`9363900000` raw=`9363900000`
- **PASS** closing == opening + cash in − deposits + withdrawals − cash refunds · report=`-33561900` raw=`-33561900`
- **PASS** Σ by month == range total (cash in) · report=`9330338100` raw=`9330338100`
- **PASS** monthly closing == daily closing · report=`-33561900` raw=`-33561900`

## inventory — DONE
- **PASS** units by status == flats · report=`{'Available': 102, 'Blocked': 1, 'Booked': 79, 'Hold': 3, 'S` raw=`{'Available': 102, 'Blocked': 1, 'Booked': 79, 'Hold': 3, 'S`
- **PASS** sold value == Σ price of booked/sold flats · report=`50226270000` raw=`50226270000`

## sales-leads — DONE
- **PASS** leads == leads collection · report=`123` raw=`123`
- **PASS** converted == Converted leads · report=`80` raw=`80`

## site-visits — DONE
- **PASS** visits == site_visits · report=`87` raw=`87`
- **PASS** completed == Completed visits · report=`83` raw=`83`
- **PASS** Σ by project == total (scheduled) · report=`87` raw=`87`
- **PASS** Σ by month == total (scheduled) · report=`87` raw=`87`

## sales-team — DONE
- **PASS** sold value == Σ live agreement values · report=`50201270000` raw=`50201270000`
- **PASS** collections == Σ cleared receipts of live bookings · report=`37352161500` raw=`37352161500`
- **PASS** overdue == outstanding report overdue · report=`2273329800` raw=`2273329800`
- **PASS** Σ sold (all dates) == existing Sales team report · report=`50201270000` raw=`50201270000`
- **PASS** Σ bookings (all dates) == existing Sales team report · report=`80` raw=`80`

## construction-vs-plan — DONE
- **PASS** stage rows == Σ stages of active towers · report=`46` raw=`46`
- **PASS** stage demands == Σ ON_STAGE/ON_POSSESSION demands · report=`31357209900` raw=`31357209900`
- **PASS** subtotals == Σ their stage rows (demanded) · report=`31357209900` raw=`31357209900`
- **PASS** no tower name with leading/trailing space · report=`[]` raw=`[]`
- **PASS** GET /payments/demands honours block_id · report=`[]` raw=`[]`
- **PASS** Σ demanded == existing Construction vs plan · report=`31357209900` raw=`31357209900`
- **PASS** Σ collected == existing Construction vs plan · report=`27403356200` raw=`27403356200`
- **PASS** Σ balance == existing Construction vs plan · report=`3953853700` raw=`3953853700`

## service-sla — DONE
- **PASS** tickets == service_requests · report=`14` raw=`14`
- **PASS** requests / open / resolved == existing Service requests & SLA · report=`(14, 8, 6)` raw=`(14, 8, 6)`

## activity — DONE
- **PASS** audit actions == audit_logs (live log) · report=`195334` raw=`195334`

## data-quality — DONE
- **PASS** open demands on cancelled bookings == 0 (integrity) · report=`0` raw=`0`
- **PASS** towers without stage plan excludes inactive towers · report=`0` raw=`0`
- **PASS** payment plans not summing 100 == 0 · report=`0` raw=`0`
- **PASS** integrity report ok · report=`True` raw=`True`

## customer-status — DONE
- **PASS** Σ Account dues + Σ Cash dues == instalment outstanding · report=`4007899400` raw=`4007899400`
- **PASS** rows == live bookings · report=`80` raw=`80`
- **PASS** Σ bills raised == Σ Cash + Account order raised · report=`37703997000` raw=`37703997000`
- **PASS** formula: raised − received − waived + advance == dues · report=`4007899400` raw=`4007899400`
- **PASS** final status kind == customer card, every booking · report=`0` raw=`0`
- **PASS** overdue days == customer card, every booking · report=`0` raw=`0`
- **PASS** ledger share state today == booking summary (as-of path) · report=`0` raw=`0`
- **PASS** as of 2026-03-31: instalment net dues == ledger rows dated on / before that day · report=`1592227100` raw=`1592227100`
- **PASS** as of 2026-03-31 instalment net + other-charge net == carried from before at 2026-04-01 · report=`2140178200` raw=`2140178200`
- **PASS** Σ project subtotals == total dues · report=`4007899400` raw=`4007899400`
- **PASS** Σ tower subtotals == project subtotal · report=`2` raw=`2`
- **PASS** formula bridge: total due == Overdue & ageing total due · report=`4671717200` raw=`4671717200`
- **PASS** Customer status bridge line == Bills vs Collection · report=`37703997000` raw=`37703997000`

## customer-ageing — DONE
- **PASS** Σ bands == Σ total due · report=`4671717200` raw=`4671717200`
- **PASS** Σ total due == Σ outstanding (definitions) of live bookings · report=`4671717200` raw=`4671717200`
- **PASS** rows == live bookings with dues · report=`45` raw=`45`
- **PASS** Σ total due == Outstanding & ageing report total · report=`4671717200` raw=`4671717200`

## advance-holders — DONE
- **PASS** Σ advance == Σ booking advance (definitions) · report=`73698050` raw=`73698050`

## call-list — DONE
- **PASS** Σ due == ageing Σ total due · report=`4671717200` raw=`4671717200`
- **PASS** Σ overdue == ageing Σ overdue · report=`2273329800` raw=`2273329800`
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
- **PASS** new sheet == collections-v2 (group_by=month): 7 money totals · report=`{'cash_paise': 9244213600, 'account_paise': 9036836600, 'oth` raw=`{'cash_paise': 9244213600, 'account_paise': 9036836600, 'oth`
- **PASS** new sheet == collections-v2 (group_by=receipt): 7 money totals · report=`{'cash_paise': 9244213600, 'account_paise': 9036836600, 'oth` raw=`{'cash_paise': 9244213600, 'account_paise': 9036836600, 'oth`
- **PASS** period 2026-04-01…2026-09-30 == existing report same period · report=`15290584900` raw=`15290584900`
- **PASS** identity: bank modes + cash mode == Collections · report=`20136406500` raw=`20136406500`
- **PASS** cheques in hand line == Bank-wise cheques in hand · report=`23215200` raw=`23215200`

## day-book — DONE
- **PASS** new sheet == roznamcha-summary (group_by=month): 5 money totals · report=`{'cash_in_paise': 6134935000, 'bank_in_paise': 14001471500, ` raw=`{'cash_in_paise': 6134935000, 'bank_in_paise': 14001471500, `
- **PASS** new sheet == roznamcha-summary (group_by=day): 5 money totals · report=`{'cash_in_paise': 6134935000, 'bank_in_paise': 14001471500, ` raw=`{'cash_in_paise': 6134935000, 'bank_in_paise': 14001471500, `

## bills-vs-collection — DONE
- **PASS** new sheet == demand-vs-collection: 5 money totals · report=`{'cash_demand_paise': 16176265200, 'account_demand_paise': 2` raw=`{'cash_demand_paise': 16176265200, 'account_demand_paise': 2`
- **PASS** default bill raised == Customer status bills raised · report=`37703997000` raw=`37703997000`
- **PASS** default view has no cancelled bookings · report=`0` raw=`0`

## outstanding — DONE
- **PASS** new sheet == outstanding-v2 (group_by=project): 7 money totals · report=`{'udhar_paise': 41954881100, 'jama_paise': 37352161500, 'wai` raw=`{'udhar_paise': 41954881100, 'jama_paise': 37352161500, 'wai`
- **PASS** new sheet == outstanding-v2 (group_by=booking): 7 money totals · report=`{'udhar_paise': 41954881100, 'jama_paise': 37352161500, 'wai` raw=`{'udhar_paise': 41954881100, 'jama_paise': 37352161500, 'wai`
- **PASS** filtered by one project == existing report filtered the same way · report=`159937200` raw=`159937200`

## waivers — DONE
- **PASS** new sheet == waiver-register: 2 money totals · report=`{'amount_paise': 6200000, 'gst_paise': 200450}` raw=`{'amount_paise': 6200000, 'gst_paise': 200450}`

## booking-register — DONE
- **PASS** Σ agreement value (Active + Completed) == bookings collection · report=`50201270000` raw=`50201270000`

## sales-summary — DONE
- **PASS** Σ bookings this FY == booking register (not cancelled) this FY · report=`26` raw=`26`
- **PASS** Σ agreement value this FY == booking register this FY · report=`15056110000` raw=`15056110000`

## discount-register — DONE
- **PASS** Σ discount (all dates) == existing Discount register · report=`28630000` raw=`28630000`
- **PASS** Σ discount (all dates) == booking register discount (Active + Completed) · report=`28630000` raw=`28630000`

## plan-position — DONE
- **PASS** Σ bills raised == Customer status · report=`37703997000` raw=`37703997000`
- **PASS** Σ received == Customer status Account + Cash received · report=`33765720200` raw=`33765720200`

## agreements — DONE
- **PASS** signed + pending == live bookings · report=`80` raw=`80`
- **PASS** signed == live bookings with an accepted plan · report=`80` raw=`80`

## transfers — DONE
- **PASS** changes == transfers + revisions + price events on bookings + plan changes in audit log (bookings that exist) · report=`7` raw=`7`

## realised-rate — DONE
- **PASS** Σ agreement value == Plan & stage position · report=`50201270000` raw=`50201270000`
- **PASS** Σ list − Σ agreement == Σ discount · report=`28630000` raw=`28630000`

## booking-health — DONE
- **PASS** Σ overdue == Customer status overdue · report=`2273329800` raw=`2273329800`
- **PASS** Σ total due == Customer status total due · report=`4671717200` raw=`4671717200`
- **PASS** healthy + watch + at risk == live bookings · report=`80` raw=`80`

## project-statement — DONE
- **PASS** SGH Σ bill raised == existing Project statement · report=`28840501500` raw=`28840501500`
- **PASS** SGH Σ received == existing Project statement · report=`24397719100` raw=`24397719100`
- **PASS** SGH Σ balance signed == existing Project statement · report=`-4438081950` raw=`-4438081950`

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
- **PASS** Σ list price of available flats == existing Inventory available value · report=`58821260000` raw=`58821260000`
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
- **PASS** Σ bills raised == Customer status · report=`37703997000` raw=`37703997000`
- **PASS** Σ received == Customer status Account + Cash · report=`33765720200` raw=`33765720200`
- **PASS** Σ instalment dues == Customer status · report=`4007899400` raw=`4007899400`

## sales-velocity — DONE
- **PASS** Σ unsold == Inventory status available + hold · report=`105` raw=`105`
- **PASS** Σ booked in the last 12 months == booking register same window · report=`44` raw=`44`

## lead-funnel — DONE
- **PASS** New (this FY) == existing Sales & leads funnel · report=`7` raw=`7`
- **PASS** Contacted (this FY) == existing Sales & leads funnel · report=`6` raw=`6`
- **PASS** Site Visit Scheduled (this FY) == existing Sales & leads funnel · report=`6` raw=`6`
- **PASS** Site Visit Done (this FY) == existing Sales & leads funnel · report=`1` raw=`1`
- **PASS** Negotiation (this FY) == existing Sales & leads funnel · report=`4` raw=`4`
- **PASS** Converted (this FY) == existing Sales & leads funnel · report=`23` raw=`23`
- **PASS** Lost (this FY) == existing Sales & leads funnel · report=`5` raw=`5`
- **PASS** Σ leads (this FY) == existing Sales & leads · report=`52` raw=`52`

## source-performance — DONE
- **PASS** Website leads / converted == existing Sales & leads · report=`(13, 4)` raw=`(13, 4)`
- **PASS** Walk-in leads / converted == existing Sales & leads · report=`(9, 5)` raw=`(9, 5)`
- **PASS** Brochure leads / converted == existing Sales & leads · report=`(7, 3)` raw=`(7, 3)`
- **PASS** Referral leads / converted == existing Sales & leads · report=`(11, 6)` raw=`(11, 6)`
- **PASS** Broker leads / converted == existing Sales & leads · report=`(9, 5)` raw=`(9, 5)`
- **PASS** Campaign leads / converted == existing Sales & leads · report=`(3, 0)` raw=`(3, 0)`

## lead-register — DONE
- **PASS** leads == leads master (live) · report=`123` raw=`123`

## follow-ups — DONE
- **PASS** overdue == existing Sales & leads follow-ups overdue (all dates) · report=`0` raw=`0`

## visit-register — DONE
- **PASS** completed / no-show / cancelled (this FY) == existing Site visit conversion · report=`(24, 1, 1)` raw=`(24, 1, 1)`
- **PASS** visits (this FY) == existing scheduled · report=`27` raw=`27`
- **PASS** booked after visit (this FY) == existing converted · report=`23` raw=`23`

## visit-conversion — DONE
- **PASS** scheduled / completed / booked == existing Site visit conversion · report=`(27, 24, 23)` raw=`(27, 24, 23)`

## lost-leads — DONE
- **PASS** lost == leads master status Lost · report=`9` raw=`9`

## response-time — DONE
- **PASS** responded + not yet == leads this FY (Lead funnel) · report=`52` raw=`52`
- **PASS** average first response (this FY) == existing Sales & leads avg_response_hours · report=`160.7` raw=`160.7`

## lead-ageing — DONE
- **PASS** open leads == leads master open stages · report=`34` raw=`34`

## team-pipeline — DONE
- **PASS** Σ open == Lead ageing open leads · report=`34` raw=`34`
- **PASS** Σ follow-ups overdue == Follow-ups overdue · report=`0` raw=`0`

**219/219 PASS**
