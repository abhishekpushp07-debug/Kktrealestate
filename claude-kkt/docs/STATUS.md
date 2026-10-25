# KKT v2 — Build status and verification evidence

_Last updated at the end of the build session (see git log for commit-level detail)._

## What exists

| Area | Scope delivered | Size |
|---|---|---|
| `apps/api` | Fastify API + BullMQ worker: auth (staff + portal audiences, MFA, rotating refresh families), users/roles, 16 master kinds with CSV import, inventory (projects, blocks, flat generation, grid, flats, parking, rate cards + PLC), CRM (customers, KYC encryption/masking/audited reveal, portal access, leads, enquiries), money (two-bucket ledger, auto-dues with telescoping rounding, bookings, payments, cheques, roznamcha, integrity report/repair), construction (stage jump/undo, photos), documents (signature-validated uploads, variants, signed links), service requests + notices, reports + branded PDFs + role dashboards, website CMS + public API + brochure gate + site-visit scheduler, customer portal API, admin (backup, reseed, recompute, erasure, jobs). **471 endpoints** (396 staff, 35 portal, 40 public). | 24.4k lines |
| `apps/erp` | Staff ERP: every nav route is a real page (dashboards per role, masters, projects/blocks/grid/wizard, customers 360, leads kanban, site visits, 6-step booking wizard, booking detail tabs, payments/receipts/cheques, demands + integrity, roznamcha, construction, service requests, CMS, reports with presets/CSV/PDF, users/roles/audit/settings/sessions/notifications, ⌘K palette). | 45.7k lines (with web) |
| `apps/web` | Next.js website: home, projects, project detail (prices/availability/progress toggles), about, gallery, blog, contact, legal, visit manage page, sitemap/robots, coming-soon gate, enquiry, brochure gate, site-visit booking. | — |
| `apps/portal` | Expo customer app (web + iOS + Android): login/forced change, home, my flat, payments (receipts/ledger/demands/schedule), construction, documents, requests, notices, notifications, profile/sessions; sidebar on desktop, tab bar on phones; cached-first. | 6.8k lines |
| `packages/*` | `contracts` (Zod wire schemas, 60+ enums, 45 permissions, system roles), `domain` (pure engines: money, canonical forms, FY numbering, flat generation, pricing, plan validation, dues, ledger, visits, SLA), `db` (77 tables, migrations, append-only audit trigger, no-delete guards on payments/demands, partial unique invariants). | 18.3k lines |

## Verification evidence (all green at the last commit)

| Check | Result | Where |
|---|---|---|
| Typecheck, all 7 packages | green | `pnpm typecheck` |
| Unit tests | domain 124 · contracts 182 · db 50 · api 24 | `pnpm test` |
| API integration tests | **439 tests / 30 files** (security, conventions, every module, central fixes, seed) | `apps/api/test/integration` |
| Owner acceptance scenarios 1–13 | **55 tests / 13 files**, every assertion cites its SPEC line | `apps/api/test/acceptance`, `docs/ACCEPTANCE.md` |
| Scenario 14 (quality bar) | Browser QA with Playwright at 1440 and 390 px: ERP 543 page audits + 147 flow assertions; website 39 pages + 42 flows; portal 40 screens — zero console errors, zero failed requests, no horizontal overflow, ≥ 44 px targets | `docs/qa/erp.md`, `docs/qa/web.md`, `docs/qa/portal.md` (+ screenshots) |
| Demo seed | Built through the real API; zero integrity findings; the ₹1 Cr worked example reproduces all 10 ledger rows to the paise; Tower C = 52 flats with no 13xx/7xx | `apps/api/src/seed`, `docs/SEED.md` |
| Load test | At 200 connections every list/detail endpoint except the 25-row bookings page meets p95 < 300 ms; at 1,000 zero-think-time connections on the shared 4-vCPU box auth/dashboard/public/search meet it, list endpoints do not (p95 0.5–1.7 s). Before/after tuning tables and the honest assessment are recorded. | `docs/PERFORMANCE.md` |
| 80-factor audit of the previous implementation | 43,130 / 80,000 (53.9 %) | `docs/AUDIT-80-FACTORS.md` |
| 80-factor audit of this implementation | see `docs/AUDIT-80-FACTORS-V2.md` | same 80 factors, same method |

## Known open items (honest list)
* Performance at 1,000 concurrent zero-think-time connections on one 4-vCPU box misses the 300 ms p95 for list endpoints; the design is horizontally scalable (stateless workers, Redis caches, read-replica handle) and real staff load is far lower — see `docs/PERFORMANCE.md`.
* `docs/TODO-integration.md` items 6, 7 and 10 are deferred product decisions (other-charge notification keying, reversal on a COMPLETED booking, ERP gating of the activity report on `audit.view`).
* Open notes from browser QA are listed at the end of each `docs/qa/*.md` (e.g. ISR list pages can be stale for up to 60 s after a CMS toggle; seed placeholders use fake video ids).
* Native iOS/Android builds of the portal were not run here (no simulator); the web export is verified.
* S3 storage adapter is an interface with a local-disk implementation; production object storage needs the adapter filled in (`apps/api/src/lib/storage.ts`).
* Lockout, MFA enrolment and erasure are covered by API tests but were not exercised in the browser walkthroughs.

## Demo logins
Staff: `admin@sgb.in / Admin@12345` (Super Admin), `projects@sgb.in / Project@12345` (Project Admin, SGH only), `accounts@sgb.in / Accounts@12345`, `sales@sgb.in / Sales@12345`, `marketing@sgb.in / Marketing@12345`, `employee@sgb.in / Employee@12345`.
Portal: phone `9876543210` / `Welcome@123` (Rajesh Kumar Sinha — the ₹1 Cr worked example, completed and sold); every seeded customer uses `Welcome@123`.
