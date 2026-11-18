# Baseline — Emergent code review (2026-11-13, before any change in this job)

Overall ≈ 62/100 (equal-weighted mean of 9 sub-scores ×10; method re-runnable). The owner's earlier 17/100 was a different run; this reviewer confirms the low score is formatting/hygiene-driven, not correctness-driven.

| Dimension | /10 |
|---|---|
| Correctness / bugs | 8 |
| Readability & formatting | 3 |
| Maintainability / structure | 5 |
| Error handling | 7 |
| Security-relevant coding | 8 |
| Performance | 7 |
| Frontend quality | 6 |
| Testing quality | 8 |
| Consistency / conventions | 5 |

## Findings (no critical / high)
| id | sev | finding | fix | status |
|---|---|---|---|---|
| CRB-1 | medium | Extreme line density: 1,693 frontend lines > 200 chars (max 2,689, `pages/v2/Documents.jsx`); whole components on one line; backend ~2,944 lines > 150 chars | Prettier (printWidth 100) over `frontend/src`; `ruff format` over backend; CI format gate | open |
| CRB-2 | medium | ~30 of 46 `components/ui/*` shadcn files unused; two toast systems (sonner vs ui/toast + toaster + hooks/use-toast); two button systems (`ui/button` vs `.btn`); alias shims `StatCard`/`StatusBadge` (`components/common/Bits.jsx:37,61`) | Delete unused ui files; sonner only; one Button; migrate callers to StatTile/StatusPill | open |
| CRB-3 | medium | Dead default page `pages/SiteVisits.jsx:97` (route redirects to `/leads?tab=visits`) | Delete default component, keep named exports used by Leads | open |
| CRB-4 | low (latent multi-company) | Unscoped queries: `services/ledger.py` rebuild, `routers/admin.py:313` reconcile_all, `routers/load_test.py` lookups; global unique indexes (`customer_code`, `booking_number`, `receipt_number`, `demand_number`, `construction_stages.name`, `users.email`, counters) | Phase 2 multi-company | open (Phase 2) |
| CRB-5 | low | `routers/public.py:90` fallback never triggers (`[x] or ft_ids`) | Fix expression | open |
| CRB-6 | low | `routers/graph.py:36` useless if/else; import ordering I001 ×71; `utils.py:258` NaN check needs comment | ruff autofix + comment | open |
| CRB-7 | low | Blind `except` ×48, `except: pass` ×19, `open()` without context ×65 (review backup path in `routers/admin.py`) | Narrow exceptions, log, use context managers | open |
| CRB-8 | gap | No frontend behavioural test harness (only Playwright screenshots) | Playwright smoke suite for top flows | open |

## Reviewer's top 10 by gain/effort
1 Prettier pass + gate · 2 delete unused ui/* · 3 one toast lib · 4 one button system · 5 drop alias shims · 6 delete SiteVisits default · 7 company_id defence-in-depth · 8 per-company counters + indexes · 9 public.py/graph.py fixes + import sort · 10 Playwright/RTL smoke suite.
