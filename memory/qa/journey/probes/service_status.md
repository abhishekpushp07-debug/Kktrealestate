# Probe `service_status` · BK-2526-0002 · 2026-10-26

Action result: `{"id": "083f8c16-a597-4c3d-844d-48fe9037efb7", "company_id": "502247ec-ff5e-4038-b2b6-f6d48c9aec8e", "created_at": "2026-10-26T09:29:18.526232+00:00", "updated_at": "2026-10-26T10:26:23.277787+00:00", "created_by": null, "is_active": true, "deleted_at": null, "version": 6, "ticket_number": "SR-2627-0025", "customer_id": "073088d3-1874-4498-8130-088bea827922", "customer_name": "Amit Kumar Sinha", "`

## Surfaces changed within 2.5 s (14)
- **dashboard.home**
  - .computed_at: "2026-10-26T10:26:12.545790+00:00" → "2026-10-26T10:26:25.306422+00:00"
  - .greeting_date: "2026-10-26T10:26:14.971572+00:00" → "2026-10-26T10:26:25.920414+00:00"
  - .projects[]: 3 items, content changed
- **dashboard.legacy**
  - .recent_audit[]: 10 items, content changed
- **report.collections(today)**
  - .error.request_id: "7b50e4605d9d4e5c" → "7f59f06b235b4668"
  - .request_id: "7b50e4605d9d4e5c" → "7f59f06b235b4668"
- **report.demand_vs_collection**
  - .rows[]: 41 items, content changed
- **report.inventory**
  - .realised_rates[]: 2 items, content changed
- **report.sales_leads**
  - .bookings_per_user[]: 3 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "1061386acb164932" → "833c126030ef40d1"
  - .request_id: "1061386acb164932" → "833c126030ef40d1"
- **report.bank_receipts**
  - .rows[]: 6 items, content changed
- **report.activity**
  - .actions[]: 103 items, content changed
  - .rows[]: 354 items, content changed
- **report.service_sla**
  - .status_counts[]: 4 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "af024f13-d2fd-4f44-862e-29305faac07a" → "ba0c2aa5-49bc-42e4-83db-0c3f91f526bc"
  - .total: 4898 → 4899
- **search(customer name)**
  - .took_ms: 2.4 → 2.6
- **service.list**
  - .items[]: 5 items, content changed
  - .status_counts.In Progress: 1 → 2
  - .status_counts.New: 22 → 21
- **pdf.statement(len)**
  - .error.request_id: "c0c1115156e74a2f" → "4987db4d8c774197"
  - .request_id: "c0c1115156e74a2f" → "4987db4d8c774197"

## Changed only after caches expired (stale 2.5–9 s) (0)

## Unchanged (33)
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
- customer.360
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
- report.outstanding
- report.statement
- roznamcha(today)

## Restore
`[200, {"id": "083f8c16-a597-4c3d-844d-48fe9037efb7", "company_id": "502247ec-ff5e-4038-b2b6-f6d48c9aec8e", "created_at": "2026-10-26T09:29:18.526232+00:00", "updated_at": "2026-10-26T10:26:32.582905+00:00", "created_by": null, "is_active": true, "deleted_at": null, "version": 7, "ticket_number": "SR`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: changed
- blocks: MISSING
- bookings: MISSING
- customer360: MISSING
- demands: MISSING
- home: changed
- notifications: MISSING
- projects: MISSING
- reports: changed
- service: changed
