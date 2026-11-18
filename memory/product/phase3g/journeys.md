# Phase 3G: Journeys (acceptance criteria)

Logins: `/app/memory/test_credentials.md`. Preview data stays read-only except where a step says "throw-away copy". Phase 1–3F journeys stay valid.

## 3G-A Audit
- **JRN-117** Audit is read-only
  - steps: Run `python -m tools.db_audit --db test_database`, then `--db kkt_medium`, then `--db kkt_volume`.
  - expected: Each run finishes; each prints "read-only: verified"; per-collection count + fingerprint identical before/after; `memory/qa/db_audit/<db>.json` written for all three; volume run ≤ 15 min.
- **JRN-118** Report is complete and evidence-backed
  - steps: Open `memory/qa/db_audit/report.md`.
  - expected: Starts with a one-page plain-English owner summary; covers all 102+ collections in the inventory; every finding has id, severity, evidence with real counts/ids, scenario, exact fix, status (fixed in 3G / listed for phase N); the first-probe facts (ledger seq index not unique, waivers without indexes, ledger lines without company_id, `job_runs` / `generated_documents` / `doc_verifications` / `customer_merges` without indexes, standalone MongoDB) are each confirmed or corrected with evidence.
- **JRN-119** Uniqueness and orphans proven
  - steps: Read the uniqueness and reference sections for all three databases.
  - expected: Every business key in REQ-290 is listed with "enforced by database: yes/no" and its duplicate count; every reference path in REQ-291 shows broken/total; any non-zero is a finding with ids.
- **JRN-120** Money recomputation ties
  - steps: Read the money section; run `tools/tieout.py` on the same databases.
  - expected: Receipt = Σ allocations, bill paid ≤ bill and = Σ cleared allocations, ledger balances, every read model and Cash + Account = agreement all show 0 mismatches, or each mismatch is a finding; tieout 100 %.
- **JRN-121** Write-flow map
  - steps: Read the write-flow section.
  - expected: Every flow in REQ-295 lists its writes in order and the guard on each; any write with no guard is a finding.
- **JRN-122** Index and growth review
  - steps: Read the query and growth sections.
  - expected: Every report / Home / hot-read query explained on volume; collection scans and examined÷returned > 10 flagged; unused and prefix-duplicate indexes listed (e.g. on `payments`); 5-year growth table for 1,500 and 10,000 bookings; no recommendation deletes history.
- **JRN-123** Backup restores
  - steps: Run the restore drill on a throw-away copy.
  - expected: Restored counts equal the source; tieout on the restored copy 100 %.

## 3G-B Races and crashes (throw-away copy of volume)
- **JRN-124** Double-click on a receipt
  - steps: Post the same receipt twice at the same moment with one idempotency key, 20 times.
  - expected: Exactly one receipt, one set of allocations, one ledger line each time; the second call returns the first receipt.
- **JRN-125** Two receipts on one booking at once
  - steps: Post two different receipts on the same booking at the same moment, 20 times.
  - expected: Both saved; allocations oldest-bill-first with no bill paid above its amount; ledger sequence numbers unique and gap-free; tieout passes.
- **JRN-126** Two users book one flat
  - steps: Create two bookings on the same available flat at the same moment, 20 times.
  - expected: Exactly one booking; the other gets "This flat was just booked by someone else" (or the existing equivalent copy) and nothing partial (no customer-side bill, ledger line, number or flat change) is left. (interpreted)
- **JRN-127** Waiver approved twice / two waivers at once
  - steps: Approve the same pending waiver from two sessions at once; separately approve two different waivers at once; 20 times each.
  - expected: One approval and one credit note for the same waiver, the second says "Already approved"; two different waivers get two different credit-note numbers; the database refuses a repeated credit-note number.
- **JRN-128** Stage completed twice at once
  - steps: Complete the same stage for a tower from two sessions at once, 20 times.
  - expected: Bills raised once per booking; no duplicate bill numbers or ledger lines.
- **JRN-129** Receipt during cancellation
  - steps: Post a receipt on a booking while it is being cancelled, 20 times.
  - expected: Either the receipt lands before the cancel and is included in the refund / forfeit figure, or it is refused with a clear message; never a receipt on a cancelled booking that no refund or bridge accounts for; tieout passes.
- **JRN-130** Ledger lines cannot repeat
  - steps: Append two ledger lines on one booking at the same moment; then try to insert a line with an existing booking + sequence directly.
  - expected: Two distinct sequences; the direct duplicate is refused by the database.
- **JRN-131** Crash midway through each money flow
  - steps: For each money flow, stop after each of its writes; then retry the same request (same idempotency key) or run the existing recovery.
  - expected: Every crash point ends either fully applied or fully absent after retry/recovery; tieout 100 %; any point that cannot be repaired is a finding with severity, and none of those is Critical or High at phase end.

## 3G-C Fixes and safety
- **JRN-132** Serious findings fixed
  - steps: Re-run the audit on all three databases after the fixes.
  - expected: 0 Critical, 0 High; each fixed finding names its test, and that test fails on the pre-fix commit and passes now; Medium / Low listed with fix and target phase; multi-company gaps assigned to Phase 4.
- **JRN-133** Duplicates never stop the app
  - steps: On a throw-away copy, insert a duplicate that breaks a new uniqueness rule, restart the backend, open System Health.
  - expected: Backend starts and serves normally; the log names the skipped rule; System Health shows "Uniqueness rule not applied — duplicates found".
- **JRN-134** Money logic and speed unchanged
  - steps: Run tieout, connection matrix, story chronology check and the full pytest suite sequentially; run the perf budget on volume.
  - expected: Tieout 100 % on preview, medium, volume with figures identical to before 3G; matrix 100 % green; chronology 0; pytest 0 failed (no skip / xfail added); post payment, create booking and stage complete p95 ≤ 600 ms and not > 10 % slower than before.
- **JRN-135** Nothing deleted
  - steps: Compare counts of `audit_logs`, `login_events`, `notifications`, `job_runs` before and after the phase; list expiry indexes.
  - expected: No count went down because of this phase; no new expiry / auto-delete index; only the two existing expiries (refresh keys, idempotency claims) remain.

## 3G-D Architecture & scale (2 replicas, Elite)
- **JRN-136** Per-process state reviewed
  - steps: Read the architecture section of the report.
  - expected: Every in-process cache, bus, single-flight map, rate limit, lockout, lock, scheduler lease and queue is listed with "safe with 2+ replicas: yes/no + why"; every "no" touching money, login or jobs is a High finding and fixed.
- **JRN-137** Second server never shows an old money figure
  - steps: On a throw-away copy run 2 backend processes; post a receipt on A, then read Home, booking page, Customer 360, Bills raised, Outstanding, Collections, Customer status and Bills vs Collection on B; repeat for stage complete and waiver approve; repeat with `REDIS_URL` pointing at a local Redis.
  - expected: Before-fix stale seconds recorded in the report; after the fix B shows the new figure on its very next read every time (0 s), in both modes.
- **JRN-138** Two servers start together cleanly
  - steps: Start 2 backend processes at the same moment on a throw-away copy, 10 times.
  - expected: Both serve; no startup error; each index exists once; no nightly / scheduled job runs twice (one `job_runs` row per run); no duplicate seed or migration.
- **JRN-139** Database client fit for 2+ replicas
  - steps: Read the client-settings section.
  - expected: Pool size × replicas × workers stays under the stated connection ceiling; timeouts, retryable writes, write concern and read preference are stated with a recommendation; transactions available on preview: no (standalone) — likely live: stated with evidence; recommendation backed by the crash drills.
- **JRN-140** Speed baseline at Elite size
  - steps: Run the perf budget on volume with the backend capped to 2 CPU cores and 2 processes.
  - expected: A table of every hot read, write and all 50 reports (first + cached p50 / p95) saved as the 3I "before"; the 5 slowest reports named.
