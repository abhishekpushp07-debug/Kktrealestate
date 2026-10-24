/** In-process Prometheus counters/histograms (one instance = one series set; aggregation across instances is the scraper's job). */
const BUCKETS = [0.05, 0.1, 0.3, 1, 3] as const;

interface Histogram { buckets: number[]; sum: number; count: number }

const requestsTotal = new Map<string, number>();
const durations = new Map<string, Histogram>();
const startedAt = Date.now();

/** Records one finished HTTP request. */
export function recordRequest(route: string, method: string, status: number, seconds: number): void {
  const key = `${route}\u0000${method}\u0000${status}`;
  requestsTotal.set(key, (requestsTotal.get(key) ?? 0) + 1);
  const hkey = `${route}\u0000${method}`;
  let h = durations.get(hkey);
  if (!h) { h = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }; durations.set(hkey, h); }
  BUCKETS.forEach((b, i) => { if (seconds <= b) h!.buckets[i] = (h!.buckets[i] ?? 0) + 1; });
  h.sum += seconds;
  h.count += 1;
}

function label(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Renders every metric in Prometheus text exposition format. */
export function renderPrometheus(extra: Record<string, number> = {}): string {
  const lines: string[] = [];
  lines.push("# HELP http_requests_total Total HTTP requests by route, method and status.", "# TYPE http_requests_total counter");
  for (const [key, n] of requestsTotal) {
    const [route, method, status] = key.split("\u0000");
    lines.push(`http_requests_total{route="${label(route ?? "")}",method="${method}",status="${status}"} ${n}`);
  }
  lines.push("# HELP http_request_duration_seconds HTTP request duration.", "# TYPE http_request_duration_seconds histogram");
  for (const [key, h] of durations) {
    const [route, method] = key.split("\u0000");
    const base = `route="${label(route ?? "")}",method="${method}"`;
    BUCKETS.forEach((b, i) => lines.push(`http_request_duration_seconds_bucket{${base},le="${b}"} ${h.buckets[i]}`));
    lines.push(`http_request_duration_seconds_bucket{${base},le="+Inf"} ${h.count}`);
    lines.push(`http_request_duration_seconds_sum{${base}} ${h.sum.toFixed(6)}`);
    lines.push(`http_request_duration_seconds_count{${base}} ${h.count}`);
  }
  lines.push("# HELP process_uptime_seconds Seconds since the process started.", "# TYPE process_uptime_seconds gauge", `process_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(0)}`);
  for (const [k, v] of Object.entries(extra)) lines.push(`# TYPE ${k} gauge`, `${k} ${v}`);
  return `${lines.join("\n")}\n`;
}

/** Clears every counter (tests). */
export function resetMetrics(): void {
  requestsTotal.clear();
  durations.clear();
}
