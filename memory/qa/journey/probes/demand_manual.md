# Probe `demand_manual` · BK-2526-0002 · 2026-10-26

Action result: `{"status": 422, "detail": "line_id: Field required; charge_type_id: Extra inputs are not permitted", "code": "VALIDATION_ERROR", "errors": [{"field": "line_id", "message": "Field required"}, {"field": "charge_type_id", "message": "Extra inputs are not permitted"}], "request_id": "0ee05ffbbb244d7e", "error": {"code": "VALIDATION_ERROR", "message": "line_id: Field required; charge_type_id: Extra inp`

## Surfaces changed within 2.5 s (8)
- **dashboard.legacy**
  - .recent_audit[]: 10 items, content changed
- **report.collections(today)**
  - .error.request_id: "9fdeb4b18b374812" → "16d30cf7f31b4f4c"
  - .request_id: "9fdeb4b18b374812" → "16d30cf7f31b4f4c"
- **report.inventory**
  - .realised_rates[]: 2 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "103225f3859c4c92" → "eb74d7d3f36544d0"
  - .request_id: "103225f3859c4c92" → "eb74d7d3f36544d0"
- **report.bank_receipts**
  - .rows[]: 6 items, content changed
- **report.activity**
  - .actions[]: 103 items, content changed
  - .rows[]: 354 items, content changed
- **search(customer name)**
  - .took_ms: 2.7 → 2.6
- **pdf.statement(len)**
  - .error.request_id: "37fdb6be248d4e9f" → "fdb2278255874f34"
  - .request_id: "37fdb6be248d4e9f" → "fdb2278255874f34"

## Changed only after caches expired (stale 2.5–9 s) (2)
- report.demand_vs_collection
- report.sales_leads

## Unchanged (37)
- audit.booking
- audit.recent
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
- dashboard.home
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
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`n/a (no ledger effect or --keep)`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: MISSING
- blocks: MISSING
- bookings: MISSING
- bootstrap: MISSING
- customer360: MISSING
- dashboard: changed
- demands: MISSING
- home: MISSING
- ledgers: MISSING
- notifications: MISSING
- payments: MISSING
- projects: MISSING
- reports: changed
- roznamcha: changed
- widgets: MISSING
