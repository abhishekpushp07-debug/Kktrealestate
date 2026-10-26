# Report tie-outs · DB `test_database` · 2026-10-26

| Tie-out | Report value | Raw value | Result | Note |
|---|---|---|---|---|
| collections FY total == Σ cleared receipts | `32365678500` | `32365678500` | **PASS** |  |
| cheques-in-hand count == Pending payments | `4` | `4` | **PASS** |  |
| cheques-in-hand amount == Σ Pending | `101575000` | `101575000` | **PASS** |  |
| cheque register rows == instrument payments | `134` | `134` | **PASS** | raw by status {'Bounced': 5, 'Cleared': 123, 'Pending': 4, 'Reversed': 2} |
| inventory report by_status == flats | `{'Available': 75, 'Hold': 2, 'Booked': 79, 'Sold': 1, 'Blocked': 1}` | `{'Available': 75, 'Blocked': 1, 'Booked': 79, 'Hold': 2, 'Sold': 1}` | **PASS** |  |
| home units/available tiles == flats | `(158, 75)` | `(158, 75)` | **PASS** |  |
| legacy dashboard inventory == flats | `{'Available': 75, 'Hold': 2, 'Booked': 79, 'Sold': 1, 'Blocked': 1}` | `{'Available': 75, 'Blocked': 1, 'Booked': 79, 'Hold': 2, 'Sold': 1}` | **PASS** |  |
| outstanding total == Σ booking summary dues | `2106464900` | `2106464900` | **PASS** |  |
| home overdue tile == Σ bookings overdue (definitions.ageing_bands) | `1589246100` | `1589246100` | **PASS** |  |
| report overdue == Σ bookings overdue | `1589246100` | `1589246100` | **PASS** |  |
| dashboard overdue == report overdue | `1589246100` | `1589246100` | **PASS** |  |
| ageing bands sum == report total outstanding | `2106464900` | `2106464900` | **PASS** |  |
| report bands == Σ booking bands | `{'Not due': 517218800, '0-30': 75480000, '31-60': 613172400, '61-90': ` | `{'Not due': 517218800, '0-30': 75480000, '31-60': 613172400, '61-90': ` | **PASS** |  |
| home outstanding tile == Σ booking dues | `2106464900` | `2106464900` | **PASS** |  |
| home outstanding tile == outstanding report due | `2106464900` | `2106464900` | **PASS** |  |
| ONE NUMBER: Home outstanding == Outstanding report total | `2106464900` | `2106464900` | **PASS** |  |
| ONE NUMBER: Outstanding report total == Σ booking.summary.outstanding_paise | `2106464900` | `2106464900` | **PASS** |  |
| Home advance held == Σ booking.summary.advance_paise | `116199100` | `116199100` | **PASS** |  |
| refunds API Paid total == Σ paid refunds | `45416200` | `45416200` | **PASS** |  |
| cancellations report refund paid == Σ paid refunds | `45416200` | `45416200` | **PASS** |  |
| ledger REFUND contra rows == Σ paid refunds (all buckets) | `45416200` | `45416200` | **PASS** |  |
| bounce charges on bookings == bounce-charge audit rows | `5` | `5` | **PASS** |  |
| transferred bookings' flats point back to booking | `4` | `4` | **PASS** |  |
| cancelled bookings carry no open demands | `0` | `0` | **PASS** |  |
| demand-vs-collection demanded == Σ non-void demands | `35095931800` | `35095931800` | **PASS** |  |
| legacy dashboard collections.month == Σ cleared this month | `1314995100` | `1314995100` | **PASS** | month=2026-10 |
| cancellations rows == Cancelled bookings | `5` | `5` | **PASS** |  |
| sales-leads total == leads | `125` | `125` | **PASS** |  |
| Σ cleared cash receipts == booking.summary.cash_paid (all active) | `0` | `0` | **PASS** | count of bookings that differ |
| Σ Udhar − Σ Jama == outstanding − advance (every booking) | `0` | `0` | **PASS** | two-sided ledger law |
| report [collections-v2] net Jama == Σ Jama rows (receipts + reversals) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] net Jama == Σ cleared receipts | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by project == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by block == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by bucket == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by mode == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by bank == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by rm == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by day == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] balance == Σ definitions.outstanding(summary) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ Udhar − Σ Jama == balance − advance | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] advance held == Σ definitions.advance | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] balance == Home outstanding tile | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] bands Σ == total balance | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] report bands == Σ definitions.ageing_bands | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by customer == total (balance_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by project == total (balance_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by block == total (balance_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [demand-vs-collection] demanded == Σ non-void demands | `` | `` | **PASS** | tools/tieout_reports.py |
| report [demand-vs-collection] collected == Σ demand.paid | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cash-vs-account] cash raised == Σ summary.cash_order_raised | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cash-vs-account] account received == Σ summary.account_paid | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cash-vs-account] cash agreed == Σ booking.cash_agreed | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cash-vs-account] Σ by project == total (cash_balance_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cash-vs-account] Σ by block == total (cash_balance_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cheques] rows == cheque/DD payments | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cheques] amount == Σ instrument amounts | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] Σ forecast + Σ raised == Σ agreement (live bookings) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] per booking: forecast == agreement − raised | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] Σ by project == total (expected_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] Σ by block == total (expected_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] Σ by booking == total (expected_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] rows == Cancelled bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] refund paid == Σ paid refunds | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] ledger REFUND rows == Σ paid refunds | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] cleared == Σ non-cash cleared | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] pending == Σ non-cash pending | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] demanded == Σ other_charges.demanded | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] collected == Σ other_charges.paid | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] collected == Σ Other ledger Jama (OTHER_CHARGE_PAYMENT + Other reversals) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] Σ by project == total (demanded_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] Σ by booking == total (demanded_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [roznamcha-summary] cash received == Σ cleared CASH receipts | `` | `` | **PASS** | tools/tieout_reports.py |
| report [roznamcha-summary] deposits == Σ contra DEPOSIT | `` | `` | **PASS** | tools/tieout_reports.py |
| report [roznamcha-summary] closing == opening + cash in − deposits + withdrawals − cash refunds | `` | `` | **PASS** | tools/tieout_reports.py |
| report [roznamcha-summary] Σ by month == range total (cash in) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [roznamcha-summary] monthly closing == daily closing | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory] units by status == flats | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory] sold value == Σ price of booked/sold flats | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-leads] leads == leads collection | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-leads] converted == Converted leads | `` | `` | **PASS** | tools/tieout_reports.py |
| report [site-visits] visits == site_visits | `` | `` | **PASS** | tools/tieout_reports.py |
| report [site-visits] completed == Completed visits | `` | `` | **PASS** | tools/tieout_reports.py |
| report [site-visits] Σ by project == total (scheduled) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [site-visits] Σ by month == total (scheduled) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-team] sold value == Σ live agreement values | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-team] collections == Σ cleared receipts of live bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-team] overdue == outstanding report overdue | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] stages done == Σ Completed stage records | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] stage demands == Σ ON_STAGE demands | `` | `` | **PASS** | tools/tieout_reports.py |
| report [service-sla] tickets == service_requests | `` | `` | **PASS** | tools/tieout_reports.py |
| report [activity] audit actions == audit_logs | `` | `` | **PASS** | tools/tieout_reports.py |
| report [data-quality] open demands on cancelled bookings == 0 (integrity) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [data-quality] payment plans not summing 100 == 0 | `` | `` | **PASS** | tools/tieout_reports.py |
| report [data-quality] integrity report ok | `` | `` | **PASS** | tools/tieout_reports.py |
| Phase I report tie-outs all PASS | `True` | `True` | **PASS** | 65 report ties |
