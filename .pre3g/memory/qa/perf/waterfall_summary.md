# Phase D2 waterfall — before vs after (volume DB kkt_volume, API-side, 7 runs each)

| Screen | req before | req after | bytes before | bytes after | Σp95 before | Σp95 after |
|---|---|---|---|---|---|---|
| Home | 1 | 1 | 27.9 KB | 27.7 KB | 67 | 61 |
| Projects list | 1 | 1 | 13.9 KB | 14.2 KB | 6 | 5 |
| Project workspace | 3 | 3 | 73.1 KB | 73.1 KB | 28 | 25 |
| Inventory grid | 2 | 2 | 53.7 KB | 53.7 KB | 16 | 14 |
| Customers list | 1 | 1 | 55.9 KB | 55.9 KB | 15 | 13 |
| Customers search | 1 | 1 | 56.1 KB | 56.1 KB | 64 | 15 |
| Customer 360 | 3 | 3 | 10.4 KB | 10.4 KB | 36 | 29 |
| Bookings list | 1 | 1 | 130.5 KB | 130.5 KB | 26 | 17 |
| Booking detail (3 ledgers) | 4 | 4 | 60.0 KB | 60.0 KB | 28 | 24 |
| Payments | 2 | 2 | 71.1 KB | 71.1 KB | 197 | 76 |
| Leads board | 2 | 2 | 281.4 KB | 189.9 KB | 47 | 27 |
| Site visits | 1 | 1 | 42.5 KB | 42.5 KB | 9 | 8 |
| Service | 1 | 1 | 65.0 KB | 65.0 KB | 15 | 13 |
| Reports | 2 | 2 | 1.3 KB | 1.3 KB | 7 | 7 |
| Catalogues | 1 | 1 | 66.1 KB | 66.1 KB | 12 | 11 |
| Users | 2 | 2 | 6.9 KB | 7.1 KB | 11 | 10 |
| Settings | 2 | 2 | 1.3 KB | 1.3 KB | 3442 | 8 |
| Global search | 1 | 1 | 0.0 KB | 0.0 KB | 28 | 10 |

Notes
- Measured against the volume backend on :8002 (6 projects / 59 towers / 3,678 flats / 2,000 customers / 1,500 bookings / 20,596 payments).
- Changes: payments count+page+totals now run concurrently (asyncio.gather) with a covered index for totals; `paginate()` runs count and page concurrently for every list screen; Leads board is projected to card fields only (281KB → 190KB; still above the 150KB target because the board returns up to 500 open leads — next step is per-column paging); integrity report is served from a cached background result (3.4s → 4ms, `?fresh=1` recomputes); audit-by-entity now index-backed with sort (COLLSCAN+SORT → IXSCAN).
- Frontend: `/api/catalogues` in-flight dedupe, Customer 360 ledgers query-key fix, React Query staleTime 30s, bootstrap cached in IndexedDB + ETag/304 revalidation, lead stage moves optimistic with Undo toast.
- Not met: Leads board payload (190KB vs 150KB target); Customer 360 is 3–5 calls depending on panels; dashboard/home is 60ms single call (read-model backed).
