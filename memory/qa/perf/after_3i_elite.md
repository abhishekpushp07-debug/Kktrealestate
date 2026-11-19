# After 3I — Elite shape (kkt_volume 1,500 bookings · 2 processes · cores 0,1 · no Redis)

Same tool and set-up as `baseline_3g_elite.md` (`tools/perf_reports_v3.py --cold 10 --warm 30`). First = first open right after a write (every cache stale). Server time (Server-Timing).

**45/50 reports ≤ 300 ms p95 on the first open** (3G: 17/50). Repeat opens: every report ≤ 29 ms p95.

| Report | 3G first p95 | 3I first p50 | 3I first p95 | 3G repeat p95 | 3I repeat p95 | ≤ 300 |
|---|---|---|---|---|---|---|
| receivables-forecast | 1785 | 256 | 262 | 33 | 24 | yes |
| collections | 1517 | 831 | 945 | 34 | 24 | **no** |
| bank-receipts | 837 | 137 | 138 | 11 | 5 | yes |
| booking-health | 764 | 197 | 203 | 35 | 23 | yes |
| transfers | 758 | 241 | 250 | 10 | 5 | yes |
| stage-bills | 755 | 169 | 184 | 14 | 4 | yes |
| stacking-plan | 740 | 180 | 183 | 41 | 29 | yes |
| realised-rate | 730 | 195 | 274 | 34 | 24 | yes |
| inventory-status | 730 | 167 | 176 | 39 | 26 | yes |
| construction-vs-plan | 726 | 147 | 150 | 16 | 4 | yes |
| sales-team | 725 | 219 | 222 | 8 | 4 | yes |
| sales-velocity | 719 | 163 | 172 | 18 | 5 | yes |
| cheques | 714 | 181 | 213 | 34 | 23 | yes |
| source-performance | 713 | 124 | 134 | 6 | 4 | yes |
| team-pipeline | 708 | 124 | 135 | 13 | 4 | yes |
| hold-register | 673 | 147 | 186 | 13 | 4 | yes |
| plan-position | 672 | 189 | 201 | 34 | 23 | yes |
| agreements | 668 | 194 | 200 | 34 | 24 | yes |
| visit-register | 634 | 67 | 77 | 8 | 4 | yes |
| service-sla | 619 | 48 | 49 | 6 | 4 | yes |
| sales-summary | 617 | 168 | 312 | 7 | 4 | **no** |
| booking-register | 616 | 198 | 231 | 34 | 26 | yes |
| outstanding | 605 | 294 | 320 | 36 | 23 | **no** |
| other-charges | 530 | 152 | 170 | 35 | 25 | yes |
| payment-behaviour | 513 | 330 | 337 | 24 | 12 | **no** |
| bills-vs-collection | 507 | 158 | 158 | 17 | 5 | yes |
| discount-register | 461 | 49 | 50 | 16 | 5 | yes |
| customer-status | 405 | 294 | 314 | 37 | 27 | **no** |
| customer-directory | 371 | 183 | 218 | 26 | 13 | yes |
| kyc-pending | 344 | 201 | 207 | 36 | 24 | yes |
| call-list | 329 | 203 | 211 | 36 | 24 | yes |
| advance-holders | 316 | 178 | 201 | 32 | 18 | yes |
| customer-ageing | 302 | 192 | 248 | 37 | 29 | yes |
| cash-vs-account | 281 | 132 | 142 | 35 | 24 | yes |
| lead-funnel | 176 | 135 | 137 | 12 | 4 | yes |
| landowner | 172 | 149 | 156 | 13 | 4 | yes |
| price-list | 165 | 152 | 160 | 24 | 12 | yes |
| cancelled-customers | 148 | 21 | 21 | 17 | 4 | yes |
| day-book | 140 | 91 | 92 | 8 | 5 | yes |
| project-statement | 104 | 59 | 66 | 19 | 7 | yes |
| lead-register | 92 | 78 | 85 | 5 | 5 | yes |
| lead-ageing | 89 | 63 | 68 | 16 | 4 | yes |
| visit-conversion | 86 | 49 | 50 | 10 | 4 | yes |
| lost-leads | 86 | 63 | 74 | 7 | 4 | yes |
| response-time | 81 | 64 | 66 | 16 | 4 | yes |
| follow-ups | 79 | 62 | 63 | 11 | 5 | yes |
| waivers | 77 | 45 | 50 | 11 | 5 | yes |
| cancellations | 77 | 42 | 42 | 11 | 5 | yes |
| customer-statement | 39 | 23 | 28 | 22 | 15 | yes |
| parking | 39 | 20 | 20 | 17 | 4 | yes |

## Hot reads and writes (perf_budget.py, same set-up) — 3G baseline in brackets

| Kind | Path | p50 warm | p95 warm | p95 first-after-save |
|---|---|---|---|---|
| hot | Home Command Center (month) | 11.9 | 15.3 | 451.6  |
| hot | Home Command Center (FY) | 12.0 | 15.6 | 376.4  |
| hot | Home Command Center (Today, project) | 7.7 | 10.4 | 180.3  |
| hot | Home legacy snapshot | 6.2 | 10.1 | 225.8  |
| hot | Project list | 42.5 | 52.5 | 50.1  |
| hot | Project detail | 21.6 | 27.6 | 34.0  |
| hot | Booking detail | 8.3 | 13.4 | 7.9  |
| hot | Customer 360 | 10.6 | 14.9 | 12.6  |
| hot | Bills raised page | 136.7 | 137.6 | 487.9  |
| hot | Unit grid | 8.3 | 8.9 | 12.3  |
| hot | Catalogues bundle | 9.3 | 9.9 | 36.7  |
| write | Post payment (auto allocation + ledger) | 130.2 | 166.7 |   |
| write | Create booking | 343.3 | 460.4 |   |
| write | Stage complete (33 bookings) | 562.1 | 600.3 |   |

3G Elite writes p95: Post payment 111 · Create booking 259 · Stage complete 526 ms.
