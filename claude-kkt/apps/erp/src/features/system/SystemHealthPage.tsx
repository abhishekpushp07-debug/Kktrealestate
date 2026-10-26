import { Activity, Clock, Cpu, Database, DatabaseBackup, Gauge, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { JOB_NAME_LABELS, type JobName } from "@kkt/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  KeyValueList,
  PageHeader,
  Skeleton,
  StatCard,
  StatusChip,
} from "@/components/ui";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useMetricsSummary, useSystemFacts } from "./api";

/** 1 536 000 → "1.5 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function count(value: number | null): string {
  return value === null ? "—" : formatNumber(value);
}

function Up({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-ink-subtle">—</span>;
  return <StatusChip status={value ? "OK" : "FAILED"} label={value ? "Up" : "Down"} size="sm" />;
}

/** `/admin/system` — versions, database and Redis facts, job health and a summary of the Prometheus metrics. */
export default function SystemHealthPage() {
  const facts = useSystemFacts();
  const metrics = useMetricsSummary();
  const m = metrics.data;
  const largest = facts.data
    ? Object.entries(facts.data.database.table_rows_estimated)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : [];

  return (
    <>
      <PageHeader
        title="System health"
        description="Live facts from GET /admin/system and the API's Prometheus metrics (this process). Refreshes every 30 seconds."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Admin" }, { label: "System health" }]}
        actions={
          <>
            <Button variant="outline" leftIcon={Clock} asChild>
              <Link to="/admin/jobs">Jobs</Link>
            </Button>
            <Button variant="outline" leftIcon={DatabaseBackup} asChild>
              <Link to="/admin/backups">Backups</Link>
            </Button>
          </>
        }
      />

      {facts.isError && (
        <ErrorState
          error={facts.error}
          onRetry={() => void facts.refetch()}
          className="mb-4 rounded-lg border border-border bg-card"
        />
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="system-stats">
        <StatCard
          label="API version"
          icon={Server}
          loading={facts.isPending}
          value={facts.data?.app_version ?? "—"}
          hint={facts.data ? `up ${uptime(facts.data.uptime_seconds)}` : undefined}
        />
        <StatCard
          label="Database"
          icon={Database}
          loading={facts.isPending}
          value={facts.data?.database.size_pretty ?? "—"}
          hint={facts.data ? `${formatNumber(facts.data.database.table_count)} tables` : undefined}
        />
        <StatCard
          label="API requests"
          icon={Activity}
          loading={metrics.isPending}
          value={m ? count(m.requests_total) : "—"}
          hint={
            m
              ? `${count(m.requests_5xx)} server errors · p95 ${m.request_p95_ms === null ? "—" : `${m.request_p95_ms} ms`}`
              : undefined
          }
        />
        <StatCard
          label="Job failures (24 h)"
          icon={Gauge}
          loading={facts.isPending}
          value={facts.data ? formatNumber(facts.data.jobs.failed_last_24h) : "—"}
          hint={facts.data ? `${formatNumber(facts.data.jobs.runs_last_24h)} runs` : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="size-4 text-ink-subtle" aria-hidden="true" /> Versions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {facts.isPending ? (
              <Skeleton className="h-32" />
            ) : facts.data ? (
              <KeyValueList
                columns={1}
                items={[
                  { label: "API", value: facts.data.app_version },
                  { label: "Node.js", value: facts.data.node_version },
                  { label: "PostgreSQL", value: facts.data.postgres_version?.split(" on ")[0] ?? "—" },
                  { label: "Redis", value: facts.data.redis_version ?? "—" },
                  {
                    label: "Started",
                    value: `${formatDateTime(facts.data.started_at)} (${formatRelative(facts.data.started_at)})`,
                  },
                  {
                    label: "Modules",
                    value: (
                      <span className="flex flex-wrap gap-1">
                        {facts.data.modules.map((name) => (
                          <Badge key={name} variant="outline">
                            {name}
                          </Badge>
                        ))}
                      </span>
                    ),
                  },
                ]}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="metrics-summary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4 text-ink-subtle" aria-hidden="true" /> Metrics summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.isPending && <Skeleton className="h-40" />}
            {metrics.isError && <ErrorState compact error={metrics.error} onRetry={() => void metrics.refetch()} />}
            {m && (
              <KeyValueList
                columns={2}
                items={[
                  { label: "Database", value: <Up value={m.db_up} /> },
                  { label: "Redis", value: <Up value={m.redis_up} /> },
                  {
                    label: "DB connections",
                    value:
                      m.db_connections === null
                        ? "—"
                        : `${formatNumber(m.db_connections)} of ${count(m.db_max_connections)}`,
                    numeric: true,
                  },
                  { label: "Requests in flight", value: count(m.requests_in_flight), numeric: true },
                  {
                    label: "Request p95",
                    value: m.request_p95_ms === null ? "—" : `${m.request_p95_ms} ms`,
                    numeric: true,
                  },
                  {
                    label: "Event-loop lag p99",
                    value: m.event_loop_lag_p99_ms === null ? "—" : `${m.event_loop_lag_p99_ms} ms`,
                    numeric: true,
                  },
                  { label: "Memory (RSS)", value: formatBytes(m.resident_memory_bytes), numeric: true },
                  { label: "Payments posted", value: count(m.payments_posted), numeric: true },
                  { label: "Failed logins", value: count(m.logins_failed), numeric: true },
                  { label: "Demands raised", value: count(m.demands_raised), numeric: true },
                  { label: "Integrity findings", value: count(m.integrity_findings), numeric: true },
                  {
                    label: "Queue",
                    value: Object.keys(m.queue_depth).length
                      ? Object.entries(m.queue_depth)
                          .map(([state, n]) => `${state} ${formatNumber(n)}`)
                          .join(" · ")
                      : "—",
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4 text-ink-subtle" aria-hidden="true" /> Database & Redis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {facts.isPending ? (
              <Skeleton className="h-40" />
            ) : facts.data ? (
              <>
                <KeyValueList
                  columns={2}
                  items={[
                    { label: "Database", value: facts.data.database.name ?? "—" },
                    {
                      label: "Size",
                      value: facts.data.database.size_pretty ?? formatBytes(facts.data.database.size_bytes),
                      numeric: true,
                    },
                    { label: "Redis memory", value: formatBytes(facts.data.redis.used_memory_bytes), numeric: true },
                    {
                      label: "Redis clients",
                      value:
                        facts.data.redis.connected_clients === null
                          ? "—"
                          : formatNumber(facts.data.redis.connected_clients),
                      numeric: true,
                    },
                  ]}
                />
                <p className="label-caps mb-1 mt-4">Largest tables (estimated rows)</p>
                <ul className="divide-y divide-border text-sm" data-testid="system-tables">
                  {largest.map(([name, rows]) => (
                    <li key={name} className="flex justify-between gap-2 py-1">
                      <span className="font-mono text-xs">{name}</span>
                      <span className="money text-xs">{formatNumber(rows)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            actions={
              <Button size="sm" variant="link" asChild>
                <Link to="/admin/jobs">All jobs</Link>
              </Button>
            }
          >
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-ink-subtle" aria-hidden="true" /> Latest job runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {facts.isPending ? (
              <Skeleton className="h-40" />
            ) : facts.data && facts.data.jobs.last_runs.length > 0 ? (
              <ul className="divide-y divide-border text-sm">
                {facts.data.jobs.last_runs.slice(0, 10).map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0">
                      <span className="font-medium">{JOB_NAME_LABELS[run.job_name as JobName] ?? run.job_name}</span>
                      {run.error && <span className="block break-words text-xs text-danger-fg">{run.error}</span>}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <StatusChip status={run.status} size="sm" />
                      <span className="text-xs text-ink-subtle">{formatRelative(run.started_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-subtle">No job has run yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
