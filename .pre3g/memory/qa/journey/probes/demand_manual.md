# Probe `demand_manual` · BK-2627-0022 · 2026-10-26

Action result: `{"skipped": "no un-demanded manual other-charge line on this booking (and there is no demand void API to restore one)"}`

## Surfaces changed within 2.5 s (10)
- **project.summary(read-model)**
  - .computed_at: "2026-10-26T18:23:21.926471+00:00" → "2026-10-26T18:23:32.883640+00:00"
- **block.summary(read-model)**
  - .computed_at: "2026-10-26T18:23:21.911930+00:00" → "2026-10-26T18:23:32.869506+00:00"
- **report.collections(today)**
  - .error.request_id: "59fff18ef4a7428e" → "0afdcfeec5144453"
  - .request_id: "59fff18ef4a7428e" → "0afdcfeec5144453"
- **report.inventory**
  - .realised_rates[]: 2 items, content changed
- **report.sales_leads**
  - .bookings_per_user[]: 2 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "01784555eb184a97" → "7e94201d8acd464f"
  - .request_id: "01784555eb184a97" → "7e94201d8acd464f"
- **report.bank_receipts**
  - .rows[]: 5 items, content changed
- **report.activity**
  - .actions[]: 59 items, content changed
  - .rows[]: 458 items, content changed
- **search(customer name)**
  - .took_ms: 2.6 → 2.7
- **pdf.statement(len)**
  - .error.request_id: "b03c147c29e74c7d" → "3b9426d2cd684af8"
  - .request_id: "b03c147c29e74c7d" → "3b9426d2cd684af8"

## Changed only after caches expired (stale 2.5–9 s) (1)
- report.demand_vs_collection

## Unchanged (36)
- audit.booking
- audit.recent
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
- dashboard.home
- dashboard.legacy
- dashboard.widgets
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
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`n/a (no ledger effect or --keep)`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: MISSING
- blocks: changed
- bookings: MISSING
- bootstrap: MISSING
- customer360: MISSING
- dashboard: MISSING
- demands: MISSING
- home: MISSING
- ledgers: MISSING
- notifications: MISSING
- payments: MISSING
- projects: changed
- reports: changed
- roznamcha: changed
- widgets: MISSING
