import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Link2, Printer, Send } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, inr } from "@/lib/format";
import { Card, EmptyState, Skeleton } from "@/components/v2";
import { HistoryButton } from "@/components/common/HistoryTimeline";

const KYC_LABEL = { kyc_pan: "PAN", kyc_aadhaar: "Aadhaar", kyc_other: "Other ID" };

/** Z.2 — co-applicant KYC files (files pipeline, kind kyc_*). Locked rows = viewer may not open them. */
function KycFiles() {
  const [kind, setKind] = useState("kyc");
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get("/files", { params: { kind, limit: 200 } }).then((r) => setRows(r.data.items)).catch((e) => toast.error(errMsg(e))); }, [kind]);
  const open = async (id) => { try { const r = await api.get(`/files/${id}/url`); window.open(r.data.url, "_blank", "noopener"); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Card testId="docs-kyc">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg">KYC files</h3>
        <select className="input !h-9 w-40 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="docs-kyc-kind"><option value="kyc">All KYC</option>{Object.entries(KYC_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {!rows ? <Skeleton className="mt-3 h-24" /> : rows.length === 0 ? <p className="mt-3 text-sm text-txt-muted">No KYC files yet — upload from the Booking Wizard or Customer 360 → Co-applicants.</p> : (
        <table className="mt-3 w-full text-sm" data-testid="docs-kyc-table"><thead><tr className="text-left text-xs uppercase tracking-wide text-txt-muted"><th className="py-2 pr-3">Type</th><th className="pr-3">File</th><th className="pr-3">Customer</th><th className="pr-3">Booking</th><th className="pr-3">Uploaded</th><th /></tr></thead>
          <tbody>{rows.map((f) => <tr key={f.id} className="border-t border-warm-100" data-testid={`docs-kyc-row-${f.id}`}><td className="py-1.5 pr-3 font-medium">{KYC_LABEL[f.kind] || f.kind}</td><td className="pr-3">{f.locked ? <span className="text-txt-muted">Masked</span> : f.filename}</td>
            <td className="pr-3">{f.customer_id ? <Link to={`/customers/${f.customer_id}?tab=coapplicants`} className="hover:underline">Customer 360</Link> : "—"}</td><td className="pr-3">{f.booking_id ? <Link to={`/bookings/${f.booking_id}`} className="hover:underline">Booking</Link> : "—"}</td>
            <td className="pr-3 text-txt-secondary">{fmtDateTime(f.created_at)}</td><td className="text-right">{!f.locked && <button className="btn btn-ghost btn-sm" onClick={() => open(f.id)} data-testid={`docs-kyc-open-${f.id}`}>Open</button>}</td></tr>)}</tbody></table>)}
    </Card>
  );
}

const Sel = ({ value, onChange, children, testId, disabled }) => <select className="input !h-9 text-sm" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid={testId}>{children}</select>;
const Kpi = ({ label, value, testId }) => <div className="rounded-2xl border border-warm-200 bg-white px-4 py-3" data-testid={testId}><p className="text-[11px] font-semibold uppercase text-txt-muted">{label}</p><p className="font-display text-[22px] tabular-nums text-ink-950">{value ?? "—"}</p></div>;

export default function Documents() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [mode, setMode] = useState(sp.get("mode") || "generate");
  const [reg, setReg] = useState(null);
  const loadReg = () => api.get("/docgen/register", { params: { limit: 200 } }).then((r) => setReg(r.data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { loadReg(); }, []);
  return (
    <div className="space-y-5" data-testid="documents-page">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-2xl text-ink-950">Documents</h1><p className="text-xs text-txt-secondary">Receipts, demand letters, statements and letters — deterministic PDFs, registered and re-downloadable forever.</p></div>
        <div className="flex rounded-full border border-warm-200 bg-white p-0.5 text-sm" data-testid="documents-mode">{[["generate", "Generate"], ["bulk", "Bulk"], ["register", "Register"], ["kyc", "KYC"]].map(([k, l]) => <button key={k} onClick={() => { setMode(k); const n = new URLSearchParams(sp); n.set("mode", k); setSp(n, { replace: true }); }} className={cn("rounded-full px-4 py-1.5 font-semibold", mode === k ? "bg-ink-950 text-warm-50" : "text-txt-secondary")} data-testid={`docs-mode-${k}`}>{l}</button>)}</div></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="docs-kpis"><Kpi label="Generated today" value={reg?.kpis.today} testId="kpi-today" /><Kpi label="This month" value={reg?.kpis.month} testId="kpi-month" /><Kpi label="Awaiting send" value={reg?.kpis.unsent} testId="kpi-unsent" /><Kpi label="Active share links" value={reg?.kpis.active_links} testId="kpi-links" /></div>
      {mode === "generate" && <Generate sp={sp} can={can} onGenerated={loadReg} />}
      {mode === "bulk" && <Bulk can={can} onDone={loadReg} />}
      {mode === "register" && <Register reg={reg} can={can} reload={loadReg} />}
      {mode === "kyc" && <KycFiles />}
    </div>
  );
}

function Generate({ sp, can, onGenerated }) {
  const [opts, setOpts] = useState({ projects: [], towers: [], bookings: [] });
  const [projectId, setProjectId] = useState(sp.get("project_id") || "");
  const [blockId, setBlockId] = useState(sp.get("block_id") || "");
  const [bookingId, setBookingId] = useState(sp.get("booking_id") || "");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(null);
  const [type, setType] = useState(sp.get("type") || "statement");
  const [paymentId, setPaymentId] = useState("");
  const [demandIds, setDemandIds] = useState([]);
  const [period, setPeriod] = useState("all");
  const [types, setTypes] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  useEffect(() => { api.get("/docgen/types").then((r) => setTypes(r.data.items)); }, []);
  useEffect(() => { api.get("/docgen/options", { params: { project_id: projectId || undefined, block_id: blockId || undefined, q: q || undefined } }).then((r) => setOpts(r.data)).catch(() => {}); }, [projectId, blockId, q]);
  useEffect(() => { if (!bookingId) { setPick(null); return; } api.get(`/docgen/booking/${bookingId}/pickers`).then((r) => setPick(r.data)).catch((e) => toast.error(errMsg(e))); }, [bookingId]);
  const body = useMemo(() => ({ type, booking_id: bookingId, payment_id: type === "receipt" ? paymentId || null : null, demand_ids: type === "demand" ? demandIds : null, period_from: type === "statement" && period !== "all" ? period : null }), [type, bookingId, paymentId, demandIds, period]);
  const ready = bookingId && (type !== "receipt" || paymentId) && (type !== "demand" || demandIds.length > 0);
  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    let url; setBusy(true);
    api.post("/docgen/generate", { ...body, preview: true }, { responseType: "blob" }).then((r) => { url = URL.createObjectURL(r.data); setPreview({ url }); }).catch(async (e) => { const t = e.response?.data instanceof Blob ? JSON.parse(await e.response.data.text()) : null; setPreview({ error: t?.error?.message || errMsg(e) }); }).finally(() => setBusy(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [body, ready]);
  const generate = async () => { try { const r = await api.post("/docgen/generate", body); setLast(r.data); toast.success(`${r.data.type_name} registered · ${r.data.number}`); onGenerated(); window.open(`${BASE_PATH}/api/docgen/${r.data.id}/download?download=1`, "_blank"); } catch (e) { toast.error(errMsg(e)); } };
  const share = async () => { if (!last) return; try { const r = await api.post(`/docgen/${last.id}/share`); await navigator.clipboard?.writeText(window.location.origin + r.data.url); toast.success("15-minute link copied"); } catch (e) { toast.error(errMsg(e)); } };
  const sent = async (channel) => { if (!last) return; try { await api.post(`/docgen/${last.id}/sent`, { channel }); toast.success(`Marked as sent via ${channel}`); onGenerated(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="grid gap-5 lg:grid-cols-5" data-testid="docs-generate">
      <div className="space-y-4 lg:col-span-2">
        <Card testId="gen-who"><p className="label-xs">1 · Who</p>
          <div className="mt-2 grid gap-2">
            <Sel value={projectId} onChange={(v) => { setProjectId(v); setBlockId(""); setBookingId(""); }} testId="gen-project"><option value="">Project…</option>{opts.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
            <Sel value={blockId} onChange={(v) => { setBlockId(v); setBookingId(""); }} disabled={!projectId} testId="gen-tower"><option value="">All towers</option>{opts.towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Sel>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer / CUST / booking…" className="input !h-9 text-sm" data-testid="gen-search" />
            <Sel value={bookingId} onChange={setBookingId} testId="gen-booking"><option value="">Customer / booking…</option>{opts.bookings.map((b) => <option key={b.id} value={b.id}>{b.customer_name} · {b.booking_number} · {b.flat_snapshot?.flat_number}</option>)}</Sel>
          </div></Card>
        <Card testId="gen-what"><p className="label-xs">2 · What</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{types.map((t) => <button key={t.code} onClick={() => setType(t.code)} className={cn("pill", type === t.code ? "bg-ink-950 text-warm-50" : "bg-warm-100 text-ink-950")} data-testid={`gen-type-${t.code}`}>{t.name}</button>)}</div>
          {type === "receipt" && <Sel value={paymentId} onChange={setPaymentId} testId="gen-receipt-pick"><option value="">Pick a receipt…</option>{(pick?.receipts || []).map((r) => <option key={r.id} value={r.id}>{r.receipt_number} · {fmtDate(r.payment_date)} · {inr(r.amount_paise / 100)} · {r.status}</option>)}</Sel>}
          {type === "demand" && <ul className="mt-2 max-h-56 space-y-1 overflow-auto" data-testid="gen-demand-pick">{(pick?.demands || []).map((d) => <li key={d.id}><label className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-warm-50"><input type="checkbox" checked={demandIds.includes(d.id)} onChange={(e) => setDemandIds(e.target.checked ? [...demandIds, d.id] : demandIds.filter((x) => x !== d.id))} data-testid={`gen-demand-${d.demand_number}`} /><span className="font-semibold text-ink-950">{d.demand_number}</span><span className="text-txt-secondary">{d.installment_name} · due {fmtDate(d.due_date)}</span><span className="ml-auto tabular-nums">{inr(d.total_demand_paise / 100)}</span></label></li>)}{pick && pick.demands.length === 0 && <li className="text-xs text-txt-muted">No demands on this booking.</li>}</ul>}
          {type === "statement" && <div className="mt-2 flex flex-wrap gap-1.5">{[["all", "Since booking"], [new Date(new Date().getFullYear(), 3, 1).toISOString().slice(0, 10), "This FY"], [new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), "Last 90 days"]].map(([v, l]) => <button key={v} onClick={() => setPeriod(v)} className={cn("pill", period === v ? "bg-gold-light text-[#6b5410]" : "bg-warm-100")} data-testid={`gen-period-${l.replace(/\s/g, "-")}`}>{l}</button>)}</div>}
          {type === "reminder" && <p className="mt-2 text-xs text-txt-secondary">Auto-fills overdue demands with days overdue; interest line only if the company has an interest policy.</p>}
          {type === "cancellation" && pick && pick.refunds.length === 0 && <p className="mt-2 text-xs text-brick">No refund record on this booking — process the cancellation first.</p>}
        </Card>
        <Card testId="gen-actions"><p className="label-xs">3 · Output</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button disabled={!ready || busy} onClick={generate} className="btn btn-primary btn-sm" data-testid="gen-download"><Download className="h-3.5 w-3.5" />Generate & download</button>
            <button disabled={!preview?.url} onClick={() => window.open(preview.url, "_blank")} className="btn btn-secondary btn-sm" data-testid="gen-print"><Printer className="h-3.5 w-3.5" />Print</button>
            {can("documents.document.share") && <button disabled={!last} onClick={share} className="btn btn-secondary btn-sm" data-testid="gen-share"><Link2 className="h-3.5 w-3.5" />Share (15 min)</button>}
            <div className="flex items-center gap-1"><Send className="h-3.5 w-3.5 text-txt-muted" />{["hand", "post", "email", "whatsapp"].map((ch) => <button key={ch} disabled={!last} onClick={() => sent(ch)} className="pill bg-warm-100 text-xs disabled:opacity-40" data-testid={`gen-sent-${ch}`}>{ch}</button>)}</div>
          </div>
          {last && <p className="mt-2 text-xs text-txt-secondary" data-testid="gen-last">Registered: {last.type_name} · {last.number} · {fmtDateTime(last.generated_at)}</p>}
        </Card>
      </div>
      <Card className="!p-0 lg:col-span-3 lg:sticky lg:top-4 h-[78vh] overflow-hidden" testId="gen-preview">
        {!ready ? <div className="flex h-full items-center justify-center p-8 text-center text-sm text-txt-muted">Pick a booking and a document type — the live preview is the exact PDF you will download.</div> : busy && !preview ? <div className="p-6"><Skeleton className="h-full min-h-[60vh]" /></div> : preview?.error ? <div className="flex h-full items-center justify-center p-8 text-center text-sm text-brick" data-testid="gen-preview-error">{preview.error}</div> : preview?.url ? <iframe title="preview" src={preview.url} className="h-full w-full" data-testid="gen-preview-frame" /> : null}
      </Card>
    </div>
  );
}

function Bulk({ can, onDone }) {
  const [f, setF] = useState({ project_id: "", block_id: "", date_from: "", date_to: "", status: "" });
  const [opts, setOpts] = useState({ projects: [], towers: [] });
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState(new Set());
  useEffect(() => { api.get("/docgen/options", { params: { project_id: f.project_id || undefined } }).then((r) => setOpts(r.data)); }, [f.project_id]);
  const load = useCallback(() => api.get("/demands/register", { params: { basis: "raised", project_id: f.project_id || undefined, block_id: f.block_id || undefined, date_from: f.date_from || undefined, date_to: f.date_to || undefined, status: f.status || undefined, per_group: 500 } }).then((r) => setRows(r.data.groups.flatMap((g) => g.projects.flatMap((p) => p.towers.flatMap((t) => t.rows))))).catch((e) => toast.error(errMsg(e))), [f]);
  useEffect(() => { load(); }, [load]);
  const run = async (mode) => {
    try {
      const r = await api.post("/docgen/bulk", { demand_ids: [...sel], mode }, { responseType: "blob" });
      if (r.status === 202) { toast.success("Queued as an export job (> 50 documents) — see Reports → Exports"); return; }
      const url = URL.createObjectURL(r.data); const a = document.createElement("a"); a.href = url; a.download = mode === "zip" ? "documents.zip" : "demand-letters-merged.pdf"; a.click(); URL.revokeObjectURL(url); toast.success(`${sel.size} letter(s) ${mode === "zip" ? "zipped" : "merged"}`); onDone();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const total = rows ? rows.filter((r) => sel.has(r.id)).reduce((s, r) => s + r.total_paise, 0) : 0;
  return (
    <div className="space-y-3" data-testid="docs-bulk">
      <Card><div className="grid gap-2 md:grid-cols-5">
        <Sel value={f.project_id} onChange={(v) => setF({ ...f, project_id: v, block_id: "" })} testId="bulk-project"><option value="">All projects</option>{opts.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel value={f.block_id} onChange={(v) => setF({ ...f, block_id: v })} disabled={!f.project_id} testId="bulk-tower"><option value="">All towers</option>{opts.towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Sel>
        <input type="date" className="input !h-9 text-sm" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} data-testid="bulk-from" /><input type="date" className="input !h-9 text-sm" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} data-testid="bulk-to" />
        <Sel value={f.status} onChange={(v) => setF({ ...f, status: v })} testId="bulk-status"><option value="">Any status</option>{["Open", "Partially Paid", "Overdue", "Paid"].map((s) => <option key={s}>{s}</option>)}</Sel></div></Card>
      <Card className="!p-0">{!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState title="No demands match" /> : <table className="w-full text-sm"><thead className="bg-warm-50 text-left text-[11px] uppercase text-txt-muted"><tr><th className="px-3 py-2"><input type="checkbox" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} data-testid="bulk-select-all" /></th><th className="px-3 py-2">Demand</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Flat</th><th className="px-3 py-2">Raised</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead><tbody className="tabular-nums">{rows.slice(0, 300).map((r) => <tr key={r.id} className="border-t border-warm-100" data-testid={`bulk-row-${r.demand_number}`}><td className="px-3 py-1.5"><input type="checkbox" checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(r.id) : n.delete(r.id); setSel(n); }} /></td><td className="px-3 py-1.5 font-semibold text-ink-950">{r.demand_number}</td><td className="px-3 py-1.5">{r.customer_name}</td><td className="px-3 py-1.5">{r.block_name} · {r.flat_number}</td><td className="px-3 py-1.5">{fmtDate(r.demand_date)}</td><td className="px-3 py-1.5">{fmtDate(r.due_date)}</td><td className="px-3 py-1.5 text-right">{inr(r.total_paise / 100)}</td><td className="px-3 py-1.5 text-xs">{r.status}</td></tr>)}</tbody></table>}</Card>
      {sel.size > 0 && <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-2xl bg-ink-950 px-5 py-3 text-warm-50 shadow-xl" data-testid="bulk-footer"><span className="text-sm font-semibold">{sel.size} selected · {inr(total / 100)}</span>{can("documents.document.bulk") && <><button onClick={() => run("merged")} className="btn btn-primary btn-sm" data-testid="bulk-merge">Merged PDF</button><button onClick={() => run("zip")} className="btn btn-secondary btn-sm" data-testid="bulk-zip">ZIP</button></>}{sel.size > 50 && <span className="text-xs text-warm-50/70">&gt; 50 → async export job</span>}</div>}
    </div>
  );
}

function Register({ reg, can, reload }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const items = (reg?.items || []).filter((d) => (!type || d.type === type) && (!q || `${d.customer_name} ${d.number} ${d.booking_number}`.toLowerCase().includes(q.toLowerCase())));
  const sent = async (d, channel) => { try { await api.post(`/docgen/${d.id}/sent`, { channel }); toast.success("Marked as sent"); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const voidDoc = async (d) => { const reason = window.prompt(`Void ${d.number}? Reason (required, audited):`); if (!reason || reason.length < 3) return; try { await api.post(`/docgen/${d.id}/void`, { reason }); toast.success(`${d.number} voided`); reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Card className="!p-0" testId="docs-register">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer / number / booking" className="input !h-9 !w-72 text-sm" data-testid="reg-search" /><Sel value={type} onChange={setType} testId="reg-type"><option value="">All types</option>{Object.entries(reg?.types || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="bulk">Bulk</option></Sel><a href={`${BASE_PATH}/api/docgen/register?format=csv`} className="btn btn-secondary btn-sm ml-auto" data-testid="reg-csv">CSV</a></div>
      {!reg ? <Skeleton className="h-40" /> : items.length === 0 ? <EmptyState title="Generate your first document" description="Every generated PDF is listed here with who/when and its sent status." /> : <table className="w-full text-sm"><thead className="bg-warm-50 text-left text-[11px] uppercase text-txt-muted"><tr><th className="px-4 py-2">Type</th><th className="px-4 py-2">Number</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Booking</th><th className="px-4 py-2">Project / Tower</th><th className="px-4 py-2">By / at</th><th className="px-4 py-2">Sent</th><th className="px-4 py-2" /></tr></thead><tbody>{items.map((d) => <tr key={d.id} className={cn("border-t border-warm-100", d.voided && "opacity-50")} data-testid={`reg-row-${d.id}`}><td className="px-4 py-2"><span className="pill bg-warm-100 text-xs">{d.type_name}</span>{d.voided && <span className="pill ml-1 bg-brick/10 text-[10px] text-brick" title={d.void_reason} data-testid={`reg-voided-${d.id}`}>Voided</span>}</td><td className={cn("px-4 py-2 font-semibold text-ink-950", d.voided && "line-through")}>{d.number}</td><td className="px-4 py-2">{d.customer_id ? <a href={`${BASE_PATH}/customers/${d.customer_id}`} className="hover:text-gold">{d.customer_name}</a> : d.customer_name}</td><td className="px-4 py-2">{d.booking_number || "—"}</td><td className="px-4 py-2 text-xs">{[d.project_name, d.block_name].filter(Boolean).join(" · ") || "—"}</td><td className="px-4 py-2 text-xs">{d.generated_by_name}<br />{fmtDateTime(d.generated_at)}</td><td className="px-4 py-2 text-xs">{d.voided ? <span className="text-txt-muted">—</span> : d.sent ? <span className="pill bg-sage/15 text-sage">{d.sent.channel} · {fmtDate(d.sent.at)}</span> : <span className="flex gap-1">{["hand", "post", "email", "whatsapp"].map((ch) => <button key={ch} onClick={() => sent(d, ch)} className="pill bg-warm-100 text-[10px]" data-testid={`reg-sent-${d.id}-${ch}`}>{ch}</button>)}</span>}</td><td className="px-4 py-2 text-right"><div className="flex justify-end gap-0.5">{d.type !== "bulk" && <a href={`${BASE_PATH}/api/docgen/${d.id}/download`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title="Re-download (deterministic)" data-testid={`reg-dl-${d.id}`}><Download className="h-3.5 w-3.5" /></a>}{can("documents.document.generate") && !d.voided && <button onClick={() => voidDoc(d)} className="btn btn-ghost btn-sm text-[10px] text-brick" data-testid={`reg-void-${d.id}`}>void</button>}<HistoryButton entityType="generated_document" entityId={d.id} label={d.number} compact testId={`reg-history-${d.id}`} /></div></td></tr>)}</tbody></table>}
    </Card>
  );
}
