# Part III — Modules

Each module section states its purpose, the ERP screens, inputs and validation, the algorithm (as pseudo-code), edge cases, permissions and the API surface (full list in Appendix A). File paths are given so engineers can verify every statement against the code.

## 5. Master data & selection-driven design

**Why.** Free-text is the root cause of inventory and finance errors (a "3BHK" here, "3 BHK" there). KKT models every repeated value as a master (`routers/master.py`, generic CRUD over `master_<kind>` collections: flat types, floor-plan templates, PLC types, charge types, amenities, banks, document types, specification items, room types, area types, teams, construction stage masters, milestone templates). Dependent documents reference the master by `id` **and snapshot the fields they need**, so edits never rewrite history.

| Rule | Behaviour |
|---|---|
| Duplicate names | `DUPLICATE_NAME` 409 on create/rename (case-insensitive); the ERP sheet warns inline before submit (`master-dupe-warning`) |
| Deactivate vs delete | Masters are never deleted; `is_active=false` hides them from pickers while existing references keep working |
| Rapid entry | "Save & add another" keeps the sheet open, resets the form and counts additions |
| Versioning | Every master carries `version`; stale PATCH → `VERSION_CONFLICT` |

**Floor Plan Templates** define the positions on a floor: `[{position, flat_type_id, facing, plc_type_ids[]}]`. A block assigns templates to **floor ranges** (`floor_plans: [{from_floor, to_floor, template_id}]`) and declares `skip_floors` (e.g. 13), `refuge_floors` (no units) and `podium_floors` (counted but unit-free). Numbering patterns are expressions on the block — `flat_number_pattern` e.g. `{floor}{position:02d}` → `1201`, `floor_label_pattern` e.g. `G`, `P1`, `{floor}`.

## 6. Flat generation algorithm (`services/flat_generation.py`)

```
generate_flats(block, floors=None, user):
  plan  = resolve_positions(block)              # floor → [positions] from floor ranges, minus skip/refuge/podium
  floors = requested floors ∩ plan.keys()       # None = all
  fts   = load_flat_types(all flat_type_ids in plan)   # fails INVALID_FLAT_TYPE if inactive/missing
  seq = 0
  for floor in sorted(plan):                    # seq is block-wide and deterministic → stable numbering
    for pos in sorted(plan[floor] by position):
      seq += 1
      if floor in floors: docs.append(build_flat(block, fts[pos.flat_type_id], floor, pos, seq, user))
  with unit_of_work():                          # insert_many ordered; on failure delete the inserted ids
    flats.insert_many(docs)
  refresh_counts(block, project)                # unit_counts by status for dashboards
```

`build_flat` snapshots the flat type (`flat_type_snapshot`: name, bhk, areas, base rate) and calls `compute_price` (§7). Guards: **regenerate** is refused while any flat in the block is `Hold/Booked/Sold` (`STATUS_LOCKED`); **append floors** generates only the new floors with the continuing sequence; **re-snapshot** (`resnapshot_flat`) refreshes a single Available flat from its current type.

## 7. Pricing engine

| Element | Where | Rule |
|---|---|---|
| Base rate | block `rate_per_sqft` else flat type `base_rate_per_sqft` | ₹/sq.ft on super built-up (`area_values.super_builtup_sqft`) |
| Lump-sum price | flat type `base_price` | overrides rate × area; breakup has one line |
| Floor rise | block `floor_rise_per_sqft` × (floor − `floor_start`) × SBU | added as a breakup line |
| PLC | `master_plc_types` with `calc_mode` ∈ {per_sqft, percent, fixed} | applied per flat from floor-plan positions (`plc_ids`) |
| Rate cards | `routers/rate_cards.py` | dated rate per project/block; **apply** rewrites price breakup of **Available** flats only, bulk, audited |

```
compute_price(ft, block, floor):
  if ft.base_price: return (None, base_price, [lump-sum line])
  rate = block.rate_per_sqft or ft.base_rate_per_sqft; sbu = ft.super_builtup_sqft
  if rate is None or sbu is None: return (rate, None, [])
  rise = block.floor_rise_per_sqft × max(0, floor − block.floor_start)
  breakup = [Base rate × sbu] + [Floor rise line if rise]
  return (rate + rise, Σ breakup, breakup)
```

Prices are stored in rupees on flats (display) and converted to integer paise the moment they enter an agreement (`services/money.to_paise`).

## 8. Projects, blocks, flats & inventory UI

- **Block wizard** (`pages/BlockWizard.jsx`): basics → floors (start, count, skip/refuge/podium) → floor-plan ranges → numbering → review (preview of generated numbers) → generate.
- **Inventory grid 2.0** (`pages/BlockDetail.jsx`): floor rows × positions, colour by status, legend, search, bulk actions (hold, block, price apply, type re-snapshot), cell drawer with price breakup and booking link; mobile card rows.
- **Parking** (`routers/parking.py`): slots per block (`covered/open/stilt`), allotment at booking (`PARKING_NOT_AVAILABLE` guard), release on cancel.
- **Specifications & approvals**: per project lists of specification items (master) and approvals (RERA, NOCs) with dates, surfaced on the website when published.
- **Tower status**: `construction_percent` derived from completed stages (§12).

## 9. Customers & KYC (`routers/customers.py`, `services/kyc.py`)

| Field | Validation | Storage |
|---|---|---|
| Phone | normalised to 10 digits starting 6–9 (`normalize_phone`) | plain; unique per company (dedupe key) |
| PAN | `[A-Z]{5}[0-9]{4}[A-Z]` | Fernet ciphertext + HMAC hash; masked output |
| Aadhaar | 12 digits + Verhoeff checksum (`verhoeff_valid`) | ciphertext + hash; masked `XXXX XXXX 1234` |
| Bank | IFSC `^[A-Z]{4}0[A-Z0-9]{6}$`, account masked to last 4 | ciphertext |
| Co-applicants | same rules, `INVALID_CO_APPLICANT` | embedded |

Dedupe: on create, a match on phone **or** PAN hash returns 409 `DUPLICATE` with the existing customer id. **Portal provisioning**: `POST /customers/{id}/portal-access` creates the portal account with a temporary password (returned once), `must_change_password=true`; reset re-issues. **Customer 360** (`pages/CustomerDetail.jsx`) tabs: profile & KYC (reveal with permission), bookings, ledger, documents, tickets, notifications, audit.

## 10. Leads pipeline (`routers/leads.py`, `routers/visits.py`)

- **Sources**: Walk-in, Website, Referral, Broker, Campaign, Brochure, Site Visit. Website/Brochure/Site-Visit leads are created by public endpoints with IP, UTM and honeypot checks.
- **Stages**: New → Contacted → Site Visit Scheduled → Site Visit Done → Negotiation → Converted | Lost; every change appends `stage_history {status, at, by, note}`.
- **Round-robin assignment** (`visits._assignee`): active Sales users sorted by id; `counters{scope:"round_robin"}` increments atomically; `site_settings.round_robin_assignment=false` pins to the first rep.
- **Dedupe**: a public submission reuses the open lead (same phone + project, stage ∉ {Lost, Converted}) instead of creating a duplicate; the event becomes an **activity** instead.
- **Activities timeline** (`activities[]`): `brochure_downloaded`, `site_visit_booked`, `site_visit_rescheduled`, `site_visit_cancelled`, `site_visit_completed`, `site_visit_no_show`, `stage_reverted`; rendered newest-first in the lead drawer.
- **Follow-ups**: dated tasks with `next_follow_up_at`; dashboard "Follow-ups due" widget.
- **Conversion** (`POST /leads/{id}/convert`): creates/links a customer (dedupe by phone/PAN), sets `Converted`, `converted_customer_id`; `LEAD_CONVERTED` blocks further edits; `USE_CONVERT` blocks manual stage jumps to Converted.

## 11. Booking engine (`routers/bookings.py`, `pages/BookingWizard.jsx`)

**Wizard v2 steps**: 1 Project & block → 2 Unit (grid, only Available/Hold selectable) → 3 Agreement (value, ₹/% cash split, auto-balance, rounding to the rupee, Σ check) → 4 Customer (search or create inline) → 5 Payment plan (assigned plans for the tower, default pre-selected, schedule preview with catch-up badge) → 6 Other charges & parking → 7 Review & confirm. Drafts autosave to `bookings{status:"Draft"}` and resume; the unsaved-changes guard warns on navigation.

```
confirm_booking(draft, Idempotency-Key):
  flat = flats.find_one_and_update({id, status ∈ {Available, Hold}}, {$set: {status: Booked, booking_id}})   # atomic lock
  if not flat: 409 NOT_AVAILABLE
  with unit_of_work():                                            # rollback releases the flat
    booking = {buckets: cash_agreed_paise, account_agreed_paise (Σ = agreement_value), other_charges[], parking}
    booking.payment_plan_snapshot = deep copy of chosen plan (installments, triggers) + accepted_at/by
    booking.booking_number = generate_number("booking")           # BK-{FY}-{SEQ}
    insert booking; allot parking; raise_other_charges(trigger="ON_BOOKING")
    dues_engine.raise_due_installments(booking)                   # catch-up: every installment whose trigger already happened
  publish booking.create → audit, customer notification, RM notification
```

| Rule | Detail |
|---|---|
| Agreement split | cash + account = agreement value; either may be 0; both integers (paise) |
| Agreement revisions | allowed while Active; a revision stores `before/after` and is an `AGREEMENT_CHANGE` ledger event; a bucket cannot be revised **below what is already received** (`BELOW_PAID`) |
| Other charges | lines from charge-type master with GST %, trigger ON_BOOKING / ON_DEMAND / ON_POSSESSION; separate ledger |
| Cancellation | `refund ≤ paid` (`REFUND_EXCEEDS_PAID`); deduction recorded; flat → Available; parking released; demands voided |
| Handover | Active → Completed only when outstanding = 0 (`PENDING_PAYMENTS`); flat → Sold |

## 12. Construction stages & tower status (`routers/construction.py`)

- **Master sequence** (`construction_stages`): ordered stage names (Foundation … Possession) with `is_possession` flag; copied into each block as `block.construction_stages[{stage_id, seq, name, status, completed_on, completed_by, notes, visible_to_customers}]`.
- **Set current stage**: completes the chosen stage and every earlier Pending stage with the same date (jump-ahead is allowed and logged); `construction_percent = completed / total × 100` (rounded).
- **Photos**: per stage, object storage, `visible_to_customers` flag; thumb/medium variants; portal shows only visible photos of visible stages.
- **Undo rule (exact)**: only the **last completed** stage can be undone; the undo voids the unpaid demands that stage raised; if any such demand has a payment, undo is refused with 409 `UNDO_BLOCKED_BY_PAYMENTS`; `completed_at/by/on` are cleared; unread notifications about the stage/demands are deleted and read ones are marked `withdrawn`.
- **Notifications**: customers of Active bookings in the block get `stage.completed` (and `demand.raised` for the demands it triggered); RMs get the ERP equivalent.

## 13. Payment plans & the auto-dues engine (`routers/bookings.py` plans, `services/dues_engine.py`)

**Plan master**: `{name, installments: [{seq, name, percent, trigger_type, trigger_stage_id?, days_after_booking?, fixed_date?, due_days}]}`; validation requires Σ percent = 100 (±0.005), unique seq, stage triggers referencing active stage masters. **Trigger types**: `ON_BOOKING`, `ON_STAGE` (construction stage completed), `DAYS_AFTER_BOOKING`, `ON_DATE`, `ON_POSSESSION`. **Assignments**: plan ↔ project or tower with a default flag; assigning a stage-triggered plan to a tower that lacks those stages → 409 `PLAN_NOT_APPLICABLE`; a plan with active bookings is `PLAN_LOCKED` for installment edits.

```
raise_due_installments(booking, today):                       # idempotent; runs at booking, on stage completion, daily 00:30 IST
  if booking.status ≠ Active or no snapshot: return []
  existing = non-void demands of booking
  raised   = {installment_seq} ∪ absorbed seqs;  raised_names = {lower(installment_name)}
  cum      = Σ existing.percent  (or max cumulative_percent for legacy rows)
  for ins in snapshot.installments sorted by seq:
    if ins.seq ∈ raised or lower(ins.name) ∈ raised_names: continue       # belt and braces beyond the unique index
    td = trigger_date(ins, booking, block); if td is None or td > today: continue
    before = (pct_of(cash_agreed, cum), pct_of(account_agreed, cum))
    cum = round(cum + ins.percent, 2); if cum ≥ 99.995: cum = 100           # telescoping: last installment absorbs rounding
    new  = (pct_of(cash_agreed, cum), pct_of(account_agreed, cum))
    demand = {cash: new.c − before.c, account: new.a − before.a, total, demand_date: td, due_date: td + due_days, status: Open}
    try insert (unique partial index on (booking_id, installment_seq) where voided ≠ true) except duplicate: continue
    notify customer + RM
```

> Telescoping guarantees Σ demands = agreed amount to the paise: each demand is the difference between cumulative rounded amounts, so rounding never accumulates.

**Integrity report & repair** (`services/integrity.py`): for every Active booking compares snapshot, stages and demands. Finding kinds: `unsatisfied_trigger` (demand exists but its stage is not complete / date not reached), `missing_demand` (trigger satisfied, no demand), `duplicate_demand` (same seq twice), `unmapped_demand` (legacy demand without `installment_seq`), `summary` mismatch (Σ demands ≠ expected cumulative). `repair()` voids unearned **unpaid** demands (`void_reason`), raises missing eligible ones through the engine and skips anything with payments; the report is logged at startup and nightly and Super Admins are notified when `ok=false`.

## 14. Payment ledger engine (`routers/payments.py`, `services/ledger.py`, `services/money.py`)

- **Money** is integer paise everywhere in storage and arithmetic; `present_money` adds rupee floats for display; `amount_in_words` renders Indian grouping ("Rupees Twelve Lakh Fifty Thousand Only").
- **Categories**: `Cash` bucket, `Account` bucket (cheque/NEFT/loan), `Other charges` (against a charge line). Modes: CASH, UPI, NEFT_RTGS, CHEQUE, DD, LOAN_DISBURSEMENT. `CLEAR_IMMEDIATELY = {CASH, UPI, NEFT_RTGS, LOAN_DISBURSEMENT}`; cheques/DDs start `Pending` and are cleared/bounced later.

> **Owner's principle — track, don't gate.** A buyer may pay before a demand is raised, pay more than the current demand, or pay only into one bucket. The ledger records every rupee against the bucket chosen and shows advances and running balances; the only hard stop is the **bucket cap** — a bucket cannot receive more than its agreed amount (`_check_cap` → 409 with the exact figures and the instruction to revise the agreement first).

```
post_payment(body, Idempotency-Key):
  booking must be Active (NOT_ACTIVE); amount > 0; category/mode valid; bank account valid for Account mode
  _check_cap(booking, payment)                       # bucket_paid(category) + amount ≤ agreed(category)
  status = Cleared if mode ∈ CLEAR_IMMEDIATELY else Pending
  receipt_number = generate_number("receipt", company, payment_date)     # {PREFIX}/{FY}/{SEQ}, FY = Apr–Mar
  with unit_of_work():
    insert payment; if Cleared: allocate to open demands of that bucket oldest-first (paid_paise, status) ; rebuild(booking)
  publish payment.create → audit; customer notification "Receipt R/2526/0042"; RM notification
clear_payment / bounce_payment: Pending → Cleared (allocate + rebuild) | Bounced (no ledger effect)
reverse_payment(reason): Cleared → Reversed; de-allocate; append REVERSAL event; rebuild
```

**Ledger table computation** (`ledger.rebuild`): collect events — DEMAND (posted_at), OTHER_CHARGE_DEMAND, PAYMENT/OTHER_CHARGE_PAYMENT (posted_at), REVERSAL, AGREEMENT_CHANGE, CANCELLATION — sort by (time, kind-order), then walk: track `pct` (cumulative demanded %), `cash_paid`, `account_paid`, agreed amounts as of each revision; per row emit `demanded`, `received`, `cash_balance`, `account_balance`, `advance` (received beyond demanded, per bucket) and `total_due`. Rows are persisted in `ledger_rows` and re-derived on every posting, so the statement is always reproducible.

### 14.1 Worked example — ₹1 Cr agreement, ₹60 L account + ₹40 L cash, 10 equal installments

| # | Installment (10 %) | Cumulative | Account demand | Cash demand | Total demand | Running due (if unpaid) |
|---|---|---|---|---|---|---|
| 1 | On booking | 10 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹10,00,000 |
| 2 | Foundation | 20 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹20,00,000 |
| 3 | Plinth | 30 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹30,00,000 |
| 4 | 1st slab | 40 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹40,00,000 |
| 5 | 3rd slab | 50 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹50,00,000 |
| 6 | Top slab | 60 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹60,00,000 |
| 7 | Brickwork | 70 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹70,00,000 |
| 8 | Plaster | 80 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹80,00,000 |
| 9 | Flooring | 90 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹90,00,000 |
| 10 | Possession | 100 % | ₹6,00,000 | ₹4,00,000 | ₹10,00,000 | ₹1,00,00,000 |

With a 33.33 % / 33.33 % / 33.34 % plan the engine would demand ₹33,33,000 / ₹33,33,000 / ₹33,34,000 (cumulative rounding), never ₹33,33,333.33. If the buyer pays ₹15 L cash after installment 1, the ledger shows cash demanded ₹4 L, received ₹15 L, **advance ₹11 L**, and the next cash demands are satisfied from the advance automatically; the cash bucket caps at ₹40 L.

**Roznamcha** (`routers/roznamcha.py`): daily cash book — opening cash = previous closing; receipts (CASH mode, Cleared, by payment_date) in; cash deposits to bank and expenses out as **contra** entries; closing = opening + in − out; printable per day with denominations optional. **Recompute/reconcile** (`admin.reconcile_all`) rebuilds every ledger and flat/booking counters.

## 15. Documents & media (`routers/documents.py`, `services/thumbs.py`)

Documents: `{entity_type, entity_id, document_type_id, title, file_name, mime, size, storage_key, is_sensitive, shared_with_customer}`; upload validated by magic bytes; sensitive documents are never public (`SENSITIVE_DOCUMENT`); `shared_with_customer` exposes them in the portal through signed links. Images get `thumb` (480 px) and `medium` (1080 px) WebP variants, pre-generated at upload and at startup, served with immutable caching and strong ETags (`?size=thumb|medium`).

## 16. Service requests (`routers/support.py`)

Ticket `{ticket_number, booking_id, category, priority, status, sla_due_at, internal_notes[], attachments[], rating}`. SLA hours by priority; an hourly job flags breaches (`service.sla_breach` audit + RM notification). Internal notes are ERP-only; customer replies and attachments flow through the portal; resolution notifies the customer who can rate (1–5) or reopen within the window.

## 17. Notifications (`routers/notifications.py`, `services/portal_notify.py`)

| Event | ERP targets | Portal (customer) |
|---|---|---|
| booking.create | RM, Project Admin | "Booking confirmed" |
| demand.raised / overdue | RM | "Installment due", "Payment overdue" |
| payment.create / cleared / bounced | Accounts | "Receipt issued", "Cheque cleared/bounced" |
| stage.completed / undone | — | "Construction update" (withdrawn on undo) |
| lead.brochure, visit.booked/cancelled/nudge | Assignee + Sales | — |
| service.* | Assignee | "Ticket updated" |
| integrity.failed | Super Admin | — |

Retraction: when a demand is voided or a stage undone, unread notifications referencing it are deleted; read ones get `withdrawn=true` and a "(withdrawn)" suffix; the portal hides withdrawn items and excludes them from the unread count. A startup sweep normalises legacy types and removes orphans.

## 18. Reports & PDFs (`routers/reports.py`, `routers/pdfs.py`, `services/pdf.py`)

| Report | Inputs | Logic | Output |
|---|---|---|---|
| Collections | date range, project, mode | Σ Cleared payments by day/mode/bucket | table + CSV |
| Outstanding & Ageing | as-of date | open demand balances bucketed 0–30/31–60/61–90/90+ | table |
| Advances | project | received beyond demanded per bucket | table |
| Cheques | status | Pending/Bounced instruments with ages | table |
| Cancellations & Refunds | range | cancellation records, deductions, refunds | table |
| Inventory | project/block | unit counts by status/type, value | table |
| Activity | range | audit log aggregation by actor/action | table |
| Sales velocity, Demand vs collection, Customer statement, Tower progress, Upcoming dues forecast | various | aggregations over bookings/demands/payments/stages | table |

PDF templates (`BrandedDoc`): receipt (number, words, mode, bank, bucket), demand letter (installment, % and amounts, due date, bank details), allotment letter, customer statement (ledger table), report exports and brochures.

## 19. Website + CMS (`routers/cms.py`, `routers/public.py`, `/app/site`)

- **CMS entities**: site settings (brand, contacts, offices, trust stats, social, round-robin), hero banners, testimonials, blog posts, gallery, legal pages, per-project `website` sub-document (slug, publish flag, hero images, highlights, FAQs, show prices, brochure, visit settings).
- **Public API hygiene**: whitelisted serializers, ETag/304, `Cache-Control`, no internal ids beyond slugs, prices only when `show_prices`.
- **SEO**: `/sitemap.xml`, `/robots.txt`, per-page meta + Open Graph via react-helmet-async, JSON-LD (Organization, RealEstateListing, FAQPage).
- **Enquiry flow**: `POST /public/enquiries` — 5/min/IP, honeypot `website`, consent, UTM captured, lead created (Website) with round-robin assignment and RM notification.
- **Performance**: click-to-load facades for YouTube/Vimeo/Matterport/Maps, responsive WebP `srcset` with blur-up and hero preload, route-level code splitting with hover prefetch, font preconnect/`display=swap`, zero third-party JS before interaction.

### 19.1 Brochure lead gate (`routers/visits.py`)

```seq
Visitor -> Site : clicks "Download brochure" (card / hero / section)
Site -> Site : modal; remembered visitor (localStorage) skips the form
Site -> API : POST /public/brochure-requests {slug, name, phone, email?, consent, utm, honeypot}
API -> API : rate limit 5/min/IP; honeypot → 200 no-op; project must have brochure & gate enabled
API -> DB : find open lead (phone+project) else create lead source=Brochure (round-robin)
API -> DB : push activity brochure_downloaded; notify assignee
API -> Site : {reference, download_url = /api/public/brochure/<signed 15-min token>}
Site -> API : GET download_url (auto-start)
API -> DB : nonce seen? no → count once (brochure_download_count++, brochure_downloads row)
API -> Visitor : PDF, Content-Disposition: attachment
```

### 19.2 Site-visit scheduler

Per-project settings `website.site_visits {enabled, visit_days[0–6], start_time, end_time, slot_minutes 30|60, capacity_per_slot, min_lead_hours, max_days_ahead, blackout_dates[], site_office_address, maps_url, instructions}`.

```
availability(project, from, to):                       # IST; cached 60 s per project+range
  for d in from..to:
    if not enabled or d.weekday ∉ visit_days or d ∈ blackout or d > today + max_days_ahead: slots = []
    else slots = [start, start+slot … < end] where slot_start ≥ now_IST + min_lead_hours
    booked[d, slot] = count(site_visits where status ≠ Cancelled)
    emit {date d, slots with available = capacity − booked > 0}

book(body):                                           # 5/min/IP, honeypot, consent
  slot must be in availability (SLOT_UNAVAILABLE); count < capacity (SLOT_FULL)
  lead = upsert (phone+project) source=Site Visit
  insert visit SV-{FY}-{SEQ} status=Confirmed; recount → if > capacity: delete & 409 SLOT_FULL   # atomic check-then-verify
  lead New/Contacted → Site Visit Scheduled; activity site_visit_booked; notify assignee + Sales role
  return {visit_number, date, slot, address, ics_url (signed), manage_url (signed)}
```

ICS: `VCALENDAR` with `VTIMEZONE Asia/Kolkata`, `DTSTART;TZID=Asia/Kolkata`, `LOCATION`, `URL` (maps), 1-hour `VALARM`. **Cancel** (visitor via signed link or ERP with reason) → Cancelled, activity; if it was the lead's only upcoming visit and the lead is at Site Visit Scheduled, the lead reverts to its previous stage (`stage_reverted`). **Reschedule** re-checks capacity excluding itself, status `Rescheduled` (counts as confirmed). **Complete** → lead Site Visit Done; **No-show** → activity. ERP module: calendar (day/week, slot rows × projects, chips with RM), list with filters and CSV, dashboard "Today's site visits", nudge job.

## 20. Customer portal (Expo, `/app/mobile`)

Architecture: Expo Router app compiled for web, iOS and Android against `/api/portal/*` only; separate auth (`aud=portal`, own refresh family, forced password change); screens — login, home (bookings with next installment), booking detail (schedule, ledger, receipts PDF viewer, documents, construction progress with notes and visible photos, payment plan), payments, service requests (create, reply, attach, rate), notifications (unread badge, read-all, withdrawn hidden), profile. Offline: last responses cached; responsive shell adapts to tablet/web widths. Public contracts are additive only; `test_portal_leaks.py` guards the payloads.
