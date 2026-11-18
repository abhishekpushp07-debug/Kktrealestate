# Requirements: KKT ERP → world-class multi-company Real-Estate ERP

Existing app (FastAPI + React + MongoDB). Preview `https://kkt-reports-hub--7kz2bq77.preview.emergentagent.com`, production `https://billpe.com`.
Everything already built: `/app/memory/HANDOFF.md` (architecture, locked owner decisions §5, rules §10) and `/app/memory/PRD.md` (phase log, newest first). This file covers the work from this job onward; it does not restate what HANDOFF.md already fixes. Baseline code review: `phase1/code_review_baseline.md` (≈ 62/100, no critical/high; formatting + dead code + duplicate primitives drive the score).

## Core Value
One connected chain for an Indian builder — Masters → Project → Tower → Floors → Flats → Customer → Booking → construction raises bills → payments auto-adjust oldest bill first → ledger / Roznamcha / statements — where every number is correct and explainable everywhere, every entry completes its journey and shows up logically in reports, the screens are calm and uncluttered, and many builder companies can run on the same app with zero chance of seeing each other's data.

## Personas & Roles
| Persona | What they do |
|---|---|
| Platform Owner (the KKT owner) | Approves / rejects / suspends builder companies that sign up; records each company's plan and limits; sees only company-level facts (name, status, users, projects, usage), never another company's customers or money unless he is also a member of that company. |
| Company Super Admin (one or more per company) | Masters, branding, users, roles for their own company. |
| Company staff (Project Admin, Accounts, Sales, Site engineer, Employee, custom roles) | Daily work inside the currently selected company. Home shows the widgets for their role. |
| Multi-company user (e.g. a CA) | One login, member of several companies with different roles; switches company from the top bar. |
| New builder (prospect) | Signs up, verifies email, waits for approval, becomes that company's Super Admin. |
| Channel partner / broker (record, not a login) | Earns commission on bookings they bring. |

## Features
| id | Feature | Persona | Phase |
|---|---|---|---|
| F-1 | Readable code: whole frontend + backend auto-formatted; a format check gate keeps it that way | Owner (quality) | 1 |
| F-2 | One set of UI building blocks: unused UI files deleted; one button, one toast, one stat tile; dead page and low review findings fixed | Owner (quality) | 1 |
| F-3 | Cash vs Account split on Home / trends / reports / booking summary computed from each receipt's actual allocations through one shared function | Owner, Accounts | 1 |
| F-4 | Every historical bill shows its part-paid detail (one-time backfill) | Accounts | 1 |
| F-5 | All test data permanently removed (dry-run first, refuses real data, audit row kept) | Owner | 1 |
| F-6 | Fresh KKT demo rebuilt as complete, logical, dated journeys up to today, entered through the same API the screens use, with a journey guide and a chronology check | Owner | 1 |
| F-7 | Automated test suite deterministic under parallel runs | Owner (trust) | 1 |
| F-8 | Code review re-run after cleanup (target ≥ 78/100, estimate) | Owner | 1 |
| F-9 | New design system "Calm Light" + a Night mode switch remembered per user; brand accent is one themable token | All | 2 |
| F-10 | New app shell: light collapsible sidebar, top bar with ⌘K search, New, notifications, profile, theme switch | All | 2 |
| F-11 | Home "Command Center" with 11 widgets: Money today · This month due vs received · Overdue by age · Call today · Next 30 days inflow · Next billing milestone · Inventory by tower · Flat status · Construction progress · Sales pipeline · Needs attention | Owner, staff | 2 |
| F-12 | Home period (Today / This month / FY) + project filter; role-based default layouts; Customize kept; no empty ₹0 tiles; every number opens the list that adds up to it | Owner, staff | 2 |
| F-42 | **Connection proof** (owner, 2026-11-14: "the logics were great; what was not great was the connection — features were not talking properly to each other"): a committed, automated connection matrix. For every owner action (create booking, post payment cash/cheque/online, cheque clear, bounce, reversal, stage complete → bills, stage undo, cancel → refund/forfeit, transfer, agreement revision, hold/release, flat price change, lead → visit → booking), it asserts every surface that must reflect it shows the same number within the freshness budget: booking page, Customer 360, booking ledger, Bills raised, Received, Roznamcha, Demand register, Home widgets, reports, project/tower/flat status, documents/receipt PDF, audit. Runs every phase from Phase 2 on. The owner's existing booking / payment / flat logic (HANDOFF §3, §5) is kept as-is; this proves the connections, it does not change the logic | Owner | 2 → 8 |
| F-13 | Booking page: 5 tabs, one main action + "More" menu | Sales, Accounts | 3 |
| F-14 | Customer 360: 5 tabs, one main action + "More" menu | Sales, Accounts | 3 |
| F-15 | Project page ≤ 5 tabs, with a visual floor × flat status grid | Owner, Sales | 3 |
| F-16 | Booking wizard, payment sheet, Bills raised, Roznamcha, Construction, Masters, Documents restyled and simplified (searchable parking picker, ₹ formatting while typing, icon menus, no internal words) | All | 3 |
| F-43 | **Master audit** (owner's master rule): every one of the 13 masters + Admin → Advanced catalogues is classified as repeatable (stays a master, and must carry its logic: defaults, calc rule, trigger, where-used) or one-off (master hop removed, typed on the entry). Every entry form is checked: no master row needed for a one-time value, inline "Save to master" for repeats, and every master change flows to the screens that use it (connection proof) | Owner, all | 3 |
| F-17 | "Next step" guidance after every save so each journey gets completed | All | 3 |
| F-18 | Reports hub organised by journey: Sales (Lead → Visit → Booking), Money (Bill raised → Received → Balance → Overdue → Refund), Construction (Stage → Bill), Inventory (Flat status), Admin | Owner, Accounts | 3 |
| F-19 | Every screen works at phone width (no bottom tab bar, by owner's choice) | Site, Sales | 3 |
| F-20 | 10-step owner story verified by clicking real forms; Playwright smoke suite kept in the repo | All | 3 |
| F-21 | Every record belongs to exactly one company; requests without a resolvable company are rejected (fail-closed) | All | 4 |
| F-22 | All existing data becomes company "KKT Constructions" with zero change in any money total, count or number | Owner | 4 |
| F-23 | One login, many companies, roles per company; company switcher in the top bar | Multi-company user | 4 |
| F-24 | Per-company numbering with own prefixes; KKT numbers continue unchanged | Accounts | 4 |
| F-25 | Files, audit, reports, dashboards, caches, background jobs, backups separated per company | All | 4 |
| F-26 | Platform Owner role + Companies console (list, status, usage) | Platform Owner | 4 |
| F-27 | Builder self-signup with email verification code → "Pending approval" | New builder | 5 |
| F-28 | Approval queue: approve / reject with reason / suspend / reactivate, with emails | Platform Owner | 5 |
| F-29 | New company starts with a copy of standard masters (no prices, no areas, no demo data) and a first-run setup checklist | New builder | 5 |
| F-30 | Branding per company: logo, letterhead, receipt/booking prefix, brand colour on screens, every PDF and emails | Company Super Admin | 5 |
| F-31 | Plan name + limits (users, projects) recorded per company with usage shown — no billing, no blocking | Platform Owner | 5 |
| F-32 | Company Super Admin invites users; an existing login can be added to another company | Company Super Admin | 5 |
| F-33 | 1 % TDS on property purchase tracked on every payment (new Act Sec 393(1) / old 194-IA; Form 141 Sch. B / old 26QB; certificate Form 132 / old 16B) and credited to the customer ledger; TDS register + Home widget; demo journeys extended. **Owner decisions (2026-11-14):** TDS base = **Account share only** (never on Cash share); applies only when the booking's agreement (Account) value ≥ ₹50 lakh (law); TDS is **credited to the customer ledger the moment the receipt is entered**, with the certificate tracked as "pending" until received | Accounts | 6 |
| F-34 | Tally export: TallyPrime-importable XML of bills raised, receipts, refunds for a date range, ledger names mapped once per company, safe to re-import. **Owner decision:** export **Account share + other charges only**; Cash share never leaves the app | Accounts | 6 |
| F-35 | Channel partner master (RERA agent no., PAN, GSTIN, bank) and partner chosen at booking | Sales | 7 |
| F-36 | Commission per booking: base/rate, payout trigger, GST 18 %, TDS 2 % (Sec 393(1) / old 194H), clawback on cancellation, payable register, partner statement; demo journeys extended. **Owner decisions (2026-11-14):** commission type **chosen per booking** — % or fixed ₹; the % is on the **total value incl. Cash share**; commission becomes payable **once 10 % of the booking's total value is collected** (interpreted: total incl. Cash share, matching the base); on cancellation the whole commission is **taken back** (unpaid part cancelled, paid part becomes a recoverable from the partner) | Accounts | 7 |
| F-37 | Full click-through for two companies incl. cross-company leak check | All | 8 |
| F-38 | Final code review (target ≥ 85/100, estimate) | Owner | 8 |
| F-39 | Security audit focused on cross-company data leaks; every finding fixed | Owner | 8 |
| F-40 | Production: owner publishes; health build == HEAD; test data purged; KKT demo rebuilt by journeys as of that day; staged load test; cleanup | Owner | 8 |
| F-44 | **Demo always "today"** (owner, 2026-11-15: "Auto-refresh demo every night"): demo includes not-yet-due bills (Not due > ₹0, every overdue band non-empty, a real next billing stage); on **preview only** the demo story is rebuilt as of the current date every night (03:00 IST, interpreted) through the existing reseed path, with a backup first, skip-if-busy, never on production, status on System Health; logins, masters, projects, flats, prices kept; numbers only go up | Owner | 1 |
| F-41 | "Lightning fast" performance budgets: measured baseline in Phase 1, enforced as a gate in every later phase (see Performance & Architecture Standards) | All | 1 → 8 |
| F-45 | **Entry completion** (owner, 2026-11-18: "is all of the entry part done?"): every entry form verified end to end, checks rules before Save, explains disabled buttons, Elite controls only, next step after save, edit / deactivate / merge where needed, missing screens added (agreement signed date, change-plan reason, customer deactivate & merge, lead edit, visit outcome, front-desk service requests, bill un-void, per-weekday visit slots, Roznamcha undo by reversal) | All | 3E |
| F-46 | **Discount given** recorded at booking (list price − agreed total, reason) and on price revision; shown on the booking, a Discount register and a Home widget; changes no money | Owner, Sales | 3E |
| F-47 | **Waiver with owner approval**: request on an open bill share → owner approves / rejects → numbered credit note (Jama) incl. matching GST; shows in ledger, bills, Outstanding, bridges, Waiver register, Home; cancel by exact reversal | Owner, Accounts | 3E |
| F-48 | **One report engine**: registry-declared reports, multi-select filters with Select all, cascading Project → Tower → Floor → Flat, date presets + date basis + As of, logical value filters, filter sentence, 5-level drill with subtotals, column chooser, xlsx / PDF / print / share link, saved & pinned views, one meaningful illustration, tie-out + perf budget per report | All | 3F |
| F-49 | **Reports hub in 5 segments** (Customers · Finance · Bookings · Project & inventory · Leads) × 10 reports each, + Control room row | All | 3F |
| F-50 | **Customers segment** incl. owner's **one-click Customer status** (10 columns: name, flat code, agreement value, cash component, bills raised till date, account received, cash received, account dues, cash dues, final status; As of any date) | Owner, Accounts | 3F |
| F-51 | **Finance segment** (10) | Owner, Accounts | 3F |
| F-52 | **Bookings segment** (10) | Owner, Sales | 3F |
| F-53 | **Project & inventory segment** (10) incl. stacking plan | Owner, Sales, Site | 3F |
| F-54 | **Leads segment** (10) | Owner, Sales | 3F |

## Phases
1. **Phase 1 — Clean foundation** (readable code, one UI kit, numbers right, test data gone, logical demo by journeys, stable tests) → F-1 … F-8, F-44. Docs: [phase1/requirement.md](phase1/requirement.md), [phase1/journeys.md](phase1/journeys.md)
2. **Phase 2 — Connection proof first, then Calm Light + Night mode design system, new shell, Home Command Center** → F-42, F-9 … F-12. Docs: [phase2/requirement.md](phase2/requirement.md), [phase2/journeys.md](phase2/journeys.md)
3. **Phase 3 — Declutter every work screen, master audit, Next-step guidance, journey reports, phone width, real click-through** → F-13 … F-20, F-43 (optional publish milestone to billpe.com after this phase if the owner wants). Docs: [phase3/requirement.md](phase3/requirement.md), [phase3/journeys.md](phase3/journeys.md)
3E. **Phase 3E — Entry completion + Discount given + Waiver with owner approval** → F-45, F-46, F-47. Tracker `ENTRY_TODO.md`. Docs: [phase3e/requirement.md](phase3e/requirement.md), [phase3e/journeys.md](phase3e/journeys.md). Owner decisions 2026-11-18: no late-payment interest now; no site expenses / purchases in this ERP now; entry first, then a reports round (3R-reports, planned after 3E).
3F. **Phase 3F — Reports: 5 segments × 10 reports on one report engine + one-click Customer status** → F-48 … F-54. Owner, 2026-11-18: "Do not stop before completing reports, but only after the entry part is complete." Docs: [phase3f/requirement.md](phase3f/requirement.md), [phase3f/journeys.md](phase3f/journeys.md).
4. **Phase 4 — Multi-company core** → F-21 … F-26
5. **Phase 5 — Builder signup, approval, branding, plans, invites** → F-27 … F-32
6. **Phase 6 — TDS tracking + Tally export** → F-33, F-34 (owner questions answered 2026-11-14, see F-33/F-34; owner verifies one import in his TallyPrime)
7. **Phase 7 — Channel partner commission** → F-35, F-36 (owner questions answered 2026-11-14, see F-36)

Owner's standing instructions: "do not stop before completing all eight phases"; "world best and my custom logic" — every locked rule in HANDOFF.md §5 and the decisions above win over generic ERP conventions; "logic works best simple, elegant, powerful" (2026-11-15) — prefer one clear rule over many special cases, never add a step the user doesn't need.

Owner decisions 2026-11-15: Phase 1 also delivers F-44 (not-due demo bills + nightly demo refresh on preview). Phase 2: theme switch offers **Light / Night only** (no Auto). Home default layout for **Sales** = only their work: Call today, Sales pipeline, Inventory by tower, Flat status (no money widgets by default; Customize still governed by permissions).
8. **Phase 8 — Final proof and production** → F-37 … F-40

## UI/UX Rules
- Locked from HANDOFF.md §5: 9-area nav, 3-step booking, 5-field payment, 13 masters, wording (Bill raised / Received / Balance, Roznamcha, "Saleable area" only, Due red / Advance green, no internal words), nothing pre-filled, flat-level locking only.
- Visual direction: **Calm Light** (warm off-white canvas, white cards, hairline borders, one accent, modern sans with tabular numbers, Stripe/Mercury-like) as default; **Night mode** as a per-user switch. Mockups shown to the owner: calm light `https://static.prod-images.emergentagent.com/jobs/bf7bc285-4652-463e-a15e-8214e682dc33/images/e7417416e3ca5c44fa03384e8a69b7cbf3052e642a85749b583ea0f3e6033fe6.jpeg`, night `https://static.prod-images.emergentagent.com/jobs/bf7bc285-4652-463e-a15e-8214e682dc33/images/b8688f08fcc5c58bdbdac63ffab230ab9a8627d9f5da2a38debf60e15ca58187.jpeg`.
- One primary action per screen; everything else under "More". Detail pages ≤ 5 tabs. History lives in an "Activity" tab, not as buttons everywhere.
- No tile ever shows a bare ₹0 / 0 without context; empty states say what is missing and offer the next step.
- Every number on Home and in reports opens the list of entries that adds up to it.
- Dropdown / master-driven entry everywhere; free text only for names, amounts, dates, remarks.
- **Master rule (owner, 2026-11-14):** "If it can be done through master, it should be done through master — but only the repeatable things." A value that repeats across entries (stages, plans, charge heads, flat types, banks, sources, reasons…) lives in a master, and the master carries **logic**: defaults, calculation rule, GST %, trigger, where it applies, and where it's used. A one-off value is typed directly on the entry; the user is never forced to first create a master row that would be used once. Where a typed value turns out to repeat, the form offers "Save to master" inline, without leaving the form (interpreted).
- Text contrast WCAG AA in both themes. No phone bottom tab bar (owner's choice), but no horizontal page scroll at 390 px.
- Every interactive or critical element carries a `data-testid`.
- Company switcher (Phase 4+) always shows current company name + logo; every PDF carries that company's branding.

## Performance & Architecture Standards (owner: "everything lightning fast, canonical best practice")
Budgets (preview, warm, measured by a committed perf script; Phase 1 records the baseline, every later phase must stay within budget):
| Path | Budget p95 |
|---|---|
| Hot reads (Home bundle, project list/detail, booking detail, Customer 360, Bills raised page, unit grid, catalogues bundle) | ≤ 200 ms server time |
| Writes (post payment incl. allocation + ledger rebuild, create booking, stage complete for a tower with ≤ 60 bookings) | ≤ 600 ms |
| Reports (FY collections, outstanding & ageing) | ≤ 800 ms, cached repeat ≤ 100 ms |
| Home from login (warm) | first content ≤ 1.0 s, all widgets ≤ 1.8 s |
| Route change inside the app | ≤ 300 ms to content (prefetch + skeletons) |
| Initial JS (gzip) | ≤ 250 KB; every route lazy-loaded |
Canonical practices (keep what exists, close the gaps):
- **Database:** every query backed by an index whose first key is `company_id` (from Phase 4) then the filter/sort keys; keyset (cursor) pagination only; projections on list endpoints (no whole documents); aggregation pipelines for summaries; no N+1 (batch `$in` lookups); index snapshot test guards regressions; read models (`project_summaries`, `customer_summaries`, `dashboard_snapshots`, `monthly_buckets`) for anything shown on Home.
- **Caching:** event-driven invalidation (audit outbox → cache bust) over time-based guesses; per-company cache keys; `ETag` + `Cache-Control: private, max-age=0, must-revalidate` on JSON reads so repeat views return 304; immutable hashed static assets with 1-year cache; React Query stale-while-revalidate with prefetch on hover/route intent; catalogues/masters cached client-side and invalidated by version.
- **Server:** stateless API (no in-process state that matters across workers); multiple workers in production (`WEB_CONCURRENCY`), gzip/brotli, ORJSON, uvloop; Redis used automatically when `REDIS_URL` exists, Mongo-backed fallback otherwise (Emergent hosting manages the servers — no AWS/Postgres migration, by design).
- **Money safety under speed:** idempotency keys, optimistic `version`, guarded `$inc` caps, ordered writes + compensation stay; speed never bypasses them.
- **Frontend:** route-level code splitting, virtualised long tables, skeleton loaders (never blank screens), optimistic UI only where the server confirms within the same interaction, fonts self-hosted with `font-display: swap`, images responsive/lazy.

## Integrations
| Need | Choice | Notes |
|---|---|---|
| Email (signup code, approval/rejection, invites, existing reminders) | Emergent-managed Resend | No user key |
| Logos / letterheads / documents / KYC | Emergent Object Storage | Per-company prefix from Phase 4 |
| Subscription billing | Not now | Plan + limits recorded only |
| WhatsApp / SMS | Not now | Adapters stay `not_configured` — MOCKED by design; "WhatsApp" buttons open the phone's WhatsApp link only |
| AI / LLM | Not used | Owner opted out |
| Tally | File export only (XML) | No live connection; owner verifies one import in his TallyPrime |

## Edge Cases
- Demo data must always be logical: nothing dated in the future; lead ≤ visit ≤ booking ≤ its bills ≤ their receipts; bills only after their stage completion date; cheque clearing ≥ deposit; refunds only after cancellation; a chronology check enforces this.
- Purge refuses anything that is not test lineage; numbers are never reused.
- Multi-company migration idempotent and money-neutral (tie-outs identical before/after); removed member loses access on the next request; forms opened in company A can't post into company B; uniqueness (phone, project code, numbers) per company; suspended company blocked but data kept; one company's job failure never stops others.
- Signup with an email that already has a login → that login gets the new company as a pending membership.
- Theme switch never changes data or layout widths; charts readable in both themes.
- TDS: never computed on Cash share; bookings with agreement value < ₹50 lakh show "TDS not applicable"; a reversed/bounced receipt reverses its TDS credit; certificate pending > 30 days shows in Needs attention (interpreted).
- Commission: fixed-₹ and % both supported per booking; payable trigger re-checked after every receipt, reversal and bounce; cancellation before payout cancels it, after payout creates a recoverable; commission never touches the customer's ledger.

## Seed Data
- Phase 1 close-out (F-44): the demo carries bills not yet due + a next billing stage, and on preview it is rebuilt nightly as of today (anything typed on preview by hand is replaced at 03:00 IST, except logins, masters, projects, towers, flats, prices, plans).
- Phase 1: purge every test record, then rebuild the KKT demo (Shree Ganesh Heights Towers A/B/C + Ganesh Green Villas) as complete journeys up to today through the API; journey guide `memory/qa/phase1/demo_journeys.md`. Preview now; production in Phase 8 (owner GO given: billpe.com has only demo data).
- Phases 4–5: one tagged test company "QA Builders — test" for isolation proofs; purged before production.
- Phases 6–7: the demo journeys are extended with TDS and broker journeys.
