# Explain audit — DB `kkt_scale` (5,070,000 rows across list collections)

Shapes: 100 · flagged: **0** (COLLSCAN / in-memory SORT) · indexes ensured (--fix) · timings: cold = first run, warm p95 of 4 reruns, limit 50 (lists) / full aggregation (reports)

| shape | collection | verdict | cold ms | warm p95 ms | keys examined | docs examined | plan stages |
|---|---|---|---|---|---|---|---|
| list bookings sort booking_number | bookings | ok | 2.2 | 1.6 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort -booking_number | bookings | ok | 1.5 | 1.6 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort booking_date | bookings | ok | 1.5 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort -booking_date | bookings | ok | 1.6 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort created_at | bookings | ok | 1.6 | 1.7 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort -created_at | bookings | ok | 1.6 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort status | bookings | ok | 1.5 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort -status | bookings | ok | 1.5 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort customer_name | bookings | ok | 1.5 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings sort -customer_name | bookings | ok | 1.5 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list bookings by project | bookings | ok | 1.5 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort payment_date | payments | ok | 0.7 | 0.6 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort -payment_date | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort receipt_number | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort -receipt_number | payments | ok | 0.5 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort amount_paise | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort -amount_paise | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort status | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort -status | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort created_at | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments sort -created_at | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list payments by project | payments | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands sort due_date | demands | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands sort -due_date | demands | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands sort demand_date | demands | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands sort -demand_date | demands | ok | 0.5 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands sort total_demand_paise | demands | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands sort -total_demand_paise | demands | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands sort customer_name | demands | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands sort -customer_name | demands | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list demands by project | demands | ok | 0.5 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort full_name | customers | ok | 0.7 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort -full_name | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort customer_code | customers | ok | 0.5 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort -customer_code | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort created_at | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort -created_at | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort kyc_status | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort -kyc_status | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort phone | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort -phone | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort engagement_score | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort -engagement_score | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort lifecycle_stage | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers sort -lifecycle_stage | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list customers by project | customers | ok | 0.3 | 0.2 | 0 | 0 | FETCH,IXSCAN,LIMIT |
| list leads sort name | leads | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort -name | leads | ok | 0.7 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort lead_number | leads | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort -lead_number | leads | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort created_at | leads | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort -created_at | leads | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort status | leads | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort -status | leads | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort next_follow_up_at | leads | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads sort -next_follow_up_at | leads | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list leads by project | leads | ok | 0.5 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats sort flat_number | flats | ok | 1.2 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats sort -flat_number | flats | ok | 1.0 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats sort floor | flats | ok | 1.0 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats sort -floor | flats | ok | 1.0 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats sort status | flats | ok | 1.1 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats sort -status | flats | ok | 1.0 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats sort price_paise | flats | ok | 1.0 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats sort -price_paise | flats | ok | 1.0 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list flats by project | flats | ok | 1.0 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list audit_logs sort created_at | audit_logs | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list audit_logs sort -created_at | audit_logs | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list service_tickets sort created_at | service_tickets | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list service_tickets sort -created_at | service_tickets | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list service_tickets sort status | service_tickets | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list service_tickets sort -status | service_tickets | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list service_tickets sort priority | service_tickets | ok | 0.4 | 0.3 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list service_tickets sort -priority | service_tickets | ok | 0.4 | 0.3 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list service_tickets by project | service_tickets | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list documents sort created_at | documents | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list documents sort -created_at | documents | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list documents sort kind | documents | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list documents sort -kind | documents | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| list documents by project | documents | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| search customers by name prefix | customers | ok | 0.7 | 0.6 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| search customers by phone | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| search bookings by number | bookings | ok | 1.7 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| customer 360 bookings | bookings | ok | 0.3 | 0.2 | 1 | 1 | FETCH,IXSCAN,LIMIT |
| booking ledger | ledger_entries | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| booking payments | payments | ok | 0.4 | 0.4 | 33 | 33 | FETCH,IXSCAN,LIMIT |
| booking demands | demands | ok | 0.3 | 0.3 | 20 | 20 | FETCH,IXSCAN,LIMIT |
| audit by entity | audit_logs | ok | 0.5 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| cheques pending | payments | ok | 0.3 | 0.2 | 0 | 0 | FETCH,IXSCAN,LIMIT |
| overdue demands | demands | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT,SORT_MERGE |
| flats by block | flats | ok | 1.1 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| report collections by month | payments | ok | 517.8 | 506.6 | 183112 | 183112 | FETCH,IXSCAN,PROJECTION_SIMPLE |
| report collections by project | payments | ok | 486.3 | 486.4 | 183112 | 183112 | FETCH,IXSCAN,PROJECTION_SIMPLE |
| report outstanding by project | bookings | ok | 89.3 | 89.5 | 30000 | 30000 | FETCH,IXSCAN,PROJECTION_DEFAULT |
| dashboard: cheques to clear | payments | ok | 0.4 | 0.3 | 0 | 0 | IXSCAN,PROJECTION_COVERED |
| dashboard: collected this month | payments | ok | 1654.7 | 1654.1 | 649987 | 649987 | FETCH,IXSCAN,PROJECTION_SIMPLE |
| project summary read model | bookings | ok | 3.1 | 2.9 | 1200 | 1200 | FETCH,IXSCAN,PROJECTION_DEFAULT |
| leads pipeline | leads | ok | 73.3 | 73.7 | 100000 | 0 | IXSCAN,PROJECTION_COVERED |
| inventory by status | flats | ok | 2.1 | 2.1 | 2400 | 0 | IXSCAN,PROJECTION_COVERED |
| ageing: open demands | demands | ok | 138.4 | 139.7 | 33262 | 33261 | FETCH,IXSCAN,PROJECTION_SIMPLE |

## Read-model refresh cost
- Project/customer summaries and dashboard KPIs are maintained by the Phase D/G outbox (per-entity deltas on payment/demand/booking events); nightly `read_model_flush` recomputes only projects touched since the last flush (`settings.read_models_v1`).
- Report caches are TTL (5 s list page cache, ETag per response); no report precomputes over all rows.
- Full-scan aggregations above are **report** shapes bounded by `maxTimeMS=20 s` (REPORT_MS) and an indexed `$match` prefix; grouping cost is O(matched rows), not O(all rows).