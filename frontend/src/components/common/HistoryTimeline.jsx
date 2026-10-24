import { useFetch } from "@/hooks/useList";
import { fmtDateTime } from "@/lib/format";
import { Pill } from "./StatusChip";
import { EmptyState } from "./Bits";
import { Skeleton } from "@/components/ui/skeleton";
import { History } from "lucide-react";

export function HistoryTimeline({ entityType, entityId }) {
  const { data, loading } = useFetch(entityId ? `/audit-logs/entity/${entityType}/${entityId}` : null);
  if (loading) return <Skeleton className="h-40" />;
  if (!data?.items?.length) return <EmptyState icon={History} title="No history yet" description="Changes to this record will appear here." />;
  return (
    <ol className="relative space-y-5 border-l-2 border-slate-200 pl-5" data-testid="history-timeline">
      {data.items.map((a) => (
        <li key={a.id} className="relative" data-testid={`history-item-${a.id}`}>
          <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-gold" />
          <div className="flex flex-wrap items-center gap-2"><Pill tone="navy">{a.action}</Pill><span className="text-sm font-semibold text-navy">{a.actor_name}</span><span className="text-xs text-slate-500">{fmtDateTime(a.created_at)}</span></div>
          {a.changed_fields?.length > 0 && (
            <table className="mt-2 w-full text-xs"><tbody>
              {a.changed_fields.slice(0, 8).map((k) => <tr key={k} className="border-t align-top"><td className="w-32 py-1 pr-2 font-semibold text-slate-600">{k}</td><td className="py-1 pr-2 text-red-700"><code className="break-all">{JSON.stringify(a.before?.[k]) ?? "—"}</code></td><td className="py-1 text-emerald-700"><code className="break-all">{JSON.stringify(a.after?.[k]) ?? "—"}</code></td></tr>)}
            </tbody></table>
          )}
        </li>
      ))}
    </ol>
  );
}
