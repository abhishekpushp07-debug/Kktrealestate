# After 3I — Elite shape (kkt_volume 1,500 bookings · 2 processes · cores 0,1)

Same tool and set-up as `baseline_3g_elite.md` (`tools/perf_reports_v3.py --cold 10 --warm 30`). First = first open right after a write (every cache stale). Server time = `Server-Timing: total`.
Three consecutive runs on the final code (2026-11-20): no Redis ×2, local Redis ×1.

**50/50 reports ≤ 300 ms p95 on the first open in all three runs** (3G: 17/50); slowest 229 / 223 / 229 ms — every report ≤ 240 ms. Repeat opens ≤ 29 ms p95.

| Report | 3G first p95 | 3I first p95 run 1 | run 2 | run 3 (Redis) | 3G repeat p95 | 3I repeat p95 | ≤ 300 |
|---|---|---|---|---|---|---|---|
| customer-status | – | 229 | 211 | 197 | – | 29 | yes |
| customer-statement | – | 24 | 25 | 21 | – | 8 | yes |
| customer-ageing | – | 177 | 180 | 163 | – | 14 | yes |
| advance-holders | – | 176 | 169 | 158 | – | 12 | yes |
| call-list | – | 184 | 182 | 181 | – | 12 | yes |
| kyc-pending | – | 189 | 184 | 188 | – | 12 | yes |
| payment-behaviour | – | 224 | 223 | 229 | – | 7 | yes |
| customer-directory | – | 177 | 176 | 177 | – | 8 | yes |
| cancelled-customers | – | 21 | 20 | 22 | – | 3 | yes |
| collections | – | 124 | 120 | 112 | – | 12 | yes |
| day-book | – | 83 | 87 | 85 | – | 4 | yes |
| bank-receipts | – | 136 | 124 | 150 | – | 4 | yes |
| cheques | – | 139 | 133 | 133 | – | 14 | yes |
| bills-vs-collection | – | 158 | 152 | 155 | – | 4 | yes |
| outstanding | – | 189 | 181 | 181 | – | 13 | yes |
| cash-vs-account | – | 114 | 116 | 125 | – | 14 | yes |
| other-charges | – | 132 | 136 | 150 | – | 14 | yes |
| receivables-forecast | – | 208 | 203 | 215 | – | 12 | yes |
| waivers | – | 41 | 43 | 44 | – | 4 | yes |
| booking-register | – | 193 | 192 | 196 | – | 13 | yes |
| sales-summary | – | 176 | 179 | 178 | – | 3 | yes |
| discount-register | – | 47 | 48 | 56 | – | 4 | yes |
| plan-position | – | 192 | 190 | 189 | – | 13 | yes |
| agreements | – | 192 | 189 | 190 | – | 12 | yes |
| cancellations | – | 43 | 42 | 42 | – | 3 | yes |
| transfers | – | 186 | 185 | 184 | – | 3 | yes |
| sales-team | – | 203 | 203 | 202 | – | 3 | yes |
| realised-rate | – | 190 | 193 | 193 | – | 13 | yes |
| booking-health | – | 193 | 194 | 198 | – | 13 | yes |
| project-statement | – | 63 | 61 | 61 | – | 5 | yes |
| inventory-status | – | 165 | 162 | 156 | – | 15 | yes |
| stacking-plan | – | 165 | 160 | 150 | – | 14 | yes |
| price-list | – | 145 | 141 | 136 | – | 6 | yes |
| hold-register | – | 139 | 136 | 131 | – | 3 | yes |
| landowner | – | 137 | 136 | 130 | – | 3 | yes |
| parking | – | 19 | 19 | 19 | – | 3 | yes |
| construction-vs-plan | – | 133 | 133 | 134 | – | 4 | yes |
| stage-bills | – | 151 | 152 | 154 | – | 4 | yes |
| sales-velocity | – | 147 | 146 | 143 | – | 3 | yes |
| lead-funnel | – | 108 | 110 | 110 | – | 3 | yes |
| lead-register | – | 63 | 67 | 62 | – | 3 | yes |
| source-performance | – | 109 | 110 | 107 | – | 3 | yes |
| follow-ups | – | 56 | 58 | 57 | – | 3 | yes |
| visit-register | – | 58 | 57 | 55 | – | 3 | yes |
| visit-conversion | – | 49 | 48 | 46 | – | 3 | yes |
| lost-leads | – | 58 | 58 | 58 | – | 3 | yes |
| response-time | – | 58 | 57 | 59 | – | 3 | yes |
| team-pipeline | – | 110 | 105 | 106 | – | 3 | yes |
| lead-ageing | – | 61 | 57 | 57 | – | 3 | yes |
| service-sla | – | 44 | 44 | 43 | – | 3 | yes |
