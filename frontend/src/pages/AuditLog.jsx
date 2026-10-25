import { useState } from "react";
import { useList, useFetch } from "@/hooks/useList";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/common/Bits";
import { DataTable } from "@/components/common/DataTable";
import { Pill } from "@/components/common/StatusChip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const tone = (a) => a.includes("create") ? "green" : a.includes("deactivate") || a.includes("locked") ? "red" : a.includes("status") ? "amber" : "navy";

function Diff({ before, after }) {
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]) && !["updated_at"].includes(k));
  if (!before && after) return <pre className="max-h-80 overflow-auto rounded bg-warm-50 p-3 text-[11px]">{JSON.stringify(after, null, 2)}</pre>;
  return (
    <table className="w-full text-xs" data-testid="audit-diff"><thead><tr className="label-xs text-left"><th className="py-1">Field</th><th className="py-1">Before</th><th className="py-1">After</th></tr></thead>
      <tbody>{keys.map((k) => <tr key={k} className="border-t align-top"><td className="py-1.5 pr-2 font-semibold text-ink-950">{k}</td><td className="py-1.5 pr-2 text-brick"><code className="break-all">{JSON.stringify(before?.[k])}</code></td><td className="py-1.5 text-sage"><code className="break-all">{JSON.stringify(after?.[k])}</code></td></tr>)}</tbody></table>
  );
}

export default function AuditLog() {
  const [entity, setEntity] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data: types } = useFetch("/audit-logs/entity-types");
  const list = useList("/audit-logs", { entity_type: entity === "all" ? undefined : entity, date_from: from || undefined, date_to: to || undefined }, { sort: "-created_at" });
  const [open, setOpen] = useState(null);
  const columns = [
    { key: "created_at", label: "When", render: (a) => <span className="whitespace-nowrap text-xs tabular">{fmtDateTime(a.created_at)}</span> },
    { key: "actor_name", label: "Actor", render: (a) => <span className="font-semibold text-ink-950">{a.actor_name}</span> },
    { key: "action", label: "Action", render: (a) => <Pill tone={tone(a.action)}>{a.action}</Pill> },
    { key: "entity_type", label: "Entity" },
    { key: "entity_id", label: "Entity id", render: (a) => <code className="text-[10px] text-txt-secondary">{a.entity_id?.slice(0, 8)}…</code> },
    { key: "summary", label: "Summary", render: (a) => <span className="text-xs text-txt-secondary">{a.after?.name || a.after?.flat_number || a.after?.email || a.before?.name || ""}{a.before?.status && a.after?.status ? ` ${a.before.status} → ${a.after.status}` : ""}</span> },
    { key: "ip", label: "IP", render: (a) => <span className="text-xs text-txt-muted">{a.ip || "—"}</span> },
  ];
  return (
    <div data-testid="audit-page">
      <PageHeader title="Audit Log" subtitle="Immutable record of every create, update and status change." />
      <DataTable {...list} columns={columns} testId="audit-table" onRowClick={setOpen} searchPlaceholder="Actor, action, entity…"
        toolbar={<>
          <Select value={entity} onValueChange={setEntity}><SelectTrigger className="h-9 w-44" data-testid="audit-entity-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All entities</SelectItem>{types?.items?.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" data-testid="audit-date-from" />
          <DateInput value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" data-testid="audit-date-to" />
        </>} />
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="audit-detail-sheet">
          {!open && <SheetTitle className="sr-only">Audit entry</SheetTitle>}
          {open && <>
            <SheetHeader><SheetTitle className="flex items-center gap-2"><Pill tone={tone(open.action)}>{open.action}</Pill><span className="text-base">{open.entity_type}</span></SheetTitle></SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="label-xs">Actor</p><p className="font-semibold">{open.actor_name}</p></div><div><p className="label-xs">When</p><p>{fmtDateTime(open.created_at)}</p></div><div><p className="label-xs">Entity id</p><code className="text-xs">{open.entity_id}</code></div><div><p className="label-xs">IP</p><p>{open.ip || "—"}</p></div></div>
            <div className="mt-5"><p className="label-xs mb-2">Changes</p><Diff before={open.before} after={open.after} /></div>
          </>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
