# Phase 1 Close-out — Emergent code review (KKT ERP)

Basis: current worktree snapshot of /app/backend (routers/ → services/ → core/) and /app/frontend/src.
Method mirrors the baseline (/app/memory/product/phase1/code_review_baseline.md, ≈62/100):
equal-weighted mean of 9 sub-scores ×10. Read-only; linters run no-write; no pytest/build.
Scope excludes /app/backend/e1_tests and generated/vendor files. Owner's intentional business
rules (Cash/Account split, oldest-first auto-allocation, Udhar/Jama ledger, 13 masters, numbering)
are treated as requirements, not findings.

## Overall ≈ 78/100  (0 critical / 0 high)

| Dimension | Baseline /10 | Close-out /10 |
|---|---|---|
| Correctness / bugs | 8 | 8 |
| Readability & formatting | 3 | 9 |
| Maintainability / structure | 5 | 7 |
| Error handling | 7 | 8 |
| Security-relevant coding | 8 | 8 |
| Performance | 7 | 7 |
| Frontend quality | 6 | 7 |
| Testing quality | 8 | 8 |
| Consistency / conventions | 5 | 8 |

Mean = 70/9 ×10 ≈ 77.8 → **≈78/100**.

## What improved since the baseline (verified)
- Formatting: frontend lines >200 chars 1,693 → **0**; backend lines >150 chars 2,944 → **24** (remaining are long docstring/definition strings). `ruff format --check` = 120 files already formatted. Import ordering I001 71 → **0** (`ruff check --select I001` passes).
- Dead code / duplicate primitives (baseline CRB-2/CRB-3) resolved: `components/ui/*` 46 → **16**; single toast system (sonner only; no `use-toast`/`toaster`); `StatCard`/`StatusBadge` alias shims gone from `components/common/Bits.jsx`; `pages/SiteVisits.jsx` default dead page removed (named exports only).
- Error handling: bare `except:` 48 → **0**; `except: pass` 19 → **0**; `open()` without context manager 65 → **1** (documented admin backup path). No `except Exception:` that silently `pass/continue/return`.
- Business-day discipline: **no UTC-derived calendar dates remain** in backend (no `date.today()/datetime.utcnow().date()/now().date()` in services/routers/core); all "today"/as-of flows go through `services/clock.today()` in the company time zone; `services/clock.day_of/day_start_utc/day_end_utc/day_range` keep stored timestamps UTC and filter by business day. Frontend mirrors this in `lib/businessDay.js` (used across 10+ pages).
- Linters clean: ESLint on `frontend/src` = no errors; Ruff (default gate) on services/routers/core = no errors via the project gate.

## Money-logic trace (services/definitions.py, ledger.py, allocation.py)
- Cash/Account/Other receipt split has a Mongo pipeline (`receipt_parts_stages`/`receipt_split_group`) and a Python twin (`receipt_parts`); both categorise identically (non-FLAT_VALUE → Other; allocation OTHER_CHARGE → Other else its category), so report/aggregation and per-receipt views agree.
- Outstanding/advance never net across buckets (`max(due,0)` per bucket); `net_balance = outstanding − advance == Σ udhar − Σ jama` holds by construction in `ledger.rebuild`/`two_sided`.
- Ageing (`band_of`/`_allocate`/`ageing_bands`) is oldest-first by design and sums to `outstanding(summary)['total_paise']`; `ageing_for_bookings` streams bookings and demands in chunks of 500 (`$in` on ≤500 ids, `batch_size(500)`), keeping memory O(chunk).
- Overdue is consistent across `overdue_demands_match` (strict `due_date < as_of`), `is_overdue`, and `band_of` (due today = Not due).
- No high/critical correctness defect found in these paths.

## Findings

### MEDIUM [LIKELY] Forecast report/widget do N+1 database round-trips per booking
- Location: `routers/construction.py:777-779` (`/reports/upcoming-dues`) and `routers/dashboard_widgets.py:235-239`.
- Trigger: loading the receivables-forecast report or the upcoming-dues widget for a project/company with many Active bookings.
- Defect: the code streams Active bookings and, inside the loop, issues `db.blocks.find_one(...)` plus `db.demands.find(...).to_list(None)` for every booking (same block re-fetched repeatedly); roughly 2×N queries for N bookings.
- Impact for the owner: on larger projects the forecast screen and the dashboard widget can take several seconds and add avoidable database load; it stays usable at small scale.
- Fix: pre-load the project's blocks once into a dict, and batch demands with a single `{"booking_id": {"$in": [...]}}` query per chunk (the same pattern already used in `definitions.ageing_for_bookings`).
- Regression test: seed many Active bookings in one block and assert the endpoint issues a bounded, chunk-sized number of queries (not one-per-booking).

## Open Questions And Test Gaps
- No frontend behavioural test harness yet (only Playwright screenshots) — top flows (booking, receipt, cancellation) are covered by backend tests but not by UI assertions. Coverage gap, not a defect.
- `services/definitions.is_overdue` reads `d.get("due_date","9999")`; if a demand ever stored `due_date: None`, the `None < str` compare would raise. No code path currently writes a null due_date, so this is latent only.

## Minor Issues
- [LOW] Broad `except Exception` handlers ×48 across services/routers/core — none silently swallow (they log or re-raise as ApiError), but narrowing them would make failures clearer.
- [LOW] ~310 source lines still exceed the 120-char ruff line-length (mostly long definition/docstring strings the formatter will not wrap); readability only.
- [LOW] `routers/inventory.py:49` and one other use `fromisoformat(v.replace("Z","+00:00"))` (FURB162) — redundant on Python 3.11+, harmless.
- [LOW / Phase 2] Unbounded/global-scope queries remain for intended single-company scale: `routers/admin.py:799` `reconcile_all()` loads all booking ids, and several global-unique indexes (customer_code, booking_number, receipt_number, demand_number, users.email, counters) — fine today, revisit for multi-company (matches baseline CRB-4).
- [LOW] `pages/SiteVisits.jsx:36-39` `addDays` does local-browser `Date` arithmetic before `businessDayOf` formatting; can drift by a day near midnight for the slot-picker window (not a money path).
- [LOW] Large frontend components remain (`pages/Reports.jsx` 1147, `pages/v2/Customer360.jsx` 1010, `pages/v2/Leads.jsx` 1003) — size triggers, no concealed defect observed.

## Coverage
- Complete: Requirements Compliance; API And Schema Contract Compatibility (money twins); Data Integrity And Persistence Correctness (ledger/allocation/definitions); State Transition Correctness (demand statuses, cancellation); Error And Partial-Failure Handling; Resource Bounds And Performance; Frontend State And Async Correctness (React Query stale guards); Source Structure And Complexity; Lint/Formatting/Type Safety (Ruff + ESLint); Language And Framework Best Practices; Dead Code And Dependency Hygiene; Consistency.
- PARTIAL: Test Adequacy And Regression Protection — strong backend suite, no frontend behavioural harness.
- PARTIAL: Concurrency, Atomicity, And Idempotency — read-only inspection only; multi-writer races not exercised.

## Limitations
- Basis: current worktree snapshot.
- Not executed: pytest, yarn build, load tests (pod memory-limited / builder busy, per instructions). Linters run in no-write mode only.

## Verdict
Status: READY WITH FIXES
Reason: No confirmed critical/high defects; money, business-day, dead-code, and formatting
goals met; one MEDIUM performance (N+1) item and LOW cleanup items remain.
