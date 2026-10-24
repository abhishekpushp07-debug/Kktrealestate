/**
 * Load test: logs in once, then hammers the hot read paths and the payment hot path with autocannon.
 * Usage: BASE=http://localhost:4000 CONNECTIONS=1000 DURATION=60 pnpm --filter @kkt/api loadtest
 * Writes a markdown table to docs/PERFORMANCE.md (append) and prints it.
 */
import autocannon, { type Result } from "autocannon";
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:4000";
const API = `${BASE}/api/v1`;
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 200);
const DURATION = Number(process.env.DURATION ?? 30);
const EMAIL = process.env.LT_EMAIL ?? "admin@sgb.in";
const PASSWORD = process.env.LT_PASSWORD ?? "Admin@12345";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

interface Scenario { name: string; path: string; method?: "GET" | "POST"; body?: () => string; headers?: Record<string, string>; connections?: number }

async function run(s: Scenario, token: string): Promise<Result> {
  return autocannon({
    url: `${API}${s.path}`,
    connections: s.connections ?? CONNECTIONS,
    duration: DURATION,
    method: s.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(s.headers ?? {}) },
    ...(s.body ? { setupClient: (client) => { client.setBody(s.body!()); client.setHeaders({ authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID(), ...(s.headers ?? {}) }); } } : {}),
    title: s.name,
  });
}

function row(r: Result): string {
  const non2xx = r.non2xx;
  return `| ${r.title} | ${r.requests.total} | ${non2xx} | ${r.latency.p50} | ${r.latency.p97_5} | ${r.latency.p99} | ${r.requests.average.toFixed(0)} |`;
}

async function main(): Promise<void> {
  const login = await json<{ access_token: string }>(`${API}/auth/login`, { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const token = login.access_token;
  const projects = await json<{ items: { id: string }[] }>(`${API}/projects?page_size=1`, { headers: { authorization: `Bearer ${token}` } });
  const projectId = projects.items[0]?.id;
  const blocks = projectId ? await json<{ items: { id: string }[] }>(`${API}/blocks?project_id=${projectId}&page_size=1`, { headers: { authorization: `Bearer ${token}` } }) : { items: [] };
  const blockId = blocks.items[0]?.id;
  const bookings = await json<{ items: { id: string; status: string }[] }>(`${API}/bookings?status=ACTIVE&page_size=1`, { headers: { authorization: `Bearer ${token}` } });
  const bookingId = bookings.items[0]?.id;
  const scenarios: Scenario[] = [
    { name: "GET /auth/me", path: "/auth/me" },
    { name: "GET /projects", path: "/projects?page_size=25" },
    { name: "GET /flats (list, filtered)", path: `/flats?project_id=${projectId}&page_size=50` },
    ...(blockId ? [{ name: "GET /blocks/:id/grid", path: `/blocks/${blockId}/grid` }] : []),
    { name: "GET /customers (search)", path: "/customers?search=kumar&page_size=25" },
    { name: "GET /bookings (list)", path: "/bookings?page_size=25" },
    ...(bookingId ? [{ name: "GET /bookings/:id", path: `/bookings/${bookingId}` }, { name: "GET /bookings/:id/ledger", path: `/bookings/${bookingId}/ledger` }] : []),
    { name: "GET /dashboard", path: "/dashboard" },
    { name: "GET /public/projects (no auth, cached)", path: "/public/projects" },
    { name: "GET /search?q=", path: "/search?q=A-1" },
  ];
  const results: Result[] = [];
  for (const s of scenarios) {
    process.stdout.write(`▶ ${s.name} … `);
    const r = await run(s, token);
    results.push(r);
    console.log(`p50 ${r.latency.p50} ms · p99 ${r.latency.p99} ms · ${r.requests.average.toFixed(0)} rps · non-2xx ${r.non2xx}`);
  }
  const table = [
    `### Run ${new Date().toISOString()} — ${CONNECTIONS} connections × ${DURATION}s per scenario`,
    "",
    "| Scenario | Requests | non-2xx | p50 ms | p97.5 ms | p99 ms | req/s |",
    "|---|---|---|---|---|---|---|",
    ...results.map(row),
    "",
  ].join("\n");
  console.log("\n" + table);
  await mkdir("../../docs", { recursive: true });
  await appendFile("../../docs/PERFORMANCE.md", "\n" + table);
}

main().catch((e) => { console.error(e); process.exit(1); });
