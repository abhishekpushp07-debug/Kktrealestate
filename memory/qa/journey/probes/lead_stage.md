# Probe `lead_stage` · BK-2526-0012 · 2026-10-26

Action result: `{"id": "dc3da097-9a4e-48f5-bfb1-97bcee48e9d4", "company_id": "36cd450b-9910-4a57-aebb-68f2be8b6c6f", "created_at": "2026-10-10T05:00:00+00:00", "updated_at": "2026-10-26T14:08:25.562381+00:00", "created_by": "a8b2f2ca-8e1c-4722-a626-dccd7581941d", "is_active": true, "deleted_at": null, "version": 2, "name": "Ashok Prasad", "phone": "+919876501171", "email": null, "project_id": "7315d90c-523b-4934-`

## Surfaces changed within 2.5 s (12)
- **project.summary(read-model)**
  - .advance: 757403.75 → 747403.75
  - .advance_paise: 75740375 → 74740375
  - .collections_mtd: 13894710.0 → 13884710.0
  - .collections_mtd_paise: 1389471000 → 1388471000
  - .collections_total: 189072952.51 → 189062952.51
  - .collections_total_paise: 18907295251 → 18906295251
  - .computed_at: "2026-10-26T14:08:16.168739+00:00" → "2026-10-26T14:08:25.626508+00:00"
  - .paid: 188099077.51 → 188089077.51
- **block.summary(read-model)**
  - .advance: 10000.0 → 0.0
  - .advance_paise: 1000000 → 0
  - .collections_mtd: 3444687.5 → 3434687.5
  - .collections_mtd_paise: 344468750 → 343468750
  - .collections_total: 45355875.0 → 45345875.0
  - .collections_total_paise: 4535587500 → 4534587500
  - .computed_at: "2026-10-26T14:08:16.159842+00:00" → "2026-10-26T14:08:25.616387+00:00"
  - .paid: 44867625.0 → 44857625.0
- **dashboard.home**
  - .computed_at: "2026-10-26T14:08:16.180841+00:00" → "2026-10-26T14:08:25.642600+00:00"
  - .greeting_date: "2026-10-26T14:08:25.228094+00:00" → "2026-10-26T14:08:28.212999+00:00"
  - .projects[]: 2 items, content changed
  - .recent[]: 12 items, content changed
  - .totals.advance: 757403.75 → 747403.75
  - .totals.advance_paise: 75740375 → 74740375
  - .totals.collections_mtd: 13894710.0 → 13884710.0
  - .totals.collections_mtd_paise: 1389471000 → 1388471000
- **report.collections(today)**
  - .error.request_id: "c11f6216924545ef" → "9b1e271594674b8d"
  - .request_id: "c11f6216924545ef" → "9b1e271594674b8d"
- **report.sales_leads**
  - .funnel[]: 7 items, content changed
  - .rows[]: 6 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "b334268f953c42c1" → "a225f921eb904026"
  - .request_id: "b334268f953c42c1" → "a225f921eb904026"
- **report.bank_receipts**
  - .rows[]: 5 items, content changed
- **report.activity**
  - .actions[]: 57 items, content changed
  - .rows[]: 457 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTQ6MDg6MjMuNTQ5Mjk2KzA → "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTQ6MDg6MjMuNjQ5MTQxKzA
  - .total: 3630 → 3631
- **search(customer name)**
  - .took_ms: 2.7 → 2.4
- **leads.board**
  - .columns[]: 7 items, content changed
- **pdf.statement(len)**
  - .error.request_id: "94da3491d9b34885" → "ed3a61b03fbf4f0e"
  - .request_id: "94da3491d9b34885" → "ed3a61b03fbf4f0e"

## Changed only after caches expired (stale 2.5–9 s) (0)

## Unchanged (35)
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
- dashboard.widgets
- flat.detail
- inventory.flats(block)
- leads.list
- notifications(staff)
- payments.list+totals
- payments.summary
- project.workspace
- report.advances
- report.cancellations
- report.cheques
- report.construction_progress
- report.demand_vs_collection
- report.inventory
- report.outstanding
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`[200, {"id": "dc3da097-9a4e-48f5-bfb1-97bcee48e9d4", "company_id": "36cd450b-9910-4a57-aebb-68f2be8b6c6f", "created_at": "2026-10-10T05:00:00+00:00", "updated_at": "2026-10-26T14:08:34.756494+00:00", "created_by": "a8b2f2ca-8e1c-4722-a626-dccd7581941d", "is_active": true, "deleted_at": null, "versio`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: changed
- customer360: MISSING
- home: changed
- leads: changed
- notifications: MISSING
- projects: changed
- reports: changed
