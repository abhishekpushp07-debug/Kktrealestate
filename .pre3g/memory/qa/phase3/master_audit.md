# Master audit — Phase 3 · 3E (REQ-131…137, owner's master rule of 14 Nov)

Counts are from the private test copy on 16 Nov. **Used in** is the same server count each master screen now shows ("Used in N"). Active/inactive is the switch on each row.

**Rule applied:** a master earns its place only if it is *repeatable* (picked again and again) **and** carries logic: a default, a calculation rule, a GST %, or a trigger. Defaults apply only when someone acts: they fill a visible box that can still be edited. Nothing is pre-filled silently. A value used once is typed straight on the form. Editing a master changes **new entries only**: bookings keep the snapshot they were made with, and every master edit screen says so.

## The 13 masters

| # | Master | Kind | Logic it carries | Where used (N · screens) | Active / inactive |
|---|---|---|---|---|---|
| 1 | Flat Types | Repeatable | BHK, rooms and areas (carpet → built-up → saleable), default rate ₹/sq ft and base price. These fill a flat's price only when flats are generated or edited. | **191** flats/towers · Structure, Inventory, flat panel, booking wizard | 5 / 0 |
| 2 | Floor Templates | Repeatable | Flats per floor; flat type and facing at each position | **8** tower templates · Tower Templates, Structure | 4 / 0 |
| 3 | Tower Templates | Repeatable | Floors, numbering pattern, floor map, refuge/podium floors, default stage plan and payment plans for a new tower | **5** towers · New tower, Structure | 5 / 0 |
| 4 | Construction Stages | Repeatable | Order, possession flag. A stage is the **trigger** that raises instalment bills when it is completed. | **93** payment/stage plans (4 stages not in any plan yet) · Construction, plans, booking ledger | 17 / 0 |
| 5 | Stage Plan Templates | Repeatable | Ordered stage list for a tower type | **5** tower templates · Construction, Tower Templates | 3 / 0 |
| 6 | Payment Plan Templates | Repeatable | Instalment % with trigger (on booking / on stage / on date / days after). Copied into a booking as its snapshot. | **6** tower templates; the 8 assigned plans are used by **78** active bookings · Plans & Pricing, wizard, Change plan | 4 / 0 (plans 8 / 0) |
| 7 | Charge Heads | Repeatable | Calculation rule (fixed / per sq ft / per sq ft × months / % of agreement), default value, **GST %**, when the bill is raised (on booking / on possession / at a stage / manual) | **189** bookings · wizard cost sheet, Bills & Receipts, ledger | 8 / 2 |
| 8 | Parking Slot Types | Repeatable | Groups slots (Covered/Open/Stilt/Basement) in the picker, register and ledger line. **Added in 3E:** default slot price, which fills the visible price box when adding slots of that type and can still be edited. | **132** slots · Parking register, wizard parking picker | 4 / 0 |
| 9 | Payment Modes | Repeatable | "Reference no. required" rule (enforced when a payment is recorded); cheque modes start the cheque clear/bounce path | **1,093** receipts · Record payment, Roznamcha, cheque register | 6 / 0 |
| 10 | Bank Accounts | Repeatable | Our own receiving accounts (number masked); default-account flag; account money and contra entries land here | **805** receipts/refunds · Record payment, Roznamcha contra, refunds | 1 / 0 |
| 11 | Lead Sources | Repeatable (typed allowed) | Source list for leads and funnel reports. **Changed in 3E:** a one-off source can be typed; on its 3rd use the form offers "Save to master". | **120** leads (11 sources unused) · Leads, funnel report | 17 / 0 |
| 12 | Document Types & Letterhead | Repeatable | Document type: which record it belongs to (customer / booking / project), which drives the upload pickers. Letterhead: company details and logo on every PDF. | Types: **0** uploads on this copy (uploads empty) · Documents & KYC upload, PDFs | 6 / 0 |
| 13 | Users & Roles | Repeatable | Role = permission set (what each person can see and do), project scope | 10 users · 8 roles · every screen | per user |

## Admin → Advanced catalogues

| Catalogue | Kind | Logic it carries | Where used (N) | Active / inactive |
|---|---|---|---|---|
| PLC types | Repeatable | Calculation rule (per sq ft / fixed / %) for location charges in rate cards | **5** rate-card rules (2 types unused) | 6 / 0 |
| Specification categories / items | Repeatable (reference) | Groups spec items; items attach to flat types for the spec sheet and brochure | 12 items · **50** flat-type links | 6 / 0 · 12 / 0 |
| Room types | Repeatable (reference) | Room list for a flat type layout | **36** flat-type rooms | 8 / 0 |
| Area types | Repeatable | Codes CARPET / BUILTUP / SUPER_BUILTUP drive the area order behind Saleable area | **21** flat-type areas | 6 / 0 |
| Block types | Repeatable | "Has floors" rule (tower vs single-level villa block) | **6** towers (2 types unused) | 5 / 0 |
| Amenities | Repeatable (reference) | Website and brochure amenity list | **18** project links | 12 / 0 |
| Rate cards | Repeatable | Per-project price list and PLC rules | 2 projects | 2 / 0 |
| Message templates | Repeatable | Reminder / receipt message text with merge fields | 6 templates | 6 / 0 |
| Notice templates | Repeatable | Website notice layout | **0** rows | — |
| Catalogues (brochures) | Repeatable | Brochure files with a lead-capture gate | Website | — |
| Website | Settings, not a list | Publish, prices shown, visit slots | — | — |
| Document types (Advanced link) | Same list as master 12 | — | — | — |
| Allocation categories | Repeatable | **Bookable** flag: flats in a non-bookable category cannot be sold. Also sets the colour on the inventory grid. | **54** flats (6 categories hold none now) | 7 / 0 |
| Hold reasons | Repeatable | Required reason for a hold; hold expiry runs on it | **3** active holds | 7 / 1 |
| Pick-lists (27 lists, 352 values: salutation, relation, state/city/locality, bank, occupation, income band, budget band, BHK/floor/facing preference, lost reason, cancellation reason, visit outcome, communication type/outcome, designation, broker channel, service category, nationality, company type, customer segment, gender, residency, document type) | Repeatable (reference) | Fill dropdowns; city → locality and state → city are linked. Lost reason and bank now accept typed values with Save to master. | Lost reason **7** leads; bank **409** receipts; the others are stored on customer/lead profiles | all active |

## One-off values — forms changed (REQ-133)

| Form field | Before | After |
|---|---|---|
| Lead → **Source** | Fixed list of 7 values; any other source had to be added to the code/master | Type any source. The list is a suggestion. Server accepts any text (≤ 60 chars). |
| Lead → **Lost reason** | Free text with no list | The list is a suggestion; any text can be typed; Save to master on the 3rd use |
| Record payment → **Drawn on bank** (cheque/NEFT instrument) | A bank had to be in the Banks list, so a new bank meant adding a master row first | Type the bank name. The list is a suggestion; Save to master on the 3rd use. |
| Booking → other charge name | Already typed (charge head optional) | unchanged |
| Cancel booking → reason | Already typed | unchanged |

## Save to master inline (REQ-134/135)

One shared component (`TypedMasterInput`) is used on all three fields above. The server counts earlier uses (`GET /api/catalogues/{list}/typed-value`). When a value is typed that is not in the list and was already used on **2 or more** earlier entries, the form shows "“X” was typed on N earlier entries · **Save to …**". Clicking it adds X to the list and selects it without leaving the form; the list then shows "Used in N". Users without the master-create right never see the offer.

## Master edits affect new entries only (REQ-136/137)

Every master and template edit screen shows: "Changes apply to new entries only · Used in N … Existing bookings keep the values they were made with." The connection matrix action **"master change (charge head GST %)"** now proves both sides:
- a new booking's cost sheet uses the new GST % (default and line);
- the older booking's charge lines are unchanged, and so are all 23 surfaces.

The value is restored afterwards.

## Removal candidates — for the owner's OK (nothing deleted)

| Candidate | Why | Suggestion |
|---|---|---|
| Admin → Advanced "Document types" link | Same list as master 12, reachable twice | Remove the duplicate link only |
| Notice templates | 0 rows on this copy | Keep hidden until the website uses notices, or remove |
| Unused values inside lists: 4 construction stages in no plan, 2 PLC types, 2 block types, 6 allocation categories, 6 hold reasons, 11 lead sources | Used in 0 | Owner can switch them inactive (the switch is on each row); no deletion needed |
