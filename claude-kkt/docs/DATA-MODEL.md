# KKT v2 — Data model (PostgreSQL 16, Drizzle ORM)

## Conventions (apply to EVERY table unless stated)

* `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
* `company_id uuid NOT NULL REFERENCES companies(id)` on every business table (single tenant today, multi-tenant switch later with no migration). Every unique constraint on a business key is **scoped by company_id**.
* `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`, `created_by uuid NULL` (staff user id; NULL = system), `version integer NOT NULL DEFAULT 1` on every mutable row.
* Soft delete for masters & structure: `is_active boolean NOT NULL DEFAULT true`, `deactivated_at timestamptz NULL`. Financial rows are never deleted — status VOID/REVERSED/CANCELLED with reason.
* Money: `bigint` in **paise**, column suffix `_paise`. Percent: `numeric(5,2)`. Area: `numeric(10,2)` sq ft. Business dates: `date`. Event times: `timestamptz`.
* Enums: Postgres enums (`pgEnum`) whose values come from `@kkt/contracts` (UPPER_SNAKE).
* Snapshots and small lists that are always read/written whole: `jsonb` with a Zod schema in contracts.
* Every list endpoint's filter+sort shape has a compound index listed under the table.
* Drizzle schema lives in `packages/db/src/schema/*.ts` (one file per area below), exported from `packages/db/src/schema/index.ts`. Migrations are SQL generated with drizzle-kit and committed.

## A. Identity & platform

**companies** — name, legal_name, gstin, phone, email, address jsonb, logo_document_id uuid, letterhead jsonb {tagline, phone, email, website, signatory_name, signatory_title}, fy_start_month int DEFAULT 4, numbering jsonb {customer:{prefix:"CUST-"}, booking:{prefix:"BK-"}, demand:{prefix:"DM-"}, receipt:{prefix:"SGB/"}, ticket:{prefix:"SR-"}, visit:{prefix:"SV-"}}, settings jsonb {demand_due_days:15, default_gst_percent:5, round_robin_enabled:true, force_mfa_for_admins:false, sla_hours:{LOW:72,MEDIUM:48,HIGH:24,URGENT:8}, booking_hold_hours:48}.

**roles** — company_id, name, description, permissions text[] NOT NULL, is_system boolean. UNIQUE(company_id, name).

**users** — company_id, name, email citext, phone, password_hash, role_id → roles, all_projects boolean DEFAULT true, is_active, must_change_password boolean, mfa_enabled boolean, mfa_secret_enc text, mfa_pending_secret_enc text, failed_attempts int DEFAULT 0, locked_until timestamptz, last_login_at, password_changed_at, avatar_document_id. UNIQUE(company_id, email).

**user_project_scopes** — user_id → users, project_id → projects. PK(user_id, project_id).

**password_history** — user_type enum(STAFF, CUSTOMER), subject_id uuid, password_hash, created_at. INDEX(subject_id, created_at desc).

**refresh_tokens** — company_id, subject_type enum(STAFF, CUSTOMER), subject_id uuid, family_id uuid, token_hash text UNIQUE, expires_at, revoked_at, revoke_reason, replaced_by_id uuid, user_agent, ip, created_at, last_used_at. INDEX(subject_type, subject_id), INDEX(family_id).

**login_events** — company_id, subject_type, identifier text, success boolean, reason text, ip, user_agent, created_at. INDEX(created_at desc), INDEX(identifier).

**audit_logs** — company_id, actor_type enum(STAFF, CUSTOMER, SYSTEM), actor_id uuid, actor_name text, action text, entity_type text, entity_id uuid, before jsonb, after jsonb, ip, request_id, created_at. INDEX(entity_type, entity_id, created_at desc), INDEX(actor_id, created_at desc), INDEX(created_at desc). **Trigger `audit_logs_immutable` raises on UPDATE/DELETE.**

**idempotency_keys** — scope_key text (subject id or ip), key text, method, path, request_hash text, status_code int, response_body jsonb, created_at, expires_at. UNIQUE(scope_key, key). INDEX(expires_at).

**sequences** — company_id, scope text, fy text, value bigint DEFAULT 0. PK(company_id, scope, fy). Increment with `INSERT … ON CONFLICT DO UPDATE SET value = sequences.value + 1 RETURNING value` (atomic).

**job_runs** — job_name, started_at, finished_at, status enum(RUNNING, OK, FAILED), result jsonb, error text.

## B. Masters

**room_types** — company_id, name, code, sort_order. UNIQUE(company_id, code).
**area_types** — company_id, name, code (CARPET, BUILT_UP, SUPER_BUILT_UP, BALCONY, TERRACE, PARKING…), sort_order. UNIQUE(company_id, code).
**flat_types** — company_id, name, code, bhk numeric(3,1), facing text, description, rooms jsonb [{room_type_id, room_type_name, label, length_ft numeric, width_ft numeric, sqft numeric}], areas jsonb [{area_type_id, area_type_code, area_type_name, sqft}], carpet_sqft, builtup_sqft, super_builtup_sqft (denormalised from areas), base_rate_per_sqft_paise bigint NULL, base_price_paise bigint NULL, spec_item_ids uuid[]. UNIQUE(company_id, code). CHECK super ≥ builtup ≥ carpet enforced in service.
**block_types** — company_id, name, code, has_floors boolean. UNIQUE(company_id, code).
**floor_plan_templates** — company_id, name, code, flats_per_floor int, positions jsonb [{position int, flat_type_id, facing, is_corner}]. UNIQUE(company_id, code).
**amenities** — company_id, name, category, icon. UNIQUE(company_id, name).
**construction_stages** — company_id, name, code, sort_order, is_possession boolean. UNIQUE(company_id, code). Partial UNIQUE(company_id) WHERE is_possession.
**payment_plans** — company_id, name, code, plan_type enum(CONSTRUCTION_LINKED, DOWN_PAYMENT, TIME_LINKED, FLEXI, CUSTOM), description, grace_days int DEFAULT 0. UNIQUE(company_id, code).
**payment_plan_installments** — plan_id → payment_plans ON DELETE CASCADE, seq int, name, percent numeric(5,2), trigger_type enum(ON_BOOKING, DAYS_AFTER_BOOKING, ON_STAGE, ON_POSSESSION, ON_DATE), trigger_days int, trigger_stage_id → construction_stages, trigger_date date, due_days int, notes. UNIQUE(plan_id, seq).
**charge_types** — company_id, name, code, default_amount_paise, is_taxable boolean, default_gst_percent numeric(5,2), demand_at enum(ON_BOOKING, ON_POSSESSION, MANUAL). UNIQUE(company_id, code).
**payment_modes** — company_id, name, code enum-like text (CASH, CHEQUE, NEFT_RTGS, UPI, DD, LOAN_DISBURSEMENT), requires_instrument boolean, clears_immediately boolean, is_cash boolean, sort_order. UNIQUE(company_id, code).
**bank_accounts** — company_id, bank_name, branch, account_name, account_number_enc text, account_number_last4, ifsc, is_default boolean, is_escrow boolean. Partial UNIQUE(company_id) WHERE is_default.
**document_types** — company_id, name, code, applies_to text[] (CUSTOMER, BOOKING, PROJECT, BLOCK, FLAT, PAYMENT), is_kyc boolean. UNIQUE(company_id, code).
**plc_types** — company_id, name, code, calc_mode enum(PER_SQFT, FIXED, PERCENT, FLOOR_RISE). UNIQUE(company_id, code).
**spec_categories** — company_id, name, sort_order. **spec_items** — company_id, category_id → spec_categories, name, description, sort_order.
**service_categories** — company_id, name, sort_order, default_priority enum(LOW, MEDIUM, HIGH, URGENT).

## C. Projects & inventory

**projects** — company_id, name, code, project_type enum(RESIDENTIAL, COMMERCIAL, MIXED), status enum(PLANNING, UNDER_CONSTRUCTION, READY, COMPLETED), description, address jsonb {line1,line2,locality,city,state,pincode}, city, rera_number, launch_date date, possession_date date, land_area_sqft numeric(14,2), latitude numeric(9,6), longitude numeric(9,6), landmarks jsonb [{name, distance_km}], approvals jsonb [{name, number, issued_on, status}], escrow_bank_account_id → bank_accounts, stage_sequence uuid[] (ordered construction_stage ids), unit_counts jsonb {available,hold,blocked,booked,sold,total}, block_count int, is_active, version. UNIQUE(company_id, code). INDEX(company_id, status).
**project_amenities** — project_id, amenity_id. PK(project_id, amenity_id).
**project_team** — project_id, user_id, role_label. PK(project_id, user_id).
**project_website_settings** — project_id PK → projects, is_published boolean, slug text, show_prices, show_availability, show_progress, starting_price_override_paise, hero_document_ids uuid[], highlights jsonb [string], video_urls text[], tour_urls text[], map_embed_url, brochure_document_id, faqs jsonb [{q,a}], seo jsonb {title, description, og_image_document_id}, brochure_download_count int DEFAULT 0, published_at. UNIQUE(slug) (global — slugs are URLs).
**project_visit_settings** — project_id PK, enabled boolean, visit_days int[] (0=Sun…6=Sat), start_time time, end_time time, slot_minutes int CHECK IN (30,60), seats_per_slot int, min_lead_hours int, max_days_ahead int, blackout_dates date[], site_office_address, maps_link, instructions.
**blocks** — company_id, project_id → projects, block_type_id → block_types, name, code, floors int, floor_start int DEFAULT 1, ground_floor_label text, skip_floors int[], refuge_floors int[], podium_floors int[], floor_plans jsonb [{from_floor, to_floor, floor_plan_template_id}], numbering_pattern text, stage_sequence uuid[], construction_percent numeric(5,2) DEFAULT 0, unit_counts jsonb, status enum(PLANNING, UNDER_CONSTRUCTION, READY, COMPLETED), sort_order, is_active, version. UNIQUE(project_id, code). INDEX(company_id, project_id).
**block_stages** — company_id, block_id → blocks, stage_id → construction_stages, sort_order, name, is_possession boolean, status enum(PENDING, IN_PROGRESS, COMPLETED), started_on date, completed_on date, completed_by uuid, notes, completed_at timestamptz. UNIQUE(block_id, stage_id). INDEX(block_id, sort_order).
**stage_photos** — company_id, block_stage_id → block_stages, document_id → documents, caption, visible_to_buyers boolean, show_on_website boolean, sort_order.
**flats** — company_id, project_id, block_id → blocks, flat_number, floor int, floor_label text, position int, flat_type_id → flat_types, flat_type_code, facing, is_corner boolean, status enum(AVAILABLE, HOLD, BLOCKED, BOOKED, SOLD), rooms_snapshot jsonb, areas_snapshot jsonb, carpet_sqft, builtup_sqft, super_builtup_sqft, rate_per_sqft_paise bigint, price_paise bigint, price_breakup jsonb [{label, amount_paise}], rate_card_id, booking_id uuid, hold_by_user_id, hold_until timestamptz, status_changed_at, status_changed_by, notes, version. UNIQUE(block_id, flat_number). INDEX(project_id, status), INDEX(block_id, floor, position), INDEX(company_id, status, flat_type_id).
**parking_slots** — company_id, project_id, number, slot_type enum(COVERED, OPEN, STILT, BASEMENT), level, price_paise, status enum(AVAILABLE, ALLOTTED, BLOCKED), booking_id, version. UNIQUE(project_id, number). INDEX(project_id, status).
**rate_cards** — company_id, project_id, name, effective_from date, status enum(DRAFT, ACTIVE, SUPERSEDED), activated_at, superseded_at, version. Partial UNIQUE(project_id) WHERE status='ACTIVE'.
**rate_card_rates** — rate_card_id → rate_cards CASCADE, flat_type_id, rate_per_sqft_paise bigint, lump_sum_paise bigint. UNIQUE(rate_card_id, flat_type_id).
**rate_card_plc_rules** — rate_card_id CASCADE, plc_type_id → plc_types, calc_mode (copied), value numeric(14,4) (paise for PER_SQFT/FIXED/FLOOR_RISE, percent for PERCENT), applies_to enum(ALL, FLOORS_GTE, CORNER, FACING_IN), floors_gte int, facings text[], sort_order.

## D. Customers & portal identity

**customers** — company_id, customer_code, salutation, full_name, father_or_spouse_name, dob date, gender, phone text (10 digits), alt_phone, email, address_current jsonb, address_permanent jsonb, same_as_current boolean, occupation, company_name, income_band, source, relationship_manager_id → users, pan_enc, pan_hash, pan_last4, aadhaar_enc, aadhaar_hash, aadhaar_last4, bank jsonb {bank_name, ifsc, holder_name, account_enc, account_last4}, nominee jsonb {name, relation, phone, dob}, kyc_status enum(PENDING, SUBMITTED, VERIFIED, REJECTED), kyc_submitted_by uuid, kyc_submitted_at timestamptz, kyc_verified_by, kyc_verified_at, kyc_remarks, notes, tags text[], is_active, erased_at, version. UNIQUE(company_id, customer_code). INDEX(company_id, phone), INDEX(company_id, pan_hash), INDEX(company_id, full_name). **Partial UNIQUE `customers_company_phone_live_uq` (company_id, phone) WHERE erased_at IS NULL; partial UNIQUE `customers_company_pan_hash_live_uq` (company_id, pan_hash) WHERE erased_at IS NULL AND pan_hash IS NOT NULL** (mirrors `assertNoDuplicate`). INDEX `customers_company_created_idx` (company_id, created_at desc, id desc). Trigram GIN: full_name, phone, customer_code, email.
**co_applicants** — company_id, customer_id → customers CASCADE, full_name, relation, phone, email, pan_enc, pan_hash, pan_last4, aadhaar_enc, aadhaar_last4, sort_order, version.
**portal_users** — company_id, customer_id UNIQUE → customers, phone, password_hash, must_change_password boolean DEFAULT true, is_enabled boolean, failed_attempts int, locked_until, last_login_at, enabled_by, enabled_at, disabled_at, version. UNIQUE(company_id, phone).

## E. Leads & visits

**leads** — company_id, lead_number, full_name, phone, email, project_id, flat_type_id, budget_min_paise, budget_max_paise, source enum(WALK_IN, WEBSITE, BROCHURE, SITE_VISIT, REFERRAL, BROKER, CAMPAIGN), stage enum(NEW, CONTACTED, SITE_VISIT_SCHEDULED, SITE_VISIT_DONE, NEGOTIATION, CONVERTED, LOST), previous_stage, lost_reason, assigned_user_id → users, customer_id, booking_id, utm jsonb, message, next_follow_up_at timestamptz, is_read boolean, consent boolean, last_activity_at, version. UNIQUE(company_id, lead_number). INDEX(company_id, phone, project_id), INDEX(company_id, stage), INDEX(assigned_user_id, next_follow_up_at), INDEX(company_id, source, created_at desc), `leads_company_created_idx` (company_id, created_at desc, id desc). Trigram GIN: full_name, phone, lead_number, email.
**lead_stage_history** — lead_id CASCADE, from_stage, to_stage, by_user_id, reason, at.
**lead_follow_ups** — lead_id CASCADE, note, done_at, next_at, by_user_id, created_at.
**lead_activities** — lead_id CASCADE, type text, payload jsonb, actor_type, actor_id, at. INDEX(lead_id, at desc).
**site_visits** — company_id, visit_number, project_id, lead_id → leads, customer_id, visit_date date, slot_start time, slot_end time, visitors int CHECK 1..6, name, phone, email, message, status enum(CONFIRMED, RESCHEDULED, COMPLETED, NO_SHOW, CANCELLED), assignee_user_id, manage_token_hash text, manage_token_expires_at timestamptz (backfilled to slot end + 1 day IST for existing links), source enum(WEBSITE, ERP), rescheduled_from jsonb {visit_date, slot_start}, cancel_reason, notes, outcome_marked_at, version. UNIQUE(company_id, visit_number). INDEX(project_id, visit_date, slot_start, status). INDEX(assignee_user_id, visit_date), `site_visits_company_visit_date_idx` (company_id, visit_date desc, id desc).
**brochure_downloads** — company_id, project_id, lead_id, token_hash text UNIQUE, expires_at, downloaded_at, ip, user_agent, created_at.
**enquiries** — company_id, lead_id, project_id, name, phone, email, flat_type_id, message, source_page, utm jsonb, ip, reference_number, is_read boolean, created_at. INDEX(company_id, is_read, created_at desc), `enquiries_company_created_idx` (company_id, created_at desc, id desc).

## F. Plans ↔ towers, bookings, money

**payment_plan_assignments** — company_id, plan_id → payment_plans, project_id → projects, block_id → blocks NULL (NULL = whole project), is_default boolean, effective_from date, effective_to date, is_active. UNIQUE NULLS NOT DISTINCT(plan_id, project_id, block_id). INDEX(project_id, block_id, is_active).
**booking_drafts** — company_id, user_id, payload jsonb, step int, updated_at, version. INDEX(user_id, updated_at desc).
**bookings** — company_id, booking_number, project_id, block_id, flat_id → flats, customer_id → customers, booking_date date, status enum(ACTIVE, CANCELLED, COMPLETED), agreement_value_paise, cash_agreed_paise, account_agreed_paise, list_price_paise bigint NULL (flat price offered at booking; backfilled from flat_snapshot.price_paise), price_deviation_reason text, price_deviation_by uuid, flat_snapshot jsonb {flat_number, floor, flat_type_id, flat_type_code, facing, carpet_sqft, builtup_sqft, super_builtup_sqft, price_paise, price_breakup, rooms, areas}, rate_per_sqft_paise, payment_plan_id, plan_snapshot jsonb {plan_id, name, code, plan_type, grace_days, installments:[{seq,name,percent,trigger_type,trigger_days,trigger_stage_id,trigger_stage_name,trigger_date,due_days}]}, plan_accepted_on date, plan_acceptance_mode enum(IN_PERSON, SIGNED_COPY, PORTAL), plan_acceptance_document_id, sales_user_id, lead_id, broker_name, remarks, **summary (materialised, transactional):** raised_percent numeric(5,2) DEFAULT 0, cash_order_raised_paise, account_order_raised_paise, cash_paid_paise, account_paid_paise, other_charges_demanded_paise, other_charges_paid_paise, pending_cheques_paise, last_payment_at, cancellation jsonb {at, by, by_name, reason, deduction_paise, refund_paise}, completed_at, completed_by, completion_notes, version. UNIQUE(company_id, booking_number). UNIQUE(flat_id) WHERE status='ACTIVE' (partial). INDEX(company_id, project_id, status, booking_date desc), INDEX(block_id, status), INDEX(customer_id), `bookings_company_booking_date_idx` (company_id, booking_date desc, id desc). Trigram GIN: booking_number. CHECK `bookings_agreement_split_chk` cash_agreed + account_agreed = agreement_value; `bookings_agreed_nonneg_chk` both ≥ 0; `bookings_list_price_nonneg_chk`. Derived (never stored): cash_due = raised − paid per bucket.
**booking_co_applicants** — booking_id CASCADE, customer_id. PK(booking_id, customer_id). INDEX(customer_id).
**booking_other_charges** — company_id, booking_id CASCADE, charge_type_id, name, code, amount_paise, gst_percent, gst_paise, total_paise, demand_at enum(ON_BOOKING, ON_POSSESSION, MANUAL), demanded_at timestamptz, demand_number text, due_date date, paid_paise bigint DEFAULT 0, sort_order. INDEX(booking_id). CHECK `booking_other_charges_total_chk` total = amount + gst; `booking_other_charges_nonneg_chk` amount, gst, total, paid ≥ 0.
**agreement_revisions** — company_id, booking_id, revised_at, revised_by, revised_by_name, reason, before jsonb {agreement_value_paise, cash_agreed_paise, account_agreed_paise}, after jsonb (same).
**booking_plan_revisions** — company_id, booking_id, at, by, reason, before_plan_snapshot jsonb, after_plan_snapshot jsonb.
**demands** — company_id, booking_id → bookings, project_id, block_id, customer_id, demand_number, installment_seq int, installment_name, trigger_type, trigger_label, trigger_stage_id, percent numeric(5,2), cumulative_percent numeric(5,2), cash_demand_paise, account_demand_paise, total_demand_paise, demand_date date, due_date date, status enum(OPEN, PARTIALLY_PAID, PAID, VOID, CANCELLED), paid_paise bigint DEFAULT 0, voided_at, void_reason, posted_at timestamptz, created_at. UNIQUE(company_id, demand_number). **Partial UNIQUE(booking_id, installment_seq) WHERE status <> 'VOID'.** INDEX(company_id, status, due_date), INDEX(block_id, trigger_stage_id), INDEX(booking_id, posted_at), `demands_company_posted_idx` (company_id, posted_at desc, id desc). CHECK `demands_split_chk` cash + account = total; `demands_amounts_nonneg_chk` cash, account, paid ≥ 0.
**payments** — company_id, booking_id → bookings, project_id, block_id, customer_id, receipt_number, against enum(FLAT_VALUE, OTHER_CHARGE), bucket enum(CASH, ACCOUNT) NULL, other_charge_id → booking_other_charges NULL, amount_paise CHECK > 0, payment_date date, payment_mode_id → payment_modes, mode_code text, instrument jsonb {number, date, bank_name, branch}, bank_account_id → bank_accounts NULL, remarks, received_by → users, status enum(PENDING, CLEARED, BOUNCED, REVERSED), cleared_at, cleared_by, bounced_at, bounced_by, bounce_reason, reversed_at, reversed_by, reversal_reason, receipt_cancelled boolean DEFAULT false, posted_at timestamptz, idempotency_key text, version. UNIQUE(company_id, receipt_number). **Partial UNIQUE `payments_company_idempotency_key_uq` (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL.** INDEX(booking_id, status), `payments_company_date_idx` (company_id, payment_date desc, id desc), Trigram GIN: receipt_number, INDEX(project_id, payment_date desc), INDEX(company_id, status, payment_date) for cheques in hand.
**ledger_entries** — company_id, booking_id → bookings, seq int, at timestamptz, entry_date date, event enum(DEMAND, PAYMENT, REVERSAL, AGREEMENT_CHANGE, PLAN_CHANGE, OTHER_CHARGE_DEMAND, OTHER_CHARGE_PAYMENT, OTHER_CHARGE_REVERSAL, CANCELLATION), label text (stage/installment/charge name), bucket enum(CASH, ACCOUNT) NULL, amount_paise, cash_paid_cum_paise, account_paid_cum_paise, cash_order_raised_paise, account_order_raised_paise, cash_due_paise, account_due_paise, total_due_paise, other_charges_due_paise, ref_number text, ref_id uuid, note text. UNIQUE(booking_id, seq). INDEX(booking_id, seq).
**contra_entries** — company_id, entry_date date, type enum(DEPOSIT, WITHDRAWAL), amount_paise, bank_account_id, remarks, by_user_id, created_at. INDEX(company_id, entry_date).

## G. Documents, service, notifications, CMS

**documents** — company_id, entity_type enum(CUSTOMER, BOOKING, PROJECT, BLOCK, FLAT, PAYMENT, STAGE, CMS, SERVICE_REQUEST, COMPANY), entity_id uuid, document_type_id → document_types NULL, title, file_name, mime, size_bytes, sha256, storage_key, variants jsonb {thumb_key, medium_key, width, height}, is_sensitive boolean, shared_with_customer boolean, uploaded_by_type enum(STAFF, CUSTOMER, SYSTEM), uploaded_by uuid, is_deleted boolean, deleted_at, created_at, version. INDEX(entity_type, entity_id, is_deleted).
**service_requests** — company_id, ticket_number, customer_id, booking_id, category_id → service_categories, priority enum(LOW, MEDIUM, HIGH, URGENT), subject, description, status enum(NEW, IN_PROGRESS, AWAITING_CUSTOMER, RESOLVED, CLOSED), assignee_user_id, sla_due_at, sla_breached_at, resolved_at, closed_at, reopened_count int DEFAULT 0, rating int CHECK 1..5, rating_comment, last_message_at, version. UNIQUE(company_id, ticket_number). INDEX(company_id, status, priority), INDEX(customer_id), INDEX(assignee_user_id, status), `service_requests_company_created_idx` (company_id, created_at desc, id desc). Trigram GIN: subject, ticket_number.
**service_request_messages** — ticket_id CASCADE, author_type enum(STAFF, CUSTOMER, SYSTEM), author_id, author_name, body, is_internal boolean, attachment_ids uuid[], created_at. INDEX(ticket_id, created_at).
**notifications** — company_id, recipient_type enum(STAFF, CUSTOMER), recipient_id uuid, type text, title, body, entity_type, entity_id, link, is_read boolean DEFAULT false, read_at, is_withdrawn boolean DEFAULT false, created_at. INDEX(recipient_type, recipient_id, is_read, created_at desc), INDEX(entity_type, entity_id).
**notices** — company_id, project_id NULL, title, body_md, publish_at, expires_at, is_published boolean, created_by. INDEX(company_id, project_id, is_published, publish_at).
**site_settings** — company_id PK, brand jsonb {name, tagline, logo_document_id, favicon_document_id}, contacts jsonb {phone, whatsapp, email}, offices jsonb [], social jsonb {}, trust_stats jsonb [{label, value}], value_props jsonb [], disclaimer text, seo_defaults jsonb, analytics jsonb {ga_id}, site_live boolean DEFAULT true, coming_soon_message, portal_url, erp_url, featured_project_ids uuid[], walkthrough_video_url, version.
**cms_banners** — company_id, title, subtitle, cta_label, cta_url, document_id, sort_order, starts_at, ends_at, is_active.
**cms_home_sections** — company_id, key, title, body jsonb, sort_order, is_active. UNIQUE(company_id, key).
**cms_testimonials** — company_id, customer_id NULL, name, project_id NULL, quote, rating int, photo_document_id, is_published, sort_order.
**cms_gallery** — company_id, project_id NULL, document_id, caption, category, sort_order, is_published.
**cms_posts** — company_id, title, slug, excerpt, body_md, cover_document_id, status enum(DRAFT, PUBLISHED), published_at, seo jsonb, author_user_id, tags text[], version. UNIQUE(company_id, slug).
**cms_pages** — company_id, slug, title, body_md, is_published, seo jsonb, version. UNIQUE(company_id, slug).
**cms_people** — company_id, name, title, bio, photo_document_id, sort_order, is_published.
**report_presets** — company_id, user_id, report_key, name, params jsonb.
**integrity_runs** — company_id, ran_at, triggered_by, ok boolean, counts jsonb, findings jsonb.
**exports** — asynchronous CSV exports: company_id, user_id → users CASCADE, path text (the list route exported), query jsonb (its filters/sort), status enum `export_status`(QUEUED, RUNNING, DONE, FAILED) DEFAULT QUEUED, row_count int NULL CHECK ≥ 0, storage_key, error, created_at, finished_at, expires_at. INDEX(user_id, created_at desc), INDEX(status, expires_at).

## H. Invariants enforced in the database

1. `audit_logs` immutable (trigger).
2. One ACTIVE booking per flat (partial unique).
3. One non-void demand per (booking, installment_seq) (partial unique) — double raising is impossible even under concurrency.
4. One ACTIVE rate card per project; one default bank account; one possession stage per company (partial uniques).
5. `payments.amount_paise > 0`; `site_visits.visitors BETWEEN 1 AND 6`; `service_requests.rating BETWEEN 1 AND 5`.
6. Every business-key uniqueness is scoped by `company_id`.
7. Money splits add up (migration 0002): bookings cash + account agreed = agreement value; demands cash + account = total; other charges total = amount + GST; none of these, demand `paid_paise`, flat/parking prices or rate per sq ft is negative.
8. One live customer per (company, phone) and per (company, PAN hash) — erased rows excluded, exactly as `assertNoDuplicate` checks; one payment per (company, idempotency key).

## I. Search and list indexes (migration 0002)

* `pg_trgm` is installed by the migration runner (`CREATE EXTENSION IF NOT EXISTS pg_trgm`) and by 0002 itself. Every column a list route
  searches with `ILIKE '%term%'` on a large table has a trigram GIN index named `<table>_<column>_trgm_idx`: customers (full_name, phone,
  customer_code, email), leads (full_name, phone, lead_number, email), bookings.booking_number, flats.flat_number, projects.name,
  blocks.name, users (name, phone, `email::text` — the users list compares the citext column's text form so the expression index applies),
  payments.receipt_number, service_requests (subject, ticket_number). Small master/CMS tables are not indexed.
* Every list route's default sort has a `(company_id, <sort col> DESC, id DESC)` index: bookings (booking_date), customers, leads,
  enquiries, service_requests, audit_logs (created_at), payments (payment_date), demands (posted_at), site_visits (visit_date).
* `flats_hold_until_idx` (status, hold_until) WHERE status = 'HOLD' serves the hold-expiry sweep.
* Optimistic-concurrency `version` was added to `co_applicants` and `booking_drafts`, the remaining tables written through PATCH routes.

