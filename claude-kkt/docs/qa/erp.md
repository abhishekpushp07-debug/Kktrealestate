# Browser QA — staff ERP (`apps/erp`)

Date: 2026-10-25 · Chromium (Playwright, headless) · viewports **1440×900** and **390×844** (mobile emulation, touch) · production build (`vite build` served by `vite preview` on :5173, `VITE_API_URL=http://localhost:4000`).

Stack under test: API `apps/api` on `:4000` with the demo seed on its own database `kkt_qa_erp` (dropped and recreated so the seed ran fresh; Redis db 13, `ERP_ORIGIN=http://localhost:5173`). API integration tests for the module I touched ran on `kkt_qa_erp_test` (Redis db 14 — db 16 is outside Redis' default 0–15 range, see open items).

Runner: [`docs/qa/erp/browser-qa.cjs`](erp/browser-qa.cjs) (`ERP_URL`, `API_URL`, `OUT_DIR`, `REPORT`, `WIPE=1`, `ONLY=login,roles,masters,inventory,crm,money,misc,hardening,smoke`). On every page it asserts: zero console errors / page errors, zero failed or ≥ 400 API requests (apart from the deliberate 4xx probes listed below), `document.documentElement.scrollWidth <= window.innerWidth`, and at 390 px that every **primary** target is ≥ 44 px tall (action buttons, tabs, sidebar / drawer / Back links; switches toggle through their 44 px label row and desktop-only breadcrumb crumbs count as secondary). It records every sub-44 px element, takes one palette-quantised viewport screenshot per listed page and width (`docs/qa/erp/<page>-<width>.png`, 40 files, 13–167 KB each, 2.1 MB in all), and verifies every flow through the API afterwards (status, ledger rows, audit rows, stage records, files).

## Phase 7 frontend track 2026-10-27

Stack: API (`tsx src/server.ts`) on `:4710` with a fresh demo seed in `kkt_p7_fe` (Redis db 12) plus the worker; ERP built with
`VITE_API_URL=""` (same origin, like production behind Caddy) and served by `vite preview --port 5710` with
`KKT_API_PROXY_TARGET=http://localhost:4710`, so the HttpOnly `kkt_rt` cookie (contract C1) works without cross-origin CORS. Runner:
`ERP_URL=http://localhost:5710 API_URL=http://localhost:4710 OUT_DIR=<outside the repo> node docs/qa/erp/browser-qa.cjs`.

**Result (full walk, fresh seed): 585 page checks (404 at 1440 px, 181 at 390 px), 209/209 assertions, 0 console errors, 0 failed
requests, no overflow, no primary target under 48 px; axe 534 scans, 533 clean.** The one axe hit (`target-size` on the cheques
"Instrument date" header after the bounce flow) was a horizontally scrolled table, not the toast the earlier stages blamed: the runner
now scrolls the table back before the check. The re-run of `money` + `phase7` then found the bell's accessible name "Notifications,
132 unread" did not contain its visible "99+" badge (`label-content-name-mismatch`, only above 99 unread) — fixed in
`NotificationBell.tsx`. Re-run `money,phase7`: **81 checks, 64/64 assertions, 0 defects, axe 81 scans, 0 serious/critical.**

Two regressions of the new unsaved-changes guard were found by the walk and fixed before the final run: `SheetContent` stays mounted
while its sheet is closed, so a form edited and then saved kept the registry dirty and the next in-app navigation asked "Leave without
saving?" (the guard now counts only while the Radix content is open, and a successful save resets "any edit" tracking); Radix Select's
hidden native `<select>` dispatches untrusted change events when a drawer loads its record (now ignored, as is anything under
`aria-hidden`).

New section **`phase7`** (`ONLY=phase7`, both widths):

| Area | Checked |
| --- | --- |
| Session (C1) | after sign-in localStorage holds only `kkt.erp.session` (no token); the refresh token is the `kkt_rt` cookie (HttpOnly, SameSite=Strict, Path=/api/v1/auth); a full reload restores the session through the cookie |
| Unsaved sheet | new-customer sheet with an edit: Esc asks "Discard unsaved changes?"; "Keep editing" keeps the sheet; the close button asks again; "Discard changes" closes it (`unsaved-sheet-prompt-1440.png`) |
| Unsaved page | Settings with an edited tagline ("Unsaved changes"): a sidebar link asks "Leave without saving?"; "Stay on this page" keeps the edit; "Leave and discard" navigates and nothing was saved (API) (`unsaved-settings-prompt-1440.png`) |
| Ledger (C7) | booking ledger totals rendered from the server `summary`, the epoch label, the rebuild history panel (`ledger-rebuilds-1440.png`) |
| Import templates | the charge-types CSV dialog reads `GET /masters/charge-types/import-template` (200) and its header uses `default_amount_paise` |

The portal-side checks are in `docs/qa/portal.md`.

## Verify stage 2026-10-26 (phase 5: lint refactors)

The verify stage moved about 50 ERP files off "set state in an effect" (dialog/sheet resets via `useOnChange`, derived loading flags,
`useNow()`, `useWatch`); this walk checks that nothing regressed. Stack: API bundle on `:4710` (fresh demo seed in `kkt_h7`, Redis db 23,
`ERP_ORIGIN=http://localhost:5710`), ERP built with `VITE_API_URL=http://localhost:4710` and served by `vite preview` on `:5710`; runner
`ONLY=login,roles,masters,inventory,crm,money,misc,hardening,smoke` with `OUT_DIR` outside the repo (the committed screenshots are unchanged).

**Result.** 575 page checks, 178/179 assertions, 524 axe scans (523 clean). The one failed assertion was the kanban drag gesture
(NEW → CONTACTED) during the 27-minute full walk; the `crm` section re-run twice on its own passes 18/18 both times, so it is a flaky
drag gesture under load, not a regression. The one axe finding is the known transient `target-size` hit on the cheques table header
while the success toast covers it.

## Integration stage 2026-10-26 (phase 5 frontend wiring)

Stack: API on `:4600` (demo seed in `kkt_h6`, Redis db 22, `ERP_ORIGIN=http://localhost:5673`), ERP built with `VITE_API_URL=http://localhost:4600` and served by `vite preview` on `:5673`; runner `ERP_URL=http://localhost:5673 API_URL=http://localhost:4600 node docs/qa/erp/browser-qa.cjs`. The runner has a new section **`hardening`** (`ONLY=hardening`), run after `money`/`misc`, and the smoke walk now includes `/admin/jobs`, `/admin/system`, `/admin/backups` and `/exports`.

**Result.** Full walk (all sections, fresh seed): **551 page checks (376 at 1440 px, 176 at 390 px), 164/164 assertions, 0 console errors, 0 failed requests, no overflow, no primary target under 48 px; axe 500 scans, 499 clean.** Two defects in that run, both handled: the `crm` section still clicked the old "Verify / reject" KYC button (runner updated to the maker-checker "Submit for verification" button) and, once past it, the new "share the visitor's new link" dialog after a reschedule (runner now asserts it and closes it); the remaining axe finding is the known transient `target-size` on the cheques "Amount" header while the "bounced" toast covers it (unchanged since the frontend track). Re-runs on the final build: `crm` 34 checks / 18 of 18 assertions, 0 defects, 34 clean axe scans; `money` + `hardening` 79/79 assertions; `roles` + `hardening` + `smoke` on a fresh seed (final build): **287 page checks, 56/56 assertions, 0 defects; axe 236 scans, 0 serious/critical**.

What the `hardening` section verifies (both widths unless noted; flows checked through the API afterwards):

| Area | Checked |
|---|---|
| Jobs `/admin/jobs` | table of every job (last run / last success / failures 24 h and since success / next run); **Run now** on `NOTIFICATION_SWEEP` → 202, the run watcher polls `GET /admin/jobs/runs/:id` until OK (1440). 409 `JOB_ALREADY_RUNNING` shows "already queued or running" and watches `details.run_id` (unit-tested) |
| System health `/admin/system` | versions, database / Redis up, metrics summary parsed from `GET /metrics` (requests, 5xx, p95, event-loop lag, payments, failed logins, queue depth) |
| Backups `/admin/backups` | Create backup (confirm, optional "include secrets") → `BACKUP_EXPORT` runs on the worker → row DONE → **Download** through the signed link (`.zip`, 1440); restore instructions card; the button is disabled while one is queued/running (409 `JOB_ALREADY_RUNNING` message) |
| Exports | Customers toolbar → menu → **Export all rows in the background** → `POST /exports` (toast with "My exports") → `/exports` row DONE → **Download** (`.csv`) (1440). Lists above 10,000 rows show **Export all** as the main button; a synchronous CSV cut at 10,000 rows (`X-Export-Truncated`) offers it in its toast; 429 (3 running) has its own message |
| Users | own row offers "Change my password" and hides Reset password / Deactivate (403 `SELF_CHANGE`) |
| Bulk portal enable | dry run counts the buyers without a login ("1 buyer gets…"), enable → one-time credentials table → closing without downloading warns → **Download CSV** (`portal-credentials-<date>.csv`, formula-safe) → login enabled (API) (1440) |
| KYC maker-checker | PENDING file: Submit → 422 `KYC_INCOMPLETE` lists what is missing (1440); a file submitted by Sales: the panel names the submitter, the admin gets Verify / Reject, Sales (390) sees the maker-checker note and no Verify |
| Erasure | Super Admin: "Erase personal data" → reason + type `ERASE` (button disabled until then) → erased (API `erased_at`), edit / erase / co-applicant actions gone, read-only notice (1440) |
| Reversal on a COMPLETED booking | the reverse dialog warns that the booking reopens (admin) / is blocked (no `settings.manage`) |
| Booking wizard | picking a flat reserves it (`POST /flats/:id/reserve`, API shows HOLD) with a live **15:00 countdown** and Extend; an agreement value below the list price asks an `agreement.edit` holder for a reason before Next (1440); for Sales (390) the value is locked to the list price; **Cancel → Discard** releases the flat (API AVAILABLE again) |

New screenshots: `admin-jobs-*.png`, `admin-system-*.png`, `admin-backups-*.png`, `exports-*.png`, `customers-bulk-credentials-1440.png`, `customer-kyc-incomplete-1440.png`, `customer-erase-dialog-1440.png`, `booking-wizard-reserved-*.png`, `booking-wizard-deviation-1440.png`, `booking-wizard-locked-390.png`, `customer-kyc-maker-390.png`.

Defects found and fixed while wiring:

| # | Defect | Fix |
|---|---|---|
| 1 | The wizard's "Resume booking?" banner offered the draft the same wizard was autosaving (the autosave refreshes the drafts list). | `BookingWizard.tsx` skips the draft whose id is the current (client-generated) draft id. |
| 2 | The KYC 422 message repeated the missing items twice (sentence + list). | `KycPanel.tsx` shows one line plus the list. |
| 3 | A flat the wizard reserved read "On hold by <your own name> — the hold owner or an admin can book it". | `StepFlat.tsx` says "Held for you until …" for the caller's own hold. |

## Re-run 2026-10-26 (phase 5 frontend-quality track)

Stack: API on `:4500` with a fresh demo seed in `kkt_h5` (Redis db 20, `ERP_ORIGIN=http://localhost:5573`), ERP built with `VITE_API_URL=http://localhost:4500` and served by `vite preview` on `:5573`; runner `ERP_URL=http://localhost:5573 API_URL=http://localhost:4500 node docs/qa/erp/browser-qa.cjs` (`AXE=0` skips the scans). Primary targets are now checked at **48 px** at 390 px (SPEC §15), and the runner's API helper renews its access token (a full walk with axe takes ~24 min, longer than a token lives).

**Result: 545 page audits (382 at 1440 px, 163 at 390 px), 150/150 flow assertions pass, 40 screenshots, 0 console errors, 0 failed requests, no overflow, no primary target under 48 px; axe-core: 494 scans (331 at 1440 px, 163 at 390 px), 493 with no violation.** The one remaining finding is transient: `target-size` on the cheques table's "Amount" sort header right after clearing a cheque, when the success toast briefly overlaps the header (11 × 24 px uncovered); a re-scan of the same page afterwards is clean.

New assertions: as Project Admin (report.view without audit.view) the reports catalogue has no Activity card and `/reports/activity` renders the Forbidden page without calling the API (TODO-integration item 10).

### Accessibility (axe)

`docs/qa/axe.cjs` (axe-core 4.14.0, WCAG 2.0/2.1/2.2 A + AA, reduced motion emulated while scanning); serious and critical violations are defects. The first run against the unchanged ERP (480 scans) had **711 serious/critical findings on 432 scans**:

| Rule | Pages | Nodes | Cause → fix |
|---|---|---|---|
| label-content-name-mismatch | 412 | 843 | the account-menu trigger was labelled "Account menu" while showing the user's name and role → `sr-only` "Account menu" text instead of `aria-label`; inventory / flat-picker cells were labelled "A-801, Available, ₹85,88,000" while showing "₹85.9 L" → visible text first, details in an `sr-only` suffix; lead cards (below) |
| aria-required-parent / aria-required-children / aria-allowed-attr | 13 / 41 / 11 | 535 / 47 / 78 | the inventory grid and the wizard's flat picker put `columnheader`/`rowheader`/`gridcell` directly in `role="grid"` (and `aria-pressed` on a `rowheader`) → `display: contents` `role="row"` wrappers, the floor-select button inside its `rowheader`; report Chart/Table and editor-mode toggles were `role="tablist"` of plain buttons → `role="group"` of `aria-pressed` toggles |
| nested-interactive | 54 | 374 | phone list cards (`DataTable` mobile cards), lead and ticket kanban cards and ticket list cards were `role="button"` around checkboxes, menus and links → no role; the name / number link is the keyboard target (lead name is now a button) |
| color-contrast | 22 | 323 | navy KPI cards drew the delta chip in green/red on navy-800 (2.13:1) → light green/red/navy-100 on the navy card; inventory cell prices at `opacity-90`; CANCELLED receipt watermark → `text-danger/80`; token changes below |
| target-size | 25 | 67 | website-tab image reorder arrows (10 × 16 px) → 32 px buttons with names; combobox clear (18 px) → 24 px; inline customer / phone links → 24 px rows; sortable headers `min-h-6` |
| definition-list | 48 | 65 | the block status legend put a swatch `span` and a total `div` straight in the `<dl>` → swatch inside the `dd`, total as `dt`/`dd` |
| aria-progressbar-name | 9 | 59 | dashboard progress rows and schedule bars → `aria-label` |
| aria-valid-attr-value | 45 | 45 | view switchers built on Radix Tabs without panels pointed `aria-controls` at missing ids → `TabsTrigger` drops a dangling `aria-controls` |
| button-name | 13 | 18 | multi-selects without a visible label (featured projects, flat-type specifications), the co-applicant search, icon-only "Download" on phones → labels |
| scrollable-region-focusable | 11 | 13 | text-only scroll boxes (data tables without row actions, roznamcha, block-wizard preview, payment-schedule preview) → focusable `role="region"` |
| link-in-text-block | 3 | 10 | "Open block", ledger receipt/demand links → underlined |
| aria-prohibited-attr, label | 2, 2 | 2, 2 | unread dots → `role="img"`; hidden CSV file input → label |

Form wiring (`components/ui/form.tsx` + `field-context.ts`): a control whose `id` is its `FieldWrapper`'s id now inherits `aria-invalid`, `aria-required` and `aria-describedby` (→ the `role="alert"` error, else the hint) — `Input`, `Textarea`, `Select`, `Combobox`, `MultiSelect` (and everything built on them: money/number/date inputs). Before, only `FormField` render props that spread `field` were wired; the ~110 `FieldWrapper` call sites that pass `id={control.id}` were not. `ErrorState` gives 403 ("You don't have access to this") and 404 ("Not found" — also what a scoped user sees for another project) their own copy without a Retry button.

### Contrast (design tokens) and tap targets

`node docs/qa/contrast.mjs erp` → **53/53** pairs pass (`docs/qa/contrast-results.md`, enforced by `src/lib/__tests__/contrast.test.ts`): `danger` #ef4444 → #dc2626 (white text 3.76 → 4.83:1; hover #b91c1c), `ink-subtle` #64748b → #5d6a7f (4.44 → 5.11:1 on the page surface). The focus indicator is a navy inner ring plus the gold outer ring (`:focus-visible`, `focus-ring`, `focus-ring-inset`), so it reaches 3:1 on light and on navy surfaces (CSS-only change made after this run). Review pass: form-control boundaries were exempted as "informational" at 1.48:1 (a white input on a white card is identified only by its border, WCAG 1.4.11) — inputs, textareas, selects, comboboxes, multi-selects, checkboxes, radios and the switch track now use the new `border-input` token #7c8aa0 (3.50:1 on card, 3.24:1 on ivory; white switch thumb 3.50:1 on the track), hover `navy-400` (4.03:1) instead of the lighter `navy-300`; a control's own `aria-describedby` is merged with the field's error id instead of replacing it. Re-run against the rebuilt bundle (`ONLY=login,masters,crm,smoke`, API :4500 fresh seed in `kkt_h5`): 242 page checks, 39/39 assertions, 242 axe scans (138 at 1440 px, 104 at 390 px) with 0 serious/critical violations, 0 defects. Phone sizes moved from 44 to **48 px**: buttons (`sm`/`md`/`lg`), icon buttons, inputs, selects, comboboxes, multi-selects, page tabs, CMS / master chips, sidebar links, the Back link, toolbar date filters, grid cells.

### IST dates

`lib/format.ts` `formatDate` puts instants on their IST calendar day (and keeps `YYYY-MM-DD` business dates as they are) whatever the browser's zone; `toDateString`, the dashboard greeting hour, the settings FY preview and every `datetime-local` input (lead follow-ups, CMS schedules) use the IST wall clock (`instantToIstInput` / `istInputToInstant`). Unit tests run under `America/Los_Angeles`, `UTC` and `Pacific/Kiritimati` (`src/lib/__tests__/format-tz.test.ts`).

## Result (2026-10-25 run)

**543 page audits in the final run (387 at 1440 px, 156 at 390 px; 156 of them the admin "smoke" walk over every route in `routes.tsx` at both widths), 147/147 flow assertions pass, 40 screenshots, 0 console errors, 0 failed requests (7 deliberate 4xx), no horizontal overflow at 390 px and no primary target under 44 px** after the fixes below. Earlier passes of the same script found the defects listed further down; the fixes were verified by re-running every section against the rebuilt bundle (sections run one after another: the per-IP login limit of 10/min answers 429 when three sections log in concurrently, which is correct behaviour).

### Pages checked (both widths unless noted)

| Area | Pages / routes | What was exercised | Screenshots |
|---|---|---|---|
| Login | `/login`, user menu → logout | wrong password → "Incorrect email or password." (deliberate 401); sign-in lands on `/`; logout returns to `/login` | `login-*.png` |
| Dashboards per role | `/` as admin, accounts, sales, projects (SGH-scoped), marketing, employee | owner: collections trend + ageing + inventory + overdue + cheques; accounts: today/month, cheques to clear, "Post payment"; sales: funnel, follow-ups, today's visits; project admin: SGH only (GGV never mentioned); phone: drawer from the top bar | `dashboard-<role>-1440.png`, `dashboard-admin-390.png`, `mobile-nav-390.png` |
| Roles & scope (1440) | every nav item each role can see; forbidden routes (`/admin/users`, `/payments`, `/website/settings`, `/leads`, `/bookings`, `/customers`, `/admin/settings`) | each blocked route lands on the forbidden page; the SGH-scoped project admin gets **not-found** (not forbidden) for GGV and a project list without it; Sales sees masked KYC with no reveal button and `?reveal=true` → 403 | – |
| Master data | all 16 kinds under `/masters/*` (+ `/master/:kind` alias) | list; flat-type edit sheet (version, rooms, areas); room type create → edit (version 1 → 2) → deactivate → restore; in-use deactivate → 409 IN_USE usage conflict + "Where used" dialog (Bedroom: 5 flat types); CSV import preview (3 rows: create / update / error), commit disabled until the error row is fixed, commit creates the row; CSV export; construction stages drag/arrow **reorder + save**, **possession radio** moved to Finishing and back (exactly one flag, verified through the API); payment plan form with the live **sum footer** (40 % → "60 % to go" → 100 %) and a saved 2-installment plan | `masters-flat-types-*.png`, `masters-construction-stages-1440.png` |
| Projects | `/projects`, `/projects/:id` tabs overview · blocks · parking · rate cards · construction · website · visits | parking **bulk generate** (3 open slots); rate card **create → activate → apply** (preview counts, re-priced toast); construction **update** (Tower B → Plinth, result dialog with demands raised / buyers notified) then **undo** (demands voided, stage count restored); website settings save (meta title) + **publish guard** on a bare project ("Cannot publish yet": hero image, description, location); visit settings save (seats 3 → 4 → 3) | `projects-1440.png`, `project-detail-1440.png` |
| Block wizard | `/projects/:id/blocks/new` | Tower, 3 floors, FP-4 for floors 1–3, pricing, preview "12 flats", create → block page with **12 grid cells and 12 flats via the API** (`Q…-101…304`, carpet snapshot 1 050 sq ft, price from the active rate card); done at 1440 and on the phone | `block-wizard-*.png` |
| Block detail / grid | `/blocks/:id` grid · flats · pricing · construction | colour by status / type / price band; flat drawer (Details: rooms + areas; Price: breakup; Actions; History) → **Hold** (reason, banner) → Available; select mode → 2 flats **Blocked** → Available; **print chart** calls `window.print()` on the print area; `/flats`, `/rate-cards`, `/construction` overviews | `block-grid-*.png` |
| Customers | `/customers`, `/customers/:id` | create with valid PAN + Verhoeff Aadhaar + RM; 360 cards; **KYC reveal** (admin) unmasks the PAN and writes a `customer.kyc_reveal` audit row; KYC status dialog; **co-applicant** added; **portal access enable → temporary password shown once**, reset, revoke sessions; **document upload** (PDF, listed with download); bookings / payments / leads / tickets / history cards; Sales sees `XXXXX1234K` and no reveal | `customers-1440.png`, `customer-360-*.png` |
| Leads | `/leads` kanban + list | create (sheet opens the drawer); **kanban drag NEW → CONTACTED** (stage verified); **Move-to LOST** from the drawer asks for a reason ("Budget mismatch" stored); follow-up recorded; **convert → customer** (create mode) with the **"Start booking" link** (`/bookings/new?customer_id=…&project_id=…`) | `leads-*.png` |
| Enquiries inbox | `/website/enquiries`, `/enquiries` | unread badge in the page title and the sidebar pill; opening an enquiry marks it read (1 → 0 unread) | – |
| Site visits | `/site-visits` day · week · list | create for the new lead (SGH, slot picker with "N left"), SV- number, CONFIRMED; **reschedule** to another day; **complete** → COMPLETED (lead → Site Visit Done) | `site-visits-1440.png` |
| Bookings | `/bookings`, `/bookings/:id` (9 tabs), `/bookings/new` | worked-example ledger shows 60 L / 40 L cumulative + "(advance)" rows; **6-step wizard** on an AVAILABLE SGH flat: grid pick (find by number) → customer by phone → agreement prefilled from the flat price, 60/40 split via percentages → Standard CLP default with an 11-row preview → Legal charge + parking slot → review → booking ACTIVE, flat BOOKED, parking allotted, catch-up demands raised; done as admin at 1440 and **as Sales on the phone**; **revise agreement** (cash − 1 L, reason, AGREEMENT_CHANGE row, revisions tab); **complete** dialog lists blockers and disables confirm; **cancel** dialog blocked while a cheque is pending; the phone booking cancelled → flat AVAILABLE again | `bookings-1440.png`, `booking-wizard-*.png`, `booking-detail-*.png` |
| Payments | `/payments`, `/payments/cheques`, `/payments/:id`, `/print/receipt/:id` | post **cash** → receipt view with amount in words, print window (`/print/receipt/:id?autoprint=1`), **PDF download**; NEFT (Account); two cheques "subject to realisation"; **bucket cap** → 409 with the explanatory message (deliberate); cheques page **clear** one, **bounce** one with reason; **reverse** the NEFT with reason → statuses CLEARED / BOUNCED / REVERSED, summary cash paid ₹2.5 L (bounced and reversed excluded), ledger has 3 PAYMENT + 1 REVERSAL rows; print page PDF; reversed receipt shows CANCELLED; `/payments/:id` redirects to the booking's payments tab | `payments-1440.png`, `receipt-1440.png` |
| Demands | `/demands`, `/print/demand/:bookingId/:demandId` | list with statuses; demand letter with both buckets and bank details; as admin **Run dues now** then the **integrity panel: ok, 0 findings** over every booking (seed + QA bookings) | `demands-1440.png` |
| Roznamcha | `/roznamcha`, `?mode=RANGE` | opening / closing cash; **contra** dialog (₹50,000 deposited to HDFC) appears in the day book | `roznamcha-1440.png` |
| Service requests | `/service-requests` list · kanban, `/service-requests/:id` | new ticket (customer, category, subject); **internal note** (badge), public reply, **assign**, **priority**, **status** transition with note — all verified through the API (1 internal of 3 messages) | `service-requests-1440.png`, `service-request-detail-390.png` |
| Website CMS (marketing) | `/website/settings`, banners, posts (+ editor), gallery, notices, pages, home sections, testimonials, people | site settings save bumps the **version** (shown as "Last saved … · version n"); **banner with uploaded image**; **post draft → publish** (slug); **notice** for SGH published; **gallery upload** (+1 item); page editor (slug + markdown) | `website-settings-1440.png` |
| Reports | `/reports` and 12 report keys, `/reports/customer-statement` | every key renders its stats / chart / table; **CSV + PDF** downloads for collections and outstanding-ageing (`%PDF` header checked); customer statement of the ₹1 Cr worked example with statement PDF, allotment letter PDF and CSV | `reports-1440.png`, `report-collections-390.png` |
| Admin | `/admin/users`, `/admin/roles`, `/admin/audit-log`, `/admin/settings`, `/sessions`, `/notifications` | user created (Employee); role created from "copy from Employee" (permissions pre-ticked); audit detail sheet with diff and the login-events tab (incl. the failed login); settings save (booking hold hours +1, reverted); sessions list; mark-all-read (unread → 0) and the bell popover | `admin-users-1440.png` |
| Command palette | Ctrl/⌘+K (phone: search button) | "A-301" → flat (opens the block grid with the flat drawer), "Priya" → customer, "BK-" → booking; each result navigates | – |
| Smoke walk (admin) | every route in `routes.tsx` incl. `/change-password`, print routes, aliases (`/master/:kind`, `/users`) and an unknown route (404 page) | 78 routes × 2 widths, all clean | – |

Deliberate 4xx in the final run: `401 POST /auth/login` ×2 (wrong password), `404 GET /projects/<GGV>` (scoped user), `409 POST /masters/room-types/:id/deactivate` (in use), `422 PATCH /projects/:id/website` ×2 (publish guard), `409 POST /payments` (bucket cap).

### Tap targets at 390 px (after fixes)

Every primary control measures ≥ 44 px: sign-in, Save / Next / Confirm / Post buttons (44), filter selects and date fields (44), page tabs and pill segments (44), CMS and master-data tab chips (44), sidebar / drawer links (44), the Back link (44), palette items, kanban cards, grid cells (56). Remaining sub-44 px elements are secondary and all have a larger duplicate control: the notification bell and user-menu trigger (36 px icon buttons in the 64 px top bar), the wizard stepper indicators "Step 1…6" (28 px status chips; the sticky Back / Next footer is the control), the report date-preset chips (28 px; the date fields next to them are 44 px), desktop-only breadcrumb crumbs (16–20 px text links; the Back link replaces them on phones) and the `sr-only` "Skip to content" link.

## Defects found and fixed

| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | **Command palette never showed search results.** `GET /search` answers `{results, recent}`; the shell read a list envelope (`items`) or a bare array, so every search threw and rendered "No matches". The API's hrefs for BLOCK and FLAT hits also pointed at `/projects/:pid/blocks/:bid`, a route the ERP does not have (`/blocks/:id`). | ERP + API | `apps/erp/src/components/layout/AppShell.tsx` reads `results` (envelope and array still tolerated) and shows the `sublabel`; `apps/api/src/modules/search/index.ts` builds `/blocks/:id` and `/blocks/:blockId?flat=:flatId`. `rbac`, `crm-adversarial` and `conventions` integration suites (30 tests) re-run green on `kkt_qa_erp_test`. |
| 2 | **Sales (and every role without `audit.view`) got 403s on the customer 360, the booking History tab and the ticket history** — the pages fetched `/audit-logs…` unconditionally (customer history was gated on `customer.write`, which Sales has, but the API guards the audit routes with `audit.view` only). | ERP | `CustomerDetailPage.tsx` gates on `audit.view`; `bookings/api.ts` + `detail/HistoryTab.tsx` and `service/api.ts` + `ServiceRequestDetail.tsx` take `enabled: can("audit.view")` and show "History is hidden for your role". |
| 3 | **Out-of-scope / unknown project cascaded a second 404**: `/projects/<other>` fetched `/blocks?project_id=…` in parallel with the project, so the scoped user's not-found page logged two failed requests. | ERP | `inventory/api.ts` `useProjectBlocks(id, {enabled})`; `ProjectDetailPage.tsx` loads children only once the project resolved. |
| 4 | **Receipt print window could sign the user out.** Opening `/print/receipt/:id` in a new tab rotates the refresh token (access tokens live in memory); the tabs raced on the single-use token and the server's reuse detection revoked the whole family → the original tab fell to `/login` with `401 /auth/refresh`. | ERP | `lib/api.ts` `refreshSession()` serialises rotation across tabs of the origin with a Web Lock (`kkt.erp.refresh.rotate`) and re-reads the stored token inside the lock. |
| 5 | **Phone tap targets below 44 px on primary controls**: CMS and master-data section chips 32 px, page tabs 36 px (pill segments 28 px), sidebar / drawer links 36 px, the Back link 16 px, toolbar date filters 32 px. | ERP | `features/cms/CmsLayout.tsx`, `features/masters/MastersLayout.tsx` (h-11 chips), `components/ui/tabs.tsx` (h-11 below `lg`, pills too), `components/layout/Sidebar.tsx` (h-11 below `lg`), `components/ui/page-header.tsx` (`min-h-11` Back link), `h-11 … sm:h-8` on the date filters of `PaymentsPage`, `DemandsPage`, `SiteVisitsPage`, `AuditLogPage`, `ReportFilterBar`, `ConstructionPanel`. |
| 6 | **Toolbar date filters stretched to full width and stacked** (payments, demands): `DateInput` dropped `wrapperClassName`, so the `w-full sm:w-40` sizing never reached its outer box. | ERP | `components/ui/date-input.tsx` applies `wrapperClassName` to the outer box. |
| 7 | Drift found by the first (cut-short) pass and already committed before this run (`acfce72`): spec-items list sorted on a disallowed key (`sort=category_name`), users filtered with `role=Sales` instead of the role id, applicable-plans fetched with query params the API rejects, roznamcha asked for `from/to` on the day view, posts sorted on `-updated_at`, CMS image previews blocked by `Cross-Origin-Resource-Policy`, and 36 px buttons / inputs / selects on phones. | ERP + API | `masters/masterConfig.ts`, `shared/options.ts`, `bookings/api.ts`, `payments/api.ts`, `crm/api.ts`, `inventory/api.ts`, `cms/PostsPage.tsx`, `components/ui/{button,input,select,combobox}.tsx`, `apps/api/src/modules/documents/routes.ts`. Re-verified clean by this run's smoke walk. |

Verification: `pnpm --filter @kkt/erp typecheck`, `build` and `test` (11 files, 94 tests) green; `pnpm --filter @kkt/api typecheck` green; the full runner re-run section by section with 0 defects (summaries above).

## Still open / notes

* **Site visits list filter**: the list view keeps its own project filter (`l_project_id`, defaulting to the first project) separate from the calendar's `project` parameter, so switching from the calendar (SGH selected) to the list shows the first project's visits until the list filter is changed. The runner opens `/site-visits?view=list&l_project_id=<SGH>` directly. Worth syncing the two filters.
* **Construction "Update status" dialog** stays open after a successful update to show the result (stages completed, demands raised, buyers notified) with a **Done** button; by design, but it reads like a hung dialog until you notice the summary. Consider auto-closing with the summary in the toast.
* **Refresh-token rotation across tabs** is now serialised, but a tab closed in the few milliseconds between sending `/auth/refresh` and storing the new token still consumes the old one; a short server-side reuse grace (or returning the same pair for the same token within ~10 s) would remove the remaining edge.
* The payment wizard / dialogs rely on the active rate card: this run activated a QA rate card (`SGH QA …`, same rates + ₹50) and re-priced Available SGH flats, so prices in `kkt_qa_erp` differ from the seed by design. The run also leaves QA blocks (`Tower Q…`), parking slots, two bookings (`BK-2627/0011` active, `/0012` cancelled), a cancelled QA lead, visits, tickets, a banner / post / notice / gallery image and a QA user and role in `kkt_qa_erp`; run `POST /api/v1/admin/reseed` or drop the database before reusing it. The integrity report was **ok with 0 findings** after all of it.
* Redis' default configuration has 16 databases (0–15), so `TEST_REDIS_URL=redis://…/16` answers `ERR DB index is out of range`; the integration suites ran on db 14. `vitest` runs test files in parallel workers against one database — the three suites pass together only with `--no-file-parallelism` (they interfere when run concurrently), each passes alone.
* The seed gives the Accounts user 63 unread notifications (one per seeded demand / cheque event); cosmetic.
* Not covered by this walk: the lockout path (5 failed logins), MFA enrolment, bulk "enable portal for all customers", right to erasure, CSV import on kinds other than area types, touch drag on the phone kanban (Move-to from the drawer was used instead). WCAG contrast is measured since 2026-10-26 (`docs/qa/contrast.mjs` + axe).

## Reproduce

```bash
su postgres -c "psql -c 'DROP DATABASE IF EXISTS kkt_qa_erp'"; su postgres -c "psql -c 'CREATE DATABASE kkt_qa_erp'"
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kkt_qa_erp REDIS_URL=redis://localhost:6379/13 API_PORT=4000 API_PUBLIC_URL=http://localhost:4000 \
  RUN_MIGRATIONS_ON_BOOT=true SEED_ON_BOOT=true ERP_ORIGIN=http://localhost:5173 LOG_LEVEL=warn pnpm --filter @kkt/api exec tsx src/server.ts &
VITE_API_URL=http://localhost:4000 pnpm --filter @kkt/erp build && pnpm --filter @kkt/erp preview --port 5173 --host &
node docs/qa/erp/browser-qa.cjs                       # full walk + axe scans, rewrites docs/qa/erp/*.png, prints the summary
node docs/qa/contrast.mjs erp                        # design-token contrast
ONLY=money REPORT=/tmp/qa.jsonl node docs/qa/erp/browser-qa.cjs   # one section; sections one at a time stay under the 10 logins/min limit
```
