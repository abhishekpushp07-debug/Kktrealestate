# Story dataset — headline numbers (as of 2026-10-26, seed 2526)

Produced by `tools/story_seed.py` through the real API (~2,700 calls, audited X-As-Of clock). `POST /api/admin/reseed {confirm:'RESEED', story:true, as_of:'2026-10-26'}` reproduces the dataset; `python tools/story_headline.py` rewrites this file. Asserted by `tests/test_story_headline.py`.

| Metric | Value |
|---|---|
| Units / booked / available | 138 / 78 / 56 |
| Total sold (agreement) | ₹512,216,800.00 |
| Collected (cleared) | ₹322,610,455.00 |
| Outstanding (bucket-capped) | ₹52,417,491.00 |
| Overdue | ₹52,417,491.00 (26 demands) |
| Advance held | ₹1,253,176.00 |
| Refunds paid | ₹418,158.00 |
| Cash / Account / Other charges collected | ₹124,230,643.00 / ₹186,534,688.00 / ₹265,500.00 |
| Cheque register (cleared / bounced / pending) | ₹15,770,984.00 / ₹390,320.00 / ₹40,000.00 |
| Cancellations: gross paid / forfeiture / refund | ₹0.00 / ₹0.00 / ₹0.00 |
| Leads / converted | 111 / 75 |

## Ageing bands (outstanding)

| Band | Amount |
|---|---|
| Not due | ₹0.00 |
| 0-30 | ₹1,371,616.00 |
| 31-60 | ₹333,314.00 |
| 61-90 | ₹9,868,254.00 |
| 90+ | ₹40,844,307.00 |

## Inventory per tower

| Tower · status | Units |
|---|---|
| Tower A|Available | 12 |
| Tower A|Booked | 20 |
| Tower B|Available | 13 |
| Tower B|Blocked | 1 |
| Tower B|Booked | 16 |
| Tower B|Hold | 2 |
| Tower C|Available | 25 |
| Tower C|Booked | 30 |
| Tower C|Hold | 1 |
| Villa Block P (Premium)|Available | 6 |
| Villa Block V|Booked | 12 |

## Collections by month (sanity: looks like a business)

| Month | Collected |
|---|---|
| 2025-04 | ₹971,260.00 |
| 2025-05 | ₹2,098,700.00 |
| 2025-06 | ₹2,515,570.00 |
| 2025-07 | ₹8,165,820.00 |
| 2025-08 | ₹10,981,530.00 |
| 2025-09 | ₹17,606,700.00 |
| 2025-10 | ₹18,505,526.00 |
| 2025-11 | ₹9,726,920.00 |
| 2025-12 | ₹17,169,470.00 |
| 2026-01 | ₹25,599,550.00 |
| 2026-02 | ₹15,604,329.00 |
| 2026-03 | ₹33,448,540.00 |
| 2026-04 | ₹23,347,560.00 |
| 2026-05 | ₹31,347,420.00 |
| 2026-06 | ₹25,793,700.00 |
| 2026-07 | ₹18,958,375.00 |
| 2026-08 | ₹24,711,435.00 |
| 2026-09 | ₹14,550,165.00 |
| 2026-10 | ₹9,928,261.00 |

## By mode

| Mode | Amount |
|---|---|
| NEFT / RTGS | ₹99,642,102.00 |
| Cash | ₹81,832,327.00 |
| UPI | ₹42,663,816.00 |
| Demand Draft | ₹36,838,054.00 |
| Loan Disbursement | ₹35,101,348.00 |
| Cheque | ₹14,953,184.00 |

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
