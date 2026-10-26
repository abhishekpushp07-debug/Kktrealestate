import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Download, FileText, Printer, Save, Trash2, Pencil, BarChart3, Receipt, CalendarClock, Building2, Users, Wrench, Activity, Check, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";
import api, { errMsg } from "@/lib/api";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useList";
import { inr, inrShort, fmtDate } from "@/lib/format";
import { Card, StatTile, Skeleton, EmptyState } from "@/components/v2";
import { Segmented } from "@/components/v2/CustomerBits";
import { DateInput } from "@/components/common/DateInput";
import { cn } from "@/lib/utils";
import { FILTERS, permFor, GROUP_LABEL, GROUP_ORDER } from "@/lib/reportsMeta";
const GROUP_ICON = { Finance: Receipt, Sales: Users, Construction: Building2, Operations: Wrench, Admin: Activity };

const COLORS = ["#0A0C10", "#C9A227", "#5B7F6A", "#B8573E", "#8E95A3", "#2A313C"];
const DESC = {
  collections: "Receipts by period, split across Cash, Account and Other-charges ledgers.", outstanding: "Dues by customer, block or project with ageing buckets.", advances: "Customers who have paid ahead of their demands.", "demand-vs-collection": "Demanded vs collected per milestone/installment.", "upcoming-dues": "Forecast of demands that will trigger soon.", inventory: "Available / hold / booked / sold inventory with velocity and realised rates.", cheques: "Cheques in hand, bounced or cleared.", cancellations: "Cancelled bookings and refunds.", "sales-leads": "Lead funnel, enquiries and response times.", "roznamcha-range": "Day-book totals across a date range.", "bank-receipts": "Receipts grouped by bank account.", activity: "Who did what, when.",
  "service-sla": "Tickets by category and status, SLA met %, average resolution time and customer ratings.", "construction-progress": "Per-tower stage status, planned vs actual dates, site photos and demands raised per stage.",
};
const MAP = { group_by_out: "group_by", group_by_inv: "group_by", cheque_status: "status", group: "group_by" };
const iso = (d) => d.toISOString().slice(0, 10);
const PRESET_DATES = {
  Today: () => { const t = iso(new Date()); return { from_date: t, to_date: t }; },
  "This month": () => { const d = new Date(); return { from_date: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to_date: iso(d) }; },
  FY: () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return { from_date: `${y}-04-01`, to_date: iso(d) }; },
  Custom: () => ({}),
};

function cell(col, v) {
  if (v == null || v === "") return "—";
  if (col.type === "money") return inr(v / 100);
  if (col.type === "pct") return `${v}%`;
  if (col.type === "date") return fmtDate(v);
  return String(v);
}
export function openPdf(path) {
  api.get(path, { responseType: "blob" }).then((r) => { const url = URL.createObjectURL(r.data); window.open(url, "_blank"); }).catch((e) => toast.error(errMsg(e)));
}
const Sel = ({ value, onChange, children, testId, label }) => <select className="input !h-10 !w-auto min-w-[130px] !py-0 text-sm" value={value} onChange={onChange} data-testid={testId} aria-label={label || testId}>{children}</select>;

function kpis(key, d) {
  if (!d) return [];
  const t = d.totals || {};
  const m = (v) => inrShort((v || 0) / 100);
  if (key === "collections-v2") return [["Net Jama", m(t.total_paise), `${t.count || 0} ledger rows`], ["Cash", m(t.cash_paise)], ["Account", m(t.account_paise)], ["Pending instruments", m(t.pending_paise), `${t.pending_instruments || 0} not yet cleared`, t.pending_paise ? "brick" : undefined]];
  if (key === "outstanding-v2") return [["Udhar raised", m(t.udhar_paise)], ["Jama received", m(t.jama_paise)], ["Balance (Udhar − Jama)", m(t.balance_paise), `${t.bookings || 0} live bookings`, t.balance_paise > 0 ? "brick" : "sage"], ["Overdue", m(t.overdue_paise), `advance held ${m(t.advance_paise)}`, t.overdue_paise > 0 ? "brick" : undefined]];
  if (key === "cash-vs-account") return [["Cash agreed", m(t.cash_agreed_paise), `raised ${m(t.cash_raised_paise)}`], ["Cash balance", m(t.cash_balance_paise), undefined, t.cash_balance_paise ? "brick" : "sage"], ["Account agreed", m(t.account_agreed_paise), `raised ${m(t.account_raised_paise)}`], ["Variance", String(t.variance || "—"), `${t.bookings || 0} bookings`]];
  if (key === "receivables-forecast") return [["Still to raise", m(t.expected_paise), "Σ forecast"], ["Expected Cash", m(t.cash_paise)], ["Expected Account", m(t.account_paise)], ["Agreement total", m(t.agreement_paise), `raised ${m(t.raised_paise)} · forecast + raised = agreement`, "sage"]];
  if (key === "other-charges") return [["Demanded (Udhar)", m(t.demanded_paise), `${t.lines || 0} lines`], ["Collected (Jama)", m(t.collected_paise)], ["Balance", m(t.balance_paise), undefined, t.balance_paise ? "brick" : "sage"], ["% collected", t.pct_collected != null ? `${t.pct_collected}%` : "—"]];
  if (key === "roznamcha-summary") return [["Opening cash", m(t.opening_paise)], ["Cash received", m(t.cash_in_paise), `${t.receipts || 0} receipts`], ["Deposited", m(t.deposit_paise), `withdrawn ${m(t.withdrawal_paise)}`], ["Closing cash", m(t.closing_paise), undefined, "sage"]];
  if (key === "site-visits") return [["Visits", String(t.scheduled ?? 0)], ["Completed", String(t.completed ?? 0), `${t.show_pct ?? 0}% show-up`], ["No-show / cancelled", String((t.no_show || 0) + (t.cancelled || 0)), undefined, (t.no_show || 0) ? "brick" : undefined], ["Visit → booking", `${t.conversion_pct ?? 0}%`, `${t.converted || 0} bookings`, "sage"]];
  if (key === "sales-team") return [["Leads", String(t.leads ?? 0)], ["Bookings", String(t.bookings ?? 0), m(t.sold_paise)], ["Collections", m(t.collected_paise)], ["Overdue", m(t.overdue_paise), "across their customers", t.overdue_paise ? "brick" : undefined]];
  if (key === "construction-vs-plan") return [["Towers", String(d.rows?.length || 0)], ["Stages done", `${t.completed ?? 0} / ${t.stages ?? 0}`], ["Stage demands", m(t.stage_demanded_paise), `collected ${m(t.stage_collected_paise)}`], ["Next-stage Udhar", m(t.next_expected_paise), "expected on completion"]];
  if (key === "data-quality") return [["Records to review", String(t.count ?? 0), t.status, t.count ? "brick" : "sage"], ["Checks", String(d.rows?.length || 0)], ["Integrity", d.integrity ? (d.integrity.ok ? "OK" : "Findings") : "—", d.integrity?.ran_at ? fmtDate(d.integrity.ran_at) : undefined, d.integrity && !d.integrity.ok ? "brick" : "sage"]];
  if (key === "collections") return [["Collected", inrShort((t.total_paise || 0) / 100), `${d.rows.length} periods`], ["Cash", inrShort((t.cash_paise || 0) / 100)], ["Account", inrShort((t.account_paise || 0) / 100)], ["Other charges", inrShort((t.other_paise || 0) / 100), t.gst_collected_paise != null ? `GST ${inrShort(t.gst_collected_paise / 100)}` : undefined]];
  if (key === "outstanding") return [["Raised", inrShort((t.raised_paise || 0) / 100)], ["Paid", inrShort((t.paid_paise || 0) / 100)], ["Due", inrShort((t.due_paise || 0) / 100), "all ledgers", t.due_paise > 0 ? "brick" : "sage"], ["Overdue", inrShort((t.overdue_paise || 0) / 100), `${d.top_overdue?.length || 0} customers`, t.overdue_paise > 0 ? "brick" : undefined]];
  if (key === "inventory") return [["Units", String(t.total ?? 0)], ["Available", String(t.available ?? 0), inrShort((t.available_value_paise || 0) / 100)], ["Booked", String((t.booked || 0) + (t.hold || 0)), `${t.hold || 0} on hold`], ["Sold", String(t.sold ?? 0), inrShort((t.sold_value_paise || 0) / 100), "sage"]];
  if (key === "sales-leads") return [["Leads", String((d.funnel || []).reduce((a, s) => a + s.count, 0))], ["Avg response", d.avg_response_hours != null ? `${d.avg_response_hours} h` : "—"], ["Follow-ups overdue", String(d.follow_ups_overdue ?? 0), undefined, d.follow_ups_overdue ? "brick" : undefined], ["Web enquiries", String((d.enquiries_per_project || []).reduce((a, e) => a + e.count, 0))]];
  if (key === "service-sla") return [["Tickets", String(t.total ?? 0), `${t.open ?? 0} open`], ["SLA met", t.sla_met_pct != null ? `${t.sla_met_pct}%` : "—", "resolved within SLA", t.sla_met_pct != null && t.sla_met_pct < 80 ? "brick" : "sage"], ["Avg resolution", t.avg_resolution_h != null ? `${t.avg_resolution_h} h` : "—"], ["Avg rating", t.avg_rating != null ? `${t.avg_rating} ★` : "—", "closed tickets"]];
  if (key === "construction-progress") { const tw = d.towers || []; return [["Towers", String(tw.length), `${tw.filter((x) => x.pct === 100).length} possession ready`], ["Avg progress", tw.length ? `${Math.round(tw.reduce((a, x) => a + x.pct, 0) / tw.length)}%` : "—", "stages completed"], ["Site photos", String(t.photos ?? 0)], ["Stage demands", String(t.demands ?? 0), inrShort((t.demand_paise || 0) / 100)]]; }
  if (key === "activity") return [["Audit rows", String((d.actions || []).reduce((a, x) => a + x.count, 0)), `${(d.actions || []).length} action types`], ["Logins", String(t.success ?? 0)], ["Failed logins", String(t.failed ?? 0), undefined, t.failed ? "brick" : undefined], ["Users seen", String(d.rows?.length || 0)]];
  if (key === "cheques") return [["Instruments", String(d.rows?.length || 0), inrShort((t.amount_paise || 0) / 100)], ...Object.entries(d.by_status || {}).slice(0, 3).map(([k, v]) => [k, String(v.count), inrShort(v.amount_paise / 100), k === "Bounced" ? "brick" : k === "Cleared" ? "sage" : undefined])];
  const money = Object.entries(t).filter(([k]) => k.endsWith("_paise")).slice(0, 4);
  if (money.length) return money.map(([k, v]) => [k.replace(/_paise$/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), inrShort((v || 0) / 100)]);
  return [["Rows", String(d.rows?.length || 0)]];
}

export default function Reports() {
  const { can } = useAuth();
  const { key = "collections-v2" } = useParams();
  const nav = useNavigate();
  const { data: list } = useFetch("/reports");
  const { data: projects } = useFetch("/projects?page_size=50");
  const [f, setF] = useState({ group_by: "month", group_by_out: "customer", group_by_inv: "block", cheque_status: "All", group: "", ...PRESET_DATES.FY() });
  useEffect(() => { setF((p) => ({ ...p, group: "" })); }, [key]);
  const [range, setRange] = useState("FY");
  const [presetName, setPresetName] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [activePreset, setActivePreset] = useState(null);
  const { data: presets, reload: reloadPresets } = useFetch(`/reports/presets?report_key=${key}`, [key]);
  const params = useMemo(() => Object.fromEntries(Object.entries(f).filter(([k, v]) => v && v !== "All" && FILTERS[key]?.includes(k)).map(([k, v]) => [MAP[k] || k, v])), [f, key]);
  const qs = new URLSearchParams(params).toString();
  const { data, loading } = useFetch(`/reports/${key}${qs ? `?${qs}` : ""}`, [key, qs]);
  const meta = (list?.items || []).find((r) => r.key === key);
  useEffect(() => { document.title = `Reports · ${meta?.name || key}`; }, [key, meta]);
  const set = (k) => (e) => { setActivePreset(null); setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e })); };
  const has = (k) => FILTERS[key]?.includes(k);
  const chart = data && (key === "collections" ? { type: "bar", rows: data.rows.map((r) => ({ name: r.period, Cash: r.cash_paise / 100, Account: r.account_paise / 100, Other: r.other_paise / 100 })), keys: ["Cash", "Account", "Other"], stacked: true }
    : key === "outstanding" ? { type: "pie", rows: data.ageing.map((a) => ({ name: a.bucket, value: a.amount_paise / 100 })) }
    : key === "sales-leads" ? { type: "bar", rows: data.funnel.map((s) => ({ name: s.stage, Leads: s.count })), keys: ["Leads"] }
    : key === "inventory" ? { type: "bar", rows: data.velocity.map((v) => ({ name: v.month, Bookings: v.bookings })), keys: ["Bookings"] }
    : key === "service-sla" ? { type: "bar", rows: data.rows.map((r) => ({ name: r.category, Open: r.open, Resolved: r.resolved })), keys: ["Open", "Resolved"], stacked: true }
    : key === "construction-progress" ? { type: "bar", rows: (data.towers || []).map((x) => ({ name: x.tower, Progress: x.pct })), keys: ["Progress"] }
    : key === "demand-vs-collection" ? { type: "bar", rows: data.rows.slice(0, 20).map((r) => ({ name: r.milestone.split(". ")[1] || r.milestone, Demanded: r.demand_paise / 100, Collected: r.collected_paise / 100 })), keys: ["Demanded", "Collected"] } : null);
  const download = () => api.get(`/reports/${key}`, { params: { ...params, format: "csv" }, responseType: "blob" }).then((r) => { const a = document.createElement("a"); a.href = URL.createObjectURL(r.data); a.download = `${key}.csv`; a.click(); }).catch((e) => toast.error(errMsg(e)));
  const savePreset = async () => { try { const r = await api.post("/reports/presets", { report_key: key, name: presetName.trim(), filters: f }); setPresetName(""); setActivePreset(r.data.id); reloadPresets(); toast.success("Preset saved"); } catch (e) { toast.error(errMsg(e)); } };
  const items = presets?.items || [];
  return (
    <div className="space-y-8" data-testid="reports-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="label">Insight</p><h1 className="mt-1 font-display text-4xl text-ink-950">Reports</h1></div>
        <div className="flex gap-2 print:hidden">
          {can(`${permFor(key)}.export`) && <button className="btn btn-secondary" onClick={download} data-testid="rf-export-csv"><Download className="h-4 w-4" />CSV</button>}
          {can(`${permFor(key)}.export`) && <button className="btn btn-secondary" onClick={() => openPdf(`/reports/${key}?${qs}&format=pdf`)} data-testid="rf-export-pdf"><FileText className="h-4 w-4" />PDF</button>}
          <button className="btn btn-primary" onClick={() => window.print()} data-testid="rf-print"><Printer className="h-4 w-4" />Print</button>
        </div>
      </header>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[260px_1fr]">
        <aside className="min-w-0 print:hidden">
          <Card className="!p-3" testId="report-list">
            {GROUP_ORDER.map((gname) => { const rs = (list?.items || []).filter((r) => r.group === gname && !r.hidden && can(`${permFor(r.key)}.view`)); if (!rs.length) return null; const Icon = GROUP_ICON[gname] || BarChart3; return (
              <div key={gname} className="mb-3 last:mb-0">
                <p className="flex items-center gap-2 px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-txt-muted"><Icon className="h-3.5 w-3.5" />{gname}</p>
                {rs.map((r) => <button key={r.key} onClick={() => nav(`/reports/${r.key}`)} title={r.purpose} className={cn("block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors", r.key === key ? "bg-ink-950 font-semibold text-warm-50" : "text-ink-950 hover:bg-warm-100")} data-testid={`report-${r.key}`}>{r.name}</button>)}
              </div>); })}
          </Card>
        </aside>
        <section className="min-w-0 space-y-6">
          {!can(`${permFor(key)}.view`) ? <EmptyState icon={ShieldAlert} title="Access restricted" description={`Your role lacks the ${permFor(key)}.view permission.`} testId="forbidden-report" /> : <>
          <div><h2 className="font-display text-2xl text-ink-950" data-testid="report-title">{meta?.name || key}</h2><p className="mt-1 text-sm text-txt-secondary" data-testid="report-purpose">{meta?.purpose || DESC[key]}</p>{data?.as_of && <p className="mt-1 text-xs text-txt-muted" data-testid="report-asof">As of {fmtDate(data.as_of)}{data.filters_text ? ` · ${data.filters_text}` : ""}</p>}</div>
          <Card className="space-y-4 print:hidden" testId="report-filters">
            <div className="flex flex-wrap items-center gap-3">
              {has("from_date") && <Segmented options={Object.keys(PRESET_DATES).map((k) => ({ value: k, label: k }))} value={range} onChange={(v) => { setRange(v); setActivePreset(null); setF((p) => ({ ...p, ...PRESET_DATES[v]() })); }} testId="rf-range" />}
              {has("from_date") && range === "Custom" && <><DateInput value={f.from_date || ""} onChange={set("from_date")} className="input !h-10 w-40" data-testid="rf-from" /><span className="text-txt-muted">→</span><DateInput value={f.to_date || ""} onChange={set("to_date")} className="input !h-10 w-40" data-testid="rf-to" /></>}
              {has("from_date") && range !== "Custom" && <span className="text-sm text-txt-secondary" data-testid="rf-range-text">{fmtDate(f.from_date)} – {fmtDate(f.to_date)}</span>}
              {has("project_id") && <Sel value={f.project_id || ""} onChange={set("project_id")} testId="rf-project"><option value="">All projects</option>{(projects?.items || []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Sel>}
              {has("mode") && <Sel value={f.mode || ""} onChange={set("mode")} testId="rf-mode"><option value="">All modes</option>{["CASH", "UPI", "NEFT_RTGS", "CHEQUE", "DD", "LOAN_DISBURSEMENT"].map((m) => <option key={m}>{m}</option>)}</Sel>}
              {has("category") && <Sel value={f.category || ""} onChange={set("category")} testId="rf-category"><option value="">All ledgers</option>{["Cash", "Account", "Other charges"].map((m) => <option key={m}>{m}</option>)}</Sel>}
              {has("status") && <Sel value={f.status || ""} onChange={set("status")} testId="rf-status"><option value="">Cleared</option>{["Pending", "Bounced", "Reversed"].map((m) => <option key={m}>{m}</option>)}</Sel>}
              {has("group") && data?.group_options && <Sel value={f.group || data.group_by} onChange={set("group")} testId="rf-group">{data.group_options.map((m) => <option key={m} value={m}>{GROUP_LABEL[m] || m}</option>)}</Sel>}
              {has("group_by") && <Sel value={f.group_by} onChange={set("group_by")} testId="rf-groupby">{["day", "week", "month"].map((m) => <option key={m} value={m}>By {m}</option>)}</Sel>}
              {has("group_by_out") && <Sel value={f.group_by_out} onChange={set("group_by_out")} testId="rf-groupby-out">{["customer", "block", "project"].map((m) => <option key={m} value={m}>By {m}</option>)}</Sel>}
              {has("group_by_inv") && <Sel value={f.group_by_inv} onChange={set("group_by_inv")} testId="rf-groupby-inv">{["project", "block", "flat_type", "floor"].map((m) => <option key={m} value={m}>By {m.replace("_", " ")}</option>)}</Sel>}
              {has("cheque_status") && <Sel value={f.cheque_status} onChange={set("cheque_status")} testId="rf-cheque-status">{["All", "Pending", "Bounced", "Cleared", "Reversed"].map((m) => <option key={m}>{m}</option>)}</Sel>}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-warm-100 pt-4" data-testid="rf-presets">
              <span className="label mr-1">Saved views</span>
              {items.length === 0 && <span className="text-xs text-txt-muted">None yet — set filters and save a view.</span>}
              {items.map((p) => renaming?.id === p.id ? <span key={p.id} className="flex items-center gap-1"><input autoFocus className="input !h-8 w-36 text-xs" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} onKeyDown={async (e) => { if (e.key === "Enter") { await api.patch(`/reports/presets/${p.id}`, { name: renaming.name }); setRenaming(null); reloadPresets(); } if (e.key === "Escape") setRenaming(null); }} data-testid="rf-preset-rename-input" /><button onClick={async () => { await api.patch(`/reports/presets/${p.id}`, { name: renaming.name }); setRenaming(null); reloadPresets(); }} className="text-sage" aria-label="Save name"><Check className="h-4 w-4" /></button><button onClick={() => setRenaming(null)} className="text-txt-muted" aria-label="Cancel"><X className="h-4 w-4" /></button></span>
                : <span key={p.id} className={cn("group inline-flex items-center gap-1 rounded-full border py-1 pl-3 pr-1.5 text-xs font-semibold transition-colors", activePreset === p.id ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-ink-950 hover:border-gold")} data-testid={`rf-preset-${p.id}`}>
                  <button onClick={() => { setActivePreset(p.id); setRange("Custom"); setF((o) => ({ ...o, ...p.filters })); }} data-testid={`rf-preset-apply-${p.id}`}>{p.name}</button>
                  <button onClick={() => setRenaming({ id: p.id, name: p.name })} className="rounded-full p-1 opacity-60 hover:opacity-100" aria-label="Rename" data-testid={`rf-preset-rename-${p.id}`}><Pencil className="h-3 w-3" /></button>
                  <button onClick={async () => { await api.delete(`/reports/presets/${p.id}`); if (activePreset === p.id) setActivePreset(null); reloadPresets(); toast.success("View deleted"); }} className="rounded-full p-1 opacity-60 hover:text-brick hover:opacity-100" aria-label="Delete" data-testid={`rf-preset-delete-${p.id}`}><Trash2 className="h-3 w-3" /></button>
                </span>)}
              <span className="ml-auto flex items-center gap-2"><input className="input !h-9 w-40 text-sm" placeholder="Name this view" value={presetName} onChange={(e) => setPresetName(e.target.value)} data-testid="rf-preset-name" /><button className="btn btn-secondary btn-sm !h-9" disabled={!presetName.trim()} onClick={savePreset} data-testid="rf-save-preset"><Save className="h-3.5 w-3.5" />Save</button></span>
            </div>
          </Card>
          {loading && !data ? <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}</div> : data && (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" data-testid="report-kpis">{kpis(key, data).map(([l, v, h, tone], i) => <StatTile key={l} label={l} value={v} hint={h} tone={tone} icon={i === 0 ? BarChart3 : undefined} testId={`report-kpi-${i}`} />)}</div>
          )}
          {chart && chart.rows.length > 0 && <Card testId="report-chart"><div className="mb-4 flex items-center justify-between"><h3 className="font-display text-lg text-ink-950">{chart.type === "pie" ? "Ageing" : "Trend"}</h3>{chart.keys && <div className="flex gap-3 text-xs text-txt-secondary">{chart.keys.map((k, i) => <span key={k} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i] }} />{k}</span>)}</div>}</div>
            <div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 250 }}>{chart.type === "pie" ? <PieChart><Pie data={chart.rows} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2} stroke="none">{chart.rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><RTooltip formatter={(v) => inr(v)} contentStyle={{ borderRadius: 10, border: "1px solid #EAE4D8", fontSize: 12 }} /></PieChart>
              : <BarChart data={chart.rows} barCategoryGap="28%"><CartesianGrid vertical={false} stroke="#EAE4D8" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => inrShort(v)} width={64} /><RTooltip cursor={{ fill: "#F4F0E8" }} contentStyle={{ borderRadius: 10, border: "1px solid #EAE4D8", fontSize: 12 }} formatter={(v) => (typeof v === "number" && v > 1000 ? inr(v) : v)} />{chart.keys.map((k, i) => <Bar key={k} dataKey={k} stackId={chart.stacked ? "a" : undefined} fill={COLORS[i]} radius={chart.stacked && i < chart.keys.length - 1 ? 0 : [6, 6, 0, 0]} />)}</BarChart>}</ResponsiveContainer></div>
            {chart.type === "pie" && <div className="mt-4 flex flex-wrap gap-2">{chart.rows.map((r, i) => <span key={r.name} className="pill bg-warm-100 text-ink-950"><i className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{r.name} · {inrShort(r.value)}</span>)}</div>}
          </Card>}
          {data?.top_overdue?.length > 0 && <Card><h3 className="mb-3 font-display text-lg text-ink-950">Top overdue customers</h3><div className="flex flex-wrap gap-2">{data.top_overdue.map((t) => <button key={t.booking_number} onClick={() => nav(`/customers/${t.customer_id || ""}`)} className="pill bg-brick-50 text-brick hover:bg-brick/15" data-testid={`report-overdue-${t.booking_number}`}>{t.customer_name} · {inrShort(t.overdue_paise / 100)}</button>)}</div></Card>}
          {data?.towers && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="report-towers">{data.towers.map((x) => <Card key={x.block_id} className="!p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[15px] font-semibold text-ink-950">{x.tower}</p><p className="text-xs text-txt-secondary">{x.project}</p></div><span className="font-display text-2xl text-ink-950">{x.pct}%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-warm-100"><span className="block h-full rounded-full bg-sage" style={{ width: `${x.pct}%` }} /></div><p className="mt-2 text-xs text-txt-secondary">{x.completed}/{x.stages} stages · <span className="pill bg-gold-light text-[#6b5410]">Now · {x.current_stage}</span></p></Card>)}</div>}
          {data?.status_counts && <div className="flex flex-wrap gap-2" data-testid="report-status-counts">{data.status_counts.map((m) => <span key={m.status} className="pill bg-warm-100 text-ink-950">{m.status} · {m.count}</span>)}</div>}
          {data?.by_mode && <div className="flex flex-wrap gap-2" data-testid="report-by-mode">{data.by_mode.map((m) => <span key={m.mode} className="pill bg-warm-100 text-ink-950">{m.mode.replace("_", " / ")} · {inrShort(m.total_paise / 100)} <span className="text-txt-muted">({m.count})</span></span>)}</div>}
          <Card className="!p-0 overflow-hidden" testId="report-table">
            {loading && !data ? <div className="space-y-2 p-6">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10" />)}</div> : !data?.rows?.length ? <div className="p-6"><EmptyState icon={BarChart3} title="No data for these filters" description="Widen the date range or clear a filter." testId="report-empty" /></div> : (
              <div className="max-h-[60vh] overflow-auto"><table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-warm-100 text-[11px] font-semibold uppercase tracking-wider text-txt-secondary"><tr>{data.columns.map((c) => <th key={c.key} className={cn("px-4 py-3", c.type === "str" ? "text-left" : "text-right")}>{c.label}</th>)}</tr></thead>
                <tbody>{data.rows.map((r, i) => <tr key={i} className={cn("h-11 border-t border-warm-100", i % 2 === 1 && "bg-warm-50/60")}>{data.columns.map((c, ci) => <td key={c.key} className={cn("px-4", c.type === "str" ? "text-ink-950" : "text-right tabular-nums")}>{ci === 0 && r._link ? <button className="font-semibold text-ink-950 underline-offset-2 hover:underline" onClick={() => nav(r._link)} data-testid={`report-drill-${i}`}>{cell(c, r[c.key])}</button> : cell(c, r[c.key])}</td>)}</tr>)}</tbody>
                {data.totals && <tfoot className="sticky bottom-0 bg-ink-950 font-semibold text-warm-50" data-testid="report-totals"><tr className="h-12">{data.columns.map((c, i) => <td key={c.key} className={cn("px-4", c.type === "str" ? "" : "text-right tabular-nums")}>{i === 0 ? "Total" : data.totals[c.key] != null ? cell(c, data.totals[c.key]) : ""}</td>)}</tr></tfoot>}
              </table></div>)}
          </Card>
          </>}
        </section>
      </div>
    </div>
  );
}
