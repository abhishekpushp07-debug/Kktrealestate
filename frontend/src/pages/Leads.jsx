import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock, KanbanSquare, List, Phone, Plus, UserCheck } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useList, useFetch } from "@/hooks/useList";
import { DataTable } from "@/components/common/DataTable";
import { PageHeader, Field } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { inrShort, fmtDate, fmtDateTime } from "@/lib/format";

const STAGE_TONE = { New: "slate", Contacted: "navy", "Site Visit Scheduled": "amber", "Site Visit Done": "amber", Negotiation: "gold", Converted: "emerald", Lost: "red" };
const SOURCES = ["Walk-in", "Website", "Referral", "Broker", "Campaign"];

function LeadForm({ open, onOpenChange, onSaved }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", project_id: null, budget_min: "", budget_max: "", source: "Walk-in", notes: "" });
  const [busy, setBusy] = useState(false);
  const { data: projects } = useFetch("/projects?page_size=50");
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api.post("/leads", { ...f, email: f.email || null, project_id: f.project_id || null, budget_min: f.budget_min ? Number(f.budget_min) : null, budget_max: f.budget_max ? Number(f.budget_max) : null, notes: f.notes || null }); toast.success(`Lead ${r.data.lead_number} created`); onSaved?.(); onOpenChange(false); }
    catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}><SheetContent data-testid="lead-form"><SheetHeader><SheetTitle>New lead</SheetTitle><SheetDescription>Enquiries enter the pipeline at “New”.</SheetDescription></SheetHeader>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="lead-name" /></Field>
        <Field label="Mobile" required><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required data-testid="lead-phone" /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Interested project"><Select value={f.project_id || ""} onValueChange={(v) => setF({ ...f, project_id: v })}><SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger><SelectContent>{(projects?.items || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Budget min ₹"><Input type="number" value={f.budget_min} onChange={(e) => setF({ ...f, budget_min: e.target.value })} /></Field><Field label="Budget max ₹"><Input type="number" value={f.budget_max} onChange={(e) => setF({ ...f, budget_max: e.target.value })} /></Field></div>
        <Field label="Source"><Select value={f.source} onValueChange={(v) => setF({ ...f, source: v })}><SelectTrigger data-testid="lead-source"><SelectValue /></SelectTrigger><SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Button type="submit" disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="lead-submit">Create lead</Button>
      </form></SheetContent></Sheet>
  );
}

function LeadCard({ lead, onDragStart, onOpen }) {
  const due = lead.next_follow_up_at && new Date(lead.next_follow_up_at) <= new Date();
  return (
    <div draggable onDragStart={onDragStart} onClick={onOpen} className="mb-2 cursor-grab rounded-lg border bg-white p-3 text-sm shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing" data-testid={`lead-card-${lead.id}`}>
      <div className="flex items-start justify-between"><p className="font-semibold text-navy">{lead.name}</p><span className="font-mono text-[10px] text-slate-400">{lead.lead_number}</span></div>
      <p className="flex items-center gap-1 text-xs text-slate-500"><Phone className="h-3 w-3" />{lead.phone}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]"><Pill tone="slate">{lead.source}</Pill>{lead.budget_max && <span className="text-slate-500">≤ {inrShort(lead.budget_max)}</span>}{lead.next_follow_up_at && <span className={`ml-auto flex items-center gap-1 ${due ? "font-semibold text-red-600" : "text-slate-500"}`}><CalendarClock className="h-3 w-3" />{fmtDate(lead.next_follow_up_at)}</span>}</div>
    </div>
  );
}

function LeadDrawer({ lead, onClose, onChanged }) {
  const nav = useNavigate();
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [l, setL] = useState(lead);
  useEffect(() => { api.get(`/leads/${lead.id}`).then((r) => setL(r.data)); }, [lead.id]);
  const follow = async () => { try { const r = await api.post(`/leads/${l.id}/follow-ups`, { note, next_follow_up_at: next ? new Date(next).toISOString() : null }); setL(r.data); setNote(""); setNext(""); toast.success("Follow-up logged"); onChanged(); } catch (e) { toast.error(errMsg(e)); } };
  const convert = async () => { try { const r = await api.post(`/leads/${l.id}/convert`, { version: l.version }); toast.success(`Converted → ${r.data.customer.customer_code}`); onChanged(); nav(`/customers/${r.data.customer.id}`); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}><SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="lead-drawer"><SheetHeader><SheetTitle>{l.name} <span className="font-mono text-sm text-slate-400">{l.lead_number}</span></SheetTitle><SheetDescription>{l.phone} · {l.email || "no email"} · {l.source}</SheetDescription></SheetHeader>
      <div className="mt-4 space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Pill tone={STAGE_TONE[l.status]}>{l.status}</Pill>{l.lost_reason && <span className="text-xs text-red-600">Lost: {l.lost_reason}</span>}{l.status !== "Converted" && l.status !== "Lost" && <Button size="sm" className="ml-auto bg-gold text-navy hover:bg-gold-hover" onClick={convert} data-testid="lead-convert-btn"><UserCheck className="mr-1 h-4 w-4" />Convert to customer</Button>}{l.converted_customer_id && <Button size="sm" variant="outline" className="ml-auto" onClick={() => nav(`/customers/${l.converted_customer_id}`)}>Open customer</Button>}</div>
        <div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Log follow-up</p><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed…" data-testid="followup-note" /><div className="mt-2 flex gap-2"><Input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} className="h-9" data-testid="followup-next" /><Button size="sm" onClick={follow} disabled={!note} className="bg-navy hover:bg-navy-700" data-testid="followup-submit">Save</Button></div></div>
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-ups</p>{(l.follow_ups || []).length === 0 ? <p className="text-slate-500">None yet</p> : [...l.follow_ups].reverse().map((f, i) => <div key={i} className="mb-2 rounded-md bg-surface p-2 text-xs"><p>{f.note}</p><p className="mt-1 text-slate-500">{f.by_name} · {fmtDateTime(f.at)}{f.next_follow_up_at && ` · next ${fmtDateTime(f.next_follow_up_at)}`}</p></div>)}</div>
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Stage history</p><ol className="space-y-1 text-xs">{(l.stage_history || []).map((s, i) => <li key={i} className="flex gap-2"><span className="w-28 text-slate-500">{fmtDate(s.at)}</span><Pill tone={STAGE_TONE[s.status]}>{s.status}</Pill>{s.note && <span className="text-slate-500">{s.note}</span>}</li>)}</ol></div>
      </div></SheetContent></Sheet>
  );
}

export default function Leads() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const websiteOnly = sp.get("source") === "Website";
  const [view, setView] = useState(websiteOnly ? "list" : "board");
  const [board, setBoard] = useState(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const [lost, setLost] = useState(null);
  const [reason, setReason] = useState("");
  const list = useList("/leads", { source: websiteOnly ? "Website" : undefined }, { sort: "-created_at" });
  const loadBoard = useCallback(() => api.get("/leads/board").then((r) => setBoard(r.data)).catch((e) => toast.error(errMsg(e))), []);
  useEffect(() => { loadBoard(); }, [loadBoard]);
  const refresh = () => { loadBoard(); list.reload(); };
  const move = async (lead, stage, lostReason) => {
    try { await api.post(`/leads/${lead.id}/stage`, { status: stage, lost_reason: lostReason || null, version: lead.version }); toast.success(`${lead.name} → ${stage}`); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const onDrop = (stage) => (e) => {
    e.preventDefault();
    const lead = JSON.parse(e.dataTransfer.getData("lead"));
    if (lead.status === stage) return;
    if (stage === "Converted") { setSel(lead); return; }
    if (stage === "Lost") { setLost(lead); return; }
    move(lead, stage);
  };
  const columns = [
    { key: "lead_number", label: "No.", sortable: true, render: (l) => <span className="font-mono text-xs font-semibold text-navy">{l.lead_number}</span> },
    { key: "name", label: "Lead", sortable: true, render: (l) => <div><p className="font-semibold text-navy">{l.name}</p><p className="text-xs text-slate-500">{l.phone}</p></div> },
    { key: "status", label: "Stage", sortable: true, render: (l) => <Pill tone={STAGE_TONE[l.status]}>{l.status}</Pill> },
    { key: "source", label: "Source", render: (l) => <span>{l.source}{l.is_read === false && <span className="ml-1 rounded-full bg-gold px-1.5 text-[10px] font-bold text-navy">NEW</span>}{l.project_name && <span className="block text-xs text-slate-500">{l.project_name}{l.flat_number ? ` · ${l.flat_number}` : ""}</span>}</span> },
    { key: "budget_max", label: "Budget", render: (l) => l.budget_max ? `${inrShort(l.budget_min || 0)} – ${inrShort(l.budget_max)}` : "—" },
    { key: "next_follow_up_at", label: "Next follow-up", sortable: true, render: (l) => l.next_follow_up_at ? fmtDateTime(l.next_follow_up_at) : "—" },
  ];
  return (
    <div data-testid="leads-page">
      <PageHeader title={websiteOnly ? "Website Enquiries" : "Leads"} subtitle={websiteOnly ? "Enquiries submitted on the public website (source: Website)." : "Sales pipeline — drag cards between stages."} actions={<div className="flex gap-2">
        <div className="flex rounded-md border bg-white p-0.5"><Button size="sm" variant={view === "board" ? "default" : "ghost"} className={view === "board" ? "bg-navy" : ""} onClick={() => setView("board")} data-testid="leads-view-board"><KanbanSquare className="h-4 w-4" /></Button><Button size="sm" variant={view === "list" ? "default" : "ghost"} className={view === "list" ? "bg-navy" : ""} onClick={() => setView("list")} data-testid="leads-view-list"><List className="h-4 w-4" /></Button></div>
        {can("lead.write") && <Button onClick={() => setOpen(true)} className="bg-navy hover:bg-navy-700" data-testid="new-lead-btn"><Plus className="mr-1 h-4 w-4" />New lead</Button>}</div>} />
      {view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-4" data-testid="leads-board">
          {(board?.columns || []).map((col) => <div key={col.stage} onDragOver={(e) => e.preventDefault()} onDrop={onDrop(col.stage)} className="w-64 shrink-0 rounded-xl bg-surface p-2" data-testid={`lead-column-${col.stage.replace(/\s+/g, "-")}`}>
            <div className="mb-2 flex items-center justify-between px-1"><Pill tone={STAGE_TONE[col.stage]}>{col.stage}</Pill><span className="text-xs font-semibold text-slate-500">{col.count}</span></div>
            <div className="min-h-[120px]">{col.leads.map((l) => <LeadCard key={l.id} lead={l} onOpen={() => setSel(l)} onDragStart={(e) => e.dataTransfer.setData("lead", JSON.stringify(l))} />)}</div>
          </div>)}
        </div>
      ) : <DataTable {...list} columns={columns} testId="leads-table" exportPath="/leads" searchPlaceholder="Name, phone, number…" onRowClick={(l) => setSel(l)} />}
      {open && <LeadForm open={open} onOpenChange={setOpen} onSaved={refresh} />}
      {sel && <LeadDrawer lead={sel} onClose={() => setSel(null)} onChanged={refresh} />}
      <Dialog open={!!lost} onOpenChange={(o) => !o && setLost(null)}><DialogContent data-testid="lead-lost-dialog"><DialogHeader><DialogTitle>Mark {lost?.name} as Lost</DialogTitle><DialogDescription>A reason is required.</DialogDescription></DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Budget mismatch, chose competitor…" data-testid="lead-lost-reason" />
        <Button disabled={reason.length < 3} className="bg-red-600 hover:bg-red-700" onClick={() => { move(lost, "Lost", reason); setLost(null); setReason(""); }} data-testid="lead-lost-confirm">Mark Lost</Button></DialogContent></Dialog>
    </div>
  );
}
