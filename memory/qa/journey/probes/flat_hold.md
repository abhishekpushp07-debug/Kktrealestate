# Probe `flat_hold` · BK-2627-0022 · 2026-10-26

Action result: `{"id": "dcaf425d-da49-42d5-aee5-7e2b3951dcd1", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-26T18:15:33.994397+00:00", "updated_at": "2026-10-26T18:22:59.192820+00:00", "created_by": "system", "is_active": true, "deleted_at": null, "version": 4, "project_id": "c170483e-f746-40df-9f1f-e6d798328039", "block_id": "d5ce049b-f5b8-4e03-9642-6e08c92beaf9", "flat_type_id": `

## Surfaces changed within 2.5 s (15)
- **project.workspace**
  - .blocks[]: 3 items, content changed
  - .inventory.Available: 51 → 50
  - .inventory.Hold: 2 → 3
  - .unit_counts.available: 51 → 50
  - .unit_counts.hold: 2 → 3
- **project.summary(read-model)**
  - .blocks[]: 3 items, content changed
  - .computed_at: "2026-10-26T18:22:50.250144+00:00" → "2026-10-26T18:22:59.600179+00:00"
  - .units.available: 51 → 50
  - .units.by_status.Available: 51 → 50
  - .units.by_status.Hold: 2 → 3
- **block.summary(read-model)**
  - .computed_at: "2026-10-26T18:22:40.226884+00:00" → "2026-10-26T18:22:59.585636+00:00"
  - .units.available: 12 → 11
  - .units.by_status.Available: 12 → 11
  - .units.by_status.Hold: null → 1
- **block.detail+grid**
  - .counts.Available: 12 → 11
  - .counts.Hold: 0 → 1
  - .floors[]: 8 items, content changed
- **inventory.flats(block)**
  - .items[]: 32 items, content changed
- **dashboard.home**
  - .computed_at: "2026-10-26T18:22:50.254915+00:00" → "2026-10-26T18:22:59.604722+00:00"
  - .greeting_date: "2026-10-26T18:22:58.956413+00:00" → "2026-10-26T18:23:01.860104+00:00"
  - .projects[]: 2 items, content changed
  - .totals.available: 57 → 56
- **dashboard.legacy**
  - .blocks[]: 5 items, content changed
  - .inventory.Available: 57 → 56
  - .inventory.Hold: 2 → 3
  - .projects[]: 2 items, content changed
  - .recent_audit[]: 10 items, content changed
- **report.collections(today)**
  - .error.request_id: "0fcbadac67584429" → "a2f6aa0d13c44c05"
  - .request_id: "0fcbadac67584429" → "a2f6aa0d13c44c05"
- **report.inventory**
  - .rows[]: 5 items, content changed
  - .totals.available: 57 → 56
  - .totals.available_value: 360018175.0 → 353565675.0
  - .totals.available_value_paise: 36001817500 → 35356567500
  - .totals.hold: 2 → 3
- **report.roznamcha_range**
  - .error.request_id: "89e62cfd542644e8" → "9734becc457a43c9"
  - .request_id: "89e62cfd542644e8" → "9734becc457a43c9"
- **report.bank_receipts**
  - .rows[]: 5 items, content changed
- **report.activity**
  - .actions[]: 59 items, content changed
  - .rows[]: 458 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjI6NDguMjMyODIyKzA → "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjI6NTcuNTc0OTYzKzA
  - .total: 3760 → 3761
- **search(customer name)**
  - .took_ms: 2.8 → 2.6
- **pdf.statement(len)**
  - .error.request_id: "e649e010dc404241" → "49447fb614a7489c"
  - .request_id: "e649e010dc404241" → "49447fb614a7489c"

## Changed only after caches expired (stale 2.5–9 s) (3)
- dashboard.widgets
- report.demand_vs_collection
- report.sales_leads

## Unchanged (29)
- audit.booking
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
- flat.detail
- leads.board
- leads.list
- notifications(staff)
- payments.list+totals
- payments.summary
- report.advances
- report.cancellations
- report.cheques
- report.construction_progress
- report.outstanding
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`[200, {"id": "dcaf425d-da49-42d5-aee5-7e2b3951dcd1", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-26T18:15:33.994397+00:00", "updated_at": "2026-10-26T18:23:08.560554+00:00", "created_by": "system", "is_active": true, "deleted_at": null, "version": 5, "project_id": "c`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: changed
- blocks: changed
- bootstrap: MISSING
- dashboard: changed
- flats: changed
- home: changed
- inventory: changed
- notifications: MISSING
- projects: changed
- reports: changed
