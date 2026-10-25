import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Download, List, Plus } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/common/DateInput";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const VISIT_TONE = { Confirmed: "navy", Rescheduled: "amber", Completed: "green", "No-show": "red", Cancelled: "slate" };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const STATUSES = ["Confirmed", "Rescheduled", "Completed", "No-show", "Cancelled"];

export function SlotPicker({ projectId, value, onChange, excludeId }) {
  const [from, setFrom] = useState(() => { const d = new Date(Date.now() + 330 * 60000); d.setUTCHours(0, 0, 0, 0); return d; });
  const [jumped, setJumped] = useState(false);
  const { data } = useFetch(projectId ? `/site-visits/availability?project_id=${projectId}&date_from=${iso(from)}&date_to=${iso(addDays(from, 6))}` : null);
  useEffect(() => { if (!jumped && data && data.days.every((d) => !d.slots.length)) { setJumped(true); setFrom(addDays(from, 7)); } }, [data]); // eslint-disable-line
  return <div data-testid="slot-picker">
    <div className="mb-2 flex items-center justify-between text-xs"><button type="button" onClick={() => setFrom(addDays(from, -7))} className="rounded border p-1" aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button><span className="font-semibold text-ink-950">{fmtDate(iso(from))} – {fmtDate(iso(addDays(from, 6)))}</span><button type="button" onClick={() => setFrom(addDays(from, 7))} className="rounded border p-1" aria-label="Next week"><ChevronRight className="h-4 w-4" /></button></div>
    <div className="grid grid-cols-7 gap-1 text-[11px]">{(data?.days || []).map((d) => <div key={d.date} className="rounded-md border bg-white p-1"><p className="mb-1 text-center font-bold text-ink-950">{new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}</p>{d.slots.length === 0 ? <p className="text-center text-txt-muted">—</p> : d.slots.map((s) => <button type="button" key={s.start} onClick={() => onChange({ date: d.date, slot_start: s.start })} className={cn("mb-1 w-full rounded px-1 py-1 tabular-nums", value?.date === d.date && value?.slot_start === s.start ? "bg-ink-950 text-white" : "bg-warm-50 hover:bg-gold/30")} data-testid={`slot-${d.date}-${s.start}`}>{s.start}<span className="ml-1 opacity-70">({s.available_count})</span></button>)}</div>)}</div>
  </div>;
}

export function NewVisit({ open, onClose, onSaved, lead }) {
  const { data: projects } = useFetch("/projects?page_size=50");
  const [f, setF] = useState({ project_id: lead?.project_id || "", name: lead?.name || "", phone: lead?.phone || "", email: lead?.email || "", visitors_count: 1, notes: "", lead_id: lead?.id || null });
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!slot) return toast.error("Pick a slot");
    setBusy(true);
    try { await api.post("/site-visits", { ...f, visitors_count: Number(f.visitors_count), email: f.email || null, notes: f.notes || null, ...slot }); toast.success("Visit booked"); onSaved(); onClose(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(o) => !o && onClose()}><DialogContent className="max-w-2xl" data-testid="visit-create-dialog"><DialogHeader><DialogTitle>New site visit</DialogTitle></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Project" required><Select value={f.project_id} onValueChange={(v) => { setF({ ...f, project_id: v }); setSlot(null); }}><SelectTrigger data-testid="visit-form-project"><SelectValue placeholder="Project" /></SelectTrigger><SelectContent>{(projects?.items || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Visitors"><Input type="number" min="1" max="6" value={f.visitors_count} onChange={(e) => setF({ ...f, visitors_count: e.target.value })} data-testid="visit-form-visitors" /></Field>
      <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="visit-form-name" /></Field>
      <Field label="Phone" required><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="visit-form-phone" /></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="visit-form-notes" /></Field>
    </div>
    {f.project_id && <SlotPicker projectId={f.project_id} value={slot} onChange={setSlot} />}
    <Button onClick={save} disabled={busy || !f.project_id || !f.name || !f.phone} className="bg-ink-950 hover:bg-ink-800" data-testid="visit-form-submit">Book visit{slot && ` · ${fmtDate(slot.date)} ${slot.slot_start}`}</Button>
  </DialogContent></Dialog>;
}

export function VisitActions({ v, onDone, compact }) {
  const { can } = useAuth();
  const [mode, setMode] = useState(null);
  const [note, setNote] = useState("");
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!can("visit.write")) return null;
  const act = async (action, body = {}) => { setBusy(true); try { await api.post(`/site-visits/${v.id}/${action}`, body); toast.success(`Marked ${action}`); setMode(null); setNote(""); onDone(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  const open = !["Completed", "No-show", "Cancelled"].includes(v.status);
  return <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
    {open && <><Button size="sm" variant="outline" className="h-8 text-sage" disabled={busy} onClick={() => act("complete")} data-testid={`visit-complete-${v.visit_number}`}>Complete</Button><Button size="sm" variant="outline" className="h-8 text-brick" disabled={busy} onClick={() => act("no-show")} data-testid={`visit-noshow-${v.visit_number}`}>No-show</Button>
      {!compact && <><Button size="sm" variant="outline" className="h-8" onClick={() => setMode("reschedule")} data-testid={`visit-reschedule-${v.visit_number}`}>Reschedule</Button><Button size="sm" variant="ghost" className="h-8 text-txt-secondary" onClick={() => setMode("cancel")} data-testid={`visit-cancel-${v.visit_number}`}>Cancel</Button></>}</>}
    {!open && v.status === "Cancelled" && !compact && <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => act("confirm")} data-testid={`visit-confirm-${v.visit_number}`}>Re-confirm</Button>}
    <Dialog open={!!mode} onOpenChange={(o) => !o && setMode(null)}><DialogContent className="max-w-2xl" data-testid="visit-action-dialog"><DialogHeader><DialogTitle>{mode === "cancel" ? "Cancel visit" : "Reschedule visit"} · {v.visit_number}</DialogTitle></DialogHeader>
      {mode === "reschedule" && <SlotPicker projectId={v.project_id} value={slot} onChange={setSlot} excludeId={v.id} />}
      <Field label={mode === "cancel" ? "Reason" : "Note"} required={mode === "cancel"}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="visit-action-note" /></Field>
      <Button disabled={busy || (mode === "cancel" ? !note : !slot)} className="bg-ink-950 hover:bg-ink-800" onClick={async () => { if (mode === "cancel") return act("cancel", { note }); setBusy(true); try { await api.post(`/site-visits/${v.id}/reschedule`, { ...slot, note: note || null }); toast.success("Rescheduled"); setMode(null); onDone(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } }} data-testid="visit-action-submit">{mode === "cancel" ? "Cancel visit" : "Reschedule"}</Button>
    </DialogContent></Dialog>
  </div>;
}

export function Calendar({ projectId, onChanged }) {
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + 1); return d; });
  const [view, setView] = useState("week");
  const days = view === "week" ? 7 : 1;
  const { data, reload } = useFetch(`/site-visits/calendar?date_from=${iso(start)}&date_to=${iso(addDays(start, days - 1))}${projectId ? `&project_id=${projectId}` : ""}`);
  const projects = (data?.projects || []).filter((p) => p.settings.enabled || (data?.items || []).some((v) => v.project_id === p.id));
  const hours = useMemo(() => { const set = new Set(); projects.forEach((p) => { const [sh] = p.settings.start_time.split(":").map(Number); const [eh] = p.settings.end_time.split(":").map(Number); for (let h = sh; h < eh; h++) set.add(h); }); return [...set].sort((a, b) => a - b); }, [projects]);
  const today = iso(new Date());
  return <div className="card p-4" data-testid="visit-calendar">
    <div className="mb-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => setStart(addDays(start, -days))} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={() => setStart(addDays(start, days))} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => { const d = new Date(); if (view === "week") d.setDate(d.getDate() - d.getDay() + 1); setStart(d); }}>Today</Button><span className="text-sm font-bold text-ink-950">{fmtDate(iso(start))}{days > 1 && ` – ${fmtDate(iso(addDays(start, 6)))}`}</span>
      <div className="ml-auto flex rounded-md border text-xs font-semibold">{["day", "week"].map((m) => <button key={m} onClick={() => setView(m)} className={cn("px-3 py-1.5 capitalize", view === m ? "bg-ink-950 text-white" : "text-txt-secondary")} data-testid={`cal-view-${m}`}>{m}</button>)}</div></div>
    <div className="scroll-x overflow-auto"><table className="w-full border-separate border-spacing-0 text-xs"><thead><tr><th className="sticky left-0 z-10 w-14 bg-white text-left text-txt-secondary">IST</th>{Array.from({ length: days }).map((_, i) => { const d = iso(addDays(start, i)); return <th key={d} className={cn("border-l px-2 py-2 text-left", d === today && "bg-gold/10")}>{new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</th>; })}</tr></thead>
      <tbody>{hours.map((h) => <tr key={h}><td className="sticky left-0 z-10 bg-white py-1 pr-2 align-top font-semibold tabular-nums text-txt-secondary">{String(h).padStart(2, "0")}:00</td>{Array.from({ length: days }).map((_, i) => { const d = iso(addDays(start, i)); const cell = (data?.items || []).filter((v) => v.date === d && Number(v.slot_start.slice(0, 2)) === h); return <td key={d} className={cn("min-w-[140px] border-l border-t p-1 align-top", d === today && "bg-gold/5")}>{projects.map((p) => { const vs = cell.filter((v) => v.project_id === p.id); return vs.length ? <div key={p.id} className="mb-1"><p className="truncate text-[10px] font-semibold uppercase tracking-wide text-txt-muted">{p.name}<span className="ml-1 normal-case tracking-normal">{vs.filter((v) => v.status !== "Cancelled").length}/{p.settings.capacity_per_slot}</span></p>{vs.map((v) => <div key={v.id} className={cn("mb-0.5 rounded px-1.5 py-1", v.status === "Cancelled" ? "bg-warm-50 text-txt-muted line-through" : v.status === "Completed" ? "bg-sage-50 text-sage" : v.status === "No-show" ? "bg-brick-50 text-brick" : "bg-warm-100 text-ink-950")} title={`${v.visit_number} · ${v.phone}`} data-testid={`cal-chip-${v.visit_number}`}><span className="font-semibold">{v.name}</span> <span className="opacity-70">·{v.visitors_count}</span>{v.status === "Rescheduled" && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber2" title="Rescheduled to this slot">moved</span>}{v.assigned_to_name && <span className="block text-[10px] opacity-70">{v.assigned_to_name}</span>}</div>)}</div> : null; })}</td>; })}</tr>)}</tbody></table></div>
  </div>;
}

export default function SiteVisits() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const view = sp.get("view") || "calendar";
  const [f, setF] = useState({ project_id: "", status: "", date_from: "", date_to: "" });
  const [create, setCreate] = useState(false);
  const { data: projects } = useFetch("/projects?page_size=50");
  const list = useList("/site-visits", Object.fromEntries(Object.entries(f).filter(([, v]) => v)), { sort: "-date" });
  const exportUrl = `/site-visits/export?${new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).toString()}`;
  const columns = [
    { key: "visit_number", label: "Visit", render: (v) => <span className="font-mono text-xs">{v.visit_number}</span> },
    { key: "date", label: "When", render: (v) => <span className="tabular-nums">{fmtDate(v.date)} · {v.slot_start}–{v.slot_end}</span> },
    { key: "name", label: "Visitor", render: (v) => <span>{v.name}<span className="block text-xs text-txt-secondary">{v.phone} · {v.visitors_count} pax</span></span> },
    { key: "project_name", label: "Project" },
    { key: "assigned_to_name", label: "RM", render: (v) => v.assigned_to_name || "—" },
    { key: "status", label: "Status", render: (v) => <Pill tone={VISIT_TONE[v.status]}>{v.status}</Pill> },
    { key: "actions", label: "", render: (v) => <VisitActions v={v} onDone={list.reload} /> },
  ];
  return <div data-testid="site-visits-page">
    <PageHeader title="Site Visits" subtitle="Website bookings and walk-ins, by slot and project." actions={<div className="flex gap-2"><div className="flex rounded-md border text-xs font-semibold">{[["calendar", CalendarDays], ["list", List]].map(([m, I]) => <button key={m} onClick={() => setSp({ view: m })} className={cn("flex items-center gap-1 px-3 py-2 capitalize", view === m ? "bg-ink-950 text-white" : "text-txt-secondary")} data-testid={`visits-view-${m}`}><I className="h-3.5 w-3.5" />{m}</button>)}</div>{can("visit.read") && <Button variant="outline" onClick={() => api.get(exportUrl, { responseType: "blob" }).then((r) => { const u = URL.createObjectURL(r.data); const a = document.createElement("a"); a.href = u; a.download = "site-visits.csv"; a.click(); URL.revokeObjectURL(u); })} data-testid="visits-export"><Download className="mr-1.5 h-4 w-4" />CSV</Button>}{can("visit.write") && <Button onClick={() => setCreate(true)} className="bg-ink-950 hover:bg-ink-800" data-testid="visits-new"><Plus className="mr-1.5 h-4 w-4" />New visit</Button>}</div>} />
    <div className="mb-4 flex flex-wrap gap-2" data-testid="visit-filters">
      <Select value={f.project_id || "all"} onValueChange={(v) => setF({ ...f, project_id: v === "all" ? "" : v })}><SelectTrigger className="w-48" data-testid="visit-filter-project"><SelectValue placeholder="All projects" /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{(projects?.items || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
      {view === "list" && <><Select value={f.status || "all"} onValueChange={(v) => setF({ ...f, status: v === "all" ? "" : v })}><SelectTrigger className="w-40" data-testid="visit-filter-status"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
        <DateInput value={f.date_from} onChange={(v) => setF({ ...f, date_from: v })} placeholder="From" data-testid="visit-filter-from" /><DateInput value={f.date_to} onChange={(v) => setF({ ...f, date_to: v })} placeholder="To" data-testid="visit-filter-to" /></>}
    </div>
    {view === "calendar" ? <Calendar projectId={f.project_id} /> : <DataTable columns={columns} items={list.items} loading={list.loading} total={list.total} page={list.page} setPage={list.setPage} search={list.search} setSearch={list.setSearch} testId="visits-table" />}
    {create && <NewVisit open onClose={() => setCreate(false)} onSaved={list.reload} />}
  </div>;
}

export function LeadVisits({ leadId, lead }) {
  const { data, reload } = useFetch(`/site-visits?lead_id=${leadId}&page_size=20&sort=-date`);
  const [create, setCreate] = useState(false);
  const { can } = useAuth();
  const items = data?.items || [];
  return <div data-testid="lead-visits"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-txt-secondary">Site visits</p>{can("visit.write") && <button onClick={() => setCreate(true)} className="text-xs font-semibold text-ink-950 underline" data-testid="lead-book-visit">Book a visit</button>}</div>
    {items.length === 0 ? <p className="text-xs text-txt-secondary">No visits yet</p> : items.map((v) => <div key={v.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-warm-50 p-2 text-xs"><span><b className="tabular-nums">{fmtDate(v.date)} {v.slot_start}</b> · {v.project_name} <span className="font-mono text-txt-muted">{v.visit_number}</span></span><span className="flex items-center gap-2"><Pill tone={VISIT_TONE[v.status]}>{v.status}</Pill><VisitActions v={v} onDone={reload} compact /></span></div>)}
    {create && <NewVisit open onClose={() => setCreate(false)} onSaved={reload} lead={lead} />}
  </div>;
}

export function TodayVisitsWidget() {
  const { can } = useAuth();
  const { data, reload } = useFetch(can("visit.read") ? "/site-visits/today" : null);
  if (!can("visit.read") || !data) return null;
  return <div className="card mt-6 p-5" data-testid="today-visits-widget"><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold text-ink-950 md:text-lg">Today's site visits</h2><span className="text-xs text-txt-secondary">{data.items.length} scheduled</span></div>
    {data.items.length === 0 ? <p className="text-sm text-txt-secondary">No visits today.</p> : <div className="divide-y">{data.items.map((v) => <div key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-sm" data-testid={`today-visit-${v.visit_number}`}><span className="w-14 font-bold tabular-nums text-ink-950">{v.slot_start}</span><span className="min-w-0 flex-1"><b>{v.name}</b> · {v.project_name}<span className="block text-xs text-txt-secondary">{v.assigned_to_name || "Unassigned"} · {v.visitors_count} pax</span></span><Pill tone={VISIT_TONE[v.status]}>{v.status}</Pill><VisitActions v={v} onDone={reload} compact /></div>)}</div>}
  </div>;
}
