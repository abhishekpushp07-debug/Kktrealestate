# Probe `flat_hold` · BK-2526-0002 · 2026-10-26

Action result: `{"id": "efa19393-ba5b-4869-8240-6b166d34b94f", "company_id": "502247ec-ff5e-4038-b2b6-f6d48c9aec8e", "created_at": "2026-10-26T00:58:57.490079+00:00", "updated_at": "2026-10-26T10:26:01.106620+00:00", "created_by": "system", "is_active": true, "deleted_at": null, "version": 33, "project_id": "48b9fd93-bf6b-4c6b-85cf-60c71ff1eca5", "block_id": "2186f929-6c1d-461b-b567-651c38768ad1", "flat_type_id":`

## Surfaces changed within 2.5 s (17)
- **project.workspace**
  - .blocks[]: 4 items, content changed
  - .inventory.Available: 147 → 146
  - .inventory.Hold: 4 → 5
  - .unit_counts.available: 147 → 146
  - .unit_counts.hold: 4 → 5
- **project.summary(read-model)**
  - .blocks[]: 25 items, content changed
  - .computed_at: "2026-10-26T10:25:52.141575+00:00" → "2026-10-26T10:26:01.469474+00:00"
  - .units.available: 147 → 146
  - .units.by_status.Available: 147 → 146
  - .units.by_status.Hold: 4 → 5
- **block.summary(read-model)**
  - .computed_at: "2026-10-26T10:25:42.102909+00:00" → "2026-10-26T10:26:01.462812+00:00"
  - .units.available: 27 → 26
  - .units.by_status.Available: 27 → 26
  - .units.by_status.Hold: 1 → 2
- **block.detail+grid**
  - .counts.Available: 27 → 26
  - .counts.Hold: 1 → 2
  - .floors[]: 8 items, content changed
- **inventory.flats(block)**
  - .items[]: 32 items, content changed
- **dashboard.home**
  - .computed_at: "2026-10-26T10:25:52.147186+00:00" → "2026-10-26T10:26:01.475700+00:00"
  - .greeting_date: "2026-10-26T10:26:00.845813+00:00" → "2026-10-26T10:26:03.799380+00:00"
  - .projects[]: 3 items, content changed
  - .totals.available: 161 → 160
- **dashboard.legacy**
  - .blocks[]: 6 items, content changed
  - .follow_ups_due.items[]: 3 items, content changed
  - .inventory.Available: 161 → 160
  - .inventory.Hold: 6 → 7
  - .projects[]: 3 items, content changed
  - .recent_audit[]: 10 items, content changed
- **report.collections(today)**
  - .error.request_id: "934767aa9f034bda" → "6e12ac9d17ec4025"
  - .request_id: "934767aa9f034bda" → "6e12ac9d17ec4025"
- **report.demand_vs_collection**
  - .rows[]: 41 items, content changed
- **report.inventory**
  - .realised_rates[]: 2 items, content changed
  - .rows[]: 6 items, content changed
  - .totals.available: 161 → 160
  - .totals.available_value: 924752000.0 → 919824000.0
  - .totals.available_value_paise: 92475200000 → 91982400000
  - .totals.hold: 6 → 7
- **report.sales_leads**
  - .bookings_per_user[]: 3 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "8a6bcbf17caa4678" → "8976c3431f9a4aa3"
  - .request_id: "8a6bcbf17caa4678" → "8976c3431f9a4aa3"
- **report.bank_receipts**
  - .rows[]: 6 items, content changed
- **report.activity**
  - .actions[]: 103 items, content changed
  - .rows[]: 354 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "f12b772f-f91d-44ed-b415-200689c6d6b1" → "b5d70cc3-22e6-4eb3-9373-fd62d99c1b8a"
  - .total: 4893 → 4894
- **search(customer name)**
  - .took_ms: 2.5 → 2.7
- **pdf.statement(len)**
  - .error.request_id: "dc53e2199d624f77" → "d99b40c3557e41c9"
  - .request_id: "dc53e2199d624f77" → "d99b40c3557e41c9"

## Changed only after caches expired (stale 2.5–9 s) (1)
- dashboard.widgets

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
`[200, {"id": "efa19393-ba5b-4869-8240-6b166d34b94f", "company_id": "502247ec-ff5e-4038-b2b6-f6d48c9aec8e", "created_at": "2026-10-26T00:58:57.490079+00:00", "updated_at": "2026-10-26T10:26:10.477601+00:00", "created_by": "system", "is_active": true, "deleted_at": null, "version": 34, "project_id": "`

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
