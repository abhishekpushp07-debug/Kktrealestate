# Story dataset — headline numbers (as of 2026-10-26, seed 2526)

Produced by `tools/story_seed.py` through the real API (~2,700 calls, audited X-As-Of clock). `POST /api/admin/reseed {confirm:'RESEED', story:true, as_of:'2026-10-26'}` reproduces the dataset; `python tools/story_headline.py` rewrites this file. Asserted by `tests/test_story_headline.py`.

| Metric | Value |
|---|---|
| Units / booked / available | 132 / 78 / 51 |
| Total sold (agreement) | ₹520,567,500.00 |
| Collected (cleared) | ₹321,990,810.00 |
| Outstanding (bucket-capped) | ₹20,608,499.00 |
| Overdue | ₹15,890,961.00 (33 demands) |
| Advance held | ₹1,161,991.00 |
| Refunds paid | ₹418,162.00 |
| Cash / Account / Other charges collected | ₹131,113,630.00 / ₹191,831,305.00 / ₹206,500.00 |
| Cheque register (cleared / bounced / pending) | ₹17,388,615.00 / ₹391,440.00 / ₹132,675.00 |
| Cancellations: gross paid / forfeiture / refund | ₹1,160,625.00 / ₹742,463.00 / ₹418,162.00 |
| Leads / converted | 116 / 75 |

## Ageing bands (outstanding)

| Band | Amount |
|---|---|
| Not due | ₹4,717,538.00 |
| 0-30 | ₹753,300.00 |
| 31-60 | ₹6,131,724.00 |
| 61-90 | ₹1,703,750.00 |
| 90+ | ₹7,302,187.00 |

## Inventory per tower

| Tower · status | Units |
|---|---|
| Tower A|Available | 12 |
| Tower A|Booked | 20 |
| Tower B|Available | 13 |
| Tower B|Blocked | 1 |
| Tower B|Booked | 16 |
| Tower B|Hold | 2 |
| Tower C|Available | 26 |
| Tower C|Booked | 30 |
| Villa Block V|Booked | 11 |
| Villa Block V|Sold | 1 |

## Collections by month (sanity: looks like a business)

| Month | Collected |
|---|---|
| 2025-04 | ₹971,250.00 |
| 2025-05 | ₹2,098,700.00 |
| 2025-06 | ₹2,515,563.00 |
| 2025-07 | ₹8,165,813.00 |
| 2025-08 | ₹11,402,763.00 |
| 2025-09 | ₹17,606,713.00 |
| 2025-10 | ₹18,726,625.00 |
| 2025-11 | ₹9,726,937.00 |
| 2025-12 | ₹17,404,662.00 |
| 2026-01 | ₹25,599,538.00 |
| 2026-02 | ₹16,343,780.00 |
| 2026-03 | ₹38,174,694.00 |
| 2026-04 | ₹23,972,770.00 |
| 2026-05 | ₹28,108,756.00 |
| 2026-06 | ₹29,321,510.00 |
| 2026-07 | ₹17,782,180.00 |
| 2026-08 | ₹26,717,018.00 |
| 2026-09 | ₹15,867,562.00 |
| 2026-10 | ₹12,644,601.00 |

## By mode

| Mode | Amount |
|---|---|
| NEFT / RTGS | ₹95,767,355.00 |
| Cash | ₹86,776,959.00 |
| UPI | ₹44,543,171.00 |
| Demand Draft | ₹41,873,490.00 |
| Loan Disbursement | ₹36,801,845.00 |
| Cheque | ₹17,388,615.00 |

## Personas in the data

- BK-2526-0005 — fully paid villa, **Completed** (possession)
- **BK-2526-0009 — SECOND ANCHOR (owner's worked example)**: ₹1 Cr, 60 L cash / 40 L account, lump-sum plan (100 % on booking), owner's 10-payment table → due ₹0 (`tests/test_ledger_example.py`)
- **BK-2526-0014 — NEW REGRESSION ANCHOR**: cheque bounce + auto ₹500 bounce charge, replaced by NEFT — 23 ledger rows, due ₹500.00 (the unpaid bounce charge)
- BK-2526-0020 — agreement **revision** 60/40 → 50/50
- BK-2526-0026 — **transfer** to a cheaper unit @55 % cash, schedule telescoped
- BK-2526-0031 ↔ partner — **unit swap**
- BK-2526-0037 — **cancelled**, 10 % of received deducted, refund Pending → Paid NEFT; a second cancellation is a **forfeiture**
- late30/late60/late90/late90p personas populate the ageing bands; `advance` personas hold bucket advances; `loan` personas receive disbursements in two tranches
- 2 holds, 1 blocked unit, 1 hold released; rate edits on Tower C before sale; monthly cash deposits to bank (opening cash ₹25,000 on 01-Apr-2025; cash book never negative)
- Leads at every stage from 6 sources, visits completed/no-show/cancelled, 14 service tickets across categories (open → in progress → resolved → closed → reopened), 2 notices; portal enabled for the first 8 buyers (Amit Kumar Sinha 9431012345 / Priya Verma 9431023456, password Buyer@12345)
