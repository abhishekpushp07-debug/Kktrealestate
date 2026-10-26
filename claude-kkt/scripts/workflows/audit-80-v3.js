export const meta = {
  name: 'kkt-80-factor-audit-v3',
  description: 'Re-score KKT v2 after the hardening round on the same 80 factors (1000 points each) with evidence, then adversarially verify the scores',
  phases: [
    { title: 'Score', detail: '8 independent scorers, 10 factors each, evidence-backed' },
    { title: 'Challenge', detail: 'adversarial reviewer per group re-examines every score' },
  ],
}

const REPO = '/home/user/Kktrealestate/claude-kkt'
const CONTEXT = [
  'You are auditing the NEW KKT v2 codebase at ' + REPO + ' (read-only: do NOT modify files). It is a pnpm/TypeScript monorepo: apps/api (Fastify 5 + Zod, Drizzle/PostgreSQL 16, Redis 7, BullMQ, 471 endpoints across 18 modules), apps/erp (Vite + React 19 + Tailwind 4 staff ERP), apps/web (Next.js 15 marketing site), apps/portal (Expo web + iOS + Android customer app), packages/contracts (Zod wire schemas, enums, permissions), packages/domain (pure business engines), packages/db (schema, migrations, triggers). Start with docs/ARCHITECTURE.md, docs/DATA-MODEL.md, docs/API-CONVENTIONS.md, docs/SECURITY.md, docs/PERFORMANCE.md (measured load tables, before/after, honest assessment), docs/ACCEPTANCE.md (14 owner scenarios → tests), docs/qa/{erp,web,portal}.md (browser QA results), docs/SEED.md, docs/TODO-integration.md (known open items), .github/workflows/ci.yml, then read the code the factor concerns. Recorded verification you may rely on but should spot-check: domain 130 unit tests, contracts 183, db 71 (invariants/triggers/constraints), api unit 133, api integration 600 tests in 48 files, acceptance 55 tests in 13 files, erp 162, web 17, portal 13 (all green at commit time); typecheck green for all 7 packages; pnpm lint 0 errors / 0 warnings with an enforced module-boundary rule; pnpm format:check clean; 482 endpoints; browser QA with axe accessibility scans (0 serious/critical) across ERP, website and portal. A hardening round just closed the previous audit's top findings — docs/hardening/ holds every track report, review and the performance/reliability reports; docs/hardening/STATUS-after-phase5.md summarises it. You MAY run read-only checks: "pnpm --filter @kkt/domain test", "pnpm --filter @kkt/contracts test", "pnpm typecheck", and single API test files with your own database and Redis index: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/kkt_audit3_GROUPKEY TEST_REDIS_URL=redis://localhost:6379/GROUPREDIS KKT_MODULES=<module> pnpm --filter @kkt/api exec vitest run test/integration/<file>.test.ts (create the database first with su postgres -c "psql -c \'CREATE DATABASE kkt_audit3_GROUPKEY\'"). Never run the whole integration suite or start servers.',
  'The business spec the product must meet is docs/SPEC.md; weigh each factor against what a world-class, production-grade system for a large Indian builder would look like (a system that could face 5 lakh = 500,000 concurrent users, sub-300 ms list pages, bank-grade money correctness, zero data leakage). Be exactly as rigorous and skeptical as you would be for any codebase: verify claims in docs against code and tests; cite evidence as file:line; do not award points for things that are not in the code. Judge measured performance only from docs/PERFORMANCE.md (latest sections: Hardening round re-run, Regression fix, Reliability fixes) and say exactly which targets are and are not met on the shared 4-vCPU box.',
  'Scoring rules: each factor is scored 0–1000. 1000 = world-best, nothing to improve; 800–899 = production-grade with minor gaps; 600–799 = works but notable gaps; 400–599 = partial/fragile; <400 = missing or wrong. The same 80 factors were scored twice before (docs/AUDIT-80-FACTORS.md for the original implementation, docs/AUDIT-80-FACTORS-V2.md for this codebase before the hardening round) — do not read either until you have scored; then you may compare and must explicitly check whether each finding listed in the V2 file's 'Top findings' for your group is really fixed in code.',
].join('\n')

const GROUPS = [
  { key: 'A', title: 'Architecture & Backend', factors: [
    'Service architecture & modularity (routers/services/domain separation, coupling, cyclic imports)',
    'Framework choice & async correctness (blocking calls in event loop, sync CPU work like PDF/thumbnail generation inside request handlers)',
    'Transaction integrity / atomicity (does the unit-of-work actually give ACID guarantees on standalone MongoDB? compensation correctness)',
    'Domain logic isolation (pure, testable engines vs logic tangled in routers)',
    'Error handling & error envelope consistency',
    'Configuration & environment management (12-factor, secrets, defaults, startup validation)',
    'Background jobs & scheduling robustness (asyncio loops vs durable queues, multi-worker duplication, retries)',
    'Dependency hygiene (requirements.txt bloat: google-genai, litellm, stripe, pandas, Flask etc. in an ERP; pins; supply-chain)',
    'Code quality: readability, duplication, function size, naming, dead code (milestones.py 410s, migration leftovers)',
    'Type safety & validation (pydantic strictness, Literal use, dict-driven code without models)',
  ]},
  { key: 'B', title: 'Database & Data Handling', factors: [
    'Data model fit: document store vs relational for a financial ledger (joins, constraints, reporting)',
    'Referential integrity & constraints (foreign keys, unique constraints, orphan prevention, usage checks before deactivate)',
    'Indexing strategy & query efficiency (compound indexes vs actual query shapes, regex search without index, count_documents on every page)',
    'Money representation & rounding (integer paise, ROUND_HALF_UP, telescoping to exact 100%, float leakage in API inputs/prices)',
    'Canonical forms / normalisation (phone E.164, PAN uppercase, hashes for dedupe, denormalised copies kept in sync)',
    'Snapshotting & versioning of structural data (flat snapshots, plan snapshots, stage snapshots) and consistency after master edits',
    'Migrations & schema evolution (migrate_phase7, dual-field legacy handling milestone_* vs installment_*)',
    'Soft delete / audit immutability (can audit be edited? are financial records ever deleted? ledger_entries delete_many + insert_many rebuild)',
    'Backup, restore, right-to-erasure',
    'Multi-tenancy readiness (company_id on every query? unique indexes scoped by company? cross-tenant leaks)',
  ]},
  { key: 'C', title: 'Performance & Scale', factors: [
    'Measured latency vs targets (<300 ms lists, <1.5 s ERP pages): use backend/loadtest/out_stats.csv + PRD',
    'Throughput & concurrency model (uvicorn workers, event-loop blocking, per-request DB round trips)',
    'Caching strategy (HTTP caching/ETags, server-side TTL caches, invalidation correctness across workers)',
    'Horizontal scalability / statelessness (in-process caches, in-memory METRICS, per-process role cache → multi-instance inconsistency)',
    'Hot-path efficiency (ledger full rebuild on every payment, N+1 queries, bookings/{id} returning 500 payments, grid computation)',
    'Pagination & large-list handling (offset+cursor, count on each request, page_size up to 1000, CSV 10k cap)',
    'Connection pooling & DB load (motor pool config, rate limit stored in Mongo = write per request)',
    'Readiness for 5 lakh (500,000) concurrent users: gap analysis (what would break first; CDN, read replicas, queues, sharding, stateless auth)',
    'Frontend performance (CRA webpack, bundle sizes in frontend/build & site/build, code splitting, image handling)',
    'Load-testing rigor & performance observability (locust setup, honest reporting, metrics endpoint)',
  ]},
  { key: 'D', title: 'Security & Privacy', factors: [
    'Authentication: JWT handling, refresh rotation & reuse detection, MFA, lockout, password policy/history (read routers/auth.py, deps.py)',
    'Authorization: permission guard coverage on every endpoint (check docs/generated/api_map.md blank-permission rows), project scope → 404 not 403, portal/staff audience separation',
    'Field-level encryption, masking, audited reveal (crypto.py Fernet, pan_hash HMAC, reveal logging)',
    'Input validation & injection safety (regex search escaping, Mongo operator injection via query params, ReDoS, control-char stripping)',
    'Rate limiting & abuse protection (per-IP, honeypot, login limits; cost of Mongo-based limiter)',
    'Secrets & key management (JWT_SECRET/ENCRYPTION_KEY handling, rotation, idempotency middleware decoding JWT without verification)',
    'Audit log completeness & immutability (every mutation? before/after snapshots? can any endpoint edit/delete audit entries?)',
    'Public API allow-listing / leakage (routers/public.py pick lists, internal ids, storage paths, hold/booked indistinguishable)',
    'File upload safety (magic-byte validation filesig.py, size caps, content-type, path traversal, signed URLs)',
    'Security headers, CORS (allow_credentials with "*"?), CSRF, token storage in localStorage, session revocation',
  ]},
  { key: 'E', title: 'Business Logic Correctness', factors: [
    'Flat generation algorithm (skip floors, refuge/podium, numbering patterns, snapshot of rooms/areas, atomic insert, regenerate guard) — services/flat_generation.py, routers/blocks.py',
    'Pricing engine (rate cards, PLC rules: per-sqft/fixed/percent/floor-rise, apply only to Available, breakup lines) — routers/rate_cards.py',
    'Payment plan validation & tower assignment rules (sum=100.00, unique seq, ON_BOOKING ≤1, stage existence on tower, default per tower) — routers/construction.py',
    'Auto-dues engine (idempotency by seq AND name, telescoping rounding, trigger evaluation, catch-up, unique index, concurrency) — services/dues_engine.py',
    'Ledger engine (two buckets, worked ₹1 Cr example reproduced? advances negative, FIFO demand statuses, event ordering by posted_at, running balances) — services/ledger.py, tests/test_ledger_example.py',
    'Bucket cap rule & agreement revision (cap at post AND clear, revision ≥ paid, recompute, AGREEMENT_CHANGE row) — routers/payments.py, routers/bookings.py',
    'Cheque lifecycle, reversal, receipts (pending excluded, bounce never counts, reversal negative row, receipt cancelled not deleted, numbering per FY, Idempotency-Key required)',
    'Construction stage jump/undo rules (jump marks intermediates, undo only latest and only if no payment dated after demand, notification withdrawal) — routers/construction.py',
    'Booking atomic lock, cancellation & handover (guarded_update conditional on status, parking release, flat Sold only via engine, due ≤ 0 checks)',
    'Integrity report & repair (findings a–e from spec, nightly, repair voids/raises, notifications) — services/integrity.py',
  ]},
  { key: 'F', title: 'API Design & Developer Experience', factors: [
    'REST design consistency & naming (resources, verbs, status codes, nested routes, list envelopes)',
    'OpenAPI accuracy & documentation (schemas for responses? dict returns untyped? docs/generated/api_map.md)',
    'Idempotency semantics (middleware per user+key, same key different payload, replay headers, 24 h TTL, unauthenticated owner by IP)',
    'Optimistic concurrency semantics (version on every mutable record? If-Match support, conflict payload tells who changed)',
    'List capabilities: filtering/sorting/search/CSV everywhere, allow-listed sort fields, strict query params',
    'Error codes machine-readability & consistency (code strings, extra payloads, 422 shape)',
    'API versioning & backward compatibility strategy (legacy aliases, 410s, dual fields)',
    'Testing: unit vs integration coverage, independence from live server/seed (tests hit REACT_APP_BACKEND_URL live instance), determinism, coverage of acceptance scenarios',
    'CI/CD, linting, formatting, type-checking (any CI config? eslint/flake8/mypy config in use?)',
    'Developer onboarding (README accuracy, local run without Emergent platform, seeds, env examples)',
  ]},
  { key: 'G', title: 'Features & Depth', factors: [
    'Master data & "everything is a selection" principle (all 15 masters present? usage check, CSV import preview, deactivate/restore) — routers/master.py, routers/imports.py',
    'Inventory grid & block wizard (stacked view, colour modes, drawer, multi-select bulk, print chart, wizard steps) — frontend BlockDetail/UnitGrid/BlockForm',
    'Customer 360, KYC workflow, portal access card (enable/reset/disable/sessions/bulk enable) — routers/customers.py, portal.mgmt, CustomerDetail.jsx',
    'Leads pipeline, round robin, website dedupe, follow-ups widget, kanban, convert → booking — routers/leads.py, Leads.jsx',
    'Booking wizard depth (6 steps, inline customer create, % auto-balance, live schedule preview, drafts/resume, unsaved guard, mobile) — BookingWizard.jsx',
    'Reports, dashboards, PDFs (all listed reports? presets, CSV+PDF, role dashboards, command palette) — routers/reports.py, dashboard_widgets.py, services/pdf.py',
    'Website & CMS & SEO (pages, per-project toggles, publish guards, sitemap/robots, structured data, coming-soon switch) — routers/public.py, routers/cms.py, site/src',
    'Brochure lead gate & site-visit scheduler (signed links, counters, availability algorithm, SLOT_FULL atomicity, .ics IST, manage link, ERP calendar) — routers/visits.py',
    'Customer portal web + mobile (screens listed in spec, ownership checks, PDFs, cached-first UX, sidebar/tab bar) — routers/portal.py, mobile/',
    'Notifications (staff + buyer bells, retraction rule, startup sweep), service requests (SLA, internal notes, reopen 7 d, rating), documents (types, sensitivity, share flag, thumbnails)',
  ]},
  { key: 'H', title: 'UX, Quality & Operations', factors: [
    'Visual design system & theme fidelity (navy/gold tokens, typography, density for ERP, cinematic site, premium portal) — tailwind configs, index.css, design_guidelines.json',
    'Responsiveness at 390 px & accessibility (WCAG AA contrast, focus states, 48 px targets, skip link, aria) — inspect components & memory/qa screenshots list',
    'Form UX: validation messages, unsaved-changes guard, autosave, keyboard, dropdown-first data entry',
    'Empty/loading/error states, console errors, resilience (error boundaries, retry)',
    'Indian localisation: INR grouping and short forms, amount in words, IST dates, FY numbering',
    'Observability: structured logs, request ids, metrics, health/readiness, tracing, alerting hooks',
    'Deployment architecture (3 domains on one backend, static hosting, env docs, Dockerfiles/infra-as-code, platform lock-in to Emergent)',
    'Seed/demo data coherence (every record connected, worked example, integrity zero findings, reseed guard)',
    'Documentation quality & honesty of claims (PRD deviations, generated docs, README) vs reality',
    'Overall production readiness for a real builder today (what would an auditor say before go-live?)',
  ]},
]

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          factor: { type: 'string' },
          score: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
          strengths: { type: 'string' },
          gaps: { type: 'string' },
          world_best_would: { type: 'string' },
        },
        required: ['factor', 'score', 'evidence', 'strengths', 'gaps', 'world_best_would'],
      },
    },
  },
  required: ['group', 'scores'],
}

const CHALLENGE_SCHEMA = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    adjusted: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          factor: { type: 'string' },
          original_score: { type: 'number' },
          final_score: { type: 'number' },
          reason: { type: 'string' },
          extra_evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['factor', 'original_score', 'final_score', 'reason', 'extra_evidence'],
      },
    },
    top_findings: { type: 'array', items: { type: 'string' } },
  },
  required: ['group', 'adjusted', 'top_findings'],
}

const results = await pipeline(
  GROUPS,
  g => agent(`${CONTEXT.split('GROUPKEY').join(g.key).split('GROUPREDIS').join(String(2 + 'ABCDEFGH'.indexOf(g.key)))}
Your group: ${g.key}. ${g.title}. Score these 10 factors (keep the factor text exactly as given, in order):
${g.factors.map((f, i) => `${i + 1}. ${f}`).join('\n')}
Read the relevant source files thoroughly (use Grep/Read/Bash in ${REPO}). For every factor give: score 0–1000, 2–6 evidence citations (file:line or file:function), strengths (1–3 sentences), gaps (specific, 2–5 sentences), and what a world-best implementation would do instead (1–3 sentences). Return ONLY the structured output.`, { label: `score:${g.key}`, phase: 'Score', schema: SCORE_SCHEMA }),
  (scored, g) => agent(`${CONTEXT.split('GROUPKEY').join(g.key).split('GROUPREDIS').join(String(2 + 'ABCDEFGH'.indexOf(g.key)))}
You are an adversarial second auditor for group ${g.key}. ${g.title}. A first auditor produced these scores:
${JSON.stringify(scored, null, 2)}
Your job: try to REFUTE each score. For each factor, independently re-read the cited code and look for things the first auditor missed in both directions (over-generous: features claimed but absent/broken/unsafe; too harsh: mitigations that exist). Verify at least two claims per factor against the actual source. Then set final_score (0–1000) with a one-paragraph reason and any extra evidence. Also list the 5 most important concrete findings for this group (bugs, risks, gaps) that the owner must know, each with a file reference. Return ONLY the structured output.`, { label: `challenge:${g.key}`, phase: 'Challenge', schema: CHALLENGE_SCHEMA, effort: 'high' })
    .then(ch => ({ group: g, scored, challenged: ch }))
)

const out = results.filter(Boolean)
log(`Audited ${out.length}/8 groups`)
return out