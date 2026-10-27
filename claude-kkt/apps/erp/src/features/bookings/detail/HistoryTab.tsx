import { Activity } from "lucide-react";
import { useMemo, useState } from "react";
import { ACTOR_TYPE_LABELS, type AuditLogRow } from "@kkt/contracts";
import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  Timeline,
  type TimelineItem,
  type TimelineTone,
} from "@/components/ui";
import { humanize } from "@/lib/utils";
import { diffSnapshots, formatDiffValue } from "@/features/admin/auditDiff";
import { useAuth } from "@/lib/auth";
import { useBookingHistory } from "../api";

function toneFor(action: string): TimelineTone {
  const verb = action.split(".").pop() ?? "";
  if (/create|post|confirm|clear/.test(verb)) return "success";
  if (/cancel|reverse|bounce|void|delete/.test(verb)) return "danger";
  if (/revise|change|update|complete/.test(verb)) return "warning";
  return "neutral";
}

function DiffTable({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(
    () => diffSnapshots(row.before, row.after).filter((entry) => entry.status !== "same"),
    [row.before, row.after],
  );
  if (rows.length === 0) return null;
  return (
    <div className="text-xs">
      <Button size="xs" variant="link" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? "Hide" : "Show"} {rows.length} changed field{rows.length === 1 ? "" : "s"}
      </Button>
      {open && (
        <div className="mt-1 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[20rem] text-left">
            <thead>
              <tr className="bg-surface text-2xs uppercase tracking-wider text-ink-subtle">
                <th className="px-2 py-1 font-semibold">Field</th>
                <th className="px-2 py-1 font-semibold">Before</th>
                <th className="px-2 py-1 font-semibold">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.key} className="border-t border-border align-top">
                  <td className="px-2 py-1 font-mono text-2xs text-ink-muted">{entry.key}</td>
                  <td className="max-w-[16rem] break-words px-2 py-1 text-ink-subtle">
                    <pre className="whitespace-pre-wrap font-sans">{formatDiffValue(entry.before)}</pre>
                  </td>
                  <td className="max-w-[16rem] break-words px-2 py-1 font-medium text-ink">
                    <pre className="whitespace-pre-wrap font-sans">{formatDiffValue(entry.after)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Audit timeline of the booking (`GET /audit-logs/entity/booking/:id`). */
export function HistoryTab({ bookingId }: { bookingId: string }) {
  const { can } = useAuth();
  const allowed = can("audit.view");
  const history = useBookingHistory(bookingId, { enabled: allowed });
  if (!allowed)
    return (
      <EmptyState
        compact
        icon={Activity}
        title="History is hidden for your role"
        description="The audit trail needs the audit-view permission."
      />
    );
  if (history.isPending) return <Skeleton className="h-48" />;
  if (history.isError) return <ErrorState compact error={history.error} onRetry={() => void history.refetch()} />;
  const rows = [...(history.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (rows.length === 0)
    return (
      <EmptyState
        compact
        icon={Activity}
        title="No history yet"
        description="Every create, revision, cancellation and completion is recorded here."
      />
    );
  const items: TimelineItem[] = rows.map((row) => ({
    id: row.id,
    title: humanize(row.action.replace(/^[a-z_]+\./, "")),
    description: `${row.action}${row.request_id ? ` · ${row.request_id.slice(0, 8)}` : ""}`,
    actor: row.actor_name ?? ACTOR_TYPE_LABELS[row.actor_type],
    at: row.created_at,
    tone: toneFor(row.action),
    children: <DiffTable row={row} />,
  }));
  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="history-tab">
      <Timeline items={items} absolute />
    </div>
  );
}
