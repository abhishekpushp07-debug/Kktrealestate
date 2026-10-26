# Phase I reports — tie-out status · DB `test_database` · 2026-10-27T03:37:02+05:30

## collections-v2 — DONE
- **PASS** net Jama (receipt basis, all time) == Σ cleared receipts · report=`32365678500` raw=`32365678500`
- **PASS** net Jama == Σ ledger Jama rows (receipts + reversals) · report=`32365678500` raw=`32365678500`
- **PASS** FY total (receipt basis) == raw payments by receipt date · report=`16873703800` raw=`16873703800`
- **PASS** basis label present (receipt) · report=`Date basis: receipt date` raw=`Date basis: receipt date`
- **PASS** FY total (clearance basis) == raw payments by clearance date · report=`16695473800` raw=`16695473800`
- **PASS** basis label present (clearance) · report=`Date basis: clearance date` raw=`Date basis: clearance date`
- **PASS** receipt basis == legacy collections (payment_date, Cleared) · report=`16873703800` raw=`16873703800`
- **PASS** Σ by project == total (total_paise) · report=`32365678500` raw=`32365678500`
- **PASS** Σ by block == total (total_paise) · report=`32365678500` raw=`32365678500`
- **PASS** Σ by bucket == total (total_paise) · report=`32365678500` raw=`32365678500`
- **PASS** Σ by mode == total (total_paise) · report=`32365678500` raw=`32365678500`
- **PASS** Σ by bank == total (total_paise) · report=`32365678500` raw=`32365678500`
- **PASS** Σ by rm == total (total_paise) · report=`32365678500` raw=`32365678500`
- **PASS** Σ by day == total (total_paise) · report=`32365678500` raw=`32365678500`

## outstanding-v2 — DONE
- **PASS** outstanding == Σ definitions.outstanding(summary) · report=`2106464900` raw=`2106464900`
- **PASS** advance held == Σ definitions.advance · report=`116199100` raw=`116199100`
- **PASS** net == outstanding − advance == Σ Udhar − Σ Jama · report=`(1990265800, 1990265800)` raw=`(1990265800, 1990265800)`
- **PASS** per booking: report net == ledger net == summary net; report outstanding == summary outstanding · report=`[]` raw=`[]`
- **PASS** outstanding == Home outstanding tile · report=`2106464900` raw=`2106464900`
- **PASS** bands Σ == outstanding · report=`2106464900` raw=`2106464900`
- **PASS** report bands == Σ definitions.ageing_bands · report=`{'Not due': 517218800, '0-30': 75480000, '31-60': 613172400,` raw=`{'Not due': 517218800, '0-30': 75480000, '31-60': 613172400,`
- **PASS** Σ by customer == total (outstanding_paise) · report=`2106464900` raw=`2106464900`
- **PASS** Σ by customer == total (net_balance_paise) · report=`1990265800` raw=`1990265800`
- **PASS** Σ by project == total (outstanding_paise) · report=`2106464900` raw=`2106464900`
- **PASS** Σ by project == total (net_balance_paise) · report=`1990265800` raw=`1990265800`
- **PASS** Σ by block == total (outstanding_paise) · report=`2106464900` raw=`2106464900`
- **PASS** Σ by block == total (net_balance_paise) · report=`1990265800` raw=`1990265800`

## demand-vs-collection — DONE
- **PASS** demanded == Σ non-void demands · report=`35095931800` raw=`35095931800`
- **PASS** collected == Σ demand.paid · report=`32201563200` raw=`32201563200`

## cash-vs-account — DONE
- **PASS** cash raised == Σ summary.cash_order_raised · report=`14120596800` raw=`14120596800`
- **PASS** account received == Σ summary.account_paid · report=`19163240500` raw=`19163240500`
- **PASS** cash agreed == Σ booking.cash_agreed · report=`25311275000` raw=`25311275000`
- **PASS** Σ by project == total (cash_balance_paise) · report=`1123956400` raw=`1123956400`
- **PASS** Σ by block == total (cash_balance_paise) · report=`1123956400` raw=`1123956400`

## cheques — DONE
- **PASS** rows == cheque/DD payments · report=`134` raw=`134`
- **PASS** amount == Σ instrument amounts · report=`6098464500` raw=`6098464500`

## receivables-forecast — DONE
- **PASS** Σ forecast + Σ raised == Σ agreement (live bookings) · report=`52976750000` raw=`52976750000`
- **PASS** per booking: forecast == agreement − raised · report=`0` raw=`0`
- **PASS** Σ by project == total (expected_paise) · report=`18847418200` raw=`18847418200`
- **PASS** Σ by block == total (expected_paise) · report=`18847418200` raw=`18847418200`
- **PASS** Σ by booking == total (expected_paise) · report=`18847418200` raw=`18847418200`
- **PASS** Σ by stage == total (expected_paise) · report=`18847418200` raw=`18847418200`
- **PASS** Σ by month == total (expected_paise) · report=`18847418200` raw=`18847418200`
- **PASS** default grouping is tower → stage when no planned dates · report=`True` raw=`True`
- **PASS** stage grouping: one row per tower·stage, Σ == total · report=`18847418200` raw=`18847418200`

## cancellations — DONE
- **PASS** rows == Cancelled bookings · report=`5` raw=`5`
- **PASS** refund paid == Σ paid refunds · report=`45416200` raw=`45416200`
- **PASS** ledger REFUND rows == Σ paid refunds · report=`45416200` raw=`45416200`

## bank-receipts — DONE
- **PASS** cleared == Σ non-cash cleared · report=`23663982600` raw=`23663982600`
- **PASS** pending == Σ non-cash pending · report=`101575000` raw=`101575000`

## other-charges — DONE
- **PASS** demanded == Σ other_charges.demanded · report=`106550000` raw=`106550000`
- **PASS** collected == Σ other_charges.paid · report=`20650000` raw=`20650000`
- **PASS** collected == Σ Other ledger Jama (OTHER_CHARGE_PAYMENT + Other reversals) · report=`20650000` raw=`20650000`
- **PASS** Σ by project == total (demanded_paise) · report=`106550000` raw=`106550000`
- **PASS** Σ by booking == total (demanded_paise) · report=`106550000` raw=`106550000`

## roznamcha-summary — DONE
- **PASS** cash received == Σ cleared CASH receipts · report=`8701695900` raw=`8701695900`
- **PASS** deposits == Σ contra DEPOSIT · report=`8757900000` raw=`8757900000`
- **PASS** closing == opening + cash in − deposits + withdrawals − cash refunds · report=`-59804100` raw=`-59804100`
- **PASS** Σ by month == range total (cash in) · report=`8701695900` raw=`8701695900`
- **PASS** monthly closing == daily closing · report=`-59804100` raw=`-59804100`

## inventory — DONE
- **PASS** units by status == flats · report=`{'Available': 75, 'Blocked': 1, 'Booked': 79, 'Hold': 2, 'So` raw=`{'Available': 75, 'Blocked': 1, 'Booked': 79, 'Hold': 2, 'So`
- **PASS** sold value == Σ price of booked/sold flats · report=`52896750000` raw=`52896750000`

## sales-leads — DONE
- **PASS** leads == leads collection · report=`125` raw=`125`
- **PASS** converted == Converted leads · report=`80` raw=`80`

## site-visits — DONE
- **PASS** visits == site_visits · report=`88` raw=`88`
- **PASS** completed == Completed visits · report=`84` raw=`84`
- **PASS** Σ by project == total (scheduled) · report=`88` raw=`88`
- **PASS** Σ by month == total (scheduled) · report=`88` raw=`88`

## sales-team — DONE
- **PASS** sold value == Σ live agreement values · report=`52976750000` raw=`52976750000`
- **PASS** collections == Σ cleared receipts of live bookings · report=`32245616000` raw=`32245616000`
- **PASS** overdue == outstanding report overdue · report=`1589246100` raw=`1589246100`

## construction-vs-plan — DONE
- **PASS** stage rows == Σ stages of active towers · report=`67` raw=`67`
- **PASS** stage demands == Σ ON_STAGE/ON_POSSESSION demands · report=`28051231800` raw=`28051231800`
- **PASS** subtotals == Σ their stage rows (demanded) · report=`28051231800` raw=`28051231800`
- **PASS** no tower name with leading/trailing space · report=`[]` raw=`[]`
- **PASS** GET /payments/demands honours block_id · report=`[]` raw=`[]`

## service-sla — DONE
- **PASS** tickets == service_requests · report=`14` raw=`14`

## activity — DONE
- **PASS** audit actions == audit_logs · report=`3880` raw=`3880`

## data-quality — DONE
- **PASS** open demands on cancelled bookings == 0 (integrity) · report=`0` raw=`0`
- **PASS** towers without stage plan excludes inactive towers · report=`0` raw=`0`
- **PASS** payment plans not summing 100 == 0 · report=`0` raw=`0`
- **PASS** integrity report ok · report=`True` raw=`True`

**82/82 PASS**
