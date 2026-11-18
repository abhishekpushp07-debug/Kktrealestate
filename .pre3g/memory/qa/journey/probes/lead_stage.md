# Probe `lead_stage` · BK-2627-0022 · 2026-10-26

Action result: `{"id": "2fdc35e5-6dea-4de3-aa0c-a9cdb729c780", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-10T05:00:00+00:00", "updated_at": "2026-10-26T18:22:48.231594+00:00", "created_by": "b63b8b19-94ac-4c8e-845b-faf8019d7a8e", "is_active": true, "deleted_at": null, "version": 4, "name": "Ashok Prasad", "phone": "+919876501178", "email": null, "project_id": "c170483e-f746-40df-`

## Surfaces changed within 2.5 s (12)
- **project.summary(read-model)**
  - .computed_at: "2026-10-26T18:22:40.242393+00:00" → "2026-10-26T18:22:50.250144+00:00"
- **dashboard.home**
  - .computed_at: "2026-10-26T18:22:40.254662+00:00" → "2026-10-26T18:22:50.254915+00:00"
  - .greeting_date: "2026-10-26T18:22:40.888680+00:00" → "2026-10-26T18:22:50.855404+00:00"
  - .projects[]: 2 items, content changed
  - .recent[]: 12 items, content changed
- **report.collections(today)**
  - .error.request_id: "23d1b9f8360c4a7f" → "7b2395f419ff46ff"
  - .request_id: "23d1b9f8360c4a7f" → "7b2395f419ff46ff"
- **report.inventory**
  - .realised_rates[]: 2 items, content changed
- **report.sales_leads**
  - .funnel[]: 7 items, content changed
  - .rows[]: 6 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "ee07df4ec40948d4" → "e151dc2524204d06"
  - .request_id: "ee07df4ec40948d4" → "e151dc2524204d06"
- **report.bank_receipts**
  - .rows[]: 5 items, content changed
- **report.activity**
  - .actions[]: 59 items, content changed
  - .rows[]: 458 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjI6MzguMTgyNTgyKzA → "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjI6MzguMjMyODM2KzA
  - .total: 3758 → 3759
- **search(customer name)**
  - .took_ms: 3.0 → 2.7
- **leads.board**
  - .columns[]: 7 items, content changed
- **pdf.statement(len)**
  - .error.request_id: "bded9641ea7c48f9" → "03a99fe27cf04db2"
  - .request_id: "bded9641ea7c48f9" → "03a99fe27cf04db2"

## Changed only after caches expired (stale 2.5–9 s) (2)
- dashboard.legacy
- dashboard.widgets

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
- report.outstanding
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`[200, {"id": "2fdc35e5-6dea-4de3-aa0c-a9cdb729c780", "company_id": "61e35c1c-91c6-43c9-a732-2f790d5b57aa", "created_at": "2026-10-10T05:00:00+00:00", "updated_at": "2026-10-26T18:22:57.573633+00:00", "created_by": "b63b8b19-94ac-4c8e-845b-faf8019d7a8e", "is_active": true, "deleted_at": null, "versio`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: changed
- customer360: MISSING
- home: changed
- leads: changed
- notifications: MISSING
- projects: changed
- reports: changed
