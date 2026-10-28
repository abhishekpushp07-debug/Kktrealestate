import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MoveMenu, moveKeyProps, useNarrow } from "@/components/v2/KanbanMove";
import { CalendarClock, CalendarDays, Download, Inbox, Phone, PhoneCall, Plus, TrendingUp, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import api, { errMsg } from "@/lib/api";
import { undoToast } from "@/lib/undo";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useList } from "@/hooks/useList";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, fmtRelative, inrShort } from "@/lib/format";
import { Card, EmptyState, Field, Skeleton, StatTile, StatusPill, Tabs } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { QuickCreateSelect } from "@/components/common/QuickCreateSelect";
import { Avatar, Segmented, usePeople } from "@/components/v2/CustomerBits";
import { Calendar, LeadVisits, NewVisit, VisitActions } from "@/pages/SiteVisits";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextActions } from "@/components/common/ContextActions";
import { useQuickCreate } from "@/components/common/QuickCreate";

const SOURCES = ["Walk-in", "Website", "Referral", "Broker", "Campaign", "Brochure", "Site Visit"];
const BANDS = [["Under ₹50 L", 0, 5000000], ["₹50 L – ₹1 Cr", 5000000, 10000000], ["₹1 – 1.5 Cr", 10000000, 15000000], ["₹1.5 – 2.5 Cr", 15000000, 25000000], ["Above ₹2.5 Cr", 25000000, null]];
const STAGE_STATUS = { New: "New", Contacted: "Scheduled", "Site Visit Scheduled": "Pending", "Site Visit Done": "In Progress", Negotiation: "Open", Converted: "Completed", Lost: "Cancelled" };
const todayIso = () => new Date().toISOString().slice(0, 10);

function LeadForm({ open, onOpenChange, onSaved, initial }) {
  const { user } = useAuth();
  const people = usePeople();
  const { data: projects, reload: reloadProjects } = useFetch("/projects?page_size=50");
  const qcProject = useQuickCreate("project", {}, async (p) => { await reloadProjects(); setF((x) => ({ ...x, project_id: p.id, flat_type_id: null })); });
  const { data: flatTypes } = useFetch("/master/flat-types?page_size=100");
  const [f, setF] = useState({ name: "", phone: "", email: "", project_id: null, flat_type_id: null, band: null, source: "Walk-in", assigned_to: user?.id || null, city_id: null, notes: "", ...initial });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const band = BANDS.find((b) => b[0] === f.band);
    try { const r = await api.post("/leads", { name: f.name, phone: f.phone, email: f.email || null, project_id: f.project_id, flat_type_id: f.flat_type_id, budget_min: band ? band[1] : null, budget_max: band ? band[2] : null, source: f.source, assigned_to: f.assigned_to, notes: f.notes || null }); toast.success(`Lead ${r.data.lead_number} created`); onSaved?.(); onOpenChange(false); }
    catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md" data-testid="lead-form"><SheetHeader><SheetTitle className="font-display text-2xl">New lead</SheetTitle><SheetDescription>Enquiries enter the pipeline at "New".</SheetDescription></SheetHeader>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="lead-name" /></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Mobile" required><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required data-testid="lead-phone" /></Field><Field label="Email"><input type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="lead-email" /></Field></div>
        <div className="grid grid-cols-2 gap-4"><Field label="Project"><Select onCreateNew={qcProject.onCreateNew} createLabel={qcProject.createLabel} options={(projects?.items || []).map((p) => ({ value: p.id, label: p.name, sub: p.code }))} value={f.project_id} onChange={(v) => setF({ ...f, project_id: v })} allowAdd={false} testId="lead-project" />{qcProject.node}</Field><Field label="Flat type"><QuickCreateSelect kind="flat_type" options={(flatTypes?.items || []).filter((t) => !f.project_id || t.project_id === f.project_id).map((t) => ({ value: t.id, label: t.name, sub: t.code }))} value={f.flat_type_id} onChange={(v) => setF({ ...f, flat_type_id: v })} allowAdd={false} testId="lead-flat-type" /></Field></div>
        <div className="grid grid-cols-2 gap-4"><Field label="Budget band"><Select options={BANDS.map((b) => ({ value: b[0], label: b[0] }))} value={f.band} onChange={(v) => setF({ ...f, band: v })} allowAdd={false} testId="lead-budget" /></Field><Field label="Source" required><Select options={SOURCES.map((s) => ({ value: s, label: s }))} value={f.source} onChange={(v) => setF({ ...f, source: v || "Walk-in" })} allowAdd={false} clearable={false} testId="lead-source" /></Field></div>
        <div className="grid grid-cols-2 gap-4"><Field label="Relationship manager"><Select options={people} value={f.assigned_to} onChange={(v) => setF({ ...f, assigned_to: v })} allowAdd={false} testId="lead-rm" /></Field><Field label="City"><Select type="city" value={f.city_id} onChange={(v) => setF({ ...f, city_id: v })} testId="lead-city" /></Field></div>
        <Field label="Notes"><textarea className="input !h-20 py-2" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="lead-notes" /></Field>
        <button type="submit" disabled={busy} className="btn btn-primary w-full" data-testid="lead-submit">{busy ? "Saving…" : "Create lead"}</button>
      </form></SheetContent></Sheet>
  );
}

function LeadCard({ lead, onDragStart, onOpen, people }) {
  const due = lead.next_follow_up_at && new Date(lead.next_follow_up_at) <= new Date();
  const rm = people.find((p) => p.value === lead.assigned_to)?.label;
  return (
    <div draggable onDragStart={onDragStart} onClick={onOpen} className="card card-hover mb-3 cursor-grab !p-4 text-sm active:cursor-grabbing" data-testid={`lead-card-${lead.id}`}>
      <div className="flex items-start gap-3"><Avatar name={lead.name} size={34} /><div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink-950">{lead.name}</p><p className="flex items-center gap-1 text-xs text-txt-secondary"><Phone className="h-3 w-3" />{lead.phone}</p></div>{lead.is_read === false && <span className="pill bg-gold text-ink-950">New</span>}</div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">{lead.project_name && <span className="pill bg-warm-100 text-txt-secondary">{lead.project_name}</span>}<span className="pill bg-slate2-50 text-slate2">{lead.source}</span>{lead.budget_max && <span className="pill bg-warm-100 text-txt-secondary">≤ {inrShort(lead.budget_max)}</span>}</div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-txt-muted"><span>{rm ? `RM · ${rm.split(" ")[0]}` : lead.lead_number}</span>{lead.next_follow_up_at && <span className={cn("flex items-center gap-1", due && "font-semibold text-brick")}><CalendarClock className="h-3 w-3" />{fmtDate(lead.next_follow_up_at)}</span>}</div>
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
  const open = l.status !== "Converted" && l.status !== "Lost";
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}><SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-lg" data-testid="lead-drawer">
      <SheetHeader><div className="flex items-center gap-3"><Avatar name={l.name} size={48} /><div><SheetTitle className="font-display text-2xl">{l.name} <HistoryButton entityType="lead" entityId={l.id} label={l.lead_number} /></SheetTitle><SheetDescription>{l.lead_number} · {l.phone} · {l.email || "no email"} · {l.source}</SheetDescription></div></div></SheetHeader>
      <div className="mt-5 space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2"><StatusPill status={STAGE_STATUS[l.status] || l.status} /><span className="text-xs text-txt-secondary">{l.status}</span>{l.lost_reason && <span className="text-xs text-brick">Lost: {l.lost_reason}</span>}{open && <button className="btn btn-primary btn-sm ml-auto" onClick={convert} data-testid="lead-convert-btn"><UserCheck className="h-4 w-4" />Convert to customer</button>}{l.converted_customer_id && <button className="btn btn-secondary btn-sm ml-auto" onClick={() => nav(`/customers/${l.converted_customer_id}`)} data-testid="lead-open-customer">Open customer</button>}</div>
        <Card className="!p-4"><p className="label mb-2">Log follow-up</p><textarea className="input !h-20 py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed…" data-testid="followup-note" /><div className="mt-2 flex gap-2"><input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} className="input" data-testid="followup-next" /><button onClick={follow} disabled={!note} className="btn btn-primary" data-testid="followup-submit">Save</button></div></Card>
        <div><p className="label mb-2">Follow-ups</p>{(l.follow_ups || []).length === 0 ? <p className="text-txt-muted">None yet</p> : [...l.follow_ups].reverse().map((f) => <div key={f.id || `${f.at}-${f.note}`} className="mb-2 rounded-xl bg-white p-3 text-xs ring-1 ring-warm-200"><p className="text-ink-950">{f.note}</p><p className="mt-1 text-txt-secondary">{f.by_name} · {fmtDateTime(f.at)}{f.next_follow_up_at && ` · next ${fmtDateTime(f.next_follow_up_at)}`}</p></div>)}</div>
        <LeadVisits leadId={l.id} lead={l} />
        {(l.activities || []).length > 0 && <div><p className="label mb-2">Timeline</p><ol className="space-y-1.5 text-xs" data-testid="lead-timeline">{[...l.activities].reverse().map((a) => <li key={a.id} className="flex gap-2"><span className="w-28 shrink-0 text-txt-muted">{fmtDateTime(a.at)}</span><span className={a.type.includes("cancel") || a.type.includes("no_show") ? "text-brick" : "text-ink-950"} data-testid={`activity-${a.type}`}>{a.title}</span></li>)}</ol></div>}
        <div><p className="label mb-2">Stage history</p><ol className="space-y-1.5 text-xs">{(l.stage_history || []).map((s) => <li key={`${s.at}-${s.stage}`} className="flex items-center gap-2"><span className="w-24 text-txt-muted">{fmtDate(s.at)}</span><StatusPill status={STAGE_STATUS[s.status] || s.status} /><span className="text-txt-secondary">{s.status}{s.note ? ` · ${s.note}` : ""}</span></li>)}</ol></div>
      </div></SheetContent></Sheet>
  );
}

export default function Leads() {
  const { can } = useAuth();
  const nav = useNavigate();
  const people = usePeople();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || (sp.get("source") === "Website" ? "enquiries" : "pipeline");
  const [board, setBoard] = useState(null);
  const [open, setOpen] = useState(sp.get("new") === "1");
  const [leadInit] = useState(sp.get("project_id") ? { project_id: sp.get("project_id") } : {});
  const [sel, setSel] = useState(null);
  const [lost, setLost] = useState(null);
  const [reason, setReason] = useState("");
  const [newVisit, setNewVisit] = useState(false);
  const [visitView, setVisitView] = useState("calendar");
  const [projectId, setProjectId] = useState(null);
  const list = useList("/leads", { source: tab === "enquiries" ? "Website" : undefined, project_id: projectId || undefined }, { sort: "-created_at", pageSize: 30 });
  const visits = useList("/site-visits", { project_id: projectId || undefined }, { sort: "-date", pageSize: 30 });
  const today = useFetch("/site-visits/today");
  const brochure = useFetch(`/site-visits/brochure-stats${projectId ? `?project_id=${projectId}` : ""}`);
  const { data: projects } = useFetch("/projects?page_size=50");
  const loadBoard = useCallback(() => api.get("/leads/board", { params: { project_id: projectId || undefined } }).then((r) => setBoard(r.data)).catch((e) => toast.error(errMsg(e))), [projectId]);
  const loadMore = (col) => api.get("/leads/board", { params: { project_id: projectId || undefined, stage: col.stage, page: (col.page || 1) + 1 } })
    .then((r) => { const more = r.data.columns[0]; setBoard((b) => b && { ...b, columns: b.columns.map((c) => (c.stage === col.stage ? { ...c, leads: [...c.leads, ...more.leads], page: more.page, has_more: more.has_more } : c)) }); })
    .catch((e) => toast.error(errMsg(e)));
  useEffect(() => { loadBoard(); }, [loadBoard]);
  const refresh = () => { loadBoard(); list.reload(); };
  const all = useMemo(() => (board?.columns || []).flatMap((c) => c.leads), [board]);
  const kpis = useMemo(() => { const t = todayIso(), m30 = new Date(Date.now() - 30 * 864e5).toISOString(); const recent = all.filter((l) => l.created_at >= m30); return { newToday: all.filter((l) => l.created_at?.slice(0, 10) === t).length, due: all.filter((l) => l.next_follow_up_at && l.next_follow_up_at <= new Date().toISOString() && !["Converted", "Lost"].includes(l.status)).length, conv: recent.length ? Math.round((recent.filter((l) => l.status === "Converted").length / recent.length) * 100) : 0 }; }, [all]);
  // Optimistic stage move: the card jumps immediately, the server call follows; failure rolls back, success offers Undo (moves it back).
  const move = async (lead, stage, lostReason) => {
    const prev = lead.status;
    const snapshot = board;
    setBoard((b) => b && { ...b, columns: b.columns.map((c) => ({ ...c, leads: c.stage === stage ? [{ ...lead, status: stage }, ...c.leads.filter((l) => l.id !== lead.id)] : c.leads.filter((l) => l.id !== lead.id), count: c.stage === stage ? c.count + 1 : c.stage === prev ? Math.max(0, c.count - 1) : c.count })) });
    try {
      const r = await api.post(`/leads/${lead.id}/stage`, { status: stage, lost_reason: lostReason || null, version: lead.version });
      const moved = r.data?.lead || r.data || {};
      undoToast({ title: `${lead.name} → ${stage}`, description: `Moved from ${prev}`, testId: `lead-move-${lead.id}`, onUndo: async () => {
        const u = await api.post(`/leads/${lead.id}/stage`, { status: prev, note: "Undo", version: moved.version ?? null });
        setBoard((b) => b && { ...b, columns: b.columns.map((c) => ({ ...c, leads: c.stage === prev ? [{ ...lead, ...u.data, status: prev }, ...c.leads.filter((l) => l.id !== lead.id)] : c.leads.filter((l) => l.id !== lead.id) })) });
        refresh();
        return `Reverted · ${lead.name} back in ${prev}`;
      } });
      refresh();
    } catch (e) { setBoard(snapshot); toast.error(errMsg(e)); }
  };
  const onDrop = (stage) => (e) => { e.preventDefault(); const lead = JSON.parse(e.dataTransfer.getData("lead")); moveTo(lead, stage); };
  const moveTo = (lead, stage) => { if (lead.status === stage) return; if (stage === "Converted") return setSel(lead); if (stage === "Lost") return setLost(lead); move(lead, stage); };
  const narrow = useNarrow();
  const stageNames = (board?.columns || []).map((c) => c.stage);
  const Row = ({ l }) => <li onClick={() => setSel(l)} className="flex cursor-pointer flex-wrap items-center gap-3 px-6 py-3 hover:bg-warm-50 md:flex-nowrap" data-testid={`lead-row-${l.lead_number}`}><Avatar name={l.name} size={36} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{l.name} <span className="font-mono text-xs font-normal text-txt-muted">{l.lead_number}</span>{l.is_read === false && <span className="pill ml-2 bg-gold text-ink-950">unread</span>}</p><p className="truncate text-xs text-txt-secondary">{l.phone}{l.project_name ? ` · ${l.project_name}` : ""}{l.flat_number ? ` · ${l.flat_number}` : ""} · {fmtRelative(l.created_at)}</p></div><span className="pill bg-slate2-50 text-slate2">{l.source}</span><span className="hidden text-xs text-txt-secondary md:block">{l.budget_max ? `≤ ${inrShort(l.budget_max)}` : "—"}</span><StatusPill status={STAGE_STATUS[l.status] || l.status} /><span className="w-28 text-right text-xs text-txt-secondary">{l.next_follow_up_at ? fmtDate(l.next_follow_up_at) : "—"}</span></li>;
  return (
    <div className="space-y-8" data-testid="leads-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="label">Sales funnel</p><h1 className="mt-1 font-display text-4xl text-ink-950">Leads & Visits</h1></div>
        <div className="flex flex-wrap gap-2"><Select options={(projects?.items || []).map((p) => ({ value: p.id, label: p.name, sub: p.code }))} value={projectId} onChange={setProjectId} placeholder="All projects" allowAdd={false} className="w-52" testId="leads-filter-project" />{can("sales.site_visit.create") && <button onClick={() => setNewVisit(true)} className="btn btn-secondary" data-testid="visits-new"><CalendarDays className="h-4 w-4" strokeWidth={1.75} />Book visit</button>}{can("sales.lead.create") && <button onClick={() => setOpen(true)} className="btn btn-primary" data-testid="new-lead-btn"><Plus className="h-4 w-4" strokeWidth={1.75} />New lead</button>}</div>
      </header>
      <ContextActions testId="lead-context-actions" items={[
        { label: "New lead", onClick: () => setOpen(true), perm: "sales.lead.create", primary: true },
        { label: "Schedule site visit", onClick: () => setNewVisit(true), perm: "sales.site_visit.create" },
        { label: "New customer", to: "/customers/new", perm: "sales.customer.create" },
        { label: "New booking", to: "/bookings/new", perm: "sales.booking.create" },
      ]} />
      <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" data-testid="lead-tiles">
        {!board ? [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />) : <>
          <StatTile label="New today" value={String(kpis.newToday)} hint={`${all.length} leads in pipeline`} icon={UserPlus} testId="tile-new" />
          <StatTile label="Follow-ups due" value={String(kpis.due)} hint="calls waiting right now" icon={PhoneCall} iconTone={kpis.due ? "brick" : undefined} tone={kpis.due ? "brick" : undefined} testId="tile-due" />
          <StatTile label="Visits today" value={String(today.data?.items?.length ?? 0)} hint={today.data?.items?.[0] ? `${today.data.items[0].slot_start} ${today.data.items[0].name}` : "no visits scheduled"} icon={CalendarDays} testId="tile-visits" />
          <StatTile label="Conversion · 30 d" value={`${kpis.conv}%`} hint="converted ÷ leads created" icon={TrendingUp} iconTone="gold" testId="tile-conversion" />
        </>}
      </section>
      <Tabs tabs={[{ value: "pipeline", label: "Pipeline" }, { value: "list", label: "List" }, { value: "enquiries", label: "Enquiries", count: tab === "enquiries" ? list.total : undefined }, { value: "visits", label: "Site visits" }, { value: "brochure", label: "Brochure downloads" }]} value={tab} onChange={(v) => setSp({ tab: v })} testId="leads-tabs" />
      {tab === "pipeline" && <div className="flex gap-4 overflow-x-auto pb-4 scroll-x" data-testid="leads-board">
        {(board?.columns || []).map((col) => <div key={col.stage} onDragOver={(e) => e.preventDefault()} onDrop={onDrop(col.stage)} className="w-72 shrink-0 rounded-2xl bg-warm-100/70 p-3" data-testid={`lead-column-${col.stage.replace(/\s+/g, "-")}`}>
          <div className="mb-3 flex items-center justify-between px-1"><p className="text-sm font-semibold text-ink-950">{col.stage}</p><span className="pill bg-white text-txt-secondary">{col.count}</span></div>
          <div className="min-h-[120px]">{col.leads.map((l) => <div key={l.id} {...moveKeyProps(stageNames, col.stage, (to) => moveTo(l, to))} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-gold" aria-label={`${l.name}, ${col.stage}. Use arrow keys to move.`}><LeadCard lead={l} people={people} onOpen={() => setSel(l)} onDragStart={(e) => e.dataTransfer.setData("lead", JSON.stringify(l))} />{narrow && <div className="-mt-2 mb-3"><MoveMenu columns={stageNames} current={col.stage} onMove={(to) => moveTo(l, to)} testId={`lead-move-${l.id}`} /></div>}</div>)}{col.has_more && <button type="button" onClick={() => loadMore(col)} className="mt-2 w-full rounded-xl border border-dashed border-warm-300 py-2 text-xs font-semibold text-txt-secondary hover:bg-white" data-testid={`load-more-${col.stage}`}>Load more ({col.count - col.leads.length} more)</button>}</div>
        </div>)}
      </div>}
      {(tab === "list" || tab === "enquiries") && <Card className="!p-0" testId={tab === "list" ? "leads-table" : "enquiries-list"}>
        <div className="flex items-center gap-3 px-6 py-4"><input value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder="Name, phone, number…" className="input max-w-sm" data-testid="leads-search" />{tab === "enquiries" && <span className="text-xs text-txt-secondary">Website & brochure enquiries · {list.total}</span>}</div>
        {list.items.length === 0 ? <div className="p-6"><EmptyState icon={Inbox} title={tab === "enquiries" ? "No enquiries" : "No leads"} testId="leads-empty" /></div> : <ul className="divide-y divide-warm-100">{list.items.map((l) => <Row key={l.id} l={l} />)}</ul>}
      </Card>}
      {tab === "visits" && <div className="space-y-6" data-testid="visits-tab">
        <Segmented options={[{ value: "calendar", label: "Week calendar" }, { value: "list", label: "Day list" }]} value={visitView} onChange={setVisitView} testId="visits-view" />
        {visitView === "calendar" ? <Calendar projectId={projectId || ""} /> : <Card className="!p-0"><ul className="divide-y divide-warm-100" data-testid="visits-list">{visits.items.length === 0 && <li className="px-6 py-10 text-center text-sm text-txt-muted">No visits</li>}{visits.items.map((v) => <li key={v.id} className="flex flex-wrap items-center gap-3 px-6 py-3 md:flex-nowrap" data-testid={`visit-row-${v.visit_number}`}><span className="w-24 font-display text-base text-ink-950">{v.slot_start}</span><Avatar name={v.name} size={34} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{v.name} <span className="font-mono text-xs font-normal text-txt-muted">{v.visit_number}</span></p><p className="truncate text-xs text-txt-secondary">{fmtDate(v.date)} · {v.project_name} · {v.phone} · {v.visitors_count} pax · {v.assigned_to_name || "Unassigned"}</p></div><StatusPill status={v.status} /><VisitActions v={v} onDone={() => { visits.reload(); today.reload(); }} /></li>)}</ul></Card>}
      </div>}
      {tab === "brochure" && <Card testId="brochure-card">
        <div className="flex items-center justify-between"><h3 className="font-display text-lg">Brochure downloads · last 30 days</h3><span className="pill bg-warm-100 text-txt-secondary">{brochure.data?.last_30 ?? 0} downloads</span></div>
        {brochure.data ? <div className="mt-6 flex h-40 items-end gap-1" data-testid="brochure-series">{brochure.data.series.map((d) => { const mx = Math.max(1, ...brochure.data.series.map((x) => x.count)); return <div key={d.date} title={`${fmtDate(d.date)} · ${d.count}`} className="flex-1 rounded-t bg-ink-950" style={{ height: `${Math.max(3, (d.count / mx) * 100)}%`, opacity: d.count ? 1 : 0.15 }} />; })}</div> : <Skeleton className="mt-6 h-40" />}
        <p className="mt-3 text-xs text-txt-secondary">{brochure.data?.brochure_leads_week ?? 0} brochure leads this week{brochure.data?.total ? ` · ${brochure.data.total} all-time for this project` : ""}</p>
        {can("sales.lead.export") && <button onClick={() => nav("/leads?tab=list")} className="btn btn-secondary btn-sm mt-4"><Download className="h-3.5 w-3.5" />See brochure leads</button>}
      </Card>}
      {open && <LeadForm open={open} onOpenChange={setOpen} onSaved={refresh} initial={leadInit} />}
      {sel && <LeadDrawer lead={sel} onClose={() => setSel(null)} onChanged={refresh} />}
      {newVisit && <NewVisit open onClose={() => setNewVisit(false)} onSaved={() => { visits.reload(); today.reload(); }} />}
      <Dialog open={!!lost} onOpenChange={(o) => !o && setLost(null)}><DialogContent className="v2" data-testid="lead-lost-dialog"><DialogHeader><DialogTitle className="font-display text-2xl">Mark {lost?.name} as Lost</DialogTitle><DialogDescription>A reason is required.</DialogDescription></DialogHeader>
        <textarea className="input !h-20 py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Budget mismatch, chose competitor…" data-testid="lead-lost-reason" />
        <button disabled={reason.length < 3} className="btn btn-danger" onClick={() => { move(lost, "Lost", reason); setLost(null); setReason(""); }} data-testid="lead-lost-confirm">Mark Lost</button></DialogContent></Dialog>
    </div>
  );
}
