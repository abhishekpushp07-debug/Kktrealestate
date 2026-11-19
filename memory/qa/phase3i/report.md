# Phase 3I — Speed everywhere (F-59) · status report

Elite shape throughout: `kkt_volume` scratch copy (1,500 bookings, 18k receipts) · 2 processes · `taskset` cores 0,1.
After-table: `memory/qa/perf/after_3i_elite.md` (next to `baseline_3g_elite.md`).

## 1 · What changed (one rule each)
| Change | Where | Effect |
|---|---|---|
| GC: startup objects `gc.freeze()`d, thresholds 20000/20/20, periodic collect every 120 s (was a gen-2 pass every 20 s) | `server.py` | the 20 s full pass stalled the loop → first-open p95 was ≈ 2× p50 |
| Every process opens each report once at startup (per company, as its Super Admin) | `server._warm_reports` | no cold code paths / empty row memo on the first real open |
| Report provider calls hand the result object over in-process (no JSON encode + hash + parse, no money twins) | `routers/reports.handoff`, `reports_v3/legacy.call` | −100…300 ms on big legacy-backed reports |
| Per-booking report rows recomputed only when that booking's own inputs changed (fingerprint of exactly what the row reads; read fresh every time, so correct on every server) | `reports_v3/customers._booking_rows` | booking-grain reports |
| Receivables forecast: one query for every booking's raised instalments (was one per booking) | `routers/reports_i.receivables_forecast` | 1,785 → 260 ms |
| Collections / Cheques: receipt mode / bank carried on the row (no second read of 10k receipts) | `reports_i`, `reports.cheques`, `reports_v3/finance` | |
| Received = cleared queries: two index-led pipelines (receipt day / clearing time) + indexes `received_mode_day`, `received_instrument` (the planner chose a full scan for the combined `$or`) | `services/definitions.receipt_split`, `services/trends`, `db.py` | Home "received today" 485 → 3 ms |
| Bounced-not-replaced: one read of the candidate replacements (was one query per bounced receipt) | `services/home_filters` | |
| Read-model marks + version bump in one `bulk_write` (was 4 round trips per change); trend months in one `bulk_write` (was 24); trend refresh only for companies that own the touched scope (was every company) | `read_model_state`, `trends`, `read_models` | write path 73 → 49 Mongo commands |
| Process cache: entries keyed by an older data stamp are freed the moment the stamp moves | `services/ttlcache` | |
| Redis = shared layer: process memory first, one GET on a miss, one SET per compute, no deletes (keys carry the stamp), 50 ms bound, outage → 30 s park + Mongo/memory, logged once a minute, command counter (today / month vs 500,000) on System Health | `services/cache`, `ttlcache`, `routers/ops`, `SystemHealth.jsx` (`ops-fast-cache`) | |
| M-04: indexes `job_runs(job, started_at)`, `doc_verifications(code)`, `generated_documents(booking_id, type)` · M-10: pool 40 / 2 · M-05: list only (`index_usage_preview.md`, 12 prefix duplicates, nothing dropped) | `db.py`, `tools/index_usage.py` | |

## 2 · Q-49 … Q-58 measured (Elite, no Redis unless stated)
| Q | Must / Plan | Measured | Met? |
|---|---|---|---|
| Q-49 reports first open ≤ 300 ms p95 | 50/50 | **45/50** (3G 17/50). Over: Collections 945, Outstanding 308, Customer status 314, Payment behaviour ≈ 320, Sales summary 312 (p50 168) | **No** |
| Q-50 repeat opens | ≤ 100 | every report ≤ 30 ms p95 | Yes |
| Q-51 hot reads incl. first-after-save ≤ 200 | ≤ 200 | warm ≤ 16 ms; first after save: Home month 452, FY ≈ 600, Bills raised 488 (before the received-index fix; Home in-process 771 → 380 after it) | **No** |
| Q-52 writes vs 3G (111 / 259 / 526) | no slower | Post payment 167, Create booking 460, Stage complete 600 | **No** (better than 3H 224 / 555 / 654) |
| Q-53 both modes | report both | Load test both modes (§4); Redis-mode report table not re-run | partly |
| Q-54 50-user load, 0 user errors | 0 | **0 user-visible errors** in both 20-min runs (no Redis; Redis incl. the 60 s stop) and in the 9-min command run | Yes |
| Q-55 memory flat, ≤ 4 GB with 2 workers | flat | **not flat**: biggest worker 284 → 1,758 → 2,487 MB (no Redis) / 299 → 1,850 → 2,668 MB (Redis); total ≤ 3.5 GB. Same 6 min load on the 3H code: 3.35 GB total vs 1.63 GB on 3I. GC settings A/B (old vs new): same total → GC change is not the cause. Python-traced memory ≈ 100 MB → allocator fragmentation; arena cap and `PYTHONMALLOC=malloc` tried, no gain | **No** (half of 3H's growth, still rising) |
| Q-56 Redis commands / month (15 staff × 10 h × 26 d) | ≤ 500,000 | ≈ 295,000 at 1 request / staff / minute (1.26 commands / request measured) | Yes at that rate (§4) |
| Q-57 Redis outage | 0 user-visible errors | 0 during the 60 s stop; requests carried on from Mongo / memory | Yes |
| Q-58 route change ≤ 300 ms warm, initial JS ≤ 250 KB | | initial JS **112.7 KB** gzip; lazy app shell; route-change timing **not measured** | partly |

## 3 · Same figures
`tools/equiv_3i.py`: 50 reports × filter matrix (defaults, As of 3 past dates on every As-of report, 2 periods, Include cancelled, 2 projects, up to 5 group levels) = 411 requests per DB, old code (git worktree at the 3H commit) vs new:
**0 differences on kkt_medium, kkt_volume and preview** (`equiv_*.log`). Rows that tie on the sort key are compared as a set; `hours_left` (moves with the clock) is ignored.

## 4 · Load test (`tools/loadtest_3i.py`, `load_noredis.md`, `load_redis.md`)
50 users × 20 min, think 3–8 s, mix: Home 20 %, report 25 %, bookings list 15 %, booking 15 %, ledger 10 %, search 10 %, payment post 5 %.
| | no Redis p50 / p95 | Redis p50 / p95 | 3H code (6 min) p95 |
|---|---|---|---|
| Home | 14 / 519 | 15 / 578 | 1,444 |
| Report | 67 / 329 | 87 / 398 | 741 |
| Payment post | 87 / 213 | 87 / 246 | 497 |
| Bookings list | 26 / 86 | 27 / 114 | 198 |

Redis command projection (`load_redis_commands.md`, after making Redis frugal — only results that took > 100 ms to compute are shared; 1 GET per local miss, 1 SET per such compute, no deletes):
measured **≈ 1.26 commands per request** (6,058 for 4,809 requests; 2.7 before the frugal rule). Hit rate only 2–6 % in this test because every payment post (5 % of requests, one every ~2 s) moves the data stamp.
15 staff × 10 h × 26 days at **1 request / staff / minute ≈ 234,000 requests → ≈ 295,000 commands / month (Must ≤ 500,000: met)**; at 2 requests / minute ≈ 590,000 (not met). The load-test mix (≈ 11 requests / user / minute) is far above real office use.
Gates after the code was final: tie-out 0 FAIL (preview / medium / volume), report tie-out 219 / 219 / 217 PASS, As-of replay 0 mismatches ×3, exports 50 × 2 formats 0 problems ×3 (`tieout_*`, `asof_replay_*`, `exports_*`). Full pytest sequential **952 passed, 0 failed** (`pytest_full_3i.log`, includes connection matrix, integrity, chronology and db-audit suites). ESLint 0, `CI=true yarn build` OK. The load tests ran on throw-away scratch copies (deleted after).

## 5 · Not done in 3I (honest)
- Report figures kept ready in MongoDB (per-booking money snapshot + per-day receipt summaries updated by each save) — not built. The speed came from removing waste (GC stalls, double reads, N+1 queries, a full-scan plan, JSON round trips) plus an in-process per-booking row memo. Collections (reads 18k receipts each first open) and the Home first-after-save need that design.
- Writes: trend refresh still recomputes 24 months over all receipts per scope (≈ 200 ms company scope) — incremental by month not built.
- REQ-359/360 nightly "Report figures: in step" check + self-repair, M-01 unique keys, M-09 letters outbox, monthly move-to-archive for login records / notifications, M-12 engagement score, suite on a single-node replica set, 3G race + 2-process stale drills in both modes — not run / not built.
- Memory growth under load (§2 Q-55).
