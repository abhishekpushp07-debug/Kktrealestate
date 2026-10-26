-- Online part of migration 0005 (packages/db/src/migrate.ts runs src/sql/online/*.sql after the drizzle journal and src/sql/*.sql).
-- Every statement runs on its own, OUTSIDE any transaction, so CREATE INDEX CONCURRENTLY builds without blocking writes. Before a
-- CREATE INDEX CONCURRENTLY the runner drops an INVALID index of the same name (left by an interrupted build); on a partitioned table it
-- builds a plain index without CONCURRENTLY and skips a UNIQUE one (packages/db/partitions enforces that uniqueness with a trigger).
-- Statements must be idempotent: IF NOT EXISTS, VALIDATE (a no-op once valid), DO blocks that check the catalog first.
-- Rules for writing these files: docs/DATA-MODEL.md "Writing migrations".

-- 1. An index for every foreign-key column that had none leading on it (audit v3 B2/B3: FK checks on delete/re-key and the usage
--    counts of masters were sequential scans; customer 360 filters payments, demands and leads by customer_id).
--    packages/db/test/online.test.ts fails on any FK column without such an index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agreement_revisions_company_id_idx" ON "agreement_revisions" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "booking_drafts_company_id_idx" ON "booking_drafts" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "booking_other_charges_charge_type_id_idx" ON "booking_other_charges" USING btree ("charge_type_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "booking_other_charges_company_id_idx" ON "booking_other_charges" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "booking_plan_revisions_company_id_idx" ON "booking_plan_revisions" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_flat_id_idx" ON "bookings" USING btree ("flat_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_lead_id_idx" ON "bookings" USING btree ("lead_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_project_id_idx" ON "bookings" USING btree ("project_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_sales_user_id_idx" ON "bookings" USING btree ("sales_user_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payment_plan_assignments_block_id_idx" ON "payment_plan_assignments" USING btree ("block_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payment_plan_assignments_company_id_idx" ON "payment_plan_assignments" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "cms_gallery_project_id_idx" ON "cms_gallery" USING btree ("project_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "cms_posts_author_user_id_idx" ON "cms_posts" USING btree ("author_user_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "cms_testimonials_customer_id_idx" ON "cms_testimonials" USING btree ("customer_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "cms_testimonials_project_id_idx" ON "cms_testimonials" USING btree ("project_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "co_applicants_company_id_idx" ON "co_applicants" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customers_relationship_manager_id_idx" ON "customers" USING btree ("relationship_manager_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "documents_company_id_idx" ON "documents" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "documents_document_type_id_idx" ON "documents" USING btree ("document_type_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "login_events_company_id_idx" ON "login_events" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "refresh_tokens_company_id_idx" ON "refresh_tokens" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bank_accounts_company_id_idx" ON "bank_accounts" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payment_plan_installments_trigger_stage_id_idx" ON "payment_plan_installments" USING btree ("trigger_stage_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spec_items_company_id_idx" ON "spec_items" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "block_stages_company_id_idx" ON "block_stages" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "block_stages_stage_id_idx" ON "block_stages" USING btree ("stage_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "blocks_block_type_id_idx" ON "blocks" USING btree ("block_type_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "flats_flat_type_id_idx" ON "flats" USING btree ("flat_type_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "parking_slots_company_id_idx" ON "parking_slots" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_amenities_amenity_id_idx" ON "project_amenities" USING btree ("amenity_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_team_user_id_idx" ON "project_team" USING btree ("user_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "projects_escrow_bank_account_id_idx" ON "projects" USING btree ("escrow_bank_account_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "rate_card_plc_rules_plc_type_id_idx" ON "rate_card_plc_rules" USING btree ("plc_type_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "rate_card_rates_flat_type_id_idx" ON "rate_card_rates" USING btree ("flat_type_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "rate_cards_company_id_idx" ON "rate_cards" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stage_photos_company_id_idx" ON "stage_photos" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stage_photos_document_id_idx" ON "stage_photos" USING btree ("document_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_project_scopes_project_id_idx" ON "user_project_scopes" USING btree ("project_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "brochure_downloads_company_id_idx" ON "brochure_downloads" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "brochure_downloads_lead_id_idx" ON "brochure_downloads" USING btree ("lead_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "enquiries_flat_type_id_idx" ON "enquiries" USING btree ("flat_type_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "enquiries_lead_id_idx" ON "enquiries" USING btree ("lead_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "enquiries_project_id_idx" ON "enquiries" USING btree ("project_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_customer_id_idx" ON "leads" USING btree ("customer_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_flat_type_id_idx" ON "leads" USING btree ("flat_type_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_project_id_idx" ON "leads" USING btree ("project_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "site_visits_customer_id_idx" ON "site_visits" USING btree ("customer_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "contra_entries_bank_account_id_idx" ON "contra_entries" USING btree ("bank_account_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "contra_entries_by_user_id_idx" ON "contra_entries" USING btree ("by_user_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "demands_customer_id_idx" ON "demands" USING btree ("customer_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "demands_project_id_idx" ON "demands" USING btree ("project_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "demands_trigger_stage_id_idx" ON "demands" USING btree ("trigger_stage_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ledger_entries_company_id_idx" ON "ledger_entries" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_bank_account_id_idx" ON "payments" USING btree ("bank_account_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_block_id_idx" ON "payments" USING btree ("block_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_customer_id_idx" ON "payments" USING btree ("customer_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_other_charge_id_idx" ON "payments" USING btree ("other_charge_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_payment_mode_id_idx" ON "payments" USING btree ("payment_mode_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_received_by_idx" ON "payments" USING btree ("received_by");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notices_project_id_idx" ON "notices" USING btree ("project_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_company_id_idx" ON "notifications" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "service_requests_booking_id_idx" ON "service_requests" USING btree ("booking_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "service_requests_category_id_idx" ON "service_requests" USING btree ("category_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "exports_company_id_idx" ON "exports" USING btree ("company_id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "report_presets_company_id_idx" ON "report_presets" USING btree ("company_id");

-- 2. Search: trigram indexes for the demands list search (demand_number, installment_name) and the cheque / instrument number
--    searched by GET /payments; GIN on companies.hosts for tenant resolution by Host (contract C4).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "companies_hosts_idx" ON "companies" USING gin ("hosts");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "demands_demand_number_trgm_idx" ON "demands" USING gin ("demand_number" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "demands_installment_name_trgm_idx" ON "demands" USING gin ("installment_name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_instrument_number_trgm_idx" ON "payments" USING gin (("instrument" ->> 'number') gin_trgm_ops);

-- 3. companies.slug is unique (contract C4): build the index online, then attach it as the constraint the Drizzle schema declares.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "companies_slug_uq" ON "companies" USING btree ("slug");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_slug_uq' AND conrelid = 'public.companies'::regclass) THEN
    ALTER TABLE "companies" ADD CONSTRAINT "companies_slug_uq" UNIQUE USING INDEX "companies_slug_uq";
  END IF;
END
$$;

-- 4. Ledger epochs (contract C7): UNIQUE (booking_id, epoch, seq) replaces UNIQUE (booking_id, seq), so a rebuild can write epoch n+1
--    next to the rows of epoch n instead of deleting them. The new index is built online and swapped in with two catalog-only steps.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ledger_entries_booking_epoch_seq_uq" ON "ledger_entries" USING btree ("booking_id", "epoch", "seq");
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_partitioned_table WHERE partrelid = 'public.ledger_entries'::regclass) THEN
    -- Partitioned by packages/db/partitions: a unique index must contain created_at, so (booking_id, epoch, seq) is a plain index and
    -- the trigger enforces uniqueness (same function as partitions/001_functions.sql).
    CREATE INDEX IF NOT EXISTS "ledger_entries_booking_epoch_seq_uq" ON "ledger_entries" USING btree ("booking_id", "epoch", "seq");
    DROP INDEX IF EXISTS "ledger_entries_booking_seq_uq";
    CREATE OR REPLACE FUNCTION ledger_entries_booking_seq_unique_fn() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('ledger_entries:' || NEW.booking_id::text || ':' || NEW.epoch::text), NEW.seq);
      IF EXISTS (
        SELECT 1 FROM public.ledger_entries
        WHERE booking_id = NEW.booking_id AND epoch = NEW.epoch AND seq = NEW.seq AND id <> NEW.id
      ) THEN
        RAISE EXCEPTION 'duplicate key value violates unique constraint "ledger_entries_booking_epoch_seq_uq"'
          USING ERRCODE = 'unique_violation',
                DETAIL = format('Key (booking_id, epoch, seq)=(%s, %s, %s) already exists.', NEW.booking_id, NEW.epoch, NEW.seq),
                CONSTRAINT = 'ledger_entries_booking_epoch_seq_uq';
      END IF;
      RETURN NEW;
    END;
    $fn$;
    DROP TRIGGER IF EXISTS ledger_entries_booking_seq_unique ON public.ledger_entries;
    CREATE TRIGGER ledger_entries_booking_seq_unique BEFORE INSERT OR UPDATE OF booking_id, epoch, seq ON public.ledger_entries
      FOR EACH ROW EXECUTE FUNCTION ledger_entries_booking_seq_unique_fn();
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_booking_epoch_seq_uq' AND conrelid = 'public.ledger_entries'::regclass
    ) THEN
      ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_epoch_seq_uq" UNIQUE USING INDEX "ledger_entries_booking_epoch_seq_uq";
    END IF;
    ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_booking_seq_uq";
  END IF;
END
$$;

-- 5. Constraints added NOT VALID by the migration are validated here (SHARE UPDATE EXCLUSIVE: reads and writes continue).
ALTER TABLE "bookings" VALIDATE CONSTRAINT "bookings_ledger_epoch_chk";
ALTER TABLE "bookings" VALIDATE CONSTRAINT "bookings_cancellation_amounts_nonneg_chk";
ALTER TABLE "companies" VALIDATE CONSTRAINT "companies_slug_format_chk";
