## 4. Data model — collections (generated from the live database)

60 collections. Field types are inferred from a representative document; `id` is always a UUID string (Mongo `_id` is never exposed). Money is stored as integer paise (`*_paise`). Dates are ISO strings.

### `amenities` (12 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "09733b29-bbe9-49e2-9ace-676a466a735e" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.150452+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.150452+00:00" |
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
| `id` | uuid (str) | "89e65b60-423a-4184-9fa1-c2b119443950" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.142841+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.142841+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Carpet Area" |
| `code` | str | "CARPET" |
| `sort_order` | int | 1 |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `audit_logs` (5057 docs)

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

Indexes: `entity_type:1, entity_id:1`, `created_at:-1`, `actor_id:1`

### `backups` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `expires_at:1` TTL

### `bank_accounts` (1 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "df55ff8b-a441-4600-9c39-0f6b915bbeaa" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.168199+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.168199+00:00" |
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

### `block_types` (5 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "e714001d-9d5b-40d6-9f99-afe8b4a5df8b" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.147148+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.147148+00:00" |
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
| `id` | uuid (str) | "4d53e8cb-37aa-4c37-9a9d-a531dfb32b95" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.177394+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.177394+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `block_type_id` | uuid (str) | "e714001d-9d5b-40d6-9f99-afe8b4a5df8b" |
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
| `milestone_template_id` | uuid (str) | "f119c0aa-47e3-4652-87c9-71d6969291a7" |
| `rate_per_sqft` | int | 4200 |
| `floor_rise_per_sqft` | int | 25 |
| `status` | str | "Under Construction" |
| `construction_percent` | int | 45 |
| `unit_counts` | object | 7 keys |
| `milestones` | list[object] | 11 items |
| `construction_stages` | list[object] | 11 items |
| `construction_stage_sequence` | list[object] | 11 items |

Indexes: `id:1` unique, `project_id:1, code:1` unique, `_fts:text, _ftsx:1`

### `bookings` (10 docs)

Agreements: buckets (cash/account), plan snapshot, other charges, revisions, cancellation, drafts.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "67aced1b-c53a-4dbc-916b-dcb19c6a6e00" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2025-11-01T10:00:00+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.383351+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `booking_number` | str | "BK-2526-0001" |
| `project_id` | uuid (str) | "58bbc062-372c-4e9a-8daa-edcef2fb290e" |
| `project_code` | str | "GGV" |
| `project_name` | str | "Ganesh Green Villas" |
| `block_id` | uuid (str) | "79045919-97b9-4919-baa3-360157442045" |
| `block_code` | str | "P" |
| `block_name` | str | "Villa Block P (Premium)" |
| `flat_id` | uuid (str) | "da58818f-3dca-4999-b4cf-98ee62935999" |
| `customer_id` | uuid (str) | "97f2fb95-17dd-49ea-9a0e-210449fdafbc" |
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
| `sales_user_id` | uuid (str) | "c4e30e7a-a865-421f-8df8-d14fcbabeca6" |
| `lead_id` | null | null |
| `broker_name` | null | null |
| `remarks` | str | "Owner reference ledger example" |
| `status` | str | "Completed" |
| `cancellation` | null | null |
| `agreement_revisions` | list[…] | 0 items |
| `summary` | object | 14 keys |
| `ledger_rebuilt_at` | datetime (ISO) | "2026-10-24T19:31:34.492427+00:00" |

Indexes: `id:1` unique, `booking_number:1` unique, `project_id:1, status:1`, `block_id:1, status:1`, `customer_id:1`, `flat_id:1`

### `brochure_downloads` (6 docs)

One row per brochure download (sparkline source).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "003a5027-8035-4b76-90cc-9a18a5263a17" |
| `project_id` | uuid (str) | "58bbc062-372c-4e9a-8daa-edcef2fb290e" |
| `lead_id` | uuid (str) | "62ca138f-f14a-48bb-bf35-f209060cb310" |
| `at` | datetime (ISO) | "2026-10-24T19:06:01.986179+00:00" |

Indexes: `_id` only

### `brochure_tokens` (1 docs)

Signed-token nonces (TTL index) so a download link counts once.

| Field | Type | Example / note |
|---|---|---|
| `nonce` | str | "42d909c6" |
| `at` | datetime (ISO) | "2026-10-24T19:07:42.154189+00:00" |
| `expires_at` | datetime | "2026-10-24 20:07:42.154000" |

Indexes: `expires_at:1` TTL

### `charge_types` (7 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "f02214e9-8734-416c-8836-7a2d41ed540a" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.159591+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.159591+00:00" |
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
| `id` | uuid (str) | "945e5d66-aca6-4ce0-b7e6-10bd7552b4cd" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.557785+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.557785+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `order` | int | 1 |
| `image_url` | str | "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?a |
| `headline` | str | "Homes that rise with Patna" |
| `subheadline` | str | "Shree Ganesh Heights \u2014 2 & 3 BHK residences on Bailey  |
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
| `id` | uuid (str) | "14c57830-0997-417e-8dee-4ba93db26621" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.559446+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.559446+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `order` | int | 1 |
| `project_id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `category` | str | "Exterior" |
| `image_url` | str | "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?a |
| `caption` | str | "Tower A & B elevation at dusk" |

Indexes: `_id` only

### `cms_pages` (3 docs)

Legal/static pages.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "81c3cbb5-d742-4457-a345-7af666f8a065" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.560844+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.560844+00:00" |
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
| `id` | uuid (str) | "44e465fd-9515-4d91-a7f2-a4ab04641b23" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.560233+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.560233+00:00" |
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
| `id` | uuid (str) | "4036bc64-19ec-4003-af1a-84d0ee141e97" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.561461+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.561461+00:00" |
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
| `publish_at` | datetime (ISO) | "2026-10-17T09:00:00+00:00" |
| `seo_title` | str | "Tower A reaches 60%: what construction-linked payments mean |
| `seo_description` | str | "Tower A at Shree Ganesh Heights has crossed the 60% constru |

Indexes: `_id` only

### `cms_testimonials` (6 docs)

Testimonials.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "d3011397-71f3-4441-b530-d0872ff7499b" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.558788+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.558788+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `order` | int | 1 |
| `name` | str | "Mr Amit Kumar Sinha" |
| `designation` | str | "4 BHK Villa, Ganesh Green Villas" |
| `photo_url` | str | "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2 |
| `quote` | str | "The ledger is so transparent \u2014 I could see every deman |
| `rating` | int | 4 |
| `project_id` | uuid (str) | "58bbc062-372c-4e9a-8daa-edcef2fb290e" |
| `project_name` | str | "Ganesh Green Villas" |

Indexes: `_id` only

### `companies` (1 docs)

Tenant/company master (name, numbering formats, demand due days, GST, bank details).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:04:59.898607+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:04:59.898607+00:00" |
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
| `id` | uuid (str) | "0a3d0196-30bb-4aab-87be-15f9103c9cf4" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:01.864206+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:01.864206+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `block_id` | uuid (str) | "4d53e8cb-37aa-4c37-9a9d-a531dfb32b95" |
| `milestone_seq` | int | 1 |
| `storage_key` | str | "construction/c6ee359d-9d0f-4960-a802-87f93cbc7e50/4d53e8cb- |
| `mime` | str | "image/jpeg" |
| `size` | int | 296431 |
| `caption` | str | "Tower A \u2014 Booking" |
| `taken_on` | date (ISO) | "2025-11-01" |
| `visible_to_customers` | bool | true |
| `show_on_website` | bool | false |
| `order` | int | 1 |
| `url` | str | "/api/public/media/photo/0a3d0196-30bb-4aab-87be-15f9103c9cf |

Indexes: `_id` only

### `construction_stages` (16 docs)

Construction stage master sequence.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "7d377308-0846-4573-b0c5-1ffd7c6020d7" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `name` | str | "Excavation" |
| `code` | str | "EXCAVATION" |
| `description` | null | null |
| `seq_hint` | int | 10 |
| `is_possession` | bool | false |
| `applies_to_block_types` | list[…] | 0 items |
| `is_active` | bool | true |
| `version` | int | 1 |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:49.302231+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:49.302234+00:00" |
| `created_by` | str | "system" |

Indexes: `name:1` unique

### `contra_entries` (1 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "b1eb9645-5be4-4248-8599-63d8748f4396" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.544403+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.544403+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `date` | date (ISO) | "2025-11-05" |
| `kind` | str | "DEPOSIT" |
| `amount_paise` | int | 50000000 |
| `bank_account_id` | uuid (str) | "df55ff8b-a441-4600-9c39-0f6b915bbeaa" |
| `bank_name` | str | "State Bank of India" |
| `remarks` | str | "Cash deposited at SBI Boring Road" |
| `by_name` | str | "Amit Verma" |

Indexes: `id:1` unique, `date:1`

### `counters` (10 docs)

Atomic sequences per FY/kind + round-robin pointer.

| Field | Type | Example / note |
|---|---|---|
| `key` | str | "2526" |
| `scope` | str | "customer_number" |
| `seq` | int | 12 |

Indexes: `scope:1, key:1` unique

### `customers` (12 docs)

KYC-sealed customer master (PAN/Aadhaar encrypted + hashed), portal account flags.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "97f2fb95-17dd-49ea-9a0e-210449fdafbc" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.325482+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.325482+00:00" |
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
| `assigned_sales_user_id` | uuid (str) | "c4e30e7a-a865-421f-8df8-d14fcbabeca6" |
| `bank` | object | 3 keys |
| `nominee` | object | 3 keys |
| `co_applicants` | list[object] | 1 items |
| `kyc_status` | str | "Verified" |
| `kyc_verified_by` | uuid (str) | "462c6f0f-183f-4c5e-86f6-fbcfe1210d51" |
| `kyc_verified_at` | datetime (ISO) | "2025-11-01T10:00:00+00:00" |
| `notes` | null | null |
| `tags` | list[…] | 0 items |
| `pan_enc` | str | (secret — never returned) |
| `pan_hash` | str | "13fa00c2b994cb26eedb53467cb3c711819dabdd8ab85d87327416265d0 |
| `aadhaar_enc` | str | (secret — never returned) |

Indexes: `id:1` unique, `company_id:1, phone:1`, `pan_hash:1`, `customer_code:1` unique, `_fts:text, _ftsx:1`

### `demands` (53 docs)

Installment demands raised by the dues engine (one per booking+installment_seq).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "c5665152-22b4-4cd8-a54e-c600412934a1" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `booking_id` | uuid (str) | "67aced1b-c53a-4dbc-916b-dcb19c6a6e00" |
| `customer_id` | uuid (str) | "97f2fb95-17dd-49ea-9a0e-210449fdafbc" |
| `project_id` | uuid (str) | "58bbc062-372c-4e9a-8daa-edcef2fb290e" |
| `block_id` | uuid (str) | "79045919-97b9-4919-baa3-360157442045" |
| `flat_id` | uuid (str) | "da58818f-3dca-4999-b4cf-98ee62935999" |
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
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.357030+00:00" |
| `installment_name` | str | "Booking" |
| `installment_seq` | int | 1 |
| `percent` | float | 10.0 |
| `trigger` | str | "On booking" |
| `trigger_stage_id` | null | null |
| `trigger_type` | str | "ON_BOOKING" |

Indexes: `id:1` unique, `booking_id:1, posted_at:1`, `block_id:1, milestone_seq:1`, `company_id:1, status:1, due_date:1`, `booking_id:1, installment_seq:1` unique partial

### `document_types` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "4d18bfe0-8536-48e6-86ef-f55c00743bb9" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.168891+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.168891+00:00" |
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
| `id` | uuid (str) | "9deaf9f7-3e1c-4074-898b-17e6befc47ab" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:48.821910+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:48.821910+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `entity_type` | str | "booking" |
| `entity_id` | uuid (str) | "67aced1b-c53a-4dbc-916b-dcb19c6a6e00" |
| `document_type_id` | null | null |
| `document_type_name` | str | "Allotment letter" |
| `title` | str | "Allotment letter BK-2526-0001" |
| `file_name` | str | "allotment-BK-2526-0001.pdf" |
| `mime` | str | "application/pdf" |
| `size` | int | 4821 |
| `storage_key` | str | "documents/b41bf5ea-15a2-4c32-b938-e17860d0f476/booking/67ac |
| `is_sensitive` | bool | false |
| `shared_with_customer` | bool | true |
| `uploaded_by` | null | null |

Indexes: `id:1` unique, `entity_type:1, entity_id:1`

### `flat_types` (5 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "fbafa897-32f8-4fed-b17d-b5bc9e68078a" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.172699+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.172699+00:00" |
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
| `id` | uuid (str) | "487af210-e743-4bd1-9544-9f3e851e4b1a" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.179680+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.199380+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `block_id` | uuid (str) | "4d53e8cb-37aa-4c37-9a9d-a531dfb32b95" |
| `flat_type_id` | uuid (str) | "f2684e62-30af-4cfa-a55f-16408879e52b" |
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
| `status_changed_at` | datetime (ISO) | "2026-10-24T19:05:00.199373+00:00" |
| `status_reason` | str | "Reserved for channel partner" |

Indexes: `id:1` unique, `block_id:1, flat_number:1` unique, `project_id:1, status:1`, `block_id:1, floor:1, position:1`, `_fts:text, _ftsx:1`, `flat_number:1`

### `floor_plan_templates` (4 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "970c258f-d441-4d99-a28c-f2a75a079c63" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.219135+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.219135+00:00" |
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

Indexes: `user_id:1, key:1` unique, `created_at:1` TTL

### `import_batches` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `_id` only

### `leads` (8 docs)

CRM leads with stage history, follow-ups, activities timeline, assignment.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "9502400a-48ff-4741-b0fc-ce26cff92501" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.344868+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:06:01.979640+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `lead_number` | str | "LD-2627-0001" |
| `name` | str | "Arvind Kumar" |
| `phone` | str | "+919430011111" |
| `email` | str | "arvind@example.com" |
| `project_id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `flat_type_id` | null | null |
| `budget_min` | int | 4000000 |
| `budget_max` | int | 7000000 |
| `source` | str | "Website" |
| `status` | str | "New" |
| `stage_history` | list[object] | 1 items |
| `assigned_to` | uuid (str) | "c4e30e7a-a865-421f-8df8-d14fcbabeca6" |
| `notes` | null | null |
| `follow_ups` | list[object] | 1 items |
| `next_follow_up_at` | datetime (ISO) | "2026-10-24T11:00:00+00:00" |
| `lost_reason` | null | null |
| `converted_customer_id` | null | null |
| `activities` | list[object] | 1 items |

Indexes: `id:1` unique, `company_id:1, status:1`, `next_follow_up_at:1`, `company_id:1, source:1, is_read:1`

### `ledger_entries` (90 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "f2b94f49-fdc2-4125-aece-cd473bca0262" |
| `booking_id` | uuid (str) | "67aced1b-c53a-4dbc-916b-dcb19c6a6e00" |
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

Indexes: `id:1` unique, `booking_id:1, seq:1`

### `login_events` (1047 docs)



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

Indexes: `created_at:-1`, `email:1`

### `milestone_templates` (2 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "f119c0aa-47e3-4652-87c9-71d6969291a7" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.158288+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.158288+00:00" |
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
| `id` | uuid (str) | "a153a2d8-e3bc-4815-899b-7dea4313b71f" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:01.022885+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:01.022885+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `title` | str | "Diwali office hours & site visit slots" |
| `body` | str | "Our offices will remain open **10 am \u2013 4 pm** during t |
| `project_ids` | list[…] | 0 items |
| `project_names` | list[…] | 0 items |
| `publish_at` | datetime (ISO) | "2026-10-24T19:05:01.022893+00:00" |
| `expires_at` | null | null |
| `pinned` | bool | true |

Indexes: `_id` only

### `notifications` (79 docs)

ERP user notifications.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "9b15f7bc-c0c8-4a4d-a31b-93638941c3c2" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:48.445887+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:48.445899+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `user_id` | uuid (str) | "c4e30e7a-a865-421f-8df8-d14fcbabeca6" |
| `title` | str | "New service request" |
| `body` | str | "SR-2627-0001 \u00b7 Receipt for NEFT not received \u00b7 Pr |
| `kind` | str | "service.create" |
| `entity_type` | str | "service_request" |
| `entity_id` | uuid (str) | "666198ba-d753-4d5a-bd07-0ee28d223328" |
| `link` | str | "/service-requests/666198ba-d753-4d5a-bd07-0ee28d223328" |
| `read` | bool | false |

Indexes: `user_id:1, read:1, created_at:-1`

### `parking_slots` (132 docs)

Parking inventory & allotment.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "56fad903-33fd-4882-849b-eb73582652ad" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.290504+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.290504+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `number` | str | "SB001" |
| `type` | str | "Basement" |
| `level` | str | "B1" |
| `price` | int | 350000 |
| `status` | str | "Allotted" |
| `flat_id` | null | null |
| `booking_id` | uuid (str) | "3edd6127-3642-4823-bebd-aa140b414c35" |
| `customer_id` | uuid (str) | "98e8569c-5c53-4849-bb5f-ddccb34f6e40" |

Indexes: `id:1` unique, `project_id:1, number:1` unique, `project_id:1, status:1`

### `payment_modes` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "659d1f1f-86b3-48ef-9902-e5877250e430" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.164072+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.164072+00:00" |
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
| `payment_plan_id` | uuid (str) | "f4b259e4-dcaa-4a49-8fd4-3e64992ec414" |
| `project_id` | uuid (str) | "58bbc062-372c-4e9a-8daa-edcef2fb290e" |
| `block_name` | null | null |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:49.309406+00:00" |
| `created_by` | str | "system" |
| `effective_from` | null | null |
| `effective_to` | null | null |
| `id` | uuid (str) | "e7d08951-3f76-43e4-9105-34f6e7b89e4c" |
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
| `id` | uuid (str) | "0e5a233b-71bd-4ae6-835c-86b6014d4450" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `name` | str | "Standard CLP" |
| `code` | str | "STANDARD_CLP" |
| `description` | str | "Converted from milestone template 'Standard CLP'" |
| `plan_type` | str | "CLP" |
| `installments` | list[object] | 10 items |
| `applies_percent_to` | str | "BOTH_BUCKETS" |
| `grace_days` | int | 0 |
| `is_active` | bool | true |
| `version` | int | 1 |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:49.307127+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:49.307130+00:00" |
| `created_by` | str | "system" |
| `legacy_template_id` | uuid (str) | "f119c0aa-47e3-4652-87c9-71d6969291a7" |

Indexes: `name:1` unique

### `payments` (34 docs)

Receipts: amount in paise, category, mode, clearing status, reversal.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "fcda6c65-c6be-4148-8087-bda0b49cd1c9" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2025-11-03T14:00:00+00:00" |
| `updated_at` | datetime (ISO) | "2025-11-03T14:00:00+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `receipt_number` | str | "SGB/2526/00001" |
| `booking_id` | uuid (str) | "67aced1b-c53a-4dbc-916b-dcb19c6a6e00" |
| `booking_number` | str | "BK-2526-0001" |
| `customer_id` | uuid (str) | "97f2fb95-17dd-49ea-9a0e-210449fdafbc" |
| `customer_name` | str | "Amit Kumar Sinha" |
| `project_id` | uuid (str) | "58bbc062-372c-4e9a-8daa-edcef2fb290e" |
| `project_code` | str | "GGV" |
| `block_id` | uuid (str) | "79045919-97b9-4919-baa3-360157442045" |
| `block_code` | str | "P" |
| `flat_id` | uuid (str) | "da58818f-3dca-4999-b4cf-98ee62935999" |
| `flat_number` | str | "P1" |
| `against` | str | "FLAT_VALUE" |
| `payment_category` | str | "Account" |
| `other_charge_line_id` | null | null |
| `other_charge_name` | null | null |
| `amount_paise` | int | 40000000 |
| `payment_date` | date (ISO) | "2025-11-03" |
| `payment_mode_id` | uuid (str) | "05cadfb8-d880-48b3-afbb-17211b394813" |
| `payment_mode_code` | str | "NEFT_RTGS" |
| `payment_mode_name` | str | "NEFT / RTGS" |
| `instrument` | object | 4 keys |
| `bank_account_id` | uuid (str) | "df55ff8b-a441-4600-9c39-0f6b915bbeaa" |
| `bank_account_name` | str | "State Bank of India ****7890" |
| `remarks` | null | null |
| `received_by` | uuid (str) | "462c6f0f-183f-4c5e-86f6-fbcfe1210d51" |
| `received_by_name` | str | "Amit Verma" |
| `status` | str | "Cleared" |
| `cleared_at` | datetime (ISO) | "2025-11-03T14:00:00+00:00" |
| `bounced_at` | null | null |
| `reversal` | null | null |
| `idempotency_key` | null | null |
| `posted_at` | datetime (ISO) | "2025-11-03T14:00:00+00:00" |

Indexes: `id:1` unique, `receipt_number:1` unique, `booking_id:1, status:1`, `company_id:1, payment_date:-1`, `project_id:1, payment_date:-1`

### `plc_types` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "eb2321d8-5363-4515-8169-fd619f9ea138" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.241224+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.241224+00:00" |
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
| `id` | uuid (str) | "66f33e23-d338-4825-88c4-d5dc287403c8" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:01.015314+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:01.015314+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `customer_id` | uuid (str) | "2619b6b0-8f17-4fb9-a993-df853570d91b" |
| `login_phone` | str | "9431001234" |
| `password_hash` | str | (secret — never returned) |
| `must_change_password` | bool | false |
| `failed_attempts` | int | 0 |
| `locked_until` | null | null |
| `last_login_at` | null | null |
| `read_notice_ids` | list[…] | 0 items |

Indexes: `_id` only

### `portal_refresh_tokens` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `_id` only

### `projects` (2 docs)

Projects incl. address, RERA, unit counts, `website` sub-document (CMS/SEO/brochure gate/site-visit settings).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.176254+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.176254+00:00" |
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
| `milestone_template_id` | uuid (str) | "f119c0aa-47e3-4652-87c9-71d6969291a7" |
| `cover_image_url` | null | null |
| `is_published` | bool | false |
| `show_prices` | bool | false |
| `show_availability` | bool | false |
| `block_count` | int | 3 |
| `unit_counts` | object | 7 keys |
| `approvals` | list[object] | 3 items |
| `escrow_bank_account_id` | uuid (str) | "df55ff8b-a441-4600-9c39-0f6b915bbeaa" |
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
| `id` | uuid (str) | "e7562e05-8845-4e7b-8fcb-b84cc6c01926" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.243994+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.243994+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `project_id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `name` | str | "SGH Launch Rate Card FY26" |
| `effective_from` | date (ISO) | "2026-04-01" |
| `rates` | list[object] | 4 items |
| `plc_rules` | list[object] | 3 items |
| `notes` | str | "Seeded" |
| `status` | str | "Active" |
| `activated_at` | datetime (ISO) | "2026-10-24T19:05:00.243983+00:00" |
| `superseded_by` | null | null |
| `applied_at` | datetime (ISO) | "2026-10-24T19:05:00.243991+00:00" |
| `applied_count` | int | 115 |

Indexes: `id:1` unique, `project_id:1, status:1`

### `rate_limits` (0 docs)

Mongo-backed sliding-window counters.

| Field | Type | Example / note |
|---|---|---|

Indexes: `bucket:1, slot:1` unique, `expires_at:1` TTL

### `refresh_tokens` (2 docs)

Rotating refresh tokens (family id, reuse detection).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "fccf7bb9-d476-443d-9844-eaf24f30ebc0" |
| `user_id` | uuid (str) | "7810694f-0ddb-41d1-9ddd-3222576c1293" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `token_hash` | str | (secret — never returned) |
| `revoked` | bool | false |
| `ip` | str | "34.170.12.145" |
| `user_agent` | str | "python-requests/2.34.2" |
| `created_at` | datetime (ISO) | "2026-10-24T19:07:50.123377+00:00" |
| `last_seen_at` | datetime (ISO) | "2026-10-24T19:07:50.123381+00:00" |
| `expires_at` | datetime (ISO) | "2026-10-31T19:07:50.123383+00:00" |

Indexes: `token_hash:1` unique, `user_id:1`

### `report_presets` (0 docs)



| Field | Type | Example / note |
|---|---|---|

Indexes: `user_id:1, report_key:1`

### `roles` (6 docs)

System + custom roles with permission lists.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "c64e188f-8ea9-4db1-bc5a-b2c10afb1cd7" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:04:59.900047+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:04:59.900047+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Super Admin" |
| `description` | str | "Full access to everything" |
| `permissions` | list[str] | 35 items |
| `is_system` | bool | true |

Indexes: `id:1` unique, `company_id:1, name:1`

### `room_types` (8 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "09f2b519-d721-4820-988b-525341e64159" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.136422+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.136422+00:00" |
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
| `id` | uuid (str) | "0498bfd2-711e-4b28-8d88-622b91893ecc" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:01.021247+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:01.021247+00:00" |
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
| `id` | uuid (str) | "666198ba-d753-4d5a-bd07-0ee28d223328" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:48.445122+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:48.445122+00:00" |
| `created_by` | null | null |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `ticket_number` | str | "SR-2627-0001" |
| `customer_id` | uuid (str) | "98e8569c-5c53-4849-bb5f-ddccb34f6e40" |
| `customer_name` | str | "Priya Verma" |
| `customer_phone` | str | "+919431023456" |
| `booking_id` | uuid (str) | "3edd6127-3642-4823-bebd-aa140b414c35" |
| `booking_number` | str | "BK-2526-0002" |
| `project_id` | uuid (str) | "c6ee359d-9d0f-4960-a802-87f93cbc7e50" |
| `project_name` | str | "Shree Ganesh Heights" |
| `block_id` | uuid (str) | "4d53e8cb-37aa-4c37-9a9d-a531dfb32b95" |
| `flat_number` | str | "A-201" |
| `category` | str | "Payment query" |
| `priority` | str | "High" |
| `subject` | str | "Receipt for NEFT not received" |
| `description` | str | "I transferred the Plinth demand via NEFT on 3rd; please iss |
| `attachments` | list[…] | 0 items |
| `status` | str | "In Progress" |
| `assigned_to` | uuid (str) | "c4e30e7a-a865-421f-8df8-d14fcbabeca6" |
| `sla_due_at` | datetime (ISO) | "2026-10-25T19:05:48.445144+00:00" |
| `sla_breached` | bool | false |
| `rating` | null | null |
| `resolved_at` | null | null |
| `closed_at` | null | null |
| `thread` | list[object] | 3 items |
| `stage_history` | list[object] | 2 items |

Indexes: `_id` only

### `settings` (13 docs)

Key/value system settings (roles_version, seed markers, site settings).

| Field | Type | Example / note |
|---|---|---|
| `key` | str | "roles_version" |
| `value` | int | 13 |

Indexes: `key:1` unique

### `site_settings` (1 docs)

Public site settings (brand, phone, WhatsApp, offices, trust stats, round-robin).

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "843c6685-824b-45d7-a0dc-b140b12ed6ae" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.557042+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.557042+00:00" |
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
| `seo_title` | str | "Shree Ganesh Builders \u2014 Premium Apartments & Villas in |
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
| `id` | uuid (str) | "797fc57b-da37-4769-a9f3-f39fd81e1b27" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:06:01.975848+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:06:01.975848+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `visit_number` | str | "SV-2627-0001" |
| `lead_id` | uuid (str) | "62ca138f-f14a-48bb-bf35-f209060cb310" |
| `customer_id` | null | null |
| `project_id` | uuid (str) | "58bbc062-372c-4e9a-8daa-edcef2fb290e" |
| `project_name` | str | "Ganesh Green Villas" |
| `date` | date (ISO) | "2026-10-31" |
| `slot_start` | str | "11:00" |
| `slot_end` | str | "12:00" |
| `name` | str | "Pooja Sharma" |
| `phone` | str | "+919430022222" |
| `email` | str | "pooja@example.com" |
| `visitors_count` | int | 1 |
| `status` | str | "Confirmed" |
| `assigned_to` | uuid (str) | "c4e30e7a-a865-421f-8df8-d14fcbabeca6" |
| `source` | str | "ERP" |
| `notes` | null | null |
| `timeline` | list[object] | 1 items |

Indexes: `project_id:1, date:1, slot_start:1`

### `spec_categories` (6 docs)



| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "a3c4b3a2-9a5e-455b-a04f-78665b6eba6a" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.295456+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.295456+00:00" |
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
| `id` | uuid (str) | "8c5a7579-a8c2-420d-82e0-e9776cccbf42" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.299402+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.299402+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Vitrified tiles 800\u00d7800" |
| `spec_category_id` | uuid (str) | "a3c4b3a2-9a5e-455b-a04f-78665b6eba6a" |
| `description` | null | null |
| `brand` | str | "Kajaria" |

Indexes: `id:1` unique, `company_id:1, is_active:1, name:1`

### `users` (6 docs)

ERP users with role, project scope, password hash/history, MFA, lockout counters.

| Field | Type | Example / note |
|---|---|---|
| `id` | uuid (str) | "7810694f-0ddb-41d1-9ddd-3222576c1293" |
| `company_id` | uuid (str) | "b41bf5ea-15a2-4c32-b938-e17860d0f476" |
| `created_at` | datetime (ISO) | "2026-10-24T19:05:00.206215+00:00" |
| `updated_at` | datetime (ISO) | "2026-10-24T19:05:00.206215+00:00" |
| `created_by` | str | "system" |
| `is_active` | bool | true |
| `deleted_at` | null | null |
| `version` | int | 1 |
| `name` | str | "Rajesh Kumar" |
| `email` | str | "admin@kkt.in" |
| `phone` | null | null |
| `role_id` | uuid (str) | "c64e188f-8ea9-4db1-bc5a-b2c10afb1cd7" |
| `project_scope` | list[str] | 1 items |
| `password_hash` | str | (secret — never returned) |
| `failed_attempts` | int | 0 |
| `locked_until` | null | null |
| `mfa_enabled` | bool | false |
| `must_change_password` | bool | false |
| `password_history` | list[…] | 0 items |
| `last_login_at` | datetime (ISO) | "2026-10-24T19:08:08.243827+00:00" |

Indexes: `email:1` unique, `id:1` unique, `_fts:text, _ftsx:1`
