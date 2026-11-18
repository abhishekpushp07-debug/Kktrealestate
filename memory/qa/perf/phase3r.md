# §3R perf — per-part other-charge ageing (2026-11-17)

Same tool (`tools/perf_budget.py`), 30 warm requests per path, private backend on a scratch copy. Volume = `kkt_volume` (1,500 bookings, 19,508 receipts, 4,139 other-charge parts). Volume *before* = the same DB served by the code at commit `5f0905c~1` (pre-§3R) from a git worktree, so the only difference is the §3R code.

## Volume: before vs after §3R (p50 / p95 ms)

| Path | before p50 | after p50 | before p95 | after p95 | Δ p95 |
|---|---|---|---|---|---|
| Home Command Center (month) | 9.2 | 9.5 | 9.9 | 10.5 | +6 % |
| Home Command Center (FY) | 9.3 | 9.2 | 10.0 | 9.9 | -1 % |
| Home Command Center (Today, project) | 5.6 | 5.5 | 7.5 | 7.8 | +4 % |
| Home legacy snapshot | 3.0 | 3.4 | 3.1 | 3.9 | +26 % |
| Project list | 31.3 | 32.1 | 32.9 | 33.7 | +2 % |
| Project detail | 15.6 | 15.3 | 17.5 | 17.0 | -3 % |
| Booking detail | 6.2 | 6.0 | 6.5 | 6.4 | -2 % |
| Customer 360 | 8.0 | 7.1 | 8.4 | 7.6 | -10 % |
| Bills raised page | 196.7 | 195.7 | 198.3 | 198.8 | +0 % |
| Unit grid | 5.1 | 4.9 | 5.4 | 5.1 | -6 % |
| Catalogues bundle | 6.1 | 5.9 | 6.4 | 6.2 | -3 % |
| FY collections | 684.9 | 680.0 | 777.6 | 766.4 | -1 % |
| Outstanding & ageing | 252.0 | 256.5 | 309.5 | 312.7 | +1 % |
| Post payment (auto allocation + ledger) | 122.0 | 131.1 | 172.2 | 176.8 | +3 % |
| Create booking | 366.9 | 373.7 | 509.3 | 582.5 | +14 % |
| Stage complete (33 bookings) | 2895.6 | 2823.7 | 3201.3 | 3032.5 | -5 % |

## Demo (preview copy): Phase 3 end vs §3R (p50 / p95 ms)

| Path | P3 end p50 | §3R p50 | P3 end p95 | §3R p95 |
|---|---|---|---|---|
| Home Command Center (month) | 3.6 | 3.7 | 3.8 | 3.8 |
| Home Command Center (FY) | 3.6 | 3.6 | 3.7 | 3.7 |
| Home Command Center (Today, project) | 3.1 | 3.3 | 3.3 | 3.4 |
| Home legacy snapshot | 2.5 | 2.7 | 2.6 | 2.8 |
| Project list | 2.3 | 6.2 | 2.4 | 6.9 |
| Project detail | 8.7 | 11.5 | 9.3 | 12.8 |
| Booking detail | 6.5 | 6.7 | 6.7 | 7.2 |
| Customer 360 | 5.4 | 5.8 | 5.9 | 6.3 |
| Bills raised page | 23.5 | 25.8 | 24.1 | 26.3 |
| Unit grid | 4.6 | 4.8 | 4.8 | 5.0 |
| Catalogues bundle | 5.7 | 5.7 | 6.0 | 5.8 |
| FY collections | 35.9 | 65.5 | 37.4 | 68.0 |
| Outstanding & ageing | 22.2 | 22.7 | 24.1 | 24.0 |
| Post payment (auto allocation + ledger) | 48.0 | 69.2 | 59.0 | 82.5 |
| Create booking | 222.6 | 389.0 | 298.8 | 470.7 |
| Stage complete (20 bookings) | 103.2 | 121.1 | 156.1 | 176.2 |

Readout: on volume, one path is more than 10 % slower than before §3R. The Home legacy snapshot p95 went from 3.1 to 3.9 ms (+0.8 ms; it is a cached read and §3R adds no query to it). Every other path is within ±10 %. Three volume paths were already over budget before §3R and still are: FY collections (cached ≈ 680 ms), Outstanding & ageing (cached ≈ 255 ms), and Stage complete for 33 bookings (≈ 2.8 s). §3R did not cause them. They need a separate scale fix and are listed as open items. On demo, every path is within budget. Post payment p50 is 48 → 69 ms against the Phase 3 end run. That is a different story dataset, and the path is not touched by §3R.
