## 4. Data model — collections (generated from the live database)

69 collections. Field types are inferred from a representative document; `id` is always a UUID string (Mongo `_id` is never exposed). Money is stored as integer paise (`*_paise`). Dates are ISO strings.

### `amenities` (12 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "c89c8eac-d08f-4870-8f28-af3b7e7de484" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.538498+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.538498+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Swimming Pool" |
| `category` | str | "Lifestyle" |
| `icon` | str | "waves" |
| `description` | str | "Temperature-controlled pool with deck" |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `area_types` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "ad8a0235-87ad-43a5-8c2f-dcd67461dd65" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.528907+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.528907+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Carpet Area" |
| `code` | str | "CARPET" |
| `sort_order` | int | 1 |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `audit_logs` (9748 docs)

Immutable audit trail (actor, action, entity, before/after, ip, request id).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "65fa11ff-c33f-4e02-9765-ac8d53031309" |
| `company_id` | null | null |
| `actor_id` | str | "system" |
| `actor_name` | str | "System" |
| `action` | str | "company.create" |
| `entity_type` | str | "company" |
| `entity_id` | uuid (str) | "4b16375d-9813-4d23-8a4d-f62a253528a5" |
| `before` | null | null |
| `after` | object | 16 keys |
| `ip` | str | "" |
| `created_at` | datetime (ISO) | "2026-10-23T22:19:35.689982+00:00" |

Indexes: `entity_type:1, entity_id:1`, `created_at:-1`, `actor_id:1`, `company_id:1, created_at:-1`

### `backups` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `expires_at:1` TTL

### `bank_accounts` (1 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "6c37fcd1-9222-4ad3-b1c6-2d2bdea5ff6a" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.561555+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.561555+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `bank_name` | str | "State Bank of India" |
| `account_name` | str | "Shree Ganesh Builders Pvt Ltd" |
| `account_number_enc` | str | (secret — never returned) |
| `ifsc` | str | "SBIN0001234" |
| `branch` | str | "Boring Road, Patna" |
| `is_default` | bool | true |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `block_summaries` (5 docs)



| Field | Type | Example / note |
|---|---|---|
| `block_id` | uuid (str) | "3d30cc7f-5c79-4d8f-86b9-b3b90578c4a4" |
| `agreement_paise` | int | 1000000000 |
| `bookings` | int | 1 |
| `code` | str | "P" |
| `collections_mtd_paise` | int | 0 |
| `collections_total_paise` | int | 1006000000 |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `computed_at` | datetime (ISO) | "2026-10-25T08:27:55.805739+00:00" |
| `derived` | bool | true |
| `name` | str | "Villa Block P (Premium)" |
| `outstanding` | object | 4 keys |
| `overdue` | object | 2 keys |
| `paid_paise` | int | 1006000000 |
| `pending_cheques_paise` | int | 0 |
| `progress` | object | 5 keys |
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `status` | str | "Completed" |
| `units` | object | 6 keys |

Indexes: `block_id:1` unique, `project_id:1`

### `block_types` (5 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "c86c52c4-4ff6-4375-85d3-de9cdeae0aa7" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.534031+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.534031+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Tower" |
| `code` | str | "TOWER" |
| `has_floors` | bool | true |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `blocks` (5 docs)

Towers/blocks: floors, floor-plan assignments, skip/refuge/podium, construction stages, legacy milestones.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "19eff68e-1f8e-4e43-8f1d-dd572d0e65ed" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.575452+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.575452+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `block_type_id` | uuid (str) | "c86c52c4-4ff6-4375-85d3-de9cdeae0aa7" |
| `name` | str | "Tower A" |
| `code` | str | "A" |
| `floors` | int | 8 |
| `flats_per_floor` | int | 4 |
| `floor_start` | int | 1 |
| `numbering_pattern` | str | "{block}-{floor}{pos2}" |
| `position_flat_types` | list[object] | 4 items |
| `floor_plans` | list[object] | 2 items |
| `skip_floors` | list[…] | 0 items |
| `refuge_floors` | list[…] | 0 items |
| `podium_floors` | list[…] | 0 items |
| `ground_floor_label` | null | null |
| `milestone_template_id` | uuid (str) | "50880361-4c6f-4004-b826-a73994de3e2d" |
| `rate_per_sqft` | int | 4200 |
| `floor_rise_per_sqft` | int | 25 |
| `status` | str | "Under Construction" |
| `construction_percent` | int | 45 |
| `unit_counts` | object | 7 keys |
| `milestones` | list[object] | 11 items |
| `construction_stages` | list[object] | 11 items |
| `construction_stage_sequence` | list[object] | 11 items |
| `default_cash_percent` | null | null |

Indexes: `id:1` unique, `project_id:1, code:1` unique, `_fts:text, _ftsx:1`

### `bookings` (10 docs)

Agreements: buckets (cash/account), plan snapshot, other charges, revisions, cancellation, drafts.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "ebf64193-f49c-4c3b-a7f5-305c9c5b325c" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2025-11-01T10:00:00+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.844679+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `booking_number` | str | "BK-2526-0001" |
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `project_code` | str | "GGV" |
| `project_name` | str | "Ganesh Green Villas" |
| `block_id` | uuid (str) | "3d30cc7f-5c79-4d8f-86b9-b3b90578c4a4" |
| `block_code` | str | "P" |
| `block_name` | str | "Villa Block P (Premium)" |
| `flat_id` | uuid (str) | "7fe350bc-3b21-47dd-87b4-56dae68512bc" |
| `customer_id` | uuid (str) | "1469b5dc-10c1-4121-99a1-79b6034aa0ab" |
| `customer_name` | str | "Amit Kumar Sinha" |
| `customer_code` | str | "CUST-2526-0001" |
| `customer_phone` | str | "+919431012345" |
| `co_applicant_customer_ids` | list[…] | 0 items |
| `booking_date` | date (ISO) | "2025-11-01" |
| `agreement_value_paise` | int | 1000000000 |
| `cash_agreed_paise` | int | 600000000 |
| `account_agreed_paise` | int | 400000000 |
| `rate_per_sqft` | null | null |
| `flat_snapshot` | object | 6 keys |
| `milestone_template_snapshot` | list[object] | 10 items |
| `construction_percent` | int | 100 |
| `other_charges` | list[object] | 1 items |
| `parking_slot_ids` | list[uuid (str)] | 1 items |
| `sales_user_id` | uuid (str) | "c5b75c63-d94a-46a3-be1d-b92b95803990" |
| `lead_id` | null | null |
| `broker_name` | null | null |
| `remarks` | str | "Owner reference ledger example" |
| `status` | str | "Completed" |
| `cancellation` | null | null |
| `agreement_revisions` | list[…] | 0 items |
| `summary` | object | 14 keys |
| `ledger_rebuilt_at` | datetime (ISO) | "2026-10-25T08:50:40.753006+00:00" |

Indexes: `id:1` unique, `booking_number:1` unique, `project_id:1, status:1`, `block_id:1, status:1`, `customer_id:1`, `flat_id:1`, `company_id:1, status:1, booking_date:-1, id:1`, `company_id:1, customer_id:1, booking_date:-1`, `company_id:1, project_id:1, status:1, booking_date:-1`, `customer_name:1`

### `brochure_downloads` (5 docs)

One row per brochure download (sparkline source).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "8d1da06d-caa3-4d3a-9c66-6bd28b62dfda" |
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `lead_id` | uuid (str) | "96ea10bd-9575-41c8-83d4-08a8627af057" |
| `at` | datetime (ISO) | "2026-10-25T08:46:13.894059+00:00" |

Indexes: `lead_id:1, at:-1`, `project_id:1, at:-1`

### `brochure_tokens` (0 docs)

Signed-token nonces (TTL index) so a download link counts once.

| Field | Type | Example / note |
|---|---|---|

Indexes: `expires_at:1` TTL

### `cache` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `key:1` unique, `expires_at:1` TTL

### `catalogue_items` (351 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "9b5bef86-e99f-4e27-af11-8679a18651fa" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:55.715284+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:55.715284+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `type` | str | "salutation" |
| `code` | str | "MR" |
| `label` | str | "Mr" |
| `parent_id` | null | null |
| `meta` | object | 0 keys |
| `sort_order` | int | 0 |
| `is_system` | bool | true |

Indexes: `id:1` unique, `company_id:1, type:1, code:1` unique, `company_id:1, type:1, is_active:1, sort_order:1`

### `charge_types` (7 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "1e763782-27b5-41a7-b3ea-82baf28669a2" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.550496+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.550496+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Registry Charges" |
| `code` | str | "REGISTRY" |
| `default_amount` | null | null |
| `is_taxable` | bool | false |
| `sort_order` | int | 1 |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `cms_banners` (3 docs)

Home hero banners.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "08e2f88a-3d8d-46a4-89a5-a89dcbdcf440" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.075965+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.075965+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `order` | int | 1 |
| `image_url` | str | "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?a |
| `headline` | str | "Homes that rise with Patna" |
| `subheadline` | str | "Shree Ganesh Heights — 2 & 3 BHK residences on Bailey Road  |
| `cta_label` | str | "Explore Shree Ganesh Heights" |
| `cta_link` | str | "/projects/shree-ganesh-heights" |
| `cta2_label` | str | "Book a site visit" |
| `cta2_link` | str | "/contact" |
| `from_date` | null | null |
| `to_date` | null | null |

Indexes: `_id` only

### `cms_gallery` (18 docs)

Gallery items.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "0bf839b9-c015-4359-a599-9c3f63407428" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.078048+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.078048+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `order` | int | 1 |
| `project_id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `category` | str | "Exterior" |
| `image_url` | str | "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?a |
| `caption` | str | "Tower A & B elevation at dusk" |

Indexes: `_id` only

### `cms_pages` (3 docs)

Legal/static pages.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "1fc559c2-9934-4f39-bf77-9b5e0cc0f167" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.079950+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.079950+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `slug` | str | "about" |
| `title` | str | "About Shree Ganesh Builders" |
| `body` | str | "## Our story\n\nFounded in 1998 by Rajesh Kumar, Shree Gane |
| `sections` | object | 1 keys |

Indexes: `_id` only

### `cms_people` (3 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "2c375b79-2bef-4c59-8455-92a0a457a017" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.079137+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.079137+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `order` | int | 1 |
| `name` | str | "Rajesh Kumar" |
| `designation` | str | "Founder & Managing Director" |
| `photo_url` | str | "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2 |
| `bio` | str | "Civil engineer from NIT Patna, Rajesh founded Shree Ganesh  |

Indexes: `_id` only

### `cms_posts` (5 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "7066d905-36fd-4559-b374-21cae648c6da" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.080789+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.080789+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `title` | str | "Tower A reaches 60%: what construction-linked payments mean |
| `slug` | str | "sgh-tower-a-60-percent" |
| `cover_url` | str | "https://images.unsplash.com/photo-1560520653-9e0e4c89eb11?a |
| `excerpt` | str | "Tower A at Shree Ganesh Heights has crossed the 60% constru |
| `body` | str | "Tower A at Shree Ganesh Heights has crossed the **60% const |
| `tags` | list[str] | 2 items |
| `author` | str | "Shree Ganesh Builders" |
| `status` | str | "Published" |
| `publish_at` | datetime (ISO) | "2026-10-18T09:00:00+00:00" |
| `seo_title` | str | "Tower A reaches 60%: what construction-linked payments mean |
| `seo_description` | str | "Tower A at Shree Ganesh Heights has crossed the 60% constru |

Indexes: `_id` only

### `cms_testimonials` (6 docs)

Testimonials.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "41b66d94-ee46-4032-b327-1e70b2b8d3a0" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.077173+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.077173+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `order` | int | 1 |
| `name` | str | "Mr Amit Kumar Sinha" |
| `designation` | str | "4 BHK Villa, Ganesh Green Villas" |
| `photo_url` | str | "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2 |
| `quote` | str | "The ledger is so transparent — I could see every demand and |
| `rating` | int | 4 |
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `project_name` | str | "Ganesh Green Villas" |

Indexes: `_id` only

### `communications` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `id:1` unique, `company_id:1, customer_id:1, happened_at:-1`, `company_id:1, lead_id:1, happened_at:-1`

### `companies` (1 docs)

Tenant/company master (name, numbering formats, demand due days, GST, bank details).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.289793+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.289793+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Shree Ganesh Builders" |
| `brand` | str | "KKT" |
| `legal_name` | str | "Shree Ganesh Builders Pvt. Ltd." |
| `address` | object | 4 keys |
| `gstin` | str | "10AABCS1234F1Z5" |
| `rera_registration` | str | "BRERAP00123" |
| `logo_url` | null | null |
| `financial_year_start_month` | int | 4 |
| `receipt_prefix` | str | "SGB" |
| `bank_account` | object | 5 keys |
| `authorised_signatory_name` | str | "Rajesh Kumar" |
| `booking_number_format` | str | "BK-{FY}-{SEQ}" |
| `customer_number_format` | str | "CUST-{FY}-{SEQ}" |
| `default_gst_percent` | int | 18 |
| `demand_due_days` | int | 15 |
| `demand_number_format` | str | "DM-{FY}-{SEQ}" |
| `letterhead_email` | str | "accounts@shreeganeshbuilders.in" |
| `letterhead_phone` | str | "+91 612 2234567" |
| `letterhead_tagline` | str | "Building trust since 1998" |
| `receipt_number_format` | str | "{PREFIX}/{FY}/{SEQ}" |

Indexes: `id:1` unique

### `construction_photos` (50 docs)

Stage photos with customer visibility.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "0fc56517-caf6-4b57-b96b-11bae884a2d0" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:41.745923+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:41.745923+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `block_id` | uuid (str) | "19eff68e-1f8e-4e43-8f1d-dd572d0e65ed" |
| `milestone_seq` | int | 1 |
| `storage_key` | str | "construction/4c7d684d-358d-4ba6-88d7-d70165368c87/19eff68e- |
| `mime` | str | "image/jpeg" |
| `size` | int | 296431 |
| `caption` | str | "Tower A — Booking" |
| `taken_on` | date (ISO) | "2025-11-01" |
| `visible_to_customers` | bool | true |
| `show_on_website` | bool | false |
| `order` | int | 1 |
| `url` | str | "/api/public/media/photo/0fc56517-caf6-4b57-b96b-11bae884a2d |

Indexes: `_id` only

### `construction_stages` (16 docs)

Construction stage master sequence.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "5711a33f-c369-48ac-b5f4-212452a87d33" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `name` | str | "Excavation" |
| `code` | str | "EXCAVATION" |
| `description` | null | null |
| `seq_hint` | int | 10 |
| `is_possession` | bool | false |
| `applies_to_block_types` | list[…] | 0 items |
| `is_active` | bool | true |
| `version` | int | 1 |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:55.545887+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:55.545891+00:00" |
| `created_by` | str | "system" |

Indexes: `name:1` unique

### `contra_entries` (1 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "c55a9833-735c-4bbf-a0ee-0ee56757bbbd" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.063432+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.063432+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `date` | date (ISO) | "2025-11-05" |
| `kind` | str | "DEPOSIT" |
| `amount_paise` | int | 50000000 |
| `bank_account_id` | uuid (str) | "6c37fcd1-9222-4ad3-b1c6-2d2bdea5ff6a" |
| `bank_name` | str | "State Bank of India" |
| `remarks` | str | "Cash deposited at SBI Boring Road" |
| `by_name` | str | "Amit Verma" |

Indexes: `id:1` unique, `date:1`

### `counters` (9 docs)

Atomic sequences per FY/kind + round-robin pointer.

| Field | Type | Example / note |
|---|---|---|
| `scope` | str | "customer_number" |
| `key` | str | "2526" |
| `seq` | int | 12 |

Indexes: `scope:1, key:1` unique

### `customer_summaries` (12 docs)



| Field | Type | Example / note |
|---|---|---|
| `customer_id` | uuid (str) | "2fb29c1e-38ec-48d1-a11e-e9e3f2392efb" |
| `agreement_paise` | int | 710000000 |
| `bookings` | int | 1 |
| `brochure_downloads` | int | 0 |
| `collections_mtd_paise` | int | 0 |
| `collections_total_paise` | int | 177500000 |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `computed_at` | datetime (ISO) | "2026-10-25T08:27:55.863562+00:00" |
| `customer_code` | str | "CUST-2526-0007" |
| `derived` | bool | true |
| `due_paise` | int | 77500000 |
| `engagement_score` | int | 15 |
| `full_name` | str | "Manoj Tiwari" |
| `last_contacted_at` | null | null |
| `last_payment_at` | date (ISO) | "2026-02-20" |
| `lifecycle_stage` | str | "Customer" |
| `outstanding` | object | 4 keys |
| `overdue` | object | 2 keys |
| `overdue_paise` | int | 77500000 |
| `paid_paise` | int | 177500000 |
| `pending_cheques_paise` | int | 0 |
| `visits` | int | 0 |

Indexes: `customer_id:1` unique, `company_id:1, engagement_score:-1`

### `customers` (12 docs)

KYC-sealed customer master (PAN/Aadhaar encrypted + hashed), portal account flags.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "1469b5dc-10c1-4121-99a1-79b6034aa0ab" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.779893+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.779893+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `customer_code` | str | "CUST-2526-0001" |
| `salutation` | str | "Mr" |
| `full_name` | str | "Amit Kumar Sinha" |
| `father_or_spouse_name` | str | "Ramesh Sinha" |
| `dob` | date (ISO) | "1970-01-15" |
| `gender` | str | "Male" |
| `phone` | str | "+919431012345" |
| `alt_phone` | null | null |
| `email` | str | "amit.sinha@example.com" |
| `address_current` | object | 4 keys |
| `address_permanent` | object | 4 keys |
| `permanent_same_as_current` | bool | true |
| `occupation` | str | "Business" |
| `company_name` | null | null |
| `annual_income_band` | str | "10-25L" |
| `source` | str | "Referral" |
| `assigned_sales_user_id` | uuid (str) | "c5b75c63-d94a-46a3-be1d-b92b95803990" |
| `bank` | object | 3 keys |
| `nominee` | object | 3 keys |
| `co_applicants` | list[object] | 1 items |
| `kyc_status` | str | "Verified" |
| `kyc_verified_by` | uuid (str) | "3b167223-4312-437a-83b8-2d2483ebefbc" |
| `kyc_verified_at` | datetime (ISO) | "2025-11-01T10:00:00+00:00" |
| `notes` | null | null |
| `tags` | list[…] | 0 items |
| `pan_enc` | str | (secret — never returned) |
| `pan_hash` | str | "13fa00c2b994cb26eedb53467cb3c711819dabdd8ab85d87327416265d0 |
| `aadhaar_enc` | str | (secret — never returned) |
| `engagement_score` | int | 3 |
| `lifecycle_stage` | str | "Owner" |
| `gender_id` | uuid (str) | "f51c905d-61f8-4e5d-b450-823185f7ca2f" |
| `income_band_id` | uuid (str) | "5366fa54-b585-47a7-8152-117717f8f3d3" |

Indexes: `id:1` unique, `company_id:1, phone:1`, `pan_hash:1`, `customer_code:1` unique, `_fts:text, _ftsx:1`, `company_id:1, is_active:1, created_at:-1, id:1`, `company_id:1, full_name:1`, `company_id:1, lifecycle_stage:1, engagement_score:-1`, `company_id:1, assigned_sales_user_id:1, next_follow_up_at:1`

### `dashboard_snapshots` (1 docs)



| Field | Type | Example / note |
|---|---|---|
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `scope_hash` | str | "*" |
| `computed_at` | datetime (ISO) | "2026-10-25T08:45:27.975998+00:00" |
| `derived` | bool | true |
| `payload` | object | 3 keys |
| `scope` | list[str] | 1 items |

Indexes: `company_id:1, scope_hash:1` unique

### `demands` (53 docs)

Installment demands raised by the dues engine (one per booking+installment_seq).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "0473765a-b6cf-4cfd-bdcb-9d98cd3f35bd" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `booking_id` | uuid (str) | "ebf64193-f49c-4c3b-a7f5-305c9c5b325c" |
| `customer_id` | uuid (str) | "1469b5dc-10c1-4121-99a1-79b6034aa0ab" |
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `block_id` | uuid (str) | "3d30cc7f-5c79-4d8f-86b9-b3b90578c4a4" |
| `flat_id` | uuid (str) | "7fe350bc-3b21-47dd-87b4-56dae68512bc" |
| `demand_number` | str | "DM-2526-0001" |
| `milestone_seq` | int | 1 |
| `milestone_name` | str | "Booking" |
| `cumulative_percent` | int | 10 |
| `cash_demand_paise` | int | 60000000 |
| `account_demand_paise` | int | 40000000 |
| `total_demand_paise` | int | 100000000 |
| `demand_date` | date (ISO) | "2025-11-01" |
| `due_date` | date (ISO) | "2025-11-16" |
| `status` | str | "Paid" |
| `paid_paise` | int | 100000000 |
| `voided` | bool | false |
| `posted_at` | datetime (ISO) | "2025-11-01T09:30:00+00:00" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.815818+00:00" |
| `installment_name` | str | "Booking" |
| `installment_seq` | int | 1 |
| `percent` | float | 10.0 |
| `trigger` | str | "On booking" |
| `trigger_stage_id` | null | null |
| `trigger_type` | str | "ON_BOOKING" |

Indexes: `id:1` unique, `booking_id:1, posted_at:1`, `block_id:1, milestone_seq:1`, `company_id:1, status:1, due_date:1`, `booking_id:1, installment_seq:1` unique partial, `customer_id:1, status:1, due_date:1`, `project_id:1, status:1, due_date:1` partial

### `document_types` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "81ba395c-25ba-462a-84aa-fc12ece1119f" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.562586+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.562586+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "PAN Card" |
| `code` | str | "PAN" |
| `applies_to` | str | "customer" |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `documents` (5 docs)

Uploaded files metadata (object-storage key, mime, size, sharing flags).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "59d672e8-c33d-42f1-af9e-f7a33ce52568" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:55.157448+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:55.157448+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `entity_type` | str | "booking" |
| `entity_id` | uuid (str) | "ebf64193-f49c-4c3b-a7f5-305c9c5b325c" |
| `document_type_id` | null | null |
| `document_type_name` | str | "Allotment letter" |
| `title` | str | "Allotment letter BK-2526-0001" |
| `file_name` | str | "allotment-BK-2526-0001.pdf" |
| `mime` | str | "application/pdf" |
| `size` | int | 4820 |
| `storage_key` | str | "documents/7ee62ac6-926d-471f-8c7e-f7c30848bb86/booking/ebf6 |
| `is_sensitive` | bool | false |
| `shared_with_customer` | bool | true |
| `uploaded_by` | null | null |

Indexes: `id:1` unique, `entity_type:1, entity_id:1`

### `flat_types` (5 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "d1495095-a96d-4270-adb0-dd2fe4c2a5e6" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.567546+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.567546+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "2BHK-A" |
| `code` | str | "2BHK-A" |
| `bhk` | int | 2 |
| `facing` | str | "E" |
| `description` | str | "Compact 2 BHK with balcony" |
| `rooms` | list[object] | 7 items |
| `areas` | list[object] | 4 items |
| `base_rate_per_sqft` | int | 4000 |
| `base_price` | null | null |
| `spec_item_ids` | list[uuid (str)] | 10 items |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `flats` (138 docs)

Units generated per block: number, floor, type snapshot, areas, price breakup, status, booking link.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "1d2c16d7-ff12-4ebb-8dd3-4d40060402c1" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.578931+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.605417+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `block_id` | uuid (str) | "19eff68e-1f8e-4e43-8f1d-dd572d0e65ed" |
| `flat_type_id` | uuid (str) | "9a11307a-f6eb-428b-8d7c-4dc5f1af1b58" |
| `flat_type_code` | str | "3BHK-A" |
| `flat_number` | str | "A-101" |
| `floor` | int | 1 |
| `floor_label` | str | "1" |
| `position` | int | 1 |
| `facing` | str | "N" |
| `is_corner` | bool | true |
| `status` | str | "Hold" |
| `rooms_snapshot` | list[object] | 10 items |
| `areas_snapshot` | list[object] | 4 items |
| `carpet_sqft` | int | 950 |
| `builtup_sqft` | int | 1100 |
| `super_builtup_sqft` | int | 1450 |
| `rate_per_sqft` | int | 4200 |
| `price` | int | 6090000 |
| `price_breakup` | list[object] | 1 items |
| `rate_card_id` | null | null |
| `notes` | null | null |
| `status_changed_at` | datetime (ISO) | "2026-10-25T08:27:39.605410+00:00" |
| `status_reason` | str | "Reserved for channel partner" |

Indexes: `id:1` unique, `block_id:1, flat_number:1` unique, `project_id:1, status:1`, `block_id:1, floor:1, position:1`, `_fts:text, _ftsx:1`, `flat_number:1`, `company_id:1, status:1, project_id:1`

### `floor_plan_templates` (4 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "f5843977-716d-463e-b7d0-e0030790e66c" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.633867+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.633867+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Typical A" |
| `code` | str | "TYP-A" |
| `flats_per_floor` | int | 4 |
| `positions` | list[object] | 4 items |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `idempotency_keys` (0 docs)

Idempotency-Key → cached response for POSTs.

| Field | Type | Example / note |
|---|---|---|
| `user_id` | str | "35.225.230.28,172.70.194.157,34.149.9.106" |
| `key` | uuid (str) | "aa6ec2f7-45cd-468e-b1db-c94ffed64756" |
| `path` | str | "/api/auth/login" |
| `status` | int | 200 |
| `body` | str | "{\"access_token\":\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ey |
| `created_at` | datetime | "2026-10-25 08:29:45.915000" |

Indexes: `user_id:1, key:1` unique, `created_at:1` TTL

### `import_batches` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `_id` only

### `leads` (8 docs)

CRM leads with stage history, follow-ups, activities timeline, assignment.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "ddfe57d0-da32-4c4b-b2dc-dc8d09d0b9aa" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.803536+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:46:13.886460+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `lead_number` | str | "LD-2627-0001" |
| `name` | str | "Arvind Kumar" |
| `phone` | str | "+919430011111" |
| `email` | str | "arvind@example.com" |
| `project_id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `flat_type_id` | null | null |
| `budget_min` | int | 4000000 |
| `budget_max` | int | 7000000 |
| `source` | str | "Website" |
| `status` | str | "New" |
| `stage_history` | list[object] | 1 items |
| `assigned_to` | uuid (str) | "c5b75c63-d94a-46a3-be1d-b92b95803990" |
| `notes` | null | null |
| `follow_ups` | list[object] | 1 items |
| `next_follow_up_at` | datetime (ISO) | "2026-10-25T11:00:00+00:00" |
| `lost_reason` | null | null |
| `converted_customer_id` | null | null |
| `activities` | list[object] | 1 items |

Indexes: `id:1` unique, `company_id:1, status:1`, `next_follow_up_at:1`, `company_id:1, source:1, is_read:1`, `company_id:1, status:1, created_at:-1, id:1`, `company_id:1, project_id:1, status:1`, `company_id:1, phone:1`, `company_id:1, assigned_to:1, next_follow_up_at:1`

### `ledger_entries` (2982 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "d273ee1a-5597-4f96-96eb-87a3187ab2f7" |
| `booking_id` | uuid (str) | "ebf64193-f49c-4c3b-a7f5-305c9c5b325c" |
| `seq` | int | 1 |
| `at` | datetime (ISO) | "2025-11-01T09:30:00+00:00" |
| `date` | date (ISO) | "2025-11-01" |
| `type` | str | "DEMAND" |
| `construction_percent` | int | 10 |
| `category` | null | null |
| `amount_paise` | int | 100000000 |
| `note` | str | "Booking (10.0%)" |
| `ref` | str | "DM-2526-0001" |
| `cash_paid_cum_paise` | int | 0 |
| `account_paid_cum_paise` | int | 0 |
| `cash_order_raised_paise` | int | 60000000 |
| `account_order_raised_paise` | int | 40000000 |
| `cash_due_paise` | int | 60000000 |
| `account_due_paise` | int | 40000000 |
| `total_due_paise` | int | 100000000 |
| `other_charges_due_paise` | int | 6000000 |

Indexes: `id:1` unique, `booking_id:1, seq:1`, `booking_id:1, ref:1`

### `locks` (1 docs)



| Field | Type | Example / note |
|---|---|---|
| `name` | str | "scheduler" |
| `expires_at` | datetime | "2026-10-25 08:51:25.550000" |
| `owner` | str | "agent-env-a2ad8b1d-236b-431e-8c34-6627548d7c1b:10914" |

Indexes: `name:1` unique

### `login_events` (1398 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "f6e3aee2-cc3a-4d13-bebd-3b98191ddc23" |
| `email` | str | "admin@kkt.in" |
| `user_id` | uuid (str) | "e6d1f80b-4ffa-40c7-aeda-15f66372e1a2" |
| `success` | bool | true |
| `reason` | str | "ok" |
| `ip` | str | "127.0.0.1" |
| `user_agent` | str | "curl/7.88.1" |
| `created_at` | datetime (ISO) | "2026-10-23T22:58:28.400409+00:00" |

Indexes: `created_at:-1`, `email:1`, `account_id:1, success:1, created_at:-1`

### `milestone_templates` (2 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "50880361-4c6f-4004-b826-a73994de3e2d" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.548719+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.548719+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Standard CLP" |
| `milestones` | list[object] | 10 items |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `notices` (2 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "5fccec67-d11d-4358-90ee-f0e2c57241c4" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.548019+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.548019+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `title` | str | "Diwali office hours & site visit slots" |
| `body` | str | "Our offices will remain open **10 am – 4 pm** during the fe |
| `project_ids` | list[…] | 0 items |
| `project_names` | list[…] | 0 items |
| `publish_at` | datetime (ISO) | "2026-10-25T08:27:40.548027+00:00" |
| `expires_at` | null | null |
| `pinned` | bool | true |

Indexes: `_id` only

### `notifications` (67 docs)

ERP user notifications.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "36c2e16e-aac7-42fe-8a23-184eda88418e" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:54.985772+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:54.985801+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `user_id` | uuid (str) | "c5b75c63-d94a-46a3-be1d-b92b95803990" |
| `title` | str | "New service request" |
| `body` | str | "SR-2627-0001 · Receipt for NEFT not received · Priya Verma" |
| `kind` | str | "service.create" |
| `entity_type` | str | "service_request" |
| `entity_id` | uuid (str) | "0c3779a9-5867-465d-936b-19e0adaf14a2" |
| `link` | str | "/service-requests/0c3779a9-5867-465d-936b-19e0adaf14a2" |
| `read` | bool | false |

Indexes: `user_id:1, read:1, created_at:-1`, `user_id:1, withdrawn:1, read:1`

### `parking_slots` (132 docs)

Parking inventory & allotment.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "1c15cc57-f98b-478e-a3ba-f9a34be76c8d" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.742671+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.742671+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `number` | str | "SB001" |
| `type` | str | "Basement" |
| `level` | str | "B1" |
| `price` | int | 350000 |
| `status` | str | "Allotted" |
| `flat_id` | null | null |
| `booking_id` | uuid (str) | "9aa47f45-1cef-4160-8fc7-2edf6ce1bd5b" |
| `customer_id` | uuid (str) | "f0cdddf8-1e69-4213-8ddc-e8a24920d075" |

Indexes: `id:1` unique, `project_id:1, number:1` unique, `project_id:1, status:1`

### `payment_modes` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "59e872ad-fadb-4ac1-96c5-0078b3d71a69" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.556277+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.556277+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Cash" |
| `code` | str | "CASH" |
| `requires_reference` | bool | false |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `payment_plan_assignments` (7 docs)

Plan ↔ project/tower assignment (default flag).

| Field | Type | Example / note |
|---|---|---|
| `block_id` | null | null |
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `payment_plan_id` | uuid (str) | "4de6f977-e9f9-4707-9f65-5e797388893b" |
| `block_name` | null | null |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:55.554369+00:00" |
| `created_by` | str | "system" |
| `effective_from` | null | null |
| `effective_to` | null | null |
| `id` | uuid (str) | "890348dd-6ddd-46c6-8921-7891685f29d6" |
| `is_active` | bool | true |
| `is_default` | bool | true |
| `plan_code` | str | "VILLA_CLP" |
| `plan_name` | str | "Villa CLP" |
| `project_name` | str | "Ganesh Green Villas" |

Indexes: `project_id:1, block_id:1, is_active:1`

### `payment_plans` (4 docs)

Payment plan masters with installments and triggers.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "2cd9d74d-6c4f-41b7-8e3d-ff0c6c19dd9c" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `name` | str | "Standard CLP" |
| `code` | str | "STANDARD_CLP" |
| `description` | str | "Converted from milestone template 'Standard CLP'" |
| `plan_type` | str | "CLP" |
| `installments` | list[object] | 10 items |
| `applies_percent_to` | str | "BOTH_BUCKETS" |
| `grace_days` | int | 0 |
| `is_active` | bool | true |
| `version` | int | 1 |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:55.551433+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:55.551437+00:00" |
| `created_by` | str | "system" |
| `legacy_template_id` | uuid (str) | "50880361-4c6f-4004-b826-a73994de3e2d" |

Indexes: `name:1` unique

### `payments` (0 docs)

Receipts: amount in paise, category, mode, clearing status, reversal.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "23149fc9-e91d-4062-8ea2-fc0f5603f905" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2025-11-03T14:00:00+00:00" |
| `updated_at` | datetime (ISO) | "2025-11-03T14:00:00+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `receipt_number` | str | "SGB/2526/00001" |
| `booking_id` | uuid (str) | "ebf64193-f49c-4c3b-a7f5-305c9c5b325c" |
| `booking_number` | str | "BK-2526-0001" |
| `customer_id` | uuid (str) | "1469b5dc-10c1-4121-99a1-79b6034aa0ab" |
| `customer_name` | str | "Amit Kumar Sinha" |
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `project_code` | str | "GGV" |
| `block_id` | uuid (str) | "3d30cc7f-5c79-4d8f-86b9-b3b90578c4a4" |
| `block_code` | str | "P" |
| `flat_id` | uuid (str) | "7fe350bc-3b21-47dd-87b4-56dae68512bc" |
| `flat_number` | str | "P1" |
| `against` | str | "FLAT_VALUE" |
| `payment_category` | str | "Account" |
| `other_charge_line_id` | null | null |
| `other_charge_name` | null | null |
| `amount_paise` | int | 40000000 |
| `payment_date` | date (ISO) | "2025-11-03" |
| `payment_mode_id` | uuid (str) | "1893c2d8-a054-43f9-bd75-a92c2c0db4a9" |
| `payment_mode_code` | str | "NEFT_RTGS" |
| `payment_mode_name` | str | "NEFT / RTGS" |
| `instrument` | object | 4 keys |
| `bank_account_id` | uuid (str) | "6c37fcd1-9222-4ad3-b1c6-2d2bdea5ff6a" |
| `bank_account_name` | str | "State Bank of India ****7890" |
| `remarks` | null | null |
| `received_by` | uuid (str) | "3b167223-4312-437a-83b8-2d2483ebefbc" |
| `received_by_name` | str | "Amit Verma" |
| `status` | str | "Cleared" |
| `cleared_at` | datetime (ISO) | "2025-11-03T14:00:00+00:00" |
| `bounced_at` | null | null |
| `reversal` | null | null |
| `idempotency_key` | null | null |
| `posted_at` | datetime (ISO) | "2025-11-03T14:00:00+00:00" |

Indexes: `id:1` unique, `receipt_number:1` unique, `booking_id:1, status:1`, `company_id:1, payment_date:-1`, `project_id:1, payment_date:-1`, `company_id:1, status:1, payment_date:-1, id:1`, `booking_id:1, against:1, payment_category:1, status:1`, `customer_id:1`, `company_id:1, status:1, payment_mode_code:1` partial

### `plc_types` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "3d5603cc-280e-4893-b17b-bc0650eae2d0" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.663596+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.663596+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Floor Rise" |
| `code` | str | "FLOOR_RISE" |
| `calc` | str | "per_sqft" |
| `description` | null | null |
| `sort_order` | int | 1 |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `portal_accounts` (12 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "54d56d9e-af0e-41cb-915e-48b96e96795a" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.537334+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.537334+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `customer_id` | uuid (str) | "b0a57aa2-aa0f-43bc-bca9-e7a14bd09120" |
| `login_phone` | str | "9431001234" |
| `password_hash` | str | (secret — never returned) |
| `must_change_password` | bool | false |
| `failed_attempts` | int | 0 |
| `locked_until` | null | null |
| `last_login_at` | null | null |
| `read_notice_ids` | list[…] | 0 items |

Indexes: `customer_id:1`

### `portal_refresh_tokens` (1 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | str | "edb64b508d0f967b" |
| `account_id` | uuid (str) | "afd26ae9-c026-4e76-9ca7-6ce5dd444bc7" |
| `family` | str | "85ad8898f98a084f" |
| `token_hash` | str | (secret — never returned) |
| `revoked` | bool | false |
| `ip` | str | "35.225.230.28" |
| `ua` | str | "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML,  |
| `created_at` | datetime (ISO) | "2026-10-25T08:30:54.498156+00:00" |
| `expires_at` | datetime (ISO) | "2026-11-24T08:30:54.498162+00:00" |

Indexes: `_id` only

### `project_summaries` (2 docs)



| Field | Type | Example / note |
|---|---|---|
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `agreement_paise` | int | 2100000000 |
| `blocks` | list[object] | 2 items |
| `bookings` | int | 2 |
| `city` | str | "Patna" |
| `code` | str | "GGV" |
| `collections_mtd_paise` | int | 0 |
| `collections_total_paise` | int | 1981000000 |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `computed_at` | datetime (ISO) | "2026-10-25T08:38:27.924985+00:00" |
| `cover_image_url` | null | null |
| `derived` | bool | true |
| `leads_open` | int | 3 |
| `name` | str | "Ganesh Green Villas" |
| `outstanding` | object | 4 keys |
| `overdue` | object | 2 keys |
| `paid_paise` | int | 1831000000 |
| `pending_cheques_paise` | int | 0 |
| `progress_pct` | float | 83.5 |
| `status` | str | "Planning" |
| `towers` | int | 2 |
| `units` | object | 6 keys |
| `visits_upcoming` | int | 0 |

Indexes: `project_id:1` unique, `company_id:1, project_id:1`

### `projects` (2 docs)

Projects incl. address, RERA, unit counts, `website` sub-document (CMS/SEO/brochure gate/site-visit settings).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.572224+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.572224+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Shree Ganesh Heights" |
| `code` | str | "SGH" |
| `description` | str | "Premium high-rise residential towers in the heart of Patna  |
| `project_type` | str | "Residential" |
| `address` | object | 4 keys |
| `rera_number` | str | "BRERAP00123" |
| `launch_date` | date (ISO) | "2025-10-15" |
| `expected_possession_date` | date (ISO) | "2028-12-31" |
| `status` | str | "Under Construction" |
| `amenity_ids` | list[uuid (str)] | 12 items |
| `milestone_template_id` | uuid (str) | "50880361-4c6f-4004-b826-a73994de3e2d" |
| `cover_image_url` | null | null |
| `default_cash_percent` | int | 60 |
| `is_published` | bool | false |
| `show_prices` | bool | false |
| `show_availability` | bool | false |
| `block_count` | int | 3 |
| `unit_counts` | object | 7 keys |
| `approvals` | list[object] | 3 items |
| `escrow_bank_account_id` | uuid (str) | "6c37fcd1-9222-4ad3-b1c6-2d2bdea5ff6a" |
| `geo` | object | 2 keys |
| `land_area_sqft` | int | 217800 |
| `landmarks` | list[object] | 3 items |
| `phases` | list[object] | 2 items |
| `team` | list[uuid (str)] | 2 items |
| `website` | object | 19 keys |
| `construction_stage_sequence` | list[object] | 9 items |

Indexes: `id:1` unique, `company_id:1, code:1` unique, `_fts:text, _ftsx:1`

### `rate_cards` (2 docs)

Rate cards per project/block.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "d3dde93f-e352-4909-8724-0ada3c1f9245" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.668754+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.668754+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `name` | str | "SGH Launch Rate Card FY26" |
| `effective_from` | date (ISO) | "2026-04-01" |
| `rates` | list[object] | 4 items |
| `plc_rules` | list[object] | 3 items |
| `notes` | str | "Seeded" |
| `status` | str | "Active" |
| `activated_at` | datetime (ISO) | "2026-10-25T08:27:39.668746+00:00" |
| `superseded_by` | null | null |
| `applied_at` | datetime (ISO) | "2026-10-25T08:27:39.668751+00:00" |
| `applied_count` | int | 115 |

Indexes: `id:1` unique, `project_id:1, status:1`

### `rate_limits` (4 docs)

Mongo-backed sliding-window counters.

| Field | Type | Example / note |
|---|---|---|
| `slot` | int | 29881969 |
| `bucket` | str | "login:127.0.0.1" |
| `count` | int | 1 |
| `expires_at` | datetime | "2026-10-25 08:51:21.648000" |

Indexes: `bucket:1, slot:1` unique, `expires_at:1` TTL

### `refresh_tokens` (9 docs)

Rotating refresh tokens (family id, reuse detection).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "6a27c696-2fec-4374-af88-f6003be1427b" |
| `user_id` | uuid (str) | "6396ea03-7ba8-4f48-bbac-763d02103836" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `token_hash` | str | (secret — never returned) |
| `revoked` | bool | false |
| `ip` | str | "127.0.0.1" |
| `user_agent` | str | "curl/7.88.1" |
| `created_at` | datetime (ISO) | "2026-10-25T08:28:32.221461+00:00" |
| `last_seen_at` | datetime (ISO) | "2026-10-25T08:28:32.221464+00:00" |
| `expires_at` | datetime (ISO) | "2026-11-01T08:28:32.221466+00:00" |

Indexes: `token_hash:1` unique, `user_id:1`

### `report_cache` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `expires_at:1` TTL

### `report_presets` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `user_id:1, report_key:1`

### `roles` (6 docs)

System + custom roles with permission lists.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "0780b8f8-55e9-4c4d-b4e8-5db830467d36" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.291109+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.291109+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Super Admin" |
| `description` | str | "Full access to everything" |
| `permissions` | list[str] | 36 items |
| `is_system` | bool | true |

Indexes: `id:1` unique, `company_id:1, name:1`

### `room_types` (8 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "61482341-5915-43fd-a80c-cca49b6113a7" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.520558+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.520558+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Living Room" |
| `code` | str | "LIVING" |
| `icon` | str | "sofa" |
| `sort_order` | int | 1 |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `service_categories` (7 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "894ccd10-7f3d-4083-9e00-acdab44b0ca0" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.545955+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.545955+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Payment query" |
| `order` | int | 0 |

Indexes: `_id` only

### `service_requests` (5 docs)

Customer service tickets with SLA, notes, attachments, rating.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "0c3779a9-5867-465d-936b-19e0adaf14a2" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:54.984026+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:54.984026+00:00" |
| `created_by` | null | null |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `ticket_number` | str | "SR-2627-0001" |
| `customer_id` | uuid (str) | "f0cdddf8-1e69-4213-8ddc-e8a24920d075" |
| `customer_name` | str | "Priya Verma" |
| `customer_phone` | str | "+919431023456" |
| `booking_id` | uuid (str) | "9aa47f45-1cef-4160-8fc7-2edf6ce1bd5b" |
| `booking_number` | str | "BK-2526-0002" |
| `project_id` | uuid (str) | "4c7d684d-358d-4ba6-88d7-d70165368c87" |
| `project_name` | str | "Shree Ganesh Heights" |
| `block_id` | uuid (str) | "19eff68e-1f8e-4e43-8f1d-dd572d0e65ed" |
| `flat_number` | str | "A-201" |
| `category` | str | "Payment query" |
| `priority` | str | "High" |
| `subject` | str | "Receipt for NEFT not received" |
| `description` | str | "I transferred the Plinth demand via NEFT on 3rd; please iss |
| `attachments` | list[…] | 0 items |
| `status` | str | "In Progress" |
| `assigned_to` | uuid (str) | "c5b75c63-d94a-46a3-be1d-b92b95803990" |
| `sla_due_at` | datetime (ISO) | "2026-10-26T08:27:54.984059+00:00" |
| `sla_breached` | bool | false |
| `rating` | null | null |
| `resolved_at` | null | null |
| `closed_at` | null | null |
| `thread` | list[object] | 3 items |
| `stage_history` | list[object] | 2 items |

Indexes: `company_id:1, status:1, created_at:-1`, `customer_id:1, created_at:-1`

### `settings` (18 docs)

Key/value system settings (roles_version, seed markers, site settings).

| Field | Type | Example / note |
|---|---|---|
| `key` | str | "roles_version" |
| `value` | int | 16 |

Indexes: `key:1` unique

### `site_settings` (1 docs)

Public site settings (brand, phone, WhatsApp, offices, trust stats, round-robin).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "f927ce08-3472-484f-bec1-a9540d765f6b" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:40.075103+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:40.075103+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `brand_name` | str | "Shree Ganesh Builders" |
| `tagline` | str | "Crafting landmark homes in Patna since 1998" |
| `logo_url` | null | null |
| `favicon_url` | null | null |
| `phone` | str | "+916122234567" |
| `whatsapp` | str | "+919430012345" |
| `email` | str | "sales@shreeganeshbuilders.in" |
| `offices` | list[object] | 2 items |
| `social` | object | 4 keys |
| `trust_stats` | list[object] | 4 items |
| `footer_text` | str | "Shree Ganesh Builders Pvt. Ltd. is a RERA-registered real e |
| `rera_disclaimer` | str | "All projects are registered under the Bihar Real Estate Reg |
| `seo_title` | str | "Shree Ganesh Builders — Premium Apartments & Villas in Patn |
| `seo_description` | str | "RERA-registered builder in Patna. Explore Shree Ganesh Heig |
| `og_image_url` | str | "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?a |
| `ga_id` | null | null |
| `meta_pixel_id` | null | null |
| `round_robin_assignment` | bool | true |
| `site_live` | bool | true |
| `portal_url` | str | "https://royal-realty-hub-2.expo.preview.emergentagent.com" |
| `home` | object | 4 keys |

Indexes: `_id` only

### `site_visits` (10 docs)

Site-visit bookings (SV numbers, slot, capacity, status, timeline).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "c82508b4-c361-4947-8d6f-32ebdb5fe35e" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:46:13.882278+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:46:13.882278+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `visit_number` | str | "SV-2627-0001" |
| `lead_id` | uuid (str) | "96ea10bd-9575-41c8-83d4-08a8627af057" |
| `customer_id` | null | null |
| `project_id` | uuid (str) | "51a6f4a8-b592-4cda-a0d1-e2b0edc870ea" |
| `project_name` | str | "Ganesh Green Villas" |
| `date` | date (ISO) | "2026-10-31" |
| `slot_start` | str | "11:00" |
| `slot_end` | str | "12:00" |
| `name` | str | "Pooja Sharma" |
| `phone` | str | "+919430022222" |
| `email` | str | "pooja@example.com" |
| `visitors_count` | int | 1 |
| `status` | str | "Confirmed" |
| `assigned_to` | uuid (str) | "c5b75c63-d94a-46a3-be1d-b92b95803990" |
| `source` | str | "ERP" |
| `notes` | null | null |
| `timeline` | list[object] | 1 items |

Indexes: `project_id:1, date:1, slot_start:1`, `company_id:1, date:1, slot_start:1`, `project_id:1, date:1, status:1`, `lead_id:1, status:1, date:1`

### `spec_categories` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "21bbc6af-2f2e-4426-a549-4d88c1d68782" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.749575+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.749575+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Flooring" |
| `code` | str | "FLOORING" |
| `sort_order` | int | 1 |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `spec_items` (12 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "12c87f3a-9df0-4bcc-91ed-3c12787cbb6f" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.753824+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.753824+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Vitrified tiles 800×800" |
| `spec_category_id` | uuid (str) | "21bbc6af-2f2e-4426-a549-4d88c1d68782" |
| `description` | null | null |
| `brand` | str | "Kajaria" |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `users` (6 docs)

ERP users with role, project scope, password hash/history, MFA, lockout counters.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "6396ea03-7ba8-4f48-bbac-763d02103836" |
| `company_id` | uuid (str) | "7ee62ac6-926d-471f-8c7e-f7c30848bb86" |
| `created_at` | datetime (ISO) | "2026-10-25T08:27:39.617684+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-25T08:27:39.617684+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Rajesh Kumar" |
| `email` | str | "admin@kkt.in" |
| `phone` | null | null |
| `role_id` | uuid (str) | "0780b8f8-55e9-4c4d-b4e8-5db830467d36" |
| `project_scope` | list[str] | 1 items |
| `password_hash` | str | (secret — never returned) |
| `failed_attempts` | int | 0 |
| `locked_until` | null | null |
| `mfa_enabled` | bool | false |
| `must_change_password` | bool | false |
| `password_history` | list[…] | 0 items |
| `last_login_at` | datetime (ISO) | "2026-10-25T08:50:56.051474+00:00" |

Indexes: `email:1` unique, `id:1` unique, `_fts:text, _ftsx:1`
