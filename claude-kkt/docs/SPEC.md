# KKT — Product specification (owner's brief, verbatim)

You are a senior product architect and full-stack builder. Build a complete real-estate ERP platform called KKT for Indian builders/developers. Below is the full functional specification: every feature, rule, algorithm and flow. The only non-negotiables are the business rules, the algorithms, the security/privacy requirements and the quality bar described here.

====================================================================
0. PRODUCT OVERVIEW
====================================================================
KKT is ONE backend/database with THREE separate front doors:
  A) Marketing Website (public) – sells projects, captures enquiries, brochure downloads and site-visit bookings.
  B) ERP (staff) – runs the business: master data, inventory, customers, leads, bookings, construction, payment plans, payments/ledger, receipts, reports, CMS, service requests.
  C) Customer Portal (buyers; web + Android + iOS app) – each buyer sees their flat, ledger, receipts, demands, documents, construction photos, notices, raises service requests.
Each surface has its own look, its own login system and its own session; a staff token must never open portal data and vice versa. In production each surface runs on its own domain (www., erp., my.) against the same backend.

Theme: "royal deep navy + gold" (navy #0B1F3A family, gold #C9A227 family, ivory/white surfaces). ERP = dense, elegant, data-first. Website = cinematic, editorial luxury. Portal = premium consumer app, mobile-first.
Core design principle: EVERYTHING IS A SELECTION. Structural data (flat types, room sizes, areas, block types, amenities, stages, plans, charges) is defined once in master data; creating blocks, flats and bookings is done by picking from dropdowns, never by retyping sizes or names, so data entry becomes error-free.
Currency: INR with Indian grouping (₹1,00,00,000) and short forms (₹1.2 Cr, ₹45 L). All money stored as integer paise internally.
Single company for now, but every record carries a company id so multi-tenant mode can be switched on later without migration.

====================================================================
1. PERSONAS, ROLES & PERMISSIONS
====================================================================
Roles (system roles cannot be deleted; admin can create custom roles as bundles of permission codes):
- Super Admin: everything incl. users/roles, settings, agreement edits, CMS, backups, integrity tools.
- Project Admin: for ASSIGNED projects only – blocks, flats, construction status, bookings view/create, customers, leads, reports.
- Accounts: payments (post, clear, bounce, reverse), receipts, roznamcha, demands, ledgers, reports, audit view.
- Sales: customers, leads, enquiries inbox, availability grid, create bookings, site visits; cannot post payments; cannot see unmasked KYC.
- Marketing: website CMS read/write, enquiries inbox.
- Employee: read-only dashboard & inventory for assigned projects.
- Customer (portal user): only their own bookings (as primary applicant or co-applicant).
Permission codes are fine-grained (examples: master.write, block.write, flat.status, customer.kyc_view, booking.create, booking.cancel, agreement.edit, construction.update, construction.undo, payment.post, payment.reverse, receipt.print, report.view, cms.write, users.manage, roles.manage, audit.view, service.assign, visit.write, customer.portal_manage). Every API endpoint is guarded by a permission; users can additionally be scoped to a list of projects – scoped users must not even learn that other projects exist (return not-found, not forbidden).

====================================================================
2. SECURITY, PRIVACY & PLATFORM RULES (apply everywhere)
====================================================================
- Staff login: email + password; short-lived access tokens (≈15 min) + rotating refresh tokens (≈7 days). Refresh-token reuse must be detected and revoke the whole token family. Device/session list with revoke. Optional TOTP MFA per user; setting to force MFA for admin roles. Lockout after 5 failed attempts for 15 minutes; login rate limiting per IP; password policy; password history (last 5); forced change on first login option.
- Buyer login: phone + password created by staff (temp password shown once; forced change at first login); separate token audience; same lockout rules.
- Field-level encryption at rest for PAN, Aadhaar, bank account numbers; store a keyed hash for duplicate checks/search; API returns masked values (XXXXX1234X / XXXX XXXX 1234) unless the caller has customer.kyc_view AND explicitly asks to reveal – every reveal is audit-logged.
- Immutable audit log for every create/update/deactivate/status change: actor, time, action, entity, before/after snapshot, IP. Portal actions are logged with actor type "customer". No endpoint may edit or delete audit entries.
- Idempotency: all create operations accept an Idempotency-Key; payment posting REQUIRES one; replaying the same key returns the original response and creates nothing.
- Optimistic concurrency: every mutable record has a version; updates with a stale version are rejected with a conflict telling the user who changed it.
- Soft delete only (deactivate/restore) for master and structural data; a master record used anywhere cannot be deactivated (return a conflict listing usage count). Financial records are never deleted – only reversed/voided with reason.
- Public (website) APIs: unauthenticated, read-only, strict allow-listed output (never expose internal ids of users, customers, costs, storage paths), cached ~60 s, rate-limited; forms rate-limited (5/min/IP) with honeypot field.
- Numbering: atomic sequences per financial year (April–March) with configurable prefixes: customers CUST-, bookings BK-, demands DM-, receipts e.g. SGB/2526/0001, service tickets SR-, site visits SV-.
- Observability: request ids, structured logs, health/readiness endpoints, basic metrics.
- Data ownership: Super Admin can download a full backup export; "right to erasure" anonymises a customer's PII when they have no active booking, keeping financial records.
- Performance target: 1,000 concurrent staff users; list pages < 300 ms server time; paginated everywhere (offset + cursor), server-side search/sort/filter, CSV export on every list.

====================================================================
3. MASTER DATA (all with CRUD, deactivate/restore, usage check, CSV import with validation preview)
====================================================================
- Room Types (Bedroom, Kitchen, Living, Toilet, Balcony, Store, Pooja…)
- Area Types with codes (Carpet, Built-up, Super Built-up, Balcony, Terrace, Parking)
- Flat Types: name (e.g. 3BHK-A), BHK count, facing, description, ROOMS list (room type, label like "Master Bedroom", length ft, width ft, auto sq ft = L×W, editable), AREAS list (area type → sq ft), optional base rate per sq ft or lump-sum price, selected specification items. Validation: at least one room and one area; super built-up ≥ built-up ≥ carpet.
- Block Types (Tower, Villa, Row House, Duplex, Commercial) with a "has floors" flag.
- Floor Plan Templates: flats-per-floor and, per position, the flat type, facing, corner flag. Blocks are built from floor RANGES of templates (floors 1–5 use plan A, 6–15 use plan B).
- Amenities (name, category, icon).
- Construction Stage master: the list of physical stages (Excavation, Foundation, Plinth, 1st Slab … Top Slab, Brickwork, Plastering, Flooring, Finishing, Possession/Handover); exactly one stage flagged "possession".
- Payment Plan master (see section 8).
- Charge Types (Registry, Maintenance Deposit, GST, Car Parking, Club Membership, Legal, Electricity/Water) with default amount, taxable flag, and "demand at": on booking / on possession / manual.
- Payment Modes (Cash, Cheque, NEFT/RTGS, UPI, DD, Bank Loan Disbursement) with "requires instrument reference" flag.
- Company Bank Accounts (account number encrypted/masked), one default.
- Document Types (PAN, Aadhaar, Agreement, Allotment Letter, Payment Plan Acceptance, Receipt…) with "applies to" (customer/booking/project).
- PLC (Preferential Location Charge) Types: Floor Rise, Corner, Park Facing, Road Facing, Top Floor, Vastu – each with calc mode: per sq ft / fixed / percent.
- Specification categories and items (Flooring, Kitchen, Doors & Windows, Electrical, Bathroom, Paint…).
- Service Request categories; Site Visit settings per project (section 17).

====================================================================
4. PROJECT → BLOCK → FLAT (inventory)
====================================================================
Project: name, unique code, type (Residential/Commercial/Mixed), address, RERA number, launch and possession dates, status (Planning/Under Construction/Ready/Completed), amenities (multi-select from master), construction stage sequence (default from master order, editable), land area, geo-coordinates, landmarks with distances, approvals list (RERA, building plan, fire NOC…), team (users), escrow bank account, website settings (section 17), site-visit settings, derived counts (towers, units by status).

Block (tower/villa block): block type, name/code, number of floors, floor start (0 for ground), ground floor label, SKIP floors (e.g. no 13th), REFUGE floors and PODIUM floors (no units), floor-plan ranges, numbering pattern ({block}-{floor}{pos2} → A-101; {floor}{pos2} → 101; {block}{seq} → V1, V2 for villas), construction stage sequence (defaults to project's), derived construction % and unit counts by status.

FLAT GENERATION ALGORITHM (run when a block is created, or on demand if it has no flats):
  1. Build the list of physical floors = floor_start..floors, excluding skip floors; mark refuge/podium floors as "no units".
  2. For each floor with units, find the floor-plan template whose range covers that floor.
  3. For each position in that template: create a flat with number from the numbering pattern, floor, position, flat type, facing, corner flag.
  4. SNAPSHOT the flat type's rooms and areas into the flat (so later master edits do not silently change existing flats). Store carpet / built-up / super built-up sq ft.
  5. Price = pricing engine (section 5) if a rate card is active, else flat type base price or rate × super built-up.
  6. Insert all flats atomically; if anything fails, nothing is created.
  Guards: regenerate is blocked if any flat is not "Available"; appending floors later is allowed; changing a flat's type re-snapshots rooms/areas and is allowed only while it is Available.

Flat statuses & transitions: Available ↔ Hold ↔ Blocked (manual, by permission); Booked and Sold are set ONLY by the booking engine (manual attempts rejected). Flat carries price breakup, parking allotment, notes.

Inventory Grid: stacked tower view (floors descending, positions across, refuge rows shown), colour by status / by flat type / by price band, legend, hover with price & type, click → drawer (snapshot rooms/areas, specifications, price breakup, status change, history), multi-select → bulk status/price, print availability chart. Block Wizard: type → floors & skips → floor-plan ranges → pricing → preview grid → generate.

Parking inventory per project: slots (number, type Covered/Open/Stilt/Basement, level, price, status Available/Allotted/Blocked), bulk generation, allotted during booking.

====================================================================
5. PRICING ENGINE
====================================================================
Rate Card per project: effective date, per flat type a rate per sq ft or lump sum, PLC rules (PLC type, value, applies-to condition: all / floors ≥ N / corner / facing in list), status Draft/Active (only one Active; activating supersedes the previous; history kept).
PRICE ALGORITHM for a flat: base = lump sum, or rate × super built-up sq ft; for each PLC rule whose condition the flat satisfies: per-sq-ft → value × super built-up; fixed → value; percent → base × value/100; floor rise → value × (floor − 1) × sq ft (or as configured). Store a line-item breakup [label, amount] and the total. "Apply rate card" re-prices ONLY Available flats; Hold/Booked/Sold keep their price. Bulk price edit per block/floor with optional floor-rise step.

====================================================================
6. CUSTOMERS, KYC, PORTAL ACCESS
====================================================================
Customer: code, name, father/spouse name, DOB, gender, phone (10-digit Indian, normalised), alt phone, email, current & permanent address (same-as flag), occupation, company, income band, source, assigned relationship manager (sales user), PAN (regex ^[A-Z]{5}[0-9]{4}[A-Z]$), Aadhaar (12 digits with Verhoeff checksum), bank details (IFSC regex), nominee, co-applicants (name, relation, phone, PAN, Aadhaar), KYC status (Pending/Submitted/Verified/Rejected with verifier), notes, tags, documents.
Duplicate detection by phone and by PAN hash. Customer 360 page: profile, KYC panel (masked + audited reveal), bookings with plan summary, payments, documents, leads history, service tickets, portal access card, full history.
Portal access card: enable (generates a strong temporary password shown once, forced change on first login), reset, disable, revoke sessions, last login, share login link; bulk "enable for all customers with active bookings".

====================================================================
7. LEADS / ENQUIRIES
====================================================================
Lead: number, name, phone, email, interested project & flat type, budget range, source (Walk-in, Website, Brochure, Site Visit, Referral, Broker, Campaign), stage pipeline New → Contacted → Site Visit Scheduled → Site Visit Done → Negotiation → Converted | Lost (with stage history and lost reason), assigned user, follow-ups (date, note, next date), activities timeline (brochure downloaded, visit booked/rescheduled/cancelled/completed/no-show, stage changes), UTM capture, converted customer link.
Round-robin auto-assignment to active Sales users (toggle in settings). Kanban board (drag between stages; Lost asks for a reason) + list; "my follow-ups due today" widget. Convert lead → creates customer (and optionally starts a booking).
Lead dedupe rule for website sources: if an open lead (not Lost/Converted) exists for the same phone within the same project, append an activity to it instead of creating a duplicate.

====================================================================
8. PAYMENT PLANS (master) AND THEIR LINK TO PROJECTS/TOWERS
====================================================================
Payment Plan: name, code, type (Construction Linked / Down Payment / Time Linked / Flexi / Custom), description, grace days, list of INSTALLMENTS, each with: sequence, name, percent (2 decimals), trigger type and trigger details, due-days (days allowed to pay after the trigger; default from settings), notes.
Trigger types:
  - ON_BOOKING (at most one)
  - DAYS_AFTER_BOOKING (n days)
  - ON_STAGE (a construction stage from the master)
  - ON_POSSESSION (when the possession stage completes; at most one)
  - ON_DATE (fixed calendar date)
Validation: percents must sum to exactly 100.00; sequences unique; referenced stages must exist.
Rule: an installment's percent applies EQUALLY to the Cash bucket and the Account bucket of a booking (see section 10/11).
Plan assignments: a plan is linked to a whole project or to specific towers, with one default per tower, effective dates, active flag. A plan with ON_STAGE installments can only be assigned to a tower whose stage sequence contains those stages (otherwise reject and list the missing stages). While booking, after choosing project and tower, the plan dropdown shows exactly the applicable plans, default first, with a live schedule preview.
Seed examples: "Standard CLP" (10% booking, then stage-linked tranches to 100%), "Down Payment 10:85:5" (10% on booking, 85% 30 days after booking, 5% on possession), "Flexi 10:40:50" (10% booking, 40% at 60 days, 50% spread across the last five stages), "Villa CLP".

====================================================================
9. CONSTRUCTION STAGES & TOWER CONSTRUCTION STATUS
====================================================================
Each tower snapshots its stage sequence as records: stage, order, status Pending / In Progress / Completed, started on, completed on, by, notes, photos (each photo with "visible to buyers" and "show on website" flags).
Updating status: staff pick the stage reached from a dropdown. Picking a stage further ahead marks all intermediate stages Completed too (confirmation dialog listing them with editable dates). "In Progress" is a non-financial marker. The tower's construction % is derived = completed stages / total stages (display only; money never depends on this percentage – it depends on the plan installments).
Completing stages triggers the auto-dues engine (section 10) for every Active booking in that tower and notifies buyers whose plan has installments on those stages.
UNDO RULE: only the latest completed stage can be undone, and only if no demand raised by it has been paid by a payment dated on/after the demand (earlier advances that were auto-applied do not block undo – they simply return to credit). Undo voids those demands, recomputes ledgers, clears the stage's completion data and withdraws related notifications.

====================================================================
10. AUTO-DUES ENGINE (payment plan × construction stage × time)
====================================================================
Inputs per booking: agreement value split into cash_agreed and account_agreed; the plan snapshot (installments resolved with stage names) taken at booking; the tower's stage records; today's date.
ALGORITHM raise_due_installments(booking):
  for each installment in the plan snapshot, in sequence:
    if a non-void demand already exists for this installment (by sequence OR by name) → skip (idempotent).
    determine trigger satisfied:
      ON_BOOKING → yes, at booking date
      DAYS_AFTER_BOOKING → booking_date + n ≤ today
      ON_DATE → date ≤ today
      ON_STAGE → that stage is Completed on the booking's tower (trigger date = completion date)
      ON_POSSESSION → the possession stage is Completed
    if satisfied:
      cash_demand = round(cash_agreed × percent / 100), account_demand likewise;
      ROUNDING: compute cumulative amounts and take differences ("telescoping") so that after the final installment the sum of all demands equals the agreed amount exactly, to the paise;
      create ONE demand: number, booking, installment seq/name, trigger label, percent, cash and account amounts, due date = trigger date + due-days, status Open/Partially Paid/Paid (derived);
      append a DEMAND row to the ledger; notify the buyer (portal) and Accounts;
      booking.cash_order_raised += cash_demand; booking.account_order_raised += account_demand.
  A unique constraint (booking, installment seq) makes double-raising impossible even under concurrency.
When it runs: at booking creation (catch-up: if the tower is already past some stages, those installments are raised immediately), on every stage completion, daily at 00:30 IST for time triggers, at startup, and on an admin "run dues now" action.
INTEGRITY REPORT (admin tool, also nightly): per booking list (a) demands whose trigger is NOT satisfied, (b) satisfied triggers with no demand, (c) duplicate installment demands, (d) demands not mapped to an installment, (e) summary mismatches between stored totals and recomputation. REPAIR (admin-confirmed): void unsatisfied/duplicate demands that have no payments applied, raise missing ones, rebuild ledgers. Nightly findings notify Super Admin and Accounts.
Changing a booking's plan after booking is allowed only if no installment demand has been paid; it is recorded as a revision and everything is recomputed.

====================================================================
11. PAYMENT LEDGER ENGINE – "track the split, don't gate the order"
====================================================================
Each booking has two money buckets: CASH (cash_agreed) and ACCOUNT (account_agreed, the bank/loan/official portion); cash_agreed + account_agreed = agreement value. Other charges (registry, maintenance, GST…) form a separate third ledger.
Core principle: the system TRACKS where money sits; it never forces the customer to pay one bucket before the other. Both buckets' demands rise with construction (via the plan); the customer pays Cash or Account in any order.
Derived figures (always recomputable from demands + payments):
  cash_order_raised = Σ cash demands raised; account_order_raised likewise; total_order_raised = sum.
  cash_paid = Σ CLEARED cash payments − reversals; account_paid likewise; paid = sum.
  cash_due = cash_order_raised − cash_paid (NEGATIVE = advance); account_due likewise; total_due = cash_due + account_due.
Payment record: receipt number (per FY), booking, against = FLAT VALUE (category Cash | Account) or OTHER CHARGE (charge line), amount > 0, date (≤ today, ≥ booking date), mode, instrument details (number/date/bank; required when the mode needs a reference), company bank account credited (required for non-cash modes), remarks, received by, status Pending | Cleared | Bounced | Reversed.
Clearing rule: Cash/UPI/NEFT/Loan disbursement → Cleared immediately; Cheque/DD → Pending until staff marks Cleared or Bounced. ONLY Cleared payments count toward paid/due; Pending appears as "cheques in hand".
BUCKET CAP RULE (the only block): if bucket_paid + amount > bucket_agreed → reject with an explanatory message ("Account agreed ₹40,00,000; already received ₹35,00,000; cannot accept ₹8,00,000 – revise the agreement first"). Applied at posting and at cheque clearing. Other-charge payments cannot exceed the charge line total. Paying beyond what is raised but within agreed is NORMAL and shows as an advance.
POSTING ALGORITHM (atomic unit of work, Idempotency-Key required): validate → insert payment → increment booking summary → append PAYMENT row to the ledger with running balances → receipt available → notifications. Reversal: original marked Reversed, a REVERSAL row with negative amount, summary decremented, receipt marked cancelled (never deleted) – reason mandatory. Admin "recompute" rebuilds a booking's summary and ledger from source records; startup reconciliation reports mismatches.
LEDGER TABLE per booking (the view customers and accountants read), one row per event (DEMAND, PAYMENT, REVERSAL, AGREEMENT_CHANGE, OTHER_CHARGE_DEMAND, OTHER_CHARGE_PAYMENT, CANCELLATION) with columns: date, event, stage/installment, category, amount, cash paid (cumulative), account paid (cumulative), cash order raised, account order raised, cash due, account due, total due, receipt/demand number. Advances rendered green with "(advance)", dues red.
WORKED EXAMPLE the system must reproduce exactly – flat ₹1,00,00,000, cash agreed ₹60,00,000, account agreed ₹40,00,000, plan 10/15/25/30/40/50/60/75/85/100 % cumulative, payments after each stage:
  #1 10% Account 4,00,000 → cash due 6,00,000 | account due 0 | total 6,00,000
  #2 15% Cash 8,00,000 → 1,00,000 | 2,00,000 | 3,00,000
  #3 25% Account 12,00,000 → 7,00,000 | −6,00,000 (advance) | 1,00,000
  #4 30% Cash 5,00,000 → 5,00,000 | −4,00,000 | 1,00,000
  #5 40% Cash 10,00,000 → 1,00,000 | 0 | 1,00,000
  #6 50% Account 15,00,000 → 7,00,000 | −11,00,000 | −4,00,000
  #7 60% Cash 7,00,000 → 6,00,000 | −7,00,000 | −1,00,000
  #8 75% Cash 20,00,000 → −5,00,000 | −1,00,000 | −6,00,000
  #9 85% Account 9,00,000 → 1,00,000 | −6,00,000 | −5,00,000
  #10 100% Cash 10,00,000 → 0 | 0 | 0
Receipts: auto-numbered per FY, printable/PDF on company letterhead with amount in words in the Indian system ("Rupees Twelve Lakh Fifty Thousand Only"), "subject to realisation" for pending cheques, CANCELLED watermark for reversed.
Demand letters: per demand, both buckets, due date, bank details for the Account bucket.
ROZNAMCHA (day book): for a date/range – opening cash in hand (carried from previous day), all cleared receipts grouped by mode and by category (Cash/Account/Other), contra entries (cash deposited to bank / withdrawn), closing cash in hand, totals by project. Printable.
Other charges: lines on the booking (charge type, amount, GST %, total, demand-at rule, demanded, paid); demands raised on booking / on possession / manually; separate payments and a separate sub-ledger.

====================================================================
12. BOOKING ENGINE
====================================================================
Booking wizard (staff): 1) Project → Tower (inventory grid; only Available/Hold selectable; find by flat number; legend) → 2) Customer (search by phone first; create inline without leaving the wizard; co-applicants) → 3) Agreement (total prefilled from the flat's price breakup, editable with permission; Cash/Account split entered as amounts OR percentages with auto-balance; must sum exactly) → 4) Payment Plan (applicable plans for this tower, default first; live schedule preview with cash/account per installment and expected dates; acceptance mode: in person / signed copy upload / portal; acceptance date) → 5) Other charges (checklist from charge types with defaults and GST) & Parking (available slots) → 6) Review & confirm (printable summary). Left stepper with ticks, right sticky summary rail with live totals, sticky Back/Next footer, inline validation, draft autosave with "Resume booking", unsaved-changes guard, works on a phone.
ATOMIC FLAT LOCK: on confirm, the flat's status is changed to Booked in one atomic operation conditioned on its current status being Available (or Hold by the same user/admin); if the condition fails (someone else booked it), the booking is rejected – two concurrent bookings of the same flat can never both succeed.
On creation: snapshot flat details, rate, plan; allot parking (slots → Allotted); raise ON_BOOKING installments and any already-satisfied stage installments (catch-up); raise other charges with "on booking"; record plan acceptance.
Agreement revision (permission agreement.edit): new cash/account agreed values with mandatory reason; each bucket's new agreed value must be ≥ that bucket's paid amount; stored as a revision with before/after; order raised and dues recomputed; AGREEMENT_CHANGE ledger row.
Cancellation: reason, deduction, refund (≤ paid); flat → Available; parking → Available; ledger closed; further payments rejected.
Handover/Complete: allowed when the possession stage is complete, total due ≤ 0 and other charges due ≤ 0 → booking Completed, flat Sold.
Booking detail tabs: Overview (summary cards per bucket with advance badges), Ledger, Payment Plan/Schedule (installment rows with status Not yet due / Raised / Partially paid / Paid / Overdue), Demands, Payments, Other charges, Documents, Revisions, History.

====================================================================
13. DOCUMENTS, MEDIA, SERVICE REQUESTS, NOTIFICATIONS
====================================================================
Documents: uploads (PDF/JPG/PNG/WebP, max 15 MB, validated by file signature not just extension) attached to customers/bookings/projects/blocks/flats/payments with a document type, sensitivity flag (KYC docs need kyc_view to download), "share with customer" flag (KYC docs cannot be shared), soft delete, short-lived download links. Floor-plan images, project galleries, construction photos; thumbnails (≈480 px) and medium (≈1080 px) variants generated on upload and served with long-lived caching.
Service Requests (tickets): number, customer, booking, category (Payment query, Document request, Construction query, Possession, Defect/Snag, Agreement, Other), priority, subject, description, attachments, status New → In Progress → Awaiting Customer → Resolved → Closed (customer may reopen within 7 days of Resolved), assignee, SLA due (hours per priority from settings), threaded messages where staff notes can be INTERNAL (never shown to the customer), satisfaction rating 1–5 at close. ERP: list/kanban, assign, reply, resolve; notifications on new ticket, customer reply, SLA breach.
Notifications (in-app only; no SMS/WhatsApp in this scope):
  Staff bell: new website enquiry, brochure lead, site visit booked, cheque bounced, demand overdue (daily), stage completed, agreement revised, booking cancelled, new ticket / customer reply, integrity findings, "mark outcome" nudge for past visits.
  Buyer bell: installment demand raised, demand overdue, stage completed on their tower (if photos visible), staff reply on their ticket, notice published for their project.
  Retraction rule: when a stage is undone or demands are voided, related unread notifications are deleted and read ones are marked withdrawn; counts exclude withdrawn. A startup sweep removes notifications pointing at deleted entities.

====================================================================
14. REPORTS, DASHBOARDS, PDFs
====================================================================
Reports (filters, totals footer, charts where meaningful, CSV + PDF export, saved presets, strict query parameters): Collections (by day/week/month, mode, category, status, GST on charges); Outstanding & Ageing (per project/tower/customer; ageing by demand due date: not due / 0–30 / 31–60 / 61–90 / 90+; top overdue customers); Advances; Demand vs Collection by installment/stage per tower; Upcoming dues forecast (time triggers + expected stage timing); Inventory (availability by type/floor, sold vs available value, sales velocity, realised rate vs rate card); Customer Statement of Account (agreement, revisions, schedule, full ledger, other charges, pending cheques); Payment schedule & Allotment letter; Cheques in hand / bounced; Cancellations & refunds; Sales & Leads funnel (by source/stage, response time, bookings per salesperson, website enquiries, brochure downloads, site visits); Roznamcha range & bank-wise receipts; Activity/login/failed logins.
Branded A4 PDFs: receipt, demand letter, allotment letter, customer statement, every report (letterhead, page numbers, Indian number formatting, amount in words).
Dashboards by role: Owner (collections trend 12 months by bucket, due ageing, inventory by project, sales velocity, top overdue, pending cheques, enquiries this week, construction progress, dues raised this month, upcoming installments 30 days); Accounts (today/month collections, cheques to clear by instrument date, overdue demands, bounced alerts, quick "post payment"); Sales (pipeline funnel, follow-ups due, new enquiries, brochure leads this week, today's site visits, availability snapshot, my bookings); Project Admin (scoped progress, availability, upcoming stages, demands raised). Global Ctrl/⌘+K command palette with search across projects/blocks/flats/customers/bookings and recent items.

====================================================================
15. MARKETING WEBSITE + CMS
====================================================================
Pages: Home (cinematic hero with slides, trust strip of stats, featured projects, value props, walkthrough video, testimonials, latest blog, enquiry, footer with RERA disclaimer), Projects list with filters, Project detail (hero gallery, overview/highlights, key facts & approvals, amenities grid, configurations/floor plans from master data with room sizes and specifications, availability grid showing only Available vs Not available – Hold/Booked/Blocked all look "not available", prices only if enabled, construction progress by stages with photos flagged for website, video and 360° virtual-tour embeds (click-to-load, no player code until click), location map with landmarks, brochure CTA, FAQs, sticky enquiry card, "Book a Private Site Visit"), About (story, leadership, timeline), Gallery (masonry + lightbox), Blog/News, Contact (call-back form + site-visit booking), Privacy/Disclaimer, a per-visit management page. SEO: titles/meta/OpenGraph per page, structured data, sitemap and robots generated from published content, clean slugs. Responsive, fast (lazy responsive images, code splitting, < 2 s to settle), accessible (skip link, focus states, 48 px targets), sticky mobile bar Call · WhatsApp · Enquire (opens a sheet: call / WhatsApp / book a visit / download brochure).
Per-project website toggles (admin): published, slug, show prices, show availability, show construction progress, starting-price override, hero images, highlights, video URLs, tour URLs, map embed, brochure document, FAQs, SEO fields. Cannot publish without hero image, description and location. Unpublished projects are invisible everywhere (pages 404, absent from lists and sitemap).
CMS inside the ERP: site settings (brand, logo, contacts, offices, social, trust stats, disclaimer, SEO defaults, analytics ids, round-robin toggle, "site live" switch → elegant coming-soon when off, portal URL), hero banners (schedule), home sections, testimonials, gallery, blog posts (draft/published, markdown, SEO), legal pages, people, notices (for buyers; per project; publish/expiry), enquiries inbox with unread badge.
Enquiry flow: name, 10-digit phone, email optional, project, flat type, message, consent → lead with source Website (dedupe rule), UTM captured, round-robin assignment, notification; rate limit 5/min/IP, honeypot (silently dropped), success with reference number.
BROCHURE LEAD GATE: "Download brochure" → modal (name, phone, optional email, consent) → create or reuse lead (source Brochure; same phone + project = activity on the existing lead, never a duplicate) → return a SIGNED, short-lived (15 min) download link that streams the PDF as an attachment and increments the project's download counter once per link; forged/expired links rejected. The device remembers the visitor so later downloads skip the form but still log the activity. ERP shows download counts and a 30-day sparkline per project.
SITE VISIT SCHEDULER: per-project settings (enabled, visit days Mon–Sun, start/end time in IST, slot length 30/60, seats per slot, minimum lead hours, max days ahead, blackout dates, site office address, maps link, instructions).
  AVAILABILITY ALGORITHM(project, from, to): for each date in range: skip if not a visit day or blackout; generate slots from start to end by slot length; drop slots starting before now + min lead hours (IST) or beyond max days ahead; available = seats − count of visits in that slot whose status is not Cancelled; return only slots with available > 0 (with the count). Cache ~60 s.
  BOOKING: visitor picks project → date strip (next 14 days, disabled without slots) → slot chips with "N left" → details (name, phone, email, visitors 1–6, message, consent). Server re-checks capacity atomically (count + insert in one unit; reject with SLOT_FULL if exceeded) → create or reuse lead (source Site Visit) → create visit (number SV-, status Confirmed, assignee = lead's RM) → lead stage → Site Visit Scheduled → notify assignee → return visit number, date/time, address, an iCalendar (.ics) file in Asia/Kolkata with a 1-hour reminder and a signed manage link. Visitor can cancel from the manage link (no login) → visit Cancelled, seat freed, and if it was the lead's only upcoming visit the lead's stage reverts to its previous stage with an activity.
  ERP Site Visits module: day/week calendar (slot columns, visitor chips, "moved" tag for rescheduled) and list with filters; create manually for a lead/customer; confirm, reschedule (capacity-checked, full slots hidden), cancel with reason, mark Completed (lead → Site Visit Done) or No-show; notes; CSV; dashboard "Today's site visits" with quick outcome buttons; daily nudge for past visits without an outcome.

====================================================================
16. CUSTOMER PORTAL (web + Android + iOS)
====================================================================
Login (phone + password, forced change at first login, lockout, "Staff? go to ERP" link). Home: greeting, booking switcher (primary or co-applicant on several bookings), hero card (project image, flat number, tower/floor), construction progress ring with current stage and "up next", Paid / Due / Advance per Cash and Account bucket (3-row × 2-column grid), payment plan card (name, type, accepted on) and next installment (amount per bucket, trigger label, expected date), notices strip with unread count, quick actions (download statement, bank details for Account transfers, raise request), relationship manager card with call and WhatsApp buttons, notification bell.
My Flat: rooms & areas table, specifications, parking, floor-plan image (zoomable), price breakup, agreement & revisions. Payments: Receipts (in-app PDF viewer with download; on phones the native share sheet), Ledger (customer-friendly rows with Cash/Account chips, running paid, due/advance; card layout on phones), Demands (status, due date, letter PDF), Schedule (installment timeline with status chips and progress), pending cheques. Construction: vertical stage timeline (dates, in-progress highlight, notes) with photo grids and full-screen zoomable viewer – ONLY the buyer's own tower and ONLY photos flagged visible to buyers. Documents: statement, allotment letter, documents shared by staff. Requests: list, create with photos from camera/library, threaded replies (internal staff notes never appear), reopen, rate. Notices. Notifications (tap → the relevant screen). Profile: edit contact details (audited), co-applicants, change password, sessions/logout all.
Rules: a buyer can only ever see bookings where they are primary or co-applicant (anything else behaves as not-found, including PDF routes); KYC values are masked even to themselves; no internal ids or storage paths leak. Responsive shell: left sidebar at desktop widths, bottom tab bar on phones with content never hidden behind it; cached last data so the app opens instantly and refreshes in the background.

====================================================================
17. SEED / DEMO DATA (must be coherent – every record connected)
====================================================================
A demo builder (e.g. "Shree Ganesh Builders", Patna) with one user per role; complete masters (room/area types, 5 flat types with realistic rooms and areas, block types, amenities, 14 stages, 4 payment plans, charge types, modes, bank account, document types, PLC types, specifications); Project 1 with Tower A and B (8 floors × 4 flats) and Tower C (15 floors, no 13th, refuge floor 7); Project 2 with villa blocks (one premium block whose every stage is complete); active rate cards with PLCs; parking; ~12 customers with valid-format KYC; 8 leads across stages; ~10 bookings on different plans with coherent demands and payments including: the exact ₹1 Cr worked example (completed → Sold), a pending cheque, a bounced cheque, a reversal, an agreement revision, a cancelled booking with refund, a Flexi-plan booking; portal accounts for all customers; construction photos per completed stage; shared documents; 5 service tickets across statuses; 2 notices; CMS content (banners, testimonials tied to seeded customers, gallery, 4 blog posts, pages, people, FAQs); site-visit settings, 10 site visits (upcoming, completed, no-show), brochure download activities. Provide a guarded "reseed" that restores this state. Towers must be at a consistent stage with EXACTLY the demands those stages imply (integrity report must show zero findings).

====================================================================
18. ACCEPTANCE SCENARIOS (the system is done only when all pass)
====================================================================
1. Each role sees only permitted menus and APIs; a project-scoped user cannot discover other projects.
2. Creating a 15-floor tower with skip 13 and refuge 7 yields the correct flat count and numbering, with rooms/areas snapshotted and prices with PLC breakups; regenerate blocked once a flat is on Hold.
3. Two simultaneous bookings for the same flat → exactly one succeeds.
4. The worked ledger example reproduces all 10 rows to the rupee; final due ₹0; booking Completed; flat Sold.
5. Payment above a bucket's agreed amount → rejected with the explanatory message; after an audited agreement revision the same payment succeeds; Sales cannot revise.
6. Cheque payments are Pending and excluded until cleared; bounced never count; reversal creates a negative ledger row and a cancelled receipt; posting without an Idempotency-Key is rejected; replay returns the identical response and creates nothing.
7. Plan dropdown shows only plans assigned to the chosen tower; a plan referencing a stage missing from a tower cannot be assigned; percents ≠ 100 rejected.
8. Flexi booking: 10% demand immediately; the 40% installment is raised exactly once when 60 days pass (daily job or admin run), never twice.
9. Jumping a tower two stages ahead marks both, raises the right installments for every active booking on plans that have them (amount = % × agreed per bucket), notifies the buyers; undo is blocked once a payment dated after the demand exists, otherwise voids demands and withdraws notifications; integrity report shows zero findings on clean data and flags/repairs manufactured anomalies.
10. KYC masked for Sales; revealed only to permitted users on explicit request and audit-logged; buyers never see unmasked values; public APIs never expose internal fields; a buyer cannot access another buyer's booking or PDFs.
11. Website: unpublished project 404s everywhere; toggling "show prices" off removes prices from API and page; enquiry creates a lead and shows in the inbox; 6th enquiry per minute → rate-limited; honeypot → dropped.
12. Brochure gate: download starts only after valid details; same phone → no duplicate lead; forged link → rejected. Site visits: availability hides past/blackout/full slots; last seat then one more → SLOT_FULL; .ics correct in IST; cancel frees the seat and reverts the lead stage; ERP reschedule respects capacity; Completed → lead "Site Visit Done".
13. Reports reconcile with the ledger (collections = Σ cleared payments; outstanding = Σ booking dues); PDFs download for receipt, demand letter, allotment letter, statement.
14. Quality bar: production builds, no horizontal overflow at 390 px on any page, WCAG-AA contrast, zero console errors, website settles < 2 s, ERP pages < 1.5 s, booking wizard completes on a phone, portal shows a sidebar on desktop and a tab bar on phones without covering content.
