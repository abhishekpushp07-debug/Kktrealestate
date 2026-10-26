# Probe `customer_edit` · BK-2526-0002 · 2026-10-26

Action result: `{"id": "1c2a0b53-c933-4082-9371-ae5225f5b0f5", "company_id": "502247ec-ff5e-4038-b2b6-f6d48c9aec8e", "created_at": "2026-10-26T00:58:58.084053+00:00", "updated_at": "2026-10-26T10:26:44.147782+00:00", "created_by": "system", "is_active": true, "deleted_at": null, "version": 2, "customer_code": "CUST-2526-0002", "salutation": "Mrs", "full_name": "Priya Verma", "father_or_spouse_name": "Sanjay Verma`

## Surfaces changed within 2.5 s (10)
- **customer.360**
  - .occupation: "Service" → "F-probe occupation"
  - .updated_at: "2026-10-26T00:58:58.084053+00:00" → "2026-10-26T10:26:44.147782+00:00"
  - .version: 1 → 2
- **dashboard.home**
  - .computed_at: "2026-10-26T10:26:25.306422+00:00" → "2026-10-26T10:26:46.164289+00:00"
  - .greeting_date: "2026-10-26T10:26:33.981780+00:00" → "2026-10-26T10:26:46.786254+00:00"
  - .projects[]: 3 items, content changed
  - .recent[]: 12 items, content changed
- **report.collections(today)**
  - .error.request_id: "88debcbb133f4c07" → "2eef69f584c94364"
  - .request_id: "88debcbb133f4c07" → "2eef69f584c94364"
- **report.sales_leads**
  - .bookings_per_user[]: 3 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "8cd5b6ceba5849a5" → "a9cf2b8283d6493a"
  - .request_id: "8cd5b6ceba5849a5" → "a9cf2b8283d6493a"
- **report.bank_receipts**
  - .rows[]: 6 items, content changed
- **report.activity**
  - .actions[]: 103 items, content changed
  - .rows[]: 354 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "470c380b-e243-4259-a672-c874df71d8c8" → "e38b3be1-50a7-4524-9b52-5ef086a768bf"
  - .total: 4900 → 4901
- **search(customer name)**
  - .took_ms: 2.9 → 2.6
- **pdf.statement(len)**
  - .error.request_id: "5d3339103cb149a2" → "65b74ca4d0ab4929"
  - .request_id: "5d3339103cb149a2" → "65b74ca4d0ab4929"

## Changed only after caches expired (stale 2.5–9 s) (2)
- dashboard.legacy
- report.demand_vs_collection

## Unchanged (35)
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
- report.inventory
- report.outstanding
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`[200, {"id": "1c2a0b53-c933-4082-9371-ae5225f5b0f5", "company_id": "502247ec-ff5e-4038-b2b6-f6d48c9aec8e", "created_at": "2026-10-26T00:58:58.084053+00:00", "updated_at": "2026-10-26T10:26:53.455459+00:00", "created_by": "system", "is_active": true, "deleted_at": null, "version": 3, "customer_code":`

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
