> **Update 2026-11-16 (fix round 1, tester iterations 1–3).** Demo refresh now keeps setup: `SETUP_COLLECTIONS` in `routers/admin.py` is the list a story refresh never touches (add new master/catalogue collections there — `tests/test_refresh_keeps_setup.py` fails on unclassified master-like collections). Flat/project/tower ids are stable across refreshes. Home ageing == Outstanding report (one function). Frontend dates only via `@/lib/businessDay`. Don't edit `backend/` (incl. `tools/`) while a refresh runs — uvicorn reloads and the run is marked `interrupted`. Tests needing bookable flats use `tests.flat_claims.own_flats` (own tower).
# KKT Constructions ERP — Handoff for a fork

> **Update 2026-11-16 (Phase 1 close-out, 4th fork, chunks 1–2).** HEAD after `9ba3e33 post fork init`. New since the 2026-11-15 block:
> - **Business day (REQ-60…66):** one helper, `services/clock.py`: `today()` / `today_iso()` = calendar day in the company time zone (`companies.time_zone`, default Asia/Kolkata, loaded at startup, `PATCH /settings/company`). Stored timestamps stay UTC; read their business date with `clock.day_of(ts)` and filter them by day with `day_start_utc` / `day_end_utc` / `day_range(d1, d2)`; user-entered instants go through `to_utc_iso`. The day changes at 00:00 IST; a date the user picks is kept. Guard `tests/test_business_day_guard.py` fails (file:line) on `now_iso()[:n]`, `date.today()`, `datetime.now(UTC).date()`, `*_at[:10]`, `+ "T23:59…"` in server code; frozen-clock tests (00:30 / 05:29 IST) `tests/test_business_day.py`. Rows written under an as-of carry `recorded_at` (real write time) so outbox health/sweep never treat them as stuck.
> - **Follow-ups due:** one cutoff everywhere (Home counts, dashboard, widgets, read model, `/leads?due_today`): `next_follow_up_at <= clock.day_end_utc()` (end of today IST). Story follow-up due 11:00 IST on the as-of day; `story_logic_check` fails "follow-ups due today is empty".
> - **Transfer money law (D1):** ledger replay (`services/ledger._Running`) starts from the agreement before the earliest change (revision **or** re-priced transfer) and applies a transfer's `after` agreement, so Σ Udhar − Σ Jama == Outstanding − Advance after revision + transfer. No transfer rule changed. Test `tests/test_transfer_money_law.py`.
> - **Demo refresh catch-up (D2):** on leader start after 03:00 IST, if no done refresh as of today and no scheduled/catch-up attempt today → one run, outcome `done (catch-up)`; same guards.
> - **Memory (D0):** `POST /api/admin/backup` streams collections (500-doc batches) into a temp-file zip and GridFS; download streams per chunk (was the whole DB in RAM: 4.8 GB spike, pod restarts). Test-suite flats: new tests claim flats via `tests/flat_claims.py` and cancel their bookings.
> - **Home greeting (D3):** date/greeting from `/dashboard/home` `business_day` / `business_hour`.
> - **Proof (chunk 2):** full pytest -n 2 738 passed / 6 skipped / 0 failed; ESLint 0/0; CI + normal build OK; smoke 0 console errors; perf `qa/perf/phase1_end.md`; tieout 118/118; integrity 0 findings; outstanding-v2 money law 78/78.
> - **Open:** full suite cgroup peak ~7.3–8.0 GB (mongod ~3.4 GB + one xdist worker ~1.4 GB + page cache) — run it alone; Reports FY range end is the browser date (same class as D3); Create booking p95 ~1.3 s (over budget at baseline too).

> **Update 2026-11-15 (Phase 1 close-out, after the fork).** The fork squashed history into one commit `ee3ccf8 post fork init`; SHAs below (a659a53, a289596 …) are history only. Close-out commits: `19005a0` docs · `568e469` not-due demo bills · `f2fc469` nightly demo refresh · `592374b` read-model as-of fix · `f753417` rebuild proof · `74b86eb` job_runs kept + test anchor fix (+ final docs commit). New since the text below:
> - **Not-due demo (F-44, REQ-46…50):** `tools/story_seed.py` completes SGH Tower C stages 50, 25 **and 6** days before the as-of date (real `POST /blocks/{id}/construction/stage`), and Tower C home-loan buyers book on a story-created plan "CLP home loan (45 days to pay)" (`/api/master/payment-plans`, per-instalment `due_days` = 45, the existing dues-engine rule). Result: Not due > ₹0 with bills due ≤ 30 days and > 30 days; every band non-empty; Towers B and C keep a next pending stage (Plastering) with bills to raise. `tools/story_logic_check.py` now also fails with `"<band> is empty"` and `"next billing stage is empty"` (`bands()`, `next_stage()`); conftest evaluates them on the snapshot **as of the story's own as-of date** (REQ-58).
> - **Nightly demo refresh (REQ-51…59):** `routers/demo_refresh.py`, 03:00 IST loop under the scheduler lease (`server.py` → `run_as_leader`). One rule: runs only when `DEMO_AUTO_REFRESH=true` **and** every public host this DB has served (`served_hosts`, recorded from `x-forwarded-host` by the observability middleware) is a demo host (`owner_bootstrap.demo_host_allowed`, same list as demo logins). Otherwise `disabled: …`; a running reseed / test snapshot (`/tmp/kkt_reseed.lock`, `/tmp/kkt_test_snapshot.lock`) → `skipped: …`. Flow: `tools.backup.backup_job` → `admin._reseed(story=True, as_of=today IST)` → REQ-37 verify (chronology + integrity + **tie-outs**, now part of every reseed) → `tools/demo_journeys.py`. Every attempt = one `job_runs` row `job=DEMO_REFRESH` with `outcome`. Run now: `POST /api/admin/demo-refresh/run` (`admin.demo_refresh.run`, Super Admin); status `GET /api/admin/demo-refresh`; card on Settings → System Health. The private test backend and the perf backend run with `DEMO_AUTO_REFRESH=false`.
> - **Reseed keep set** now `audit_logs, login_events, counters, served_hosts, job_runs`.
> - **Root fix:** the debounced read-model flush task copied the seeder request's `X-As-Of`, so project summaries / Home overdue could be computed as of a past date right after a story rebuild (`services/read_models._flush_later` resets the as-of).

Written 2026-11-13 at HEAD `a659a53`. Sources: `/app/memory/PRD.md` (phase log, newest first), `git log`, `/app/memory/qa/**` artefacts, `/app/memory/test_credentials.md`. Facts only; every "verified" claim names its evidence. Where something was never run, it says so.

---

## 0. Owner intent, distilled

The owner is an Indian builder (KKT Constructions, Patna). Repeated verdicts across phases ("complicated, mechanical, ugly; masters not connected; not dropdown-first") shaped these non-negotiables:

1. **Masters first, dropdown everything.** Every value a form needs comes from a master or catalogue (`/api/catalogues` bundle, 13 company masters in `/masters`, everything else under Admin → Advanced). Free text only where the fact is inherent (names, amounts, dates, remarks).
2. **One spine:** Project → Towers (from a Tower Template) → Floors (Floor Template per floor) → Flats (per-flat pricing sheet) → plans (Stage Plan Template + Payment Plan Template copied onto the tower) → Customer → Booking (pricing snapshot) → construction stage completion raises bills → payments (auto-allocated oldest-first) → ledger. Nothing lives outside this chain.
3. **Nothing pre-filled silently.** Areas, rates, prices, maintenance, GST %, hold expiry: explicit or `pending`. Type defaults are applied only on an explicit action (`apply-type-defaults`, "Yes, update from new type").
4. **Everything editable except what a booking locks.** Flat-level locking only (`STATUS_LOCKED` on Booked/Sold flats), never floor/tower-wide; project `code` locks while bookings exist (`CODE_LOCKED`). Every locked control shows the reason and a link.
5. **Money language:** Bill raised / Received / Balance (Udhar / Jama two-sided ledger), Roznamcha (cash day book) kept as a first-class page. Whole rupees for demands; paise internally.
6. **ERP only.** Marketing site and the Expo customer portal are archived (`/app/archive/*.zip`), their API routers parked behind `PUBLIC_SURFACES_ENABLED=false`.
7. **No random data.** Demo/story data is produced only by deterministic seeders through the real API; load-test lineage is tagged `load_test` and hidden from reports. Scratch/test records are removed through audited paths.
8. **No AI features for now.** `EMERGENT_LLM_KEY` is used only to initialise object storage; no LLM calls exist.

---

## 1. Environments & state

| Item | Value |
|---|---|
| Production domain | `https://billpe.com` (CORS allow-list in `backend/.env`; demo logins return `401 DEMO_LOGIN_DISABLED` on that host). **Nothing has been load-tested or reseeded on production.** |
| Preview | `https://kkt-reports-hub--7kz2bq77.preview.emergentagent.com` (frontend `.env` `REACT_APP_BACKEND_URL`), preview DB per `backend/.env` `DB_NAME`. |
| HEAD | `a659a53` — "tests: mark pagination lossless walkers load_sensitive". Previous milestones: `cbc9806` (CR-4 close), `bf12a24` (index-collision fix), `617c3b4` (deploy check), `a31c346` (S3 follow-ups). 272 commits. |
| `/api/health` | `{"status":"ok","db":"ok","build":"a659a53","version":"11.0.0","transaction_mode":"ordered-writes+compensation"}` — `build` = git short sha (env `BUILD_SHA` → `git rev-parse` → `unknown`). |
| Tests | ~98 test files, 718 collected. **Phase 1 close (2026-11-14): 3 consecutive `python -m pytest -n 2` runs, 712 passed / 6 skipped / 0 failed each** (`memory/qa/phase1/pytest_final_run{1,2,3}.log`). Every earlier flake was fixed at the root (`memory/qa/phase1/step8_fixes.md`): report/payment-total caches now invalidate on money events, trends serve from source while a flush is pending, a reseed is no longer cancelled by the 60 s timeout, `load_sensitive` covers two-read tie-outs, and booking tests claim flats across workers. The suite runs against a snapshot DB `kkt_test` (conftest), never the preview DB. Conftest refuses to snapshot mid-rebuild. |
| Deployment agent | PASS at `3a2eef8` (CR-4) and `617c3b4`; not re-run after `cbc9806`/`a659a53` (changes since: frontend null-safety in 3 pages, one test marker). |
| Integrity | `GET /api/admin/integrity-report?fresh=true` → ok, 78 live bookings checked, 0 findings (2026-11-14, Phase 1 close). tieout 118/118, chronology 0, purge scan counts `{}`. |
| Backups | `/api/admin/backups` ≥ 1 archive, `warning=false`, GridFS `backup_files`; shared volume ~35 % used after housekeeping (was 90 %). |
| Archived surfaces | `/app/archive/kkt-marketing-site-20261025.zip`, `kkt-customer-portal-expo-20261025.zip`, `deploy-assets-20261025.zip`. Their routers (`routers/public.py`, `routers/portal.py`, visits public routes) still exist but 404 via middleware unless `PUBLIC_SURFACES_ENABLED=true`. |
| Static build note | Preview serves the **production build** (`frontend/scripts/dev.js`, `PREVIEW_MODE=production`, SPA fallback) — a code change is visible only after `cd /app/frontend && yarn build`. Hot reload applies to the backend only. `/erp/*` → 301 to root. |
| Supervisor | backend `uvicorn --reload --workers 1` on :8001 (dev); production recommendation in PRD Phase 11A: `WEB_CONCURRENCY = 2×CPU`, Redis (`REDIS_URL`), Mongo replica set. |
| Owner account | Env-driven idempotent bootstrap (`OWNER_BOOTSTRAP_*` in `backend/.env`); demo users `is_demo=true`, host-gated. Credentials: `/app/memory/test_credentials.md`. |

---

## 2. Stack & architecture

- **Backend** FastAPI + Motor (`/app/backend`), all routes under `/api`, ORJSON, gzip, uvloop. **Frontend** React 19 CRA/CRACO + Tailwind + shadcn (`/app/frontend`), React Query, lazy route chunks. **DB** MongoDB standalone (no transactions → `uow.py` ordered-writes + compensation). **Object storage** Emergent/Tigris for files, documents, photos, KYC.
- **Layers:** `routers/` (HTTP adapters, `require()` guards) → `services/` (business logic, 50 modules) → `core/` (errors, money, jobs, rule_eval, types). **Guard:** `tests/test_import_hygiene.py` — no `routers.*` import anywhere under `services/` or `core/`, DFS cycle check over all imports (incl. function-level), `python -c "import server"` clean. Justified lazy imports use `importlib.import_module` with a one-line reason (`tools.backup.backup_job`, `tools.explain_audit.LIST_SORTS`, `services.documents.auto_register` from `dues_engine`).
- **Complexity gate:** `test_ruff_complexity_core_layers_15` (C901 ≤ 15 for services, core, events.py, migrate_phase7.py). ESLint: CRA config + craco rules, `no-nested-ternary: warn` for `src/pages/v2/**`, `complexity ≤ 20` on components/common; CLI run via `npx eslint --no-eslintrc -c .eslintrc.cli.cjs src` (plain `npx eslint src` lints nothing).
- **`services/definitions.py` is the single source of truth** for money meaning: `LIVE_BOOKING_STATUSES`, `OPEN_DEMAND_STATUSES`, `outstanding()` (= Σ_bucket max(0, raised − paid)), `advance()`, `two_sided()`, `net_balance()`, `ageing_bands()` (Not due / 0-30 / 31-60 / 61-90 / 90+), cancellation `deduction_for()`, `refund_payable()`. Home tiles, reports, dashboard snapshots, Customer 360 all call it; `tools/tieout.py` proves 96 tie-outs. Settings → Definitions page shows the same text.
- **Paise → ₹ rule:** integer `*_paise` in Mongo and arithmetic (`services/money.py`: `to_paise`, `pct_of` ROUND_HALF_UP, `rupees_whole`, `present_money` adds rupee twins, `amount_in_words`); API inputs are rupees; `flats.price_paise` is the only stored price; CSV exports map `*_paise` → `*_inr`; guard `tests/test_rupees_only.py`, `tests/test_whole_rupee.py`.
- **Auth:** JWT access (15 min, `aud: erp`) + rotating hashed refresh tokens (7 d, family reuse detection); browser session = refresh token in an httpOnly SameSite=Strict cookie scoped to `/api/auth` + readable CSRF double-submit cookie `kkt_csrf` / header `x-csrf-token` (`routers/auth.py`). Lockout 5/15 min, login 10/min/IP (Mongo-backed), TOTP MFA with admin policy, password history, `must_change_password`. Test-only rate-limit bypass header honoured only when `LOGIN_RATE_LIMIT_BYPASS_TOKEN` is in the *process* env.
- **RBAC:** 191 hierarchical codes `module.feature.action` (`permissions.py` + `route_perms.json`, generated by `tools/gen_route_perms.py`); `LEGACY_EXPANSION` maps coarse codes → specific sets; `services/rbac.py` = multi-role union ∪ allows − denies, Super Admin → all; `register_routes()` walks every guard at startup, unknown code = test failure (`test_rbac*`). `security/permission_matrix.json` regenerated on route changes. Project scope → 404 outside scope.
- **Audit = outbox:** every mutation writes an immutable `audit_logs` row with before/after + `changed_fields` (`services/audit_diff.py`, PAN/Aadhaar/bank masked); the row doubles as the outbox (`propagated`, 44-event registry) driving cache invalidation, read-model refresh, notifications, Journey panel ("Where this entry went"), reconciliation sweep `/api/admin/propagation`. Monthly archive to `audit_logs_archive` (never deletes).
- **Idempotency:** `Idempotency-Key` required on `POST /payments` (428 before body validation), 24 h replay = identical response; counters via `next_number()`; optimistic `version` on every doc (409 `VERSION_CONFLICT`); atomic bucket caps via guarded `$inc` (`reserve_cap`).
- **Messaging:** `services/messaging/` — `messages` collection with closed status vocabulary; Email adapter = Emergent-managed Resend proxy (sent once for real); WhatsApp/SMS adapters are interface-only (`not_configured`). Overdue reminders 7/15/30 d + 45 d escalation under the scheduler leader lease.
- **Background jobs:** single leader via Mongo lease (`services/leader.py`), `job_runs` isolation: dues engine (daily 00:30 IST), hold-expiry sweep (15 min), read-model flush/sweep, overdue reminders, integrity nightly, audit archive monthly, nightly backup (`tools/backup.py`, retention `BACKUP_KEEP_PER_DB` etc.).
- **Backups:** `POST /api/admin/backup` → zip of JSON per collection (+manifest) in GridFS, 15-min tokenised download, nightly job with preflight (prune, free-disk floor). Restore steps in PRD Phase 4 and §8.
- **Read models:** `project_summaries`, `block_summaries`, `customer_summaries`, `dashboard_snapshots`, `monthly_buckets` (trends) — event-bus dirty → debounced refresh; `X-Data-Age` header; `POST /admin/recompute-read-models`.
- **Startup:** lifespan fast path → `ensure_indexes` (recognises equivalent indexes by key+options), validators, idempotent seeds/migrations (`migrate_phase7`, `seed_s1_templates`, `migrate_templates`, `migrate_saleable`, `backfill_demand_installments`, `dedupe_charge_heads`…), owner bootstrap, integrity log. Gate `tests/test_startup_s1_s3_idempotent.py` (start twice on a DB copy: nothing dropped/shrunk, sums unchanged).

---

## 3. Domain model & canonical rules

**Flat pricing (PS phases):** one area field `saleable_sqft` (legacy `super_builtup_sqft` DB-only alias); `pricing_mode` = `rate` (`rate_per_sqft × saleable` [+ floor rise if project enables] with project rounding) or `lump_sum`; `pricing_status` = `ready | pending | review` (review = type changed on a priced flat → explicit Keep values / Apply type defaults); `maintenance {method per_sqft_months|fixed|none, rate, months, fixed_amount}`; parking slots attach 0–N per flat with own price (`parking_slots.flat_id`, status `Attached`). Real `status` ∈ Available/Hold/Blocked/Booked/Sold/Not for sale; `display_state` (Show as Available/Sold/Hold/Hidden) for the masking layer. Project Pricing Setup: default agreement GST %, enabled charge heads with overrides, maintenance defaults, floor-rise toggle, rounding.

**Templates (S1):** Floor Templates (`floor_plan_templates`), Tower Templates (floors, floor_start, numbering, `floor_map` ranges, refuge/podium, default stage + payment templates), Stage Plan Templates (ordered `stage_ids`, `Booking` pseudo-stage auto-completes on booking), Payment Plan Templates (instalments `on_booking | stage | on_possession | days_after_booking`, exactly 100 %; `on_possession` = last stage when none is flagged). Appliers copy onto the tower (`towers-from-template`, `floors/{n}/apply-template` on unbooked flats only, `apply-stage-plan-template`, `apply-payment-plan-template` → 422 `MISSING_STAGES`). Tower copies stay editable; templates never change retroactively. Seeded templates always carry a compatible default payment plan; a failing attach is a visible dialog warning, never silent.

**Booking pricing snapshot (`booking.pricing`, `services/breakdown.py`):** `{version, agreement_value_paise, agreement_gst_percent, agreement_gst_paise, charges[] {line_id, name, code, calc, base, source, amount_paise, gst_percent, gst_paise, total_paise, demand_at}, additional_charges_total_paise, gst_total_paise, total_final_value_paise}`. Agreement GST is an `other_charges` line coded `AGR_GST` demanded proportionally with stages; stage increments are attributed per stage in `demand_history` so undo unwinds exactly. Pre-listed lines = project-enabled heads + one `PARKING` line per attached slot (`source=parking:<id>`) + `MAINT` from the flat's method. Cash/Account split must equal agreement (422). After creation, pricing changes only via agreement revision (re-proportions unpaid demands, telescoped so Σ demands = cum % × new agreement).

**Ledger semantics (`services/ledger.py`, rebuilt per booking after every mutation):** rows carry `udhar_paise / jama_paise / mode / instrument / tag / balance_paise` and per-bucket splits; Σ Udhar − Σ Jama == outstanding − advance (tie-out #30); demand status FIFO-derived per bucket; `paid_parts {cash_paid/open, account_paid/open}` + `paid_detail` text ("Cash part paid · Account ₹1,83,750 open"); REVERSAL/REFUND/TRANSFER/CANCELLATION/AGREEMENT_CHANGE rows re-base Udhar. Reversed receipts are corrections in Roznamcha (excluded on their own date). Refund = cancellation preview maths; nil refund → Forfeited.

**Auto allocation (S3, `services/allocation.py`):** `allocation: auto` applies one receipt oldest-open-bill-first across *all* open bills of the booking (plan instalments per bucket + demanded charge lines incl. GST lines); instalment share bucket = Cash for cash mode else Account; charge lines always Account; remainder → `ADVANCE`. Receipt stores `allocations[]`; ledger explodes one row per allocation; reversal/bounce/cancel undo every allocation; `POST /payments/allocation-preview` returns exactly what posting would do (UI shows the server list); receipt PDF has an "Applied to" table; manual mode = single target, unchanged.

**Inventory masking (Phase N):** viewers without `inventory.real_status.view` receive `display_state` *as* `status`, Hidden flats are dropped, masked Available flats carry the identical key set as real Sold flats (asserted). Allocation Category master (only Builder saleable is bookable), Hold Reason master, holds need a mandatory expiry, 15-min expiry sweep. `bookable_for` guards wizard + `POST /bookings` (`FLAT_NOT_SALEABLE`).

**Locking:** `STATUS_LOCKED` (409) on flat PATCH/delete/renumber when `status ∈ {Booked,Sold} ∨ booking_id`; floor/structure deletes are guarded in the write predicate and report `kept_locked`; parking allotment = guarded `update_many` with `modified_count` check inside the UoW → 409 `PARKING_NOT_AVAILABLE` on race; `CODE_LOCKED` on project code with bookings; stage undo blocked only when a demand from that stage was paid by a payment dated on/after it (`UNDO_BLOCKED_BY_PAYMENTS`); `change-plan` blocked once any instalment is paid.

**Statuses:** bookings Active/Completed/Cancelled; demands Open/Partially Paid/Paid/Cancelled/Void; payments Cleared/Pending/Bounced/Reversed; refunds Pending/Paid/Forfeited; leads New→…→Converted|Lost.

---

## 4. Module table — what exists and how it was verified

| Module | Key files | Verification evidence |
|---|---|---|
| Auth, MFA, sessions, owner bootstrap, demo host gating | `routers/auth.py`, `services/owner_bootstrap.py`, `deps.py` | `tests/test_owner_bootstrap.py` (5), MFA fix in 8B, testing-agent iterations 2, 20 |
| RBAC (191 codes), access-control UI, audit history + archive | `permissions.py`, `route_perms.json`, `services/rbac.py`, `services/audit_diff.py`, `services/audit_archive.py`, `pages/admin/*` | `tests/test_rbac_granular.py`, `test_rbac*`, `test_frontend_guard_scan.py`, `test_audit_archive.py`; suite 454/0 on `kkt_test` (Phase R); screenshots `qa/rbac/` |
| Masters hub (13) + Admin → Advanced + catalogues | `pages/masters/MastersHub.jsx`, `pages/admin/AdminAdvanced.jsx`, `routers/master.py`, `masters_plus.py`, `catalogues.py` | `tests/test_phase_s1_templates.py` (incl. wording guard), `test_phase_11a.py`; screenshots `qa/phase_s1/` |
| Templates (floor/tower/stage/payment) + appliers | `routers/templates.py`, `components/project/{StructureTab,PlansTab,TowerDialog,ProjectDialog}.jsx` | `test_phase_s1_templates.py`, `test_tower_from_template_never_silent_about_payment_plans`; S1 screenshots |
| Project page (Structure / Plans / Pricing / Inventory / Collections / Reports tabs) | `pages/v2/ProjectWorkspace.jsx`, `routers/project_setup.py`, `pricing.py`, `structure.py` | `test_phase_ps_pricing.py`, `test_phase_ps_*`; screenshots `qa/phase_ps/01–10` |
| Flat pricing sheet, floor designer, tower structure editor, bulk edit, parking attach | `components/flatdrawer/FlatPricingSheet.jsx`, `components/structure/*`, `routers/pricing.py`, `parking.py` | CR-3 regression tests (`5b3bba0`), `test_phase_ps_pricing.py` |
| Inventory control (categories, holds, blocks, display layer, masked reports) | `services/inventory.py`, `routers/inventory.py`, `reports_n.py`, `components/common/InventoryActions.jsx` | `tests/test_phase_n_inventory.py`, `test_phase_n_reports.py`; screenshots `qa/inventory/` |
| Customers + Customer 360 (inline edit, KYC encrypted/masked, profile catalogues, timeline, portal card) | `routers/customers.py`, `crm.py`, `pages/v2/Customer360.jsx`, `CustomerBits.jsx` | `test_phase_11a.py`, `test_phase_p*.py`; iteration_28 |
| Leads & site visits (kanban, undo, visits calendar) | `routers/leads.py`, `visits.py`, `pages/v2/Leads.jsx` | `test_phase_9.py` (7), iteration_28 undo proof |
| Booking wizard (3 steps) + booking detail (ledger, demands, payments, documents, revisions, transfer, cancel, agreement-signed) | `pages/BookingWizard.jsx`, `routers/bookings.py`, `components/common/BookingOps.jsx`, `BreakdownCard.jsx` | `test_phase_s2_*`, `test_phase_s3_allocation.py`, S2 screenshots `qa/phase_s2/booking_step1–3`; iteration 29 |
| Payments (5-field post, auto/manual allocation, clear/bounce/reverse, cheques register, refunds payout) | `components/v2/PostPayment.jsx`, `routers/payments.py`, `services/allocation.py`, `ledger.py` | `test_phase_s3_allocation.py` (2), `test_get_payment_includes_allocations_and_partial_detail`, S2 payment screenshots; root independently verified preview == payment == PDF; reversal exact |
| Construction update (stage complete/undo, preview, photos) + dues engine | `routers/construction.py`, `services/dues_engine.py`, `components/common/ConstructionPhotos.jsx` | `test_phase_7.py` (20), integrity hardening proofs, story step 7 |
| Demand Register, Project Statement, Documents register (auto-registered letters, VOID stamping) | `routers/demand_register.py`, `project_statement.py`, `docgen.py`, `services/documents.py`, `pdf_builders.py` | `test_phase_p*.py`, S3 story steps 5/7/9 (`qa/phase_s3/story.md`, `09_documents_void.jpeg`) |
| Roznamcha (opening cash, contra, refunds, reversals) | `routers/roznamcha.py`, page under `/roznamcha` | Phase G.1 proof (closing ₹2,24,75,000 screenshot 20), redirect fix `617c3b4` |
| Reports hub (14 legacy + Phase I v2 reports, JSON/CSV/PDF, ETag, presets) | `routers/reports.py`, `reports_i.py`, `reports_n.py` | `tools/tieout.py` 96/96, `tests/test_phase_i_reports.py`, `test_phase_4.py` |
| Home dashboard, widgets, trends sparklines | `routers/home.py`, `dashboard*.py`, `trends.py`, `pages/v2/Home.jsx` | tie-outs (Home == report == Σ summaries), `test_phase_q.py` (trends Σ == collections) |
| Messaging + reminders + VOID watermark | `services/messaging/*`, `routers/messaging.py`, `pages/v2/Messaging.jsx`, `services/pdf.py::watermark` | `tests/test_phase_q.py` (11); one real email sent (provider id recorded) |
| Documents/files/KYC (object storage, thumbnails, co-applicant KYC) | `routers/files.py`, `documents.py`, `services/kyc_files.py`, `thumbs.py` | Phase Z/J.2 tests, `test_erp_leak_scan.py` |
| Admin: System Health, propagation, integrity report/repair, backups, reseed, purge, load-test lineage | `routers/admin.py`, `ops.py`, `load_test.py`, `propagation.py`, `tools/backup.py` | `test_startup_s1_s3_idempotent.py`, `test_phase_l.py`, `test_index_snapshot.py`, integrity 0 findings |
| Import hygiene / complexity / wording / terminology guards | `tests/test_import_hygiene.py` (8), `test_ruff_*`, `test_phase_s2_wording.py`, `test_ledger_terminology.py`, `test_rupees_only.py`, `test_no_dynamic_exec.py` | all green in CR-4 run |

Independent tester reports: `/app/test_reports/iteration_*.json` (latest 29). Root (the orchestrating reviewer) independently verified S2 (sidebar, tabs, 3-step booking BK-2627-1554, payment, ledger) and S3 (allocation preview == payment == PDF, reversal).

---

## 5. Locked owner decisions (do not reopen without the owner)

1. ERP only; website + portal archived; company = KKT Constructions, receipts `KKT/FY/NNNNN`, bookings `BK-FY-NNNN`.
2. Masters hub = exactly 13 company-level masters; everything else under Admin → Advanced.
3. Nav = Home · Projects · Customers · Bookings · Payments (Received · Bills raised · Roznamcha) · Construction · Documents · Reports · Masters · Admin.
4. Booking wizard = exactly 3 steps (Who · Price & Plan · Confirm). "Plan accepted via" moved to the booking page action "Mark agreement signed".
5. Payment sheet = 5 primary fields; auto allocation by default, "Change" for manual.
6. Wording: no internal words on user pages (override / pricing_status / readiness / propagation / outbox / v{n} / legacy / Journey) — guarded by tests. "Saleable area" is the only area term. Display status = "Show to sales as"; allocation category = "Owner share".
7. One outstanding number everywhere, bucket-capped (`definitions.outstanding`); ageing from `ageing_bands` only.
8. Whole-rupee demands; last line absorbs remainders.
9. Flat-level locking only; project code locks with bookings; towers/floors never lock wholesale.
10. Nothing pre-filled; type defaults only on explicit action; hold expiry mandatory with no default.
11. Catalogue system items are never deleted, only deactivated; audit rows are never deleted (archived).
12. `CORS_ORIGINS` is an explicit allow-list (never wildcard + credentials); the deployment agent's standing note about it is intentional.
13. Demo logins disabled on non-preview hosts; owner account from env only, never in docs.
14. Load-test lineage (`load_test=true`) is hidden from every report/dashboard and purged only via `/api/admin/load-test/purge`.

---

## 6. Honest assessment of weaknesses

- **Late consolidation.** S1–S3 (2026-11-13) rebuilt the spine on top of ~30 earlier phases; the codebase carries both generations (e.g. `components/common/PaymentDialog.jsx` rewritten in S2 but the live sheet is `components/v2/PostPayment.jsx`; `LegacyPlanForms.jsx` kept only for wizard QuickCreate; legacy `/api/blocks/{id}/milestones*` aliases; hidden legacy reports whose endpoints remain). Redirect lists are long. Expect dead code.
- **Story proof is API-driven.** `tools/story_s3.py` exercised the 10-step owner story through the same endpoints the UI calls and took Playwright screenshots after each state — it did **not** click through every form. Several S2/S3 UI flows (3-step wizard, payment sheet) were verified by the testing agent and root, but a human click-through of the full story has not happened.
- **Dashboard/trends cash-vs-account split is receipt-level** (mode-derived category), not allocation-level. For split receipts the ledger/demands/register are exact; the Home/trends split is the physical cash position. Documented caveat, not fixed.
- **`paid_parts` backfill pending.** `paid_parts`/`paid_detail` are produced by `ledger.rebuild`; bookings not rebuilt since `a31c346` lack them until their next mutation or `POST /api/admin/reconcile-ledgers`. No one-off backfill was run on preview or production.
- **Messaging providers unconfigured.** Email = managed Resend proxy without attachments (PDFs go as 7-day signed links); no `RESEND_WEBHOOK_SECRET` → statuses stop at `sent`; WhatsApp/SMS adapters are stubs returning `not_configured`.
- **No production load result.** Journey load tool dry-ran on preview only (20–50 VUs; `qa/loadtest/README.md`). The 2000-VU ramp has never run anywhere; sandbox saturates at ~250 rps for *any* HTTP server (pod network limit, PRD 11A). Capacity model is extrapolated.
- **Test flakiness under `-n 2`.** Shared `kkt_test` DB + xdist: `test_register_overdue…` still flakes because module/session fixtures of the other worker write outside the per-test lock; `test_fuzz_walker::test_write_routes_never_500` has hit connection timeouts under load. Treat a single flake as suspect only if it fails serially.
- **Standalone Mongo.** No transactions; compensation logic in `uow.py`; rate limits / idempotency / caches are Mongo-backed and per-process unless `REDIS_URL` is set.
- **Deployment agent not re-run** after the last two commits (small, frontend-only + test marker), and `yarn build` state on preview should be confirmed before publishing.
- **Leftovers kept as history:** customer CUST-2627-0085 "Load Test" (inactive, tag `phase_l_leftover_retained_history`) with cancelled booking BK-2627-0030 in SGH; lead "Load Test" (Lost — leads have no archive); stage plan `qa-plan` + stage `QA Terrace Slab` (where-used guard); tester project "Elite"; cancelled S3 scratch booking + archived project CADB.
- **Not built:** Redis-backed shared caches, scheduled emailed reports, CMS logo → PDF letterhead, booking receipts paging, e-sign, multi-tenancy switch, Playwright coverage for hold-expiry notifications.

---

## 7. Backlog (priority order)

1. **Publish** — build + deploy HEAD to billpe.com; verify `/api/health.build == sha`, login, Home tiles, one receipt PDF (runbook §8.1).
2. **Production reseed** — only after the owner's written "GO": snapshot → `POST /api/admin/reseed {"confirm":"RESEED","story":true,"as_of":…}` → status poll → integrity + tie-out + pre/post deltas (`qa/loadtest/README.md` §2).
3. **Journey load test on production** — separate generator host, bypass token in the API *process* env for the window only, stages 50→2000, cleanup + purge, remove token (`tools/loadtest_journeys.py`).
4. **Click-through story proof** — a human or Playwright form-by-form pass of the 10 steps in `qa/phase_s3/story.md`, replacing the API-driven driver's evidence.
5. ~~Allocation-level cash split~~ **done in Phase 1** (F-3/F-4): Home, trends, dashboard and reports use `definitions.receipt_split` (allocation parts); `paid_parts` backfilled and idempotent.
6. **Reports pruning** — remove hidden legacy report endpoints + their tests once the v2 set is confirmed sufficient by the owner.
7. **Messaging config** — WhatsApp/SMS provider choice + keys via the secrets tool, `RESEND_WEBHOOK_SECRET`, attachment strategy.
8. **Backups schedule** — confirm nightly job runs on production leader, retention env values, off-box copy (currently GridFS in the same Mongo), restore drill (`tools/restore_drill.py`).
9. ~~Fixture-level `load_sensitive` locking~~ done (conftest `pytest_fixture_setup` shared lock; Phase 1 Step 8). Still open: lead archive action; hard-purge option for cancelled test bookings.
10. **Phase 2** (design system + Home Command Center) — not started; orchestrator runs the Phase 1 e2e journeys + code review first.

---

## 8. Runbooks

**8.1 Publish / verify build**
```
cd /app/frontend && yarn build                      # preview serves the build; CI=true for warnings-as-errors
cd /app && git status --short && git log --oneline -1
curl -s $REACT_APP_BACKEND_URL/api/health | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['status'],d['build'])"
```
Build sha must equal HEAD. Set `BUILD_SHA` in the production process env if `git` is absent there.

**8.2 Readiness gates (run all before a release)**
```
cd /app/backend && python -m pytest -n 2 -q -p no:cacheprovider          # expect 0 failed; rerun flakes serially
python -m pytest tests/test_import_hygiene.py tests/test_startup_s1_s3_idempotent.py -q
ruff check --select C901,F821,F823,E711,E712 services core events.py migrate_phase7.py
cd /app/frontend && npx eslint --no-eslintrc -c .eslintrc.cli.cjs src    # 0 errors / 0 warnings
cd /app && git archive HEAD | tar -x -C /tmp/cleanroom && (cd /tmp/cleanroom/frontend && yarn install --frozen-lockfile && CI=true yarn build)
```
Then the deployment agent; then `GET /api/admin/integrity-report?refresh=1` (ok, 0 findings), `python -m tools.tieout` (all ties), `/api/admin/propagation` (0 unpropagated).

**8.3 Reseed (preview or production — Super Admin, irreversible)**
Snapshot `/api/health`, `/api/dashboard/home`, `/api/reports/outstanding`, `/api/admin/backups` → take a backup → `POST /api/admin/reseed {"confirm":"RESEED","story":true,"as_of":"YYYY-MM-DD"}` → poll `GET /api/admin/reseed/status` until `done` → integrity report, `tools/tieout.py`, `tests/test_story_headline.py` against the target. Preserves audit logs, company, users/roles, masters, projects/towers/flats, plans. Production: owner's written GO first.

**8.4 Backups**
`POST /api/admin/backup?include_sensitive=false` → `GET /api/admin/backups` (expect `warning=false`) → download via 15-min token. Nightly job (`tools/backup.py`) prunes by `BACKUP_KEEP_PER_DB`/`BACKUP_MAX_TOTAL_MB`/`BACKUP_MIN_FREE_PCT`. Restore: unzip, `mongoimport --jsonArray --drop --db $DB_NAME --collection <name> <name>.json` per file, then `POST /api/admin/recompute-counters`, `/api/admin/reconcile-ledgers`, `/api/admin/recompute-read-models`. Drill script: `tools/restore_drill.py`.

**8.5 Purge test lineage**
Tag records `tags: ["load_test"]` (customers via PATCH; projects via `load_test=true`) → `GET /api/admin/load-test/lineage` (must show `foreign_bookings: 0`) → `POST /api/admin/load-test/purge {"confirm":"PURGE","dry_run":true}` → review → `dry_run:false`. Refuses if any non-loadtest lineage would be touched; cancel bookings through the audited cancel API first. Scratch DBs: drop only names matching `*_scratch`, `*_lt_*`, `kkt_scale`, `kkt_volume`, `test_database_*`; never the preview DB or `kkt_test`.

**8.6 Disk housekeeping (preview)**
Drop scratch DBs (above), truncate `/var/log/*` > 50 MB, clear yarn/pip caches and stale `/root/.venv*`, `/root/.npm`, old `frontend/build` copies. Target < 70 % used; then take a backup.

---

## 9. Key files map

```
backend/
  server.py               app, lifespan, middleware, startup phases, _build_sha
  db.py                   Motor client, ensure_indexes (key-equivalent recognition), validators
  deps.py / utils.py      auth deps, require(), ApiError, paginate (keyset cursor), write_audit
  permissions.py          191 codes, LEGACY_EXPANSION, PERMISSION_META; route_perms.json; security/permission_matrix.json
  events.py               event bus, snapshot/surface subscribers
  uow.py                  ordered-writes + compensation unit of work
  migrate_phase7.py       stages/plans/demands migration (idempotent)
  services/
    definitions.py        money meanings (THE source of truth)       money.py / money_ops.py  paise helpers
    ledger.py / ledgers.py  rebuild, two-sided rows, paid_parts       allocation.py            oldest-first auto allocation
    breakdown.py          booking pricing snapshot, AGR_GST           dues_engine.py           instalment raising
    pricing.py            saleable/rate/lump-sum, migrate_saleable    inventory.py             display layer masking
    documents.py          registration, numbering, VOID, auto_register pdf_builders.py / pdf.py  branded PDFs, watermark
    integrity.py / invariants.py  integrity report/repair             read_models.py / trends.py  summaries, monthly buckets
    rbac.py / audit_diff.py / audit_archive.py                        messaging/ (outbox, adapters, templates)
    leader.py / jobs → core/jobs.py  scheduler lease, job_runs        cache.py / ttlcache.py   Redis-or-Mongo caches
  routers/                one file per module (bookings, payments, templates, pricing, structure, demand_register,
                          project_statement, docgen, reports*, roznamcha, admin, load_test, …)
  tools/                  backup.py, story_s3.py, story_seed.py, loadtest_journeys.py, tieout.py, prod_reseed.py,
                          restore_drill.py, gen_route_perms.py, index_snapshot.py, startup_idempotency_check.sh
  tests/                  conftest.py (kkt_test snapshot DB, load_sensitive flock), 97 files; RETIRED_TESTS.md
  docs/                   index_snapshot.json, build_docs_pdf.py
frontend/src/
  apps/erp/ErpApp.jsx     routes + redirects              components/layout/{AppShell,SectionTabs}.jsx  nav (9 areas)
  pages/v2/*              Home, Projects, ProjectWorkspace, Customers, Customer360, Bookings, Payments, Demands,
                          Documents, Messaging, Leads, Catalogues
  pages/BookingWizard.jsx 3 steps                         components/v2/PostPayment.jsx   5-field payment sheet
  pages/masters/*         MastersHub + template editors   pages/admin/*                   Advanced, access control, audit
  components/project/*    StructureTab, PlansTab, TowerDialog, ProjectDialog
  components/structure/*  FloorDesigner, TowerStructureEditor, BulkEditBar
  components/flatdrawer/* FlatPricingSheet, …             components/common/*             BreakdownCard, BookingOps, DataTable…
  lib/api.js, lib/branch.js (pick/branch), lib/formErrors.jsx, hooks/useBookingDraft.js
  .eslintrc.cli.cjs       CLI lint config mirroring CRA   scripts/dev.js, scripts/build.js
memory/
  PRD.md                  phase log (newest first)        test_credentials.md   logins (owner creds are env-only)
  qa/phase_s1|s2|s3/      screenshots + story.md          qa/loadtest/README.md load-test + prod reseed runbook
  qa/journey|reports|rbac|inventory|phase_ps|…  per-phase proofs
archive/                  marketing site, Expo portal, deploy assets (zips)
```

---

## 10. Rules for the next agent

1. **No destructive git.** Never `git checkout -- <dir>`, `reset --hard`, or force-push (Phase R.1 lost 34 routers that way). Commit per section with a descriptive message; `git status --short` must be clean before reporting.
2. **Caveats first** in every report; say "not verified" when you could not verify. Never describe a flaky run as green.
3. **Permissions:** add every new route with a specific `require("module.feature.action")`, register the code in `permissions.py`/`route_perms.json`, extend `LEGACY_EXPANSION` for the coarse code, regenerate `security/permission_matrix.json` and the OpenAPI snapshot; `test_rbac*` will fail otherwise.
4. **Money:** paise ints, `definitions.py` for meanings, `money.pct_of`/`rupees_whole` for rounding, rebuild the ledger after any booking/demand/payment mutation. Never compute outstanding ad hoc.
5. **No silent defaults** in product code or data: no pre-filled areas/rates/GST/expiry; failures surface as 4xx with a code from `errors.py` and a visible UI message.
6. **Guard tests are law:** import hygiene (no `routers.*` in services/core), C901 ≤ 15, wording/terminology scans, rupees-only, index snapshot, no dynamic exec, startup idempotency, pagination lossless. Fix the code, not the test, unless the owner changed the rule.
7. **Frontend:** `yarn` only (never npm); `yarn build` after changes because preview serves the static build; `data-testid` on every interactive/critical element; use `pick`/`branch` instead of nested ternaries in `pages/v2`; memo calls above early returns.
8. **Data hygiene:** create test data only through the API, tag it (`load_test` / QA names), remove via audited paths (cancel → purge); never touch the preview DB or `kkt_test` with raw drops; never the owner's anchor bookings.
9. **Secrets:** via the secrets tool only; never print or commit key values; `.env` edits only with the file tools (no heredoc).
10. **Before production actions** (reseed, load test, purge) obtain the owner's written GO and snapshot first; record pre/post in `memory/qa/`.
11. Update `memory/PRD.md` (newest section on top) and `memory/test_credentials.md` whenever behaviour or credentials change; keep this HANDOFF current at each phase close.
12. **Never use `#` as the sed delimiter when the replacement contains a `#` comment** (sed reads a trailing `w…` as write-to-file; that is how `backend/ritten by conftest…#` was created). Prefer the editor tools. Long suite runs: launch detached (`setsid … < /dev/null &`), because a tool timeout kills a plain background job.
13. Tests that book a flat must take it via `tests/flat_claims.claim_flat()`. Tests that need to cancel a booking must cancel one they created. Money tests use the `work_booking` fixture (a snapshot `story:ontime` booking). Never cancel or post against a role-tagged story anchor.

## Phase 1 close-out rounds 2–4 (2026-11-16)
- F2: Hold expiry mandatory on every Hold path (flat status, tower bulk-status, transfer old unit, inventory hold) → 422 "Hold expiry is required"; UI "Hold until".
- F3: restore-drill test streams mongodump→mongorestore (worker 1.9 GB → <0.3 GB); opt-in per-test RSS hook `PYTEST_RSS_LOG=<dir>`.
- G1: hold-reasons / allocation-categories master lists; no MASTERS[0] fallback; link registry test.
- H1: `dues_engine.schedules_for` (batched) for upcoming-dues + Home widget. H2: SiteVisits business-day calendar math.
- K1: Upcoming dues report via `reportsMeta.ROW_ADAPTERS` + 30/90/365 selector; `tests/test_reports_contract.py`. K2: templates heading, Masters breadcrumbs.
- Tester-owned `backend/e1_tests/` is excluded from pytest collection, ruff and every repo scan (format, credentials, dynamic-exec, static gates, imports, business-day).
- Preview runs production-mode and serves `frontend/build` → rebuild after every frontend change: `cd frontend && GENERATE_SOURCEMAP=false NODE_OPTIONS=--max-old-space-size=2048 node scripts/dev.js --build-only`.
- Closing proof: full `pytest -n 2` run 6 — 760 passed, 6 skipped, 0 failed (`memory/qa/phase1/pytest_final2_run6.log`).

## Phase 2 chunk 2A (2026-11-16)
- Connection matrix: `tools/connection_matrix.py` (21 actions × 22 surfaces) runs in the default pytest run via `tests/test_connection_matrix.py` (load_sensitive, private test copy) → `memory/qa/phase2/connection_matrix.md`. Add new actions/surfaces there.
- After-commit queue `services/after_commit.py`: audit surface snapshots + auto PDFs run after the response (coalesced per request). Whole-company tests: mark `load_sensitive` (the lock drains the queue via `POST /api/admin/ops/after-commit/drain`).
- Server-Timing spans: `core.timing.span()` / `Laps`; `tools/perf_budget.py --only create-booking` prints them.
- Read-model flush invalidates `home:`/`dash:`/`boot:` caches after rebuilding.
- `POST /api/inventory/holds/expire-sweep` runs the hold-expiry sweep now.

## Phase 2 delivered (2026-11-16) — 2B/2C shell + themes, 2D Home Command Center, fix rounds P2-1, P2-2
- **Home** = 11 role-aware widgets from `GET /api/home/bundle` (`routers/home_defs.py`, shared list filters `services/home_filters.py`, layout `routers/home_layout.py`). Every figure has `drill.to` (+`via=home`) and `drill.api/pick`; `tests/test_home_bundle.py` + tieout prove list total == figure. The shell (`components/common/HomeDrillBar.jsx`) shows "Filtered from Home · Clear" on any `via=home` screen.
- **Client caches are per user** (`lib/session.js`): every react-query key carries the user id (`fetchKey`, `useList`), and `switchSession` on logout, login and restore wipes the query cache, bootstrap/catalogue memory, recents, drafts and IDB. Guard: `tests/test_session_isolation.py`; behaviour: `frontend/scripts/session_switch_e2e.py`.
- **Roznamcha** lists cash refunds and cash reversals; `cash_paid_out_paise` and opening + in − out = closing are shown on screen (matrix action "refund paid (cash)").
- **Lint**: `yarn lint` (same rules as the build, `--max-warnings 0`). Never pipe eslint into tail when reading its exit code.
- **Proof scripts** (need `KKT_DEMO_PASSWORD` in env): `frontend/scripts/{home_screens,axe_check,login_timing,session_switch_e2e}.py`.
- **Test infra**: the private test backend gets `ACCESS_TOKEN_MINUTES=60`. `claim_flat` skips `Own-*` towers. Integrity re-reads in-flight bookings before reporting an orphan bill.
- **Open**: when an Outstanding ageing band is selected, the report subtitle still shows the FY window; the Light/Night screenshots for 2D were taken before P2-1/P2-2 (UI unchanged apart from chips and the avatar palette).

## Phase 3 delivered (2026-11-17) — work screens, restyle, master audit, next step, reports hub, phone sweep, click-through
- **Work screens**: booking / Customer 360 / project = 5 tabs, one main action, More; actions + disabled reasons from `GET /api/bookings/{id}/actions` (`services/booking_rules.py`).
- **Master audit**: `memory/qa/phase3/master_audit.md` (13 masters + catalogues, Used in N, active switch, "changes apply to new entries only"). Removal candidates are with the owner — do not remove/deactivate anything without his answer.
- **Next step**: one shared prompt `components/common/NextStep.jsx` (`showNextStep`) after saves; map in PRD "Phase 3 delivered".
- **Reports hub** grouped by journey (`lib/reportsMeta.js`): Sales · Money · Construction · Inventory · Admin.
- **Gates**: phone sweep `frontend/scripts/phone_sweep.py <base>` (50 routes × Light/Night at 390), internal words `frontend/scripts/internal_words_scan.py <base>` + `internal_words_static.py`, click-through `cd /app/tests_e2e/clickthrough && python -m pytest -q` (private copy, serial, never beside pytest), connection matrix `pytest tests/test_connection_matrix.py -n 0` (23 actions). Run heavy jobs one at a time. Avoid the IST midnight (18:30 UTC) during the matrix: "today" figures move.
- **Ledger law**: an Other-category REFUND rebases the other-charge Udhar (`services/ledger.py two_sided`); guard `tests/test_refund_other_law.py`.
- **Test-data lineage** (hard purge, `services/hard_purge.py TEST_RE`): whole word "QA", whole word "test" (any case; "TEST_T1" does NOT match, the underscore joins the word), "load test", "LT CLP", names starting "QSH", "S1ACC", "S1 Acceptance"; and bookings must sit in a test project/tower to be purged.
- **Open**: stage-complete preview shows the instalment bill but not the agreement-GST share raised with it (reported to root in 3-4); cancel with deduction 0 preview vs post (owner-locked); stage undo leaves auto letters; visit-slot settings for a project have no ERP screen (website tab not mounted).
