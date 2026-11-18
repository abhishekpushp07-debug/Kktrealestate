# Phase E0 waterfall deltas (volume DB, API-side p95)
| Screen | Phase D after | Phase E0 | Change |
|---|---|---|---|
| Home | 61 ms | 5 ms | cached read model (10 s) |
| Leads board | 190 KB | 122 KB | per-column paging (50/column, Load more) |
| Customer 360 | 3 calls API / 6 browser | 3 / 4 | `/customers/{id}/panels` composite (communications + documents + types) |
| Payments | 76 ms | 51 ms | first-page cache |
| Settings | 8 ms | 8 ms | — |
