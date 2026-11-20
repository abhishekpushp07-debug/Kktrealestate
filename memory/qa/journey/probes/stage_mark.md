# Probe `stage_mark` · BK-2627-0022 · 2026-10-26

Action result: `{"block": {"id": "d5ce049b-f5b8-4e03-9642-6e08c92beaf9", "construction_percent": 82, "version": 12}, "marked": [{"stage_id": "9f60aa4e-a8ec-4070-9438-bf23f6d242de", "name": "Flooring", "completed_on": "2026-10-26"}], "demands_raised": 0, "demands": [], "demands_total_paise": 0, "demands_total": 0.0, "audit_id": "33b99aa5-ea77-42b9-80ee-a974699128f5", "stage_name": "Flooring"}`

## Surfaces changed within 2.5 s (16)
- **booking.detail+summary**
  - .block_milestones[]: 11 items, content changed
- **project.workspace**
  - .blocks[]: 3 items, content changed
- **project.summary(read-model)**
  - .blocks[]: 3 items, content changed
  - .computed_at: "2026-10-26T18:22:59.600179+00:00" → "2026-10-26T18:23:10.621570+00:00"
  - .progress_pct: 53.7 → 56.7
  - .units.available: 50 → 51
  - .units.by_status.Available: 50 → 51
  - .units.by_status.Hold: 3 → 2
- **block.summary(read-model)**
  - .computed_at: "2026-10-26T18:22:59.585636+00:00" → "2026-10-26T18:23:10.607228+00:00"
  - .progress.completed: 8 → 9
  - .progress.current_stage: "Finishing" → "Flooring"
  - .progress.percent: 73 → 82
  - .progress.upcoming_stage: "Flooring" → "External Works"
  - .units.available: 11 → 12
  - .units.by_status.Available: 11 → 12
  - .units.by_status.Hold: 1 → null
- **block.detail+grid**
  - .block.construction_percent: 73 → 82
- **dashboard.home**
  - .computed_at: "2026-10-26T18:22:59.604722+00:00" → "2026-10-26T18:23:10.626123+00:00"
  - .greeting_date: "2026-10-26T18:23:09.979239+00:00" → "2026-10-26T18:23:12.929812+00:00"
  - .projects[]: 2 items, content changed
  - .totals.available: 56 → 57
- **dashboard.legacy**
  - .blocks[]: 5 items, content changed
  - .recent_audit[]: 10 items, content changed
- **report.collections(today)**
  - .error.request_id: "b73ce7bf0bf9453f" → "70e424ebba7a4d5f"
  - .request_id: "b73ce7bf0bf9453f" → "70e424ebba7a4d5f"
- **report.demand_vs_collection**
  - .rows[]: 28 items, content changed
- **report.roznamcha_range**
  - .error.request_id: "b59bac346a764ea6" → "d31989edba144cca"
  - .request_id: "b59bac346a764ea6" → "d31989edba144cca"
- **report.bank_receipts**
  - .rows[]: 5 items, content changed
- **report.activity**
  - .actions[]: 59 items, content changed
  - .rows[]: 458 items, content changed
- **report.construction_progress**
  - .rows[]: 46 items, content changed
  - .towers[]: 5 items, content changed
- **audit.recent**
  - .items[]: 3 items, content changed
  - .next_cursor: "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjI6NTkuMTk5ODgwKzA → "WyJjcmVhdGVkX2F0IiwgIjIwMjYtMTAtMjZUMTg6MjM6MDguNTY3Nzk4KzA
  - .total: 3762 → 3763
- **construction.milestones(block)**
  - .block.version: 11 → 12
  - .construction_percent: 73 → 82
  - .milestones[]: 11 items, content changed
  - .next_seq: 9 → 10
  - .stages[]: 11 items, content changed
- **pdf.statement(len)**
  - .error.request_id: "a34c1457f0c444fa" → "c0d769b9c38546b4"
  - .request_id: "a34c1457f0c444fa" → "c0d769b9c38546b4"

## Changed only after caches expired (stale 2.5–9 s) (3)
- dashboard.widgets
- report.sales_leads
- search(customer name)

## Unchanged (28)
- audit.booking
- booking.ledger(account)
- booking.ledger(cash)
- booking.ledger(combined)
- booking.ledger(other)
- booking.schedule/demands
- bootstrap.counts
- cheques.in_hand
- customer.360
- customer.ledgers
- customer.panels(comms/docs)
- customer.timeline
- flat.detail
- inventory.flats(block)
- leads.board
- leads.list
- notifications(staff)
- payments.list+totals
- payments.summary
- report.advances
- report.cancellations
- report.cheques
- report.inventory
- report.outstanding
- report.service_sla
- report.statement
- roznamcha(today)
- service.list

## Restore
`[200, {"block": {"id": "d5ce049b-f5b8-4e03-9642-6e08c92beaf9", "construction_percent": 73, "version": 13}, "demands_voided": 0, "notifications_retracted": {"deleted": 20, "withdrawn": 0}, "audit_id": "d12109fa-0f28-4197-a66a-a887693e9411", "stage_name": "Flooring"}]`

## Expected (registry) vs actual
- _propagated_complete: True
- audit: changed
- blocks: changed
- bootstrap: MISSING
- dashboard: changed
- flats: MISSING
- home: changed
- inventory: changed
- notifications: MISSING
- projects: changed
- reports: changed
