# Phase 3I: Speed everywhere — every report under 0.3 s, at the owner's live size

Version: phase-3I. Feature: F-59 (see `../overview.md`: Performance & Architecture Standards, owner decisions 2026-11-18 (3) report goal, Redis / Upstash plan, live = Elite, 2 replicas). Locked rules: `/app/memory/HANDOFF.md` §3, §5, §10. "Before" numbers: `/app/memory/qa/perf/baseline_3g_elite.md` (3G) and `/app/memory/qa/phase3h/perf_elite_*.md` (3H). Listed items carried into this phase: 3G report M-01, M-04, M-05, M-06, M-07, M-09, M-10, M-12, M-13 (`/app/memory/qa/db_audit/report.md`).

## Goal
The owner: "use cache and Redis and optimise the whole ERP in the best possible way … perfect, elegant, beautiful, powerful". On the owner's live shape — Elite (2 cores per server), 2 servers, 1,500 bookings — every one of the 50 reports opens in under 0.3 s every time (including the first open right after someone saves), every screen and save stays inside its budget, and it holds for 50 people working at once. Speed never changes a number and never brings back a stale figure: the 3G safety (0 s stale across 2 servers, leases, unique keys) stays exactly as proven.

Design principle (orchestrator, from the owner's "simple, elegant, powerful"): **the app must be fast without Redis.** Speed comes first from keeping report figures ready in the database, updated by each save for only what that save touched; Redis is a shared layer on top that makes repeat opens cheaper across servers. Reason: Redis is not provided live, the owner's Upstash free plan allows 500,000 commands a month (≈ 16,600 a day), and live may run without it until the owner switches it on.

## Functional requirements

### 3I-A Reports under 0.3 s on every open
- REQ-353 [always] Each of the 50 reports shall return its first page in ≤ 300 ms p95 server time on `kkt_volume` (1,500 bookings), backend capped to 2 cores with 2 processes, both on the first open right after a save and on repeat opens.
- REQ-354 [always] The 5 slowest from the 3G baseline (Receivables forecast, Collections, Bank-wise receipts, Booking health, Transfers) shall be done first and reported to the orchestrator before the rest. (interpreted)
- REQ-355 [always] Report figures shall be served from data kept ready in the database (per-booking / per-day / per-scope summaries) that each save updates for only the bookings, days and scopes it touched, inside the same request, so the next read is both fast and current. (interpreted)
- REQ-356 [always] Every filter, group level (Project → Tower → Floor → Flat → Booking), As-of date, "Include cancelled" switch, column choice and sort of the 50 reports shall return exactly the same figures as before this phase, proven by an old-vs-new equivalence run over a fixed matrix of filters on preview, medium and volume.
- REQ-357 [always] As of a past date, a report shall meet the same ≤ 300 ms budget for the 12 month-end dates of the current FY and today. (interpreted)
- REQ-358 [always] Excel and PDF exports of any report on volume shall start downloading within 3 s p95. (estimate, interpreted)
- REQ-359 [unwanted] If kept-ready figures are missing or marked out of date (e.g. after a crash), then the system shall compute that report from source records, return the correct figure, and repair the kept-ready data in the background.
- REQ-360 [always] A nightly check shall compare kept-ready figures with a recompute from source records and show "Report figures: in step" or the count of differences on System Health. (interpreted)

### 3I-B Saves and screens inside budget
- REQ-361 [always] Post payment, create booking and stage complete (tower with ≤ 60 bookings) shall each stay ≤ 600 ms p95 on the Elite shape.
- REQ-362 [always] Post payment, create booking and stage complete shall be no slower than the 3G Elite baseline (111 / 259 / 526 ms p95) and aim for the pre-3G figures (58 / 230 / 468 ms) + 10 %. (interpreted)
- REQ-363 [always] The 3G safety steps (booking / tower lease, read-model marks, data stamp) shall be kept; their cost shall be reduced by taking each at most once per request. (interpreted)
- REQ-364 [always] Every hot read in the overview budget table (Home bundle, project list / detail, booking detail, Customer 360, Bills raised page, unit grid, catalogues) shall be ≤ 200 ms p95 on the Elite shape, including the first read right after a save.
- REQ-365 [always] Every other save flow (cheque clear, bounce, reversal, waiver request / approve / reject, cancel, refund payout, transfer, agreement revision, plan change, hold / release, manual bill, customer edit) shall be measured once on volume and stay ≤ 600 ms p95. (interpreted)
- REQ-366 [always] Route change inside the app shall show content within 300 ms, with skeletons instead of blank screens, and initial JS shall stay ≤ 250 KB gzip with every route lazy-loaded.

### 3I-C Redis — shared, optional, safe
- REQ-367 [optional] Where `REDIS_URL` is set, the system shall share cached report and screen results across all servers, keyed by company, report, filters and the data stamp.
- REQ-368 [state] While `REDIS_URL` is not set, the system shall work with the same figures and within the same budgets, using the database-kept figures and the per-process caches made safe in 3G.
- REQ-369 [unwanted] If Redis is unreachable, slow (> 50 ms) or full, then the system shall carry on from the database with no error shown to the user, log it once per minute, and show "Fast cache: unavailable — running without it" on System Health.
- REQ-370 [always] The system shall accept a TLS Redis address (`rediss://`, as Upstash gives) and keep its Redis command use within the Upstash free plan (≤ 500,000 commands a month) at the measured daily use of the 50-user load test scaled to the owner's working day. (interpreted)
- REQ-371 [always] System Health shall show the fast cache's state (on / off / unavailable), hit rate, commands used today and this month vs the plan limit, and a measured "with cache vs without" time for 5 reports.
- REQ-372 [always] Nothing that money correctness depends on (leases, idempotency, unique keys, read-model marks) shall depend on Redis being present.
- REQ-373 [always] Cross-server freshness shall stay at 0 s for every money surface after a save, with and without Redis (3G Q-41 re-run).

### 3I-D Database and server fit for scale
- REQ-374 [always] The collection scans found in 3G (M-04: job_runs latest per job, doc_verifications by code, generated_documents by booking) shall be served by indexes.
- REQ-375 [always] The 35–39 business keys not yet enforced (M-01) shall get unique indexes through the 3G safe path (skip + log + System Health if duplicates exist).
- REQ-376 [always] The 8 prefix-duplicate and unused indexes (M-05) shall be listed with their measured use; none shall be dropped in this phase without 7 days of live use data. (interpreted)
- REQ-377 [always] Every report and hot-read query shall examine ≤ 10 documents per document returned on volume, or be read from kept-ready data.
- REQ-378 [always] The database pool shall default to a live-safe size (M-10: `MONGO_MAX_POOL` 40, `MONGO_MIN_POOL` 2) so 4 servers × 2 workers stay under 500 connections.
- REQ-379 [always] The full test suite shall also pass once on a single-node replica set (transactions available), so the live transaction mode is proven (M-07).
- REQ-380 [always] Letters and snapshots queued after a save shall survive a server stop (M-09: outbox reconcile covers auto letters).
- REQ-381 [always] Login records and notifications shall get the same monthly move-to-archive as the activity log, moving rows and never deleting them (M-06, owner: keep everything forever).
- REQ-382 [always] The Customer 360 engagement score shall show the same value on both servers right after a stage complete (M-12).

### 3I-E 50 people at once
- REQ-383 [always] A 50-user load test (realistic mix of Home, reports, booking pages, Customer 360, payments, bookings, stage complete, cheque clear, waivers; think time 3–10 s; 20 minutes) on the Elite shape with 2 servers shall finish with 0 server errors and every route within its budget at p95. (interpreted)
- REQ-384 [always] After the load test, tie-outs, integrity, the connection matrix and the db audit shall be 100 % clean on the load-tested copy (no money error under load).
- REQ-385 [always] The load test shall run twice: without Redis and with a local Redis, and report both.

## Quality requirements
```
Q-49  Tag: Perf.ReportsFirstOpen
      Scale: reports (of 50) whose first-open-after-a-save p95 server time > 300 ms
      Meter: tools/perf_reports_v3.py, kkt_volume, 2 processes, taskset 2 cores, 10 cold + 30 warm samples, without and with REDIS_URL
      Must: 0 (both modes)
      Plan: 0, and median ≤ 150 ms
Q-50  Tag: Perf.ReportsRepeat
      Scale: reports whose repeat-open p95 > 300 ms
      Meter: same run, 30 repeats spread over both processes
      Must: 0
      Plan: 0, and p95 ≤ 50 ms
Q-51  Tag: Money.SameFigures
      Scale: report outputs (50 reports × filter matrix × 3 DBs) that differ from before 3I
      Meter: old-vs-new equivalence run + tieout + As-of replay
      Must: 0
      Plan: 0
Q-52  Tag: Perf.Writes
      Scale: p95 ms of post payment / create booking / stage complete (33 bookings) on the Elite shape
      Meter: tools/perf_budget.py, 30 runs, kkt_volume
      Must: ≤ 600 and ≤ 111 / 259 / 526
      Plan: ≤ 64 / 253 / 515 (pre-3G + 10 %)
Q-53  Tag: Perf.HotReads
      Scale: hot reads with p95 > 200 ms (warm and first-after-save)
      Meter: tools/perf_budget.py, Elite shape
      Must: 0
      Plan: 0
Q-54  Tag: Replicas.Staleness
      Scale: seconds a second server shows an old money figure after a save
      Meter: 3G 2-process drill, 11 surfaces × 3 actions × 10 reps, with and without Redis
      Must: 0
      Plan: 0
Q-55  Tag: Load.Errors
      Scale: 5xx responses and money mismatches in the 50-user load test
      Meter: locust 50 users, 20 min, both modes; tieout after
      Must: 0
      Plan: 0
Q-56  Tag: Redis.Budget
      Scale: projected Redis commands per month at the owner's real usage (load-test commands/user/hour × 15 staff × 10 h × 26 days) (estimate)
      Meter: Redis INFO commandstats during the load test
      Must: ≤ 500,000
      Plan: ≤ 250,000
Q-57  Tag: Redis.Outage
      Scale: user-visible errors when Redis stops mid-load
      Meter: stop the local Redis during the load test for 60 s
      Must: 0
      Plan: 0
Q-58  Tag: UX.RouteChange
      Scale: ms from click to content on a route change (warm)
      Meter: Playwright, 10 main routes, preview
      Must: ≤ 300
      Plan: ≤ 150
```

## Non-goals
Company scoping (Phase 4) · dropping indexes on live without 7 days of use data · any money rule, allocation order, numbering, GST or wording change · deleting any history · switching Redis on live (owner creates Upstash before going live; switched on only after System Health shows it is faster from the live servers).
