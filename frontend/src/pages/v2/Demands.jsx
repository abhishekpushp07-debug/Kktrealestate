import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { fmtDate, inr, inrShort } from "@/lib/format";
import { Card, EmptyState, Skeleton, StatusPill } from "@/components/v2";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { HistoryButton } from "@/components/common/HistoryTimeline";

const Sel = ({ value, onChange, children, testId, disabled }) => <select className="input !h-9 !w-auto text-sm" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid={testId}>{children}</select>;
const Kpi = ({ label, value, hint, tone, testId }) => <div className={cn("rounded-2xl border border-warm-200 bg-white px-4 py-3", tone === "brick" && "border-brick/30 bg-brick/5")} data-testid={testId}><p className="text-[11px] font-semibold uppercase text-txt-muted">{label}</p><p className={cn("font-display text-[22px] tabular-nums text-ink-950", tone === "brick" && "text-brick")}>{value ?? "—"}</p>{hint && <p className="text-[11px] text-txt-secondary">{hint}</p>}</div>;
const Tot = ({ t, bold }) => <>{["cash_paise", "account_paise", "other_paise", "total_paise", "paid_paise", "balance_paise"].map((k) => <td key={k} className={cn("px-3 py-2 text-right tabular-nums", bold && "font-semibold text-ink-950", k === "paid_paise" && "text-sage", k === "balance_paise" && t[k] > 0 && "text-brick")}>{inr(t[k] / 100)}</td>)}</>;
const month0 = () => new Date().toISOString().slice(0, 7);
const PRESETS = { today: 0, "7d": 7, "30d": 30, month: "month" };

export default function Demands() {
  const { can } = useAuth();
  const [basis, setBasis] = useState("raised");
  const [f, setF] = useState({ date_from: "", date_to: "", project_id: "", block_id: "", stage: "", plan: "", status: "", source: "", bucket: "", customer: "" });
  const [opts, setOpts] = useState({ projects: [], towers: [] });
  const [data, setData] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [cal, setCal] = useState(null);
  const [month, setMonth] = useState(month0());
  const [open, setOpen] = useState({});
  const [manual, setManual] = useState(false);
  const [voidRow, setVoidRow] = useState(null);
  const params = useMemo(() => ({ basis, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }), [basis, f]);
  const load = () => { api.get("/demands/register", { params }).then((r) => { setData(r.data); setOpen((o) => Object.keys(o).length ? o : Object.fromEntries(r.data.groups.slice(0, 1).map((g) => [g.date, true]))); }).catch((e) => toast.error(errMsg(e))); api.get("/demands/kpis", { params: { project_id: f.project_id || undefined, block_id: f.block_id || undefined } }).then((r) => setKpis(r.data)); };
  useEffect(() => { load(); }, [params]); // eslint-disable-line
  useEffect(() => { api.get("/demands/calendar", { params: { month, basis, project_id: f.project_id || undefined, block_id: f.block_id || undefined } }).then((r) => setCal(r.data)); }, [month, basis, f.project_id, f.block_id]);
  useEffect(() => { api.get("/docgen/options", { params: { project_id: f.project_id || undefined } }).then((r) => setOpts(r.data)).catch(() => {}); }, [f.project_id]);
  const preset = (k) => { const t = new Date(); if (k === "month") setF({ ...f, date_from: t.toISOString().slice(0, 8) + "01", date_to: t.toISOString().slice(0, 10) }); else setF({ ...f, date_from: new Date(Date.now() - PRESETS[k] * 864e5).toISOString().slice(0, 10), date_to: t.toISOString().slice(0, 10) }); };
  const stages = useMemo(() => [...new Set((data?.groups || []).flatMap((g) => g.projects.flatMap((p) => p.towers.flatMap((t) => t.rows.map((r) => r.stage)))).filter(Boolean))], [data]);
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const remind = async (r) => { try { await api.post(`/demands/${r.id}/reminder-sent`); toast.success("Reminder marked sent"); load(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-5" data-testid="demands-page">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-2xl text-ink-950">Demand register</h1><p className="text-xs text-txt-secondary">Every rupee raised — by day, project and tower. Figures are the ledger's Udhar rows.</p></div>
        <div className="flex flex-wrap gap-2">{can("demands.register.create") && <Button className="bg-ink-950 hover:bg-ink-800" onClick={() => setManual(true)} data-testid="demands-manual-btn"><Plus className="mr-1 h-4 w-4" />Manual demand</Button>}<a href={`${BASE_PATH}/api/demands/register?${new URLSearchParams({ ...params, format: "csv" })}`} className="btn btn-secondary" data-testid="demands-csv">CSV</a></div></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="demands-kpis">
        <Kpi label="Raised today" value={kpis && inrShort(kpis.raised_today_paise / 100)} hint={kpis && `${kpis.raised_today_count} demand(s)`} testId="kpi-raised-today" /><Kpi label="Raised this month" value={kpis && inrShort(kpis.raised_month_paise / 100)} hint={kpis && `${kpis.raised_month_count} demand(s)`} testId="kpi-raised-month" /><Kpi label="Due this week" value={kpis && inrShort(kpis.due_week_paise / 100)} hint={kpis && `${kpis.due_week_count} demand(s)`} testId="kpi-due-week" /><Kpi label="Overdue" value={kpis && inrShort(kpis.overdue_paise / 100)} hint={kpis && `${kpis.overdue_count} demand(s)`} tone={kpis?.overdue_paise > 0 ? "brick" : undefined} testId="kpi-overdue" /><Kpi label="Collection on raised" value={kpis && (kpis.collection_pct != null ? `${kpis.collection_pct}%` : "—")} testId="kpi-collection" />
      </div>
      <Card testId="demands-controls"><div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-warm-200 p-0.5 text-xs" data-testid="demands-basis">{[["raised", "Raised on"], ["due", "Due on"]].map(([k, l]) => <button key={k} onClick={() => setBasis(k)} className={cn("rounded-full px-3 py-1 font-semibold", basis === k ? "bg-ink-950 text-warm-50" : "text-txt-secondary")} data-testid={`basis-${k}`}>{l}</button>)}</div>
        {Object.keys(PRESETS).map((k) => <button key={k} onClick={() => preset(k)} className="pill bg-warm-100 text-xs" data-testid={`preset-${k}`}>{k === "today" ? "Today" : k === "month" ? "This month" : `Last ${k}`}</button>)}
        <input type="date" className="input !h-9 !w-auto text-xs" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} data-testid="f-from" /><input type="date" className="input !h-9 !w-auto text-xs" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} data-testid="f-to" />
        <Sel value={f.project_id} onChange={(v) => setF({ ...f, project_id: v, block_id: "" })} testId="f-project"><option value="">All projects</option>{opts.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel value={f.block_id} onChange={(v) => setF({ ...f, block_id: v })} disabled={!f.project_id} testId="f-tower"><option value="">All towers</option>{opts.towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Sel>
        <Sel value={f.stage} onChange={(v) => setF({ ...f, stage: v })} testId="f-stage"><option value="">Any stage</option>{stages.map((s) => <option key={s}>{s}</option>)}</Sel>
        <Sel value={f.status} onChange={(v) => setF({ ...f, status: v })} testId="f-status"><option value="">Any status</option>{(data?.statuses || []).map((s) => <option key={s}>{s}</option>)}</Sel>
        <Sel value={f.source} onChange={(v) => setF({ ...f, source: v })} testId="f-source"><option value="">Any source</option>{Object.entries(data?.sources || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Sel>
        <Sel value={f.bucket} onChange={(v) => setF({ ...f, bucket: v })} testId="f-bucket"><option value="">Any bucket</option><option value="cash">Cash</option><option value="account">Account</option></Sel>
        <input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} placeholder="Customer / booking / flat" className="input !h-9 !w-52 text-xs" data-testid="f-customer" />
        {Object.values(f).some(Boolean) && <button onClick={() => setF({ date_from: "", date_to: "", project_id: "", block_id: "", stage: "", plan: "", status: "", source: "", bucket: "", customer: "" })} className="text-xs underline" data-testid="f-clear">clear</button>}
      </div></Card>
      <Card className="!p-3" testId="demands-calendar"><div className="flex items-center justify-between px-1 text-xs"><button onClick={() => setMonth(new Date(new Date(month + "-01").setMonth(new Date(month + "-01").getMonth() - 1)).toISOString().slice(0, 7))} data-testid="cal-prev">‹</button><span className="font-semibold text-ink-950">{new Date(month + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" })} · {basis === "due" ? "due" : "raised"}</span><button onClick={() => setMonth(new Date(new Date(month + "-01").setMonth(new Date(month + "-01").getMonth() + 1)).toISOString().slice(0, 7))} data-testid="cal-next">›</button></div>
        <div className="mt-2 grid grid-cols-7 gap-1 md:grid-cols-[repeat(31,minmax(0,1fr))]">{Array.from({ length: new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate() }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, "0")}`; const c = cal?.days.find((x) => x.date === d); const h = c && cal.max_paise ? Math.max(8, Math.round((c.total_paise / cal.max_paise) * 40)) : 0; return <button key={d} onClick={() => setF({ ...f, date_from: d, date_to: d })} className={cn("flex flex-col items-center justify-end rounded-md pb-1 text-[10px] hover:bg-warm-100", f.date_from === d && f.date_to === d && "bg-gold-light")} title={c ? `${inr(c.total_paise / 100)} · ${c.count}` : "—"} data-testid={`cal-day-${d}`}><span className="w-3 rounded-sm bg-gold" style={{ height: h }} /><span className="text-txt-secondary">{i + 1}</span></button>; })}</div></Card>
      <Card className="!p-0" testId="demands-groups">
        {!data ? <Skeleton className="h-64" /> : data.groups.length === 0 ? <EmptyState title="Nothing raised in this range" description="Change the date basis or widen the filters." testId="demands-empty" /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-warm-50 text-left text-[11px] uppercase text-txt-muted"><tr><th className="px-3 py-2">Day ▸ Project ▸ Tower</th><th className="px-3 py-2 text-right">Cash</th><th className="px-3 py-2 text-right">Account</th><th className="px-3 py-2 text-right">Other</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2 text-right">#</th></tr></thead>
          <tbody>{data.groups.map((g) => <GroupRows key={g.date} g={g} open={open} toggle={toggle} can={can} onVoid={setVoidRow} onRemind={remind} />)}
            <tr className="border-t-2 border-ink-950 bg-warm-50 font-semibold text-ink-950" data-testid="demands-grand-total"><td className="px-3 py-2">Total · {data.row_count} demand(s)</td><Tot t={data.totals} bold /><td className="px-3 py-2 text-right">{data.totals.count}</td></tr></tbody></table></div>}
      </Card>
      <ManualSheet open={manual} onOpenChange={setManual} opts={opts} onSaved={load} />
      <VoidDialog row={voidRow} onClose={() => setVoidRow(null)} onDone={load} />
    </div>
  );
}

function GroupRows({ g, open, toggle, can, onVoid, onRemind }) {
  const today = new Date().toISOString().slice(0, 10);
  const k = g.date, o = !!open[k];
  return (<>
    <tr className="cursor-pointer border-t border-warm-200 bg-warm-50/60 font-semibold text-ink-950 hover:bg-warm-100" onClick={() => toggle(k)} data-testid={`group-day-${g.date}`}><td className="px-3 py-2">{o ? <ChevronDown className="mr-1 inline h-3.5 w-3.5" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5" />}{fmtDate(g.date)}{g.date === today && <span className="pill ml-2 bg-gold-light text-[10px]">today</span>}</td><Tot t={g.totals} bold /><td className="px-3 py-2 text-right">{g.totals.count}</td></tr>
    {o && g.projects.map((p) => { const pk = `${k}|${p.project_id}`; const po = open[pk] !== false; return (<GroupP key={pk} pk={pk} p={p} po={po} toggle={toggle} open={open} can={can} onVoid={onVoid} onRemind={onRemind} today={today} />); })}
  </>);
}

function GroupP({ pk, p, po, toggle, open, can, onVoid, onRemind, today }) {
  return (<>
    <tr className="cursor-pointer border-t border-warm-100 text-ink-950" onClick={() => toggle(pk)} data-testid={`group-project-${pk}`}><td className="px-3 py-1.5 pl-8 font-semibold">{po ? "▾" : "▸"} {p.project_name}</td><Tot t={p.totals} /><td className="px-3 py-1.5 text-right">{p.totals.count}</td></tr>
    {po && p.towers.map((t) => { const tk = `${pk}|${t.block_id}`; const to = open[tk] !== false; return (<GroupT key={tk} tk={tk} t={t} to={to} toggle={toggle} can={can} onVoid={onVoid} onRemind={onRemind} today={today} />); })}
  </>);
}

function GroupT({ tk, t, to, toggle, can, onVoid, onRemind, today }) {
  return (<>
    <tr className="cursor-pointer border-t border-warm-100 text-txt-secondary" onClick={() => toggle(tk)} data-testid={`group-tower-${tk}`}><td className="px-3 py-1.5 pl-14 font-semibold">{to ? "▾" : "▸"} {t.block_name}</td><Tot t={t.totals} /><td className="px-3 py-1.5 text-right">{t.totals.count}</td></tr>
    {to && t.rows.map((r) => <tr key={r.id} className={cn("border-t border-warm-100/70 text-xs", r.voided && "opacity-50")} data-testid={`demand-row-${r.demand_number}`}>
      <td className="px-3 py-1.5 pl-20"><div className="flex flex-wrap items-center gap-x-2"><span className={cn("font-semibold text-ink-950", r.voided && "line-through")}>{r.demand_number}</span><span className="text-txt-muted">{fmtDate(r.demand_date)} → due {fmtDate(r.due_date)}</span><Link to={`/customers/${r.customer_id}`} className="font-medium text-ink-950 hover:text-gold">{r.customer_name}</Link><span>{r.booking_number} · {r.flat_number}</span><StatusPill status={r.status} />{r.age_band && <span className="pill bg-brick/10 text-[10px] text-brick">{r.age_band} d</span>}<span className="pill bg-warm-100 text-[10px]">{r.source_label}</span></div><p className="text-[11px] text-txt-secondary">why: {r.why || "—"}{r.voided && ` · Voided: ${r.void_reason}`}</p></td>
      <Tot t={r} /><td className="px-3 py-1.5 text-right"><div className="flex justify-end gap-0.5">{can("demands.register.print") && !r.voided && <a href={`${BASE_PATH}/api/bookings/${r.booking_id}/demands/${r.id}/letter.pdf`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title="Print letter" data-testid={`print-${r.demand_number}`}><Printer className="h-3.5 w-3.5" /></a>}{can("demands.register.print") && !r.voided && r.status !== "Paid" && <button onClick={() => onRemind(r)} className="btn btn-ghost btn-sm text-[10px]" title={r.reminder_sent_at ? `Reminder sent ${fmtDate(r.reminder_sent_at)}` : "Mark reminder sent"} data-testid={`remind-${r.demand_number}`}>{r.reminder_sent_at ? "✓ rem" : "rem"}</button>}{can("demands.register.void") && !r.voided && r.paid_paise === 0 && <button onClick={() => onVoid(r)} className="btn btn-ghost btn-sm text-[10px] text-brick" data-testid={`void-${r.demand_number}`}>void</button>}<HistoryButton entityType="demand" entityId={r.id} label={r.demand_number} compact testId={`history-${r.demand_number}`} /></div></td></tr>)}
    {t.more > 0 && <tr><td colSpan={8} className="px-3 py-1 pl-20 text-[11px] text-txt-muted">+ {t.more} more — narrow the filters or export CSV</td></tr>}
  </>);
}

function ManualSheet({ open, onOpenChange, opts, onSaved }) {
  const [f, setF] = useState({ project_id: "", block_id: "", booking_id: "", kind: "manual", name: "", cash_amount: "", account_amount: "", due_date: "", note: "" });
  const [bk, setBk] = useState([]);
  const [effect, setEffect] = useState(null);
  const [towers, setTowers] = useState([]);
  useEffect(() => { if (!f.project_id) return; api.get("/docgen/options", { params: { project_id: f.project_id, block_id: f.block_id || undefined } }).then((r) => { setTowers(r.data.towers); setBk(r.data.bookings.filter((b) => b.status === "Active")); }); }, [f.project_id, f.block_id]);
  const body = { booking_id: f.booking_id, kind: f.kind, name: f.name, cash_amount: Number(f.cash_amount) || 0, account_amount: Number(f.account_amount) || 0, due_date: f.due_date, note: f.note || null };
  useEffect(() => { if (!f.booking_id || !(body.cash_amount + body.account_amount) || !f.due_date || f.name.length < 2) { setEffect(null); return; } api.post("/demands/manual", { ...body, preview: true }).then((r) => setEffect(r.data.effect)).catch(() => setEffect(null)); }, [f]); // eslint-disable-line
  const save = async () => { try { const r = await api.post("/demands/manual", body); toast.success(`${r.data.demand_number} raised · Udhar +${inr(r.data.effect.udhar_delta_paise / 100)}`); onOpenChange(false); onSaved(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]" data-testid="manual-demand-sheet"><SheetHeader><SheetTitle>Manual demand</SheetTitle></SheetHeader>
      <div className="mt-4 grid gap-2 text-sm">
        <Sel value={f.project_id} onChange={(v) => setF({ ...f, project_id: v, block_id: "", booking_id: "" })} testId="md-project"><option value="">Project…</option>{opts.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel value={f.block_id} onChange={(v) => setF({ ...f, block_id: v, booking_id: "" })} disabled={!f.project_id} testId="md-tower"><option value="">Tower…</option>{towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Sel>
        <Sel value={f.booking_id} onChange={(v) => setF({ ...f, booking_id: v })} disabled={!f.project_id} testId="md-booking"><option value="">Booking…</option>{bk.map((b) => <option key={b.id} value={b.id}>{b.customer_name} · {b.booking_number} · {b.flat_snapshot?.flat_number}</option>)}</Sel>
        <Sel value={f.kind} onChange={(v) => setF({ ...f, kind: v })} testId="md-kind"><option value="manual">Manual</option><option value="other_charge">Other charge</option><option value="bounce">Bounce charge</option></Sel>
        <input className="input !h-9" placeholder="Charge / installment name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="md-name" />
        <div className="grid grid-cols-2 gap-2"><input type="number" className="input !h-9" placeholder="Cash ₹" value={f.cash_amount} onChange={(e) => setF({ ...f, cash_amount: e.target.value })} data-testid="md-cash" /><input type="number" className="input !h-9" placeholder="Account ₹" value={f.account_amount} onChange={(e) => setF({ ...f, account_amount: e.target.value })} data-testid="md-account" /></div>
        <input type="date" className="input !h-9" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} data-testid="md-due" />
        <input className="input !h-9" placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} data-testid="md-note" />
        {effect && <div className="rounded-xl bg-warm-50 p-3 text-xs" data-testid="md-effect"><p className="font-semibold text-ink-950">Ledger effect · {effect.booking_number}</p><p>Udhar +{inr(effect.udhar_delta_paise / 100)} → balance {inr((effect.balance_before_paise || 0) / 100)} → <b>{inr(effect.balance_after_paise / 100)}</b></p></div>}
        <Button disabled={!effect} onClick={save} className="bg-ink-950 hover:bg-ink-800" data-testid="md-save">Raise demand</Button>
      </div></SheetContent></Sheet>
  );
}

function VoidDialog({ row, onClose, onDone }) {
  const [reason, setReason] = useState("");
  if (!row) return null;
  const go = async () => { try { const r = await api.post(`/demands/${row.id}/void`, { reason }); toast.success(r.data.ledger_held_it ? `${r.data.demand_number} voided · Udhar ${inr(r.data.udhar_delta_paise / 100)} on ${r.data.booking_number}` : `${r.data.demand_number} voided · ledger unchanged (it never carried this demand)`); setReason(""); onClose(); onDone(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4" data-testid="void-dialog"><div className="w-full max-w-md rounded-2xl bg-white p-5"><h3 className="font-display text-lg text-ink-950">Void {row.demand_number}?</h3><p className="mt-1 text-xs text-txt-secondary">Ledger effect: Udhar −{inr(row.total_paise / 100)} on {row.booking_number}. Voiding is final — it cannot be undone.</p><textarea className="input mt-3 h-20 w-full" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="void-reason" /><div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={onClose} data-testid="void-cancel">Cancel</Button><Button disabled={reason.length < 3} onClick={go} className="bg-brick hover:bg-brick/90" data-testid="void-confirm">Void demand</Button></div></div></div>
  );
}
