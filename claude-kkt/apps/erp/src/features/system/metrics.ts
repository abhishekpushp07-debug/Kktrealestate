/**
 * Prometheus text exposition (GET /api/v1/metrics, admin.tools) → a small summary for the System health page.
 * Pure and tolerant: unknown families are ignored, a missing family reads as null.
 */

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(\S+)/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

/** Every sample line of the exposition (comments and blank lines skipped). */
export function parsePrometheus(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    const value = Number(match[4]);
    if (!Number.isFinite(value) && match[4] !== "+Inf") continue;
    const labels: Record<string, string> = {};
    for (const pair of (match[3] ?? "").matchAll(LABEL))
      labels[pair[1] ?? ""] = (pair[2] ?? "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    samples.push({ name: match[1] ?? "", labels, value: match[4] === "+Inf" ? Number.POSITIVE_INFINITY : value });
  }
  return samples;
}

function sum(
  samples: MetricSample[],
  name: string,
  filter?: (labels: Record<string, string>) => boolean,
): number | null {
  const matching = samples.filter((sample) => sample.name === name && (!filter || filter(sample.labels)));
  return matching.length ? matching.reduce((total, sample) => total + sample.value, 0) : null;
}

/** Quantile (0–1) of a histogram from its cumulative `_bucket` samples summed over every label set, in the bucket's unit. */
export function histogramQuantile(samples: MetricSample[], name: string, quantile: number): number | null {
  const buckets = new Map<number, number>();
  for (const sample of samples) {
    if (sample.name !== `${name}_bucket`) continue;
    const le = sample.labels.le === "+Inf" ? Number.POSITIVE_INFINITY : Number(sample.labels.le);
    if (Number.isNaN(le)) continue;
    buckets.set(le, (buckets.get(le) ?? 0) + sample.value);
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const total = ordered.at(-1)?.[1] ?? 0;
  if (!total) return null;
  const target = total * quantile;
  let previousBound = 0;
  let previousCount = 0;
  for (const [bound, count] of ordered) {
    if (count >= target) {
      if (!Number.isFinite(bound)) return previousBound;
      const inBucket = count - previousCount;
      return inBucket > 0 ? previousBound + ((bound - previousBound) * (target - previousCount)) / inBucket : bound;
    }
    previousBound = bound;
    previousCount = count;
  }
  return previousBound;
}

export interface MetricsSummary {
  requests_total: number | null;
  requests_5xx: number | null;
  requests_in_flight: number | null;
  request_p95_ms: number | null;
  payments_posted: number | null;
  logins_failed: number | null;
  demands_raised: number | null;
  db_up: boolean | null;
  redis_up: boolean | null;
  db_connections: number | null;
  db_max_connections: number | null;
  integrity_findings: number | null;
  job_failures_24h: number | null;
  queue_depth: Record<string, number>;
  event_loop_lag_p99_ms: number | null;
  resident_memory_bytes: number | null;
}

/** The handful of numbers the System health page shows. */
export function summariseMetrics(text: string): MetricsSummary {
  const samples = parsePrometheus(text);
  const flag = (name: string) => {
    const value = sum(samples, name);
    return value === null ? null : value >= 1;
  };
  const p95 = histogramQuantile(samples, "http_request_duration_seconds", 0.95);
  const lag = sum(samples, "nodejs_eventloop_lag_p99_seconds");
  const queue: Record<string, number> = {};
  for (const sample of samples) {
    if (sample.name !== "kkt_jobs_queue_depth") continue;
    const state = sample.labels.state ?? "unknown";
    queue[state] = (queue[state] ?? 0) + sample.value;
  }
  return {
    requests_total: sum(samples, "http_requests_total"),
    requests_5xx:
      sum(samples, "http_requests_total", (labels) => (labels.status ?? labels.status_code ?? "").startsWith("5")) ??
      (sum(samples, "http_requests_total") === null ? null : 0),
    requests_in_flight: sum(samples, "http_requests_in_flight"),
    request_p95_ms: p95 === null ? null : Math.round(p95 * 1000),
    payments_posted: sum(samples, "payments_posted_total"),
    logins_failed: sum(samples, "logins_failed_total"),
    demands_raised: sum(samples, "demands_raised_total"),
    db_up: flag("kkt_db_up"),
    redis_up: flag("kkt_redis_up"),
    db_connections: sum(samples, "kkt_db_connections"),
    db_max_connections: sum(samples, "kkt_db_max_connections"),
    integrity_findings: sum(samples, "kkt_integrity_findings"),
    job_failures_24h: sum(samples, "kkt_job_failures_24h"),
    queue_depth: queue,
    event_loop_lag_p99_ms: lag === null ? null : Math.round(lag * 10000) / 10,
    resident_memory_bytes: sum(samples, "process_resident_memory_bytes"),
  };
}
