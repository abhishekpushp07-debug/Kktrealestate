-- Migration 0006: index key order of every DESC index (audit v4 / phase-7 verify, docs/PERFORMANCE.md "Production-size run").
-- drizzle's `.desc()` builds `DESC NULLS LAST`, but the lists order by `col DESC` (= NULLS FIRST), which such an index cannot serve: at
-- production size every newest-first list sorted the whole company (payments: 447 ms → 7 ms with a matching index). The schema now
-- declares `.desc().nullsFirst()`. Hand-edited after drizzle-kit generate (docs/DATA-MODEL.md "Writing migrations"): the generated
-- DROP INDEX / CREATE INDEX pairs would block writes on the biggest tables, so the rebuild runs online from
-- src/sql/online/0006_list_order_indexes.sql (CREATE INDEX CONCURRENTLY, then DROP INDEX CONCURRENTLY of the old one); this file
-- changes nothing.
SELECT 1;
