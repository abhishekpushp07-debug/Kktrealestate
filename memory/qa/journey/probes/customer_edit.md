# Probe `customer_edit` · BK-2627-0022 · 2026-10-26

Action result: `{"id": "924ae5b8-9b04-421d-a75d-20ef63efe8e3", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-09T05:00:00+00:00", "updated_at": "2026-10-26T18:25:46.847064+00:00", "created_by": "b63b8b19-94ac-4c8e-845b-faf8019d7a8e", "is_active": true, "deleted_at": null, "version": 7, "salutation": null, "full_name": "Deepak Thakur", "father_or_spouse_name": null, "dob": null, "gend`

## Surfaces changed within 2.5 s (8)
- **customer.360**
  - .occupation: "Business" → "F-probe occupation"
  - .updated_at: "2026-10-26T18:23:51.625189+00:00" → "2026-10-26T18:25:46.847064+00:00"
  - .version: 6 → 7
- **dashboard.home**
  - .computed_at: "2026-10-26T18:25:37.925987+00:00" → "2026-10-26T18:25:48.866241+00:00"
  - .greeting_date: "2026-10-26T18:25:39.151479+00:00" → "2026-10-26T18:25:49.472605+00:00"
  - .recent[]: 12 items, content changed
- **dashboard.legacy**
  - .recent_audit[]: 10 items, content changed
- **report.inventory**
  - .realised_rates[]: 2 items, content changed
- **report.bank_receipts**
  - .rows[]: 5 items, content changed
- **report.activity**
  - .actions[]: 59 items, content changed
  - .rows[]: 458 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjU6MzYuNDMwNzY5KzA → "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjU6MzYuNDg1MjQ4KzA
  - .total: 3776 → 3777
- **search(customer name)**
  - .took_ms: 2.6 → 2.5

## Changed only after caches expired (stale 2.5–9 s) (1)
- report.sales_leads

## Unchanged (38)
- audit.booking
- block.detail+grid
- block.summary(read-model)
- booking.detail+summary
- booking.ledger(account)
- booking.ledger(cash)
- booking.ledger(combined)
- booking.ledger(other)
- booking.schedule/demands
- bootstrap.counts
- cheques.in_hand
- construction.milestones(block)
- customer.ledgers
- customer.panels(comms/docs)
- customer.timeline
- dashboard.widgets
- flat.detail
- inventory.flats(block)
- leads.board
- leads.list
- notifications(staff)
- payments.list+totals
- payments.summary
- pdf.statement(len)
- project.summary(read-model)
- project.workspace
- report.advances
- report.cancellations
- report.cheques
- report.collections(today)
- report.construction_progress
- report.demand_vs_collection
- report.outstanding
- report.roznamcha_range
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`[200, {"id": "924ae5b8-9b04-421d-a75d-20ef63efe8e3", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-09T05:00:00+00:00", "updated_at": "2026-10-26T18:25:56.321576+00:00", "created_by": "b63b8b19-94ac-4c8e-845b-faf8019d7a8e", "is_active": true, "deleted_at": null, "versio`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: changed
- bookings: MISSING
- customer360: changed
- customers: changed
- home: changed
- notifications: MISSING
- payments: MISSING
- search: changed
