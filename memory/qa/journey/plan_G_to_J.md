# Phase F — Plan for Phases G → J (proposal; awaiting orchestrator approval)

Invariants kept throughout: paise storage / ₹ display · three ledgers (cash/account/other) · bucket caps only · 404 scoping · idempotency keys · optimistic versions · immutable audit · `/api` prefix · env-only config.

## Phase G — Canonical propagation (fix the "entry in one place, effect in 20" problem)
**Goal**: one write path per entity, explicit domain events, projections that are always right (or visibly stale), and a per-entry "Effects / Journey" panel that shows exactly where an entry propagated.

G1. **Domain events + outbox** (backend)
- Keep `write_audit` as the single publisher but make the audit row *the* outbox: add `event` (name, version, payload keys, `propagated: {surface: ts}`) to `audit_logs`; writes to audit happen inside the same UoW as the entity write (already true for payments).
- `events.py` becomes a registry: `EVENTS = {"payment.posted": {projections: [...], notify: fn, invalidate: [...]}}`. Every router action maps to exactly one event name (today 40 ad-hoc `audit action` strings → ~32 events).
- **Reconciliation sweep** (`sweep_loop` already exists): replays outbox rows whose `propagated` set is incomplete; metric in `/api/admin/ops` (`outbox_lag`, `unpropagated`).
- Effort: 3 days. Risk: double-processing → every projection handler idempotent (upsert by event id).

G2. **Projections / read models (one per screen family)**
- `project_summary` (+ money: agreement, collected, outstanding, overdue — same definitions as reports), `block_summary`, `customer_summary` (incl. **timeline** of all entity events), `home`, `widgets`, `inventory_counters`, `cheque_register_counts`.
- **Single definition module `services/definitions.py`**: `outstanding(booking)`, `overdue(demand, as_of)`, `collected(filter)` used by reports *and* projections (kills the three-numbers problem). Cancelled bookings excluded everywhere by definition; their demands closed by a one-time migration (`demands.status="Cancelled"` for all cancelled bookings).
- Effort: 4 days. Risk: migration on prod — run as idempotent startup task with a report.

G3. **Fix the P0/P1 effects from the matrix** (each with an effect-assertion test)
- Cancellation refund → `payments` row `against: REFUND` (negative cash-out) + ledger contra + roznamcha line; cancellations report ties to cash. 
- Agreement revision → re-proportion open demands (`cash/account_demand_paise`) from the new split; audit before/after.
- Transfer / stage-sequence change → re-bind `trigger_stage_id` of open demands; block undo while open demands exist on the new block.
- Payment reversal → dated contra line on reversal day in roznamcha; "REVERSED" watermark on receipt PDF.
- Customer rename → fan-out `customer_name` to bookings/payments/ledger (receipts keep "name as printed" + `customer_name_current`).
- Notifications → party-based rules (assignee, RM, Accounts) for booking.create, payment.post/clear, lead.assign, service.status, cancellation; retracted on reversal (already).
- Site visit no-show/cancel → lead stage; lead ↔ booking link (`bookings.lead_id`, `leads.booking_id`, Converted set by the wizard).
- Cache invalidation map generated from the event registry (no more hand-kept prefixes); widgets invalidated.
- Effort: 5 days.

G4. **"Effects / Journey" panel** (frontend + API)
- `GET /api/entries/{audit_id}/effects` → list of surfaces touched (from outbox `propagated` + definitions: ledgers affected, demands changed, notifications sent, read models refreshed, reports impacted) with deep links. Shown from any receipt/booking/lead drawer ("Where did this go?"). Customer 360 timeline rebuilt from events (all entity types).
- Effort: 3 days.

G5. **Effect-assertion tests**: one pytest per event (`tests/effects/test_<event>.py`) using `effects_probe.surfaces()` — asserts the exact set of surfaces that must change and that `tieout` stays green. ≈ 32 tests, 2 days. CI gate: `effects_probe.py all` + `tieout.py` on the story DB.

Order: G2-definitions → G1 outbox → G3 fixes (money first: refund, revision, cancelled demands) → G5 tests → G4 panel. Total ≈ 17 working days.

## Phase H — Story dataset (see `data_story_audit.md` §3)
- `backend/tools/story_seed.py` (API-driven, deterministic, as-of date) replaces `seed*.py` for demo; `volume_seed.py` reuses persona templates. Reset command + preview reseed; `tieout` + `integrity` + `effects_probe all` as acceptance. ≈ 4 days. Risk: receipt numbering/sequence per FY must be deterministic → run under a fixed clock.

## Phase I — Reports, one by one, each with tie-out tests
Order by business value: 1 Outstanding (fixed definitions, ageing, drill) → 2 Receivables forecast (plan snapshots + stage ETA) → 3 Daily cash position (opening/receipts/refunds/closing) → 4 Refund & deduction register → 5 Collection efficiency → 6 Cheque register (all statuses, totals) → 7 Customer statement pack → 8 Bounce register with charges → 9 Funnel with visit/source conversion → 10 Possession readiness → 11 Inventory ageing & realisation → 12 GST/other-charges summary. Each: contract (`columns`, totals, filters, CSV/PDF), tie-out test in `tests/reports/`, drill links, cache + ETag. ≈ 1 day each → 12 days.

## Phase J — Scale & media
- 1 M+ synthetic DB (persona templates × N) on a separate DB; explain/index audit (0 COLLSCAN, no in-memory sorts), cursor paging everywhere (`?cursor=` already supported in `paginate`), per-tenant partial indexes.
- Photo/document pipeline: Emergent object storage via `integration_expert` playbook — chunked uploads, server-side thumbnails (worker thread), signed URLs with expiry, virus-scan hook, metadata in Mongo only; migrate existing base64/GridFS docs.
- Load profile re-run with ≥ 4 uvicorn workers on the deployment target; outbox lag and projection staleness under load as ops metrics; alerting thresholds.
- ≈ 8 days. Risks: storage credentials/limits; migration of legacy documents (dual-read period).

## Risk register
| Risk | Mitigation |
|---|---|
| Definition change alters numbers users already saw | release note + "definitions" help page; tie-out tests pin new definitions |
| Outbox replay double-applies | idempotent projection upserts keyed by event id; replay in leader only |
| Migration of cancelled-booking demands on prod | idempotent startup task with dry-run report and audit rows |
| Story reseed on preview breaks testers' data | reseed only via explicit tool; archive current DB first |
| Scope creep in Phase I | one report per PR, each gated by its tie-out test |
