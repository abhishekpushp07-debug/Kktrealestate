# Phase 3: Declutter every work screen + master audit + Next step + journey reports + phone width + real click-through

Version: phase-3. Features: F-13 … F-20, F-43 (see `../overview.md`). Locked rules: `/app/memory/HANDOFF.md` §3, §5, §10. Gates: `../ALL_PHASES_TODO.md` "Gates". Builds on Phase 2: tokens (`frontend/src/styles/tokens.css`), the shell, the Home drill-downs ("Filtered from Home" chip), the connection matrix (506 cells) and the per-user client cache.

## Goal
Every work screen shows only what the user needs for the job in front of them: one main action, at most 5 tabs, the rest under "More". Every master earns its place by carrying its logic. Every save tells the user what to do next, so a journey always gets finished. Everything works on a phone, proven by a real click-through of the owner's 10-step story.

Presentation and flow only. No booking, payment, allocation, ledger, pricing, cancellation, numbering or stage rule changes. Every action that exists today stays reachable (main button, a tab, or "More").

## Functional requirements

### 3A Booking page (F-13)
- REQ-112 [always] The booking page shall show exactly 5 tabs: Overview · Bills & Receipts · Ledger · Documents · Activity.
- REQ-113 [always] Overview shall show the price snapshot (Cash share, Account share, charges, total), Balance (Due red / Advance green), next due bill with date, and part-paid text ("Cash part paid · Account ₹X open").
- REQ-114 [always] Bills & Receipts shall list the booking's bills and receipts with status, part-paid text, "Where this entry went" and print/share per row.
- REQ-115 [always] Ledger shall show the Udhar / Jama ledger in the words Bill raised / Received / Balance, with Σ Udhar − Σ Jama = outstanding − advance shown at the foot.
- REQ-116 [always] The booking page shall have one main action "Record payment" (opens the unchanged 5-field payment sheet) and a "More" menu holding exactly: Mark agreement signed, Revise agreement, Change plan, Transfer, Cancel, Print / Share cost sheet & letters.
- REQ-117 [unwanted] If an action is not allowed (e.g. Change plan after an instalment is paid, any action on a Cancelled booking), then "More" shall show it disabled with the reason, not hide it.
- REQ-118 [state] While a booking is Cancelled, the main action shall be "Pay refund" when a refund is due, otherwise none, and the page shall show the VOID state.

### 3B Customer 360 (F-14)
- REQ-119 [always] Customer 360 shall show exactly 5 tabs: Overview · Bookings · Money (all bills / receipts / ledger across bookings) · Documents & KYC · Activity.
- REQ-120 [always] The main action shall be "Record payment" when the customer has an active booking, otherwise "New booking".
- REQ-121 [always] "More" shall hold: Edit, Co-applicants, Statements (and the existing portal actions).
- REQ-122 [unwanted] If the user lacks `customer.kyc_view`, then Documents & KYC shall keep PAN / Aadhaar masked (unchanged rule).

### 3C Project page (F-15)
- REQ-123 [always] The project page shall show at most 5 tabs: Overview (collections + report links) · Structure · Inventory · Plans & Pricing · Construction, merging today's 6.
- REQ-124 [always] Inventory shall show a visual floor × flat status grid per tower using the Inventory statuses; clicking a flat opens its drawer (price, status, actions).
- REQ-125 [state] While the user lacks permission to see the real status, the grid shall show the "Show to sales as" status (unchanged rule).

### 3D Restyle + simplify (F-16)
- REQ-126 [always] The booking wizard shall stay exactly 3 steps (Who → Price & Plan → Confirm) and the payment sheet exactly 5 fields (Booking, Amount, Date, Mode, Bank account), restyled on the Phase 2 tokens.
- REQ-127 [always] Bills raised, Roznamcha, Construction, Masters and Documents shall be restyled on the tokens, with row actions in an icon menu.
- REQ-128 [always] The parking picker shall be searchable.
- REQ-129 [event] When a user types an amount, the field shall format it in Indian ₹ grouping (₹1,23,456) as they type, while the saved value stays exact paise.
- REQ-130 [always] No screen shall show internal words (ids, raw keys, snake_case, "paise", "demand" where the owner word is "Bill raised"), checked by an automated scan of rendered text on the key screens.

### 3E Master audit (F-43)
- REQ-131 [always] The system shall classify every one of the 13 masters and every Admin → Advanced catalogue as repeatable or one-off, recorded in `memory/qa/phase3/master_audit.md` with, per master: classification, the logic it carries (defaults, calc rule, GST %, trigger), where it is used, active / inactive.
- REQ-132 [always] Every repeatable master shall carry its logic and show "Used in N" (where-used) and an active / inactive switch.
- REQ-133 [always] A one-off value shall be typed directly on the entry form; no entry form shall require creating a master row for a one-time value.
- REQ-134 [event] When a user types a value on an entry form that matches a value typed before on 2 or more other entries (interpreted: 3rd use) and is not in the master, the form shall offer "Save to master" inline.
- REQ-135 [event] When a user saves a value to a master inline, the system shall add it to that master and select it on the current form, without leaving the form.
- REQ-136 [always] Changing a master shall affect new entries only; existing bookings keep their snapshot, and the master edit screen shall say so.
- REQ-137 [always] The connection matrix shall include a master-change action proving new entries use the new value and old bookings are unchanged.

### 3F Next step guidance (F-17)
- REQ-138 [event] When a user saves a booking, the system shall offer "Record booking amount" and "Print allotment letter".
- REQ-139 [event] When a stage is completed, the system shall show "N bills raised" with "Print demand letters".
- REQ-140 [event] When a payment is saved, the system shall offer "Print / share receipt".
- REQ-141 [event] When a booking is cancelled with a refund due, the system shall offer "Pay refund".
- REQ-142 [event] When a lead is saved, the system shall offer "Book site visit".
- REQ-143 [always] Next-step prompts shall be dismissible and never block the user; each opens the existing flow with the record pre-selected.

### 3G Reports hub by journey (F-18)
- REQ-144 [always] The Reports hub shall group reports by journey: Sales (Lead → Visit → Booking), Money (Bill raised → Received → Balance → Overdue → Refund), Construction (Stage → Bill), Inventory (Flat status), Admin.
- REQ-145 [always] Every report shall keep JSON / CSV / PDF export and drill-down, and report totals shall be unchanged (tie-outs).

### 3H Phone width (F-19)
- REQ-146 [always] Every screen shall work at 390 px with no horizontal page scroll; data tables shall become cards on narrow widths; no bottom tab bar (owner).
- REQ-147 [always] The main action on a work screen shall stay reachable at 390 px without scrolling sideways.

### 3I Real click-through (F-20)
- REQ-148 [always] The repo shall contain a Playwright suite that fills the real forms for the owner's 10-step story (master → project → tower → flats → pricing → lead → visit → booking → stage complete → payment → reversal → reports) on the private test copy and leaves no residue on the demo.
- REQ-149 [always] The click-through shall run as a gate at the end of every later phase.

### 3K Optional publish
- REQ-150 [event] When Phase 3 passes its gates, the orchestrator shall ask the owner once whether to publish this milestone to billpe.com.

## Quality requirements
```
Q-26 Tag: UX.TabsAndActions
     Scale: work screens (booking, Customer 360, project) with > 5 tabs or > 1 main action
     Meter: e2e DOM count on each screen type for 3 records each
     Must: 0
     Plan: 0
Q-27 Tag: UX.ActionReachability
     Scale: actions available before Phase 3 that are no longer reachable from main button / tab / More
     Meter: builder's action inventory before vs after (memory/qa/phase3/action_inventory.md) + e2e spot check
     Must: 0
     Plan: 0
Q-28 Tag: UX.InternalWords
     Scale: internal words shown on key screens (ids, snake_case keys, 'paise', 'demand')
     Meter: automated rendered-text scan on booking, Customer 360, project, Bills raised, Roznamcha, Reports, Masters
     Must: 0
     Plan: 0
Q-29 Tag: Master.Rule
     Scale: masters without logic/where-used, or entry forms forcing a master row for a one-off value
     Meter: memory/qa/phase3/master_audit.md + e2e on booking, payment, flat, charge entry forms
     Must: 0
     Plan: 0
Q-30 Tag: Device.Phone
     Scale: screens with horizontal page scroll or an unreachable main action at 390 × 844
     Meter: Playwright sweep of every route at 390 × 844 in Light and Night
     Must: 0
     Plan: 0
Q-31 Tag: Flow.ClickThrough
     Scale: failed steps in the 10-step owner story click-through
     Meter: committed Playwright suite (REQ-148), every phase gate
     Must: 0
     Plan: 0
Q-32 Tag: Speed.WorkScreens
     Scale: ms warm from click to content for booking page, Customer 360, project page
     Meter: Playwright, median of 5 per screen
     Must: ≤ 800
     Plan: ≤ 500
Q-33 Tag: Regression.OwnerLogic
     Scale: changed behaviour in booking, payment, allocation, ledger, pricing, cancellation, numbering (HANDOFF §3/§5)
     Meter: full pytest -n 2 + connection matrix + tieout
     Must: 0
     Plan: 0
```

### 3L Design excellence (owner, 2026-11-17: "customer cards and project cards beautiful · segmented and powerful · properly well-designed, not random ugly software · do not change the custom logic of staging and payment · think deeply")
Mockups (match their feel; ignore any sidebar in the customers mockup, use the projects mockup sidebar):
Projects https://static.prod-images.emergentagent.com/jobs/92d6d96a-a00e-413a-a590-f4514ce97e2e/images/958f344b9594c6e63ae4120a962ca31b81e482cb2884d35ea88c2c346d23581b.jpeg ·
Customers https://static.prod-images.emergentagent.com/jobs/92d6d96a-a00e-413a-a590-f4514ce97e2e/images/0fe9e881e0cacc5cbb4c6239de990b7c5d2953ffafc685166b2f157908b9fa7d.jpeg ·
Booking https://static.prod-images.emergentagent.com/jobs/92d6d96a-a00e-413a-a590-f4514ce97e2e/images/585de5526fbfb9c478d41f2a43a94a243711521af91eca1edd0df1e5a0acbfec.jpeg
Default project covers: towers https://static.prod-images.emergentagent.com/jobs/92d6d96a-a00e-413a-a590-f4514ce97e2e/images/2bb13224b358b58acff2395f83438c95d7367fa9ff466e28dc770e757e4730a6.jpeg · villas https://static.prod-images.emergentagent.com/jobs/92d6d96a-a00e-413a-a590-f4514ce97e2e/images/11ef1b15c98abc9ba524ad4d722bb5d98255e5f8cc25f69e8dad0ead9c23b51c.jpeg · planning https://static.prod-images.emergentagent.com/jobs/92d6d96a-a00e-413a-a590-f4514ce97e2e/images/e13d969109f9bc7b0d90762c31430e364c293d243bb7a88b218a25ce094fcc97.jpeg

- REQ-151 [always] The sidebar shall be segmented with group labels — Overview: Home · Sell: Projects, Customers, Bookings · Money: Payments · Build: Construction · Records: Documents, Reports · Setup: Masters, Admin — keeping the locked order of the areas.
- REQ-152 [always] Each project card shall show: cover image with a status chip, name, location · RERA, a stacked inventory bar (Sold / Booked / Hold / Available) with counts "of N", Collected, Outstanding (red), Next bill ₹ · stage, and one pill per tower with its construction % ring.
- REQ-153 [always] A project shall use its uploaded cover photo (Emergent Object Storage, set on Edit project) on the card and the project page hero, else the default cover for its type (towers / villas / planning).
- REQ-154 [state] While a project has no bookings, its card shall say "No bookings yet · Start selling" with a "Start selling" action instead of money figures.
- REQ-155 [always] The Projects page shall offer segments with live counts: All · Under construction · Planning · Ready (interpreted from the project status values).
- REQ-156 [always] Each customer card shall show: avatar, name, phone, one chip group per booking (project short code · flat · type), a bar "Received ₹X of ₹Y billed", a Balance line, a Next line, and a footer with the RM and icon buttons Call, WhatsApp (link only), Record payment.
- REQ-157 [always] The Balance line shall read "Due ₹X" in red with an "Overdue N days" pill when overdue, "Advance ₹X" in green when in advance, or "All clear" with a check when nothing is due — never "₹0".
- REQ-158 [always] The Next line shall show the next bill (stage, ₹, due date) or "Awaiting <stage> (<tower> at <current stage>)" for a stage-triggered instalment, or "No booking yet · Create booking".
- REQ-159 [always] The Customers page shall offer segments with live counts: Needs attention (default: overdue, follow-up due, or KYC pending on a booked customer) · Overdue 30+ · All clear · Advance · No booking yet · KYC pending · All; Needs attention sorts by overdue ₹ (highest first).
- REQ-160 [always] Each booking card shall show a plan progress bar with one segment per instalment coloured by status (paid / part-paid / billed / overdue / awaiting stage), "Stage k of n · next: <stage>", and the Balance line of REQ-157.
- REQ-161 [always] The Bookings page shall offer segments with live counts: Needs attention · Overdue · Agreement not signed · All clear · Cancelled · All.
- REQ-162 [always] The booking page Overview shall show a "Payment plan timeline": one row per instalment in plan order with trigger, %, ₹, stage status (completed date, or "Awaiting stage (<tower> at <current stage>)") and bill status (Paid <date> / part-paid text / Billed · due <date> / Overdue N days / Not billed), with other-charge lines grouped below; read-only, from existing data.
- REQ-163 [always] The booking page and Customer 360 shall show one money strip of exactly 4 figures — Agreement, Billed, Received, Balance (REQ-157 wording) — with a split line Cash · Account · Other; duplicate tiles (e.g. Balance and Outstanding side by side) and a second Record payment button on the same screen are removed.
- REQ-164 [always] Each tower card on the project page shall show its construction stage timeline (completed / next) and a mini flat-status grid.
- REQ-165 [always] Screens shall follow one design scale: at most 5 text sizes, sentence-case labels (no tiny ALL CAPS), at most 3 chips per card header, one card style, one icon set, short Indian money on cards (₹21.96 Cr, ₹5.2 L) with the exact value on hover and on detail screens, and words instead of bare zeros.
- REQ-166 [always] Every figure on these cards shall come from the same `services/definitions` functions as the reports (tie-outs); staging, payment plan, allocation and ledger logic shall not change.

### 3M Two consistency fixes decided by the orchestrator (owner: "you think for yourself")
- REQ-167 [event] When a user enters a cancellation deduction of 0 explicitly, the saved cancellation shall use 0, equal to the preview; a blank deduction shall use the policy deduction (one function for preview and save; permission and audit as today).
- REQ-168 [event] When a stage is undone, the auto-generated bill letters of the removed bills shall be stamped VOID, the same way cancellation letters are.
- REQ-169 [always] The stage-complete confirm dialog and Home "Next billing milestone" shall show instalment + agreement-GST share = total that posting raises.

### 3N KKT Elite design system (owner-approved 2026-11-17: "theme is very good now … coming out brilliant")
supersedes: the visual parts of REQ-151 … REQ-165 (calm-light / gold mockups). The data and behaviour of REQ-151 … REQ-169 stay.
Reference (real HTML, real font — the single source of truth for the look): `/app/memory/product/design/kkt_elite_reference.html`, published at `/design/elite.html` on preview. Frames: login, Home (Night), Customers (Night), Projects, Customer page, Report, Home (Day), Customers (Day).
Owner inputs: the KKT Elite Diamond Circle card; CRED (Gilroy-style sans, spaced grey section caps, white "Pay ₹X" buttons, "DUE ON 29 NOV" orange caps, dark promo banners); Jeelive (bold lowercase greeting, hero with ring + stats strip + CTA); sitepe reports (report header sheet with From/To + filters, GRAND TOTAL with the formula written in words, legend line); The Elite project photos (black + champagne gold + sapphire water light + travertine).

- REQ-170 [always] The app shall use one font family, Figtree (self-hosted, weights 400–800, tabular figures for money), with no serif anywhere.
- REQ-171 [always] Section titles shall be small grey uppercase with wide letter-spacing and an optional "view all ›" link; page titles shall be bold lowercase with a full stop ("customers.", "good evening, rajesh.") and a one-line muted summary under them.
- REQ-172 [always] The palette shall be: Night canvas near-black with a faint sapphire glow; surfaces graphite with hairline borders; sapphire blue for interaction, progress and rings; champagne gold only for premium moments (member card №, project name caps on banners, the KKT diamond ornament, "The Elite" tags); coral for Due / overdue amounts; orange spaced caps for "OVERDUE N DAYS"; mint for Advance. No other accent colours (owner: "elegance is priority, don't make it a rainbow").
- REQ-173 [always] Each main screen shall have at most one "Elite" hero surface (dark brushed-metal gradient, fine sapphire line, faint gold diamond lattice) for its most important figure; Elite surfaces stay dark in Day mode.
- REQ-174 [always] The theme switch shall offer exactly "Night" and "Day"; Night is the default for every user who has not chosen; Day is CRED-like white with black primary buttons. (supersedes the "Light / Night" wording of Phase 2 REQ-76; behaviour of REQ-77…80 unchanged.)
- REQ-175 [always] Money actions on rows and cards shall be one high-contrast pill button carrying the amount ("Collect ₹21.6 L", "Raise ₹1.44 Cr") with a status caption in spaced caps under it ("OVERDUE 45 DAYS" orange, "DUE ON 25 NOV" grey, "STAGE PENDING" grey).
- REQ-176 [always] The customer page shall show the customer as a KKT member card (name in spaced caps, flat line, № booking number in gold) next to Billed / Received / Balance tiles, the split line, and round quick actions (record payment, call, whatsapp, statement, documents, more).
- REQ-177 [always] Project cards shall be full-width banners: photo on the right fading into the dark surface, gold caps "<PROJECT> · <CITY> · <STATUS>", statement "N of M sold.", collected · outstanding, one progress line per tower, "Open project" + "next bill ₹X · <stage>".
- REQ-178 [always] Every report shall open with a report header sheet (journey caps, title, "N rows · scope · from → to", big From / To fields, search and filters, PDF / Excel), then a GRAND TOTAL card with the formula in words (e.g. "billed − received = outstanding"; "carried from before"; "outstanding till <date>"), then the table, then a one-line legend of the formula.
- REQ-179 [always] Home shall follow the reference: greeting, "Money today" Elite hero (received today, ring % of month, strip cash · account · other · cheques), "Money matters" tiles, "Call today" and "Ready to bill" lists with pill buttons; role defaults and drill-downs from Phase 2 stay.
- REQ-180 [always] The login screen shall show the company's login photo (KKT default: The Elite gate photo) beside a simple sign-in form.

### 3O Project photos (owner, 2026-11-17: "while creating project let me add pics which are to be used")
- REQ-181 [always] Creating or editing a project shall let the user add several photos (Emergent Object Storage), reorder them, remove them, and pick one as the cover.
- REQ-182 [always] The cover shall be used on the project banner and the project page hero; the other photos shall show as a gallery on the project page Overview.
- REQ-183 [unwanted] If a photo is not an image or is larger than 15 MB, then the upload shall be refused with "Photo must be an image under 15 MB".
- REQ-184 [always] Demo data: Shree Ganesh Heights shall use The Elite tower photo as its cover (owner photo); the login photo shall be The Elite gate photo. Owner photo URLs: tower https://customer-assets-4nw71qhi.emergentagent.net/job_kkt-homebase--9vc8be7x/artifacts/390bfd851d155de1_IMG-20260822-WA0229%284%29.jpg · gate https://customer-assets-4nw71qhi.emergentagent.net/job_kkt-homebase--9vc8be7x/artifacts/c7bf37c42f8eb629_IMG-20260822-WA0228%288%29.jpg (copy into storage/static, don't hotlink).

### 3N addendum — owner's KKT logo + Elite card language for customers (2026-11-17)
Assets (in `/app/memory/product/design/`): `kkt_logo_night.png` (silver KKT, for dark surfaces), `kkt_logo_day.png` (ink KKT, for white), `elite_diamond.png` (transparent). Cut from the owner's own card; the owner may later send the original logo file to replace them.
- REQ-185 [always] The app shall show the owner's KKT logo (night / day variant by theme) in the sidebar, the login screen, the member card and PDFs' on-screen previews — never a placeholder icon.
- REQ-186 [always] The customer member card (front) shall follow the owner's Elite card: brushed black metal, KKT logo top-left, the diamond top-right, project name in wide-spaced caps, a short sapphire rule + "TOWER · FLAT" in sapphire spaced caps, "HOMEOWNER · SINCE <month year>" small caps, the name in spaced caps, and "№ NNN / M" in sapphire (sapphire and silver only on customer screens).
- REQ-187 [always] "№ NNN / M" shall be the booking's member number within its project (1, 2, 3 … in booking order, fixed at booking, never reused; cancelled bookings keep theirs) over the project's total units; existing bookings are back-filled once in booking order. Display only — no money, numbering (BK-/KKT/) or booking rule changes.
- REQ-188 [event] When the user taps the member card, it shall flip to its back: "BOOKING" title with a sapphire rule, diamond bullets (booked date · plan; area · type · parking; agreement signed date or "agreement not signed"; relationship manager), a RERA QR code of the project's RERA registration (with "BIHAR RERA · <reg no>"), and the company line with logo and address.
- REQ-189 [state] While the project has no RERA number, the back shall show the empty QR frame with "RERA no. not added · add in project".
- REQ-190 [always] Customer list cards shall borrow the card language: faint brushed surface, sapphire rule + "PROJECT · FLAT · TYPE" spaced caps above the name, the pill money button, received bar, status caps, next line.
- REQ-191 [always] Customer list cards shall use the Jeelive hero structure in the KKT Elite skin (owner, 2026-11-17: "I meant this for customers — for ours, not entirely"), as in the reference `customers` frame: pill tag with a status dot "PROJECT · TOWER · FLAT"; "№ NNN / M" top-right; a status caps line (OVERDUE N DAYS / DUE ON <date> / ADVANCE HELD / NEXT · <bill>); the name as the bold statement; a ring "% received" (received ÷ billed); a 3-cell strip billed · received · due (or advance); a meta line (plan · stage k of n · current stage, or the part-paid text) with a pill (follow-up today / kyc ✓ / agreement pending / all clear); one full-width CTA ("Collect ₹X ›", or "Open customer ›" when nothing is due).
  supersedes: REQ-190 (card language only; the data stays).
- REQ-192 [always] The card tint shall carry status with restraint: deep wine + coral CTA only when overdue; navy-sapphire + sapphire CTA when due or upcoming; calm graphite + outline CTA when all clear or in advance. No other tints.

### 3P Reports hub, list pages and forms — owner's sitepe screens as structure only (owner, 2026-11-17: "only for inspiration … do not mistake it for a colourful one … those card colours are not that good, not that elegant … put your own thinking, make it beautiful, perfect, elegant")
Takeaways used: KPI tiles grouped in captioned sections with a count; one live number per tile + name + "tap for details"; period shown in the header; list page = header + summary figures + filters + tabs + search + empty state; forms in titled section cards with helper lines and live amounts. NOT used: their pastel / metallic / gradient tile colours, coloured labels per tile, coloured icons.
Master to-do for every design item: `/app/memory/product/design/DESIGN_TODO.md`.
- REQ-193 [always] The Reports hub shall show every report as a tile inside its journey group (Sales → Money → Construction → Inventory → Admin), each group headed in spaced grey caps with its report count. (interpreted)
- REQ-194 [always] Each report tile shall show one thin line icon, the report's live headline figure taken from the same `services/definitions` function as the report itself, the report name, and "tap for details". (interpreted)
- REQ-195 [always] All report tiles shall share one graphite surface with a hairline border (white card in Day); colour shall appear only on a figure that carries meaning (coral overdue, mint advance) — no per-tile tints, gradients, metallic or pastel fills. (interpreted)
- REQ-196 [always] The Reports hub header shall show the period the tiles use in words (e.g. "1 Apr 2026 → 16 Nov 2026 · India time"). (interpreted)
- REQ-199 [unwanted] If a tile's headline figure fails to load, then that tile shall show "—" with "tap to open" while the rest of the hub renders.
- REQ-197 [always] Every list page shall follow one header pattern: bold lowercase title with a one-line summary, one primary action top-right, a summary strip of at most 4 figures, a filter bar (From / To / main filter / search), status tabs with counts, and an empty state that names the next step (e.g. "No bookings yet · New booking"). (interpreted)
### 3Q Home rework after Part 1 (owner, 2026-11-17: "the big card is good, but it is almost the same as the background … a silver fading theme … something beautiful" · "below that there are lists — I would like widgets … make it more elegant, make it perfect")
supersedes: the "Money matters" tiles, "Call today" list and "Ready to bill" list parts of REQ-179 (greeting, period switch, project filter, role defaults, Customize, drill-downs and REQ-104…110 stay).
- REQ-200 [always] The Home "Money today" hero shall be a brushed-silver metal surface — a soft silver light sweep fading from the top-left corner into the dark base, a silver hairline edge, a faint brushed texture — so it stands clearly apart from the Night canvas; in Day it stays dark metal. (interpreted)
- REQ-201 [always] Below the hero, Home shall show widgets instead of lists, in captioned groups (Money · Today's work · Sales & stock · Construction) each with its widget count, 4 per row on desktop and 2 per row on phones. (interpreted)
- REQ-202 [always] Each widget shall show a thin sapphire line icon, a small caps tag (period or "LIVE"), one big figure, its label, a one-line detail caption (e.g. "45% of ₹9.1 Cr due"), and at most one quiet visual where it adds meaning (progress line, 5-band ageing bar, funnel line), on the same graphite surface for every widget. (interpreted)
- REQ-203 [event] When the user taps a widget, the system shall open the list whose total equals the widget's figure (the Call today and Ready to bill lists open behind their widgets, with call / WhatsApp / Raise actions). Failure partner: REQ-110.
- REQ-204 [always] The Home widgets shall carry the data of the Phase 2 widgets (REQ-91…101) from the same Home bundle and tie-outs; no new money definitions. (interpreted)

- REQ-198 [always] Every long form (new booking, new customer, new project, cancellation, transfer) shall be split into titled section cards with a short helper line under any field whose behaviour is not obvious and computed amounts shown read-only and live; fields, steps and rules shall not change (wizard still 3 steps, payment still 5 fields). (interpreted)

### 3R Other-charge ageing — owner decision 2026-11-18
Owner answers: each charge part counts from **its own bill date** · other charges get the **same days to pay as instalments** · sample customers **mostly pay their other charges, a few stay overdue**. Owner: "always use the best, most proficient logic … the world's best scalable platform … think deeply, make the right strategy, then execute."
Facts that led here: 77 of 80 customers showed overdue; 63 only because of other charges; ageing dated a whole other-charge line by its first billed date (`demanded_at`), not each increment's own date; the demo story made only 2 payments against other charges. GST-with-stages billing itself is correct and does not change.
Unchanged (locked): what is billed, when it is billed, amounts, GST-with-stages, posting, oldest-first allocation, Cash / Account / Other shares, receipt and booking numbering, refunds, cancellation.
- REQ-205 [always] Every billed part of an other charge (each GST-with-stage increment, parking, club membership, maintenance, cheque-bounce charge, manual charge) shall be its own ageing line with its own bill date.
- REQ-206 [always] Each other-charge part shall carry a due date = its bill date + the same days-to-pay that instalment bills use (same setting source and same India business-day counting); the due date shall be stored on the part when it is billed, so later changes to the setting never move old due dates.
- REQ-207 [always] A part shall count as Not due up to and including its due date (India day), and as overdue from the next India day, falling into 0–30 / 31–60 / 61–90 / 90+ by days past its due date — exactly like instalments.
- REQ-208 [always] Payments shall be matched to ageing lines oldest-first by the existing allocation rules; this change only splits and dates the lines, it does not change which bill a rupee settles.
- REQ-209 [always] One definition shall drive every place that shows due / overdue / ageing / days overdue / next due: Home widgets and hero, Outstanding & Ageing, Bills vs Collection, customer cards and segments, customer page, booking page, Call today, reminders and notices; all shall tie out to the same figure.
- REQ-210 [event] When the change ships, existing other-charge parts shall be back-filled with their own bill date and due date from stored history, through an audited, re-runnable migration that changes no amount and no balance.
- REQ-211 [always] The ageing computation shall stay batched and indexed (no per-booking queries) and meet the perf budget on the volume database as well as the demo, ready for many companies (Phase 4).
- REQ-212 [always] The demo story shall collect other charges the way real buyers do — most pay parking / club soon after booking and pay each GST part with the stage payment, through the real Record payment path — while a deterministic few stay overdue across every ageing band and a few are within their days-to-pay; the story stays repeatable for the same as-of date.
- REQ-213 [unwanted] If an other-charge part has no recoverable bill date in history, then the migration shall use the line's first billed date, flag it in the migration report and the data-quality report, and never invent a date.
