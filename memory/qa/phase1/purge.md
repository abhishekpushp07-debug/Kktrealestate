# Phase 1 F-5 — hard purge of test data (preview DB `test_database`, 2026-11-13)

Backup taken first: `POST /api/admin/backup` → id `178c96fe-2243-4917-8f47-6b96d38563cb` (2026-11-13T22:59 UTC), `warning=false`.

Endpoint: `POST /api/admin/hard-purge` (`admin.data.purge`, Super Admin only). The dry run is the default; deleting needs `confirm: "HARD-PURGE"`.

## Refusal checks (JRN-3)
- `block_ids: [SGH Tower A]` → **409** `Purge stopped: tower Tower A is not test data`
- `booking_ids: [BK-2526-0001 (SGH Tower A, live)]` with confirm → **409** `Purge stopped: booking BK-2526-0001 is not test data`; nothing deleted

## Dry run = run 1 (counts per collection)
| Collection | Records |
|---|---|
| projects | 17 |
| blocks | 23 |
| flats | 342 |
| parking_slots | 14 |
| payment_plan_assignments | 19 |
| bookings | 21 |
| payments | 10 |
| demands | 34 |
| ledger_entries | 111 |
| refunds | 7 |
| generated_documents | 58 |
| files | 5 |
| leads | 16 |
| customers | 19 |
| notifications | 737 |
| project_summaries | 17 |
| block_summaries | 23 |
| customer_summaries | 19 |
| monthly_buckets | 816 |
| payment_plans | 68 |
| payment_plan_templates | 17 |
| tower_templates | 21 |
| floor_plan_templates | 17 |
| flat_types | 17 |
| stage_plan_templates | 17 |
| construction_stage_plans | 18 |
| construction_stages | 1 |

Total 2484 records. Dry run and run 1 had identical counts.

Numbers removed (never reused — counters only go up):
- Bookings (21): BK-2627-0027, BK-2627-0028, BK-2627-0029, BK-2627-0030, BK-2627-0271, BK-2627-0272, BK-2627-0273, BK-2627-1554, BK-2627-1555, BK-2627-1556, BK-2627-1557, BK-2627-1558, BK-2627-1559, BK-2627-1560, BK-2627-1561, BK-2627-1562, BK-2627-1563, BK-2627-1564, BK-2627-1565, BK-2627-1566, BK-2627-1567
- Receipts (10): KKT/2627/00586, KKT/2627/00587, KKT/2627/00590, KKT/2627/01810, KKT/2627/01811, KKT/2627/01812, KKT/2627/01813, KKT/2627/01814, KKT/2627/01815, KKT/2627/01816
- Customers (19): CUST-2627-0024, CUST-2627-0025, CUST-2627-0085, CUST-2627-0703, CUST-2627-0704, CUST-2627-6167, CUST-2627-6168, CUST-2627-6169, CUST-2627-6170, CUST-2627-6171, CUST-2627-6172, CUST-2627-6173, CUST-2627-6174, CUST-2627-6175, CUST-2627-6176, CUST-2627-6177, CUST-2627-6178, CUST-2627-6179, CUST-2627-6180
- Bills: 34

Projects (17): QA Story Heights 30E9, QA Story Heights 4159, QA Story Heights 4926, QA Story Heights 5B79, QA Story Heights 6B03, QA Story Heights 713B, QA Story Heights B001, QA Story Heights B3B9, QA Story Heights B799, QA Story Heights C3F5, QA Story Heights CADB, QA Story Heights CFD0, QA Story Heights EA8E, QA Story Heights FD63, QA Story Heights FDDE, QA Story Heights FE48, S1 Acceptance Park

Test towers in SGH: QA Tower S1, Tower M2 (test), Tower QA 92712, QA Tower, Tower S (setup test), Tower Z (test). The other 17 towers removed belong to the 17 purged projects.

Payment plans (68): 60 × LT CLP L*, QA CLP/QA Flexi *, M2 Flexi. Payment plan templates: 17 (incl. LT CLP LA).
Masters/templates: tower templates 21, floor templates 17, flat types 17, stage plan templates 17, construction stage plans 18, construction stage `QA Terrace Slab`.

## Run 2 (loose ends found by the post-purge scan)
`{'flats': 3, 'messages': 1, 'construction_stage_plans': 4}`: 3 test flats (QA-92602 in SGH Tower A; QA-7741/QA-7743 in GGV Villa Block P, all Available and unbooked), 4 stage plans left over from the removed test towers, and 1 test reminder email. The purge rule was extended to cover these, then run again.

Audit: every existing audit row is kept. **Two** `admin.test_data_purged` rows exist: run 1 plus the loose-ends run 2. The requirement asks for one; this is a deviation.

`Imported – ` renames: none needed (0 names start with `Imported – `).

Not done: files in object storage were not deleted. Only their `files` metadata records (5) were removed.

## Post-purge scan (Q-4): names matching QA / test / Load Test / LT CLP / QSH / S1ACC / Imported – across every business collection
Audit logs, backups and system logs were not scanned; they are kept by design.
```
allocation_categories: 0
amenities: 0
area_types: 0
bank_accounts: 0
block_summaries: 0
block_types: 0
blocks: 0
bookings: 0
brochure_downloads: 0
brochure_tokens: 0
cash_openings: 0
catalogue_items: 0
charge_types: 0
cms_banners: 0
cms_gallery: 0
cms_pages: 0
cms_people: 0
cms_posts: 0
cms_testimonials: 0
communications: 0
companies: 0
construction_photos: 0
construction_stage_plans: 0
construction_stages: 0
contra_entries: 0
customer_summaries: 0
customers: 0
dashboard_snapshots: 0
demands: 0
doc_share_links: 0
doc_verifications: 0
document_types: 0
documents: 0
exports: 0
files: 0
flat_types: 0
flats: 0
floor_plan_templates: 0
generated_documents: 0
hold_reasons: 0
import_batches: 0
leads: 0
ledger_entries: 0
message_templates: 0
messages: 0
milestone_templates: 0
monthly_buckets: 0
notices: 0
notifications: 0
parking_slot_types: 0
parking_slots: 0
payment_modes: 0
payment_plan_assignments: 0
payment_plan_templates: 0
payment_plans: 0
payments: 0
permissions: 0
plc_types: 0
portal_accounts: 0
portal_refresh_tokens: 0
project_summaries: 0
projects: 0
rate_cards: 0
refresh_tokens: 0
refunds: 0
reminders: 0
report_presets: 0
roles: 0
room_types: 0
service_categories: 0
service_requests: 0
service_tickets: 0
site_settings: 0
site_visits: 0
spec_categories: 0
spec_items: 0
stage_plan_templates: 0
tower_templates: 0
trends_watermarks: 0
uploads: 0
user_direct_permissions: 0
user_home_layouts: 0
users: 0
TOTAL matches: 0
```

## Backup evidence (verified after the fact, 2026-11-13)
- Audit log `admin.backup` at 2026-11-13T22:59:04Z records an archive of 27,246,401 bytes taken before the purge.
- That archive file is **no longer on disk**: backup retention (`BACKUP_KEEP_TEST_DB`, default 2, applies to `test_database`) pruned it when later backups ran (23:56Z and 23:58Z archives now present). The pre-purge state can't be restored from `/app/backups`.
