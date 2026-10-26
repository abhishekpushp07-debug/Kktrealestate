import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Activity, Clock, DatabaseBackup, Play, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { JOB_NAME_LABELS, JOB_NAMES, type AdminJobInfo, type AdminJobRunRow, type JobName } from "@kkt/contracts";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  ErrorState,
  IconButton,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
} from "@/components/ui";
import { describeError, isApiClientError } from "@/lib/api";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { Notice } from "@/features/inventory/components";
import { toast } from "sonner";
import { JOB_RUNS_PATH, JOBS_PATH, runJobNow, useJobRun, useJobRuns, useJobs } from "./api";

const RUN_STATUSES = ["RUNNING", "OK", "FAILED"] as const;

function jobLabel(name: string): string {
  return JOB_NAME_LABELS[name as JobName] ?? name;
}

function duration(run: Pick<AdminJobRunRow, "started_at" | "finished_at">): string {
  if (!run.finished_at) return "running";
  const ms = Date.parse(run.finished_at) - Date.parse(run.started_at);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}

/** Polls one enqueued run until it finishes (404 = queued, not started yet). */
function RunWatcher({
  runId,
  jobName,
  note,
  onClose,
}: {
  runId: string;
  jobName: string;
  note?: string;
  onClose: () => void;
}) {
  const run = useJobRun(runId);
  const status = run.data?.status ?? (run.isError ? "FAILED" : "QUEUED");
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card"
      data-testid="job-run-watcher"
    >
      <Activity className="mt-0.5 size-4 shrink-0 text-navy-700" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-950">
          {jobLabel(jobName)} <StatusChip status={status} size="sm" />
        </p>
        <p className="text-xs text-ink-subtle">
          {note ? `${note} · ` : ""}Run <span className="font-mono">{runId}</span>
          {run.data
            ? ` · started ${formatDateTime(run.data.started_at)} · ${duration(run.data)}`
            : " · waiting for a worker to pick it up"}
        </p>
        {run.data?.error && <p className="mt-1 break-words text-xs text-danger-fg">{run.data.error}</p>}
        {run.isError && <p className="mt-1 text-xs text-danger-fg">{describeError(run.error)}</p>}
      </div>
      <IconButton icon={X} label="Close" variant="ghost" size="sm" onClick={onClose} />
    </div>
  );
}

/** `/admin/jobs` — scheduled and manual background jobs: health, run now, recent runs with their errors. */
export default function JobsPage() {
  const queryClient = useQueryClient();
  const jobs = useJobs();
  const [watching, setWatching] = useState<{ runId: string; jobName: string; note?: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [filterJob, setFilterJob] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const runs = useJobRuns({ job_name: filterJob, status: filterStatus, page, page_size: pageSize });

  const runNow = useCallback(
    async (job: AdminJobInfo) => {
      setPending(job.name);
      try {
        const queued = await runJobNow(job.name);
        setWatching({ runId: queued.run_id, jobName: queued.job_name });
        toast.success(`${jobLabel(job.name)} queued`);
      } catch (error) {
        if (
          isApiClientError(error) &&
          error.code === "JOB_ALREADY_RUNNING" &&
          typeof error.details?.run_id === "string"
        ) {
          setWatching({ runId: error.details.run_id, jobName: job.name, note: "Already queued or running" });
          toast.info(`${jobLabel(job.name)} is already queued or running`);
        } else {
          toast.error(describeError(error));
        }
      } finally {
        setPending(null);
        void queryClient.invalidateQueries({ queryKey: [JOBS_PATH] });
        void queryClient.invalidateQueries({ queryKey: [JOB_RUNS_PATH] });
      }
    },
    [queryClient],
  );

  const jobColumns = useMemo<ColumnDef<AdminJobInfo, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Job",
        meta: { locked: true, sortKey: false },
        cell: ({ row }) => (
          <span className="block min-w-0 leading-tight">
            <span className="block truncate font-semibold text-navy-950">{jobLabel(row.original.name)}</span>
            <span className="block truncate font-mono text-2xs text-ink-subtle">
              {row.original.name} ·{" "}
              {row.original.cron ? `${row.original.cron}${row.original.schedule_enabled ? "" : " (off)"}` : "on demand"}
            </span>
          </span>
        ),
      },
      {
        id: "last_run",
        header: "Last run",
        meta: { sortKey: false },
        cell: ({ row }) =>
          row.original.last_run ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <StatusChip status={row.original.last_run.status} size="sm" />
              <span className="text-xs text-ink-muted" title={formatDateTime(row.original.last_run.started_at)}>
                {formatRelative(row.original.last_run.started_at)}
              </span>
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">Never</span>
          ),
      },
      {
        id: "last_success",
        header: "Last success",
        meta: { sortKey: false, hideOnMobile: true },
        cell: ({ row }) =>
          row.original.last_success ? (
            <span className="text-xs" title={formatDateTime(row.original.last_success.started_at)}>
              {formatRelative(row.original.last_success.started_at)}
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">—</span>
          ),
      },
      {
        id: "failures",
        header: "Fails 24 h / since OK",
        meta: { sortKey: false, align: "right" },
        cell: ({ row }) => (
          <span
            className={
              row.original.failure_count_24h > 0 || row.original.failures_since_success > 0
                ? "money font-semibold text-danger-fg"
                : "money text-ink-muted"
            }
          >
            {formatNumber(row.original.failure_count_24h)} / {formatNumber(row.original.failures_since_success)}
          </span>
        ),
      },
      {
        id: "next_run",
        header: "Next run",
        meta: { sortKey: false, hideOnMobile: true },
        cell: ({ row }) =>
          row.original.next_run_at ? (
            <span className="text-xs">{formatDateTime(row.original.next_run_at)}</span>
          ) : (
            <span className="text-xs text-ink-subtle">—</span>
          ),
      },
      {
        id: "actions",
        header: "",
        meta: { sortKey: false, align: "right" },
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            leftIcon={Play}
            loading={pending === row.original.name}
            disabled={!row.original.registered || pending !== null}
            title={row.original.registered ? undefined : "No handler is registered in this process"}
            onClick={(event) => {
              event.stopPropagation();
              void runNow(row.original);
            }}
            data-testid={`job-run-${row.original.name}`}
          >
            Run now
          </Button>
        ),
      },
    ],
    [pending, runNow],
  );

  const runColumns = useMemo<ColumnDef<AdminJobRunRow, unknown>[]>(
    () => [
      {
        accessorKey: "started_at",
        header: "Started",
        meta: { sortKey: false, width: 170 },
        cell: ({ row }) => <span className="text-xs">{formatDateTime(row.original.started_at)}</span>,
      },
      {
        accessorKey: "job_name",
        header: "Job",
        meta: { sortKey: false },
        cell: ({ row }) => <span className="font-medium">{jobLabel(row.original.job_name)}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { sortKey: false, width: 110 },
        cell: ({ row }) => <StatusChip status={row.original.status} size="sm" />,
      },
      {
        id: "duration",
        header: "Took",
        meta: { sortKey: false, width: 90, align: "right" },
        cell: ({ row }) => <span className="money text-xs">{duration(row.original)}</span>,
      },
      {
        accessorKey: "error",
        header: "Error / result",
        meta: { sortKey: false },
        cell: ({ row }) =>
          row.original.error ? (
            <span
              className="block max-w-xl whitespace-normal break-words text-xs text-danger-fg"
              data-testid="job-run-error"
            >
              {row.original.error}
            </span>
          ) : row.original.result ? (
            <span
              className="block max-w-xl truncate font-mono text-2xs text-ink-subtle"
              title={JSON.stringify(row.original.result)}
            >
              {JSON.stringify(row.original.result)}
            </span>
          ) : (
            <span className="text-xs text-ink-subtle">—</span>
          ),
      },
    ],
    [],
  );

  const failing = (jobs.data?.jobs ?? []).filter((job) => job.failures_since_success > 0);

  return (
    <>
      <PageHeader
        title="Background jobs"
        description="Scheduled and on-demand jobs run on the worker with three attempts and exponential backoff. A job that fails for good notifies the Super Admins."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Admin" }, { label: "Jobs" }]}
        actions={
          <>
            <Button variant="outline" leftIcon={Activity} asChild>
              <Link to="/admin/system">System health</Link>
            </Button>
            <Button variant="outline" leftIcon={DatabaseBackup} asChild>
              <Link to="/admin/backups">Backups</Link>
            </Button>
          </>
        }
      />
      {watching && (
        <RunWatcher
          runId={watching.runId}
          jobName={watching.jobName}
          note={watching.note}
          onClose={() => setWatching(null)}
        />
      )}
      {failing.length > 0 && (
        <Notice tone="danger" className="mb-4">
          {failing.length === 1 ? "1 job has" : `${failing.length} jobs have`} failed since their last success:{" "}
          {failing.map((job) => jobLabel(job.name)).join(", ")}. The error is in the recent runs below.
        </Notice>
      )}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-ink-subtle" aria-hidden="true" /> Jobs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.isPending && <Skeleton className="m-4 h-64" />}
          {jobs.isError && <ErrorState compact error={jobs.error} onRetry={() => void jobs.refetch()} />}
          {jobs.data && (
            <DataTable
              columns={jobColumns}
              data={jobs.data.jobs}
              getRowId={(row) => row.name}
              density="compact"
              data-testid="jobs-table"
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader
          actions={
            <div className="flex flex-wrap gap-2">
              <Select
                aria-label="Job"
                size="sm"
                className="w-full sm:w-52"
                value={filterJob}
                onValueChange={(value) => {
                  setFilterJob(value);
                  setPage(1);
                }}
                options={JOB_NAMES.map((name) => ({ value: name, label: jobLabel(name) }))}
                placeholder="Any job"
                allowClear
              />
              <Select
                aria-label="Status"
                size="sm"
                className="w-full sm:w-32"
                value={filterStatus}
                onValueChange={(value) => {
                  setFilterStatus(value);
                  setPage(1);
                }}
                options={RUN_STATUSES.map((status) => ({
                  value: status,
                  label: status === "OK" ? "OK" : status.charAt(0) + status.slice(1).toLowerCase(),
                }))}
                placeholder="Any status"
                allowClear
              />
            </div>
          }
        >
          <CardTitle>Recent runs</CardTitle>
          <p className="text-xs text-ink-subtle">
            One row per attempt; a retried job shows each failed attempt with its error.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={runColumns}
            data={runs.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={runs.isFetching}
            error={runs.error}
            onRetry={() => void runs.refetch()}
            density="compact"
            pagination={{
              page,
              pageSize,
              total: runs.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
            }}
            rowClassName={(row) => (row.status === "FAILED" ? "[&>td]:bg-danger-bg/40" : undefined)}
            emptyState={{
              icon: Clock,
              title: "No runs yet",
              description: "Runs appear here once the worker starts a job.",
            }}
            data-testid="job-runs-table"
          />
        </CardContent>
      </Card>
    </>
  );
}
