```json
{
  "all_green": true,
  "suites": [
    "pnpm typecheck: 7/7 tasks pass (ERP, web, portal included)",
    "pnpm lint: 7/7 tasks plus the root eslint run, 0 errors and 0 warnings",
    "pnpm format:check: all files pass",
    "domain unit: 12 files, 130 tests pass",
    "contracts unit: 7 files, 183 tests pass",
    "db unit (TEST_DATABASE_URL=.../kkt_rel_db, created): 6 files, 71 tests pass",
    "api unit: 23 files, 133 tests pass",
    "erp unit: 19 files, 162 tests pass",
    "web unit: 6 files, 17 tests pass",
    "portal unit: 4 files, 13 tests pass",
    "API integration, full suite (TEST_DATABASE_URL=.../kkt_rel_test2, created; TEST_REDIS_URL redis://localhost:6379/30; --no-file-parallelism): 48 files, 600 tests pass, including the new cross-session test",
    "acceptance (ACCEPTANCE_DATABASE_URL=.../kkt_rel_acc, ACCEPTANCE_REDIS_URL redis://localhost:6379/31, serial): 13 files, 55 tests pass in 509 s"
  ],
  "defects_found_and_fixed": [
    "The search cancel-race proof was missing a check that a timed-out search never touches another session. Added a test in /home/user/Kktrealestate/claude-kkt/apps/api/test/integration/search.test.ts, 'a timed-out search never touches another session's statement'. A pg_sleep(3) on a second connection stays 'active' in pg_stat_activity, on the same backend pid, while budgeted and HTTP /search requests time out, and it returns normally. 100 ms statements queued onto the same two pooled connections right after each timed-out search all succeed. Afterwards every pooled connection shows the normal statement_timeout. Mutation check: with a session-level 'set statement_timeout' (no BEGIN) the test fails with 57014. A first draft only waited for a connection, never ran a statement, and passed against that mutant; it was rewritten. The real code passes.",
    "Documented the new test in /home/user/Kktrealestate/claude-kkt/docs/PERFORMANCE.md under 'Reliability fixes', in the Proof list for item 1."
  ],
  "open_items": [
    "What I re-checked by reading the code (no defects found): (1) statementBudget.ts never sends an out-of-band cancel. statement_timeout is SET LOCAL inside BEGIN READ ONLY and ended by ROLLBACK. Even a plain SET would be undone by the ROLLBACK, so the setting cannot leak. A reservation that arrives after the budget is released unused. (2) loadShed.ts: PROBES covers /health, /ready, /metrics and their /api/v1 forms, which are exactly what the system module registers and what the k8s probes use. Pressure only lowers the cap (never below 8, never 0) and turns off after one quiet 500 ms window. reply.hijack makes reply.sent true, so Fastify stops the hook chain. The in-flight slot is released on res 'close'. The integration tests for recovery and for probes staying 200 during saturation pass. (3) No response fields were trimmed: packages/contracts and the ERP, web and portal apps are unchanged by the diff. Ledger 'summary' is still returned, and all three frontends pass typecheck and unit tests. (4) Payments: the bucket and charge caps are still read with clearedInBucket/clearedOnCharge after lockBooking. The idempotent replay check is still serialised behind the lock and returns before any validation. The lock order is still row FOR UPDATE then pg_advisory_xact_lock(hashtext('booking:<id>')). It is now one statement with a MATERIALIZED CTE, the same key as withAdvisoryLock. Callers of applyCleared (post and clear) hold lockBooking in the same transaction, so appendEvent({locked:true}) is safe. All money integration and acceptance tests pass.",
    "Minor behaviour change, not a defect: the new lockBooking takes no advisory lock when the booking row does not exist (the old code took it anyway). Every caller loads an existing booking first, so it has no effect today.",
    "Housekeeping: @fastify/under-pressure is still listed in apps/api/package.json but is no longer imported. I left it because changing dependencies was out of scope; remove it in a follow-up with a lockfile update.",
    "Still open from the fix report and not re-measured here (no load tests were re-run): /auth/me and /projects 3–13 % lower with 4 workers, and the rare postgres.js UNSAFE_TRANSACTION seen in one payment benchmark run.",
    "Nothing was committed. Databases kkt_rel_db, kkt_rel_test2 and kkt_rel_acc are kept. Logs are in /tmp/claude-0/-home-user/78285bda-7231-5286-85fe-a30697a92e0b/scratchpad/ver."
  ]
}
```
