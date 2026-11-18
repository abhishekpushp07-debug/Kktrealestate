# Explain audit — DB `kkt_scale` (5,070,000 rows across list collections)

Shapes: 101 · flagged: **84** (COLLSCAN / in-memory SORT) · indexes as-is · timings: cold = first run, warm p95 of 4 reruns, limit 50 (lists) / full aggregation (reports)

| shape | collection | verdict | cold ms | warm p95 ms | keys examined | docs examined | plan stages |
|---|---|---|---|---|---|---|---|
| list bookings sort booking_number | bookings | **MEM_SORT** | 44.7 | 44.0 | 30000 | 30000 | FETCH,IXSCAN,SORT |
| list bookings sort -booking_number | bookings | **MEM_SORT** | 43.9 | 44.1 | 30000 | 30000 | FETCH,IXSCAN,SORT |
| list bookings sort booking_date | bookings | **MEM_SORT** | 38.2 | 37.9 | 30000 | 50 | FETCH,IXSCAN,SORT |
| list bookings sort -booking_date | bookings | **MEM_SORT** | 25.2 | 25.2 | 30000 | 50 | FETCH,IXSCAN,SORT |
| list bookings sort created_at | bookings | **MEM_SORT** | 43.2 | 43.2 | 30000 | 30000 | FETCH,IXSCAN,SORT |
| list bookings sort -created_at | bookings | **MEM_SORT** | 43.3 | 43.6 | 30000 | 30000 | FETCH,IXSCAN,SORT |
| list bookings sort status | bookings | **MEM_SORT** | 25.8 | 25.7 | 30000 | 50 | FETCH,IXSCAN,SORT |
| list bookings sort -status | bookings | **MEM_SORT** | 25.8 | 25.7 | 30000 | 50 | FETCH,IXSCAN,SORT |
| list bookings sort customer_name | bookings | **MEM_SORT** | 48.1 | 48.3 | 30000 | 30000 | FETCH,IXSCAN,SORT |
| list bookings sort -customer_name | bookings | **MEM_SORT** | 48.3 | 48.4 | 30000 | 30000 | FETCH,IXSCAN,SORT |
| list bookings by project | bookings | **MEM_SORT** | 3.1 | 3.1 | 1200 | 1200 | FETCH,IXSCAN,SORT |
| list payments sort payment_date | payments | **MEM_SORT** | 848.3 | 843.1 | 990000 | 50 | FETCH,IXSCAN,SORT |
| list payments sort -payment_date | payments | **MEM_SORT** | 778.6 | 775.7 | 990000 | 50 | FETCH,IXSCAN,SORT |
| list payments sort receipt_number | payments | **MEM_SORT** | 1847.7 | 1821.3 | 990000 | 990000 | FETCH,IXSCAN,SORT |
| list payments sort -receipt_number | payments | **MEM_SORT** | 1841.6 | 1825.9 | 990000 | 990000 | FETCH,IXSCAN,SORT |
| list payments sort amount_paise | payments | **MEM_SORT** | 2044.8 | 2046.9 | 990000 | 990000 | FETCH,IXSCAN,SORT |
| list payments sort -amount_paise | payments | **MEM_SORT** | 2032.1 | 2042.4 | 990000 | 990000 | FETCH,IXSCAN,SORT |
| list payments sort status | payments | **MEM_SORT** | 797.9 | 787.6 | 990000 | 50 | FETCH,IXSCAN,SORT |
| list payments sort -status | payments | **MEM_SORT** | 790.0 | 790.4 | 990000 | 50 | FETCH,IXSCAN,SORT |
| list payments sort created_at | payments | **MEM_SORT** | 2074.8 | 2071.2 | 990000 | 990000 | FETCH,IXSCAN,SORT |
| list payments sort -created_at | payments | **MEM_SORT** | 1769.2 | 1761.1 | 990000 | 990000 | FETCH,IXSCAN,SORT |
| list payments by project | payments | **MEM_SORT** | 73.7 | 70.8 | 39600 | 39600 | FETCH,IXSCAN,SORT |
| list demands sort due_date | demands | **MEM_SORT** | 1140.3 | 1138.9 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list demands sort -due_date | demands | **MEM_SORT** | 1162.4 | 1155.0 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list demands sort demand_date | demands | **MEM_SORT** | 1138.1 | 1130.5 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list demands sort -demand_date | demands | **MEM_SORT** | 1140.0 | 1147.0 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list demands sort total_demand_paise | demands | **MEM_SORT** | 1121.6 | 1114.9 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list demands sort -total_demand_paise | demands | **MEM_SORT** | 1114.5 | 1116.3 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list demands sort customer_name | demands | **MEM_SORT** | 1170.4 | 1177.2 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list demands sort -customer_name | demands | **MEM_SORT** | 1178.0 | 1182.8 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list demands by project | demands | **MEM_SORT** | 894.9 | 895.9 | 600000 | 600000 | FETCH,IXSCAN,SORT |
| list customers sort full_name | customers | **MEM_SORT** | 39.8 | 39.6 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort -full_name | customers | **MEM_SORT** | 40.3 | 40.2 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort customer_code | customers | **MEM_SORT** | 50.3 | 50.6 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort -customer_code | customers | **MEM_SORT** | 66.2 | 66.3 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort created_at | customers | **MEM_SORT** | 54.9 | 54.9 | 40000 | 50 | FETCH,IXSCAN,SORT |
| list customers sort -created_at | customers | **MEM_SORT** | 33.8 | 33.6 | 40000 | 50 | FETCH,IXSCAN,SORT |
| list customers sort kyc_status | customers | **MEM_SORT** | 49.8 | 50.2 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort -kyc_status | customers | **MEM_SORT** | 50.1 | 50.3 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort phone | customers | **MEM_SORT** | 41.9 | 41.8 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort -phone | customers | **MEM_SORT** | 58.4 | 58.6 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort engagement_score | customers | **MEM_SORT** | 51.0 | 51.3 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort -engagement_score | customers | **MEM_SORT** | 51.5 | 51.6 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort lifecycle_stage | customers | **MEM_SORT** | 52.2 | 52.2 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers sort -lifecycle_stage | customers | **MEM_SORT** | 51.8 | 52.2 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list customers by project | customers | **MEM_SORT** | 45.1 | 45.9 | 40000 | 40000 | FETCH,IXSCAN,SORT |
| list leads sort name | leads | **MEM_SORT** | 106.4 | 104.5 | 100000 | 100000 | FETCH,IXSCAN,SORT |
| list leads sort -name | leads | **MEM_SORT** | 104.9 | 104.7 | 100000 | 100000 | FETCH,IXSCAN,SORT |
| list leads sort lead_number | leads | **MEM_SORT** | 114.2 | 115.2 | 100000 | 100000 | FETCH,IXSCAN,SORT |
| list leads sort -lead_number | leads | **MEM_SORT** | 119.5 | 119.6 | 100000 | 100000 | FETCH,IXSCAN,SORT |
| list leads sort created_at | leads | **MEM_SORT** | 92.4 | 91.8 | 100000 | 50 | FETCH,IXSCAN,SORT |
| list leads sort -created_at | leads | **MEM_SORT** | 84.5 | 84.4 | 100000 | 50 | FETCH,IXSCAN,SORT |
| list leads sort status | leads | **MEM_SORT** | 80.9 | 79.8 | 100000 | 50 | FETCH,IXSCAN,SORT |
| list leads sort -status | leads | **MEM_SORT** | 83.1 | 83.0 | 100000 | 50 | FETCH,IXSCAN,SORT |
| list leads sort next_follow_up_at | leads | **MEM_SORT** | 119.0 | 119.0 | 100000 | 100000 | FETCH,IXSCAN,SORT |
| list leads sort -next_follow_up_at | leads | **MEM_SORT** | 118.9 | 118.9 | 100000 | 100000 | FETCH,IXSCAN,SORT |
| list leads by project | leads | **MEM_SORT** | 6.5 | 6.1 | 4000 | 4000 | FETCH,IXSCAN,SORT |
| list flats sort flat_number | flats | **MEM_SORT** | 63.9 | 64.5 | 60000 | 60000 | FETCH,IXSCAN,SORT |
| list flats sort -flat_number | flats | **MEM_SORT** | 64.7 | 65.6 | 60000 | 60000 | FETCH,IXSCAN,SORT |
| list flats sort floor | flats | **MEM_SORT** | 64.0 | 64.4 | 60000 | 60000 | FETCH,IXSCAN,SORT |
| list flats sort -floor | flats | **MEM_SORT** | 64.6 | 65.1 | 60000 | 60000 | FETCH,IXSCAN,SORT |
| list flats sort status | flats | **MEM_SORT** | 67.8 | 68.1 | 60000 | 60000 | FETCH,IXSCAN,SORT |
| list flats sort -status | flats | **MEM_SORT** | 69.2 | 69.0 | 60000 | 60000 | FETCH,IXSCAN,SORT |
| list flats sort price_paise | flats | **MEM_SORT** | 71.4 | 71.7 | 60000 | 60000 | FETCH,IXSCAN,SORT |
| list flats sort -price_paise | flats | **MEM_SORT** | 71.7 | 71.3 | 60000 | 60000 | FETCH,IXSCAN,SORT |
| list flats by project | flats | **MEM_SORT** | 4.0 | 3.9 | 2400 | 2400 | FETCH,IXSCAN,SORT |
| list audit_logs sort created_at | audit_logs | **COLLSCAN** | 1760.9 | 1662.2 | 0 | 3000000 | COLLSCAN,SORT |
| list audit_logs sort -created_at | audit_logs | **COLLSCAN** | 1661.1 | 1661.1 | 0 | 3000000 | COLLSCAN,SORT |
| list audit_logs by project | audit_logs | **COLLSCAN** | 1110.7 | 1111.0 | 0 | 3000000 | COLLSCAN,SORT |
| list service_tickets sort created_at | service_tickets | **COLLSCAN** | 32.8 | 32.8 | 0 | 50000 | COLLSCAN,SORT |
| list service_tickets sort -created_at | service_tickets | **COLLSCAN** | 32.6 | 32.7 | 0 | 50000 | COLLSCAN,SORT |
| list service_tickets sort status | service_tickets | **COLLSCAN** | 29.9 | 29.6 | 0 | 50000 | COLLSCAN,SORT |
| list service_tickets sort -status | service_tickets | **COLLSCAN** | 29.6 | 29.6 | 0 | 50000 | COLLSCAN,SORT |
| list service_tickets sort priority | service_tickets | **COLLSCAN** | 29.4 | 29.4 | 0 | 50000 | COLLSCAN,SORT |
| list service_tickets sort -priority | service_tickets | **COLLSCAN** | 29.2 | 29.2 | 0 | 50000 | COLLSCAN,SORT |
| list service_tickets by project | service_tickets | **COLLSCAN** | 20.8 | 20.8 | 0 | 50000 | COLLSCAN,SORT |
| list documents sort created_at | documents | **COLLSCAN** | 134.7 | 134.5 | 0 | 200000 | COLLSCAN,SORT |
| list documents sort -created_at | documents | **COLLSCAN** | 134.7 | 133.7 | 0 | 200000 | COLLSCAN,SORT |
| list documents sort kind | documents | **COLLSCAN** | 113.1 | 113.2 | 0 | 200000 | COLLSCAN,SORT |
| list documents sort -kind | documents | **COLLSCAN** | 113.7 | 113.5 | 0 | 200000 | COLLSCAN,SORT |
| list documents by project | documents | **COLLSCAN** | 81.0 | 81.0 | 0 | 200000 | COLLSCAN,SORT |
| search customers by name prefix | customers | ok | 0.7 | 0.6 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| search customers by phone | customers | ok | 0.6 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| search bookings by number | bookings | ok | 1.7 | 1.5 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| customer 360 bookings | bookings | **MEM_SORT** | 0.3 | 0.2 | 1 | 1 | FETCH,IXSCAN,SORT |
| booking ledger | ledger_entries | ok | 0.5 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| booking payments | payments | **MEM_SORT** | 0.5 | 0.4 | 33 | 33 | FETCH,IXSCAN,SORT |
| booking demands | demands | **MEM_SORT** | 0.4 | 0.3 | 20 | 20 | FETCH,IXSCAN,SORT |
| audit by entity | audit_logs | ok | 0.4 | 0.4 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| cheques pending | payments | ok | 0.2 | 0.2 | 0 | 0 | FETCH,IXSCAN,LIMIT |
| overdue demands | demands | ok | 0.5 | 0.5 | 50 | 50 | FETCH,IXSCAN,LIMIT,SORT_MERGE |
| flats by block | flats | ok | 1.1 | 1.0 | 50 | 50 | FETCH,IXSCAN,LIMIT |
| report collections by month | payments | ok | 566.2 | 528.8 | 183112 | 183112 | FETCH,IXSCAN,PROJECTION_SIMPLE |
| report collections by project | payments | ok | 520.7 | 502.9 | 183112 | 183112 | FETCH,IXSCAN,PROJECTION_SIMPLE |
| report outstanding by project | bookings | ok | 90.4 | 89.5 | 30000 | 30000 | FETCH,IXSCAN,PROJECTION_DEFAULT |
| dashboard: cheques to clear | payments | ok | 0.4 | 0.2 | 0 | 0 | IXSCAN,PROJECTION_COVERED |
| dashboard: collected this month | payments | ok | 1741.5 | 1736.2 | 649987 | 649987 | FETCH,IXSCAN,PROJECTION_SIMPLE |
| project summary read model | bookings | ok | 2.9 | 2.8 | 1200 | 1200 | FETCH,IXSCAN,PROJECTION_DEFAULT |
| leads pipeline | leads | ok | 154.9 | 155.1 | 100000 | 100000 | FETCH,IXSCAN,PROJECTION_SIMPLE |
| inventory by status | flats | ok | 3.6 | 3.5 | 2400 | 2400 | FETCH,IXSCAN,PROJECTION_SIMPLE |
| ageing: open demands | demands | ok | 129.3 | 130.5 | 30001 | 30000 | FETCH,IXSCAN,PROJECTION_SIMPLE |

## Read-model refresh cost
- Project/customer summaries and dashboard KPIs are maintained by the Phase D/G outbox (per-entity deltas on payment/demand/booking events); nightly `read_model_flush` recomputes only projects touched since the last flush (`settings.read_models_v1`).
- Report caches are TTL (5 s list page cache, ETag per response); no report precomputes over all rows.
- Full-scan aggregations above are **report** shapes bounded by `maxTimeMS=20 s` (REPORT_MS) and an indexed `$match` prefix; grouping cost is O(matched rows), not O(all rows).