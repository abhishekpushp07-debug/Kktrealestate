-- Converts the four append-heavy tables to monthly range partitions (requires 001_functions.sql). Run in ONE transaction during a
-- maintenance window (each table is locked ACCESS EXCLUSIVE while it is converted; no rows are copied). Idempotent: an already
-- partitioned table is reported and left alone.
SELECT kkt_partition_table('audit_logs');
SELECT kkt_partition_table('ledger_entries');
SELECT kkt_partition_table('login_events');
SELECT kkt_partition_table('notifications');
SELECT kkt_create_next_partitions(2);
