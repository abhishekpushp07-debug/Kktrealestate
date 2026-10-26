# Probe `customer_edit` · BK-2627-0022 · 2026-10-26

Action result: `{"id": "924ae5b8-9b04-421d-a75d-20ef63efe8e3", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-09T05:00:00+00:00", "updated_at": "2026-10-26T18:23:42.369836+00:00", "created_by": "b63b8b19-94ac-4c8e-845b-faf8019d7a8e", "is_active": true, "deleted_at": null, "version": 5, "salutation": null, "full_name": "Deepak Thakur", "father_or_spouse_name": null, "dob": null, "gend`

## Surfaces changed within 2.5 s (10)
- **customer.360**
  - .occupation: "Business" → "F-probe occupation"
  - .updated_at: "2026-10-26T18:22:04.238124+00:00" → "2026-10-26T18:23:42.369836+00:00"
  - .version: 4 → 5
- **dashboard.home**
  - .computed_at: "2026-10-26T18:23:25.465027+00:00" → "2026-10-26T18:23:44.389665+00:00"
  - .greeting_date: "2026-10-26T18:23:32.246322+00:00" → "2026-10-26T18:23:44.999436+00:00"
  - .projects[]: 2 items, content changed
  - .recent[]: 12 items, content changed
- **dashboard.legacy**
  - .recent_audit[]: 10 items, content changed
- **report.collections(today)**
  - .error.request_id: "62fdb4001b5e4925" → "07de21640ce545f7"
  - .request_id: "62fdb4001b5e4925" → "07de21640ce545f7"
- **report.roznamcha_range**
  - .error.request_id: "4a20f6900b2d42bb" → "a0ffc3a33ffc4a84"
  - .request_id: "4a20f6900b2d42bb" → "a0ffc3a33ffc4a84"
- **report.bank_receipts**
  - .rows[]: 5 items, content changed
- **report.activity**
  - .actions[]: 59 items, content changed
  - .rows[]: 458 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjM6MjEuNTQ4Njk1KzA → "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjM6MzAuODU3ODMzKzA
  - .total: 3766 → 3767
- **search(customer name)**
  - .took_ms: 2.4 → 2.7
- **pdf.statement(len)**
  - .error.request_id: "f1c06902663e46cd" → "8150b9bc59d94b79"
  - .request_id: "f1c06902663e46cd" → "8150b9bc59d94b79"

## Changed only after caches expired (stale 2.5–9 s) (0)

## Unchanged (37)
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
- project.summary(read-model)
- project.workspace
- report.advances
- report.cancellations
- report.cheques
- report.construction_progress
- report.demand_vs_collection
- report.inventory
- report.outstanding
- report.sales_leads
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`[200, {"id": "924ae5b8-9b04-421d-a75d-20ef63efe8e3", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-09T05:00:00+00:00", "updated_at": "2026-10-26T18:23:51.625189+00:00", "created_by": "b63b8b19-94ac-4c8e-845b-faf8019d7a8e", "is_active": true, "deleted_at": null, "versio`

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
