# Phase 2 progress

## Chunk 2A — Connection proof (F-42) + Create-booking speed
| Item | Status | Evidence |
|---|---|---|
| REQ-111 profile | done | Server-Timing spans (`core/timing.py`: `span()`, `Laps`; event handlers `ev_<name>`); `tools/perf_budget.py --only create-booking`. Before: p50 1,428.8 / p95 1,657.9 ms (`perf_create_booking_before.md`): `ev_surface_snapshot` 953 ms (company + project money snapshot recomputed for every money audit row, ~8 per booking), auto PDFs 271 ms (allotment, cost sheet, schedule, demand letters), notifications 60 ms |
| REQ-111 fix | done | `services/after_commit.py`: audit surface snapshots + auto documents queued per request, coalesced per context, run after the response (serialized); booking + on-booking bills + ledger unchanged in the request. Journey view drains the queue (≤5 s) before reading a row whose snapshot is pending. After: p50 208.6 / p95 299.7 ms (`perf_create_booking_after1.md`) |
| F-42 matrix | green | `tools/connection_matrix.py` + gate `tests/test_connection_matrix.py` (default pytest run, load_sensitive, private test copy): 21 actions × 22 surfaces = 462 cells, 462 green → `connection_matrix.md` |
| F-42 reds found | fixed at root | (1) Home / dashboard / bootstrap response caches were invalidated at event time, but the dashboard snapshot they read is rebuilt by the debounced (≤2 s) read-model flush → a Home read in between re-cached the old totals for 10 s (Home paid/pending cheques/available stale after payment, booking, flat create). Fix: `read_models.flush` invalidates `home:`/`dash:`/`boot:` after rebuilding. (2) A booking's "Where this entry went" journey listed only booking-entity entries — cheque clear / bounce / receipt reversal / bill entries of its own receipts and bills were missing. Fix: `/journey/entity/booking/{id}` includes the booking's payment + demand entries. (3) Introduced by REQ-111 and fixed: journey of a just-written entry read before its after-commit snapshot → journey drains the queue first. (4) Harness: `tests.flat_claims.own_flats` returned only the first 20 flats (default page size) → page_size=200 + length assert |
| F-42 expectation corrections (owner rules, not defects) | noted | cancellation deducts per policy even at deduction 0 (₹250 on ₹2,500 received) → report checked against the booking's own `cancellation` figures; cancelling marks the booking's lead Lost (funnel Converted −1 / Lost +1); inventory "Sold value" = list price of booked flats, so an agreement revision leaves it unchanged (definition) |
| Hold expiry trigger | added | `POST /api/inventory/holds/expire-sweep` (perm inventory.hold.release) runs the same sweep the backend runs every 15 min |
| Full pytest 2A run 1 | 758 passed, 6 skipped, 3 failed | `pytest_2a.log`: permission matrix + OpenAPI snapshot stale (new sweep endpoint) → regenerated; `test_demand_register_grouping_ties_out_to_ledger_udhar` (whole-company register vs ledger + ETag over two reads) saw another worker's trailing after-commit writes → marked `load_sensitive`, and every exclusive test now drains the backend's after-commit queue (`POST /api/admin/ops/after-commit/drain`) after taking the lock |
| Full pytest 2A run 2 | 760 passed, 6 skipped, 1 failed | `pytest_2a_run2.log`: `test_cancel_booking_flow` booked a flat from another test's `own_flats` tower (towers live in SGH but their flats were never put in the claims file) → `own_flats` claims every flat it creates before pricing them |
| Full pytest 2A run 3 | 760 passed, 6 skipped, 1 failed | `pytest_2a_run3.log`: only `test_200mb_upload_resumes_after_dropped_part` → 500 from the external object store (`integrations.emergentagent.com` SSLEOFError mid 200 MB PUT, `/tmp/kkt_test_backend.log`), not 2A code; re-run alone → passed (`pytest_2a_run3_upload_rerun.log`) |
| Demo proofs | green | tieout 120/120 (`2a_tieout.txt`), integrity 0 / 78 bookings (`2a_integrity.txt`), story logic + chronology 0 (`2a_story_logic.txt`) |
| REQ-111 final perf | ≤ 600 ✓ | `perf_create_booking_after.md`: p50 277.1 / p95 390.9 ms (was 1,428.8 / 1,657.9); remaining time: on-booking demand raise 162 ms, notifications 60 ms, lead 20 ms, read-model rebuild 16 ms, audit 18 ms |
| **2A closing proof** | **0 failed** | `pytest_2a_run4.log`: 762 passed, 5 skipped, 0 failed (719.85 s), alone with sampler; includes the matrix gate (462/462 green, 184 s, +0 MB worker RSS). Peak cg 8,191 MB (mongod 3.65 GB; rest page cache); max pytest worker RSS 254 MB. `/api/openapi.json` 200 |
| Tester iteration_34 | 10/10 backend + UI checks pass | fixed its LOW items: booking journey showed each payment action twice (payments write a payment-entity + booking-entity twin row) → deduped, keeping the receipt row with the snapshot; action labels "Payment posted / cleared / bounced", "Document generated", "Demand raised". Matrix re-run 462/462 green (08:00 UTC); frontend rebuilt (`2a_build.log`). Noted, not changed: Home read-your-write gap ≈0.9 s (within the 5 s budget, by debounce design); the booking page has a History tab but no "Where this entry went" button (JourneyButton exists, unused) |

## Follow-ups A1 / A2 (with 2B + 2C)
| Item | Status | Evidence |
|---|---|---|
| A1 matrix tightening | 0 "any" left | Before: 149 of 462 cells (32 %) carried an "any" (147 metric-level + whole-surface). After: 0 (`connection_matrix.md` line "Informational ("any") metrics remaining: 0"). Relations come from the action's own record: receipt allocation = Δ paid on the booking's live bills around the action → booking outstanding Δ = −alloc, advance Δ = A − alloc, register balance Δ = −alloc; money law on every booking action Δoutstanding − Δadvance = Δbill − Δreceived; subject-only actions tie every aggregate (Home, Outstanding, Project statement, C360, ledger, status counters) to the booking's own Δ; tower actions tie Home ↔ Outstanding ↔ Project statement, register/trends via the booking's own GST factor; cancel = −(booking value before) on every live total and −1 booking; alerts Δunread = alerts this action created; untouched buckets / overdue / today-collections strict "unchanged". 462/462 green (2 runs). |
| A1 reds surfaced | no defect, 1 definition noted | (a) "Bills raised" counted Cancelled bills → matrix metric now excludes status Cancelled (the tab's own semantics); (b) Demand register + Home trends count bills before GST, Statement / Outstanding / Home count with GST → precise GST-factor relation; (c) notifications are after-commit → polled with read models. No owner-rule change needed. |
| A2 "Where this entry went" | done | Secondary items (never the main action): booking page "Add / Do next" row (`journey-btn-booking`), every receipt row (`journey-btn-receipt-<no>`) and bill row (`journey-btn-bill-<no>`) in Customer 360 → existing JourneyButton/JourneyPanel; gated `admin.audit.view` like the journey API |

## Chunk 2B + 2C — Calm Light / Night design system + shell
| Item | Status | Evidence |
|---|---|---|
| Tokens | done | `frontend/src/styles/tokens.css` — one set, `:root[data-theme=light|night]`; one `--accent` (light #7f6026, night #d2ad66; Phase 5 per company), Due `--due`, Advance `--advance`, canvas/surface/hairline/text/chart tokens. Tailwind palette (`ink/warm/gold/sage/brick/txt/white/...`) and the shadcn names all map to tokens via `color-mix(... <alpha-value>)`; the `.v2` UI kit vars alias the tokens; 0 hex colours left in app JSX except print templates |
| Font | done | Geist Variable + Geist Mono Variable, self-hosted via @fontsource-variable (font-display: swap), tabular figures (`tnum`) globally; Google Fonts links removed |
| Theme switch / no flash | done | exactly Light / Night (`theme-switch`, `theme-light`, `theme-night`) in top bar + profile menu; `PATCH /api/auth/me/preferences {theme}` → `users.ui_theme`, `/auth/me` returns it; inline boot script in `public/index.html` sets `<html data-theme>` from localStorage before CSS/JS; after /auth/me + login the profile wins; failed save keeps the choice for the session, toast "Theme not saved — will retry", retried every 30 s |
| Contrast | 0 AA failures | `backend/tests/test_theme_contrast.py` (default pytest): 54 token pairs × 2 themes, text 4.5:1, chart marks 3:1; recharts axes/grid/legend/tooltip themed in `index.css` |
| Shell | done | light collapsible sidebar (state remembered `kkt_sb`), locked areas Home · Projects · Customers · Bookings · Payments (Received · Bills raised · Roznamcha) · Construction · Documents · Reports · Masters · Admin, role-filtered; top bar search pill (⌘K/Ctrl K), New menu exactly Booking / Payment / Lead / Customer / Site visit, notifications, theme, profile; `company-switcher-slot` reserved; 390 px: menu button, search icon, no bottom tab bar |
| Search | ≤ 400 ms | grouped Customers / Bookings / Flats / Receipts (+ projects, towers) by name, phone, BK no., receipt no., flat no.; keyboard nav (cmdk); "No match for '<text>'" + New customer / New lead. On screen (keystroke → results, `data-search-ms`): 192–203 ms (results.json) |
| Lazy routes | done | every route lazy; shell `Suspense` → `PageSkeleton` (never blank); hover/focus prefetch for all areas |
| Initial JS | 112.2 KB gzip | `build/static/js/main.*.js` (only script in index.html); CI=true yarn build + yarn build exit 0; ESLint 0/0 |
| Screenshots | done | `screens/{light,night}-{1440,390}-{login,home,booking,customer360,bills-raised,roznamcha,reports,masters}.png` + search; 0 px horizontal overflow on every screen/width (`screens/results.json`) |
| Tester | done | iteration_35: 4 bugs + 1 low (theme PATCH blocked by the version guard, search pill, cmdk fuzzy pre-select, bill journey empty, Site visit link) → fixed; iteration_36: 6/6 retest pass + 2 cosmetics fixed (Home trend values no-wrap, "Bill raised" journey label) |
| New red from A1 under load | root-fixed | stage complete × Home outstanding stale > 5 s in full run 3 → cache-fill race in `services/ttlcache.py` (compute started before the read-model flush stored pre-flush totals after the invalidation). Generation counter + invalidate detaches in-flight computes + dashboard/widgets manual puts pass the generation; `tests/test_ttlcache_race.py` |
| Full pytest -n 2 | 0 failed | run 4: 766 passed, 5 skipped, 18 warnings in 705.78 s (`pytest_2bc_run4.log`); peak cgroup 8191 MB (`mem_samples_2bc4.log`). Earlier runs: run 1 three static-gate fails (sidebar label scan, ruff/prettier format) → fixed; run 2 inventory hold tie-out cross-worker race → `load_sensitive`; run 3 the ttlcache race above |

## Chunk 2D — Home Command Center (2026-11-16)

| Item | Status | Evidence |
|---|---|---|
| 11 widgets, one definition each | done | `routers/home_defs.py` (+ `services/home_filters.py` shared by Home and lists), one call `GET /api/home/bundle?period=&project_id=` |
| One Outstanding number | done | Old two-label widgets removed; Overdue-by-age total == Outstanding report to the rupee (`test_home_bundle.py`); C360 spark renamed "Bills unpaid at month end" |
| Owner project Ye / YE | kept | Shown as "Ye · Orion · Plinth · No bookings to bill", 48 available; never purged |
| Role defaults (server) | done | Owner/SA 11 · Accounts 1,2,3,4,5,11 · Sales call/pipeline/inventory/flat status · Site engineer milestone/construction/flat status; hidden widgets never computed |
| Customise / reset / migrate | done | `/api/me/home-layout` show/hide/reorder/size, Reset, old keys mapped |
| Drill ties | done | every number's list total/count == number (`test_home_bundle.py`, tieout Home section) |
| Failure isolation | done | per-widget `{ok:false}` → "Couldn't load — Retry" |
| Sales display layer | done | Inventory + Flat grid use the masked Available/Hold/Sold layer |
| Matrix | green | 21 × 23 = 483 cells, 483 green, 0 ANY (new surface `home_command`: widget Δ == list Δ for every action) |
| Tieout | 332/332 | `2d_tieout.txt` |
| Integrity / chronology | 0 / 0 | `2d_integrity.txt` (78 bookings), `2d_story_logic.txt` |
| Perf | see `/app/memory/qa/perf/phase2_end.md` | bundle uncached first ≈ 87 ms, warm p95 within 200 ms; browser first content ≈ 1.0–1.1 s headless on shared CPU (borderline vs 1.0 s), all widgets arrive with first content |
| Screens | done | `screens/home-{owner,accounts,sales,siteengineer}-{light,night}-{1440,390}.png`, 0 px horizontal overflow at 390 |
| Final full suite | green | `pytest -n 2`: 784 passed, 5 skipped, 0 failed (764.8 s), peak 8191 MB |

## Fix round P2-1 (2026-11-16)
| Item | Status | Evidence |
|---|---|---|
| P1 Roznamcha cash out | done | refund / cash-reversal rows + "Cash paid out" tile + `opening + in − out = closing` line; API `refunds[]`, `cash_paid_out_paise`; matrix action "refund paid (cash)" checks screen rows; `tests/test_roznamcha_cash_out.py` |
| P2 AA contrast | done | avatar palette pairs all ≥4.5 both themes, covered by `test_theme_contrast.py` (old palette fails it); axe wcag2a+aa booking + C360 × Light/Night = 0 (`p21_axe.json`) |
| P3 demo refresh | done | one refresh (setup kept, Ye kept: 1 tower / 48 flats); story DONE 80 bookings; its tieout gate hit a live audit-log race → tie fixed to bracket the live count; tieout 332/332, integrity 0 (78 live), chronology 0; demo_journeys regenerated |
| P4 | done | band cards on Outstanding; 0-count status totals; `yarn lint` = build rules, `--max-warnings 0`, no pipe |
| Matrix | green | 22 × 23 = 506, 0 ANY |

## Fix round P2-2 + Phase 2 closing proof (2026-11-16)
| Item | Status | Evidence |
|---|---|---|
| Q1 cross-user cache leak | fixed | user-keyed query keys + `switchSession` (logout/login/restore); `test_session_isolation.py`; e2e Owner→Sales→Accounts ok (`p22_session_switch_e2e.json`) |
| Q2 drill chip + period pill | fixed | shell `HomeDrillBar` on every `via=home` screen; Collections pill "Custom" |
| Q3 Inflow empty | fixed | sentence + next step only |
| Q4 login → first widget | 438 ms median (was ≈1.35 s) | `p22_login_timing_after.json` |
| Lint / build | 0 / 0, build ok | `yarn lint` |
| Matrix | 506/506, 0 ANY | `connection_matrix.md` |
| Tieout / integrity / chronology | 332/332 · 0 · 0 | `p22_*.txt` |
| Perf | bundle p95 4.9 ms, create booking p95 280 ms, search p95 6.8 ms, initial JS 112.4 KB | `qa/perf/phase2_end.md` |
| Full pytest -n 2 | 793 passed, 5 skipped, 0 failed (960 s), peak 8191 MB | run 2 (run 1: 5 failed + 2 errors, root-fixed in 3d6bba1) |
