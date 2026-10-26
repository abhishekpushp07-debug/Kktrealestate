-- Privileges of the application role (infra/postgres/init/01-roles.sql creates kkt_owner / kkt_app; docs/DEPLOY.md "Database roles").
-- Applied by src/migrate.ts after every migration that changes the schema, and only does something when the role kkt_app exists
-- (plain development databases have no such role). Idempotent; GRANT/REVOKE touch the catalog only.
--
-- kkt_app (the API and the worker) keeps full DML except where the books must stay append-only:
--   * ledger_entries, audit_logs, audit_seals, ledger_rebuilds: no UPDATE, DELETE or TRUNCATE (rows are only ever appended);
--   * payments, demands: no DELETE or TRUNCATE (they are reversed / voided with a reason, never deleted; UPDATE stays for status).
-- TRUNCATE, REFERENCES and TRIGGER are revoked everywhere. Reseeding and the test helpers truncate as the owner/superuser, never as
-- kkt_app. The same revokes are applied to the partitions of the partitioned tables (packages/db/partitions), which a session could
-- otherwise address directly.
DO $$
DECLARE
  t text;
  part regclass;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kkt_app') THEN
    RETURN;
  END IF;
  -- full DML on everything the owner created (in case a migration ran as a role whose default privileges do not cover kkt_app) …
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kkt_app';
  EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO kkt_app';
  EXECUTE 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM kkt_app';
  -- … minus the append-only books
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'audit_logs', 'audit_seals', 'ledger_rebuilds'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM kkt_app', t);
      FOR part IN SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = format('public.%I', t)::regclass LOOP
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM kkt_app', part);
      END LOOP;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['payments', 'demands'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM kkt_app', t);
    END IF;
  END LOOP;
END
$$;
