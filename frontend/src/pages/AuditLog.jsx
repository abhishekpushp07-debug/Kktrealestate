import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Download, Route } from "lucide-react";
import { useList, useFetch } from "@/hooks/useList";
import api from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/common/Bits";
import { DataTable } from "@/components/common/DataTable";
import { Pill } from "@/components/common/StatusChip";
import { ChangeRows } from "@/components/common/HistoryTimeline";
import { JourneyPanel } from "@/components/common/JourneyPanel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateInput } from "@/components/common/DateInput";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const tone = (k) => ({ created: "green", deleted: "red", reversed: "red", status_changed: "amber" }[k] || "navy");
const LINK = { booking: (id) => `/bookings/${id}`, customer: (id) => `/customers/${id}`, project: (id) => `/projects/${id}`, block: (id) => `/blocks/${id}`, lead: () => "/leads", payment: () => "/payments", user: () => "/admin/access-control", role: () => "/roles", ticket: (id) => `/service-requests/${id}` };

export default function AuditLog() {
  const [sp, setSp] = useSearchParams();
  const get = (k) => sp.get(k) || "";
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v && v !== "all") n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const { data: modules } = useFetch("/audit-logs/modules");
  const { data: users } = useFetch("/users?limit=100");
  const filters = { module: get("module") || undefined, actor_id: get("user") || undefined, action: get("action") || undefined, date_from: get("from") || undefined, date_to: get("to") || undefined, record: get("record") || undefined, field: get("field") || undefined };
  const list = useList("/audit-logs", filters, { sort: "-created_at" });
  const [open, setOpen] = useState(null);
  const [journey, setJourney] = useState(null);
  const exportCsv = async () => {
    const r = await api.get("/audit-logs/export.csv", { params: filters, responseType: "blob" });
    const url = URL.createObjectURL(r.data); const a = document.createElement("a"); a.href = url; a.download = "audit-logs.csv"; a.click(); URL.revokeObjectURL(url);
  };
  const columns = [
    { key: "created_at", label: "When", render: (a) => <span className="whitespace-nowrap text-xs tabular">{fmtDateTime(a.created_at)}</span> },
    { key: "user_name", label: "User", render: (a) => <span className="font-semibold text-ink-950">{a.user_name || a.actor_name}</span> },
    { key: "action", label: "Action", render: (a) => <Pill tone={tone(a.action_kind)}>{a.action}</Pill> },
    { key: "module_name", label: "Module", render: (a) => <span className="text-xs">{a.module_name || a.entity_type}</span> },
    { key: "record_label", label: "Record", render: (a) => <span className="text-xs font-medium">{a.record_label || <code className="text-[10px] text-txt-secondary">{a.entity_id?.slice(0, 8)}…</code>}</span> },
    { key: "changes", label: "Changes", render: (a) => <span className="text-xs text-txt-secondary">{(a.changed_fields || []).slice(0, 3).map((c) => c.label).join(", ")}{a.changed_fields?.length > 3 ? ` +${a.changed_fields.length - 3}` : ""}</span> },
    { key: "ip", label: "IP", render: (a) => <span className="text-xs text-txt-muted">{a.ip || "—"}</span> },
  ];
  return (
    <div data-testid="audit-page">
      <PageHeader title="Audit history" subtitle="Immutable record of every create, update, delete and status change — who, what, when, old → new." actions={<Button variant="outline" size="sm" onClick={exportCsv} data-testid="audit-export-csv"><Download className="mr-1.5 h-4 w-4" />Export CSV</Button>} />
      <DataTable {...list} columns={columns} testId="audit-table" onRowClick={setOpen} searchPlaceholder="User, action, record…"
        toolbar={<>
          <Select value={get("module") || "all"} onValueChange={(v) => set("module", v)}><SelectTrigger className="h-9 w-44" data-testid="audit-module-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All modules</SelectItem>{modules?.items?.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
          <Select value={get("user") || "all"} onValueChange={(v) => set("user", v)}><SelectTrigger className="h-9 w-44" data-testid="audit-user-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All users</SelectItem>{users?.items?.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>
          <input className="input !h-9 !w-44" placeholder="Action (e.g. flat.update)" value={get("action")} onChange={(e) => set("action", e.target.value)} data-testid="audit-action-filter" />
          <input className="input !h-9 !w-44" placeholder="Record id / number" value={get("record")} onChange={(e) => set("record", e.target.value)} data-testid="audit-record-filter" />
          <input className="input !h-9 !w-32" placeholder="Field" value={get("field")} onChange={(e) => set("field", e.target.value)} data-testid="audit-field-filter" />
          <DateInput value={get("from")} onChange={(e) => set("from", e.target.value)} className="h-9 w-40" data-testid="audit-date-from" />
          <DateInput value={get("to")} onChange={(e) => set("to", e.target.value)} className="h-9 w-40" data-testid="audit-date-to" />
        </>} />
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="audit-detail-sheet">
          {!open && <SheetTitle className="sr-only">Audit entry</SheetTitle>}
          {open && <>
            <SheetHeader><SheetTitle className="flex items-center gap-2"><Pill tone={tone(open.action_kind)}>{open.action}</Pill><span className="text-base">{open.module_name}</span></SheetTitle></SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="label-xs">User</p><p className="font-semibold">{open.user_name || open.actor_name}</p></div><div><p className="label-xs">When</p><p>{fmtDateTime(open.created_at)}{open.as_of ? ` · as-of ${open.as_of.slice(0, 10)}` : ""}</p></div><div><p className="label-xs">Record</p><p className="font-medium">{open.record_label || "—"}</p><code className="text-[10px]">{open.entity_id}</code></div><div><p className="label-xs">IP · Request</p><p className="text-xs">{open.ip || "—"} · {open.request_id || "—"}</p></div></div>
            <div className="mt-4 flex gap-2">{LINK[open.entity_type] && <Link to={LINK[open.entity_type](open.entity_id)} className="btn-secondary !h-8 text-xs" data-testid="audit-open-record">Open record</Link>}<Button variant="outline" size="sm" onClick={() => setJourney(open)} data-testid="audit-open-journey"><Route className="mr-1 h-3.5 w-3.5" />Journey</Button></div>
            <div className="mt-5"><p className="label-xs mb-1">Changes (old → new)</p>{open.changed_fields?.length ? <ChangeRows changes={open.changed_fields} /> : <p className="text-xs text-txt-muted">{open.action_kind === "created" ? "Record created." : "No field-level changes recorded."}</p>}</div>
          </>}
        </SheetContent>
      </Sheet>
      {journey && <JourneyPanel entityType={journey.entity_type} entityId={journey.entity_id} open onOpenChange={(o) => !o && setJourney(null)} initialAuditId={journey.id} />}
    </div>
  );
}
