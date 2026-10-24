# KKT v2 — Performance

Targets (from the spec): 1,000 concurrent staff, list pages < 300 ms server time, ERP pages < 1.5 s, website settles < 2 s. Design headroom for 5 lakh concurrent public/portal readers is described in `ARCHITECTURE.md §6`.

Runs below are produced by `pnpm loadtest` (autocannon) against a locally seeded API on the build machine (4 vCPU shared with Postgres and Redis). Each run appends a table.
