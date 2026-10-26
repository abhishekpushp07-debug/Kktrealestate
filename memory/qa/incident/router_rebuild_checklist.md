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
- [ ] customers/crm rename fan-out (verify via effects tests)
- [ ] cms/catalogues granular guards (verify via rbac + guard scan tests)
- [ ] granular guard rewrite audit: 0 legacy 2-part codes left in routers

## Verification gates
- [ ] full suite green on kkt_test (0 skips except env-dependent, each justified)
- [ ] tieout 29/29
- [ ] integrity 0, outbox 0
- [ ] story reseed → headline numbers identical to /app/memory/qa/story/headline_numbers.json
- [ ] effects probe spot-checks
- [ ] Phase R granular: registry 120–160+ codes (now 200 incl. 12 master features), migration equivalence test, Collections Clerk proof, History buttons, audit retention/archive
- [ ] preview untouched until reseed; frontend build; screenshots; PRD/credentials updated

## Could not reproduce exactly
- (fill in at report time)
