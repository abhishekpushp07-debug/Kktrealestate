CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('STAFF', 'CUSTOMER', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('ACTIVE', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."charge_demand_at" AS ENUM('ON_BOOKING', 'ON_POSSESSION', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."contra_type" AS ENUM('DEPOSIT', 'WITHDRAWAL');--> statement-breakpoint
CREATE TYPE "public"."demand_status" AS ENUM('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."document_entity_type" AS ENUM('CUSTOMER', 'BOOKING', 'PROJECT', 'BLOCK', 'FLAT', 'PAYMENT', 'STAGE', 'CMS', 'SERVICE_REQUEST', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."flat_status" AS ENUM('AVAILABLE', 'HOLD', 'BLOCKED', 'BOOKED', 'SOLD');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('MALE', 'FEMALE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."job_run_status" AS ENUM('RUNNING', 'OK', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('WALK_IN', 'WEBSITE', 'BROCHURE', 'SITE_VISIT', 'REFERRAL', 'BROKER', 'CAMPAIGN');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('NEW', 'CONTACTED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_DONE', 'NEGOTIATION', 'CONVERTED', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."ledger_event" AS ENUM('DEMAND', 'PAYMENT', 'REVERSAL', 'AGREEMENT_CHANGE', 'PLAN_CHANGE', 'OTHER_CHARGE_DEMAND', 'OTHER_CHARGE_PAYMENT', 'OTHER_CHARGE_REVERSAL', 'CANCELLATION');--> statement-breakpoint
CREATE TYPE "public"."notification_recipient_type" AS ENUM('STAFF', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."parking_status" AS ENUM('AVAILABLE', 'ALLOTTED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."parking_type" AS ENUM('COVERED', 'OPEN', 'STILT', 'BASEMENT');--> statement-breakpoint
CREATE TYPE "public"."payment_against" AS ENUM('FLAT_VALUE', 'OTHER_CHARGE');--> statement-breakpoint
CREATE TYPE "public"."payment_bucket" AS ENUM('CASH', 'ACCOUNT');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'CLEARED', 'BOUNCED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."plan_acceptance_mode" AS ENUM('IN_PERSON', 'SIGNED_COPY', 'PORTAL');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('CONSTRUCTION_LINKED', 'DOWN_PAYMENT', 'TIME_LINKED', 'FLEXI', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."plc_applies_to" AS ENUM('ALL', 'FLOORS_GTE', 'CORNER', 'FACING_IN');--> statement-breakpoint
CREATE TYPE "public"."plc_calc_mode" AS ENUM('PER_SQFT', 'FIXED', 'PERCENT', 'FLOOR_RISE');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('DRAFT', 'PUBLISHED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('PLANNING', 'UNDER_CONSTRUCTION', 'READY', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."project_type" AS ENUM('RESIDENTIAL', 'COMMERCIAL', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."rate_card_status" AS ENUM('DRAFT', 'ACTIVE', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."service_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('NEW', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."trigger_type" AS ENUM('ON_BOOKING', 'DAYS_AFTER_BOOKING', 'ON_STAGE', 'ON_POSSESSION', 'ON_DATE');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('STAFF', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."visit_source" AS ENUM('WEBSITE', 'ERP');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "agreement_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"revised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revised_by" uuid,
	"revised_by_name" text,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_co_applicants" (
	"booking_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_co_applicants_pk" PRIMARY KEY("booking_id","customer_id")
);
--> statement-breakpoint
CREATE TABLE "booking_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_other_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"charge_type_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"gst_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"gst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"demand_at" charge_demand_at DEFAULT 'MANUAL' NOT NULL,
	"demanded_at" timestamp with time zone,
	"demand_number" text,
	"due_date" date,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_plan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" uuid,
	"reason" text NOT NULL,
	"before_plan_snapshot" jsonb NOT NULL,
	"after_plan_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"flat_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"status" "booking_status" DEFAULT 'ACTIVE' NOT NULL,
	"agreement_value_paise" bigint NOT NULL,
	"cash_agreed_paise" bigint NOT NULL,
	"account_agreed_paise" bigint NOT NULL,
	"flat_snapshot" jsonb NOT NULL,
	"rate_per_sqft_paise" bigint,
	"payment_plan_id" uuid NOT NULL,
	"plan_snapshot" jsonb NOT NULL,
	"plan_accepted_on" date,
	"plan_acceptance_mode" "plan_acceptance_mode" DEFAULT 'IN_PERSON' NOT NULL,
	"plan_acceptance_document_id" uuid,
	"sales_user_id" uuid,
	"lead_id" uuid,
	"broker_name" text,
	"remarks" text,
	"raised_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"cash_order_raised_paise" bigint DEFAULT 0 NOT NULL,
	"account_order_raised_paise" bigint DEFAULT 0 NOT NULL,
	"cash_paid_paise" bigint DEFAULT 0 NOT NULL,
	"account_paid_paise" bigint DEFAULT 0 NOT NULL,
	"other_charges_demanded_paise" bigint DEFAULT 0 NOT NULL,
	"other_charges_paid_paise" bigint DEFAULT 0 NOT NULL,
	"pending_cheques_paise" bigint DEFAULT 0 NOT NULL,
	"last_payment_at" timestamp with time zone,
	"cancellation" jsonb,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"completion_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bookings_company_number_uq" UNIQUE("company_id","booking_number")
);
--> statement-breakpoint
CREATE TABLE "payment_plan_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"block_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_plan_assignments_plan_project_block_uq" UNIQUE NULLS NOT DISTINCT("plan_id","project_id","block_id")
);
--> statement-breakpoint
CREATE TABLE "cms_banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"cta_label" text,
	"cta_url" text,
	"document_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_gallery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"document_id" uuid NOT NULL,
	"caption" text,
	"category" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_home_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cms_home_sections_company_key_uq" UNIQUE("company_id","key")
);
--> statement-breakpoint
CREATE TABLE "cms_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cms_pages_company_slug_uq" UNIQUE("company_id","slug")
);
--> statement-breakpoint
CREATE TABLE "cms_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"bio" text,
	"photo_document_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"excerpt" text,
	"body_md" text DEFAULT '' NOT NULL,
	"cover_document_id" uuid,
	"status" "post_status" DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"author_user_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cms_posts_company_slug_uq" UNIQUE("company_id","slug")
);
--> statement-breakpoint
CREATE TABLE "cms_testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid,
	"name" text NOT NULL,
	"project_id" uuid,
	"quote" text NOT NULL,
	"rating" integer,
	"photo_document_id" uuid,
	"is_published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"brand" jsonb DEFAULT '{"name":""}'::jsonb NOT NULL,
	"contacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"offices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"social" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trust_stats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"value_props" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disclaimer" text,
	"seo_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analytics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"site_live" boolean DEFAULT true NOT NULL,
	"coming_soon_message" text,
	"portal_url" text,
	"erp_url" text,
	"featured_project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"walkthrough_video_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "co_applicants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"relation" text,
	"phone" text,
	"email" text,
	"pan_enc" text,
	"pan_hash" text,
	"pan_last4" text,
	"aadhaar_enc" text,
	"aadhaar_last4" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_code" text NOT NULL,
	"salutation" text,
	"full_name" text NOT NULL,
	"father_or_spouse_name" text,
	"dob" date,
	"gender" "gender",
	"phone" text NOT NULL,
	"alt_phone" text,
	"email" text,
	"address_current" jsonb,
	"address_permanent" jsonb,
	"same_as_current" boolean DEFAULT true NOT NULL,
	"occupation" text,
	"company_name" text,
	"income_band" text,
	"source" text,
	"relationship_manager_id" uuid,
	"pan_enc" text,
	"pan_hash" text,
	"pan_last4" text,
	"aadhaar_enc" text,
	"aadhaar_hash" text,
	"aadhaar_last4" text,
	"bank" jsonb,
	"nominee" jsonb,
	"kyc_status" "kyc_status" DEFAULT 'PENDING' NOT NULL,
	"kyc_verified_by" uuid,
	"kyc_verified_at" timestamp with time zone,
	"kyc_remarks" text,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "customers_company_code_uq" UNIQUE("company_id","customer_code")
);
--> statement-breakpoint
CREATE TABLE "portal_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"enabled_by" uuid,
	"enabled_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "portal_users_customer_uq" UNIQUE("customer_id"),
	CONSTRAINT "portal_users_company_phone_uq" UNIQUE("company_id","phone")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_type" "document_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"document_type_id" uuid,
	"title" text,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"variants" jsonb,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"shared_with_customer" boolean DEFAULT false NOT NULL,
	"uploaded_by_type" "actor_type" NOT NULL,
	"uploaded_by" uuid,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"gstin" text,
	"phone" text,
	"email" text,
	"address" jsonb,
	"logo_document_id" uuid,
	"letterhead" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fy_start_month" integer DEFAULT 4 NOT NULL,
	"numbering" jsonb DEFAULT '{"customer":{"prefix":"CUST-"},"booking":{"prefix":"BK-"},"demand":{"prefix":"DM-"},"receipt":{"prefix":"SGB/"},"ticket":{"prefix":"SR-"},"visit":{"prefix":"SV-"}}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{"demand_due_days":15,"default_gst_percent":5,"round_robin_enabled":true,"force_mfa_for_admins":false,"sla_hours":{"LOW":72,"MEDIUM":48,"HIGH":24,"URGENT":8},"booking_hold_hours":48}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_key" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_uq" UNIQUE("scope_key","key")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "job_run_status" DEFAULT 'RUNNING' NOT NULL,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"subject_type" "user_type" NOT NULL,
	"identifier" text NOT NULL,
	"success" boolean NOT NULL,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_type" "user_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subject_type" "user_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"replaced_by_id" uuid,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "refresh_tokens_token_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roles_company_name_uq" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"company_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"fy" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "sequences_pk" PRIMARY KEY("company_id","scope","fy")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" "citext" NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role_id" uuid NOT NULL,
	"all_projects" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_enc" text,
	"mfa_pending_secret_enc" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"avatar_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_company_email_uq" UNIQUE("company_id","email")
);
--> statement-breakpoint
CREATE TABLE "amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"icon" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "amenities_company_name_uq" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "area_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "area_types_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_name" text NOT NULL,
	"branch" text,
	"account_name" text NOT NULL,
	"account_number_enc" text NOT NULL,
	"account_number_last4" text NOT NULL,
	"ifsc" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_escrow" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"has_floors" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "block_types_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "charge_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"default_amount_paise" bigint DEFAULT 0 NOT NULL,
	"is_taxable" boolean DEFAULT false NOT NULL,
	"default_gst_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"demand_at" charge_demand_at DEFAULT 'MANUAL' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "charge_types_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "construction_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_possession" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "construction_stages_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"applies_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_kyc" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_types_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "flat_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"bhk" numeric(3, 1),
	"facing" text,
	"description" text,
	"rooms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"carpet_sqft" numeric(10, 2) DEFAULT 0 NOT NULL,
	"builtup_sqft" numeric(10, 2) DEFAULT 0 NOT NULL,
	"super_builtup_sqft" numeric(10, 2) DEFAULT 0 NOT NULL,
	"base_rate_per_sqft_paise" bigint,
	"base_price_paise" bigint,
	"spec_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "flat_types_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "floor_plan_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"flats_per_floor" integer NOT NULL,
	"positions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "floor_plan_templates_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "payment_modes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"requires_instrument" boolean DEFAULT false NOT NULL,
	"clears_immediately" boolean DEFAULT true NOT NULL,
	"is_cash" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_modes_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "payment_plan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"trigger_type" "trigger_type" NOT NULL,
	"trigger_days" integer,
	"trigger_stage_id" uuid,
	"trigger_date" date,
	"due_days" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plan_installments_plan_seq_uq" UNIQUE("plan_id","seq")
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"plan_type" "plan_type" NOT NULL,
	"description" text,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_plans_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "plc_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"calc_mode" "plc_calc_mode" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "plc_types_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "room_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "room_types_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"default_priority" "service_priority" DEFAULT 'MEDIUM' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"name" text NOT NULL,
	"is_possession" boolean DEFAULT false NOT NULL,
	"status" "stage_status" DEFAULT 'PENDING' NOT NULL,
	"started_on" date,
	"completed_on" date,
	"completed_by" uuid,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "block_stages_block_stage_uq" UNIQUE("block_id","stage_id")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"block_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"floors" integer DEFAULT 1 NOT NULL,
	"floor_start" integer DEFAULT 1 NOT NULL,
	"ground_floor_label" text,
	"skip_floors" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"refuge_floors" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"podium_floors" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"floor_plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"numbering_pattern" text DEFAULT '{block}-{floor}{pos2}' NOT NULL,
	"stage_sequence" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"construction_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"unit_counts" jsonb DEFAULT '{"available":0,"hold":0,"blocked":0,"booked":0,"sold":0,"total":0}'::jsonb NOT NULL,
	"status" "project_status" DEFAULT 'PLANNING' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "blocks_project_code_uq" UNIQUE("project_id","code")
);
--> statement-breakpoint
CREATE TABLE "flats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"flat_number" text NOT NULL,
	"floor" integer NOT NULL,
	"floor_label" text,
	"position" integer DEFAULT 1 NOT NULL,
	"flat_type_id" uuid NOT NULL,
	"flat_type_code" text NOT NULL,
	"facing" text,
	"is_corner" boolean DEFAULT false NOT NULL,
	"status" "flat_status" DEFAULT 'AVAILABLE' NOT NULL,
	"rooms_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"areas_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"carpet_sqft" numeric(10, 2) DEFAULT 0 NOT NULL,
	"builtup_sqft" numeric(10, 2) DEFAULT 0 NOT NULL,
	"super_builtup_sqft" numeric(10, 2) DEFAULT 0 NOT NULL,
	"rate_per_sqft_paise" bigint,
	"price_paise" bigint DEFAULT 0 NOT NULL,
	"price_breakup" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_card_id" uuid,
	"booking_id" uuid,
	"hold_by_user_id" uuid,
	"hold_until" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "flats_block_number_uq" UNIQUE("block_id","flat_number")
);
--> statement-breakpoint
CREATE TABLE "parking_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"slot_type" "parking_type" DEFAULT 'OPEN' NOT NULL,
	"level" text,
	"price_paise" bigint DEFAULT 0 NOT NULL,
	"status" "parking_status" DEFAULT 'AVAILABLE' NOT NULL,
	"booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "parking_slots_project_number_uq" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "project_amenities" (
	"project_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_amenities_pk" PRIMARY KEY("project_id","amenity_id")
);
--> statement-breakpoint
CREATE TABLE "project_team" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_team_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_visit_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"visit_days" integer[] DEFAULT '{1,2,3,4,5,6}'::integer[] NOT NULL,
	"start_time" time DEFAULT '10:00' NOT NULL,
	"end_time" time DEFAULT '18:00' NOT NULL,
	"slot_minutes" integer DEFAULT 60 NOT NULL,
	"seats_per_slot" integer DEFAULT 2 NOT NULL,
	"min_lead_hours" integer DEFAULT 4 NOT NULL,
	"max_days_ahead" integer DEFAULT 14 NOT NULL,
	"blackout_dates" date[] DEFAULT '{}'::date[] NOT NULL,
	"site_office_address" text,
	"maps_link" text,
	"instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_visit_settings_slot_minutes_chk" CHECK ("project_visit_settings"."slot_minutes" IN (30, 60))
);
--> statement-breakpoint
CREATE TABLE "project_website_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"slug" text,
	"show_prices" boolean DEFAULT false NOT NULL,
	"show_availability" boolean DEFAULT true NOT NULL,
	"show_progress" boolean DEFAULT true NOT NULL,
	"starting_price_override_paise" bigint,
	"hero_document_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"video_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"tour_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"map_embed_url" text,
	"brochure_document_id" uuid,
	"faqs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brochure_download_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_website_settings_slug_uq" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"project_type" "project_type" DEFAULT 'RESIDENTIAL' NOT NULL,
	"status" "project_status" DEFAULT 'PLANNING' NOT NULL,
	"description" text,
	"address" jsonb,
	"city" text,
	"rera_number" text,
	"launch_date" date,
	"possession_date" date,
	"land_area_sqft" numeric(14, 2),
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"landmarks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escrow_bank_account_id" uuid,
	"stage_sequence" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"unit_counts" jsonb DEFAULT '{"available":0,"hold":0,"blocked":0,"booked":0,"sold":0,"total":0}'::jsonb NOT NULL,
	"block_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "projects_company_code_uq" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "rate_card_plc_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"plc_type_id" uuid NOT NULL,
	"calc_mode" "plc_calc_mode" NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"applies_to" "plc_applies_to" DEFAULT 'ALL' NOT NULL,
	"floors_gte" integer,
	"facings" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_card_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"flat_type_id" uuid NOT NULL,
	"rate_per_sqft_paise" bigint,
	"lump_sum_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_rates_card_type_uq" UNIQUE("rate_card_id","flat_type_id")
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"status" "rate_card_status" DEFAULT 'DRAFT' NOT NULL,
	"activated_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"block_stage_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"caption" text,
	"visible_to_buyers" boolean DEFAULT false NOT NULL,
	"show_on_website" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_project_scopes" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_project_scopes_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "brochure_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"lead_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"downloaded_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brochure_downloads_token_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_id" uuid,
	"project_id" uuid,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"flat_type_id" uuid,
	"message" text,
	"source_page" text,
	"utm" jsonb,
	"ip" text,
	"reference_number" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"actor_type" "actor_type" DEFAULT 'SYSTEM' NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"note" text NOT NULL,
	"done_at" timestamp with time zone,
	"next_at" timestamp with time zone,
	"by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage" "lead_stage",
	"to_stage" "lead_stage" NOT NULL,
	"by_user_id" uuid,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_number" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"project_id" uuid,
	"flat_type_id" uuid,
	"budget_min_paise" bigint,
	"budget_max_paise" bigint,
	"source" "lead_source" DEFAULT 'WALK_IN' NOT NULL,
	"stage" "lead_stage" DEFAULT 'NEW' NOT NULL,
	"previous_stage" "lead_stage",
	"lost_reason" text,
	"assigned_user_id" uuid,
	"customer_id" uuid,
	"booking_id" uuid,
	"utm" jsonb,
	"message" text,
	"next_follow_up_at" timestamp with time zone,
	"is_read" boolean DEFAULT false NOT NULL,
	"consent" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leads_company_number_uq" UNIQUE("company_id","lead_number")
);
--> statement-breakpoint
CREATE TABLE "site_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"visit_number" text NOT NULL,
	"project_id" uuid NOT NULL,
	"lead_id" uuid,
	"customer_id" uuid,
	"visit_date" date NOT NULL,
	"slot_start" time NOT NULL,
	"slot_end" time NOT NULL,
	"visitors" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"message" text,
	"status" "visit_status" DEFAULT 'CONFIRMED' NOT NULL,
	"assignee_user_id" uuid,
	"manage_token_hash" text,
	"source" "visit_source" DEFAULT 'ERP' NOT NULL,
	"rescheduled_from" jsonb,
	"cancel_reason" text,
	"notes" text,
	"outcome_marked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "site_visits_company_number_uq" UNIQUE("company_id","visit_number"),
	CONSTRAINT "site_visits_visitors_chk" CHECK ("site_visits"."visitors" BETWEEN 1 AND 6)
);
--> statement-breakpoint
CREATE TABLE "contra_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"type" "contra_type" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"bank_account_id" uuid,
	"remarks" text,
	"by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contra_entries_amount_positive_chk" CHECK ("contra_entries"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "demands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"demand_number" text NOT NULL,
	"installment_seq" integer NOT NULL,
	"installment_name" text NOT NULL,
	"trigger_type" "trigger_type" NOT NULL,
	"trigger_label" text,
	"trigger_stage_id" uuid,
	"percent" numeric(5, 2) NOT NULL,
	"cumulative_percent" numeric(5, 2) NOT NULL,
	"cash_demand_paise" bigint NOT NULL,
	"account_demand_paise" bigint NOT NULL,
	"total_demand_paise" bigint NOT NULL,
	"demand_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" "demand_status" DEFAULT 'OPEN' NOT NULL,
	"paid_paise" bigint DEFAULT 0 NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demands_company_number_uq" UNIQUE("company_id","demand_number")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_date" date NOT NULL,
	"event" "ledger_event" NOT NULL,
	"label" text,
	"bucket" "payment_bucket",
	"amount_paise" bigint NOT NULL,
	"cash_paid_cum_paise" bigint NOT NULL,
	"account_paid_cum_paise" bigint NOT NULL,
	"cash_order_raised_paise" bigint NOT NULL,
	"account_order_raised_paise" bigint NOT NULL,
	"cash_due_paise" bigint NOT NULL,
	"account_due_paise" bigint NOT NULL,
	"total_due_paise" bigint NOT NULL,
	"other_charges_due_paise" bigint DEFAULT 0 NOT NULL,
	"ref_number" text,
	"ref_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_booking_seq_uq" UNIQUE("booking_id","seq")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"against" "payment_against" DEFAULT 'FLAT_VALUE' NOT NULL,
	"bucket" "payment_bucket",
	"other_charge_id" uuid,
	"amount_paise" bigint NOT NULL,
	"payment_date" date NOT NULL,
	"payment_mode_id" uuid NOT NULL,
	"mode_code" text NOT NULL,
	"instrument" jsonb,
	"bank_account_id" uuid,
	"remarks" text,
	"received_by" uuid,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" uuid,
	"bounced_at" timestamp with time zone,
	"bounced_by" uuid,
	"bounce_reason" text,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"receipt_cancelled" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payments_company_receipt_uq" UNIQUE("company_id","receipt_number"),
	CONSTRAINT "payments_amount_positive_chk" CHECK ("payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"publish_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipient_type" "notification_recipient_type" NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" uuid,
	"link" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"is_withdrawn" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_request_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" "actor_type" NOT NULL,
	"author_id" uuid,
	"author_name" text,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"attachment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ticket_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"booking_id" uuid,
	"category_id" uuid,
	"priority" "service_priority" DEFAULT 'MEDIUM' NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"status" "service_status" DEFAULT 'NEW' NOT NULL,
	"assignee_user_id" uuid,
	"sla_due_at" timestamp with time zone,
	"sla_breached_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"rating" integer,
	"rating_comment" text,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "service_requests_company_ticket_uq" UNIQUE("company_id","ticket_number"),
	CONSTRAINT "service_requests_rating_chk" CHECK ("service_requests"."rating" IS NULL OR "service_requests"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "integrity_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triggered_by" uuid,
	"ok" boolean NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"report_key" text NOT NULL,
	"name" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agreement_revisions" ADD CONSTRAINT "agreement_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_revisions" ADD CONSTRAINT "agreement_revisions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_co_applicants" ADD CONSTRAINT "booking_co_applicants_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_co_applicants" ADD CONSTRAINT "booking_co_applicants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD CONSTRAINT "booking_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD CONSTRAINT "booking_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_other_charges" ADD CONSTRAINT "booking_other_charges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_other_charges" ADD CONSTRAINT "booking_other_charges_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_other_charges" ADD CONSTRAINT "booking_other_charges_charge_type_id_charge_types_id_fk" FOREIGN KEY ("charge_type_id") REFERENCES "public"."charge_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_plan_revisions" ADD CONSTRAINT "booking_plan_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_plan_revisions" ADD CONSTRAINT "booking_plan_revisions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_flat_id_flats_id_fk" FOREIGN KEY ("flat_id") REFERENCES "public"."flats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_plan_id_payment_plans_id_fk" FOREIGN KEY ("payment_plan_id") REFERENCES "public"."payment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_sales_user_id_users_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_assignments" ADD CONSTRAINT "payment_plan_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_assignments" ADD CONSTRAINT "payment_plan_assignments_plan_id_payment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."payment_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_assignments" ADD CONSTRAINT "payment_plan_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_assignments" ADD CONSTRAINT "payment_plan_assignments_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_banners" ADD CONSTRAINT "cms_banners_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_gallery" ADD CONSTRAINT "cms_gallery_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_gallery" ADD CONSTRAINT "cms_gallery_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_home_sections" ADD CONSTRAINT "cms_home_sections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_people" ADD CONSTRAINT "cms_people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_posts" ADD CONSTRAINT "cms_posts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_posts" ADD CONSTRAINT "cms_posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_testimonials" ADD CONSTRAINT "cms_testimonials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_testimonials" ADD CONSTRAINT "cms_testimonials_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_testimonials" ADD CONSTRAINT "cms_testimonials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co_applicants" ADD CONSTRAINT "co_applicants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "co_applicants" ADD CONSTRAINT "co_applicants_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_relationship_manager_id_users_id_fk" FOREIGN KEY ("relationship_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_id_document_types_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."document_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amenities" ADD CONSTRAINT "amenities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_types" ADD CONSTRAINT "area_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_types" ADD CONSTRAINT "block_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_stages" ADD CONSTRAINT "construction_stages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flat_types" ADD CONSTRAINT "flat_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plan_templates" ADD CONSTRAINT "floor_plan_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_modes" ADD CONSTRAINT "payment_modes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_plan_id_payment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."payment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD CONSTRAINT "payment_plan_installments_trigger_stage_id_construction_stages_id_fk" FOREIGN KEY ("trigger_stage_id") REFERENCES "public"."construction_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plc_types" ADD CONSTRAINT "plc_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_categories" ADD CONSTRAINT "spec_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_items" ADD CONSTRAINT "spec_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_items" ADD CONSTRAINT "spec_items_category_id_spec_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."spec_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_stages" ADD CONSTRAINT "block_stages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_stages" ADD CONSTRAINT "block_stages_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_stages" ADD CONSTRAINT "block_stages_stage_id_construction_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."construction_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_block_type_id_block_types_id_fk" FOREIGN KEY ("block_type_id") REFERENCES "public"."block_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats" ADD CONSTRAINT "flats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats" ADD CONSTRAINT "flats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats" ADD CONSTRAINT "flats_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats" ADD CONSTRAINT "flats_flat_type_id_flat_types_id_fk" FOREIGN KEY ("flat_type_id") REFERENCES "public"."flat_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_amenities" ADD CONSTRAINT "project_amenities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_amenities" ADD CONSTRAINT "project_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_team" ADD CONSTRAINT "project_team_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_visit_settings" ADD CONSTRAINT "project_visit_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_website_settings" ADD CONSTRAINT "project_website_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_escrow_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("escrow_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_plc_rules" ADD CONSTRAINT "rate_card_plc_rules_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_plc_rules" ADD CONSTRAINT "rate_card_plc_rules_plc_type_id_plc_types_id_fk" FOREIGN KEY ("plc_type_id") REFERENCES "public"."plc_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_rates" ADD CONSTRAINT "rate_card_rates_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_rates" ADD CONSTRAINT "rate_card_rates_flat_type_id_flat_types_id_fk" FOREIGN KEY ("flat_type_id") REFERENCES "public"."flat_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_photos" ADD CONSTRAINT "stage_photos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_photos" ADD CONSTRAINT "stage_photos_block_stage_id_block_stages_id_fk" FOREIGN KEY ("block_stage_id") REFERENCES "public"."block_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_photos" ADD CONSTRAINT "stage_photos_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_project_scopes" ADD CONSTRAINT "user_project_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_project_scopes" ADD CONSTRAINT "user_project_scopes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brochure_downloads" ADD CONSTRAINT "brochure_downloads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brochure_downloads" ADD CONSTRAINT "brochure_downloads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brochure_downloads" ADD CONSTRAINT "brochure_downloads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_flat_type_id_flat_types_id_fk" FOREIGN KEY ("flat_type_id") REFERENCES "public"."flat_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_flat_type_id_flat_types_id_fk" FOREIGN KEY ("flat_type_id") REFERENCES "public"."flat_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contra_entries" ADD CONSTRAINT "contra_entries_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demands" ADD CONSTRAINT "demands_trigger_stage_id_construction_stages_id_fk" FOREIGN KEY ("trigger_stage_id") REFERENCES "public"."construction_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_other_charge_id_booking_other_charges_id_fk" FOREIGN KEY ("other_charge_id") REFERENCES "public"."booking_other_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_mode_id_payment_modes_id_fk" FOREIGN KEY ("payment_mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_messages" ADD CONSTRAINT "service_request_messages_ticket_id_service_requests_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_runs" ADD CONSTRAINT "integrity_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_presets" ADD CONSTRAINT "report_presets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_presets" ADD CONSTRAINT "report_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_revisions_booking_idx" ON "agreement_revisions" USING btree ("booking_id","revised_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "booking_co_applicants_customer_idx" ON "booking_co_applicants" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "booking_drafts_user_updated_idx" ON "booking_drafts" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "booking_other_charges_booking_idx" ON "booking_other_charges" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_plan_revisions_booking_idx" ON "booking_plan_revisions" USING btree ("booking_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_active_per_flat_uq" ON "bookings" USING btree ("flat_id") WHERE "bookings"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "bookings_company_project_status_date_idx" ON "bookings" USING btree ("company_id","project_id","status","booking_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bookings_block_status_idx" ON "bookings" USING btree ("block_id","status");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "payment_plan_assignments_project_block_active_idx" ON "payment_plan_assignments" USING btree ("project_id","block_id","is_active");--> statement-breakpoint
CREATE INDEX "cms_banners_company_active_idx" ON "cms_banners" USING btree ("company_id","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "cms_gallery_company_project_published_idx" ON "cms_gallery" USING btree ("company_id","project_id","is_published","sort_order");--> statement-breakpoint
CREATE INDEX "cms_people_company_published_idx" ON "cms_people" USING btree ("company_id","is_published","sort_order");--> statement-breakpoint
CREATE INDEX "cms_posts_company_status_published_idx" ON "cms_posts" USING btree ("company_id","status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cms_testimonials_company_published_idx" ON "cms_testimonials" USING btree ("company_id","is_published","sort_order");--> statement-breakpoint
CREATE INDEX "co_applicants_customer_idx" ON "co_applicants" USING btree ("customer_id","sort_order");--> statement-breakpoint
CREATE INDEX "customers_company_phone_idx" ON "customers" USING btree ("company_id","phone");--> statement-breakpoint
CREATE INDEX "customers_company_pan_hash_idx" ON "customers" USING btree ("company_id","pan_hash");--> statement-breakpoint
CREATE INDEX "customers_company_full_name_idx" ON "customers" USING btree ("company_id","full_name");--> statement-breakpoint
CREATE INDEX "documents_entity_idx" ON "documents" USING btree ("entity_type","entity_id","is_deleted");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "job_runs_name_started_idx" ON "job_runs" USING btree ("job_name","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "login_events_created_idx" ON "login_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "login_events_identifier_idx" ON "login_events" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "password_history_subject_idx" ON "password_history" USING btree ("subject_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "refresh_tokens_subject_idx" ON "refresh_tokens" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_one_default_uq" ON "bank_accounts" USING btree ("company_id") WHERE "bank_accounts"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "construction_stages_one_possession_uq" ON "construction_stages" USING btree ("company_id") WHERE "construction_stages"."is_possession";--> statement-breakpoint
CREATE INDEX "service_categories_company_idx" ON "service_categories" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "spec_categories_company_idx" ON "spec_categories" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "spec_items_category_idx" ON "spec_items" USING btree ("category_id","sort_order");--> statement-breakpoint
CREATE INDEX "block_stages_block_sort_idx" ON "block_stages" USING btree ("block_id","sort_order");--> statement-breakpoint
CREATE INDEX "blocks_company_project_idx" ON "blocks" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "flats_project_status_idx" ON "flats" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "flats_block_floor_position_idx" ON "flats" USING btree ("block_id","floor","position");--> statement-breakpoint
CREATE INDEX "flats_company_status_type_idx" ON "flats" USING btree ("company_id","status","flat_type_id");--> statement-breakpoint
CREATE INDEX "parking_slots_project_status_idx" ON "parking_slots" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "projects_company_status_idx" ON "projects" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "rate_card_plc_rules_card_idx" ON "rate_card_plc_rules" USING btree ("rate_card_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_one_active_uq" ON "rate_cards" USING btree ("project_id") WHERE "rate_cards"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "rate_cards_project_idx" ON "rate_cards" USING btree ("project_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stage_photos_block_stage_idx" ON "stage_photos" USING btree ("block_stage_id","sort_order");--> statement-breakpoint
CREATE INDEX "brochure_downloads_project_created_idx" ON "brochure_downloads" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "enquiries_company_read_created_idx" ON "enquiries" USING btree ("company_id","is_read","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_follow_ups_lead_idx" ON "lead_follow_ups" USING btree ("lead_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_stage_history_lead_idx" ON "lead_stage_history" USING btree ("lead_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_company_phone_project_idx" ON "leads" USING btree ("company_id","phone","project_id");--> statement-breakpoint
CREATE INDEX "leads_company_stage_idx" ON "leads" USING btree ("company_id","stage");--> statement-breakpoint
CREATE INDEX "leads_assigned_follow_up_idx" ON "leads" USING btree ("assigned_user_id","next_follow_up_at");--> statement-breakpoint
CREATE INDEX "leads_company_source_created_idx" ON "leads" USING btree ("company_id","source","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "site_visits_project_slot_idx" ON "site_visits" USING btree ("project_id","visit_date","slot_start","status");--> statement-breakpoint
CREATE INDEX "site_visits_assignee_date_idx" ON "site_visits" USING btree ("assignee_user_id","visit_date");--> statement-breakpoint
CREATE INDEX "contra_entries_company_date_idx" ON "contra_entries" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "demands_booking_seq_nonvoid_uq" ON "demands" USING btree ("booking_id","installment_seq") WHERE "demands"."status" <> 'VOID';--> statement-breakpoint
CREATE INDEX "demands_company_status_due_idx" ON "demands" USING btree ("company_id","status","due_date");--> statement-breakpoint
CREATE INDEX "demands_block_stage_idx" ON "demands" USING btree ("block_id","trigger_stage_id");--> statement-breakpoint
CREATE INDEX "demands_booking_posted_idx" ON "demands" USING btree ("booking_id","posted_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_booking_seq_idx" ON "ledger_entries" USING btree ("booking_id","seq");--> statement-breakpoint
CREATE INDEX "payments_booking_status_idx" ON "payments" USING btree ("booking_id","status");--> statement-breakpoint
CREATE INDEX "payments_company_date_idx" ON "payments" USING btree ("company_id","payment_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_project_date_idx" ON "payments" USING btree ("project_id","payment_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_company_status_date_idx" ON "payments" USING btree ("company_id","status","payment_date");--> statement-breakpoint
CREATE INDEX "notices_company_project_published_idx" ON "notices" USING btree ("company_id","project_id","is_published","publish_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_type","recipient_id","is_read","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "service_request_messages_ticket_idx" ON "service_request_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "service_requests_company_status_priority_idx" ON "service_requests" USING btree ("company_id","status","priority");--> statement-breakpoint
CREATE INDEX "service_requests_customer_idx" ON "service_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "service_requests_assignee_status_idx" ON "service_requests" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "integrity_runs_company_ran_idx" ON "integrity_runs" USING btree ("company_id","ran_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "report_presets_user_report_idx" ON "report_presets" USING btree ("user_id","report_key");