/**
 * Load test: signs in many staff and portal users, then drives the staff hot paths (lists, details, dashboard, search), the portal, the
 * public website API and payment posting with autocannon, rotating the signed-in users request by request.
 *
 *   BASE=http://localhost:4700 CONNECTIONS=1000 DURATION=30 LABEL="scale seed" pnpm --filter @kkt/api loadtest
 *
 * Env: BASE (API origin), CONNECTIONS (read scenarios, default 200), WRITE_CONNECTIONS (payment scenarios, default 50), DURATION (s,
 * default 30), LABEL (free text for the run heading), SCENARIOS (regex filter on scenario names), LT_EMAIL / LT_PASSWORD (the admin that
 * discovers the data), LT_STAFF_PASSWORD (password of the generated staff, default the scale seed's), LT_STAFF_LOGINS (staff to sign in,
 * default 60: half scoped to a few projects, half on every project), LT_PORTAL_LOGINS (buyers to sign in, default 200), LT_PORTAL_PASSWORD,
 * LT_PAYMENT_BOOKINGS (bookings the spread payment scenario rotates over, default 2000), LT_COMPANY (company slug the public scenarios
 * send as `x-kkt-company`, default the demo builder's), OUT (markdown file; default docs/PERFORMANCE.md;
 * "-" prints only).
 *
 * Users: the generated staff of the scale seed (`pnpm --filter @kkt/api seed:scale`, docs/SEED.md) are found through GET /users and signed
 * in with LT_STAFF_PASSWORD; the generated buyers are signed in by their phone numbers (the seed's deterministic series). On a demo-only
 * database the runner falls back to the admin and the demo buyer, so the nightly gate still runs. Every staff request picks the next
 * (user, URL) pair, and URLs are only ever ones that user may read (a scoped user's flats, grids and bookings come from its own projects).
 *
 * Each scenario appends one row (p50 / p95 / p97.5 / p99, req/s, non-2xx) to docs/PERFORMANCE.md. p95 is computed from every sampled
 * response (autocannon's histogram object exposes p97.5 but not p95); the other percentiles are autocannon's.
 *
 * The write scenarios post ₹100 FLAT_VALUE/CASH payments, each with a fresh Idempotency-Key: one to the ACTIVE booking with the most cash
 * headroom (serialised by that booking's lock), one spread over up to LT_PAYMENT_BOOKINGS ACTIVE bookings with headroom, posted by the
 * signed-in Accounts users in turn (the company-wide receipt path). The API's per-user write limit (WRITE_RATE_LIMIT_PER_MIN), the per-user
 * read limit (READ_RATE_LIMIT_PER_MIN) and the per-IP public limit (PUBLIC_RATE_LIMIT_PER_MIN) must be raised on the server under test —
 * they are deployment knobs, not business rules; a single load generator looks like a handful of users on one IP — or the scenarios report
 * mostly 429s.
 */
import autocannon, { type RequestData, type Result } from "autocannon";
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seriesPhone } from "../src/seed/scaleData.js";

const BASE = process.env["BASE"] ?? "http://localhost:4000";
const API = `${BASE}/api/v1`;
const CONNECTIONS = Number(process.env["CONNECTIONS"] ?? 200);
const WRITE_CONNECTIONS = Number(process.env["WRITE_CONNECTIONS"] ?? 50);
const DURATION = Number(process.env["DURATION"] ?? 30);
const LABEL = process.env["LABEL"] ?? "";
const FILTER = process.env["SCENARIOS"] ? new RegExp(process.env["SCENARIOS"], "i") : null;
const EMAIL = process.env["LT_EMAIL"] ?? "admin@sgb.in";
const PASSWORD = process.env["LT_PASSWORD"] ?? "Admin@12345";
const STAFF_PASSWORD = process.env["LT_STAFF_PASSWORD"] ?? "Scale@12345";
const STAFF_LOGINS = Number(process.env["LT_STAFF_LOGINS"] ?? 60);
const PORTAL_LOGINS = Number(process.env["LT_PORTAL_LOGINS"] ?? 200);
const PORTAL_PASSWORD = process.env["LT_PORTAL_PASSWORD"] ?? "Welcome@123";
const PAYMENT_BOOKINGS = Number(process.env["LT_PAYMENT_BOOKINGS"] ?? 2000);
/** Company the public scenarios ask for (`x-kkt-company`, as the website sends it once a database serves several companies). */
const PUBLIC_COMPANY = process.env["LT_COMPANY"] ?? "shree-ganesh-builders";
const OUT =
  process.env["OUT"] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "PERFORMANCE.md");
/** Amount of each load-test payment (₹100). */
const PAYMENT_PAISE = 100_00;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** One request of a scenario: path (under /api/v1), the bearer token (none = public) and an optional JSON body. */
interface Req {
  path: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface Scenario {
  name: string;
  method?: "GET" | "POST";
  /** Requests sent round-robin, one per request. */
  requests: Req[];
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

/**
 * Access tokens live ACCESS_TOKEN_MINUTES (15 by default) and a full run lasts longer, so every token issued at the start is re-issued
 * before a scenario once it is TOKEN_REFRESH_MS old: requests keep naming the original token and are sent with the current one.
 */
const TOKEN_REFRESH_MS = 8 * 60_000;
const liveToken = new Map<string, string>();
const relogin = new Map<string, () => Promise<string>>();
function current(token: string): string {
  return liveToken.get(token) ?? token;
}
async function refreshTokens(): Promise<void> {
  await inBatches([...relogin.entries()], 8, async ([original, login]) => {
    liveToken.set(original, await login());
    return true;
  });
}

function requestData(s: Scenario, r: Req): RequestData {
  return {
    method: s.method ?? "GET",
    path: `/api/v1${r.path}`,
    headers: {
      "content-type": "application/json",
      ...(r.token ? { authorization: `Bearer ${current(r.token)}` } : {}),
      ...(s.headers ?? {}),
      ...(r.headers ?? {}),
      ...(s.uniqueIdempotencyKey ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}),
  };
}

async function run(s: Scenario): Promise<ScenarioResult> {
  let next = 0;
  const latencies: number[] = [];
  const okLatencies: number[] = [];
  const status: Record<string, number> = {};
  const first = s.requests[0]!;
  const instance = autocannon({
    url: BASE,
    connections: s.connections ?? CONNECTIONS,
    duration: DURATION,
    timeout: 30,
    title: s.name,
    requests: [
      {
        ...requestData(s, first),
        setupRequest: (req: RequestData): RequestData => ({
          ...req,
          ...requestData(s, s.requests[next++ % s.requests.length]!),
        }),
      },
    ],
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
  const ok = {
    count: okLatencies.length,
    p50: percentile(okLatencies, 50),
    p95: percentile(okLatencies, 95),
    p99: percentile(okLatencies, 99),
  };
  return { scenario: s, result, p95: percentile(latencies, 95), samples: latencies.length, status, ok };
}

/** Status codes that count as success for a scenario: 2xx, plus 304 when the scenario sends If-None-Match. */
function isOk(code: string, s: Scenario): boolean {
  return code.startsWith("2") || (code === "304" && s.headers?.["if-none-match"] !== undefined);
}

function fmtStatus(status: Record<string, number>, s: Scenario): string {
  const bad = Object.entries(status)
    .filter(([code]) => !isOk(code, s))
    .sort(([a], [b]) => a.localeCompare(b));
  return bad.length === 0 ? "" : bad.map(([code, n]) => `${code}×${n}`).join(" ");
}

/** Failed responses: everything that is not a success status, plus socket errors and timeouts. */
function failures(r: ScenarioResult): number {
  const badStatuses = Object.entries(r.status)
    .filter(([code]) => !isOk(code, r.scenario))
    .reduce((n, [, c]) => n + c, 0);
  return badStatuses + r.result.errors + r.result.timeouts;
}

function row(r: ScenarioResult): string {
  const { result, scenario } = r;
  const conns = scenario.connections ?? CONNECTIONS;
  const shed =
    failures(r) > 0 && r.ok.count > 0
      ? `admitted ${r.ok.count} = ${(r.ok.count / result.duration).toFixed(0)} rps @ p50 ${r.ok.p50.toFixed(0)} / p95 ${r.ok.p95.toFixed(0)} / p99 ${r.ok.p99.toFixed(0)} ms`
      : "";
  const detail = [
    fmtStatus(r.status, scenario),
    result.errors ? `err×${result.errors}` : "",
    result.timeouts ? `timeout×${result.timeouts}` : "",
    shed,
  ]
    .filter(Boolean)
    .join("; ");
  return `| ${scenario.name} | ${conns} | ${result.requests.total} | ${failures(r)}${detail ? ` (${detail})` : ""} | ${result.latency.p50} | ${r.p95.toFixed(1)} | ${result.latency.p97_5} | ${result.latency.p99} | ${result.requests.average.toFixed(0)} |`;
}

interface BookingRow {
  id: string;
  booking_number: string;
  status: string;
  project_id?: string;
  summary?: { cash: { agreed_paise: number; paid_paise: number; pending_paise: number } };
}
interface PaymentMode {
  id: string;
  name: string;
  code?: string;
  clears_immediately: boolean;
  requires_instrument: boolean;
}
interface UserRow {
  email: string;
  role_name: string;
  all_projects: boolean;
}
interface Staff {
  email: string;
  role: string;
  scoped: boolean;
  token: string;
  permissions: string[];
  projects: string[];
  blocks: string[];
  bookings: string[];
}

function cashHeadroom(b: BookingRow): number {
  const c = b.summary?.cash;
  return c ? c.agreed_paise - c.paid_paise - c.pending_paise : 0;
}

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
    const ok = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${current(token)}` } })
      .then((r) => r.ok)
      .catch(() => false);
    streak = ok && performance.now() - t0 < SETTLE_MS ? streak + 1 : 0;
    if (streak < 3) {
      if (Date.now() > deadline) {
        console.log("(server did not settle within 120 s; continuing)");
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Runs `fn` over `items` with at most `width` in flight (sign-ins hash passwords; a burst would only measure argon2). */
async function inBatches<T, R>(items: readonly T[], width: number, fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += width) {
    const got = await Promise.all(items.slice(i, i + width).map((x) => fn(x).catch(() => null)));
    for (const g of got) if (g !== null) out.push(g);
  }
  return out;
}

/**
 * A distinct client address per sign-in: login is limited to 10 per minute per client IP (a route rule, not a knob), so the server
 * under test runs with TRUST_PROXY=loopback and the runner passes X-Forwarded-For like the reverse proxy in front of the API does.
 */
let clientCounter = 0;
function clientIp(): Record<string, string> {
  clientCounter += 1;
  return {
    "x-forwarded-for": `10.${(clientCounter >> 16) & 255}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`,
  };
}

async function staffLogin(email: string, password: string): Promise<{ token: string; permissions: string[] }> {
  const r = await json<{ access_token: string; user: { permissions: string[] } }>(`${API}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: clientIp(),
  });
  return { token: r.access_token, permissions: r.user.permissions };
}

/** Signs in a mix of scoped and all-project staff and learns, per user, projects / towers / bookings it may read. */
async function signInStaff(admin: { token: string; permissions: string[] }): Promise<Staff[]> {
  const adminToken = admin.token;
  const auth = { authorization: `Bearer ${adminToken}` };
  const users: UserRow[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await json<{ items: UserRow[] }>(`${API}/users?page_size=200&page=${page}`, { headers: auth });
    users.push(...r.items);
    if (r.items.length < 200) break;
  }
  const generated = users.filter((u) => /\.\d{3}@/.test(u.email) && u.role_name !== "Super Admin");
  const scoped = generated.filter((u) => !u.all_projects).slice(0, Math.ceil(STAFF_LOGINS / 2));
  const wide = generated.filter((u) => u.all_projects).slice(0, STAFF_LOGINS - scoped.length);
  const signedIn = await inBatches([...scoped, ...wide], 8, async (u) => {
    const session = await staffLogin(u.email, STAFF_PASSWORD);
    relogin.set(session.token, async () => (await staffLogin(u.email, STAFF_PASSWORD)).token);
    return { email: u.email, role: u.role_name, scoped: !u.all_projects, ...session };
  });
  const pool =
    signedIn.length > 0
      ? signedIn
      : [{ email: EMAIL, role: "Super Admin", scoped: false, token: adminToken, permissions: admin.permissions }];
  return inBatches(pool, 8, async (u) => {
    const h = { authorization: `Bearer ${u.token}` };
    const can = (permission: string) => u.permissions.includes(permission);
    const projects = can("project.read")
      ? (await json<{ items: { id: string }[] }>(`${API}/projects?page_size=50`, { headers: h })).items.map((p) => p.id)
      : [];
    const blocks = projects.length
      ? (
          await json<{ items: { id: string }[] }>(`${API}/blocks?project_id=${projects[0]}&page_size=10`, {
            headers: h,
          })
        ).items.map((b) => b.id)
      : [];
    const bookings = can("booking.read")
      ? (await json<{ items: { id: string }[] }>(`${API}/bookings?page_size=25`, { headers: h })).items.map((b) => b.id)
      : [];
    return { ...u, projects, blocks, bookings };
  });
}

/** Signs in generated buyers (the scale seed's phone series) or, on a demo database, the demo buyer; returns token + a booking id. */
async function signInBuyers(): Promise<{ token: string; bookingId: string }[]> {
  const login = async (phone: string) => {
    const r = await json<{ access_token: string }>(`${API}/portal/auth/login`, {
      method: "POST",
      body: JSON.stringify({ phone, password: PORTAL_PASSWORD }),
      headers: clientIp(),
    });
    relogin.set(r.access_token, async () => {
      const again = await json<{ access_token: string }>(`${API}/portal/auth/login`, {
        method: "POST",
        body: JSON.stringify({ phone, password: PORTAL_PASSWORD }),
        headers: clientIp(),
      });
      return again.access_token;
    });
    const mine = await json<{ booking_id: string }[]>(`${API}/portal/bookings`, {
      headers: { authorization: `Bearer ${r.access_token}` },
    });
    return mine[0] ? { token: r.access_token, bookingId: mine[0].booking_id } : null;
  };
  // the scale seed books its first customers of each company first: indexes 0… are buyers
  const phones = Array.from({ length: PORTAL_LOGINS }, (_, i) => seriesPhone("customer", i * 37));
  const buyers = await inBatches(phones, 8, login);
  if (buyers.length > 0) return buyers;
  const demo = await login("9876543210").catch(() => null);
  return demo ? [demo] : [];
}

async function main(): Promise<void> {
  const admin = await staffLogin(EMAIL, PASSWORD);
  const adminToken = admin.token;
  relogin.set(adminToken, async () => (await staffLogin(EMAIL, PASSWORD)).token);
  const auth = { authorization: `Bearer ${adminToken}` };
  console.log("signing in staff and buyers …");
  const staff = await signInStaff(admin);
  const buyers = await signInBuyers();
  const scopedCount = staff.filter((s) => s.scoped).length;
  console.log(`${staff.length} staff (${scopedCount} scoped), ${buyers.length} buyers signed in`);

  const pub = { "x-kkt-company": PUBLIC_COMPANY };
  const publicProjects = await json<{ items?: { slug: string }[] } | { slug: string }[]>(`${API}/public/projects`, {
    headers: pub,
  });
  const slugs = (Array.isArray(publicProjects) ? publicProjects : (publicProjects.items ?? [])).map((p) => p.slug);
  const bookingsEtag = (await fetch(`${API}/bookings?page_size=25`, { headers: auth })).headers.get("etag");

  // write targets: ACTIVE bookings with cash headroom, a mode that clears immediately without an instrument (Cash), Accounts users
  const active: BookingRow[] = [];
  for (let page = 1; page <= Math.ceil(PAYMENT_BOOKINGS / 200) + 1 && active.length < PAYMENT_BOOKINGS * 2; page++) {
    const r = await json<{ items: BookingRow[] }>(
      `${API}/bookings?status=ACTIVE&page_size=200&page=${page}&view=full`,
      {
        headers: auth,
      },
    );
    active.push(...r.items);
    if (r.items.length < 200) break;
  }
  const withRoom = active
    .filter((b) => cashHeadroom(b) >= 1000 * PAYMENT_PAISE)
    .sort((a, b) => cashHeadroom(b) - cashHeadroom(a));
  const target = withRoom[0] ?? null;
  const spread = withRoom.slice(0, PAYMENT_BOOKINGS);
  const modes = await json<{ items: PaymentMode[] }>(`${API}/masters/payment-modes?page_size=100`, { headers: auth });
  const mode = modes.items.find((m) => m.clears_immediately && !m.requires_instrument) ?? modes.items[0];
  const payers = staff.filter((s) => s.role === "Accounts" && !s.scoped).map((s) => s.token);
  const payTokens = payers.length > 0 ? payers : [adminToken];
  const paymentBody = (bookingId: string, modeId: string) => ({
    booking_id: bookingId,
    against: "FLAT_VALUE",
    bucket: "CASH",
    amount_paise: PAYMENT_PAISE,
    payment_date: todayIst(),
    payment_mode_id: modeId,
    remarks: "load test",
  });

  /** (user, path) pairs over every signed-in user holding `permission`, each path built from what that user may read. */
  const perStaff = (permission: string, paths: (s: Staff) => string[]): Req[] =>
    staff
      .filter((s) => s.permissions.includes(permission))
      .flatMap((s) => paths(s).map((path) => ({ path, token: s.token })));
  const searches = ["kumar", "sinha", "verma", "singh", "gupta", "prasad", "sharma", "yadav"];
  const scenarios: Scenario[] = [
    { name: "GET /auth/me", requests: perStaff("dashboard.view", () => ["/auth/me"]) },
    { name: "GET /projects", requests: perStaff("project.read", () => ["/projects?page_size=25"]) },
    {
      name: "GET /flats (list, filtered)",
      requests: perStaff("project.read", (s) =>
        s.projects.slice(0, 5).map((p) => `/flats?project_id=${p}&page_size=50`),
      ),
    },
    {
      name: "GET /blocks/:id/grid",
      requests: perStaff("project.read", (s) => s.blocks.slice(0, 5).map((b) => `/blocks/${b}/grid`)),
    },
    {
      name: "GET /customers (search)",
      requests: perStaff("customer.read", (s) =>
        searches.slice(0, 3).map((q, i) => `/customers?search=${searches[(i + s.email.length) % 8] ?? q}&page_size=25`),
      ),
    },
    { name: "GET /bookings (list)", requests: perStaff("booking.read", () => ["/bookings?page_size=25"]) },
    ...(bookingsEtag
      ? [
          {
            name: "GET /bookings (list, If-None-Match → 304)",
            requests: [{ path: "/bookings?page_size=25", token: adminToken }],
            headers: { "if-none-match": bookingsEtag },
          },
        ]
      : []),
    {
      name: "GET /bookings/:id",
      requests: perStaff("booking.read", (s) => s.bookings.slice(0, 10).map((b) => `/bookings/${b}`)),
    },
    {
      name: "GET /bookings/:id/ledger",
      requests: perStaff("booking.read", (s) => s.bookings.slice(0, 10).map((b) => `/bookings/${b}/ledger`)),
    },
    { name: "GET /payments (list)", requests: perStaff("payment.post", () => ["/payments?page_size=25"]) },
    { name: "GET /leads (list)", requests: perStaff("lead.read", () => ["/leads?page_size=25"]) },
    {
      name: "GET /service-requests (list)",
      requests: perStaff("service.read", () => ["/service-requests?page_size=25"]),
    },
    { name: "GET /dashboard", requests: perStaff("dashboard.view", () => ["/dashboard"]) },
    {
      name: "GET /search?q=",
      requests: perStaff("project.read", (s) => [`/search?q=${["T01", "BK-", "A-1", "Kumar"][s.email.length % 4]}`]),
    },
    ...(buyers.length > 0
      ? [
          {
            name: "GET /portal/bookings (buyer)",
            requests: buyers.map((b) => ({ path: "/portal/bookings", token: b.token })),
          },
          {
            name: "GET /portal/bookings/:id/home (buyer)",
            requests: buyers.map((b) => ({ path: `/portal/bookings/${b.bookingId}/home`, token: b.token })),
          },
          {
            name: "GET /portal/bookings/:id/ledger (buyer)",
            requests: buyers.map((b) => ({ path: `/portal/bookings/${b.bookingId}/ledger`, token: b.token })),
          },
        ]
      : []),
    { name: "GET /public/site (no auth, cached)", requests: [{ path: "/public/site", headers: pub }] },
    { name: "GET /public/projects (no auth, cached)", requests: [{ path: "/public/projects", headers: pub }] },
    ...(slugs.length > 0
      ? [
          {
            name: `GET /public/projects/:slug (no auth, cached, ${slugs.length} projects)`,
            requests: slugs.map((slug) => ({ path: `/public/projects/${slug}`, headers: pub })),
          },
        ]
      : []),
    ...(target && mode
      ? [
          {
            name: `POST /payments (₹100, one booking, ${WRITE_CONNECTIONS} conns)`,
            method: "POST" as const,
            connections: WRITE_CONNECTIONS,
            uniqueIdempotencyKey: true,
            requests: [{ path: "/payments", token: payTokens[0], body: paymentBody(target.id, mode.id) }],
          },
        ]
      : []),
    // the same write spread over many bookings by several Accounts users: payments of ONE booking serialise on its lock, so only this
    // scenario shows the company-wide receipt-number path (audit v3 C)
    ...(mode && spread.length > 1
      ? [
          {
            name: `POST /payments (₹100, spread over ${spread.length} bookings, ${payTokens.length} users, ${WRITE_CONNECTIONS} conns)`,
            method: "POST" as const,
            connections: WRITE_CONNECTIONS,
            uniqueIdempotencyKey: true,
            requests: spread.map((b, i) => ({
              path: "/payments",
              token: payTokens[i % payTokens.length],
              body: paymentBody(b.id, mode.id),
            })),
          },
        ]
      : []),
  ].filter((s) => s.requests.length > 0 && (!FILTER || FILTER.test(s.name)));

  const results: ScenarioResult[] = [];
  let signedAt = Date.now();
  for (const s of scenarios) {
    if (Date.now() - signedAt > TOKEN_REFRESH_MS) {
      await refreshTokens();
      signedAt = Date.now();
    }
    await settle(adminToken);
    process.stdout.write(`▶ ${s.name} … `);
    const r = await run(s);
    results.push(r);
    console.log(
      `p50 ${r.result.latency.p50} ms · p95 ${r.p95.toFixed(1)} ms · p99 ${r.result.latency.p99} ms · ${r.result.requests.average.toFixed(0)} rps · failed ${failures(r)} ${fmtStatus(r.status, s)}`,
    );
  }
  const users = `${staff.length} staff users (${scopedCount} scoped) and ${buyers.length} buyers rotating`;
  const table = [
    `### Run ${new Date().toISOString()} — ${CONNECTIONS} connections × ${DURATION}s per scenario — ${users}${LABEL ? ` — ${LABEL}` : ""}`,
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
