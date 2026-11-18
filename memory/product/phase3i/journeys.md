# Phase 3I: Journeys (acceptance criteria)

Logins: `/app/memory/test_credentials.md`. Phase 1–3H journeys stay valid. "Elite shape" = `kkt_volume` copy, 2 backend processes, CPU capped to 2 cores, no reload. Speed figures are server time (`Server-Timing: total`) unless a journey says "on screen".

## 3I-A Reports
- **JRN-171** The 5 slowest are fast
  - steps: On the Elite shape, post a receipt, then open Receivables forecast, Collections, Bank-wise receipts, Booking health, Transfers; repeat 10 times; then 30 repeat opens each.
  - expected: Each report's first-open p95 ≤ 300 ms and repeat p95 ≤ 300 ms, without Redis and with Redis; figures equal the 3H figures for the same data.
- **JRN-172** All 50 under 0.3 s
  - steps: Run the 50-report perf script on the Elite shape, without and with Redis.
  - expected: 50 / 50 reports ≤ 300 ms p95 on first open after a save and on repeat open, in both modes; the table is saved and compared with the 3G baseline.
- **JRN-173** Fast and current after a save
  - steps: Post a ₹10,000 cash receipt on a booking; within the same second open Collections, Outstanding, Customer status, Bills vs Collection and Cash vs Account from the other server.
  - expected: Every report already shows the new ₹10,000 and still opens in ≤ 300 ms.
- **JRN-174** Same figures as before
  - steps: Run the old-vs-new equivalence over the 50 reports × the filter matrix (every group level, As of today + 3 past dates, Include cancelled on/off, 2 project filters, 2 date presets) on preview, medium, volume; run tieout and the As-of replay.
  - expected: 0 differences; tieout 0 failed; replay 0 mismatches.
- **JRN-175** As of a past date is fast too
  - steps: Open Outstanding and Customer status As of each month end of the FY and today, on the Elite shape.
  - expected: Each ≤ 300 ms p95.
- **JRN-176** Exports start quickly
  - steps: Export Collections, Outstanding and Customer status to Excel and PDF on volume.
  - expected: Each download starts within 3 s p95; totals equal the screen. (estimate)
- **JRN-177** Kept-ready figures repair themselves
  - steps: On a throw-away copy, stop the server in the middle of a save (crash point after the money write, before the summary update), restart, open the 5 reports.
  - expected: Correct figures on the first open (computed from source if needed); the kept-ready data is repaired; the nightly check then shows "Report figures: in step".
- **JRN-178** Nightly in-step check catches a difference
  - steps: On a throw-away copy, change one kept-ready figure by hand, run the nightly check.
  - expected: System Health shows "Report figures: 1 difference" with the scope; the repair puts it back; the next check shows "in step".

## 3I-B Saves and screens
- **JRN-179** The three main saves are back to speed
  - steps: Run the write budget on the Elite shape (30 runs each).
  - expected: Post payment ≤ 111 ms, create booking ≤ 259 ms, stage complete (33 bookings) ≤ 526 ms p95, and all ≤ 600 ms; the 3G race drills still give 0 duplicates.
- **JRN-180** Every other save inside 600 ms
  - steps: Time cheque clear, bounce, reversal, waiver request / approve / reject, cancel, refund payout, transfer, agreement revision, plan change, hold / release, manual bill, customer edit on volume.
  - expected: Each ≤ 600 ms p95; table saved.
- **JRN-181** Hot screens inside 200 ms
  - steps: Measure Home bundle (month, FY, today + project), project list / detail, booking detail, Customer 360, Bills raised, unit grid, catalogues — warm and right after a save.
  - expected: Each ≤ 200 ms p95 in both cases.
- **JRN-182** Moving around the app feels instant
  - steps: On preview, click through Home → Bookings → a booking → Customer 360 → Reports hub → Outstanding → Collections → Projects → a project → Bills raised.
  - expected: Each route shows content (skeleton first, never blank) within 300 ms warm; initial JS ≤ 250 KB gzip.

## 3I-C Redis
- **JRN-183** Shared cache on
  - steps: Start 2 servers with `REDIS_URL` pointing at a local Redis; open a report on server A, then the same report on server B.
  - expected: B's open is a cache hit (System Health hit rate rises); figure identical; after a save on A, B shows the new figure on its next open.
- **JRN-184** No Redis — same figures, same budgets
  - steps: Run JRN-172 and JRN-173 without `REDIS_URL`.
  - expected: Same figures; all within budget; System Health "Fast cache: off".
- **JRN-185** Redis stops mid-work
  - steps: During the load test, stop the local Redis for 60 s, then start it again.
  - expected: 0 user-visible errors; reports keep opening with correct figures; System Health shows "Fast cache: unavailable — running without it", then "on" again; one log line per minute, not per request.
- **JRN-186** Upstash-ready
  - steps: Point `REDIS_URL` at a TLS Redis address (`rediss://`, local TLS Redis or stunnel) and repeat JRN-183.
  - expected: Works the same; System Health shows commands today / this month vs 500,000.
- **JRN-187** Stays within the free plan
  - steps: Read the projected monthly Redis commands from the load test.
  - expected: Projection for 15 staff × 10 h × 26 days ≤ 500,000 (plan ≤ 250,000), with the formula shown. (estimate)
- **JRN-188** Money never depends on Redis
  - steps: With Redis on, run the 3G race drills and 2-process stale drill; then stop Redis and run them again.
  - expected: 0 duplicates, 0 s stale in both cases.

## 3I-D Database and server
- **JRN-189** No more full scans
  - steps: Re-run the db audit explain section on volume.
  - expected: 0 collection scans on report / Home / hot-read queries; examined ÷ returned ≤ 10 or read from kept-ready data; M-04 closed.
- **JRN-190** More keys enforced safely
  - steps: Re-run the uniqueness section; on a throw-away copy insert a duplicate for one newly enforced key and restart.
  - expected: Newly enforced keys show "enforced: yes" with 0 duplicates; the duplicate case starts normally and System Health names the skipped rule.
- **JRN-191** Index list for later
  - steps: Read the index section of the 3I report.
  - expected: The 8 prefix-duplicate / unused indexes listed with measured use; none dropped.
- **JRN-192** Connection pool fits live
  - steps: Start the backend without pool env vars; read System Health / health endpoint.
  - expected: Pool max 40, min 2 by default; stated sum for 4 servers × 2 workers ≤ 500.
- **JRN-193** Transaction mode proven
  - steps: Run the full pytest suite once against a single-node replica set.
  - expected: 0 failed; the health endpoint shows transactions available; tieout clean.
- **JRN-194** Queued letters survive a stop
  - steps: On a throw-away copy, create a booking (queues an allotment letter) and stop the server before the letter is written; restart.
  - expected: The letter is produced once after restart; never twice.
- **JRN-195** History archived, never deleted
  - steps: Run the monthly archive on a throw-away copy with old login records and notifications.
  - expected: Rows older than the window move to the archive collections; total rows (live + archive) unchanged; no expiry index added.
- **JRN-196** Engagement score same on both servers
  - steps: Complete a stage on server A; open the affected customer's Customer 360 on server B, 10 times.
  - expected: Same engagement score as A every time.

## 3I-E 50 people at once
- **JRN-197** 50-user load test without Redis
  - steps: Run the 50-user mix for 20 minutes on the Elite shape with 2 servers, no Redis.
  - expected: 0 server errors; every route within budget at p95; tieout, integrity, matrix and db audit clean afterwards.
- **JRN-198** 50-user load test with Redis
  - steps: Repeat JRN-197 with a local Redis.
  - expected: Same as JRN-197; report p95 equal or better than without Redis; command count recorded for JRN-187.
