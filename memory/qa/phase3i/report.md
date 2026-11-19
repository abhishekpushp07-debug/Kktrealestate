# Phase 3I — Speed everywhere (F-59) · final report (2026-11-20)

Elite shape for every number: scratch copy of `kkt_volume` (1,500 bookings, 19.5k receipts) · 2 worker processes · `taskset` cores 0,1 · nothing else running on the box.
"First" = first open right after a save (every cache stale); "cached" = repeat opens.

## 1 · Result against the brief
| Q | Must | Final measured | Met? |
|---|---|---|---|
| Q-49 · 50 reports first open ≤ 300 ms p95 | 50/50, both modes | **3 consecutive runs, all 50/50**: no Redis 224 / 223 ms max, Redis 229 ms max (payment-behaviour). Every report ≤ 240 ms (headroom target) | **Yes** |
| Q-50 · repeat opens | ≤ 100 | every report ≤ 30 ms p95; Outstanding-v2 legacy 18.7 ms (was 230 — un-cached path, fixed) | Yes |
| Q-51 · hot reads first-after-save ≤ 200 | | Home FY 181 · Home today/project 112 · legacy Home 154 · booking detail 6 · Customer 360 9 · **Home month 221 · Bills raised 248** | **2 left** (see §6) |
| Q-52 · writes no slower than 3G (111 / 259 / 526) | | payment 70 · booking 203 · stage complete 469 (p50; p95 109 / 239 / 536) | Yes |
| Q-54 · 50 users, 0 user-visible errors | 0 | 0 — no Redis 20 min (10,7xx req) · Redis 20 min incl. 60 s Redis stop · 60-min soak (32,075 req) | Yes |
| Q-55 · memory ≤ 1.2 GB / worker, flat 10 → 20 min, 60-min soak | | no Redis 274 → 294 MB (10 → 20) · Redis ≈ 325 / 295 MB flat · soak 60 min ≈ 295 / 270 MB, flat from minute 10 | Yes |
| Q-56 · Redis ≤ 500,000 commands / month at 2 req / staff / min | | 0.67 commands / request → **≈ 315,000 / month** (15 staff × 600 min × 2 × 26 days = 468k requests). Hard cap 19,000 / day (≤ 494k / 26-day month): at the cap Redis is skipped for the rest of the day, figures come from Mongo, System Health shows "daily budget reached" | Yes |
| Q-57 · Redis outage | 0 errors | 0 during a 60 s stop mid-load; silent Mongo fallback | Yes |
| Q-58 · route change ≤ 300 ms, JS ≤ 250 KB gzip | | 10 routes median 15–67 ms · 115.6 KB | Yes |
| Equivalence (preview, medium, volume, past As-of) | 0 unexplained | 411 × 3 DBs: one **declared, intended** difference — Cancellations flat label `Project · Tower · Flat` (3H note); checker: label cells only (`unit`), **money / count columns and totals identical** | Yes |
| Full pytest, ONE sequential run | 0 failed | **961 passed, 5 skipped, 0 failed** (23 min 49 s, final code) | Yes |
| Gates (tie-out, report tie-outs, As-of replay, exports; medium + volume) | | all exit 0 · tie-outs 219/219 + 217/217 PASS · As-of replay 0 problems | Yes |

Redis hit rate under the 50-user mix: **12 %** (was 0.1–0.3 %). Home p95 under load: 642 → 329 ms (Redis), 618 → 420 ms (no Redis).

## 2 · Root causes found and fixed (round 3)
| Cause | Fix |
|---|---|
| Overdue-reminder catch-up (≈ 110 letters / min, ~26 min after every fresh start) wrote reminder / letter / message audits; the read-model subscriber marked a booking for each and moved the shared version → nothing stayed cached (version +20 / 3 s with no user writes) | noise actions (`reminder.*`, `document.generated`, `message.*`, `notification.*`) mark no read model (`services/read_models`) — guard rail in §3 |
| GZip level 9 cost 90 ms per 3 MB response | level 5 app-wide; Bills raised body compressed once per cached answer (level 1) |
| Legacy `cached_report` keyed on the newest audit id → each open's own "viewed" row retired it | shared noise-free stamp (`routers/reports_i._data_stamp`) |
| Background batch jobs took the whole loop | `run_isolated` duty cap 50 % (`KKT_JOB_DUTY`): a pause after each item in proportion to its work |
| Redis SET awaited in the request, `json.dumps` of MB results on the loop | SET in the background; only results < 256 KB (`REDIS_SHARE_MAX_BYTES`) travel; larger families never GET; per-family hit-rate learner (< 5 % after 200 lookups → skip 10 min) |
| Collections: two scans + a row re-read | one scan split by project into parallel aggregates (totals add; options per booking; page merged on the unique (day, receipt) order — 18/18 identical); option stand-ins ordered newest-first so a flat whose label differs between bookings takes the full path's label |
| Payment behaviour / Outstanding waited for Customer status before their own reads | read beside it (superset of booking ids, per-booking figures); covering index `ledger_entries(booking_id, seq, date, cash/account paid-to-date)` |
| Home: ageing ran before every widget; towers / stock / pipeline recomputed on every receipt | ageing beside the widgets (its demand reads in parallel); "Needs attention" reads in parallel; per-domain **bills** stamp (demand / booking / block / construction / stage writes) keeps next milestone, inventory, flat status, construction, pipeline ready across receipts on every server |
| Legacy `/dashboard/home` sequential reads; pending projects refreshed one by one | reads started together; project / block refresh in parallel |

## 3 · Guard rail — noise actions × surfaces (both servers)
`tests/test_phase3i_noise_surfaces.py`, cells in `noise_matrix.md`: write on server A, read on A and on a second backend process B (both caches warm first). Bills raised `reminder_sent_at` 🟢🟢 · booking page "Letters & documents" 🟢🟢 · Customer 360 generated documents 🟢🟢 · notification bell count + list 🟢🟢 · Call list last follow-up (leads domain, rule) 🟢 · Payment behaviour reads no reminder / letter / message field (rule) 🟢.

## 4 · Background jobs at 1,500 bookings (duty cap 0.5, one core) · single run across servers
Table: `job_windows.md`. Overdue-reminder catch-up 1,513 s (final code; 1,577 s earlier run, 1,548 letters) vs 8 h send window — longer than the hourly loop gap, but the loop is sequential so the next run waits; it never overlaps · daily dues 5 s vs 600 s · nightly integrity 4 s vs 600 s · archive 0.1 s · overdue notifications, hold sweep, message send, snapshots < 1 s. Demo refresh acts on the demo company only (no data at 1,500 bookings); it is a leader loop like the others.
Two-server proof found and fixed: (1) the hold-expiry sweep ran in **every** process — now leader-only, and release / 24 h warning act only when their own update changed the flat (no double notification); (2) a lease handover could leave the old leader's jobs running ≤ 20 s after a stall — the holder now fences itself (`leader.check()` at every job start and between job items; past TTL − renew − margin since its last renewal it stops, runs marked STOPPED), and a process taking over another's lease waits renew + margin before starting. Every run records its owner. `tests/test_phase3i_leader_fence.py`: two real processes, TTL 6 s, the first stalls 12 s → the job moves to the second with no overlap. Final code, 2 workers × 6 min on one database: every job run has one owner process, 0 overlapping runs (before the fix: hold sweep and message send showed two owners).

## 5 · Tests
Earlier failures and their root causes: disk full mid-run (ENOSPC, 8 files); 3 static-gate findings (md5, `[:10]` slice, import cycle letter_queue ↔ documents); order dependence (a test asserting another process's "all" mark; motor reused across event loops; Phase Y reading Sales and admin payloads while an xdist worker booked a flat between them — now compared against a Sales payload taken before and after); one invalid run was my own concurrent invocation on the test database (not repeated). Final single sequential run: `pytest_full_3i_final2.log` — **961 passed, 5 skipped, 0 failed** in 1,428.8 s.

## 6 · Open (honest)
- Home month first-after-save 221 ms and Bills raised 248 ms vs 200: both recompute every money widget / the full 2,763-bill register after a receipt. Next step: per-booking money snapshot + per-day receipt summaries kept in Mongo by each save (not built in 3I).
- M-12 engagement score check on both servers, the suite on a single-node replica set, and the 3G race / stale drills in both modes were not run in 3I.
- 10 → 20 min RSS without Redis rose 20 MB (274 → 294); the 60-min soak stays flat after minute 10.
