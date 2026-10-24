import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, LifeBuoy, Lock, Paperclip, Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, EmptyState } from "@/components/common/Bits";
import { fmtDateTime } from "@/lib/format";

export const SR_STATUSES = ["New", "In Progress", "Awaiting Customer", "Resolved", "Closed"];
const TONE = { New: "bg-blue-50 text-blue-700", "In Progress": "bg-amber-50 text-amber-700", "Awaiting Customer": "bg-gold-light text-[#8a6d12]", Resolved: "bg-emerald-50 text-emerald-700", Closed: "bg-slate-100 text-slate-600" };
const PRI = { High: "text-red-600", Medium: "text-amber-600", Low: "text-slate-500" };

export function SrCard({ sr, onClick }) {
  const overdue = ["New", "In Progress"].includes(sr.status) && sr.sla_due_at < new Date().toISOString();
  return <button onClick={onClick} className="w-full rounded-lg border bg-white p-3 text-left transition-shadow hover:shadow-md" data-testid={`sr-card-${sr.ticket_number}`}>
    <div className="flex items-center gap-2 text-[11px]"><span className="font-mono text-slate-500">{sr.ticket_number}</span><span className={`font-bold ${PRI[sr.priority]}`}>{sr.priority}</span>{overdue && <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-3 w-3" />SLA</span>}</div>
    <p className="mt-1 text-sm font-semibold text-navy">{sr.subject}</p>
    <p className="text-xs text-slate-500">{sr.customer_name} · {sr.flat_number} · {sr.category}</p>
  </button>;
}

function Detail({ id }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [sr, setSr] = useState(null);
  const [users, setUsers] = useState([]);
  const [msg, setMsg] = useState("");
  const [internal, setInternal] = useState(false);
  const load = () => api.get(`/service-requests/${id}`).then((r) => setSr(r.data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); if (can("service.assign")) api.get("/users?page_size=100").then((r) => setUsers(r.data.items)).catch(() => {}); }, [id]); // eslint-disable-line
  const post = async (path, body, ok) => { try { await api.post(`/service-requests/${id}/${path}`, body); toast.success(ok); setMsg(""); load(); } catch (e) { toast.error(errMsg(e)); } };
  const openAttachment = async (idx, name) => { try { const { data } = await api.get(`/service-requests/${id}/attachments/${idx}`, { responseType: "blob" }); const url = URL.createObjectURL(data); const a = document.createElement("a"); a.href = url; a.download = name; a.target = "_blank"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); } catch (e) { toast.error(errMsg(e)); } };
  if (!sr) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  return (
    <div data-testid="sr-detail">
      <PageHeader title={sr.subject} subtitle={`${sr.ticket_number} · ${sr.category} · ${sr.priority} · raised ${fmtDateTime(sr.created_at)}`} crumbs={[{ label: "Service Requests", to: "/erp/service-requests" }, { label: sr.ticket_number }]}
        actions={<div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${TONE[sr.status]}`} data-testid="sr-status">{sr.status}</span>
          {can("service.write") && <Select value={sr.status} onValueChange={(v) => post("status", { status: v }, `Status → ${v}`)}><SelectTrigger className="h-9 w-44" data-testid="sr-status-select"><SelectValue /></SelectTrigger><SelectContent>{SR_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>}
          {can("service.assign") && <Select value={sr.assigned_to || "none"} onValueChange={(v) => post("assign", { assigned_to: v === "none" ? null : v }, "Assigned")}><SelectTrigger className="h-9 w-48" data-testid="sr-assign-select"><UserRound className="mr-1 h-3.5 w-3.5" /><SelectValue placeholder="Assign" /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>}
        </div>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {(() => { let n = 0; return sr.thread.map((m, i) => <div key={i} className={`rounded-lg border p-3 ${m.internal ? "border-amber-200 bg-amber-50" : m.by === "customer" ? "bg-white" : "bg-navy-50"}`} data-testid={`sr-msg-${i}`}><p className="flex items-center gap-2 text-[11px] font-bold text-slate-500">{m.internal && <Lock className="h-3 w-3" />}{m.by === "customer" ? `${sr.customer_name} (customer)` : m.author_name}{m.internal ? " · internal note" : ""} · {fmtDateTime(m.at)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-navy">{m.message}</p>{m.attachments?.length > 0 && <p className="mt-2 flex flex-wrap gap-2 text-xs">{m.attachments.map((a) => { const idx = n++; return <button key={idx} onClick={() => openAttachment(idx, a.name)} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-navy hover:bg-slate-200" data-testid={`sr-attachment-${idx}`}><Paperclip className="h-3 w-3" />{a.name}</button>; })}</p>}</div>); })()}
          {can("service.write") && sr.status !== "Closed" && <div className="card-elev p-4"><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={internal ? "Internal note (hidden from customer)…" : "Reply to customer…"} data-testid="sr-reply-text" /><div className="mt-2 flex items-center gap-3"><label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="sr-internal-toggle" />Internal note</label><Button size="sm" className="ml-auto bg-navy hover:bg-navy-700" disabled={!msg.trim()} onClick={() => post("reply", { message: msg, internal }, internal ? "Note added" : "Reply sent")} data-testid="sr-reply-send"><Send className="mr-1 h-3.5 w-3.5" />{internal ? "Add note" : "Send"}</Button>{!internal && <Button size="sm" variant="outline" disabled={!msg.trim()} onClick={() => post("reply", { message: msg, internal: false, status: "Awaiting Customer" }, "Sent · awaiting customer")} data-testid="sr-reply-await">Send & await customer</Button>}{!internal && <Button size="sm" variant="outline" disabled={!msg.trim()} onClick={() => post("reply", { message: msg, internal: false, status: "Resolved" }, "Resolved")} data-testid="sr-reply-resolve">Send & resolve</Button>}</div></div>}
        </div>
        <div className="space-y-4">
          <div className="card-elev p-4 text-sm"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Context</p>
            <p><button className="font-semibold text-navy hover:underline" onClick={() => nav(`/erp/customers/${sr.customer_id}`)} data-testid="sr-customer-link">{sr.customer_name}</button> · {sr.customer_phone}</p>
            <p><button className="text-navy hover:underline" onClick={() => nav(`/erp/bookings/${sr.booking_id}`)} data-testid="sr-booking-link">{sr.booking_number}</button> · {sr.project_name} · {sr.flat_number}</p>
            <p className="mt-2 text-xs text-slate-500">SLA due {fmtDateTime(sr.sla_due_at)}{sr.sla_breached ? " · breached" : ""}</p>
            {sr.rating && <p className="mt-2 text-xs">Rating: {"★".repeat(sr.rating)}{sr.rating_comment ? ` — ${sr.rating_comment}` : ""}</p>}
          </div>
          <div className="card-elev p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">History</p><ul className="space-y-1 text-xs text-slate-600">{sr.stage_history.map((h, i) => <li key={i}>{h.from ? `${h.from} → ` : ""}<b>{h.to}</b> · {h.by} · {fmtDateTime(h.at)}</li>)}</ul></div>
        </div>
      </div>
    </div>
  );
}

export default function ServiceRequests() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [f, setF] = useState({ status: "all", priority: "all", overdue: false });
  useEffect(() => { if (id) return; const p = new URLSearchParams({ page_size: 200 }); if (f.status !== "all") p.set("status", f.status); if (f.priority !== "all") p.set("priority", f.priority); if (f.overdue) p.set("overdue", "true"); api.get(`/service-requests?${p}`).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e))); }, [id, f]);
  if (id) return <Detail id={id} />;
  const cols = f.status === "all" ? SR_STATUSES : [f.status];
  return (
    <div data-testid="service-requests-page">
      <PageHeader title="Service Requests" subtitle="Customer tickets from the portal and front desk." actions={<div className="flex gap-2">
        <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}><SelectTrigger className="h-9 w-32" data-testid="sr-filter-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All priority</SelectItem>{["High", "Medium", "Low"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
        <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}><SelectTrigger className="h-9 w-40" data-testid="sr-filter-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{SR_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
        <Button variant={f.overdue ? "default" : "outline"} size="sm" className={f.overdue ? "bg-red-600 hover:bg-red-700" : ""} onClick={() => setF({ ...f, overdue: !f.overdue })} data-testid="sr-filter-overdue"><AlertTriangle className="mr-1 h-3.5 w-3.5" />Overdue</Button>
      </div>} />
      {!data ? <div className="text-sm text-slate-400">Loading…</div> : data.items.length === 0 ? <EmptyState icon={LifeBuoy} title="No service requests" /> : (
        <div className="grid gap-3 overflow-x-auto md:grid-cols-5" data-testid="sr-kanban">
          {cols.map((s) => <div key={s} className="min-w-[220px] rounded-xl bg-surface p-2"><p className="mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-wide text-slate-600">{s}<span className="rounded-full bg-white px-2 py-0.5 tabular-nums">{data.status_counts?.[s] || 0}</span></p><div className="space-y-2">{data.items.filter((x) => x.status === s).map((sr) => <SrCard key={sr.id} sr={sr} onClick={() => nav(`/erp/service-requests/${sr.id}`)} />)}</div></div>)}
        </div>
      )}
    </div>
  );
}
