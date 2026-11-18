# Probe `service_status` · BK-2627-0022 · 2026-10-26

Action result: `{"id": "41f6a696-64a7-4f84-8733-bf93c2240b38", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-24T05:00:00+00:00", "updated_at": "2026-10-26T18:23:21.547470+00:00", "created_by": "b63b8b19-94ac-4c8e-845b-faf8019d7a8e", "is_active": true, "deleted_at": null, "version": 4, "ticket_number": "SR-2627-0001", "customer_id": "a7f23066-e655-46a1-8c44-cdd2b995fc8e", "customer_n`

## Surfaces changed within 2.5 s (13)
- **project.summary(read-model)**
  - .blocks[]: 3 items, content changed
  - .computed_at: "2026-10-26T18:23:10.621570+00:00" → "2026-10-26T18:23:21.926471+00:00"
  - .progress_pct: 56.7 → 53.7
- **block.summary(read-model)**
  - .computed_at: "2026-10-26T18:23:10.607228+00:00" → "2026-10-26T18:23:21.911930+00:00"
  - .progress.completed: 9 → 8
  - .progress.current_stage: "Flooring" → "Finishing"
  - .progress.percent: 82 → 73
  - .progress.upcoming_stage: "External Works" → "Flooring"
- **dashboard.home**
  - .computed_at: "2026-10-26T18:23:10.626123+00:00" → "2026-10-26T18:23:21.939545+00:00"
  - .greeting_date: "2026-10-26T18:23:21.296537+00:00" → "2026-10-26T18:23:24.171158+00:00"
  - .projects[]: 2 items, content changed
- **report.collections(today)**
  - .error.request_id: "adbeab5f4e454070" → "f241299eaa6147bf"
  - .request_id: "adbeab5f4e454070" → "f241299eaa6147bf"
- **report.inventory**
  - .realised_rates[]: 2 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "6c2aabbbedef456e" → "c5c352dade9f4bf0"
  - .request_id: "6c2aabbbedef456e" → "c5c352dade9f4bf0"
- **report.bank_receipts**
  - .rows[]: 5 items, content changed
- **report.activity**
  - .actions[]: 59 items, content changed
  - .rows[]: 458 items, content changed
- **report.service_sla**
  - .rows[]: 7 items, content changed
  - .status_counts[]: 4 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjM6MTAuMjc4MTYxKzA → "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjM6MTkuODcwMTEzKzA
  - .total: 3764 → 3765
- **search(customer name)**
  - .took_ms: 2.8 → 2.5
- **service.list**
  - .items[]: 5 items, content changed
  - .status_counts.In Progress: 5 → 6
  - .status_counts.New: 3 → 2
- **pdf.statement(len)**
  - .error.request_id: "841230eb66fb4270" → "57cd1a20eda242b3"
  - .request_id: "841230eb66fb4270" → "57cd1a20eda242b3"

## Changed only after caches expired (stale 2.5–9 s) (2)
- dashboard.widgets
- report.demand_vs_collection

## Unchanged (32)
- audit.booking
- block.detail+grid
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
- dashboard.legacy
- flat.detail
- inventory.flats(block)
- leads.board
- leads.list
- notifications(staff)
- payments.list+totals
- payments.summary
- project.workspace
- report.advances
- report.cancellations
- report.cheques
- report.construction_progress
- report.outstanding
- report.sales_leads
- report.statement
- roznamcha(today)

## Restore
`[200, {"id": "41f6a696-64a7-4f84-8733-bf93c2240b38", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-24T05:00:00+00:00", "updated_at": "2026-10-26T18:23:30.856553+00:00", "created_by": "b63b8b19-94ac-4c8e-845b-faf8019d7a8e", "is_active": true, "deleted_at": null, "versio`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: changed
- blocks: changed
- bookings: MISSING
- customer360: MISSING
- demands: MISSING
- home: changed
- notifications: MISSING
- projects: changed
- reports: changed
- service: changed
