import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { History, ExternalLink } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { fmtDateTime, inr } from "@/lib/format";
import { Pill } from "./StatusChip";
import { EmptyState } from "./Bits";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const KIND_TONE = { created: "green", deleted: "red", reversed: "red", status_changed: "amber" };
export const fmtVal = (c, v) => {
  if (v == null || v === "") return "—";
  if (c.kind === "money") return inr(v / 100);
  if (c.kind === "bool") return v ? "Yes" : "No";
  if (c.kind === "date" && typeof v === "string") return v.length > 10 ? fmtDateTime(v) : v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export function ChangeRows({ changes, filter }) {
  const rows = (changes || []).filter((c) => !filter || c.field === filter);
  if (!rows.length) return null;
  return (
    <table className="mt-2 w-full text-xs" data-testid="history-changes"><tbody>
      {rows.map((c) => <tr key={c.field} className="border-t align-top" data-testid={`history-change-${c.field}`}><td className="w-32 py-1 pr-2 font-semibold text-txt-secondary">{c.label}</td><td className="py-1 pr-2 text-brick"><span className="break-all line-through decoration-brick/50">{fmtVal(c, c.old)}</span></td><td className="py-1 text-sage"><span className="break-all font-semibold">{fmtVal(c, c.new)}</span></td></tr>)}
    </tbody></table>
  );
}

export function HistoryTimeline({ entityType, entityId }) {
  const { data, loading } = useFetch(entityId ? `/audit-logs/entity/${entityType}/${entityId}?include_archive=true` : null);
  const [field, setField] = useState("");
  const fields = useMemo(() => Array.from(new Set((data?.items || []).flatMap((a) => (a.changed_fields || []).map((c) => c.field)))).sort(), [data]);
  if (loading) return <Skeleton className="h-40" />;
  if (!data?.items?.length) return <EmptyState icon={History} title="No history yet" description="Changes to this record will appear here." />;
  const items = field ? data.items.filter((a) => a.changed_fields?.some((c) => c.field === field)) : data.items;
  return (
    <div>
      {fields.length > 0 && <select className="input mb-4 !h-9 w-56" value={field} onChange={(e) => setField(e.target.value)} data-testid="history-field-filter"><option value="">All fields</option>{fields.map((f) => <option key={f} value={f}>{f}</option>)}</select>}
      <ol className="relative space-y-5 border-l-2 border-warm-200 pl-5" data-testid="history-timeline">
        {items.map((a) => (
          <li key={a.id} className="relative" data-testid={`history-item-${a.id}`}>
            <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-gold" />
            <div className="flex flex-wrap items-center gap-2"><Pill tone={KIND_TONE[a.action_kind] || "navy"}>{a.action}</Pill><span className="text-sm font-semibold text-ink-950">{a.user_name || a.actor_name}</span><span className="text-xs text-txt-secondary">{fmtDateTime(a.created_at)}</span>{a.as_of && <span className="text-[10px] text-txt-muted">as-of {a.as_of.slice(0, 10)}</span>}</div>
            <ChangeRows changes={a.changed_fields} filter={field} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HistoryButton({ entityType, entityId, label, compact = false, testId = "history-button" }) {
  const [open, setOpen] = useState(false);
  if (!entityId) return null;
  return (
    <>
      {compact ? <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm" title="History" data-testid={testId}><History className="h-3.5 w-3.5" /></button>
        : <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid={testId}><History className="mr-1.5 h-4 w-4" />History</Button>}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="history-sheet">
          <SheetHeader><SheetTitle className="flex items-center justify-between gap-2"><span>History{label ? ` · ${label}` : ""}</span><Link to={`/admin/audit-logs?record=${entityId}`} className="inline-flex items-center gap-1 text-xs font-normal text-txt-secondary hover:text-ink-950" data-testid="history-open-central">Audit logs <ExternalLink className="h-3 w-3" /></Link></SheetTitle></SheetHeader>
          <div className="mt-5">{open && <HistoryTimeline entityType={entityType} entityId={entityId} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
