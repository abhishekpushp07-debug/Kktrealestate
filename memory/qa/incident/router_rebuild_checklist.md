# Router rebuild checklist (incident: `git checkout -- routers/` reverted 34 routers to 03:57 commit)

Oracle: tests (effects/, rbac, story_headline, hardening, phase tests), tools/story_seed.py, frontend api calls, services/* contracts, route_perms.json.
Rule: commit after every router file / green test group. No `git checkout --`/`restore`/`reset --hard`/`clean` ever again.

## Gap list (routes in route_perms.json / frontend / seeder not exposed by reverted routers)
- [x] bookings: `GET /bookings/{id}/cancellation-preview` (money_ops.cancellation_preview, settings policy)
- [x] bookings: `POST /bookings/{id}/cancel` → money_ops.cancel_booking (void demands, refund, flat release, audit)
- [x] bookings: `POST /bookings/{id}/transfer` (cash-% split, new customer, audit + fan-out)
- [x] bookings: `POST /bookings/{id}/swap` (flat swap, schedule recompute)
- [x] bookings: `GET /bookings/{id}/refunds`
- [x] roznamcha: `GET/POST /roznamcha/opening` (opening cash), `reversals` contra rows, CASH_INSUFFICIENT guard source
- [x] payments: bounce charge via money_ops.raise_bounce_charge, receipt `watermark`, refund pay CASH_INSUFFICIENT
- [x] construction: stage complete/undo return `audit_id` + toast data
- [x] admin: `POST /admin/reseed {mode: story}` (base-only + wipe business + counters reset + ensure_owner), `GET /admin/reseed/status`, `PUT /admin/story-marker` (audited), integrity fresh
- [x] reports/home/widgets: ageing + overdue via services.definitions (canonical bands)
- [x] users/auth: multi-role (`role_ids`), direct grants/denies, `/auth/me` effective permissions, Employee default
- [x] audit router: filters, CSV export, `/audit/entity/{type}/{id}` history, `include_archive` toggle
- [x] visits: public cancel + notes audits; actor fix
- [x] notifications: registry-driven subscriber registered as surface `notifications`
- [x] master factory: kind-specific granular codes (12 master features)
- [x] all routers: `date.today()` → services.clock.today()
- [x] customers/crm rename fan-out (verify via effects tests)
- [x] cms/catalogues granular guards (verify via rbac + guard scan tests)
- [x] granular guard rewrite audit: 0 legacy 2-part codes left in routers

## Verification gates
- [x] full suite green (481 passed, 2→1 justified skip) on kkt_test (0 skips except env-dependent, each justified)
- [x] tieout 29/29
- [x] integrity 0, outbox 0
- [x] story reseed → headline (rehearsed on kkt_test: 10 passed) numbers identical to /app/memory/qa/story/headline_numbers.json
- [ ] effects probe spot-checks
- [x] Phase R granular: registry 120–160+ codes (now 200 incl. 12 master features), migration equivalence test, Collections Clerk proof, History buttons, audit retention/archive
- [x] preview untouched until reseed; frontend build; screenshots; PRD/credentials updated

## Could not reproduce exactly
- Lost router wiring was reconstructed from contracts, not restored byte-for-byte: project-level cancellation_policy model, walk-in lead auto-convert, roznamcha opening/reversals, audit router, admin reseed (base-only = full reseed then business-collection wipe + counter reset), notification subscriber (registry-driven). Behaviour is verified by the same tests/tie-outs; implementation details may differ from the lost versions.
- effects probe spot-checks: see tools/effects_probe.py run in final report.
