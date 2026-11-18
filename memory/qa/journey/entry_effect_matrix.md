# Entry → Effect Matrix — source of truth (Phase F audit 2026-10-26 → Phase G closure 2026-10-26)

## Phase G closure (what changed — EXPECTED is now `backend/event_registry.py`; ACTUAL verified by `tools/effects_probe.py all`, `tests/effects/test_events.py` (15 tests), `tools/tieout.py` (22 PASS))
| Phase F gap | Status | Evidence |
|---|---|---|
| Cancellation refund never in ledger/daybook (P0) | **FIXED** — project cancellation policy → `refunds` (Pending→Paid, Accounts `payment.reverse` permission) → REFUND contra ledger rows per bucket, Roznamcha `cash_refunded`/`refunds`, cancellations report `refund_paid`/`refund_status`, CANCELLED receipt watermark | test_cancel_creates_refund_and_payout_posts_contra; g/05–08 screenshots; tie-outs 17–19 |
| Agreement revision not re-proportioning demands (P0) | **FIXED** — `money_ops.reproportion_open_demands` + `demand.reproportion` event | test_agreement_revision_reproportions_open_demands |
| Cancelled bookings' legacy demands inflate overdue (P0) | **FIXED** — `ledger.rebuild` closes demands of cancelled bookings; migration closed 179 demands (₹7.38 Cr) with audit rows; dry-run + applied reports in `migrations/` | tie-out 22 "cancelled bookings carry no open demands" |
| Three "outstanding" numbers | **FIXED** — `services/definitions.py` (Settings → Definitions page) used by read models + outstanding report + tieout; tie-out #8 root cause: report summed `due_paise` (nets advances) while home used Σmax(bucket,0) | tie-outs 8/10 PASS, Home = report = Σ summaries |
| Flat transfer absent | **BUILT** — `POST /bookings/{id}/transfer` (+ `/swap`): money follows customer, auto agreement revision, demands re-bound by stage code (due-now when stage already done), inventory flips, Journey | test_transfer_effects; g/03–04 |
| Cheque register Pending-only, no bounce charge | **FIXED** — register default All + `by_status` totals; project bounce policy → auto Other-charge demand + RM/Accounts/customer notification | test_cheque_bounce_raises_charge_and_notifies |
| Notifications 12/40 actions, role-only | **FIXED** — 44 registered events, party-based (assignee/RM/customer) + roles, idempotent per (audit_id,user), actor excluded | test_outbox_replay_is_idempotent |
| Lead ↔ booking unlinked | **FIXED** — wizard lead picker; walk-in creates Converted lead (source Walk-in); `lead.convert` event; cancel → lead Lost; visit No-show → Contacted + follow-up | test_booking_create_effects, test_lead_convert_effects |
| Customer 360 timeline payments-only | **FIXED** — `/customers/{id}/events` from outbox (all entity kinds, chips, deep links) | test_customer_events_timeline_has_mixed_kinds; g/09 |
| Project workspace no money | **FIXED** — project/block read models carry paid/collections/outstanding/overdue/advance/refunds; MONEY events invalidate them | probe payment_cash: project/block summaries change |
| Payment reversal no contra in roznamcha / no watermark | **FIXED** — `reversals` + `cash_reversed` on reversal day; REVERSED watermark | test_payment_reverse_effects |
| Customer rename not propagated | **FIXED** — fan-out to bookings/demands/tickets/refunds; receipts keep name-as-printed + `customer_name_current` | test_customer_rename_fans_out |
| Hand-kept cache prefix map | **FIXED** — `cache_prefixes(spec.surfaces)` from the registry (legacy map kept as additive fallback); widgets invalidated | probe: `stale_only=0` on money events |
| Journey panel / propagation health | **BUILT** — `GET /journey/{audit_id}`, `/journey/entity/{type}/{id}`, `/admin/propagation`; UI on bookings/payments; Settings card | g/01–02 (16 surfaces with before→after) |

### Remaining probe "missing" rows — each justified (`effects_probe.py all`, 2026-10-26)
- `notifications` (all scenarios): probe snapshots the **actor's** inbox; the actor is excluded from recipients by design. Verified instead by `notifications.audit_id` counts in tests.
- `demands` (payment/cheque): anchor booking has no open demand → receipt is an advance; FIFO leaves demands untouched (correct).
- `cheques` (cash payment), `bootstrap` (counts have no money), `flats` (stage mark), `customer360`/`bookings` (lead/service not linked to the anchor customer), `demand_manual` (scenario skipped: no un-demanded line): not applicable to that entry.
- `customer_edit`: probe edits a non-name field → no fan-out expected.

### Not done / carried to Phase H–J
- Site-visit entries are code-verified, not probed. Document/notice/user/catalogue events use entity-default surfaces (no party notifications).
- Swap endpoint has no UI. Cancellation policy GST uses fixed 18 %.
- `tests/test_phase_2.py::test_cheque_pending_clear_bounce_reverse` is order-dependent under xdist (module-level state); passes in isolation — pre-existing.

---


**Method.** Intent from `/app/docs/KKT_Technical_Documentation.md` (§13 plans/dues, §14 ledger engine, §15 roznamcha, §18 reports), `memory/PRD.md` + `prd_phase*.md`, code (`routers/*`, `events.py`, `services/read_models.py`, `routers/notifications.py`), tests and seed. **Actual** = code reading **and** execution on the preview DB with `backend/tools/effects_probe.py`, which snapshots 47 read surfaces, performs one entry, diffs at 2.5 s and again at 9 s (beyond every TTL), then restores (reverse / undo / revert). Raw probe diffs: `memory/qa/journey/probes/*.md`. Nine entries were executed live (cash payment, cheque post→clear, cheque post→bounce, lead stage, flat hold, construction stage mark, service status, manual other-charge demand, customer edit); all others are code-verified only and marked **(code)**. Preview data was restored afterwards; integrity report = 0 findings.

**Propagation mechanisms that exist today** (so gaps can be read precisely):
- `write_audit()` → `bus.publish("entity.changed")` → subscribers: audit log (always), notifications (`RULES` for 12 actions only), `read_models.mark_dirty` (project/customer summaries, dashboard/home, debounced flush), `ttlcache` invalidation (prefix map per entity type).
- Payment/ledger: `services/ledger.rebuild(booking_id)` recomputes the three ledgers + `booking.summary` synchronously inside the payment UoW (good: this is the single source for "paid/due").
- Everything else is **pull**: reports and most lists aggregate raw collections at request time (no read model), so they are consistent but slow; dashboards/home are read models refreshed by flush/sweep.

Legend — Severity: **P0** wrong number / money effect missing · **P1** effect missing on a surface users rely on · **P2** stale/cached/inconsistent presentation · **P3** cosmetic. "noise" = surface changed only by timestamps/request-ids (not a real effect).

---

## A. Sales & CRM

### A1. Lead create
- **Intent**: capture an enquiry so Sales can work it; feeds the funnel, follow-ups, enquiries-per-project, conversion.
- **Entry**: `POST /leads` (ERP), public website/brochure gate (parked), Expo portal (parked).
- **Validations**: phone/email format, project exists, assigned user active; dedupe on phone is **not** enforced (code) — duplicates allowed.
- **Direct writes**: `leads` (+`lead_number`), audit `lead.create`.
- **Expected effects**: leads list/board; sales-leads report (funnel, enquiries/project, response time); home `counts.leads_open`; bootstrap `new_enquiries` (website/brochure sources); staff notification to Sales/Marketing/Super Admin (RULE exists); assigned user notification; search index; customer timeline if converted later.
- **Actual**: leads list/board ✔ · sales-leads ✔ · home counts ✔ (after flush ≤ 2 s) · bootstrap counts ✔ (5 s cache) · notification ✔ (`lead.create` rule) · search ✔ (text index). **Follow-up reminder** (`nudge_loop`) ✔ for `next_follow_up_at`.
- **Gaps**: no duplicate-phone guard (P2); lead has **no `customer_id`/`booking_id` link** after conversion (see A3) (P1).

### A2. Lead stage change / assign  *(probed: `lead_stage`)*
- **Intent**: pipeline truth; Lost reasons feed marketing; Converted closes the loop to a booking.
- **Entry**: `POST /leads/{id}/stage` (drag on board, drawer, Undo), `PATCH /leads/{id}` (assign).
- **Validations**: `STAGES` membership, `lost_reason` required for Lost, optional `version`.
- **Direct writes**: `leads.status/updated_at/activities[]`, audit `lead.stage`.
- **Expected**: board/list ✔, sales-leads funnel ✔, home `leads_open` ✔, audit ✔; notification to the **new assignee** on assign; customer 360 timeline if the lead belongs to a customer; conversion → booking link.
- **Actual (probe)**: changed = leads.board, leads.list, dashboard.home (counts), report.sales_leads, audit ✔. Not changed: notifications (no rule for `lead.stage`/`lead.assign`), customer.360 (no link).
- **Gaps**: no assignee notification (P1); "Converted" is a free stage move — nothing checks that a booking exists, and bookings never write back `lead_id` → **conversion metric is self-reported** (P1); search/noise fine.

### A3. Site visit book / complete / no-show / cancel
- **Intent**: schedule a slot, remind, record outcome; outcome moves the lead stage; visits-today on home; conversion funnel.
- **Entry**: `POST /site-visits`, `POST /site-visits/{id}/status`.
- **Validations**: slot capacity, date not past, lead/customer link.
- **Writes**: `site_visits`, `leads.status` → "Site Visit Scheduled/Done" (code: on book & complete), audit `visit.*`.
- **Expected**: visits calendar/list; lead board; home `visits_today` + `visits_today_list`; bootstrap `visits_today`; nudges (reminder) to assignee; sales-leads report (visit→booking conversion); customer 360 timeline.
- **Actual (code)**: list/calendar ✔, lead stage sync ✔ (book/complete), home ✔, bootstrap ✔, reminder nudge ✔, audit ✔. No-show/Cancel **do not** touch the lead stage (stays "Site Visit Scheduled") (P1). Visits are not in customer 360 timeline (payments-only timeline) (P1). Sales-leads report has no visit conversion rate (P2).

## B. Customers

### B1. Customer create / edit / KYC  *(probed: `customer_edit`)*
- **Intent**: single party master for bookings, receipts (name on receipt), KYC compliance, communications.
- **Entry**: `POST/PATCH /customers`, `PATCH /customers/{id}/kyc`, quick-create sheet in wizard.
- **Validations**: phone unique (409), PAN/Aadhaar format, version; pincode from locality (Phase E fix).
- **Writes**: `customers`, audit `customer.create|update|kyc`.
- **Expected**: customers list/360 ✔; **denormalised `customer_name` on bookings/payments/receipts** must follow renames; search; KYC pending counters; portal account.
- **Actual (probe edit)**: customer.360 ✔, search ✔, audit ✔. **Bookings/payments/ledger keep the old `customer_name` snapshot** — receipts and reports show the stale name after a rename (code: no fan-out) (P1 — receipts are legal documents; acceptable only if intentionally "name as at receipt"; decide & document). KYC status changes have no notification and no home tile (P2).

## C. Bookings & agreement

### C1. Booking create (wizard)  **(code)**
- **Intent**: convert an available unit to a sold unit with an agreement split (cash/account/other), a plan snapshot and a stage-triggered demand schedule; this is the root of every financial surface.
- **Entry**: `POST /bookings` (7-step wizard; idempotent).
- **Validations**: flat Available & version, customer exists, split sums to price, plan applicable to block, duplicate active booking per flat (409).
- **Writes (one UoW)**: `bookings` (+number, `flat_snapshot`, `payment_plan_snapshot`, `summary` via `ledger.rebuild`), `flats.status=Booked`, `demands` for already-completed stages (catch-up), `ledger_entries` (agreement lines), audit `booking.create`, `flat.status`.
- **Expected**: inventory grid & counters; block/project summaries; home totals (bookings, agreement, outstanding); customer 360 (bookings, financial summary); booking detail/ledgers/schedule; outstanding, inventory, sales-velocity, demand-vs-collection reports; roznamcha? (no cash) ; notifications to Accounts/PM ("new booking"); portal account creation; lead → Converted; search.
- **Actual**: ledgers/summary/schedule ✔ (synchronous), inventory ✔, read models ✔ (≤ 2 s), reports ✔ (pull), search ✔, audit ✔. **No notification rule for `booking.create`** (P1). Lead not linked/converted (P1, see A2). Portal account only when surfaces enabled (parked, by design).

### C2. Payment plan selection / acceptance  **(code)**
- **Intent**: freeze the installment schedule (snapshot) so later template edits don't change signed agreements; acceptance is an evidence record.
- **Actual**: snapshot ✔, `plan_acceptance` ✔, dues engine reads snapshot ✔, schedule surface ✔. Changing the block's template later does **not** notify PM/Accounts about bookings on the old snapshot (P2). Plan PDF exists ✔.

### C3. Agreement revision (cash / account / other)  **(code)**
- **Intent**: re-split or add other charges after booking; must re-cap buckets, re-raise/reshape demands, keep audit immutable.
- **Entry**: `POST /bookings/{id}/agreement-revisions` (split change and other-charge lines).
- **Actual**: version check ✔, ledger rebuild ✔, summary ✔, `agreement_revisions[]` ✔, audit ✔. **Existing demands are not re-proportioned** after a cash/account re-split: `cash_demand_paise/account_demand_paise` on raised demands keep the old split, so demand-vs-collection and the schedule show the old proportions until the next stage (P0 for the schedule surface; ledger totals stay correct). No notification (P2).

### C4. Booking cancellation / refund  **(code + data evidence)**
- **Intent**: release the unit, close the schedule, record refund/deduction, show in cancellations report and roznamcha (cash out).
- **Entry**: `POST /bookings/{id}/cancel {reason, refund, deduction}`.
- **Actual**: flat → Available ✔, booking status ✔, demands → `status: "Cancelled"` ✔ (current code), cancellations report ✔, audit ✔. **Refund is stored only as `cancellation.refund_paise` — no payment/ledger/roznamcha row** (0 refund entries in DB; 38 cancelled bookings with money paid) (P0: cash actually leaves the business and never appears in daybook/bank/collections). **Historic cancelled bookings still have `Open/Partially Paid` demands** (129 rows) because older cancel paths did not close them — these leak into home overdue (see tie-outs) (P0). No notification to Accounts/customer (P1). Customer 360 financial summary still sums cancelled booking balances (P1).

### C5. Flat transfer / swap  **(code)**
- **Intent**: move an agreement to another unit (or between customers) keeping money history.
- **Actual**: **no transfer/swap endpoint exists** (`grep transfer|swap routers/` → none; spec §13 lists it). Today the only path is cancel + re-book, which loses receipt history on the new booking and records a fake "refund". If implemented naively, demands would keep the old block's `trigger_stage_id` — Phase G must re-bind them (P1 missing feature; P0 if done by cancel+rebook).

### C6. Flat hold / release / block  *(probed: `flat_hold`)*
- **Intent**: temporarily reserve or quarantine inventory; drives availability on every inventory surface.
- **Actual (probe)**: inventory list, block grid, block/project read models, project workspace, legacy dashboard, inventory report, audit ✔. **`dashboard/home` totals (`units/available`) did not change** within 9 s: the `flat` entity does not invalidate the `home:` cache and `mark_dirty` for dashboards is not triggered by flat status (P2 — stale up to the next flush/sweep). Hold has no expiry/auto-release and no notification to Sales (P2).

## D. Money

### D1. Payment post — Cash / Account / Other, by mode  *(probed: `payment_cash`, `cheque_clear` (pending leg))*
- **Intent**: the receipt. Must hit exactly one ledger (bucket cap), update dues/schedule FIFO, appear in roznamcha, collections, bank receipts, customer 360, dashboards; cheques start Pending.
- **Validations**: bucket cap (`BUCKET_EXCEEDS_AGREED`), mode/instrument rules, idempotency key required, booking Active, date not future.
- **Writes**: `payments`, `ledger_entries`, `demands.paid_paise/status` (FIFO), `bookings.summary` (rebuild), audit `payment.post`, receipt number.
- **Actual (probe, cash)**: 29 surfaces changed — booking detail/summary, 4 ledgers, schedule/demands, customer 360 + ledgers + timeline, dashboard.home totals, legacy dashboard, payments list/totals/summary, roznamcha, collections, outstanding, statement, bank-receipts, activity, audit, statement PDF ✔. Not changed: **notifications** (no `payment.post` rule — spec §14 says Accounts/RM see receipts) (P1); **project workspace / project & block read models** carry no collection figures (only inventory) so "collected" per project is absent from the workspace (P1); `dashboard.widgets` stale 60 s TTL and not invalidated by payment (P2); `report.cheques` unaffected for cash ✔.
- **Cheque (pending leg)**: cheques-in-hand ✔, cheque register ✔, roznamcha shows as pending ✔, **ledger not affected until clear** ✔ (correct), payments.summary ✔.

### D2. Cheque pending → cleared / bounced  *(probed)*
- **Clear**: ledgers, summary, schedule, customer surfaces, collections/outstanding/bank-receipts, roznamcha, cheques register, home ✔ (25 surfaces). **No notification** on clear (P2).
- **Bounce**: cheques register, payments summary, roznamcha, bounced widget, home, notification ✔ (`payment.bounce` rule) ✔; ledger untouched ✔ (never cleared). Bounce charges (penalty other-charge) are **not** auto-raised (spec §14 mentions configurable bounce charge) (P1).

### D3. Payment reversal / void  *(exercised as probe restore; code)*
- **Intent**: correct a wrong receipt without deleting history (contra entry).
- **Actual**: `payments.status=Reversed`, ledger contra ✔, demands re-opened FIFO ✔, summary ✔, notifications retracted (`notifications_retracted`) ✔, audit ✔, collections exclude ✔. Receipt PDF of a reversed payment still renders without a "REVERSED" watermark (P1). Roznamcha shows the original receipt on its day but the reversal only via status, not as a dated contra line on the reversal day (P1 — daybook of the reversal day does not balance to cash movement).

### D4. Demand raise (plan / stage / manual) / void  *(probed: `demand_manual` skipped — no un-demanded manual line; stage-triggered via `stage_mark`)*
- **Intent**: tell the customer what is due and when; drives overdue, forecast, dues engine, notifications.
- **Actual**: stage mark raised demands on all active bookings of the block ✔ (probe: schedule/demands, ledgers (demand lines), outstanding, dvc, construction progress, statement, notifications `demand.create` ✔, home overdue ✔). **There is no demand void endpoint** (only booking-cancel closes them) (P1). Demand PDF/letter ✔. Customer-facing notification only via portal (parked).

### D5. Construction stage mark / undo / photo  *(probed: `stage_mark`)*
- **Intent**: progress truth → demands, construction-vs-plan, customer updates, PM dashboards.
- **Actual**: 28 surfaces incl. milestones, block grid/summary, project workspace, demands, ledgers, home, dvc, construction-progress report, statement PDF, notifications ✔. Undo ✔ blocked when a stage demand has money (correct). Photo upload: documents + audit only; no notification/customer feed (P2).

### D6. Rate card apply / PLC / flat price edit  **(code)**
- **Intent**: pricing of unsold inventory; must never touch booked snapshots.
- **Actual**: `price_paise` on flats, `bulk-price`, audit ✔; booked flats excluded ✔; inventory value on home/legacy/inventory report ✔ (pull/read model). No price-history on the flat (only audit) (P2).

### D7. Project / tower setup changes (plan assignment, stage sequence)  **(code)**
- **Actual**: `construction_stages` rebuilt, `milestones` legacy mirror ✔, audit ✔. Changing sequence after bookings exist leaves raised demands pointing at old `trigger_stage_id` (P1); no notification to PM/Accounts (P2).

## E. Service, documents, notices

### E1. Service ticket create / update / close / reopen / rating  *(probed: `service_status`)*
- **Actual**: list/kanban ✔, SLA report ✔, home `tickets_open` ✔, audit ✔; `service.create` notification ✔ (assignee/Support); **status changes do not notify assignee or customer** (P1); rating only via portal (parked); customer 360 shows tickets ✔ (panel), timeline no (P2).

### E2. Document upload / share  **(code)**: documents + audit ✔; KYC completeness not recomputed from documents (P2); base64/GridFS storage, no object storage/thumbnails (Phase J).
### E3. Notice  **(code)**: notices collection + notification fan-out ✔; not in customer timeline (P2).

## F. Admin

### F1. User / role / permission change  **(code)**: immediate (permission check reads role each request) ✔, sessions not revoked on role downgrade (P1), audit ✔, no notification to the user (P2).
### F2. Catalogue item add / deactivate  **(code)**: `catalogues_version` bump → bootstrap ETag + bundle cache ✔; deactivated items still referenced by old records render by snapshot label ✔.

---

## Summary table

| Entry | Expected surfaces | Implemented | Missing / wrong | Stale only | Worst |
|---|---|---|---|---|---|
| Lead create | 9 | 8 | dedupe guard | — | P2 |
| Lead stage/assign | 7 | 5 | assignee notification; lead↔booking link | — | P1 |
| Site visit lifecycle | 8 | 6 | no-show/cancel → lead stage; 360 timeline | — | P1 |
| Customer edit/KYC | 7 | 5 | name fan-out to receipts/bookings; KYC tile | — | P1 |
| Booking create | 14 | 12 | notification; lead conversion link | — | P1 |
| Plan select/accept | 4 | 4 | — | — | — |
| Agreement revision | 7 | 5 | demand re-proportion; notification | — | **P0** |
| Cancellation/refund | 10 | 6 | refund ledger/roznamcha; legacy open demands; notification; 360 sums | — | **P0** |
| Flat transfer | 8 | 0 | feature absent (cancel+rebook workaround) | — | P1 |
| Flat hold/release/block | 9 | 8 | — | home totals | P2 |
| Payment post (cash/acct/other × mode) | 20 | 17 | notification; project collected KPI | widgets | P1 |
| Cheque clear/bounce | 14 | 13 | bounce charge; clear notification | — | P1 |
| Payment reversal | 10 | 8 | REVERSED watermark; dated contra in roznamcha | — | P1 |
| Demand raise/void | 10 | 9 | void API | — | P1 |
| Stage mark/undo/photo | 12 | 11 | photo feed | — | P2 |
| Rate card / price edit | 5 | 5 | price history | — | P2 |
| Project/tower setup | 6 | 4 | re-bind demands; notification | — | P1 |
| Service ticket lifecycle | 8 | 6 | status notifications; 360 timeline | — | P1 |
| Document / notice | 5 | 4 | timeline | — | P2 |
| User/role/catalogue | 6 | 5 | session revoke on downgrade | — | P1 |

**Totals**: 179 expected effects · 141 implemented (79 %) · 36 missing/wrong · 2 stale-only. P0 count: 3 (agreement revision demand split, cancellation refund not in ledger/daybook, legacy open demands on cancelled bookings polluting overdue). Endpoint names: agreement revision = `POST /bookings/{id}/agreement-revisions`.

**Cross-cutting observations**
1. Notifications cover 12 of ~40 actions; the rules table is the only fan-out and is role-based, not party-based (no "notify the assignee/RM of this booking").
2. Three different "outstanding"/"overdue" numbers exist (home read model, outstanding report, Σ booking.summary) — see `reports_audit.md`.
3. Customer 360 "timeline" = payments only; visits, demands, stages, tickets, documents, notices are not in it.
4. Read models exist only for project/customer summaries + home; project workspace carries no money, so "where did this receipt go?" cannot be answered from the project screen.
5. Caches: `flat` and `service_request` entities don't invalidate `home:`; widgets 60 s TTL un-invalidated.
6. The audit log is complete (every probe produced the expected `audit.*` rows) — it is the only surface with 100 % coverage and the right backbone for a per-entry "Effects/Journey" panel (Phase G).

## G.1 tester fixes (2026-10-26)
- payment.post: Journey now shows before→after on bookings/demands/ledgers/customer360/home/roznamcha/projects/blocks/refunds/notifications (10 of 17 surfaces); rest state the action.
- booking.cancel: refund = received − policy deduction − demanded-unpaid penalty charges; service charges voided; nil → Forfeited.
- booking.transfer: cash split field, demands re-proportioned + telescoped, re-bound to new tower; booking.transfer event → Customer 360 "Transfers/Revisions".
- refund.pay CASH: 422 CASH_INSUFFICIENT when > cash in hand; Roznamcha closing = opening + receipts − deposits + withdrawals − cash refunds.
