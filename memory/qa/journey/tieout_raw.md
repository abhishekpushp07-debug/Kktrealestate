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
