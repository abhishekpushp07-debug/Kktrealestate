# KKT v2 — Demo data ("Shree Ganesh Builders", Patna)

Seeding runs once on an empty database when `SEED_ON_BOOT=true` and `SEED_DEMO=true` (docs/DEPLOY.md "First boot"; without them a fresh production database is bootstrapped from `BOOTSTRAP_*` instead, never with demo data) and on `POST /api/v1/admin/reseed` with body `{ "confirm": "RESEED" }` (Super Admin only; drops business data and restores exactly this state). Every record below is connected; the integrity report must report **zero** findings after seeding.

## Logins (staff, ERP)
| Role | Email | Password |
|---|---|---|
| Super Admin | admin@sgb.in | Admin@12345 |
| Project Admin (scoped to SGH only) | projects@sgb.in | Project@12345 |
| Accounts | accounts@sgb.in | Accounts@12345 |
| Sales | sales@sgb.in | Sales@12345 |
| Marketing | marketing@sgb.in | Marketing@12345 |
| Employee | employee@sgb.in | Employee@12345 |

MFA is not enrolled for seeded users (enrol from the user menu). `force_mfa_for_admins` is off in the demo.

## Logins (customers, portal)
Every seeded customer has portal access enabled with password `Welcome@123` (already changed, so no forced change) — log in with the customer's 10-digit phone. The worked-example customer is **Rajesh Kumar Sinha, 9876543210** (BK-2526/0001, flat P-1 in Project 2 premium villa block — Completed/Sold).

## Masters
* Room types: Bedroom, Master Bedroom, Kitchen, Living, Dining, Toilet, Balcony, Store, Pooja, Study, Utility.
* Area types: CARPET, BUILT_UP, SUPER_BUILT_UP, BALCONY, TERRACE, PARKING.
* Flat types (rooms L×W ft, areas sq ft; super ≥ built-up ≥ carpet): 2BHK-A (carpet 720 / built-up 860 / super 1050), 2BHK-B (780/930/1130), 3BHK-A (1050/1250/1520), 3BHK-B (1180/1400/1700), 4BHK Villa (2100/2500/3000; lump sum ₹1,00,00,000 for the worked example block).
* Block types: Tower (has floors), Villa (no floors), Row House, Duplex, Commercial.
* Floor plan templates: FP-4 (4 flats/floor: pos 1 3BHK-A E corner, 2 2BHK-A N, 3 2BHK-B S, 4 3BHK-B W corner), FP-4-PREMIUM (4×3BHK), FP-VILLA (1 position, 4BHK Villa).
* Amenities (12): Clubhouse, Swimming Pool, Gym, Children's Play Area, Landscaped Gardens, 24×7 Security, Power Backup, Rainwater Harvesting, Indoor Games, Jogging Track, EV Charging, Temple.
* Construction stages (14, in order): Excavation, Foundation, Plinth, 1st Slab, 2nd Slab, 3rd Slab, 4th Slab, Top Slab, Brickwork, Plastering, Flooring, Finishing, External Development, Possession/Handover (is_possession).
* Payment plans (installments sum to 100.00):
  * **Standard CLP** (CONSTRUCTION_LINKED): 10% On booking; 5% Excavation; 10% Foundation; 5% Plinth; 10% 1st Slab; 10% 2nd Slab; 10% 3rd Slab; 15% Top Slab; 10% Brickwork; 10% Flooring; 5% Possession.
  * **Down Payment 10:85:5**: 10% On booking; 85% 30 days after booking; 5% On possession.
  * **Flexi 10:40:50**: 10% On booking; 40% 60 days after booking; 10% each on Brickwork, Plastering, Flooring, Finishing, Possession.
  * **Villa CLP** (used by the worked example — cumulative 10/15/25/30/40/50/60/75/85/100): 10% On booking; 5% Excavation; 10% Foundation; 5% Plinth; 10% 1st Slab; 10% Top Slab; 10% Brickwork; 15% Plastering; 10% Flooring; 15% Possession.
* Charge types: Registry & Stamp Duty (₹2,50,000, not taxable, ON_POSSESSION), Maintenance Deposit (₹60,000, taxable 18%, ON_POSSESSION), GST on flat (manual), Car Parking (₹3,00,000, taxable 5%, ON_BOOKING), Club Membership (₹1,00,000, taxable 18%, ON_BOOKING), Legal Charges (₹25,000, taxable 18%, ON_BOOKING), Electricity & Water Connection (₹75,000, MANUAL).
* Payment modes: Cash (cash, clears), Cheque (instrument, pending), NEFT/RTGS (instrument, clears), UPI (clears), DD (instrument, pending), Bank Loan Disbursement (instrument, clears).
* Bank accounts: HDFC Bank Boring Road (default, escrow for SGH), SBI Patna Main (escrow for GGV).
* Document types: PAN (KYC), Aadhaar (KYC), Photograph (KYC), Agreement, Allotment Letter, Payment Plan Acceptance, Receipt, Brochure (project), Floor Plan (project/flat), Approval (project).
* PLC types: Floor Rise (FLOOR_RISE ₹25/sq ft/floor), Corner (PER_SQFT ₹100), Park Facing (PER_SQFT ₹150), Road Facing (PER_SQFT ₹75), Top Floor (FIXED ₹1,50,000), Vastu (PERCENT 1.5).
* Specification categories/items: Flooring (vitrified tiles, wooden laminate in master bedroom), Kitchen (granite platform, SS sink), Doors & Windows (teak frame, UPVC windows), Electrical (modular switches, copper wiring), Bathroom (CP fittings, anti-skid tiles), Paint (acrylic emulsion).
* Service categories: Payment query, Document request, Construction query, Possession, Defect/Snag, Agreement, Other.

## Projects
### SGH — Shree Ganesh Heights (Residential, Under Construction, Bailey Road, Patna; RERA BRERAP00123-1/23)
* Tower A (TOWER, 8 floors × FP-4 = 32 flats, numbering `{block}-{floor}{pos2}`): stages completed through **3rd Slab** (7 of 14).
* Tower B (8 floors × FP-4 = 32 flats): completed through **Foundation** (2 of 14).
* Tower C (15 floors, skip 13, refuge floor 7, floors 1–5 FP-4, 6–15 FP-4-PREMIUM, numbering `{block}-{floor}{pos2}`): 13 unit floors (1–15 minus skip 13 and refuge 7) × 4 = **52 flats**; completed through **Excavation**.
* Rate card SGH-2025 ACTIVE: 2BHK-A ₹5,200/sq ft, 2BHK-B ₹5,400, 3BHK-A ₹5,600, 3BHK-B ₹5,800; PLCs Floor Rise, Corner, Top Floor.
* Parking: 60 slots (COVERED B1-01…B1-40 ₹3,00,000; OPEN S-01…S-20 ₹1,50,000).
* Website: published, slug `shree-ganesh-heights`, prices shown, availability shown, progress shown, 4 hero images, 6 highlights, 1 YouTube video, 1 360° tour, map embed, brochure PDF, 6 FAQs.
* Site visits: enabled Mon–Sat 10:00–17:00, 60-min slots, 3 seats, min lead 12 h, max 30 days ahead, blackout on the second Sunday of next month.
### GGV — Ganesh Green Villas (Residential, Ready, Danapur, Patna)
* Block P — Premium Villas (VILLA, no floors, 6 positions FP-VILLA, numbering `{block}{seq}` → P1…P6): **every stage completed** (possession done).
* Block Q — Garden Villas (VILLA, 8 positions): completed through Plastering.
* Rate card GGV-2025 ACTIVE: 4BHK Villa lump sum ₹1,00,00,000; PLC Park Facing.
* Website: published, slug `ganesh-green-villas`, prices hidden ("Price on request"), availability shown, progress hidden.

## Customers (12, valid-format KYC; PAN/Aadhaar encrypted; Verhoeff-valid Aadhaar numbers generated)
Rajesh Kumar Sinha 9876543210, Priya Verma 9876543211, Amit Kumar 9876543212, Sunita Devi 9876543213, Vikram Singh 9876543214, Neha Gupta 9876543215, Manoj Prasad 9876543216, Anjali Sharma 9876543217, Rakesh Yadav 9876543218, Pooja Mishra 9876543219, Sanjay Jha 9876543220, Kavita Roy 9876543221. Relationship manager = sales@sgb.in. KYC: 8 VERIFIED, 2 SUBMITTED, 2 PENDING. Every SUBMITTED/VERIFIED customer has a PAN-card placeholder PDF on file (document type PAN, sensitive), filed and submitted by sales@sgb.in and verified by admin@sgb.in (maker-checker).

The demo logins, passwords and this dataset are created only outside production, or in production with `SEED_DEMO=true`; a production first boot creates just the company, the six system roles and one Super Admin from `BOOTSTRAP_*` (docs/SECURITY.md).

## Bookings (10) — all dated within FY 2025-26; demands follow exactly from tower stages + plan
| # | Booking | Flat | Customer | Plan | Scenario |
|---|---|---|---|---|---|
| 1 | BK-2526/0001 | GGV P1 | Rajesh Kumar Sinha | Villa CLP | **Worked example**: ₹1 Cr, cash 60 L / account 40 L, 10 payments exactly as SPEC §11 → due 0, booking COMPLETED, flat SOLD, registry + maintenance charges paid |
| 2 | BK-2526/0002 | SGH A-301 | Priya Verma | Standard CLP | demands through 3rd Slab (7 raised), partially paid, one **pending cheque** ₹5,00,000 |
| 3 | BK-2526/0003 | SGH A-402 | Amit Kumar | Standard CLP | includes a **bounced cheque** (never counted) and a later NEFT |
| 4 | BK-2526/0004 | SGH A-104 | Sunita Devi | Down Payment 10:85:5 | 10% + 85% raised (booking > 30 days ago), **reversal** of a wrong UPI receipt with reason |
| 5 | BK-2526/0005 | SGH B-201 | Vikram Singh | Standard CLP | **agreement revision** (account 45 L → 55 L, cash reduced) with reason; AGREEMENT_CHANGE row |
| 6 | BK-2526/0006 | SGH B-303 | Neha Gupta | Standard CLP | **cancelled** with deduction ₹1,00,000 and refund of the rest; flat back to AVAILABLE |
| 7 | BK-2526/0007 | SGH C-502 | Manoj Prasad | **Flexi 10:40:50** | booked 20 days ago: 10% raised; the 40% (60 days) is NOT yet due (acceptance scenario 8) |
| 8 | BK-2526/0008 | GGV P3 | Anjali Sharma | Villa CLP | all demands raised (block complete), fully paid except possession installment; other charges demanded on possession |
| 9 | BK-2526/0009 | GGV Q2 | Rakesh Yadav | Villa CLP | demands through Plastering; advance on Account bucket (loan disbursement exceeded raised) |
| 10 | BK-2526/0010 | SGH A-803 | Pooja Mishra | Standard CLP | co-applicant Sanjay Jha; parking B1-07 allotted; two documents shared with customer |

Payments carry realistic modes and instruments; receipts numbered SGB/2526/0001… in posting order; one contra entry (cash deposited to HDFC ₹2,00,000).

## Leads (8) across stages
Website (NEW, unread), Brochure (CONTACTED), Walk-in (SITE_VISIT_SCHEDULED, linked upcoming visit), Referral (SITE_VISIT_DONE), Broker (NEGOTIATION), Campaign with UTM (NEW), CONVERTED (→ Kavita Roy customer), LOST (reason "Budget mismatch").

## Site visits (10)
4 upcoming (CONFIRMED, incl. one RESCHEDULED), 3 COMPLETED, 2 NO_SHOW, 1 CANCELLED; assignee sales@sgb.in. Brochure downloads: 14 over the last 30 days on SGH (for the sparkline), 3 on GGV.

## Service requests (5)
NEW (payment query), IN_PROGRESS (document request, with an INTERNAL staff note), AWAITING_CUSTOMER (construction query), RESOLVED (defect/snag, rating 4), CLOSED (possession, rating 5).

## Notices (2)
"Diwali holiday schedule" (all projects), "Tower A 4th slab casting on 2 Nov" (SGH).

## CMS
Site settings (brand, phone +91 612 2200000, WhatsApp 9876500000, 2 offices, social, trust stats: 12 yrs · 9 projects · 1,400 families · 2.1 M sq ft), 3 banners, 5 home sections, 6 testimonials (seeded customers), 18 gallery images, 4 published posts + 1 draft, pages: about/privacy/disclaimer, 3 people, FAQs per project. Construction photos: 2 per completed stage, flagged visible to buyers and shown on website (GGV P: all; SGH A: through 3rd Slab).

Images are generated placeholders (SVG/PNG rendered by sharp with project/stage captions) stored through the documents module, so the demo has no external image dependencies.

## How the seed runs (apps/api/src/seed)
* `pnpm --filter @kkt/api seed` – migrations (idempotent) → bootstrap (company, roles, six staff logins) → `seedDemo(app)`; a no-op when projects already exist, `--force` drops the business data first (`reseed`).
* `SEED_ON_BOOT=true` (default) does the same at API start when the database has no projects.
* `POST /api/v1/admin/reseed` `{ "confirm": "RESEED" }` (Super Admin, never in production) truncates every business table – sequences and idempotency keys included – keeps companies / roles / users / audit_logs (+ staff sessions), re-bootstraps missing logins, writes an `admin.reseed` audit row and runs the seed again, so numbering restarts at `…/0001`.
* The seed drives the **real API in-process** (`app.inject`, Idempotency-Key on every create, If-Match where required, Accounts user for money, Sales for bookings/leads, Marketing for CMS) so every rule, number, snapshot, ledger row, demand, notification and audit row comes from the production code paths. Direct SQL is used only for two historical facts no endpoint can express (back-dated brochure downloads; moving finished site visits into the past) – see `SEED_FALLBACKS` in `seed/run.ts`.
* Dates are relative to today (IST). The worked-example booking is 150 days old, block P's fourteen stages complete between 145 and 28 days ago, the Flexi booking is 20 days old. Document numbers follow the financial year of each business date, so after March 2026 the prefixes read `…/2627/…` instead of `…/2526/…` – the sequence logic is unchanged.
* Before validating, the seed runs the `LEDGER_REBUILD` step (`rebuildAllLedgers`, a no-op when every ledger is already in the canonical posting order), so a seeded database is canonical by construction.
* The seed validates itself (and `test/integration/seed.test.ts` re-checks through the API): zero integrity findings, the ten SPEC §11 ledger rows to the paise, booking #1 COMPLETED and P1 SOLD, Tower C = 52 flats without 13xx/7xx, every customer's portal login sees only their bookings, and the counts above.
* Known deviation: rating a RESOLVED ticket closes it (service rule), so the RESOLVED defect/snag ticket is left unrated (the customer can rate it from the portal) and the CLOSED possession ticket carries the rating 5.
