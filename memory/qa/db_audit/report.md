# Phase 3G — Database integrity audit, architecture & scale review

Run 2026-11-18 (IST) on preview `test_database`, `kkt_medium`, `kkt_volume` (1,500 bookings). Tool: `backend/tools/db_audit.py`
(read-only, allow-listed commands, dbHash fingerprint before/after). Drills: `tools/db_audit_drills.py` (races, 2-process
stale window, 2-process startup) and `tools/db_audit_crash.py` (stop after each write, retry) on the throw-away copy
`kkt_audit_scratch` only. Raw output: `memory/qa/db_audit/<db>.json`, `drill_*.json`.

---

## Owner summary (plain English)

**What we checked.** Every record type in the system (102 of them), every number that must never repeat, every link from
one record to another, and every money figure that is stored, recalculated from the original receipts and bills. We also
played out what happens when two people press the same button at the same moment, when the server stops half-way
through saving, and when the live site runs on two servers at once (as it does on your plan).

**What is proven safe today.**
- No money figure in any of the three copies disagrees with the receipts and bills it comes from (thousands of receipts,
  bills, ledger lines and summaries recalculated; 0 differences).
- No receipt, booking, bill, waiver, credit note or refund number is used twice. No flat has two live bookings.
- A double-click on "Post receipt" saves exactly one receipt, every time (20 out of 20).
- Two people booking the same flat at once: one booking, the other person is told "this flat was just taken" (20 of 20).
- The audit itself changed nothing (proved by a fingerprint of every collection before and after).

**What was wrong and is now fixed.**
1. With two servers, two receipts saved at the same moment on one booking could print the statement lines twice and let
   a booking collect more than agreed. Now one server waits for the other.
2. A receipt saved while someone cancelled the same booking could be left out of the cancellation and refund figure.
   Now the two can never overlap.
3. The same waiver approved twice at the same moment was approved twice (two approvals logged, one credit-note number
   wasted), and "approve" and "reject" at the same moment could end as "rejected" with the credit already given. Now the
   second person sees "Already approved" and nothing else is written.
4. The second server could show old totals for up to 25 seconds after a payment on the first (Bills raised), Home tower
   progress could stay old for over 40 seconds. Now the second server shows the new figure on its very next screen, with
   or without the optional fast cache.
5. If the server stopped half-way through a cancellation, a refund payout in two parts, a receipt, or the "update totals"
   step, the half-saved state stayed. Now the retry (or the next start) finishes the job exactly once.
6. The database itself now refuses a repeated waiver number, credit-note number, refund number or statement line. If an
   old copy ever already contains a repeat, the system still starts and System Health says
   "Uniqueness rule not applied — duplicates found".

**Listed for later (nothing urgent, nothing touches money today).** Speed items for Phase 3I (a few lists read every row,
some duplicate search helpers, activity history grows to ~150 million rows over 5 years at 10,000 bookings — it is kept
forever as you asked, and older months already move to an archive), multi-company labels for Phase 4, and tidy-ups of
test data left from earlier phases. No history was deleted and no expiry was added.

---

## 1. Findings table

Severity per REQ-301. Status after 3G. "Test" = `backend/tests/test_phase3g_integrity.py::<name>` (fails on the
pre-3G code — verified against a worktree of commit `3G: … (pre-fix)`, see §9 — and passes now).

| id | sev | finding (one line) | fix | status / test |
|---|---|---|---|---|
| G-01 | High | waiver no., credit-note no., refund no., ledger (booking, seq) not unique in the DB — drill R9/R10 inserted duplicates | unique indexes via `services/invariants.BUSINESS_KEYS`; skip + log + System Health on existing duplicates | fixed · `test_db_refuses_repeated_money_keys`, `test_uniqueness_rule_skipped_and_reported_when_duplicates_exist`, `test_system_health_lists_uniqueness_rules` |
| G-02 | High | ledger rebuild = delete + insert, serialised only in-process → 2 replicas interleave → duplicate ledger lines (R8 2/20: 36 rows/18 distinct; R2 1/20: 38/19) | `services/booking_lock.py` Mongo lease per booking around `ledger.rebuild` (re-entrant per task) | fixed · `test_ledger_rebuilds_from_two_processes_never_repeat_a_sequence` |
| G-03 | High | auto (split) receipt cap checked by a read then an unguarded `$inc` → bucket paid above agreed (R2 2/20) | guarded `$inc` in `_reserve_split` + booking lease around `POST /payments` | fixed · `test_split_receipt_cap_is_enforced_by_the_write`, `test_receipt_waits_for_the_other_process_writing_the_booking` |
| G-04 | High | receipt posted while the booking is cancelled on the other replica → receipt not in the cancellation figure (R7 2/10: received ₹25,81,000 recorded vs ₹30,81,000 cleared) | booking lease around cancel and receipt | fixed · `test_receipt_waits_for_the_other_process_writing_the_booking`; drill R7 after 0/10 |
| G-05 | High | waiver approve twice at once → 2 approvals + burnt CN (R4 13/20); approve vs reject → Rejected after the credit was applied (3/20) or approve answered 200 but final Rejected (11/20) | lease + re-read inside it, `modified_count` checks on approve/reject/cancel → 409 "Already approved" | fixed · `test_waiver_double_approve_and_approve_vs_reject` |
| G-06 | High | Mixed refund payout = 3 writes; a stop after the 2nd left the refund short and the retry was refused (`REFUND_NOT_PENDING`) | split lands in the same atomic "Paid" write (`children_pending`), children deterministic upserts; retry + startup `repair_interrupted_refunds` | fixed · `test_interrupted_mixed_refund_payout_is_completed_once` |
| G-07 | High | read-model "dirty" marks lived only in memory: a stop inside the 2 s debounce left customer/tower summaries stale forever (evidence: `kkt_medium` 23 customer summaries ≠ bookings after its seed backend was killed); replica B never knew a flush was pending | marks persisted in `read_model_marks`; sweep loads them; every replica serves from source while any mark exists; `__v` row in the cache stamp | fixed · `test_read_model_marks_are_shared_and_survive_a_crash`; medium repaired (§7) |
| G-08 | High | per-process caches: replica B stale after a write on A — Bills raised 8–25 s, Home 4.8–5.3 s, Home tower progress > 40 s, Dashboard 7.1 s (Redis mode) | `ttlcache.cached` keys carry `data_stamp()` (newest business audit row + newest ledger row + read-model version); dashboard / widgets / dead-booking caches moved onto it | fixed · `test_cache_is_recomputed_after_a_write_on_another_process`; drill §4: 0 s on 11 surfaces × 3 actions, both modes |
| G-09 | High | cancel stopped after the status write → no refund/forfeit row, retry 409 "already Cancelled" | retry finishes the tail from the recorded cancellation figures | fixed · `test_interrupted_cancel_is_completed_by_retry` |
| G-10 | High | receipt stopped after its insert → retry with the same key = 500 (duplicate key), ledger lines missing (crash drill 2 of 15 points unrepaired) | same-key retry finishes (rebuild + audit) and returns the original receipt | fixed · `test_receipt_retry_after_crash_returns_the_original`; crash drill after 0 of 26 unrepaired |
| M-01 | Medium | 35–39 other keys not DB-enforced (0 duplicates today), e.g. `generated_documents.number` serials, lead number, read models per scope | unique indexes through the same safe path | listed for Phase 3I |
| M-02 | Medium | "one live booking per flat" index covers status Active only; Completed not covered (0 duplicates) | widen partial filter to Active+Completed | listed for Phase 3I |
| M-03 | Medium | stage completed twice at once: both answer 200 (no duplicate bills — the demands unique index holds) | lease on the tower; loser 409 "Stage already completed" | listed for Phase 3I |
| M-04 | Medium | COLLSCAN: job_runs latest per job (5,609 docs, in-memory sort), doc_verifications by code (1,080–1,667), generated_documents by booking (691–1,966 examined / 12 returned) | indexes `(job, started_at)`, `code`, `(booking_id, type)` | listed for Phase 3I |
| M-05 | Medium | 8 prefix-duplicate indexes (list §5); `payments` has 24 indexes, 18 unused since the last mongod restart (weak evidence: restart was today) | drop after a 7-day `$indexStats` window on live | listed for Phase 3I |
| M-06 | Medium | growth (keep forever): audit_logs ≈ 150 M rows / ≈ 370 GB in 5 y at 10,000 bookings; login_events ≈ 100 M | monthly archive already moves rows; add archive for login_events/notifications (move only), compound indexes on archive | listed for Phase 3I |
| M-07 | Medium | transactions: preview standalone (none); live Atlas likely a replica set → `uow` switches to transaction mode, but many writes in money flows do not pass the session; this mode has never been exercised by tests | run the suite on a single-node replica set; until then flows rely on the 3G leases + compensation (crash drills prove recovery without transactions) | listed for Phase 3I (REQ-316: no Critical/High crash finding needed transactions) |
| M-08 | Medium | 4 flats on Hold without expiry on `kkt_volume` (seeded by `seed.py` raw update) | `seed.py` now writes an explicit expiry; the 4 rows are test-profile data, owner rule forbids inventing an expiry | seed fixed in 3G; rows listed for Phase 3H story rebuild |
| M-09 | Medium | after-commit queue (snapshots, auto PDFs) is in-process: a crash loses queued letters | outbox reconcile already re-runs handlers; extend to auto letters | listed for Phase 3I |
| M-10 | Medium | pool: `MONGO_MAX_POOL` 100 × 2 replicas × workers; Atlas shared tiers cap at 500 connections | set `MONGO_MAX_POOL=50` live; keep ≤ 40 % of the cluster limit | listed for Phase 3I (config) |
| M-11 | Medium | customer_merges 4/4 point to customers removed by the test-data purge (preview, medium) | purge to keep merge rows consistent (move, not delete) | listed for Phase 4 |
| P4-01 | Medium | multi-company: `ledger_entries` 0 % company_id (5,916 / 54k rows); also notifications, counters, locks, read_model_marks | add company_id + compound keys | listed for Phase 4 |
| ENV-01 | Medium | preview pod mongod soft `nofile`=1024 → WiredTiger "Too many open files" panic, 3 mongod restarts during this phase | `prlimit` raised to 65536 (conftest already does this for pytest); Atlas not affected | environment, recorded |
| L-01 | Low | notifications for users/customers no longer present: 230 / 17,979 (medium), 2,054 (preview) | none (history kept) | listed |
| L-02 | Low | 22 bills dated before their booking on `kkt_volume` (volume seeder back-dates) | seeder | listed for Phase 3H |
| L-03 | Low | timestamp format mix (see `shape_findings.time_mixed` in each JSON) | normalise at write | listed for Phase 3I |

**Corrections to the first probe / first tool run (evidence in the JSONs):** "refund number duplicate RF-2526-0106" is by
design — a Mixed payout keeps one number across its per-bucket rows (parent Cash 2,81,92,800 + child Account 1,40,96,400 =
refund 4,22,89,200); the real key is (refund_number, bucket) and is now enforced. "generated_documents number duplicates"
are type labels ("Cost sheet", "Reminder"), not serials. "waiver entries ≠ amount" was the GST credit line riding on top
(₹25,000 + ₹1,250 GST). `payments` carries 24 indexes (not 23). `ledger_entries (booking_id, seq)` was not unique —
confirmed, now unique on all three DBs. `waivers` had only `_id` — confirmed, now 2 unique indexes. `job_runs`,
`generated_documents`, `doc_verifications` only `_id` — confirmed (M-04); `customer_merges` too (4 rows, Low).
Standalone MongoDB 7.0.45 — confirmed on all three (no transactions).

**Severity counts.** Before: Critical 0 (3 auto-flags corrected above, 1 = G-07 consequence on medium) · High 10 · Medium 12 · Low 3.
After 3G: Critical 0 · High 0 · Medium 12 · Low 3. Audit re-run (gate): §8.

---

## 2. Inventory, shapes, uniqueness, references, money (per DB)

Full tables are in the JSONs (`inventory`, `shapes`, `uniqueness`, `references.paths`, `money.counts`). Headlines:

| | test_database | kkt_medium | kkt_volume |
|---|---|---|---|
| collections | 102 | 102 | 94 |
| validators | 11 | 11 | 11 |
| bookings / receipts / bills | 82 / 1,548 / 600 | 137 live / 1,749 | 1,500 / 19,508 |
| audit_logs | 421,531 | 421,846 | 58,158 |
| money fields non-int | 0 | 0 | 0 |
| business-key duplicates (REQ-290 list) | 0 | 0 | 0 |
| reference paths checked / with breaks | 40 / 3 (merges, notifications) | 40 / 3 | 40 / 0 |
| money recompute mismatches | 0 | 23 → 0 after repair | 0 |
| state mismatches | 0 | 0 | 4 holds (M-08) |
| run time | 15.7 s | 9.2 s | 6.0 s |

Money recompute covers: receipt = Σ allocations; allocation > 0; bill paid ≤ bill; bill cash + account = total;
paid_parts add up; voided bill without cleared allocations; ledger running balance per line; seq unique + gap-free;
Σ Udhar − Σ Jama = booking balance = outstanding − advance; Cash + Account = agreement; charge line paid ≤ demanded;
waiver entries = amount; approved waiver has a credit note; refund ≤ received; customer / project / tower summaries and
the dashboard snapshot = Σ live booking outstanding.

## 3. Write-flow map (REQ-295) and guards

Order of writes as observed by the crash harness (`drill_crash_after.json` `writes_done`) and code reading.

| flow | writes in order | guard on each (after 3G) |
|---|---|---|
| post receipt | idempotency claim → counters `$inc` (receipt no.) → bookings guarded `$inc` cap → payments insert → demands status → ledger delete+insert → bookings summary → audit (outbox) → read-model mark | claim unique; counter atomic; cap guarded `$inc`; payment unique key + idempotency_key unique; **booking lease**; ledger unique (booking, seq); retry finishes (G-10) |
| cheque clear / bounce / reverse | payments guarded status update → (reverse: bookings `$inc`) → ledger rebuild → audit | status in filter; lease inside rebuild |
| create booking | counters → flat guarded update (Available→Booked) → booking insert (unique flat partial) → parking guarded `update_many` → demands → ledger → audit | guarded flat update + `uniq_active_booking_per_flat`; compensation (uow) |
| hold / release | flat guarded update with expiry | status in filter; expiry mandatory |
| stage complete → bills | blocks stages update → demands insert per booking → other-charge GST parts → ledger per booking → audit | demands partial unique (booking, installment_seq); lease per booking rebuild (M-03 open) |
| stage undo | demands void → ledger | `UNDO_BLOCKED_BY_PAYMENTS` rule |
| waiver request / approve / reject / cancel | counters (WV/CN) → waivers guarded status update → ledger → audit → notify | **lease**, `modified_count` checks, unique WV/CN |
| cancel → refund / forfeit | bookings guarded (version, Active) → flat → parking → demands → letters VOID → ledger → refunds insert (counter RF) → audit | **lease**; retry finishes (G-09); unique (RF, bucket) |
| refund payout | refunds guarded (Pending, version) incl. split → child upserts → ledger → audit | atomic split + deterministic children (G-06) |
| transfer / swap / revision / plan change | guarded bookings (version) → flats → demands re-proportion → ledger | version check + uow compensation (not crash-drilled: harness could not inject into these, see §9) |
| customer merge | customer_merges row with `before/expected/after` per step | journal row + `steps` |
| numbering | `counters.find_one_and_update $inc` (unique scope+key) | atomic; a lost race can leave a gap (Low) |

## 4. Races (20 reps each, 2 processes) — `drill_races_{before,after}.json`

| drill | before | after |
|---|---|---|
| R1 same receipt + same key at once | 1 receipt, same number 20/20 | same |
| R2 two receipts one booking | integrity bad 2/20 (dup ledger, cap above agreed) | 0/20 |
| R3 two bookings one flat | 1 live booking 20/20, loser "Flat … was just taken by another booking" | same |
| R4 same waiver approved twice | 13/20 two approvals | 20/20 one approval, loser "Already approved" |
| R4b approve vs reject | 14/20 inconsistent | 0 |
| R5 two waivers at once | distinct CN 20/20 | same; DB refuses a repeated CN |
| R6 stage twice | 0 duplicate bills (both 200 in 4/6) | 0 duplicate bills (M-03) |
| R7 receipt during cancel | 2/10 receipt missing from cancellation | 0/10 |
| R8 two ledger rebuilds | 2/20 duplicate seqs | 0/20 |
| R9/R10 direct duplicate ledger / WV / CN | accepted | refused (DuplicateKeyError) |

## 5. Queries, indexes, growth

Explain (`explain` in each JSON, 28 hot queries): COLLSCAN only on job_runs, doc_verifications, generated_documents (M-04)
and tiny collections (waivers 5, refunds 3, merges 4). In-memory sort: job runs latest, login events recent.
Prefix-duplicate indexes: `audit_logs.entity_type_1_entity_id_1 ⊂ audit_entity_created`, `bookings.project_id_1_status_1 ⊂
project_block_summary`, `bookings.customer_id_1 ⊂ c360_bookings`, `bookings.search_booking_number ⊂
ks_company_booking_number_id`, `customers.company_id_1_phone_1 ⊂ ks_company_phone_id`, `customers.company_id_1_full_name_1
⊂ ks_company_full_name_id`, `leads.company_id_1_status_1 ⊂ …created_at_-1_id_1`, `login_events.email_1 ⊂ email_1_ip_1_…`.
Growth (`growth` in JSON; preview has the realistic time span, volume's seed is time-compressed so its per-day rates
are overstated): at 10,000 bookings over 5 years audit_logs ≈ 150 M rows, login_events ≈ 100 M, messages ≈ 6 M,
notifications ≈ 6 M, ledger_entries ≈ 0.72 M (booking-driven, fine). Hot paths read audit_logs only by
`(entity_type, entity_id, created_at)` and `(propagated_complete, created_at)` — both indexed — so growth costs disk, not
latency; Collections/Outstanding read payments/demands/bookings (booking-driven).

## 6. Architecture for 2 replicas (Elite, Atlas, no Redis)

| per-process state | safe with 2+ replicas? |
|---|---|
| `ttlcache` read caches (72 call sites) | **was no (G-08) → yes**: keys carry the shared data stamp |
| event bus (in-process handlers) | yes: handlers run on the writer before the response; their effects are in Mongo (audit outbox, marks) |
| read-model dirty marks | **was no (G-07) → yes**: `read_model_marks` |
| single-flight map | yes (only dedups computes inside one process) |
| ledger rebuild lock | **was in-process only (G-02) → Mongo lease** |
| rate limits / login lockout | yes: Mongo `rate_limits`, user lockout fields |
| idempotency | yes: `idempotency_claims` + unique `payments.idempotency_key` |
| scheduler / leader | yes: `locks` lease; startup lease skips migrations on the 2nd replica (drill §6b) |
| after-commit queue | partly (M-09) |
| load-test project cache `_LT_PIDS` | ≤ 60 s lag for a newly tagged load-test project (Low) |
| RBAC cache | yes: keyed by `roles_version` read from Mongo |
| visit-slot cache 60 s | Low (not money) |
| backups temp file | yes: GridFS |

Stale window (11 surfaces: Home, Home legacy, Booking page, Customer 360, Bills raised, Outstanding, Collections,
Customer status, Bills vs Collection, Payments list, Dashboard; actions receipt / waiver approve / stage complete):

| mode | before 3G | after 3G |
|---|---|---|
| no REDIS_URL | Bills raised 8.2–23.7 s; Home 4.8–5.3 s; Home tower progress > 40 s | **0 s on every surface, every action** |
| REDIS_URL (local redis-server :6390, drill only) | Dashboard 7.1 s; Home tower progress > 40 s | **0 s** |

§6b Two processes started together (10 times): `drill_startup_after.json` — see §8.

DB client: pool 100/5, waitQueue 5 s, serverSelection 5 s, socket 30 s, retryWrites + retryReads, write concern
majority + journal, read preference primary (`db_ro` secondaryPreferred is defined but unused). Recommendation: keep
primary reads for money; `MONGO_MAX_POOL=50` live (M-10). Transactions: preview no (standalone, `hello` has no setName);
live: likely yes (Atlas clusters are replica sets) — not verified from here. Recommendation backed by the crash drills:
do not switch money flows to transactions in 3G — every Critical/High crash point is repaired by retry/recovery without
them (M-07 lists the test needed before relying on transaction mode).

## 7. Data repairs (REQ-306)

Only one: `kkt_medium` read models (derived data). Dry run = audit: 23 customer summaries ≠ bookings. Repair =
`services.read_models.recompute_all()` (the audited admin path `POST /api/admin/recompute-read-models` runs the same
function); result 13 towers, 3 projects, 138 customers; re-audit 0 mismatches; idempotent (a second run changes
nothing). No receipt, bill, booking or ledger row was touched → money-neutral. Index changes on all three DBs: 4 new
unique indexes; one plain index (`ledger_entries booking_seq` / `booking_id_1_seq_1`) replaced by its unique twin.

## 8. Gates and re-run — see `memory/qa/db_audit/gates.md`

## 9. Could not verify / limits

- Crash harness covered `POST /payments` fully (26 crash points, every one repaired by retry). For cheque clear, waiver
  approve and cancel the injector did not reach the request's own writes (they ran but the failure surfaced as 4xx or
  in background tasks), so those crash points are covered by targeted tests (G-06, G-09) and code reading, not by the
  harness. Transfer, swap, revision, plan change and merge were not crash-drilled.
- Transaction mode (Atlas replica set) not exercised (M-07).
- Live Atlas connection limit and replica-set status not visible from here.
