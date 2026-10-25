/**
 * Load test: logs in once, then hammers the hot read paths and the payment hot path with autocannon.
 *
 *   BASE=http://localhost:4300 CONNECTIONS=1000 DURATION=30 LABEL="after tuning" pnpm --filter @kkt/api loadtest
 *
 * Env: BASE (API origin), CONNECTIONS (read scenarios, default 200), WRITE_CONNECTIONS (payment scenario, default 50), DURATION (s, default 30),
 * LABEL (free text for the run heading), SCENARIOS (regex filter on scenario names), LT_EMAIL / LT_PASSWORD (staff login), OUT (markdown file;
 * default docs/PERFORMANCE.md; "-" prints only).
 *
 * Each scenario appends one row (p50 / p95 / p97.5 / p99, req/s, non-2xx) to docs/PERFORMANCE.md. p95 is computed from every sampled
 * response (autocannon's histogram object exposes p97.5 but not p95); the other percentiles are autocannon's.
 *
 * The write scenario posts ₹100 FLAT_VALUE/CASH payments to the ACTIVE booking with the most cash headroom, each with a fresh
 * Idempotency-Key. The API's per-user write limit (WRITE_RATE_LIMIT_PER_MIN, default 120/min) and the per-IP public limit
 * (PUBLIC_RATE_LIMIT_PER_MIN, default 300/min) must be raised on the server under test — they are deployment knobs, not business rules;
 * a single load generator looks like one user on one IP — or those scenarios report mostly 429s.
 */
import autocannon, { type RequestData, type Result } from "autocannon";
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env["BASE"] ?? "http://localhost:4000";
const API = `${BASE}/api/v1`;
const CONNECTIONS = Number(process.env["CONNECTIONS"] ?? 200);
const WRITE_CONNECTIONS = Number(process.env["WRITE_CONNECTIONS"] ?? 50);
const DURATION = Number(process.env["DURATION"] ?? 30);
const LABEL = process.env["LABEL"] ?? "";
const FILTER = process.env["SCENARIOS"] ? new RegExp(process.env["SCENARIOS"], "i") : null;
const EMAIL = process.env["LT_EMAIL"] ?? "admin@sgb.in";
const PASSWORD = process.env["LT_PASSWORD"] ?? "Admin@12345";
const OUT = process.env["OUT"] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "PERFORMANCE.md");
/** Amount of each load-test payment (₹100). */
const PAYMENT_PAISE = 100_00;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

interface Scenario {
  name: string;
  path: string;
  method?: "GET" | "POST";
  /** JSON body for POST scenarios. */
  body?: unknown;
  headers?: Record<string, string>;
  connections?: number;
  /** Fresh Idempotency-Key on every request (payments). */
  uniqueIdempotencyKey?: boolean;
}

interface ScenarioResult {
  scenario: Scenario;
  result: Result;
  p95: number;
  samples: number;
  status: Record<string, number>;
  /** Admitted (successful) responses only — meaningful when load shedding or rate limiting answered part of the traffic. */
  ok: { count: number; p50: number; p95: number; p99: number };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

async function run(s: Scenario, token: string): Promise<ScenarioResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json", ...(s.headers ?? {}) };
  const body = s.body !== undefined ? JSON.stringify(s.body) : undefined;
  const base: RequestData = { method: s.method ?? "GET", path: `/api/v1${s.path}`, headers, ...(body !== undefined ? { body } : {}) };
  const latencies: number[] = [];
  const okLatencies: number[] = [];
  const status: Record<string, number> = {};
  const instance = autocannon({
    url: BASE,
    connections: s.connections ?? CONNECTIONS,
    duration: DURATION,
    timeout: 30,
    title: s.name,
    requests: [{
      ...base,
      ...(s.uniqueIdempotencyKey
        ? { setupRequest: (req: RequestData): RequestData => ({ ...req, headers: { ...(req.headers ?? {}), "idempotency-key": randomUUID() } }) }
        : {}),
    }],
  });
  instance.on("response", (_client, statusCode, _bytes, responseTime) => {
    latencies.push(responseTime);
    const key = String(statusCode);
    status[key] = (status[key] ?? 0) + 1;
    if (isOk(key, s)) okLatencies.push(responseTime);
  });
  const result = await instance;
  latencies.sort((a, b) => a - b);
  okLatencies.sort((a, b) => a - b);
  const ok = { count: okLatencies.length, p50: percentile(okLatencies, 50), p95: percentile(okLatencies, 95), p99: percentile(okLatencies, 99) };
  return { scenario: s, result, p95: percentile(latencies, 95), samples: latencies.length, status, ok };
}

/** Status codes that count as success for a scenario: 2xx, plus 304 when the scenario sends If-None-Match. */
function isOk(code: string, s: Scenario): boolean {
  return code.startsWith("2") || (code === "304" && s.headers?.["if-none-match"] !== undefined);
}

function fmtStatus(status: Record<string, number>, s: Scenario): string {
  const bad = Object.entries(status).filter(([code]) => !isOk(code, s)).sort(([a], [b]) => a.localeCompare(b));
  return bad.length === 0 ? "" : bad.map(([code, n]) => `${code}×${n}`).join(" ");
}

/** Failed responses: everything that is not a success status, plus socket errors and timeouts. */
function failures(r: ScenarioResult): number {
  const badStatuses = Object.entries(r.status).filter(([code]) => !isOk(code, r.scenario)).reduce((n, [, c]) => n + c, 0);
  return badStatuses + r.result.errors + r.result.timeouts;
}

function row(r: ScenarioResult): string {
  const { result, scenario } = r;
  const conns = scenario.connections ?? CONNECTIONS;
  const shed = failures(r) > 0 && r.ok.count > 0 ? `admitted ${r.ok.count} = ${(r.ok.count / result.duration).toFixed(0)} rps @ p50 ${r.ok.p50.toFixed(0)} / p95 ${r.ok.p95.toFixed(0)} / p99 ${r.ok.p99.toFixed(0)} ms` : "";
  const detail = [fmtStatus(r.status, scenario), result.errors ? `err×${result.errors}` : "", result.timeouts ? `timeout×${result.timeouts}` : "", shed].filter(Boolean).join("; ");
  return `| ${scenario.name} | ${conns} | ${result.requests.total} | ${failures(r)}${detail ? ` (${detail})` : ""} | ${result.latency.p50} | ${r.p95.toFixed(1)} | ${result.latency.p97_5} | ${result.latency.p99} | ${result.requests.average.toFixed(0)} |`;
}

interface BookingRow { id: string; booking_number: string; status: string; summary: { cash: { agreed_paise: number; paid_paise: number; pending_paise: number } } }
interface PaymentMode { id: string; name: string; clears_immediately: boolean; requires_instrument: boolean }

/** Picks the ACTIVE booking with the most cash headroom so thousands of ₹100 payments never hit the bucket cap (a business rule, kept). */
function pickPaymentTarget(items: BookingRow[]): { booking: BookingRow; headroomPaise: number } | null {
  let best: { booking: BookingRow; headroomPaise: number } | null = null;
  for (const b of items) {
    if (b.status !== "ACTIVE") continue;
    const headroomPaise = b.summary.cash.agreed_paise - b.summary.cash.paid_paise - b.summary.cash.pending_paise;
    if (!best || headroomPaise > best.headroomPaise) best = { booking: b, headroomPaise };
  }
  return best;
}

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Waits until the server has drained the previous scenario's backlog (a cheap authenticated request answers within SETTLE_MS three
 * times in a row), so each scenario measures itself and not the queue the one before it left behind.
 */
const SETTLE_MS = 50;
async function settle(token: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let streak = 0;
  while (streak < 3) {
    const t0 = performance.now();
    const ok = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.ok).catch(() => false);
    streak = ok && performance.now() - t0 < SETTLE_MS ? streak + 1 : 0;
    if (streak < 3) {
      if (Date.now() > deadline) { console.log("(server did not settle within 120 s; continuing)"); return; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main(): Promise<void> {
  const login = await json<{ access_token: string }>(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const token = login.access_token;
  const auth = { authorization: `Bearer ${token}` };
  const projects = await json<{ items: { id: string; slug?: string | null }[] }>(`${API}/projects?page_size=1`, { headers: auth });
  const projectId = projects.items[0]?.id;
  const blocks = projectId ? await json<{ items: { id: string }[] }>(`${API}/blocks?project_id=${projectId}&page_size=1`, { headers: auth }) : { items: [] };
  const blockId = blocks.items[0]?.id;
  const bookings = await json<{ items: BookingRow[] }>(`${API}/bookings?status=ACTIVE&page_size=100`, { headers: auth });
  const bookingId = bookings.items[0]?.id;
  const publicProjects = await json<{ items?: { slug: string }[] } | { slug: string }[]>(`${API}/public/projects`);
  const publicSlug = (Array.isArray(publicProjects) ? publicProjects[0]?.slug : publicProjects.items?.[0]?.slug) ?? null;
  const bookingsEtag = (await fetch(`${API}/bookings?page_size=25`, { headers: auth })).headers.get("etag");

  // write scenario target: an ACTIVE booking with headroom, and a payment mode that clears immediately without an instrument (UPI/Cash)
  const target = pickPaymentTarget(bookings.items);
  const modes = await json<{ items: PaymentMode[] }>(`${API}/masters/payment-modes?page_size=100`, { headers: auth });
  const mode = modes.items.find((m) => m.clears_immediately && !m.requires_instrument) ?? modes.items[0];
  if (target && mode) {
    const maxPayments = Math.floor(target.headroomPaise / PAYMENT_PAISE);
    console.log(`write target: ${target.booking.booking_number} (cash headroom ₹${(target.headroomPaise / 100).toLocaleString("en-IN")} → room for ${maxPayments} payments of ₹100 via ${mode.name})`);
  } else console.log("write scenario skipped: no ACTIVE booking with cash headroom or no payment mode");

  const scenarios: Scenario[] = [
    { name: "GET /auth/me", path: "/auth/me" },
    { name: "GET /projects", path: "/projects?page_size=25" },
    ...(projectId ? [{ name: "GET /flats (list, filtered)", path: `/flats?project_id=${projectId}&page_size=50` }] : []),
    ...(blockId ? [{ name: "GET /blocks/:id/grid", path: `/blocks/${blockId}/grid` }] : []),
    { name: "GET /customers (search)", path: "/customers?search=kumar&page_size=25" },
    { name: "GET /bookings (list)", path: "/bookings?page_size=25" },
    ...(bookingsEtag ? [{ name: "GET /bookings (list, If-None-Match → 304)", path: "/bookings?page_size=25", headers: { "if-none-match": bookingsEtag } }] : []),
    ...(bookingId ? [{ name: "GET /bookings/:id", path: `/bookings/${bookingId}` }, { name: "GET /bookings/:id/ledger", path: `/bookings/${bookingId}/ledger` }] : []),
    { name: "GET /dashboard", path: "/dashboard" },
    { name: "GET /public/projects (no auth, cached)", path: "/public/projects" },
    ...(publicSlug ? [{ name: "GET /public/projects/:slug (no auth, cached)", path: `/public/projects/${publicSlug}` }] : []),
    { name: "GET /search?q=", path: "/search?q=A-1" },
    ...(target && mode
      ? [{
        name: `POST /payments (₹100, ${WRITE_CONNECTIONS} conns)`,
        path: "/payments",
        method: "POST" as const,
        connections: WRITE_CONNECTIONS,
        uniqueIdempotencyKey: true,
        body: { booking_id: target.booking.id, against: "FLAT_VALUE", bucket: "CASH", amount_paise: PAYMENT_PAISE, payment_date: todayIst(), payment_mode_id: mode.id, remarks: "load test" },
      }]
      : []),
  ].filter((s) => !FILTER || FILTER.test(s.name));

  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    await settle(token);
    process.stdout.write(`▶ ${s.name} … `);
    const r = await run(s, token);
    results.push(r);
    console.log(`p50 ${r.result.latency.p50} ms · p95 ${r.p95.toFixed(1)} ms · p99 ${r.result.latency.p99} ms · ${r.result.requests.average.toFixed(0)} rps · failed ${failures(r)} ${fmtStatus(r.status, s)}`);
  }
  const table = [
    `### Run ${new Date().toISOString()} — ${CONNECTIONS} connections × ${DURATION}s per scenario${LABEL ? ` — ${LABEL}` : ""}`,
    "",
    "| Scenario | Conns | Requests | non-2xx | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |",
    "|---|---|---|---|---|---|---|---|---|",
    ...results.map(row),
    "",
  ].join("\n");
  console.log("\n" + table);
  if (OUT !== "-") {
    await mkdir(dirname(OUT), { recursive: true });
    await appendFile(OUT, "\n" + table);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
