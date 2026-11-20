# Phase 3G: Database integrity audit + architecture & scale review + fix the serious findings

Version: phase-3G. Features: F-55, F-56, F-58 (see `../overview.md`, incl. owner decisions 2026-11-18 under Phase 3G/3H/3I). Locked rules: `/app/memory/HANDOFF.md` §3, §5, §10. Gates: `../ALL_PHASES_TODO.md` "Gates" (pytest run **sequentially**, never `-n 2` for heavy suites — known DB races in the test harness). Starting point: `../db_audit/probe.py` (first read-only probe; extend or replace it).

## Goal
The owner asked for a production-grade database integrity audit "as a Senior Database Engineer — don't just give generic recommendations". Deliver a committed, re-runnable, **read-only** audit tool and an evidence-backed report covering every collection and every money write path; then fix every Critical and High finding (owner: "fix the serious ones right away, list the rest") without changing any owner money rule.

Known facts from the first probe (preview `test_database`, 2026-11-18, read-only): 102 collections; 0 duplicates on the business keys probed; 0 orphans on 15 reference paths; 0 flats with two live bookings; money stored as integer paise; MongoDB 7.0 **standalone** (no multi-document transactions); `ledger_entries (booking_id, seq)` index is **not unique**; `waivers` has **no indexes** (no uniqueness on waiver / credit-note number); `refunds` no unique number; `ledger_entries` carry **no company_id** (0 / 5,916); `job_runs` (5.4k), `generated_documents` (691), `doc_verifications` (1.1k), `customer_merges` have only `_id`; `audit_logs` 421,531 rows for 82 bookings; `payments` carries 23 indexes; validators exist on 11 collections (`moderate` / `error`). The audit must confirm or correct each of these with its own evidence.

## Functional requirements

### 3G-A The audit (read-only)
- REQ-285 [always] The system shall provide `backend/tools/db_audit.py`, a re-runnable audit that uses only read operations (find, aggregate, count, list indexes, explain, collection stats) against the database it is pointed at.
- REQ-286 [always] The audit shall run on preview (`test_database`), the medium profile (`kkt_medium`) and volume (`kkt_volume`, 1,500 bookings), and write `memory/qa/db_audit/<db>.json` plus one combined `memory/qa/db_audit/report.md`.
- REQ-287 [always] The audit shall prove it changed nothing by recording, per collection, the document count and a content fingerprint before and after its run, and printing "read-only: verified" only when all are identical.
- REQ-288 [always] The audit shall inventory every collection: document count, size, index count and size, validator presence and level, money fields, date fields, and the share of documents carrying `company_id`.
- REQ-289 [always] The audit shall check field-shape consistency per collection: each field's presence % and every type it appears with (e.g. money as int vs float vs string, dates as tz-aware string vs naive vs date string).
- REQ-290 [always] The audit shall list every business key that must be unique (at least: booking number, receipt number, demand number, waiver number, credit-note number, refund number, customer code, user email, ledger line booking + sequence, counter scope + key, flat per tower, parking slot per project, one live booking per flat, one active plan assignment per booking, idempotency key) and for each report whether the database enforces it and how many duplicates exist.
- REQ-291 [always] The audit shall check every reference field, including nested ones (receipt allocations → bills, waivers → bill / booking, refunds → booking / receipt, ledger lines → their source receipt / bill / waiver / refund, parking → booking, merges → customers, read models → their scope), and report broken / total per path.
- REQ-292 [always] The audit shall recompute money from source records and compare it to every stored figure: receipt amount = Σ its allocations; bill paid = Σ cleared allocations to it, never above the bill; ledger running balance per booking = recomputed; `customer_summaries`, `monthly_buckets`, project / block summaries and `dashboard_snapshots` = recomputed; waiver ≤ the open share it waives; refund ≤ money received; Cash + Account = agreement value; no negative amount where the rule forbids it.
- REQ-293 [always] The audit shall check record states against each other: flat status vs live booking, booking status vs its bills and refunds, cheque state vs cleared / bounced dates, voided bills carrying no allocation, holds carrying an expiry, merged customers carrying no live bookings.
- REQ-294 [always] The audit shall check time integrity: one timestamp format per field, India business-day date strings where the rule says so, and chronology (lead ≤ visit ≤ booking ≤ its bills ≤ their receipts; cheque cleared ≥ deposited; refund after cancellation).
- REQ-295 [always] The audit shall list, for every money write flow (post receipt cash / cheque / online, cheque clear, bounce, reversal, create booking, hold / release, stage complete → bills, stage undo, waiver request / approve / reject / cancel, cancel booking → refund / forfeit, transfer, agreement revision, plan change, customer merge, numbering), each database write in order and the guard that protects it (unique index, version check, guarded `$inc`, idempotency key, compensation, journal).
- REQ-296 [always] The audit shall run race drills on a throw-away copy of the volume data — at least: the same receipt posted twice at once with one idempotency key; two receipts at once on one booking; two bookings at once on one flat; the same waiver approved twice at once; two waivers approved at once (credit-note numbers); a stage completed twice at once; a receipt posted while the booking is being cancelled; two ledger appends at once on one booking — and report the outcome of each.
- REQ-297 [always] The audit shall run crash drills on the throw-away copy by stopping each multi-step money flow after each of its writes, then report the state left behind, whether a retry or the existing recovery repairs it, and whether tie-outs pass afterwards.
- REQ-298 [always] The audit shall explain every report, Home and hot-read query on volume and flag collection scans, docs-examined ÷ docs-returned above 10, indexes never used, and indexes that are a prefix of another index.
- REQ-299 [always] The audit shall project growth per collection (rows per booking and per day from current data) for 1,500 and 10,000 bookings over 5 years, given the owner's "keep all history forever" decision, and flag any collection whose growth will slow a hot path or a report.
- REQ-300 [always] The audit shall verify backup and restore by running the existing restore drill on a throw-away copy and comparing counts and tie-outs.
- REQ-301 [always] Every finding shall carry an id, a severity (Critical = can misstate money, lose a record or expose data today · High = can do so under a realistic race, crash or retry · Medium = rare-condition or scale risk · Low = hygiene), the evidence (counts, ids, explain output, drill result), the exact scenario, the exact fix, and a status (fixed in 3G · listed for phase N).
- REQ-302 [always] The report shall open with a one-page owner summary in plain English: what is proven safe, what was fixed, what is listed for later, with no technical words.

### 3G-B Fixing the serious findings
- REQ-303 [always] The system shall fix every Critical and High finding in this phase.
- REQ-304 [always] Each fix shall come with a test that fails on the code before the fix and passes after it.
- REQ-305 [always] Fixes shall not change any owner money rule, allocation order, numbering format, billing cycle, GST rule or wording (HANDOFF §5).
- REQ-306 [always] A fix that needs a data repair shall run as a dry run first, be audited, idempotent and money-neutral (tie-outs identical before and after) on preview, medium and volume.
- REQ-307 [unwanted] If a new uniqueness rule meets existing duplicates at startup (e.g. on production), then the system shall keep starting, skip only that rule, log it, and show "Uniqueness rule not applied — duplicates found" on System Health.
- REQ-308 [unwanted] If a concurrent second request loses a race (same flat, same waiver, same idempotency key, stale version), then the system shall return a clear message ("This flat was just booked by someone else", "Already approved", the original receipt, "This record changed — reload") and write nothing partial. (interpreted)
- REQ-309 [always] The system shall delete no history: no new expiry or auto-delete on login records, notifications, job logs or the activity log; archiving, if used, moves rows and never deletes them (owner).
- REQ-310 [always] Medium and Low findings shall be listed in the report with their fix and target phase; multi-company gaps (e.g. ledger lines without `company_id`) are assigned to Phase 4. (interpreted)
- REQ-311 [always] The audit shall become a gate: re-running it after the fixes shows 0 Critical and 0 High on preview, medium and volume, and it is added to the phase gates.

### 3G-C Architecture & scale review (F-58)
Live facts (Emergent support, 2026-11-18): production runs as **2 replicas** (auto-scales up under load), owner's tier **Elite** = 2 vCPU / 8 GB guaranteed, burst 4 vCPU / 16 GB per pod, arm64, port 8080; database = Emergent-managed MongoDB Atlas (replica-set status not documented — Atlas clusters are normally replica sets, so transactions are likely available live but not on preview's standalone mongod); no Redis provided; Cloudflare caches hashed static assets 1 year, HTML no-cache, API not cached. Preview: `uvicorn --workers 1 --reload`, 16 cores, no Redis server, `services/ttlcache.py` is in-process per worker with in-process event-bus invalidation unless `REDIS_URL` is set (72 call sites); reports v3 keys carry a DB data stamp.
- REQ-312 [always] The audit shall list every piece of per-process state (in-process caches, event bus, single-flight maps, rate limits, login lockouts, locks, scheduler / leader lease, in-memory queues, temp files) and state for each whether it stays correct with 2 or more replicas.
- REQ-313 [always] The audit shall measure the stale window by running 2 backend processes on one throw-away copy, posting a receipt / completing a stage / approving a waiver on process A, and reading Home, booking page, Customer 360, Bills raised, Outstanding and 3 reports from process B, reporting the seconds until B shows the new figure.
- REQ-314 [always] After the fixes, process B shall show the new money figure on its very next read after the write returns on process A (stale window 0 s for every money surface), with and without `REDIS_URL`.
- REQ-315 [always] The audit shall review the database client settings (pool size vs replicas × workers vs Atlas connection limits, server-selection / socket timeouts, retryable writes, read / write concern, read preference) and the startup path (index creation, migrations, seeding guards) for 2 replicas starting at the same moment.
- REQ-316 [always] The audit shall state whether multi-document transactions are available on preview and are likely live, and recommend, with evidence from the crash drills, whether money flows should use them where available; a switch to transactions is made in 3G only if a Critical / High crash finding needs it, and then the code shall work both with and without transaction support, tested in both modes (e.g. a single-node replica set on a throw-away mongod). (interpreted)
- REQ-317 [always] The audit shall record a speed baseline for every hot read, every write budget and all 50 reports on volume with the backend's CPU capped to 2 cores (Elite guaranteed) and 2 backend processes, as the "before" for Phase 3I; it fixes nothing for speed in 3G except where a serious finding needs it.

### 3G-D Process
- REQ-318 [always] The builder shall send the orchestrator the findings table (id · severity · one line · planned fix) as soon as the audit report exists, then continue straight into the Critical / High fixes without waiting, stopping only if a fix would change an owner money rule.

## Quality requirements
```
Q-34  Tag: Audit.ReadOnly
      Scale: collections whose count or fingerprint changed during an audit run
      Meter: db_audit.py before/after fingerprint, 3 databases
      Must: 0
      Plan: 0
Q-35  Tag: Money.Integrity
      Scale: money mismatches between stored figures and recomputation
      Meter: db_audit.py recompute section + tools/tieout.py, preview + medium + volume
      Must: 0
      Plan: 0
Q-36  Tag: Concurrency.DoubleWrite
      Scale: duplicate receipts / bookings / credit notes / bills / ledger sequences produced by the race drills
      Meter: race drills, 20 repetitions each on the throw-away copy
      Must: 0
      Plan: 0
Q-37  Tag: Crash.Recovery
      Scale: crash points that leave a state the retry or recovery does not repair
      Meter: crash drills, every write step of every money flow
      Must: 0 for Critical/High flows (anything left is listed with severity)
      Plan: 0
Q-38  Tag: Perf.Writes
      Scale: p95 ms for post payment / create booking / stage complete (≤ 60 bookings) after new indexes
      Meter: tools/perf_budget.py, 30 warm requests, volume
      Must: ≤ 600 ms and not > 10 % slower than before 3G without a stated cause
      Plan: no change
Q-39  Tag: Audit.Runtime
      Scale: minutes for one full audit run on volume (race + crash drills excluded)
      Meter: wall clock
      Must: ≤ 15 (estimate)
      Plan: ≤ 5
Q-40  Tag: Startup.Safety
      Scale: app start failures caused by a uniqueness rule meeting existing duplicates
      Meter: drill — seed a duplicate on a throw-away copy, restart backend
      Must: 0
      Plan: 0
Q-41  Tag: Replicas.Staleness
      Scale: seconds a second backend process shows an old money figure after a write returned on the first
      Meter: 2-process drill, receipt / stage complete / waiver approve × 9 surfaces, 10 repetitions, with and without REDIS_URL
      Must: 0
      Plan: 0
Q-42  Tag: Replicas.Startup
      Scale: errors or duplicate jobs when 2 backend processes start at the same moment
      Meter: start 2 processes together on a throw-away copy 10 times; check logs, job_runs, indexes
      Must: 0
      Plan: 0
```

## Non-goals
Report fixes, speed and As-of (Phase 3H) · company scoping itself (Phase 4) · any change to owner money logic · deleting any history · production database access (never touched; fixes reach billpe.com on the owner's next publish).
