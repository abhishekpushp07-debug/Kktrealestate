-- Hand-written SQL applied by src/migrate.ts after the drizzle-kit migrations.
-- Everything here is idempotent (CREATE OR REPLACE / IF NOT EXISTS / DROP IF EXISTS first).

-- 1. audit_logs is append-only: any UPDATE or DELETE raises.
CREATE OR REPLACE FUNCTION audit_logs_immutable_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_fn();

-- 2. updated_at maintenance: one trigger per table that has an updated_at column.
CREATE OR REPLACE FUNCTION set_updated_at_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t.table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at_fn()',
      t.table_name
    );
  END LOOP;
END;
$$;

-- 3. Partial unique indexes (database-enforced invariants, DATA-MODEL §H).
--    drizzle-kit emits these in the generated migration; they are repeated here with
--    IF NOT EXISTS so a database whose migration predates them is still covered.
CREATE UNIQUE INDEX IF NOT EXISTS demands_booking_seq_nonvoid_uq
  ON demands (booking_id, installment_seq) WHERE status <> 'VOID';
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_per_flat_uq
  ON bookings (flat_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS rate_cards_one_active_uq
  ON rate_cards (project_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_one_default_uq
  ON bank_accounts (company_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS construction_stages_one_possession_uq
  ON construction_stages (company_id) WHERE is_possession;
