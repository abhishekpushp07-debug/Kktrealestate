import { HistoryButton } from "@/components/common/HistoryTimeline";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, LifeBuoy, Lock, Paperclip, Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { ResumableUpload } from "@/components/common/ResumableUpload";
import { FileGallery } from "@/components/common/FileGallery";
import { undoToast } from "@/lib/undo";
import { useAuth } from "@/context/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/common/Bits";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatTile, StatusPill, EmptyState } from "@/components/v2";
import { Avatar } from "@/components/v2/CustomerBits";
import { Clock, Star, UserRoundX } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoveMenu, moveKeyProps, useNarrow } from "@/components/v2/KanbanMove";

export const SR_STATUSES = ["New", "In Progress", "Awaiting Customer", "Resolved", "Closed"];

export function SrCard({ sr, onClick }) {
  const overdue = ["New", "In Progress"].includes(sr.status) && sr.sla_due_at < new Date().toISOString();
  const hrs = Math.round((new Date(sr.sla_due_at) - Date.now()) / 36e5);
  return <button onClick={onClick} className="card card-hover w-full !p-4 text-left" data-testid={`sr-card-${sr.ticket_number}`}>
    <div className="flex items-start gap-3"><Avatar name={sr.customer_name} size={34} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950" title={sr.subject}>{sr.subject}</p><p className="truncate text-xs text-txt-secondary">{sr.customer_name} · <span className="font-mono">{sr.ticket_number}</span></p></div></div>
    <div className="mt-3 flex flex-wrap items-center gap-1.5"><span className="pill bg-ink-950 text-warm-50">{sr.flat_number}</span><span className="pill bg-warm-100 text-txt-secondary">{sr.category}</span><span className={cn("pill", sr.priority === "High" ? "bg-brick-50 text-brick" : sr.priority === "Medium" ? "bg-amber2-50 text-amber2" : "bg-warm-100 text-txt-secondary")}>{sr.priority}</span></div>
    <div className="mt-3 flex items-center justify-between text-[11px]"><span className={cn("pill", overdue ? "bg-brick-50 font-semibold text-brick" : ["Resolved", "Closed"].includes(sr.status) ? "bg-sage-50 text-sage" : hrs < 8 ? "bg-amber2-50 text-amber2" : "bg-warm-100 text-txt-secondary")} data-testid={`sr-sla-${sr.ticket_number}`}>{overdue ? <><AlertTriangle className="h-3 w-3" />Breached {Math.abs(hrs)} h ago</> : sr.status === "Closed" && sr.rating ? <>{"★".repeat(sr.rating)}</> : ["Resolved", "Closed"].includes(sr.status) ? sr.status : <><Clock className="h-3 w-3" />{hrs < 24 ? `${hrs} h left` : `${Math.round(hrs / 24)} d left`}</>}</span><span className="text-txt-muted">{sr.assigned_to_name || "Unassigned"}</span></div>
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
  useEffect(() => { load(); if (can("service.ticket.assign")) api.get("/users?page_size=100").then((r) => setUsers(r.data.items)).catch(() => {}); }, [id]); // eslint-disable-line
  const [filesKey, setFilesKey] = useState(0);
  const post = async (path, body, ok) => { try { await api.post(`/service-requests/${id}/${path}`, body); toast.success(ok); setMsg(""); load(); } catch (e) { toast.error(errMsg(e)); } };
  const openAttachment = async (idx, name) => { try { const { data } = await api.get(`/service-requests/${id}/attachments/${idx}`, { responseType: "blob" }); const url = URL.createObjectURL(data); const a = document.createElement("a"); a.href = url; a.download = name; a.target = "_blank"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); } catch (e) { toast.error(errMsg(e)); } };
  if (!sr) return <div className="p-6 text-sm text-txt-muted">Loading…</div>;
  return (
    <div data-testid="sr-detail">
      <div className="card mb-4 p-4" data-testid="sr-attachments-card"><div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-bold">Attachments</h3><div className="ml-auto"><ResumableUpload testId="sr-upload" meta={{ kind: "ticket_attachment", entity_type: "ticket", entity_id: id, project_id: sr.project_id }} onDone={() => setFilesKey((k) => k + 1)} label="Attach file" /></div></div>
        <FileGallery query={{ entity_type: "ticket", entity_id: id }} canEdit={can("service.ticket.assign")} refreshKey={filesKey} columns={8} /></div>
      <PageHeader title={sr.subject} subtitle={`${sr.ticket_number} · ${sr.category} · ${sr.priority} · raised ${fmtDateTime(sr.created_at)}`} crumbs={[{ label: "Service Requests", to: "/service-requests" }, { label: sr.ticket_number }]}
        actions={<div className="flex flex-wrap items-center gap-2"><HistoryButton entityType="service_request" entityId={sr.id} label={sr.ticket_number} />
          <StatusPill status={sr.status} testId="sr-status" />
          {can("service.ticket.edit") && <Select value={sr.status} onValueChange={(v) => post("status", { status: v }, `Status → ${v}`)}><SelectTrigger className="h-9 w-44" data-testid="sr-status-select"><SelectValue /></SelectTrigger><SelectContent>{SR_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>}
          {can("service.ticket.assign") && <Select value={sr.assigned_to || "none"} onValueChange={(v) => post("assign", { assigned_to: v === "none" ? null : v }, "Assigned")}><SelectTrigger className="h-9 w-48" data-testid="sr-assign-select"><UserRound className="mr-1 h-3.5 w-3.5" /><SelectValue placeholder="Assign" /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent></Select>}
        </div>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          {(() => { let n = 0; return sr.thread.map((m, i) => <div key={i} className={cn("flex gap-3", m.by !== "customer" && "flex-row-reverse")} data-testid={`sr-msg-${i}`}><Avatar name={m.by === "customer" ? sr.customer_name : m.author_name} size={30} /><div className={cn("max-w-[80%] rounded-2xl px-4 py-3", m.internal ? "border border-dashed border-amber2/50 bg-amber2-50/60" : m.by === "customer" ? "card !rounded-tl-sm" : "rounded-tr-sm bg-ink-950 text-warm-50")}><p className={cn("flex items-center gap-2 text-[11px] font-semibold", m.by === "customer" || m.internal ? "text-txt-secondary" : "text-warm-200/70")}>{m.internal && <Lock className="h-3 w-3" />}{m.by === "customer" ? sr.customer_name : m.author_name}{m.internal ? " · internal note" : ""} · {fmtDateTime(m.at)}</p><p className="mt-1 whitespace-pre-wrap text-sm">{m.message}</p>{m.attachments?.length > 0 && <p className="mt-2 flex flex-wrap gap-2 text-xs">{m.attachments.map((a) => { const idx = n++; return <button key={idx} onClick={() => openAttachment(idx, a.name)} className="pill bg-warm-100 text-ink-950 hover:bg-warm-200" data-testid={`sr-attachment-${idx}`}><Paperclip className="h-3 w-3" />{a.name}</button>; })}</p>}</div></div>); })()}
          {can("service.ticket.edit") && sr.status !== "Closed" && <div className="card p-4"><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={internal ? "Internal note (hidden from customer)…" : "Reply to customer…"} data-testid="sr-reply-text" /><div className="mt-2 flex items-center gap-3"><label className="flex items-center gap-2 text-xs font-semibold text-txt-secondary"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="sr-internal-toggle" />Internal note</label><button type="button" className="btn btn-primary ml-auto !h-9" disabled={!msg.trim()} onClick={() => post("reply", { message: msg, internal }, internal ? "Note added" : "Reply sent")} data-testid="sr-reply-send"><Send className="mr-1 h-3.5 w-3.5" />{internal ? "Add note" : "Send"}</button>{!internal && <button type="button" className="btn btn-secondary !h-8 !px-3 text-xs" disabled={!msg.trim()} onClick={() => post("reply", { message: msg, internal: false, status: "Awaiting Customer" }, "Sent · awaiting customer")} data-testid="sr-reply-await">Send & await customer</button>}{!internal && <button type="button" className="btn btn-secondary !h-8 !px-3 text-xs" disabled={!msg.trim()} onClick={() => post("reply", { message: msg, internal: false, status: "Resolved" }, "Resolved")} data-testid="sr-reply-resolve">Send & resolve</button>}</div></div>}
        </div>
        <div className="space-y-4">
          <div className="card p-4 text-sm"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-txt-secondary">Context</p>
            <p><button className="font-semibold text-ink-950 hover:underline" onClick={() => nav(`/customers/${sr.customer_id}`)} data-testid="sr-customer-link">{sr.customer_name}</button> · {sr.customer_phone}</p>
            <p><button className="text-ink-950 hover:underline" onClick={() => nav(`/bookings/${sr.booking_id}`)} data-testid="sr-booking-link">{sr.booking_number}</button> · {sr.project_name} · {sr.flat_number}</p>
            <p className="mt-2 text-xs text-txt-secondary">SLA due {fmtDateTime(sr.sla_due_at)}{sr.sla_breached ? " · breached" : ""}</p>
            {sr.rating && <p className="mt-2 text-xs">Rating: {"★".repeat(sr.rating)}{sr.rating_comment ? ` — ${sr.rating_comment}` : ""}</p>}
          </div>
          <div className="card p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-txt-secondary">History</p><ul className="space-y-1 text-xs text-txt-secondary">{sr.stage_history.map((h, i) => <li key={i}>{h.from ? `${h.from} → ` : ""}<b>{h.to}</b> · {h.by} · {fmtDateTime(h.at)}</li>)}</ul></div>
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
  const [lanes, setLanes] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [note, setNote] = useState("");
  const narrow = useNarrow();
  const load = () => { const p = new URLSearchParams({ page_size: 200 }); if (f.status !== "all") p.set("status", f.status); if (f.priority !== "all") p.set("priority", f.priority); if (f.overdue) p.set("overdue", "true"); return api.get(`/service-requests?${p}`).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e))); };
  useEffect(() => { if (!id) load(); }, [id, f]); // eslint-disable-line
  if (id) return <Detail id={id} />;
  const cols = f.status === "all" ? SR_STATUSES : [f.status];
  const items = data?.items || [], nowIso = new Date().toISOString();
  const kp = { open: items.filter((x) => ["New", "In Progress"].includes(x.status)).length, breach: items.filter((x) => ["New", "In Progress"].includes(x.status) && x.sla_due_at < nowIso).length, await: items.filter((x) => x.status === "Awaiting Customer").length, rating: (() => { const r = items.filter((x) => x.rating); return r.length ? (r.reduce((s, x) => s + x.rating, 0) / r.length).toFixed(1) : "—"; })() };
  const move = async (sr, status, extra = {}) => {
    const from = sr.status;
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === sr.id ? { ...x, status } : x)) }));
    try {
      await api.post(`/service-requests/${sr.id}/status`, { status, ...extra });
      const undoable = !["Resolved", "Closed"].includes(status);
      if (undoable) undoToast({ title: `${sr.ticket_number} → ${status}`, description: `Moved from ${from}`, testId: `sr-move-${sr.id}`, onUndo: async () => {
        await api.post(`/service-requests/${sr.id}/status`, { status: from, note: "Undo" });
        setData((d) => ({ ...d, items: d.items.map((x) => (x.id === sr.id ? { ...x, status: from } : x)) }));
        load();
        return `Reverted · ${sr.ticket_number} back in ${from}`;
      } });
      else toast.success(`${sr.ticket_number} → ${status}`);
    } catch (e) {
      setData((d) => ({ ...d, items: d.items.map((x) => (x.id === sr.id ? { ...x, status: from } : x)) }));  // rollback
      toast.error(errMsg(e));
    } finally { load(); }
  };
  const onDrop = (status, card) => { setOver(null); const sr = card || drag; if (!sr || sr.status === status) return setDrag(null); if (status === "Resolved") { setPrompt({ sr, status }); setNote(""); } else if (status === "Closed" && sr.status !== "Resolved") { toast.error("Resolve the ticket before closing it"); } else move(sr, status); setDrag(null); };
  const Column = ({ s, list }) => <div onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={() => onDrop(s)} className={cn("flex w-72 shrink-0 flex-col rounded-2xl bg-warm-100/70 p-3 transition-colors", over === s && drag && drag.status !== s && "bg-gold-light ring-2 ring-gold/60")} data-testid={`sr-col-${s.replace(/\s+/g, "-").toLowerCase()}`}>
    <p className="mb-3 flex items-center justify-between px-1 text-sm font-semibold text-ink-950">{s}<span className="pill bg-white text-txt-secondary">{list.length}</span></p>
    <div className="min-h-[80px] flex-1 space-y-3">{list.map((sr) => <div key={sr.id} draggable onDragStart={() => setDrag(sr)} onDragEnd={() => { setDrag(null); setOver(null); }} {...moveKeyProps(cols, s, (to) => onDrop(to, sr))} className={cn("cursor-grab rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-gold active:cursor-grabbing", drag?.id === sr.id && "opacity-40")} aria-label={`${sr.ticket_number}, ${s}. Use arrow keys to move.`} data-testid={`sr-drag-${sr.ticket_number}`}><SrCard sr={sr} onClick={() => nav(`/service-requests/${sr.id}`)} />{narrow && <div className="-mt-1 mb-1 px-1"><MoveMenu columns={cols} current={s} onMove={(to) => onDrop(to, sr)} testId={`sr-move-${sr.ticket_number}`} /></div>}</div>)}{list.length === 0 && <p className="rounded-xl border border-dashed border-warm-200 px-3 py-6 text-center text-xs text-txt-muted">Drop here</p>}</div>
  </div>;
  return (
    <div className="space-y-8" data-testid="service-requests-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="label">Support</p><h1 className="mt-1 font-display text-4xl text-ink-950">Service</h1><p className="mt-2 text-sm text-txt-secondary">Customer tickets from the portal and front desk. Drag cards between columns to update status.</p></div>
        <div className="flex flex-wrap gap-2">
          <select className="input !h-10 !w-36 !py-0 text-sm" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} data-testid="sr-filter-priority"><option value="all">All priority</option>{["High", "Medium", "Low"].map((p) => <option key={p}>{p}</option>)}</select>
          <select className="input !h-10 !w-44 !py-0 text-sm" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} data-testid="sr-filter-status"><option value="all">All statuses</option>{SR_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <button className={cn("btn", f.overdue ? "btn-danger" : "btn-secondary")} onClick={() => setF({ ...f, overdue: !f.overdue })} data-testid="sr-filter-overdue"><AlertTriangle className="h-4 w-4" />Breaching SLA</button>
          <button className={cn("btn", lanes ? "btn-primary" : "btn-secondary")} onClick={() => setLanes(!lanes)} aria-pressed={lanes} data-testid="sr-swimlanes-toggle">Swimlanes by priority</button>
        </div>
      </header>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" data-testid="sr-tiles">
        <StatTile label="Open" value={String(kp.open)} hint="new + in progress" icon={LifeBuoy} testId="sr-tile-open" />
        <StatTile label="Breaching SLA" value={String(kp.breach)} hint="past due response" icon={Clock} iconTone={kp.breach ? "brick" : undefined} tone={kp.breach ? "brick" : undefined} testId="sr-tile-breach" />
        <StatTile label="Awaiting customer" value={String(kp.await)} hint="ball in their court" icon={UserRoundX} testId="sr-tile-await" />
        <StatTile label="Avg rating" value={String(kp.rating)} hint="resolved tickets" icon={Star} iconTone="gold" testId="sr-tile-rating" />
      </div>
      {!data ? <div className="flex gap-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-64 w-72 animate-pulse rounded-2xl bg-warm-100" />)}</div> : items.length === 0 ? <EmptyState icon={LifeBuoy} title="No service requests" description="Tickets raised from the customer portal or front desk will appear here." /> : lanes ? (
        <div className="space-y-6" data-testid="sr-swimlanes">{["High", "Medium", "Low"].map((p) => { const li = items.filter((x) => x.priority === p); return li.length === 0 ? null : <section key={p}><h2 className="mb-3 flex items-center gap-2 font-display text-lg text-ink-950"><span className={cn("h-2.5 w-2.5 rounded-full", p === "High" ? "bg-brick" : p === "Medium" ? "bg-amber2" : "bg-slate2")} />{p} priority<span className="pill bg-warm-100 text-txt-secondary">{li.length}</span></h2><div className="flex gap-4 overflow-x-auto pb-4 scroll-x">{cols.map((s) => <Column key={s} s={s} list={li.filter((x) => x.status === s)} />)}</div></section>; })}</div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 scroll-x" data-testid="sr-kanban">{cols.map((s) => <Column key={s} s={s} list={items.filter((x) => x.status === s)} />)}</div>
      )}
      <Dialog open={!!prompt} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent className="v2" data-testid="sr-resolve-dialog"><DialogHeader><DialogTitle className="font-display text-xl">Resolve {prompt?.sr.ticket_number}</DialogTitle></DialogHeader>
          <p className="text-sm text-txt-secondary">{prompt?.sr.subject}</p>
          <label className="block"><span className="label !normal-case !tracking-normal !text-txt-secondary">Resolution note <span className="text-brick">*</span></span><Textarea className="mt-1.5" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done to fix it?" data-testid="sr-resolve-note" /></label>
          <DialogFooter><button className="btn btn-secondary" onClick={() => setPrompt(null)}>Cancel</button><button className="btn btn-primary" disabled={!note.trim()} onClick={() => { move(prompt.sr, "Resolved", { note: note.trim() }); setPrompt(null); }} data-testid="sr-resolve-confirm">Mark resolved</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
