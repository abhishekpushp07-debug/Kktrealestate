import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Download, FileText, Printer, Save, Trash2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import api, { errMsg, API } from "@/lib/api";
import { toast } from "sonner";
import { useFetch } from "@/hooks/useList";
import { inr, inrShort, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/common/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";

const COLORS = ["#0B1F3A", "#C9A227", "#10B981", "#F59E0B", "#94A3B8", "#EF4444"];
const FILTERS = {
  collections: ["from_date", "to_date", "project_id", "mode", "category", "status", "group_by"], outstanding: ["project_id", "group_by_out"], advances: ["project_id"], "demand-vs-collection": ["project_id"],
  inventory: ["project_id", "group_by_inv"], cheques: ["project_id", "cheque_status"], cancellations: ["from_date", "to_date", "project_id"], "sales-leads": ["from_date", "to_date"], "roznamcha-range": ["from_date", "to_date"], "bank-receipts": ["from_date", "to_date"], activity: ["from_date", "to_date"],
};
const MAP = { group_by_out: "group_by", group_by_inv: "group_by", cheque_status: "status" };

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

export default function Reports() {
  const { key = "collections" } = useParams();
  const nav = useNavigate();
  const { data: list } = useFetch("/reports");
  const { data: projects } = useFetch("/projects?page_size=50");
  const [f, setF] = useState({ group_by: "month", group_by_out: "customer", group_by_inv: "block", cheque_status: "Pending" });
  const [presetName, setPresetName] = useState("");
  const { data: presets, reload: reloadPresets } = useFetch(`/reports/presets?report_key=${key}`, [key]);
  const params = useMemo(() => Object.fromEntries(Object.entries(f).filter(([k, v]) => v && FILTERS[key]?.includes(k)).map(([k, v]) => [MAP[k] || k, v])), [f, key]);
  const qs = new URLSearchParams(params).toString();
  const { data, loading } = useFetch(`/reports/${key}${qs ? `?${qs}` : ""}`, [key, qs]);
  useEffect(() => { document.title = `Reports · ${key}`; }, [key]);
  const sel = "h-9 rounded-md border border-slate-200 bg-white px-2 text-sm";
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target ? e.target.value : e }));
  const groups = (list?.items || []).reduce((a, r) => { (a[r.group] = a[r.group] || []).push(r); return a; }, {});
  const chart = data && (key === "collections" ? { type: "bar", rows: data.rows.map((r) => ({ name: r.period, Cash: r.cash_paise / 100, Account: r.account_paise / 100, Other: r.other_paise / 100 })), keys: ["Cash", "Account", "Other"] }
    : key === "outstanding" ? { type: "pie", rows: data.ageing.map((a) => ({ name: a.bucket, value: a.amount_paise / 100 })) }
    : key === "sales-leads" ? { type: "bar", rows: data.funnel.map((s) => ({ name: s.stage, Leads: s.count })), keys: ["Leads"] }
    : key === "inventory" ? { type: "bar", rows: data.velocity.map((v) => ({ name: v.month, Bookings: v.bookings })), keys: ["Bookings"] }
    : key === "demand-vs-collection" ? { type: "bar", rows: data.rows.slice(0, 20).map((r) => ({ name: r.milestone.split(". ")[1], Demanded: r.demand_paise / 100, Collected: r.collected_paise / 100 })), keys: ["Demanded", "Collected"] } : null);
  return (
    <div data-testid="reports-page">
      <PageHeader title="Reports" subtitle="Server-side aggregations with CSV / PDF export and saved presets." />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="card-elev h-fit p-2" data-testid="report-list">{Object.entries(groups).map(([g, items]) => <div key={g} className="mb-2"><p className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{g}</p>{items.map((r) => <button key={r.key} onClick={() => nav(`/reports/${r.key}`)} className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${r.key === key ? "bg-navy font-semibold text-white" : "text-navy hover:bg-slate-100"}`} data-testid={`report-${r.key}`}>{r.name}</button>)}</div>)}</aside>
        <section className="min-w-0 space-y-4">
          <div className="card-elev flex flex-wrap items-end gap-2 p-3" data-testid="report-filters">
            {FILTERS[key]?.includes("from_date") && <label className="text-xs text-slate-500">From<DateInput value={f.from_date || ""} onChange={set("from_date")} className="h-9" data-testid="rf-from" /></label>}
            {FILTERS[key]?.includes("to_date") && <label className="text-xs text-slate-500">To<DateInput value={f.to_date || ""} onChange={set("to_date")} className="h-9" data-testid="rf-to" /></label>}
            {FILTERS[key]?.includes("project_id") && <select className={sel} value={f.project_id || ""} onChange={set("project_id")} data-testid="rf-project"><option value="">All projects</option>{(projects?.items || []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>}
            {FILTERS[key]?.includes("mode") && <select className={sel} value={f.mode || ""} onChange={set("mode")} data-testid="rf-mode"><option value="">All modes</option>{["CASH", "UPI", "NEFT_RTGS", "CHEQUE", "DD", "LOAN_DISBURSEMENT"].map((m) => <option key={m}>{m}</option>)}</select>}
            {FILTERS[key]?.includes("category") && <select className={sel} value={f.category || ""} onChange={set("category")} data-testid="rf-category"><option value="">All buckets</option>{["Cash", "Account", "Other charges"].map((m) => <option key={m}>{m}</option>)}</select>}
            {FILTERS[key]?.includes("status") && <select className={sel} value={f.status || ""} onChange={set("status")} data-testid="rf-status"><option value="">Cleared</option>{["Pending", "Bounced", "Reversed"].map((m) => <option key={m}>{m}</option>)}</select>}
            {FILTERS[key]?.includes("group_by") && <select className={sel} value={f.group_by} onChange={set("group_by")} data-testid="rf-groupby">{["day", "week", "month"].map((m) => <option key={m}>{m}</option>)}</select>}
            {FILTERS[key]?.includes("group_by_out") && <select className={sel} value={f.group_by_out} onChange={set("group_by_out")}>{["customer", "block", "project"].map((m) => <option key={m}>{m}</option>)}</select>}
            {FILTERS[key]?.includes("group_by_inv") && <select className={sel} value={f.group_by_inv} onChange={set("group_by_inv")}>{["project", "block", "flat_type", "floor"].map((m) => <option key={m}>{m}</option>)}</select>}
            {FILTERS[key]?.includes("cheque_status") && <select className={sel} value={f.cheque_status} onChange={set("cheque_status")}>{["Pending", "Bounced", "Cleared"].map((m) => <option key={m}>{m}</option>)}</select>}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select className={sel} onChange={(e) => { const p = (presets?.items || []).find((x) => x.id === e.target.value); if (p) setF((o) => ({ ...o, ...p.filters })); }} data-testid="rf-presets"><option value="">Presets…</option>{(presets?.items || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <Input placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} className="h-9 w-32" data-testid="rf-preset-name" />
              <Button size="sm" variant="outline" disabled={!presetName} onClick={async () => { await api.post("/reports/presets", { report_key: key, name: presetName, filters: f }); setPresetName(""); reloadPresets(); toast.success("Preset saved"); }} data-testid="rf-save-preset"><Save className="h-4 w-4" /></Button>
              {(presets?.items || []).length > 0 && <Button size="sm" variant="ghost" onClick={async () => { const p = presets.items[presets.items.length - 1]; await api.delete(`/reports/presets/${p.id}`); reloadPresets(); }} title="Delete last preset"><Trash2 className="h-4 w-4" /></Button>}
              <a href={`${API}/reports/${key}?${qs}&format=csv`} onClick={(e) => { e.preventDefault(); api.get(`/reports/${key}`, { params: { ...params, format: "csv" }, responseType: "blob" }).then((r) => { const a = document.createElement("a"); a.href = URL.createObjectURL(r.data); a.download = `${key}.csv`; a.click(); }); }} className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-3 text-sm font-medium text-navy hover:bg-slate-50" data-testid="rf-export-csv"><Download className="h-4 w-4" />CSV</a>
              <Button size="sm" className="bg-navy text-white" onClick={() => openPdf(`/reports/${key}?${qs}&format=pdf`)} data-testid="rf-export-pdf"><FileText className="mr-1 h-4 w-4" />PDF</Button>
              <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="rf-print"><Printer className="h-4 w-4" /></Button>
            </div>
          </div>
          {chart && chart.rows.length > 0 && <div className="card-elev p-4" data-testid="report-chart"><div className="h-56 min-w-0"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 220 }}>{chart.type === "pie" ? <PieChart><Pie data={chart.rows} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85}>{chart.rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Legend /><RTooltip formatter={(v) => inr(v)} /></PieChart>
            : <BarChart data={chart.rows}><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => (v > 1000 ? inrShort(v) : v)} /><RTooltip formatter={(v) => (typeof v === "number" && v > 1000 ? inr(v) : v)} />{chart.keys.map((k, i) => <Bar key={k} dataKey={k} stackId={key === "collections" ? "a" : undefined} fill={COLORS[i]} radius={[3, 3, 0, 0]} />)}</BarChart>}</ResponsiveContainer></div></div>}
          {data?.top_overdue?.length > 0 && <div className="card-elev p-4"><p className="mb-2 text-sm font-bold text-navy">Top overdue customers</p><div className="flex flex-wrap gap-2">{data.top_overdue.map((t) => <span key={t.booking_number} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-700">{t.customer_name} · {inr(t.overdue_paise / 100)}</span>)}</div></div>}
          {data?.by_mode && <div className="flex flex-wrap gap-2">{data.by_mode.map((m) => <span key={m.mode} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-navy">{m.mode}: {inr(m.total_paise / 100)} ({m.count})</span>)}{data.totals?.gst_collected_paise != null && <span className="rounded-full bg-gold/20 px-3 py-1 text-xs font-semibold text-navy">GST on charges: {inr(data.totals.gst_collected_paise / 100)}</span>}</div>}
          {data?.avg_response_hours != null && <div className="grid grid-cols-3 gap-3 text-sm">{[["Avg response (h)", data.avg_response_hours], ["Follow-ups overdue", data.follow_ups_overdue], ["Website enquiries", data.enquiries_per_project.reduce((a, e) => a + e.count, 0)]].map(([l, v]) => <div key={l} className="card-elev p-3"><p className="text-xs text-slate-500">{l}</p><p className="text-xl font-bold text-navy">{v ?? "—"}</p></div>)}</div>}
          <div className="card-elev overflow-x-auto" data-testid="report-table">
            {loading && !data ? <p className="p-6 text-sm text-slate-500">Loading…</p> : !data?.rows?.length ? <p className="p-6 text-sm text-slate-500" data-testid="report-empty">No data for these filters.</p> : (
              <table className="w-full text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr>{data.columns.map((c) => <th key={c.key} className={`px-3 py-2 ${c.type === "str" ? "text-left" : "text-right"}`}>{c.label}</th>)}</tr></thead>
                <tbody>{data.rows.map((r, i) => <tr key={i} className="border-t">{data.columns.map((c) => <td key={c.key} className={`px-3 py-1.5 ${c.type === "str" ? "" : "text-right tabular-nums"}`}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody>
                {data.totals && <tfoot className="sticky bottom-0 bg-gold/15 font-bold text-navy" data-testid="report-totals"><tr>{data.columns.map((c, i) => <td key={c.key} className={`px-3 py-2 ${c.type === "str" ? "" : "text-right tabular-nums"}`}>{i === 0 ? "Total" : data.totals[c.key] != null ? cell(c, data.totals[c.key]) : ""}</td>)}</tr></tfoot>}
              </table>)}
          </div>
        </section>
      </div>
    </div>
  );
}
