-- Money guards (phase 7, money track; contract C7 "ledger as a book of record"). Hand-written, applied by src/migrate.ts after the
-- drizzle journal like every file in src/sql (idempotent: functions are CREATE OR REPLACE, triggers are created only when missing through
-- kkt_ensure_trigger from 0001_triggers.sql). They bind every role, the owner included; kkt_app additionally has no UPDATE/DELETE/TRUNCATE
-- privilege on these tables (0002_privileges.sql).

-- 1. The booking ledger and its rebuild log are append-only. A rebuild never deletes or rewrites rows: it writes the restated ledger as a
--    new epoch (bookings.ledger_epoch + 1) and logs a ledger_rebuilds row; a voided demand appends a DEMAND_VOIDED row.
CREATE OR REPLACE FUNCTION kkt_books_append_only_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed (a ledger rebuild writes a new epoch instead)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- TRUNCATE (statement level; row triggers never see it). The one legitimate TRUNCATE is a full business-data reset (the guarded reseed:
-- `TRUNCATE … bookings … CASCADE` as the owner), which wipes the books TOGETHER with the bookings they belong to. Every relation a TRUNCATE
-- touches (cascaded ones included) is locked ACCESS EXCLUSIVE before any trigger fires, so "this transaction holds bookings in ACCESS
-- EXCLUSIVE mode" identifies that reset; a TRUNCATE of the books alone is refused.
CREATE OR REPLACE FUNCTION kkt_books_no_truncate_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_locks l
    WHERE l.pid = pg_backend_pid()
      AND l.locktype = 'relation'
      AND l.relation = 'public.bookings'::regclass
      AND l.mode = 'AccessExclusiveLock'
      AND l.granted
  ) THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% is append-only: TRUNCATE is only allowed together with bookings (a full reset)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

SELECT kkt_ensure_trigger('ledger_entries', 'ledger_entries_append_only',
  'BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION kkt_books_append_only_fn()');
SELECT kkt_ensure_trigger('ledger_entries', 'ledger_entries_no_truncate',
  'BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION kkt_books_no_truncate_fn()');
SELECT kkt_ensure_trigger('ledger_rebuilds', 'ledger_rebuilds_append_only',
  'BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION kkt_books_append_only_fn()');
SELECT kkt_ensure_trigger('ledger_rebuilds', 'ledger_rebuilds_no_truncate',
  'BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION kkt_books_no_truncate_fn()');

-- 2. A posted payment's financial facts are frozen: who paid, for which booking/bucket/charge line, how much, when (payment date and
--    posting instant), how (mode, instrument number/date/bank, company bank account credited), its receipt number and idempotency key.
--    What may change is the instrument's lifecycle — PENDING → CLEARED | BOUNCED and CLEARED → REVERSED, with their timestamps, actors and
--    reasons, the receipt-cancelled flag — and the free-text remarks. A wrong receipt is reversed, never edited (SPEC §11).
CREATE OR REPLACE FUNCTION payments_financial_guard_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.booking_id, NEW.project_id, NEW.block_id, NEW.customer_id, NEW.receipt_number, NEW.against,
      NEW.bucket, NEW.other_charge_id, NEW.amount_paise, NEW.payment_date, NEW.payment_mode_id, NEW.mode_code, NEW.instrument,
      NEW.bank_account_id, NEW.received_by, NEW.posted_at, NEW.idempotency_key, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM
     (OLD.id, OLD.company_id, OLD.booking_id, OLD.project_id, OLD.block_id, OLD.customer_id, OLD.receipt_number, OLD.against,
      OLD.bucket, OLD.other_charge_id, OLD.amount_paise, OLD.payment_date, OLD.payment_mode_id, OLD.mode_code, OLD.instrument,
      OLD.bank_account_id, OLD.received_by, OLD.posted_at, OLD.idempotency_key, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'payments: the financial details of receipt % are immutable (reverse the payment instead)', OLD.receipt_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'PENDING' AND NEW.status IN ('CLEARED', 'BOUNCED'))
              OR (OLD.status = 'CLEARED' AND NEW.status = 'REVERSED')) THEN
    RAISE EXCEPTION 'payments: receipt % cannot move from % to %', OLD.receipt_number, OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

SELECT kkt_ensure_trigger('payments', 'payments_financial_guard',
  'BEFORE UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION payments_financial_guard_fn()');
