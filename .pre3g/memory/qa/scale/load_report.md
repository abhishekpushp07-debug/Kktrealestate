# Load report — kkt_scale (6.6 M rows) — 2026-10-27

**Sandbox limit (stated up front):** one uvicorn worker on a shared container that also runs the preview stack, MongoDB and the test harness. Numbers below are **measured** on that box; anything about production capacity is an **estimate** = per-worker measurement × workers, and must be re-measured on the target tier.

Fixture: `tools/scale_seed.py` → 25 projects, 300 towers, 60,000 flats, 40,000 customers, 30,000 bookings, 990,000 payments, 600,000 demands, 1.59 M ledger rows, 3.0 M audit rows, 100,000 leads, 50,000 tickets, 200,000 documents · build 289 s (budget 30 min) · 1,007 MB storage · integrity sample 200 bookings, 0 mismatches (`memory/qa/scale/seed_report.json`).

## Index audit
`tools/explain_audit.py` — 100 query shapes (every allowed list sort × direction, by-project lists, searches, Customer 360, booking ledger/payments/demands, audit by entity, cheques pending, overdue demands, flat grid, 9 report/dashboard aggregations): **84 flagged before → 0 after** adding compound keyset indexes (company_id, sort_key, id) and read-path indexes (now in `db.ensure_indexes`). Slowest warm shapes: dashboard "collected this month" 1.56 s (1 M payments, indexed match + group), collections by month 457 ms, outstanding by project 87 ms. Full table: `explain_report.md`.

## Realistic mix (weights): home 20 · bookings list 20 · payments list 15 · search 15 · customer 360 10 · booking ledger 10 · outstanding report 5 · customer create 5
Run: `python tools/loadtest.py --base http://127.0.0.1:8002 --mix 100,300,600 --seconds 15` (API_MAX_INFLIGHT=200)

| users | req | rps | p50 ms | p95 ms | p99 ms | 5xx (non-shed) | shed 503 | RSS MB |
|---|---|---|---|---|---|---|---|---|
| 100 | 392 | 13.4 | 3,770 | 16,083 | 22,221 | **0** | 226 | 568→607 |
| 300 | 410 | 9.8 | 18,742 | 28,037 | 33,988 | **0** | 228 | 773→1,100 |
| 600 | 719 | 11.9 | 44,365 | 59,082 | 60,416 | **0** | 392 | 1,138→1,871 |

Server-side (Server-Timing `db`) p95 at 100 users after fixes: home 163 ms · booking ledger 200 ms · search ~700 ms · bookings list ~650 ms · customer 360 ~560 ms · payments list (cold totals) 8.6 s → cached 5 min · customer create 4.7 s (audit write amplification).

### Verdict against targets
- 0 × 5xx excluding deliberate shedding: **met** at 100/300/600 (after pool 100 + WaitQueueTimeout → 503 DB_TIMEOUT retryable).
- p95 ≤ 300 ms at 100 users: **not met on the sandbox** (client p95 16 s; most of it is queueing on one Python worker — db p95 for the dominant paths is 160–700 ms).
- Worker RSS ≤ 350 MB: **not met** (568 MB idle on kkt_scale → 1.87 GB at 600 users; large report/list result objects + 20k ring buffer). Needs: smaller projections on list endpoints, streaming report rows, and a per-worker memory cap/restart (`--limit-max-requests`).

## Top-5 hot paths fixed in this phase
1. `GET /payments` status totals: O(all payments) group per request → cached 30 s (filtered) / 5 min (whole scope), `maxTimeMS` (routers/payments.py `_payment_totals`).
2. `GET /reports/outstanding`: full ageing pass per request → cached 60 s per scope (routers/reports.py).
3. `GET /dashboard/home`: 100 concurrent misses recomputed 100× → ttlcache single-flight (services/ttlcache.py).
4. Pool exhaustion (`WaitQueueTimeoutError` → 500) → pool 100, mapped to 503 DB_TIMEOUT + Retry-After, surfaced in System Health `pool`.
5. List sorts without (company, sort_key, id) keyset indexes → 36 compound indexes + 15 read-path indexes (explain 0 flagged).

## Capacity → tier recommendation (ESTIMATE)
Measured per sandbox worker: ~13 rps of the mixed profile at 1 M payments with p95 dominated by CPU queueing. A dedicated vCPU worker without co-tenants should do 3–5× that (estimate, not measured). 2,000 concurrent staff at a typical ERP think-time (1 request / 10 s) ≈ 200 rps sustained → **~6–8 workers (2 vCPU each) + Redis (shared cache/limiter/idempotency) + a dedicated MongoDB (Atlas M30-class, 8 GB RAM to keep the 1 GB working set + indexes hot)**. Re-run `tools/loadtest.py --mix 100,300,600` on that tier before go-live; success criteria are the targets above.
