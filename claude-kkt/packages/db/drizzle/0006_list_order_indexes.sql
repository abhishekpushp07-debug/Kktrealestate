-- Migration 0006: index key order of every DESC index (audit v4 / phase-7 verify, docs/PERFORMANCE.md "Production-size run").
-- drizzle's `.desc()` builds `DESC NULLS LAST`, but the lists order by `col DESC` (= NULLS FIRST), which such an index cannot serve: at
-- production size every newest-first list sorted the whole company (payments: 447 ms → 7 ms with a matching index). The schema now
-- declares `.desc().nullsFirst()`. Hand-edited after drizzle-kit generate (docs/DATA-MODEL.md "Writing migrations"): the generated
-- DROP INDEX / CREATE INDEX pairs would block writes on the biggest tables, so the rebuild runs online from
-- src/sql/online/0006_list_order_indexes.sql (CREATE INDEX CONCURRENTLY, then DROP INDEX CONCURRENTLY of the old one); this file
-- changes nothing. The same online file adds three indexes the production-size run asked for: flats_project_number_idx and
-- flats_company_number_idx (the flats list's default order, flat_number + id, without sorting a project's flats) and
-- parking_slots_booking_id_idx (parking of a page of flats / a booking; booking_id has no FK on purpose).
SELECT 1;
