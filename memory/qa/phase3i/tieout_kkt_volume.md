# Report tie-outs · DB `kkt_volume` · 2026-11-20

| Tie-out | Report value | Raw value | Result | Note |
|---|---|---|---|---|
| collections FY total == Σ cleared receipts | `426752935000` | `426752935000` | **PASS** |  |
| cheques-in-hand count == Pending payments | `922` | `922` | **PASS** |  |
| cheques-in-hand amount == Σ Pending | `26053300000` | `26053300000` | **PASS** |  |
| cheque register rows == instrument payments | `3585` | `3585` | **PASS** | raw by status {'Bounced': 532, 'Cleared': 2131, 'Pending': 922} |
| inventory report by_status == flats | `{'Available': 665, 'Hold': 4, 'Booked': 1498, 'Sold': 1, 'Blocked': 2}` | `{'Booked': 1498, 'Available': 665, 'Hold': 4, 'Blocked': 2, 'Sold': 1}` | **PASS** |  |
| home units/available tiles == flats | `(2170, 665)` | `(2170, 665)` | **PASS** |  |
| legacy dashboard inventory == flats | `{'Available': 665, 'Hold': 4, 'Booked': 1498, 'Sold': 1, 'Blocked': 2}` | `{'Booked': 1498, 'Available': 665, 'Hold': 4, 'Blocked': 2, 'Sold': 1}` | **PASS** |  |
| outstanding total == Σ booking summary dues | `117646512400` | `117646512400` | **PASS** |  |
| home overdue tile == Σ bookings overdue (definitions.ageing_bands) | `110591478800` | `110591478800` | **PASS** |  |
| report overdue == Σ bookings overdue | `110591478800` | `110591478800` | **PASS** |  |
| dashboard overdue == report overdue | `110591478800` | `110591478800` | **PASS** |  |
| Outstanding by customer: one row per customer id | `1490` | `1490` | **PASS** |  |
| Outstanding by customer Σ net balance == by booking Σ net balance | `7806642400` | `7806642400` | **PASS** |  |
| Outstanding & Ageing band Not due == Σ bookings band Not due (definitions.ageing_bands) | `7055033600` | `7055033600` | **PASS** |  |
| Outstanding & Ageing band 0-30 == Σ bookings band 0-30 (definitions.ageing_bands) | `3717077500` | `3717077500` | **PASS** |  |
| Outstanding & Ageing band 31-60 == Σ bookings band 31-60 (definitions.ageing_bands) | `4250127700` | `4250127700` | **PASS** |  |
| Outstanding & Ageing band 61-90 == Σ bookings band 61-90 (definitions.ageing_bands) | `4414941800` | `4414941800` | **PASS** |  |
| Outstanding & Ageing band 90+ == Σ bookings band 90+ (definitions.ageing_bands) | `98209331800` | `98209331800` | **PASS** |  |
| booking card overdue days == definitions.overdue_days (every live booking) | `1499` | `1499` | **PASS** |  |
| other-charge parts with bill_day <= due_on | `4140` | `4140` | **PASS** |  |
| GST-with-stage part bill_day == the day of the instalment bill it was billed with | `2721` | `2721` | **PASS** |  |
| other-charge part due_on == its bill's due, else bill_day + days-to-pay | `4140` | `4140` | **PASS** |  |
| ageing bands sum == report total outstanding | `117646512400` | `117646512400` | **PASS** |  |
| report bands == Σ booking bands | `{'Not due': 7055033600, '0-30': 3717077500, '31-60': 4250127700, '61-9` | `{'Not due': 7055033600, '0-30': 3717077500, '31-60': 4250127700, '61-9` | **PASS** |  |
| home outstanding tile == Σ booking dues | `117646512400` | `117646512400` | **PASS** |  |
| home outstanding tile == outstanding report due | `117646512400` | `117646512400` | **PASS** |  |
| ONE NUMBER: Home outstanding == Outstanding report total | `117646512400` | `117646512400` | **PASS** |  |
| ONE NUMBER: Outstanding report total == Σ booking.summary.outstanding_paise | `117646512400` | `117646512400` | **PASS** |  |
| Home advance held == Σ booking.summary.advance_paise | `109839870000` | `109839870000` | **PASS** |  |
| refunds API Paid total == Σ paid refunds | `0` | `0` | **PASS** |  |
| cancellations report refund paid == Σ paid refunds | `0` | `0` | **PASS** |  |
| ledger REFUND contra rows == Σ paid refunds (all buckets) | `0` | `0` | **PASS** |  |
| bounce charges on bookings == bounce-charge audit rows | `531` | `531` | **PASS** |  |
| transferred bookings' flats point back to booking | `0` | `0` | **PASS** |  |
| cancelled bookings carry no open demands | `0` | `0` | **PASS** |  |
| demand-vs-collection (default: live bookings) + Cancelled bookings line == Σ non-void demands | `410684970000` | `410684970000` | **PASS** |  |
| legacy dashboard collections.month == Σ cleared this month | `72365600000` | `72365600000` | **PASS** | month=2026-11 |
| cancellations rows == Cancelled bookings | `1` | `1` | **PASS** |  |
| sales-leads total == leads | `1498` | `1498` | **PASS** |  |
| Σ cleared cash receipts == booking.summary.cash_paid (all active) | `0` | `0` | **PASS** | count of bookings that differ |
| Σ Udhar − Σ Jama == outstanding − advance (every booking) | `0` | `0` | **PASS** | two-sided ledger law |
| manual bills counted in Outstanding (order = plan % + Σ manual) | `0` | `0` | **PASS** | 0 with manual bills |
| Σ customer-card Due == Σ live booking outstanding | `117646512400` | `117646512400` | **PASS** |  |
| Σ customer-card Advance == Σ live booking advance | `109839870000` | `109839870000` | **PASS** |  |
| Σ customer-card Overdue == ageing report overdue (definitions.ageing_for_bookings, incl. other charges) | `110591478800` | `110591478800` | **PASS** |  |
| customer segments partition All (overdue + on track + all clear + advance-only + no booking) | `1975` | `1975` | **PASS** |  |
| Advance chip == customers holding an advance (raw bookings) | `884` | `884` | **PASS** |  |
| KYC pending chip == active customers not Verified (raw) | `1969` | `1969` | **PASS** |  |
| customer-card 'agreement pending' == customers with an unsigned live booking (raw) | `0` | `0` | **PASS** |  |
| GGV banner 'booked or sold' == tower chart == raw flats | `(174, 174)` | `(174, 174)` | **PASS** |  |
| V04 banner 'booked or sold' == tower chart == raw flats | `(255, 255)` | `(255, 255)` | **PASS** |  |
| V05 banner 'booked or sold' == tower chart == raw flats | `(335, 335)` | `(335, 335)` | **PASS** |  |
| V03 banner 'booked or sold' == tower chart == raw flats | `(260, 260)` | `(260, 260)` | **PASS** |  |
| V06 banner 'booked or sold' == tower chart == raw flats | `(274, 274)` | `(274, 274)` | **PASS** |  |
| SGH banner 'booked or sold' == tower chart == raw flats | `(201, 201)` | `(201, 201)` | **PASS** |  |
| Σ project-card Collected == Σ live booking Jama − waived | `427837735000` | `427837735000` | **PASS** |  |
| Σ project-card Outstanding == Σ live booking outstanding | `117646512400` | `117646512400` | **PASS** |  |
| booking-card Due == booking outstanding, one plan segment per instalment | `0` | `0` | **PASS** | 200 active bookings |
| plan-timeline row states == booking-card plan segments | `0` | `0` | **PASS** | 25 bookings |
| /bookings segment counts sum == list total | `1500` | `1500` | **PASS** |  |
| /projects segment counts sum == list total | `6` | `6` | **PASS** |  |
| Home month Cash·Account·Other == Σ allocation parts | `{'Cash': 3333200000, 'Account': 69032400000, 'Other': 0}` | `{'Cash': 3333200000, 'Account': 69032400000, 'Other': 0}` | **PASS** |  |
| Home month total == Cash + Account + Other | `72365600000` | `72365600000` | **PASS** |  |
| trends current month split == Σ allocation parts | `{'Cash': 3333200000, 'Account': 69032400000, 'Other': 0}` | `{'Cash': 3333200000, 'Account': 69032400000, 'Other': 0}` | **PASS** |  |
| collections-v2 (this month, by bucket) == Σ allocation parts | `{'Cash': 3333200000, 'Account': 69032400000, 'Other': 0}` | `{'Cash': 3333200000, 'Account': 69032400000, 'Other': 0}` | **PASS** |  |
| collections FY cash/account/other == Σ allocation parts | `{'Cash': 116529400000, 'Account': 310166500000, 'Other': 57035000}` | `{'Cash': 116529400000, 'Account': 310166500000, 'Other': 57035000}` | **PASS** |  |
| carried: opening + billed in period − received − waived in period == closing | `7806642400` | `7806642400` | **PASS** |  |
| bridge: received by payment date == Collections net received (receipt basis) | `223411500000` | `223411500000` | **PASS** |  |
| bridge: by payment date − not live − dated in, cleared after + dated before, cleared in + refunds == carried received | `252659600000` | `252659600000` | **PASS** |  |
| bridge from 2025-04-01: by clearance == carried received | `426602935000` | `426602935000` | **PASS** |  |
| bridge from 2026-11-04: by clearance == carried received | `70153700000` | `70153700000` | **PASS** |  |
| carried: closing == Outstanding report net balance (today) | `7806642400` | `7806642400` | **PASS** |  |
| formula: Bills vs Collection cash + account billed == total billed | `409897470000` | `409897470000` | **PASS** |  |
| bridge: Bills vs Collection (live) + other charges billed == Outstanding bill raised | `435644377400` | `435644377400` | **PASS** |  |
| formula: Advances cash + account + other charges == total advance | `109839870000` | `109839870000` | **PASS** |  |
| credit notes: every amount and GST credit in whole rupees | `[]` | `[]` | **PASS** |  |
| formula: Advances total == Outstanding report advance held | `109839870000` | `109839870000` | **PASS** |  |
| formula: Cheques cleared + bounced + pending == register amount | `103632100000` | `103632100000` | **PASS** |  |
| formula: Bank-wise sum of banks == total | `191064500000` | `191064500000` | **PASS** |  |
| formula: Bank-wise cleared + reversed == received | `191064500000` | `191064500000` | **PASS** |  |
| identity: Bank-wise + Cash == Collections (this FY) | `252659600000` | `252659600000` | **PASS** |  |
| Home due ageing == Outstanding report ageing (per band) | `{'Not due': 7055033600, '0-30': 3717077500, '31-60': 4250127700, '61-9` | `{'Not due': 7055033600, '0-30': 3717077500, '31-60': 4250127700, '61-9` | **PASS** |  |
| Home due ageing total == report Outstanding | `117646512400` | `117646512400` | **PASS** |  |
| Home ageing (today) loads | `True` | `True` | **PASS** |  |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=Not due].amount_paise | `7055033600` | `7055033600` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=0-30].amount_paise | `3717077500` | `3717077500` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=31-60].amount_paise | `4250127700` | `4250127700` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=61-90].amount_paise | `4414941800` | `4414941800` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=90+].amount_paise | `98209331800` | `98209331800` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 totals.outstanding_paise | `117646512400` | `117646512400` | **PASS** | {} |
| Home money_today (today) loads | `True` | `True` | **PASS** |  |
| Home money_today (today) /reports/collections-v2 totals.cash_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (today) /reports/collections-v2 totals.account_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (today) /reports/collections-v2 totals.other_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (today) /reports/collections-v2 totals.total_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (today) /payments/summary Pending.amount_paise | `26053300000` | `26053300000` | **PASS** | {'status': 'Pending'} |
| Home due_vs_received (today) loads | `True` | `True` | **PASS** |  |
| Home due_vs_received (today) /demands/register totals.total_paise | `0` | `0` | **PASS** | {'basis': 'due', 'date_from': '2026-11-20', 'date_to': '2026 |
| Home due_vs_received (today) /reports/collections-v2 totals.total_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home call_today (today) loads | `True` | `True` | **PASS** |  |
| Home call_today (today) /leads total | `3` | `3` | **PASS** | {'due_today': True} |
| Home call_today (today) /site-visits total | `6` | `6` | **PASS** | {'date_from': '2026-11-20', 'date_to': '2026-11-20', 'status |
| Home inflow_30 (today) loads | `True` | `True` | **PASS** |  |
| Home inflow_30 (today) /demands/register totals.balance_paise | `1475495000` | `1475495000` | **PASS** | {'basis': 'due', 'date_from': '2026-11-21', 'date_to': '2026 |
| Home inflow_30 (today) /payments/summary Pending.amount_paise | `26053300000` | `26053300000` | **PASS** | {'status': 'Pending'} |
| Home next_milestone (today) loads | `True` | `True` | **PASS** |  |
| Home next_milestone (today) /blocks/54e7ef57-ef1c-4639-8ae3-abd23bf0ad59/stages/9d1a8b0e-a1c9-4ef3-8e56-307caa1ab918/preview total_paise | `1095798000` | `1095798000` | **PASS** | {} |
| Home next_milestone (today) /blocks/1ad93271-5523-463e-b221-aaed913103bc/stages/2f0b3522-f968-4d8d-9ef0-e8357bf82b70/preview total_paise | `336257400` | `336257400` | **PASS** | {} |
| Home next_milestone (today) /blocks/3c011f05-4a65-438c-8cc9-b79f27c27b03/stages/cd8192a1-753a-47a1-91be-8e54178741f4/preview total_paise | `1215875300` | `1215875300` | **PASS** | {} |
| Home next_milestone (today) /blocks/15139c22-d8e1-4c64-bb84-39794cae33d5/stages/93065151-96a7-45e9-94fd-da5122ad6eaf/preview total_paise | `993308100` | `993308100` | **PASS** | {} |
| Home inventory (today) loads | `True` | `True` | **PASS** |  |
| Home inventory (today) /flats total | `6` | `6` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (today) /flats total | `2` | `2` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (today) /flats total | `23` | `23` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (today) /flats total | `21` | `21` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (today) /flats total | `63` | `63` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (today) /flats total | `26` | `26` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (today) /flats total | `58` | `58` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (today) /flats total | `17` | `17` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (today) /flats total | `31` | `31` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (today) /flats total | `8` | `8` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (today) /flats total | `48` | `48` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (today) /flats total | `11` | `11` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (today) /flats total | `19` | `19` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (today) /flats total | `18` | `18` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (today) /flats total | `38` | `38` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (today) /flats total | `29` | `29` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (today) /flats total | `55` | `55` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (today) /flats total | `22` | `22` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (today) /flats total | `34` | `34` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (today) /flats total | `24` | `24` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (today) /flats total | `48` | `48` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (today) /flats total | `15` | `15` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (today) /flats total | `41` | `41` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (today) /flats total | `15` | `15` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (today) /flats total | `33` | `33` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (today) /flats total | `13` | `13` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (today) /flats total | `43` | `43` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (today) /flats total | `19` | `19` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (today) /flats total | `65` | `65` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (today) /flats total | `11` | `11` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (today) /flats total | `37` | `37` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (today) /flats total | `25` | `25` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (today) /flats total | `47` | `47` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (today) /flats total | `27` | `27` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (today) /flats total | `37` | `37` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (today) /flats total | `20` | `20` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (today) /flats total | `44` | `44` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (today) /flats total | `27` | `27` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (today) /flats total | `57` | `57` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (today) /flats total | `32` | `32` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (today) /flats total | `52` | `52` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (today) /flats total | `18` | `18` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (today) /flats total | `54` | `54` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (today) /flats total | `16` | `16` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (today) /flats total | `32` | `32` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (today) /flats total | `15` | `15` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (today) /flats total | `57` | `57` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (today) /flats total | `29` | `29` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (today) /flats total | `43` | `43` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (today) /flats total | `18` | `18` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (today) /flats total | `38` | `38` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (today) /flats total | `20` | `20` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (today) /flats total | `44` | `44` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (today) /flats total | `15` | `15` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (today) /flats total | `25` | `25` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (today) /flats total | `29` | `29` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (today) /flats total | `43` | `43` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (today) /flats total | `12` | `12` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (today) /flats total | `36` | `36` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (today) /flats total | `16` | `16` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (today) /flats total | `24` | `24` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (today) /flats total | `22` | `22` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (today) /flats total | `62` | `62` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (today) /flats total | `22` | `22` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (today) /flats total | `62` | `62` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (today) /flats total | `20` | `20` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (today) /flats total | `52` | `52` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (today) /flats total | `21` | `21` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (today) /flats total | `43` | `43` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (today) /flats total | `4` | `4` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (today) /flats total | `5` | `5` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (today) /flats total | `6` | `6` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home flat_status (today) loads | `True` | `True` | **PASS** |  |
| Home construction (today) loads | `True` | `True` | **PASS** |  |
| Home pipeline (today) loads | `True` | `True` | **PASS** |  |
| Home pipeline (today) /leads total | `0` | `0` | **PASS** | {'created_from': '2026-11-20', 'created_to': '2026-11-20'} |
| Home pipeline (today) /site-visits total | `0` | `0` | **PASS** | {'date_from': '2026-11-20', 'date_to': '2026-11-20', 'status |
| Home pipeline (today) /bookings total | `0` | `0` | **PASS** | {'date_from': '2026-11-20', 'date_to': '2026-11-20', 'status |
| Home pipeline (today) /leads total | `0` | `0` | **PASS** | {'created_from': '2026-11-20', 'created_to': '2026-11-20', ' |
| Home attention (today) loads | `True` | `True` | **PASS** |  |
| Home attention (today) /flats total | `0` | `0` | **PASS** | {'hold_expiring': True} |
| Home attention (today) /payments/summary Bounced.count | `261` | `261` | **PASS** | {'status': 'Bounced', 'unreplaced': True} |
| Home attention (today) /demands/register totals.count | `438` | `438` | **PASS** | {'stale_days': 30} |
| Home ageing (month) loads | `True` | `True` | **PASS** |  |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=Not due].amount_paise | `7055033600` | `7055033600` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=0-30].amount_paise | `3717077500` | `3717077500` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=31-60].amount_paise | `4250127700` | `4250127700` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=61-90].amount_paise | `4414941800` | `4414941800` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=90+].amount_paise | `98209331800` | `98209331800` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 totals.outstanding_paise | `117646512400` | `117646512400` | **PASS** | {} |
| Home money_today (month) loads | `True` | `True` | **PASS** |  |
| Home money_today (month) /reports/collections-v2 totals.cash_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (month) /reports/collections-v2 totals.account_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (month) /reports/collections-v2 totals.other_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (month) /reports/collections-v2 totals.total_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (month) /payments/summary Pending.amount_paise | `26053300000` | `26053300000` | **PASS** | {'status': 'Pending'} |
| Home due_vs_received (month) loads | `True` | `True` | **PASS** |  |
| Home due_vs_received (month) /demands/register totals.total_paise | `14172930000` | `14172930000` | **PASS** | {'basis': 'due', 'date_from': '2026-11-01', 'date_to': '2026 |
| Home due_vs_received (month) /reports/collections-v2 totals.total_paise | `72365600000` | `72365600000` | **PASS** | {'from_date': '2026-11-01', 'to_date': '2026-11-30'} |
| Home call_today (month) loads | `True` | `True` | **PASS** |  |
| Home call_today (month) /leads total | `3` | `3` | **PASS** | {'due_today': True} |
| Home call_today (month) /site-visits total | `6` | `6` | **PASS** | {'date_from': '2026-11-20', 'date_to': '2026-11-20', 'status |
| Home inflow_30 (month) loads | `True` | `True` | **PASS** |  |
| Home inflow_30 (month) /demands/register totals.balance_paise | `1475495000` | `1475495000` | **PASS** | {'basis': 'due', 'date_from': '2026-11-21', 'date_to': '2026 |
| Home inflow_30 (month) /payments/summary Pending.amount_paise | `26053300000` | `26053300000` | **PASS** | {'status': 'Pending'} |
| Home next_milestone (month) loads | `True` | `True` | **PASS** |  |
| Home next_milestone (month) /blocks/54e7ef57-ef1c-4639-8ae3-abd23bf0ad59/stages/9d1a8b0e-a1c9-4ef3-8e56-307caa1ab918/preview total_paise | `1095798000` | `1095798000` | **PASS** | {} |
| Home next_milestone (month) /blocks/1ad93271-5523-463e-b221-aaed913103bc/stages/2f0b3522-f968-4d8d-9ef0-e8357bf82b70/preview total_paise | `336257400` | `336257400` | **PASS** | {} |
| Home next_milestone (month) /blocks/3c011f05-4a65-438c-8cc9-b79f27c27b03/stages/cd8192a1-753a-47a1-91be-8e54178741f4/preview total_paise | `1215875300` | `1215875300` | **PASS** | {} |
| Home next_milestone (month) /blocks/15139c22-d8e1-4c64-bb84-39794cae33d5/stages/93065151-96a7-45e9-94fd-da5122ad6eaf/preview total_paise | `993308100` | `993308100` | **PASS** | {} |
| Home inventory (month) loads | `True` | `True` | **PASS** |  |
| Home inventory (month) /flats total | `6` | `6` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (month) /flats total | `2` | `2` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (month) /flats total | `23` | `23` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (month) /flats total | `21` | `21` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (month) /flats total | `63` | `63` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (month) /flats total | `26` | `26` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (month) /flats total | `58` | `58` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (month) /flats total | `17` | `17` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (month) /flats total | `31` | `31` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (month) /flats total | `8` | `8` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (month) /flats total | `48` | `48` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (month) /flats total | `11` | `11` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (month) /flats total | `19` | `19` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (month) /flats total | `18` | `18` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (month) /flats total | `38` | `38` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (month) /flats total | `29` | `29` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (month) /flats total | `55` | `55` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (month) /flats total | `22` | `22` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (month) /flats total | `34` | `34` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (month) /flats total | `24` | `24` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (month) /flats total | `48` | `48` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (month) /flats total | `15` | `15` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (month) /flats total | `41` | `41` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (month) /flats total | `15` | `15` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (month) /flats total | `33` | `33` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (month) /flats total | `13` | `13` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (month) /flats total | `43` | `43` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (month) /flats total | `19` | `19` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (month) /flats total | `65` | `65` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (month) /flats total | `11` | `11` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (month) /flats total | `37` | `37` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (month) /flats total | `25` | `25` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (month) /flats total | `47` | `47` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (month) /flats total | `27` | `27` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (month) /flats total | `37` | `37` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (month) /flats total | `20` | `20` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (month) /flats total | `44` | `44` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (month) /flats total | `27` | `27` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (month) /flats total | `57` | `57` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (month) /flats total | `32` | `32` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (month) /flats total | `52` | `52` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (month) /flats total | `18` | `18` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (month) /flats total | `54` | `54` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (month) /flats total | `16` | `16` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (month) /flats total | `32` | `32` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (month) /flats total | `15` | `15` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (month) /flats total | `57` | `57` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (month) /flats total | `29` | `29` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (month) /flats total | `43` | `43` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (month) /flats total | `18` | `18` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (month) /flats total | `38` | `38` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (month) /flats total | `20` | `20` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (month) /flats total | `44` | `44` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (month) /flats total | `15` | `15` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (month) /flats total | `25` | `25` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (month) /flats total | `29` | `29` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (month) /flats total | `43` | `43` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (month) /flats total | `12` | `12` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (month) /flats total | `36` | `36` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (month) /flats total | `16` | `16` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (month) /flats total | `24` | `24` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (month) /flats total | `22` | `22` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (month) /flats total | `62` | `62` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (month) /flats total | `22` | `22` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (month) /flats total | `62` | `62` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (month) /flats total | `20` | `20` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (month) /flats total | `52` | `52` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (month) /flats total | `21` | `21` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (month) /flats total | `43` | `43` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (month) /flats total | `4` | `4` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (month) /flats total | `5` | `5` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (month) /flats total | `6` | `6` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home flat_status (month) loads | `True` | `True` | **PASS** |  |
| Home construction (month) loads | `True` | `True` | **PASS** |  |
| Home pipeline (month) loads | `True` | `True` | **PASS** |  |
| Home pipeline (month) /leads total | `1498` | `1498` | **PASS** | {'created_from': '2026-11-01', 'created_to': '2026-11-30'} |
| Home pipeline (month) /site-visits total | `2` | `2` | **PASS** | {'date_from': '2026-11-01', 'date_to': '2026-11-30', 'status |
| Home pipeline (month) /bookings total | `0` | `0` | **PASS** | {'date_from': '2026-11-01', 'date_to': '2026-11-30', 'status |
| Home pipeline (month) /leads total | `1` | `1` | **PASS** | {'created_from': '2026-11-01', 'created_to': '2026-11-30', ' |
| Home attention (month) loads | `True` | `True` | **PASS** |  |
| Home attention (month) /flats total | `0` | `0` | **PASS** | {'hold_expiring': True} |
| Home attention (month) /payments/summary Bounced.count | `261` | `261` | **PASS** | {'status': 'Bounced', 'unreplaced': True} |
| Home attention (month) /demands/register totals.count | `438` | `438` | **PASS** | {'stale_days': 30} |
| Home ageing (fy) loads | `True` | `True` | **PASS** |  |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=Not due].amount_paise | `7055033600` | `7055033600` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=0-30].amount_paise | `3717077500` | `3717077500` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=31-60].amount_paise | `4250127700` | `4250127700` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=61-90].amount_paise | `4414941800` | `4414941800` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=90+].amount_paise | `98209331800` | `98209331800` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 totals.outstanding_paise | `117646512400` | `117646512400` | **PASS** | {} |
| Home money_today (fy) loads | `True` | `True` | **PASS** |  |
| Home money_today (fy) /reports/collections-v2 totals.cash_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (fy) /reports/collections-v2 totals.account_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (fy) /reports/collections-v2 totals.other_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (fy) /reports/collections-v2 totals.total_paise | `0` | `0` | **PASS** | {'from_date': '2026-11-20', 'to_date': '2026-11-20'} |
| Home money_today (fy) /payments/summary Pending.amount_paise | `26053300000` | `26053300000` | **PASS** | {'status': 'Pending'} |
| Home due_vs_received (fy) loads | `True` | `True` | **PASS** |  |
| Home due_vs_received (fy) /demands/register totals.total_paise | `118338335000` | `118338335000` | **PASS** | {'basis': 'due', 'date_from': '2026-04-01', 'date_to': '2027 |
| Home due_vs_received (fy) /reports/collections-v2 totals.total_paise | `252659600000` | `252659600000` | **PASS** | {'from_date': '2026-04-01', 'to_date': '2027-03-31'} |
| Home call_today (fy) loads | `True` | `True` | **PASS** |  |
| Home call_today (fy) /leads total | `3` | `3` | **PASS** | {'due_today': True} |
| Home call_today (fy) /site-visits total | `6` | `6` | **PASS** | {'date_from': '2026-11-20', 'date_to': '2026-11-20', 'status |
| Home inflow_30 (fy) loads | `True` | `True` | **PASS** |  |
| Home inflow_30 (fy) /demands/register totals.balance_paise | `1475495000` | `1475495000` | **PASS** | {'basis': 'due', 'date_from': '2026-11-21', 'date_to': '2026 |
| Home inflow_30 (fy) /payments/summary Pending.amount_paise | `26053300000` | `26053300000` | **PASS** | {'status': 'Pending'} |
| Home next_milestone (fy) loads | `True` | `True` | **PASS** |  |
| Home next_milestone (fy) /blocks/54e7ef57-ef1c-4639-8ae3-abd23bf0ad59/stages/9d1a8b0e-a1c9-4ef3-8e56-307caa1ab918/preview total_paise | `1095798000` | `1095798000` | **PASS** | {} |
| Home next_milestone (fy) /blocks/1ad93271-5523-463e-b221-aaed913103bc/stages/2f0b3522-f968-4d8d-9ef0-e8357bf82b70/preview total_paise | `336257400` | `336257400` | **PASS** | {} |
| Home next_milestone (fy) /blocks/3c011f05-4a65-438c-8cc9-b79f27c27b03/stages/cd8192a1-753a-47a1-91be-8e54178741f4/preview total_paise | `1215875300` | `1215875300` | **PASS** | {} |
| Home next_milestone (fy) /blocks/15139c22-d8e1-4c64-bb84-39794cae33d5/stages/93065151-96a7-45e9-94fd-da5122ad6eaf/preview total_paise | `993308100` | `993308100` | **PASS** | {} |
| Home inventory (fy) loads | `True` | `True` | **PASS** |  |
| Home inventory (fy) /flats total | `6` | `6` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (fy) /flats total | `2` | `2` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (fy) /flats total | `23` | `23` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': '54e7ef57-ef1c-4639-8ae3-abd23bf0ad59', 'status |
| Home inventory (fy) /flats total | `21` | `21` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (fy) /flats total | `63` | `63` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '098bcefc-102a-4dcc-a8d9-23034c619390', 'status |
| Home inventory (fy) /flats total | `26` | `26` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (fy) /flats total | `58` | `58` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'a3d899a6-4c2f-49f5-9e36-fd4a87baea54', 'status |
| Home inventory (fy) /flats total | `17` | `17` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (fy) /flats total | `31` | `31` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '533a8a68-1a30-47c3-9521-8219d2ea8368', 'status |
| Home inventory (fy) /flats total | `8` | `8` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (fy) /flats total | `48` | `48` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'dbb72375-e060-4cb2-a2c2-86452c833cd8', 'status |
| Home inventory (fy) /flats total | `11` | `11` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (fy) /flats total | `19` | `19` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': '1ad93271-5523-463e-b221-aaed913103bc', 'status |
| Home inventory (fy) /flats total | `18` | `18` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (fy) /flats total | `38` | `38` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5f0dcf2d-5177-4335-9472-9816acb8d7c9', 'status |
| Home inventory (fy) /flats total | `29` | `29` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (fy) /flats total | `55` | `55` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5a1c2f6a-95db-47f4-8e03-63b7c6d00ba0', 'status |
| Home inventory (fy) /flats total | `22` | `22` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (fy) /flats total | `34` | `34` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'dc04eeb7-7c37-4cac-b51f-7d6de5d4ade0', 'status |
| Home inventory (fy) /flats total | `24` | `24` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (fy) /flats total | `48` | `48` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'c99a5ec1-8e6a-4269-b421-93067b393a6b', 'status |
| Home inventory (fy) /flats total | `15` | `15` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (fy) /flats total | `41` | `41` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '3c011f05-4a65-438c-8cc9-b79f27c27b03', 'status |
| Home inventory (fy) /flats total | `15` | `15` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (fy) /flats total | `33` | `33` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '0ef057d2-a8db-487d-8102-6557238fc451', 'status |
| Home inventory (fy) /flats total | `13` | `13` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (fy) /flats total | `43` | `43` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '74878fd8-2678-47b1-8690-b9dbec5d1aeb', 'status |
| Home inventory (fy) /flats total | `19` | `19` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (fy) /flats total | `65` | `65` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'b69c932a-4f99-4951-ab69-9b7076984a94', 'status |
| Home inventory (fy) /flats total | `11` | `11` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (fy) /flats total | `37` | `37` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '189ccda5-106b-4e4d-ba15-08bb52028405', 'status |
| Home inventory (fy) /flats total | `25` | `25` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (fy) /flats total | `47` | `47` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '9570c628-a196-4019-a401-95aa0ed8d7b3', 'status |
| Home inventory (fy) /flats total | `27` | `27` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (fy) /flats total | `37` | `37` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '2d49d389-2892-4215-847f-e912369dd264', 'status |
| Home inventory (fy) /flats total | `20` | `20` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (fy) /flats total | `44` | `44` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '863b4e42-b839-4d39-b976-03abd604ef14', 'status |
| Home inventory (fy) /flats total | `27` | `27` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (fy) /flats total | `57` | `57` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'db6e96b3-89b5-491f-b6e1-54f7d8bf22fe', 'status |
| Home inventory (fy) /flats total | `32` | `32` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (fy) /flats total | `52` | `52` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '444118cd-10c0-465c-939d-1d454bc0935a', 'status |
| Home inventory (fy) /flats total | `18` | `18` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (fy) /flats total | `54` | `54` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'd045c80e-5e6d-4eca-ae71-48c4782e72b7', 'status |
| Home inventory (fy) /flats total | `16` | `16` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (fy) /flats total | `32` | `32` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '40c9cf79-0614-480d-9a5d-5d8ad7112056', 'status |
| Home inventory (fy) /flats total | `15` | `15` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (fy) /flats total | `57` | `57` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '301e60d8-2bc5-4e49-8c3f-a4c93b7db799', 'status |
| Home inventory (fy) /flats total | `29` | `29` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (fy) /flats total | `43` | `43` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '028178a1-9e91-4ef2-a0f4-81b861cff2e6', 'status |
| Home inventory (fy) /flats total | `18` | `18` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (fy) /flats total | `38` | `38` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '876ad65a-9a64-4b87-aa3c-0e4cdd33d869', 'status |
| Home inventory (fy) /flats total | `20` | `20` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (fy) /flats total | `44` | `44` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '1ebe58a6-145b-4d87-8258-667374b9ced8', 'status |
| Home inventory (fy) /flats total | `15` | `15` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (fy) /flats total | `25` | `25` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'fe4ba088-a863-4714-bd44-9dc910de22ee', 'status |
| Home inventory (fy) /flats total | `29` | `29` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (fy) /flats total | `43` | `43` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '40e0f3fe-3127-4773-9846-7bcb5f988e85', 'status |
| Home inventory (fy) /flats total | `12` | `12` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (fy) /flats total | `36` | `36` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'cb4e04de-85a4-46f5-b045-14cb005c5136', 'status |
| Home inventory (fy) /flats total | `16` | `16` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (fy) /flats total | `24` | `24` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '3d853765-2bb9-44ef-af0a-dc00bb4fdc95', 'status |
| Home inventory (fy) /flats total | `22` | `22` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (fy) /flats total | `62` | `62` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '70431e71-e251-4ad2-9a16-9610d3d4502a', 'status |
| Home inventory (fy) /flats total | `22` | `22` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (fy) /flats total | `62` | `62` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '7c166715-0820-4544-85eb-3595c5f1a31b', 'status |
| Home inventory (fy) /flats total | `20` | `20` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (fy) /flats total | `52` | `52` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '843f2bed-5c96-48f5-a5aa-db70f1652b4b', 'status |
| Home inventory (fy) /flats total | `21` | `21` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (fy) /flats total | `43` | `43` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '8fbf569f-1d24-4957-a474-ba0fed6afc68', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (fy) /flats total | `4` | `4` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '90433c6e-cf0e-4706-81cc-b491fca605da', 'status |
| Home inventory (fy) /flats total | `5` | `5` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (fy) /flats total | `6` | `6` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '15139c22-d8e1-4c64-bb84-39794cae33d5', 'status |
| Home flat_status (fy) loads | `True` | `True` | **PASS** |  |
| Home construction (fy) loads | `True` | `True` | **PASS** |  |
| Home pipeline (fy) loads | `True` | `True` | **PASS** |  |
| Home pipeline (fy) /leads total | `1498` | `1498` | **PASS** | {'created_from': '2026-04-01', 'created_to': '2027-03-31'} |
| Home pipeline (fy) /site-visits total | `2` | `2` | **PASS** | {'date_from': '2026-04-01', 'date_to': '2027-03-31', 'status |
| Home pipeline (fy) /bookings total | `357` | `357` | **PASS** | {'date_from': '2026-04-01', 'date_to': '2027-03-31', 'status |
| Home pipeline (fy) /leads total | `1` | `1` | **PASS** | {'created_from': '2026-04-01', 'created_to': '2027-03-31', ' |
| Home attention (fy) loads | `True` | `True` | **PASS** |  |
| Home attention (fy) /flats total | `0` | `0` | **PASS** | {'hold_expiring': True} |
| Home attention (fy) /payments/summary Bounced.count | `261` | `261` | **PASS** | {'status': 'Bounced', 'unreplaced': True} |
| Home attention (fy) /demands/register totals.count | `438` | `438` | **PASS** | {'stale_days': 30} |
| Home Overdue by age total == report Outstanding (ONE number) | `117646512400` | `117646512400` | **PASS** |  |
| Home Money today == Σ today's allocation parts | `0` | `0` | **PASS** |  |
| report [collections-v2] net Jama (receipt basis, all time) == Σ cleared receipts | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] net Jama == Σ ledger Jama rows (receipts + reversals) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] FY total (cleared basis) == raw payments by cleared date | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] basis label present (cleared) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] FY total (receipt basis) == raw payments by receipt date | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] basis label present (receipt) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] FY total (clearance basis) == raw payments by clearance date | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] basis label present (clearance) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] cleared basis == legacy collections (both: cheque on its clearing day) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by project == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by block == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by bucket == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by mode == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by bank == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by rm == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] Σ by day == total (total_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] outstanding == Σ definitions.outstanding(summary) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] advance held == Σ definitions.advance | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] net == outstanding − advance == Σ Udhar − Σ Jama (received + waived) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] per booking: report net == ledger net == summary net; report outstanding == summary outstanding | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] outstanding == Home outstanding tile | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] bands Σ == outstanding | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] report bands == Σ definitions.ageing_bands | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by customer == total (outstanding_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by customer == total (net_balance_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by project == total (outstanding_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by project == total (net_balance_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by block == total (outstanding_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding-v2] Σ by block == total (net_balance_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [demand-vs-collection] demanded == Σ non-void demands on live bookings + transfer / revision adjustments | `` | `` | **PASS** | tools/tieout_reports.py |
| report [demand-vs-collection] collected == Σ demand.paid (live bookings) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [demand-vs-collection] Include cancelled − default == bridge line Cancelled bookings | `` | `` | **PASS** | tools/tieout_reports.py |
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
| report [receivables-forecast] Σ by stage == total (expected_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] Σ by month == total (expected_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] default grouping is tower → stage when no planned dates | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] stage grouping: one row per tower·stage, Σ == total | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] rows == Cancelled bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] refund paid == Σ paid refunds | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] ledger REFUND rows == Σ paid refunds | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] cleared == Σ non-cash receipts received (cleared day) in range | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] cheques in hand == Σ receipts in hand at range end | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] Bank-wise + Cash == Collections (one identity, to the paisa) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] demanded == Σ other_charges.demanded | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] collected == Σ other_charges.(paid − waived) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] collected == Σ Other ledger Jama (OTHER_CHARGE_PAYMENT + Other reversals/refunds) | `` | `` | **PASS** | tools/tieout_reports.py |
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
| report [construction-vs-plan] stage rows == Σ stages of active towers | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] stage demands == Σ ON_STAGE/ON_POSSESSION demands | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] subtotals == Σ their stage rows (demanded) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] no tower name with leading/trailing space | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] GET /payments/demands honours block_id | `` | `` | **PASS** | tools/tieout_reports.py |
| report [service-sla] tickets == service_requests | `` | `` | **PASS** | tools/tieout_reports.py |
| report [activity] audit actions == audit_logs (live log) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [data-quality] open demands on cancelled bookings == 0 (integrity) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [data-quality] towers without stage plan excludes inactive towers | `` | `` | **PASS** | tools/tieout_reports.py |
| report [data-quality] payment plans not summing 100 == 0 | `` | `` | **PASS** | tools/tieout_reports.py |
| report [data-quality] integrity report ok | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] Σ Account dues + Σ Cash dues == instalment outstanding | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] rows == live bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] Σ bills raised == Σ Cash + Account order raised | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] formula: raised − received − waived + advance == dues | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] final status kind == customer card, every booking | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] overdue days == customer card, every booking | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] ledger share state today == booking summary (as-of path) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] as of 2026-03-31: instalment net dues == ledger rows dated on / before that day | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] as of 2026-03-31 instalment net + other-charge net == carried from before at 2026-04-01 | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] Σ project subtotals == total dues | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] Σ tower subtotals == project subtotal | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-ageing] Σ bands == Σ total due | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-ageing] Σ total due == Σ outstanding (definitions) of live bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-ageing] rows == live bookings with dues | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-ageing] Σ total due == Outstanding & ageing report total | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] formula bridge: total due == Overdue & ageing total due | `` | `` | **PASS** | tools/tieout_reports.py |
| report [advance-holders] Σ advance == Σ booking advance (definitions) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [call-list] Σ due == ageing Σ total due | `` | `` | **PASS** | tools/tieout_reports.py |
| report [call-list] Σ overdue == ageing Σ overdue | `` | `` | **PASS** | tools/tieout_reports.py |
| report [call-list] sorted oldest first | `` | `` | **PASS** | tools/tieout_reports.py |
| report [kyc-pending] agreement pending == live bookings without signed agreement | `` | `` | **PASS** | tools/tieout_reports.py |
| report [payment-behaviour] customers == customers with live bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [payment-behaviour] on time ≤ bills due on every row | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-directory] rows == customers (not deleted) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancelled-customers] Σ refund payable == Σ cancellation refund | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancelled-customers] Σ refund paid == Σ refunds paid on cancelled bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-statement] bills − received − waived == Σ last running balance | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-statement] Σ bills == Σ booking Udhar | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections] new sheet == collections-v2 (group_by=month): 7 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections] new sheet == collections-v2 (group_by=receipt): 7 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [day-book] new sheet == roznamcha-summary (group_by=month): 5 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [day-book] new sheet == roznamcha-summary (group_by=day): 5 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] new sheet == bank-receipts: 3 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cheques] new sheet == cheques: 1 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bills-vs-collection] new sheet == demand-vs-collection: 5 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding] new sheet == outstanding-v2 (group_by=project): 7 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding] new sheet == outstanding-v2 (group_by=booking): 7 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cash-vs-account] new sheet == cash-vs-account (group_by=project): 8 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cash-vs-account] new sheet == cash-vs-account (group_by=booking): 8 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] new sheet == other-charges (group_by=charge): 4 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [other-charges] new sheet == other-charges (group_by=booking): 4 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] new sheet == receivables-forecast (group_by=stage): 3 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] new sheet == receivables-forecast (group_by=booking): 3 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [waivers] new sheet == waiver-register: 2 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [outstanding] filtered by one project == existing report filtered the same way | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections] period 2026-04-01…2026-09-30 == existing report same period | `` | `` | **PASS** | tools/tieout_reports.py |
| report [booking-register] Σ agreement value (Active + Completed) == bookings collection | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-summary] Σ bookings this FY == booking register (not cancelled) this FY | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-summary] Σ agreement value this FY == booking register this FY | `` | `` | **PASS** | tools/tieout_reports.py |
| report [discount-register] Σ discount (all dates) == existing Discount register | `` | `` | **PASS** | tools/tieout_reports.py |
| report [discount-register] Σ discount (all dates) == booking register discount (Active + Completed) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [plan-position] Σ bills raised == Customer status | `` | `` | **PASS** | tools/tieout_reports.py |
| report [plan-position] Σ received == Customer status Account + Cash received | `` | `` | **PASS** | tools/tieout_reports.py |
| report [agreements] signed + pending == live bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [agreements] signed == live bookings with an accepted plan | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] Σ refund payable == existing Cancellations report | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] Σ refund paid == existing Cancellations report | `` | `` | **PASS** | tools/tieout_reports.py |
| report [transfers] changes == transfers + revisions + price events on bookings + plan changes in audit log (bookings that exist) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-team] Σ sold (all dates) == existing Sales team report | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-team] Σ bookings (all dates) == existing Sales team report | `` | `` | **PASS** | tools/tieout_reports.py |
| report [realised-rate] Σ agreement value == Plan & stage position | `` | `` | **PASS** | tools/tieout_reports.py |
| report [realised-rate] Σ list − Σ agreement == Σ discount | `` | `` | **PASS** | tools/tieout_reports.py |
| report [booking-health] Σ overdue == Customer status overdue | `` | `` | **PASS** | tools/tieout_reports.py |
| report [booking-health] Σ total due == Customer status total due | `` | `` | **PASS** | tools/tieout_reports.py |
| report [booking-health] healthy + watch + at risk == live bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [project-statement] SGH Σ bill raised == existing Project statement | `` | `` | **PASS** | tools/tieout_reports.py |
| report [project-statement] SGH Σ received == existing Project statement | `` | `` | **PASS** | tools/tieout_reports.py |
| report [project-statement] SGH Σ balance signed == existing Project statement | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Available flats (real layer) == existing Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Hold flats (real layer) == existing Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Blocked flats (real layer) == existing Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Booked flats (real layer) == existing Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Sold flats (real layer) == existing Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Available flats for a display-layer viewer == shown-as available in Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Hold flats for a display-layer viewer == shown-as hold in Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Sold flats for a display-layer viewer == shown-as sold in Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] display-layer viewer sees no Booked / Blocked | `` | `` | **PASS** | tools/tieout_reports.py |
| report [stacking-plan] cells == flats in Inventory status | `` | `` | **PASS** | tools/tieout_reports.py |
| report [price-list] Σ list price of available flats == existing Inventory available value | `` | `` | **PASS** | tools/tieout_reports.py |
| report [price-list] unsold == available + hold in Inventory status | `` | `` | **PASS** | tools/tieout_reports.py |
| report [hold-register] active holds == flats on Hold in the flats master | `` | `` | **PASS** | tools/tieout_reports.py |
| report [hold-register] holds == existing Hold register active holds | `` | `` | **PASS** | tools/tieout_reports.py |
| report [hold-register] lapsing within 48 h == existing Hold register expiring | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Available flats for Sales (display layer) == shown-as available in Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Hold flats for Sales (display layer) == shown-as hold in Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [inventory-status] Sold flats for Sales (display layer) == shown-as sold in Inventory control | `` | `` | **PASS** | tools/tieout_reports.py |
| report [landowner] landowner units == existing Landowner share | `` | `` | **PASS** | tools/tieout_reports.py |
| report [landowner] masked units == existing Masked inventory | `` | `` | **PASS** | tools/tieout_reports.py |
| report [parking] Allotted slots == parking slots master | `` | `` | **PASS** | tools/tieout_reports.py |
| report [parking] Available slots == parking slots master | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] Σ demanded == existing Construction vs plan | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] Σ collected == existing Construction vs plan | `` | `` | **PASS** | tools/tieout_reports.py |
| report [construction-vs-plan] Σ balance == existing Construction vs plan | `` | `` | **PASS** | tools/tieout_reports.py |
| report [stage-bills] Σ bills raised == Customer status | `` | `` | **PASS** | tools/tieout_reports.py |
| report [stage-bills] Σ received == Customer status Account + Cash | `` | `` | **PASS** | tools/tieout_reports.py |
| report [stage-bills] Σ instalment dues == Customer status | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-velocity] Σ unsold == Inventory status available + hold | `` | `` | **PASS** | tools/tieout_reports.py |
| report [sales-velocity] Σ booked in the last 12 months == booking register same window | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-funnel] New (this FY) == existing Sales & leads funnel | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-funnel] Contacted (this FY) == existing Sales & leads funnel | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-funnel] Site Visit Scheduled (this FY) == existing Sales & leads funnel | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-funnel] Site Visit Done (this FY) == existing Sales & leads funnel | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-funnel] Negotiation (this FY) == existing Sales & leads funnel | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-funnel] Converted (this FY) == existing Sales & leads funnel | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-funnel] Lost (this FY) == existing Sales & leads funnel | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-funnel] Σ leads (this FY) == existing Sales & leads | `` | `` | **PASS** | tools/tieout_reports.py |
| report [source-performance] Website leads / converted == existing Sales & leads | `` | `` | **PASS** | tools/tieout_reports.py |
| report [source-performance] Walk-in leads / converted == existing Sales & leads | `` | `` | **PASS** | tools/tieout_reports.py |
| report [source-performance] Referral leads / converted == existing Sales & leads | `` | `` | **PASS** | tools/tieout_reports.py |
| report [source-performance] Broker leads / converted == existing Sales & leads | `` | `` | **PASS** | tools/tieout_reports.py |
| report [source-performance] Campaign leads / converted == existing Sales & leads | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-register] leads == leads master (live) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [follow-ups] overdue == existing Sales & leads follow-ups overdue (all dates) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [visit-register] completed / no-show / cancelled (this FY) == existing Site visit conversion | `` | `` | **PASS** | tools/tieout_reports.py |
| report [visit-register] visits (this FY) == existing scheduled | `` | `` | **PASS** | tools/tieout_reports.py |
| report [visit-register] booked after visit (this FY) == existing converted | `` | `` | **PASS** | tools/tieout_reports.py |
| report [visit-conversion] scheduled / completed / booked == existing Site visit conversion | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lost-leads] lost == leads master status Lost | `` | `` | **PASS** | tools/tieout_reports.py |
| report [response-time] responded + not yet == leads this FY (Lead funnel) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [lead-ageing] open leads == leads master open stages | `` | `` | **PASS** | tools/tieout_reports.py |
| report [team-pipeline] Σ open == Lead ageing open leads | `` | `` | **PASS** | tools/tieout_reports.py |
| report [team-pipeline] Σ follow-ups overdue == Follow-ups overdue | `` | `` | **PASS** | tools/tieout_reports.py |
| report [response-time] average first response (this FY) == existing Sales & leads avg_response_hours | `` | `` | **PASS** | tools/tieout_reports.py |
| report [service-sla] requests / open / resolved == existing Service requests & SLA | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] Collections == Bank-wise + Cash (this FY, to the paisa) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] identity has no unnamed remainder | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections] identity: bank modes + cash mode == Collections | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections] cheques in hand line == Bank-wise cheques in hand | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bills-vs-collection] default bill raised == Customer status bills raised | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bills-vs-collection] default view has no cancelled bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] Customer status bridge line == Bills vs Collection | `` | `` | **PASS** | tools/tieout_reports.py |
| Phase I report tie-outs all PASS | `True` | `True` | **PASS** | 217 report ties |
