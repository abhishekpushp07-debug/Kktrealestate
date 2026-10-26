# Report tie-outs · DB `test_database` · 2026-10-26

| Tie-out | Report value | Raw value | Result | Note |
|---|---|---|---|---|
| collections FY total == Σ cleared receipts | `32315143500` | `32315143500` | **PASS** |  |
| cheques-in-hand count == Pending payments | `6` | `6` | **PASS** |  |
| cheques-in-hand amount == Σ Pending | `128110000` | `128110000` | **PASS** |  |
| cheque register rows == instrument payments | `129` | `129` | **PASS** | raw by status {'Bounced': 2, 'Cleared': 121, 'Pending': 6} |
| inventory report by_status == flats | `{'Available': 57, 'Hold': 2, 'Booked': 77, 'Sold': 1, 'Blocked': 1}` | `{'Available': 57, 'Blocked': 1, 'Booked': 77, 'Hold': 2, 'Sold': 1}` | **PASS** |  |
| home units/available tiles == flats | `(138, 57)` | `(138, 57)` | **PASS** |  |
| legacy dashboard inventory == flats | `{'Available': 57, 'Hold': 2, 'Booked': 77, 'Sold': 1, 'Blocked': 1}` | `{'Available': 57, 'Blocked': 1, 'Booked': 77, 'Hold': 2, 'Sold': 1}` | **PASS** |  |
| outstanding total == Σ booking summary dues | `2060849900` | `2060849900` | **PASS** |  |
| home overdue tile == Σ bookings overdue (definitions.ageing_bands) | `1589096100` | `1589096100` | **PASS** |  |
| report overdue == Σ bookings overdue | `1589096100` | `1589096100` | **PASS** |  |
| dashboard overdue == report overdue | `1589096100` | `1589096100` | **PASS** |  |
| ageing bands sum == report total outstanding | `2060849900` | `2060849900` | **PASS** |  |
| report bands == Σ booking bands | `{'Not due': 471753800, '0-30': 75330000, '31-60': 613172400, '61-90': ` | `{'Not due': 471753800, '0-30': 75330000, '31-60': 613172400, '61-90': ` | **PASS** |  |
| home outstanding tile == Σ booking dues | `2060849900` | `2060849900` | **PASS** |  |
| home outstanding tile == outstanding report due | `2060849900` | `2060849900` | **PASS** |  |
| ONE NUMBER: Home outstanding == Outstanding report total | `2060849900` | `2060849900` | **PASS** |  |
| ONE NUMBER: Outstanding report total == Σ booking.summary.outstanding_paise | `2060849900` | `2060849900` | **PASS** |  |
| Home advance held == Σ booking.summary.advance_paise | `116199100` | `116199100` | **PASS** |  |
| refunds API Paid total == Σ paid refunds | `41816200` | `41816200` | **PASS** |  |
| cancellations report refund paid == Σ paid refunds | `41816200` | `41816200` | **PASS** |  |
| ledger REFUND contra rows == Σ paid refunds (all buckets) | `41816200` | `41816200` | **PASS** |  |
| bounce charges on bookings == bounce-charge audit rows | `2` | `2` | **PASS** |  |
| transferred bookings' flats point back to booking | `3` | `3` | **PASS** |  |
| cancelled bookings carry no open demands | `0` | `0` | **PASS** |  |
| demand-vs-collection demanded == Σ non-void demands | `34340331800` | `34340331800` | **PASS** |  |
| legacy dashboard collections.month == Σ cleared this month | `1264460100` | `1264460100` | **PASS** | month=2026-10 |
| cancellations rows == Cancelled bookings | `2` | `2` | **PASS** |  |
| sales-leads total == leads | `120` | `120` | **PASS** |  |
| Σ cleared cash receipts == booking.summary.cash_paid (all active) | `0` | `0` | **PASS** | count of bookings that differ |
