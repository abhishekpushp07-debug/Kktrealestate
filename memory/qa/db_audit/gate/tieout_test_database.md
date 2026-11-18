# Report tie-outs · DB `test_database` · 2026-11-18

| Tie-out | Report value | Raw value | Result | Note |
|---|---|---|---|---|
| collections FY total == Σ cleared receipts | `37948222000` | `37948222000` | **PASS** |  |
| cheques-in-hand count == Pending payments | `1` | `1` | **PASS** |  |
| cheques-in-hand amount == Σ Pending | `4000000` | `4000000` | **PASS** |  |
| cheque register rows == instrument payments | `144` | `144` | **PASS** | raw by status {'Bounced': 2, 'Cleared': 141, 'Pending': 1} |
| inventory report by_status == flats | `{'Available': 102, 'Hold': 3, 'Booked': 79, 'Sold': 1, 'Blocked': 1}` | `{'Available': 102, 'Blocked': 1, 'Booked': 79, 'Hold': 3, 'Sold': 1}` | **PASS** |  |
| home units/available tiles == flats | `(186, 102)` | `(186, 102)` | **PASS** |  |
| legacy dashboard inventory == flats | `{'Available': 102, 'Hold': 3, 'Booked': 79, 'Sold': 1, 'Blocked': 1}` | `{'Available': 102, 'Blocked': 1, 'Booked': 79, 'Hold': 3, 'Sold': 1}` | **PASS** |  |
| outstanding total == Σ booking summary dues | `4497664300` | `4497664300` | **PASS** |  |
| home overdue tile == Σ bookings overdue (definitions.ageing_bands) | `2111748100` | `2111748100` | **PASS** |  |
| report overdue == Σ bookings overdue | `2111748100` | `2111748100` | **PASS** |  |
| dashboard overdue == report overdue | `2111748100` | `2111748100` | **PASS** |  |
| Outstanding by customer: one row per customer id | `80` | `80` | **PASS** |  |
| Outstanding by customer Σ net balance == by booking Σ net balance | `4424041700` | `4424041700` | **PASS** |  |
| Outstanding & Ageing band Not due == Σ bookings band Not due (definitions.ageing_bands) | `2385916200` | `2385916200` | **PASS** |  |
| Outstanding & Ageing band 0-30 == Σ bookings band 0-30 (definitions.ageing_bands) | `445882700` | `445882700` | **PASS** |  |
| Outstanding & Ageing band 31-60 == Σ bookings band 31-60 (definitions.ageing_bands) | `294132200` | `294132200` | **PASS** |  |
| Outstanding & Ageing band 61-90 == Σ bookings band 61-90 (definitions.ageing_bands) | `536987600` | `536987600` | **PASS** |  |
| Outstanding & Ageing band 90+ == Σ bookings band 90+ (definitions.ageing_bands) | `834745600` | `834745600` | **PASS** |  |
| booking card overdue days == definitions.overdue_days (every live booking) | `80` | `80` | **PASS** |  |
| other-charge parts with bill_day <= due_on | `723` | `723` | **PASS** |  |
| GST-with-stage part bill_day == the day of the instalment bill it was billed with | `599` | `599` | **PASS** |  |
| other-charge part due_on == its bill's due, else bill_day + days-to-pay | `723` | `723` | **PASS** |  |
| ageing bands sum == report total outstanding | `4497664300` | `4497664300` | **PASS** |  |
| report bands == Σ booking bands | `{'Not due': 2385916200, '0-30': 445882700, '31-60': 294132200, '61-90'` | `{'Not due': 2385916200, '0-30': 445882700, '31-60': 294132200, '61-90'` | **PASS** |  |
| home outstanding tile == Σ booking dues | `4497664300` | `4497664300` | **PASS** |  |
| home outstanding tile == outstanding report due | `4497664300` | `4497664300` | **PASS** |  |
| ONE NUMBER: Home outstanding == Outstanding report total | `4497664300` | `4497664300` | **PASS** |  |
| ONE NUMBER: Outstanding report total == Σ booking.summary.outstanding_paise | `4497664300` | `4497664300` | **PASS** |  |
| Home advance held == Σ booking.summary.advance_paise | `73622600` | `73622600` | **PASS** |  |
| refunds API Paid total == Σ paid refunds | `42289200` | `42289200` | **PASS** |  |
| cancellations report refund paid == Σ paid refunds | `42289200` | `42289200` | **PASS** |  |
| ledger REFUND contra rows == Σ paid refunds (all buckets) | `42289200` | `42289200` | **PASS** |  |
| bounce charges on bookings == bounce-charge audit rows | `2` | `2` | **PASS** |  |
| transferred bookings' flats point back to booking | `3` | `3` | **PASS** |  |
| cancelled bookings carry no open demands | `0` | `0` | **PASS** |  |
| demand-vs-collection demanded == Σ non-void demands | `38062956400` | `38062956400` | **PASS** |  |
| legacy dashboard collections.month == Σ cleared this month | `1769343200` | `1769343200` | **PASS** | month=2026-11 |
| cancellations rows == Cancelled bookings | `2` | `2` | **PASS** |  |
| sales-leads total == leads | `135` | `135` | **PASS** |  |
| Σ cleared cash receipts == booking.summary.cash_paid (all active) | `0` | `0` | **PASS** | count of bookings that differ |
| Σ Udhar − Σ Jama == outstanding − advance (every booking) | `0` | `0` | **PASS** | two-sided ledger law |
| manual bills counted in Outstanding (order = plan % + Σ manual) | `0` | `0` | **PASS** | 0 with manual bills |
| Σ customer-card Due == Σ live booking outstanding | `4497664300` | `4497664300` | **PASS** |  |
| Σ customer-card Advance == Σ live booking advance | `73622600` | `73622600` | **PASS** |  |
| Σ customer-card Overdue == ageing report overdue (definitions.ageing_for_bookings, incl. other charges) | `2111748100` | `2111748100` | **PASS** |  |
| customer segments partition All (overdue + on track + all clear + advance-only + no booking) | `82` | `82` | **PASS** |  |
| Advance chip == customers holding an advance (raw bookings) | `5` | `5` | **PASS** |  |
| KYC pending chip == active customers not Verified (raw) | `2` | `2` | **PASS** |  |
| customer-card 'agreement pending' == customers with an unsigned live booking (raw) | `0` | `0` | **PASS** |  |
| GGV banner 'booked or sold' == tower chart == raw flats | `(12, 12)` | `(12, 12)` | **PASS** |  |
| SGH banner 'booked or sold' == tower chart == raw flats | `(68, 68)` | `(68, 68)` | **PASS** |  |
| YE banner 'booked or sold' == tower chart == raw flats | `(0, 0)` | `(0, 0)` | **PASS** |  |
| Σ project-card Collected == Σ live booking Jama − waived | `37856346000` | `37856346000` | **PASS** |  |
| Σ project-card Outstanding == Σ live booking outstanding | `4497664300` | `4497664300` | **PASS** |  |
| booking-card Due == booking outstanding, one plan segment per instalment | `0` | `0` | **PASS** | 79 active bookings |
| plan-timeline row states == booking-card plan segments | `0` | `0` | **PASS** | 25 bookings |
| /bookings segment counts sum == list total | `82` | `82` | **PASS** |  |
| /projects segment counts sum == list total | `3` | `3` | **PASS** |  |
| Home month Cash·Account·Other == Σ allocation parts | `{'Cash': 953610600, 'Account': 667082400, 'Other': 148650200}` | `{'Cash': 953610600, 'Account': 667082400, 'Other': 148650200}` | **PASS** |  |
| Home month total == Cash + Account + Other | `1769343200` | `1769343200` | **PASS** |  |
| trends current month split == Σ allocation parts | `{'Cash': 953610600, 'Account': 667082400, 'Other': 148650200}` | `{'Cash': 953610600, 'Account': 667082400, 'Other': 148650200}` | **PASS** |  |
| collections-v2 (this month, by bucket) == Σ allocation parts | `{'Cash': 953610600, 'Account': 667082400, 'Other': 148650200}` | `{'Cash': 953610600, 'Account': 667082400, 'Other': 148650200}` | **PASS** |  |
| collections FY cash/account/other == Σ allocation parts | `{'Cash': 14395467400, 'Account': 19795551900, 'Other': 3757202700}` | `{'Cash': 14395467400, 'Account': 19795551900, 'Other': 3757202700}` | **PASS** |  |
| carried: opening + billed in period − received − waived in period == closing | `4424041700` | `4424041700` | **PASS** |  |
| bridge: received by payment date == Collections net received (receipt basis) | `20434866600` | `20434866600` | **PASS** |  |
| bridge: by payment date − not live − dated in, cleared after + dated before, cleared in + refunds == carried received | `20434866600` | `20434866600` | **PASS** |  |
| bridge from 2025-04-01: by clearance == carried received | `37856346000` | `37856346000` | **PASS** |  |
| bridge from 2026-11-02: by clearance == carried received | `1781739600` | `1781739600` | **PASS** |  |
| carried: closing == Outstanding report net balance (today) | `4424041700` | `4424041700` | **PASS** |  |
| formula: Bills vs Collection cash + account billed == total billed | `38062956400` | `38062956400` | **PASS** |  |
| bridge: Bills vs Collection instalment bills → all bills == Outstanding bill raised | `42283512700` | `42283512700` | **PASS** |  |
| formula: Advances cash + account == total advance | `73622600` | `73622600` | **PASS** |  |
| formula: Advances total == Outstanding report advance held | `73622600` | `73622600` | **PASS** |  |
| formula: Cheques cleared + bounced + pending == register amount | `5329442800` | `5329442800` | **PASS** |  |
| formula: Bank-wise sum of banks == total | `14604783900` | `14604783900` | **PASS** |  |
| formula: Bank-wise cleared + pending == total | `14604783900` | `14604783900` | **PASS** |  |
| Home due ageing == Outstanding report ageing (per band) | `{'Not due': 2385916200, '0-30': 445882700, '31-60': 294132200, '61-90'` | `{'Not due': 2385916200, '0-30': 445882700, '31-60': 294132200, '61-90'` | **PASS** |  |
| Home due ageing total == report Outstanding | `4497664300` | `4497664300` | **PASS** |  |
| Home ageing (today) loads | `True` | `True` | **PASS** |  |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=Not due].amount_paise | `2385916200` | `2385916200` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=0-30].amount_paise | `445882700` | `445882700` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=31-60].amount_paise | `294132200` | `294132200` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=61-90].amount_paise | `536987600` | `536987600` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 ageing[bucket=90+].amount_paise | `834745600` | `834745600` | **PASS** | {} |
| Home ageing (today) /reports/outstanding-v2 totals.outstanding_paise | `4497664300` | `4497664300` | **PASS** | {} |
| Home money_today (today) loads | `True` | `True` | **PASS** |  |
| Home money_today (today) /reports/collections-v2 totals.cash_paise | `27562800` | `27562800` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (today) /reports/collections-v2 totals.account_paise | `9187600` | `9187600` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (today) /reports/collections-v2 totals.other_paise | `4000000` | `4000000` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (today) /reports/collections-v2 totals.total_paise | `40750400` | `40750400` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (today) /payments/summary Pending.amount_paise | `4000000` | `4000000` | **PASS** | {'status': 'Pending'} |
| Home due_vs_received (today) loads | `True` | `True` | **PASS** |  |
| Home due_vs_received (today) /demands/register totals.total_paise | `0` | `0` | **PASS** | {'basis': 'due', 'date_from': '2026-11-18', 'date_to': '2026 |
| Home due_vs_received (today) /reports/collections-v2 totals.total_paise | `40750400` | `40750400` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home call_today (today) loads | `True` | `True` | **PASS** |  |
| Home call_today (today) /leads total | `1` | `1` | **PASS** | {'due_today': True} |
| Home call_today (today) /site-visits total | `1` | `1` | **PASS** | {'date_from': '2026-11-18', 'date_to': '2026-11-18', 'status |
| Home inflow_30 (today) loads | `True` | `True` | **PASS** |  |
| Home inflow_30 (today) /demands/register totals.balance_paise | `2123035000` | `2123035000` | **PASS** | {'basis': 'due', 'date_from': '2026-11-19', 'date_to': '2026 |
| Home inflow_30 (today) /payments/summary Pending.amount_paise | `4000000` | `4000000` | **PASS** | {'status': 'Pending'} |
| Home next_milestone (today) loads | `True` | `True` | **PASS** |  |
| Home next_milestone (today) /blocks/8c8d8d49-1575-45d7-86b0-70f09cc71917/stages/892b47c6-35c7-42e2-bbca-5734bd291f76/preview total_paise | `0` | `0` | **PASS** | {} |
| Home next_milestone (today) /blocks/5d2087ec-b20a-4abb-ae11-3a1bf447f158/stages/d60cd0cf-dcdc-4e09-a375-977838cbb1a4/preview total_paise | `0` | `0` | **PASS** | {} |
| Home next_milestone (today) /blocks/cabe48b7-d5fe-40ed-ae75-0ab01d693877/stages/ab5fb388-ca9f-46b0-b260-060d213c1b34/preview total_paise | `1507668800` | `1507668800` | **PASS** | {} |
| Home next_milestone (today) /blocks/21dca443-0913-4d8f-923f-c23959081b49/stages/ab5fb388-ca9f-46b0-b260-060d213c1b34/preview total_paise | `2822793600` | `2822793600` | **PASS** | {} |
| Home next_milestone (today) /blocks/0d220380-bdd3-4202-9769-7a5db753b75a/stages/892b47c6-35c7-42e2-bbca-5734bd291f76/preview total_paise | `0` | `0` | **PASS** | {} |
| Home inventory (today) loads | `True` | `True` | **PASS** |  |
| Home inventory (today) /flats total | `48` | `48` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (today) /flats total | `12` | `12` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (today) /flats total | `20` | `20` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (today) /flats total | `13` | `13` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (today) /flats total | `2` | `2` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (today) /flats total | `16` | `16` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (today) /flats total | `23` | `23` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (today) /flats total | `32` | `32` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (today) /flats total | `6` | `6` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (today) /flats total | `11` | `11` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (today) /flats total | `1` | `1` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (today) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home flat_status (today) loads | `True` | `True` | **PASS** |  |
| Home construction (today) loads | `True` | `True` | **PASS** |  |
| Home pipeline (today) loads | `True` | `True` | **PASS** |  |
| Home pipeline (today) /leads total | `15` | `15` | **PASS** | {'created_from': '2026-11-18', 'created_to': '2026-11-18'} |
| Home pipeline (today) /site-visits total | `0` | `0` | **PASS** | {'date_from': '2026-11-18', 'date_to': '2026-11-18', 'status |
| Home pipeline (today) /bookings total | `2` | `2` | **PASS** | {'date_from': '2026-11-18', 'date_to': '2026-11-18', 'status |
| Home pipeline (today) /leads total | `0` | `0` | **PASS** | {'created_from': '2026-11-18', 'created_to': '2026-11-18', ' |
| Home attention (today) loads | `True` | `True` | **PASS** |  |
| Home attention (today) /flats total | `1` | `1` | **PASS** | {'hold_expiring': True} |
| Home attention (today) /payments/summary Bounced.count | `0` | `0` | **PASS** | {'status': 'Bounced', 'unreplaced': True} |
| Home attention (today) /demands/register totals.count | `5` | `5` | **PASS** | {'stale_days': 30} |
| Home ageing (month) loads | `True` | `True` | **PASS** |  |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=Not due].amount_paise | `2385916200` | `2385916200` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=0-30].amount_paise | `445882700` | `445882700` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=31-60].amount_paise | `294132200` | `294132200` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=61-90].amount_paise | `536987600` | `536987600` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 ageing[bucket=90+].amount_paise | `834745600` | `834745600` | **PASS** | {} |
| Home ageing (month) /reports/outstanding-v2 totals.outstanding_paise | `4497664300` | `4497664300` | **PASS** | {} |
| Home money_today (month) loads | `True` | `True` | **PASS** |  |
| Home money_today (month) /reports/collections-v2 totals.cash_paise | `27562800` | `27562800` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (month) /reports/collections-v2 totals.account_paise | `9187600` | `9187600` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (month) /reports/collections-v2 totals.other_paise | `4000000` | `4000000` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (month) /reports/collections-v2 totals.total_paise | `40750400` | `40750400` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (month) /payments/summary Pending.amount_paise | `4000000` | `4000000` | **PASS** | {'status': 'Pending'} |
| Home due_vs_received (month) loads | `True` | `True` | **PASS** |  |
| Home due_vs_received (month) /demands/register totals.total_paise | `3482076000` | `3482076000` | **PASS** | {'basis': 'due', 'date_from': '2026-11-01', 'date_to': '2026 |
| Home due_vs_received (month) /reports/collections-v2 totals.total_paise | `1769343200` | `1769343200` | **PASS** | {'from_date': '2026-11-01', 'to_date': '2026-11-30'} |
| Home call_today (month) loads | `True` | `True` | **PASS** |  |
| Home call_today (month) /leads total | `1` | `1` | **PASS** | {'due_today': True} |
| Home call_today (month) /site-visits total | `1` | `1` | **PASS** | {'date_from': '2026-11-18', 'date_to': '2026-11-18', 'status |
| Home inflow_30 (month) loads | `True` | `True` | **PASS** |  |
| Home inflow_30 (month) /demands/register totals.balance_paise | `2123035000` | `2123035000` | **PASS** | {'basis': 'due', 'date_from': '2026-11-19', 'date_to': '2026 |
| Home inflow_30 (month) /payments/summary Pending.amount_paise | `4000000` | `4000000` | **PASS** | {'status': 'Pending'} |
| Home next_milestone (month) loads | `True` | `True` | **PASS** |  |
| Home next_milestone (month) /blocks/8c8d8d49-1575-45d7-86b0-70f09cc71917/stages/892b47c6-35c7-42e2-bbca-5734bd291f76/preview total_paise | `0` | `0` | **PASS** | {} |
| Home next_milestone (month) /blocks/5d2087ec-b20a-4abb-ae11-3a1bf447f158/stages/d60cd0cf-dcdc-4e09-a375-977838cbb1a4/preview total_paise | `0` | `0` | **PASS** | {} |
| Home next_milestone (month) /blocks/cabe48b7-d5fe-40ed-ae75-0ab01d693877/stages/ab5fb388-ca9f-46b0-b260-060d213c1b34/preview total_paise | `1507668800` | `1507668800` | **PASS** | {} |
| Home next_milestone (month) /blocks/21dca443-0913-4d8f-923f-c23959081b49/stages/ab5fb388-ca9f-46b0-b260-060d213c1b34/preview total_paise | `2822793600` | `2822793600` | **PASS** | {} |
| Home next_milestone (month) /blocks/0d220380-bdd3-4202-9769-7a5db753b75a/stages/892b47c6-35c7-42e2-bbca-5734bd291f76/preview total_paise | `0` | `0` | **PASS** | {} |
| Home inventory (month) loads | `True` | `True` | **PASS** |  |
| Home inventory (month) /flats total | `48` | `48` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (month) /flats total | `12` | `12` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (month) /flats total | `20` | `20` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (month) /flats total | `13` | `13` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (month) /flats total | `2` | `2` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (month) /flats total | `16` | `16` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (month) /flats total | `23` | `23` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (month) /flats total | `32` | `32` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (month) /flats total | `6` | `6` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (month) /flats total | `11` | `11` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (month) /flats total | `1` | `1` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (month) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home flat_status (month) loads | `True` | `True` | **PASS** |  |
| Home construction (month) loads | `True` | `True` | **PASS** |  |
| Home pipeline (month) loads | `True` | `True` | **PASS** |  |
| Home pipeline (month) /leads total | `21` | `21` | **PASS** | {'created_from': '2026-11-01', 'created_to': '2026-11-30'} |
| Home pipeline (month) /site-visits total | `0` | `0` | **PASS** | {'date_from': '2026-11-01', 'date_to': '2026-11-30', 'status |
| Home pipeline (month) /bookings total | `2` | `2` | **PASS** | {'date_from': '2026-11-01', 'date_to': '2026-11-30', 'status |
| Home pipeline (month) /leads total | `1` | `1` | **PASS** | {'created_from': '2026-11-01', 'created_to': '2026-11-30', ' |
| Home attention (month) loads | `True` | `True` | **PASS** |  |
| Home attention (month) /flats total | `1` | `1` | **PASS** | {'hold_expiring': True} |
| Home attention (month) /payments/summary Bounced.count | `0` | `0` | **PASS** | {'status': 'Bounced', 'unreplaced': True} |
| Home attention (month) /demands/register totals.count | `5` | `5` | **PASS** | {'stale_days': 30} |
| Home ageing (fy) loads | `True` | `True` | **PASS** |  |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=Not due].amount_paise | `2385916200` | `2385916200` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=0-30].amount_paise | `445882700` | `445882700` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=31-60].amount_paise | `294132200` | `294132200` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=61-90].amount_paise | `536987600` | `536987600` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 ageing[bucket=90+].amount_paise | `834745600` | `834745600` | **PASS** | {} |
| Home ageing (fy) /reports/outstanding-v2 totals.outstanding_paise | `4497664300` | `4497664300` | **PASS** | {} |
| Home money_today (fy) loads | `True` | `True` | **PASS** |  |
| Home money_today (fy) /reports/collections-v2 totals.cash_paise | `27562800` | `27562800` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (fy) /reports/collections-v2 totals.account_paise | `9187600` | `9187600` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (fy) /reports/collections-v2 totals.other_paise | `4000000` | `4000000` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (fy) /reports/collections-v2 totals.total_paise | `40750400` | `40750400` | **PASS** | {'from_date': '2026-11-18', 'to_date': '2026-11-18'} |
| Home money_today (fy) /payments/summary Pending.amount_paise | `4000000` | `4000000` | **PASS** | {'status': 'Pending'} |
| Home due_vs_received (fy) loads | `True` | `True` | **PASS** |  |
| Home due_vs_received (fy) /demands/register totals.total_paise | `22072987400` | `22072987400` | **PASS** | {'basis': 'due', 'date_from': '2026-04-01', 'date_to': '2027 |
| Home due_vs_received (fy) /reports/collections-v2 totals.total_paise | `20434866600` | `20434866600` | **PASS** | {'from_date': '2026-04-01', 'to_date': '2027-03-31'} |
| Home call_today (fy) loads | `True` | `True` | **PASS** |  |
| Home call_today (fy) /leads total | `1` | `1` | **PASS** | {'due_today': True} |
| Home call_today (fy) /site-visits total | `1` | `1` | **PASS** | {'date_from': '2026-11-18', 'date_to': '2026-11-18', 'status |
| Home inflow_30 (fy) loads | `True` | `True` | **PASS** |  |
| Home inflow_30 (fy) /demands/register totals.balance_paise | `2123035000` | `2123035000` | **PASS** | {'basis': 'due', 'date_from': '2026-11-19', 'date_to': '2026 |
| Home inflow_30 (fy) /payments/summary Pending.amount_paise | `4000000` | `4000000` | **PASS** | {'status': 'Pending'} |
| Home next_milestone (fy) loads | `True` | `True` | **PASS** |  |
| Home next_milestone (fy) /blocks/8c8d8d49-1575-45d7-86b0-70f09cc71917/stages/892b47c6-35c7-42e2-bbca-5734bd291f76/preview total_paise | `0` | `0` | **PASS** | {} |
| Home next_milestone (fy) /blocks/5d2087ec-b20a-4abb-ae11-3a1bf447f158/stages/d60cd0cf-dcdc-4e09-a375-977838cbb1a4/preview total_paise | `0` | `0` | **PASS** | {} |
| Home next_milestone (fy) /blocks/cabe48b7-d5fe-40ed-ae75-0ab01d693877/stages/ab5fb388-ca9f-46b0-b260-060d213c1b34/preview total_paise | `1507668800` | `1507668800` | **PASS** | {} |
| Home next_milestone (fy) /blocks/21dca443-0913-4d8f-923f-c23959081b49/stages/ab5fb388-ca9f-46b0-b260-060d213c1b34/preview total_paise | `2822793600` | `2822793600` | **PASS** | {} |
| Home next_milestone (fy) /blocks/0d220380-bdd3-4202-9769-7a5db753b75a/stages/892b47c6-35c7-42e2-bbca-5734bd291f76/preview total_paise | `0` | `0` | **PASS** | {} |
| Home inventory (fy) loads | `True` | `True` | **PASS** |  |
| Home inventory (fy) /flats total | `48` | `48` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '8c8d8d49-1575-45d7-86b0-70f09cc71917', 'status |
| Home inventory (fy) /flats total | `12` | `12` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (fy) /flats total | `20` | `20` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '5d2087ec-b20a-4abb-ae11-3a1bf447f158', 'status |
| Home inventory (fy) /flats total | `13` | `13` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (fy) /flats total | `2` | `2` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (fy) /flats total | `16` | `16` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': 'cabe48b7-d5fe-40ed-ae75-0ab01d693877', 'status |
| Home inventory (fy) /flats total | `23` | `23` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (fy) /flats total | `32` | `32` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '21dca443-0913-4d8f-923f-c23959081b49', 'status |
| Home inventory (fy) /flats total | `6` | `6` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '0d220380-bdd3-4202-9769-7a5db753b75a', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (fy) /flats total | `11` | `11` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (fy) /flats total | `1` | `1` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home inventory (fy) /flats total | `0` | `0` | **PASS** | {'block_id': '439da97b-a56e-4425-adf6-fa4ac195b8f2', 'status |
| Home flat_status (fy) loads | `True` | `True` | **PASS** |  |
| Home construction (fy) loads | `True` | `True` | **PASS** |  |
| Home pipeline (fy) loads | `True` | `True` | **PASS** |  |
| Home pipeline (fy) /leads total | `64` | `64` | **PASS** | {'created_from': '2026-04-01', 'created_to': '2027-03-31'} |
| Home pipeline (fy) /site-visits total | `24` | `24` | **PASS** | {'date_from': '2026-04-01', 'date_to': '2027-03-31', 'status |
| Home pipeline (fy) /bookings total | `26` | `26` | **PASS** | {'date_from': '2026-04-01', 'date_to': '2027-03-31', 'status |
| Home pipeline (fy) /leads total | `5` | `5` | **PASS** | {'created_from': '2026-04-01', 'created_to': '2027-03-31', ' |
| Home attention (fy) loads | `True` | `True` | **PASS** |  |
| Home attention (fy) /flats total | `1` | `1` | **PASS** | {'hold_expiring': True} |
| Home attention (fy) /payments/summary Bounced.count | `0` | `0` | **PASS** | {'status': 'Bounced', 'unreplaced': True} |
| Home attention (fy) /demands/register totals.count | `5` | `5` | **PASS** | {'stale_days': 30} |
| Home Overdue by age total == report Outstanding (ONE number) | `4497664300` | `4497664300` | **PASS** |  |
| Home Money today == Σ today's allocation parts | `40750400` | `40750400` | **PASS** |  |
| report [collections-v2] net Jama (receipt basis, all time) == Σ cleared receipts | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] net Jama == Σ ledger Jama rows (receipts + reversals) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] FY total (receipt basis) == raw payments by receipt date | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] basis label present (receipt) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] FY total (clearance basis) == raw payments by clearance date | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] basis label present (clearance) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections-v2] receipt basis == legacy collections (payment_date, Cleared) | `` | `` | **PASS** | tools/tieout_reports.py |
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
| report [receivables-forecast] Σ by stage == total (expected_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] Σ by month == total (expected_paise) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] default grouping is tower → stage when no planned dates | `` | `` | **PASS** | tools/tieout_reports.py |
| report [receivables-forecast] stage grouping: one row per tower·stage, Σ == total | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] rows == Cancelled bookings | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] refund paid == Σ paid refunds | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cancellations] ledger REFUND rows == Σ paid refunds | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] cleared == Σ non-cash cleared | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] pending == Σ non-cash pending | `` | `` | **PASS** | tools/tieout_reports.py |
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
| report [customer-status] as of 2026-03-31: instalment net dues == ledger rows on that day | `` | `` | **PASS** | tools/tieout_reports.py |
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
| report [collections] new sheet == collections-v2 (group_by=month): 5 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [collections] new sheet == collections-v2 (group_by=receipt): 5 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [day-book] new sheet == roznamcha-summary (group_by=month): 5 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [day-book] new sheet == roznamcha-summary (group_by=day): 5 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] new sheet == bank-receipts: 3 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [cheques] new sheet == cheques: 1 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bills-vs-collection] new sheet == demand-vs-collection: 4 money totals | `` | `` | **PASS** | tools/tieout_reports.py |
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
| report [parking] Attached slots == parking slots master | `` | `` | **PASS** | tools/tieout_reports.py |
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
| report [source-performance] Brochure leads / converted == existing Sales & leads | `` | `` | **PASS** | tools/tieout_reports.py |
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
| report [bank-receipts] Collections == Bank-wise total − pending + cash receipts − reversals (this FY, to the paisa) | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bank-receipts] bridge has no unexplained remainder | `` | `` | **PASS** | tools/tieout_reports.py |
| report [bills-vs-collection] bill raised − on cancelled/transferred ± transfer adjustments == Customer status bills raised | `` | `` | **PASS** | tools/tieout_reports.py |
| report [customer-status] Customer status bridge line == Bills vs Collection bridge | `` | `` | **PASS** | tools/tieout_reports.py |
| Phase I report tie-outs all PASS | `True` | `True` | **PASS** | 212 report ties |
