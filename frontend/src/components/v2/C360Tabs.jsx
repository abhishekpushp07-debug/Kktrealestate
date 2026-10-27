import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, FileText, Lock, Printer, Receipt } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { BASE_PATH } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, inr, inrShort } from "@/lib/format";
import { Card, EmptyState, Skeleton, StatusPill } from "@/components/v2";

const KIND_LABEL = { transfer: "Transfers", booking: "Bookings", payment: "Payments", demand: "Demands", lead: "Leads", visit: "Visits", service: "Tickets", refund: "Refunds", milestone: "Stages", document: "Documents", customer: "Profile", notice: "Notices", portal: "Portal" };
const titleOf = (e) => { const a = e.after || {}; return [e.action.replace(/[._]/g, " "), a.receipt_number || a.demand_number || a.refund_number || a.booking_number || a.number || ""].filter(Boolean).join(" · "); };

export function C360Timeline({ id, compact }) {
  const [kind, setKind] = useState("all");
  const [limit, setLimit] = useState(compact ? 5 : 40);
  const { data, loading } = useFetch(`/customers/${id}/events?limit=${limit}${kind === "all" ? "" : `&kinds=${kind}`}`);
  const items = data?.items || [];
  const kinds = ["all", ...(data?.kinds || [])];
  return (
    <Card className="!p-0" testId="customer-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warm-100 px-5 py-3"><h3 className="font-display text-lg">{compact ? "Latest activity" : "Timeline"}</h3>{!compact && <div className="flex flex-wrap gap-1.5" data-testid="timeline-filter">{kinds.map((k) => <button key={k} onClick={() => setKind(k)} className={cn("pill", kind === k ? "bg-ink-950 text-warm-50" : "bg-warm-100 text-ink-950")} data-testid={`timeline-chip-${k}`}>{k === "all" ? "All" : KIND_LABEL[k] || k}</button>)}</div>}</div>
      <div className="px-5 py-3">{loading && !data ? <Skeleton className="h-32" /> : items.length === 0 ? <p className="py-4 text-center text-sm text-txt-muted">Nothing recorded yet.</p> : <ul className="divide-y divide-warm-100">{items.map((e) => { const amt = (e.after || {}).amount_paise ?? (e.after || {}).total_paise; return <li key={e.id} className="flex items-center gap-3 py-2" data-testid={`timeline-event-${e.kind}`}><span className="h-2 w-2 shrink-0 rounded-full bg-gold" /><div className="min-w-0 flex-1"><Link to={e.link || "#"} className="block truncate text-sm font-semibold text-ink-950 hover:text-gold">{titleOf(e)}</Link><p className="truncate text-xs text-txt-secondary">{e.actor_name} · {fmtDateTime(e.created_at)}</p></div>{typeof amt === "number" && <span className="text-sm tabular-nums text-ink-950">{inrShort(amt / 100)}</span>}</li>; })}</ul>}
        {!compact && items.length >= limit && <button onClick={() => setLimit(limit + 40)} className="mt-3 w-full rounded-xl border border-warm-200 py-2 text-xs font-semibold text-ink-950 hover:bg-warm-50" data-testid="timeline-load-more">Load more</button>}
        {compact && <Link to={`?tab=timeline`} className="mt-2 block text-xs font-semibold text-ink-950 hover:text-gold">Full timeline →</Link>}
      </div>
    </Card>
  );
}

export function BookingRich({ b, plan, can, onPay }) {
  const s = b.summary || {}, ps = b.plan_summary || {};
  const done = plan?.installments_raised || 0, tot = plan?.installments_total || 0, paid = plan?.installments_paid || 0;
  return (
    <Card className="!p-5" testId={`booking-card-${b.booking_number}`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link to={`/bookings/${b.id}`} className="block truncate text-[15px] font-semibold text-ink-950 hover:text-gold">{b.block_name} · {b.flat_snapshot?.flat_number} · {b.flat_snapshot?.flat_type_code}</Link><p className="truncate text-xs text-txt-secondary">{b.booking_number} · {b.project_name}{b.allocation_category_code ? ` · ${b.allocation_category_code}` : ""}</p></div><StatusPill status={b.status} /></div>
      <div className="mt-4"><div className="flex items-center justify-between text-xs"><span className="text-txt-secondary">{plan?.plan_name || ps.plan_name || "No plan"} · {done}/{tot} installments raised · {paid} paid</span><span className="font-semibold text-ink-950">{tot ? Math.round((done / tot) * 100) : 0}%</span></div><div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-warm-100"><span className="block h-full rounded-full bg-gold" style={{ width: `${tot ? (done / tot) * 100 : 0}%` }} /></div></div>
      <table className="mt-4 w-full text-xs" data-testid={`booking-card-${b.booking_number}-two-sided`}><thead className="text-[10px] uppercase text-txt-muted"><tr><th className="text-left font-semibold">Ledger</th><th className="text-right font-semibold">Udhar</th><th className="text-right font-semibold">Jama</th><th className="text-right font-semibold">Net</th></tr></thead><tbody className="tabular-nums">{[["Cash", s.cash_udhar_paise, s.cash_jama_paise], ["Account", s.account_udhar_paise, s.account_jama_paise], ["All", s.total_udhar_paise, s.total_jama_paise]].map(([l, u, j]) => <tr key={l} className={cn("border-t border-warm-100", l === "All" && "font-semibold text-ink-950")}><td className="py-1">{l}</td><td className="py-1 text-right">{inr((u || 0) / 100)}</td><td className="py-1 text-right text-sage">{inr((j || 0) / 100)}</td><td className={cn("py-1 text-right", (u || 0) - (j || 0) > 0 ? "text-brick" : "text-sage")}>{inr(((u || 0) - (j || 0)) / 100)}</td></tr>)}</tbody></table>
      {ps.next_installment && <p className="mt-3 text-xs text-txt-secondary"><span className="pill bg-gold-light text-[#6b5410]">Next · {ps.next_installment.name}</span> {ps.next_installment.trigger_label}{ps.next_installment.expected_date ? ` · ${fmtDate(ps.next_installment.expected_date)}` : ""} · <span className="font-semibold text-ink-950">{inr(ps.next_installment.total_paise / 100)}</span></p>}
      {ps.overdue_count > 0 && <p className="mt-1 text-xs font-semibold text-brick" data-testid={`booking-card-${b.booking_number}-overdue`}>{ps.overdue_count} overdue demand{ps.overdue_count > 1 ? "s" : ""}</p>}
      <div className="mt-4 flex flex-wrap gap-1.5" data-testid={`booking-card-${b.booking_number}-actions`}>
        {can("finance.payment.create") && b.status === "Active" && <button onClick={onPay} className="btn btn-primary btn-sm" data-testid={`bc-pay-${b.booking_number}`}><Receipt className="h-3.5 w-3.5" />Post payment</button>}
        {can("finance.ledger.export") && <a href={`${BASE_PATH}/print/statement/${b.id}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" data-testid={`bc-statement-${b.booking_number}`}><Printer className="h-3.5 w-3.5" />Statement</a>}
        {can("documents.document.generate") && <Link to={`/documents?booking_id=${b.id}&project_id=${b.project_id}&block_id=${b.block_id}&type=demand`} className="btn btn-secondary btn-sm" data-testid={`bc-demand-letters-${b.booking_number}`}><FileText className="h-3.5 w-3.5" />Demand letters</Link>}
        {can("sales.booking.edit") && b.status === "Active" && <Link to={`/bookings/${b.id}?action=transfer`} className="btn btn-ghost btn-sm">Transfer</Link>}
        {can("sales.booking.cancel") && b.status === "Active" && <Link to={`/bookings/${b.id}?action=cancel`} className="btn btn-ghost btn-sm text-brick">Cancel</Link>}
      </div>
    </Card>
  );
}

export function DemandsTab({ items, loading, can }) {
  const today = new Date().toISOString().slice(0, 10);
  const [q, setQ] = useState("");
  const rows = items.filter((d) => !q || `${d.demand_number} ${d.installment_name} ${d.milestone_name} ${d.booking_number}`.toLowerCase().includes(q.toLowerCase()));
  if (loading && items.length === 0) return <Skeleton className="h-64" />;
  if (items.length === 0) return <EmptyState title="No demands yet" description="Demands are raised automatically from the payment plan as stages complete." testId="demands-empty" />;
  return (
    <Card className="!p-0" testId="demands-tab">
      <div className="flex items-center justify-between gap-3 px-5 py-3"><h3 className="font-display text-lg">Demands <span className="text-sm font-normal text-txt-muted">· {rows.length}</span></h3><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (press /)" className="input !h-8 !w-56 text-xs" data-testid="c360-search" /></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-warm-50 text-left text-[11px] uppercase text-txt-muted"><tr><th className="px-4 py-2">Demand</th><th className="px-4 py-2">Why</th><th className="px-4 py-2">Raised</th><th className="px-4 py-2">Due</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2 text-right">Paid</th><th className="px-4 py-2 text-right">Balance</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr></thead>
        <tbody className="tabular-nums">{rows.map((d) => { const bal = Math.max((d.total_demand_paise || 0) - (d.paid_paise || 0), 0); const od = d.status !== "Paid" && !d.voided && d.due_date < today; const age = od ? Math.round((new Date(today) - new Date(d.due_date)) / 864e5) : 0; return <tr key={d.id} className={cn("border-t border-warm-100", d.voided && "line-through opacity-50")} data-testid={`demand-row-${d.demand_number}`}><td className="px-4 py-2 font-semibold text-ink-950">{d.demand_number}<p className="text-[11px] font-normal text-txt-secondary">{d.booking_number}</p></td><td className="px-4 py-2 text-xs text-txt-secondary">{[d.plan_name, d.milestone_name || d.installment_name, d.percent != null ? `${d.percent}%` : null, d.trigger].filter(Boolean).join(" · ")}</td><td className="px-4 py-2">{fmtDate(d.demand_date)}</td><td className="px-4 py-2">{fmtDate(d.due_date)}{od && <span className="ml-1 text-[10px] font-semibold text-brick">{age} d</span>}</td><td className="px-4 py-2 text-right">{inr(d.total_demand_paise / 100)}</td><td className="px-4 py-2 text-right text-sage">{inr((d.paid_paise || 0) / 100)}</td><td className={cn("px-4 py-2 text-right", bal > 0 ? "text-brick" : "text-sage")}>{inr(bal / 100)}</td><td className="px-4 py-2"><StatusPill status={d.voided ? "Voided" : od ? "Overdue" : d.status} /></td><td className="px-4 py-2 text-right">{can("finance.demand.export") && !d.voided && <a href={`${BASE_PATH}/api/bookings/${d.booking_id}/demands/${d.id}/letter.pdf`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title="Print letter" data-testid={`demand-print-${d.demand_number}`}><Printer className="h-3.5 w-3.5" /></a>}</td></tr>; })}</tbody></table></div>
    </Card>
  );
}

export function ReceiptsDocsTab({ receipts, docs, can, kyc }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="!p-0 lg:col-span-2" testId="receipts-list"><h3 className="px-5 pt-4 font-display text-lg">Receipts <span className="text-sm font-normal text-txt-muted">· {receipts.length}</span></h3>
        {receipts.length === 0 ? <p className="px-5 py-6 text-sm text-txt-muted">No receipts yet.</p> : <table className="mt-2 w-full text-sm"><thead className="bg-warm-50 text-left text-[11px] uppercase text-txt-muted"><tr><th className="px-4 py-2">Receipt</th><th className="px-4 py-2">Date</th><th className="px-4 py-2">Mode</th><th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr></thead><tbody className="tabular-nums">{receipts.map((r) => <tr key={r.id} className="border-t border-warm-100" data-testid={`receipt-row-${r.receipt_number}`}><td className="px-4 py-2 font-semibold text-ink-950">{r.receipt_number}<p className="text-[11px] font-normal text-txt-secondary">{r.booking_number}</p></td><td className="px-4 py-2">{fmtDate(r.payment_date)}</td><td className="px-4 py-2 text-xs">{r.payment_mode_name} · {r.payment_category}</td><td className="px-4 py-2 text-right">{inr(r.amount_paise / 100)}</td><td className="px-4 py-2"><StatusPill status={r.status} /></td><td className="px-4 py-2 text-right">{can("finance.receipt.download") && <a href={`${BASE_PATH}/api/payments/${r.id}/receipt.pdf`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title="Print receipt"><Printer className="h-3.5 w-3.5" /></a>}</td></tr>)}</tbody></table>}
        <h3 className="px-5 pt-5 font-display text-lg">Generated documents <span className="text-sm font-normal text-txt-muted">· {docs.length}</span></h3>
        {docs.length === 0 ? <p className="px-5 py-4 text-sm text-txt-muted">Nothing generated yet — use Generate document.</p> : <ul className="mt-2 divide-y divide-warm-100 pb-2">{docs.map((d) => <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm" data-testid={`gendoc-${d.id}`}><div className="min-w-0"><p className="truncate font-semibold text-ink-950">{d.type_name} · {d.number}</p><p className="text-[11px] text-txt-secondary">{d.generated_by_name} · {fmtDateTime(d.generated_at)}{d.sent ? ` · sent via ${d.sent.channel}` : " · not sent"}</p></div><a href={`${BASE_PATH}/api/docgen/${d.id}/download`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm"><Printer className="h-3.5 w-3.5" />Re-download</a></li>)}</ul>}
      </Card>
      <Card testId="kyc-docs"><h3 className="font-display text-lg">KYC documents</h3><div className="mt-3">{kyc}</div></Card>
    </div>
  );
}

export function ConstructionTab({ items, photos }) {
  if (items.length === 0) return <EmptyState title="No towers" description="Construction appears here once the customer has a booking." />;
  return (
    <div className="grid gap-5 lg:grid-cols-2" data-testid="construction-tab">
      {items.map((t) => <Card key={t.block_id} testId={`construction-${t.block_name}`}><div className="flex items-center justify-between"><h3 className="font-display text-lg">{t.block_name}</h3><span className="font-display text-xl text-ink-950">{t.construction_percent}%</span></div><p className="text-xs text-txt-secondary">{t.stage_plan_name || "Stage plan"}{t.planned_completion ? ` · planned ${fmtDate(t.planned_completion)}` : ""}</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-warm-100"><span className="block h-full bg-gold" style={{ width: `${t.construction_percent}%` }} /></div><ul className="mt-3 space-y-1 text-xs">{t.stages.map((s, i) => <li key={i} className="flex items-center justify-between"><span className={cn(s.status === "Completed" ? "text-ink-950" : "text-txt-secondary")}>{s.name}</span><span className="text-txt-muted">{s.status === "Completed" ? fmtDate(s.completed_on) : s.planned_on ? `planned ${fmtDate(s.planned_on)}` : s.status}</span></li>)}</ul>
        <div className="mt-3 grid grid-cols-4 gap-1.5">{photos.filter((p) => p.entity_id === t.block_id).slice(0, 4).map((p) => <img key={p.id} src={`${BASE_PATH}/api/files/variants/${p.id}-thumb.webp`} alt={p.caption || ""} className="aspect-square rounded-lg object-cover" loading="lazy" />)}</div></Card>)}
    </div>
  );
}

export function ProfileTab({ c, reveal, onReveal, can, label, onKyc, portal }) {
  const kv = (k) => (reveal ? c[k] : c[`${k}_masked`]) || "—";
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card testId="kyc-card"><div className="flex items-center justify-between"><h3 className="font-display text-lg">KYC</h3><StatusPill status={c.kyc_status} /></div>
        <dl className="mt-3 space-y-2 text-sm">{[["PAN", kv("pan")], ["Aadhaar", kv("aadhaar")], ["Bank", c.bank?.bank_name ? `${c.bank.bank_name} · ${(reveal ? c.bank.account_number : c.bank.account_number_masked) || "—"}` : "—"]].map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-4 leading-6"><dt className="flex items-center gap-1.5 text-txt-secondary"><Lock className="h-3.5 w-3.5 text-txt-muted" />{k}</dt><dd className="font-mono text-ink-950">{v}</dd></div>)}</dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">{can("sales.kyc.reveal") && <button onClick={onReveal} className="btn btn-secondary btn-sm" data-testid="kyc-reveal-btn">{reveal ? <><EyeOff className="h-3.5 w-3.5" />Hide</> : <><Eye className="h-3.5 w-3.5" />Reveal</>}</button>}{reveal && <span className="text-[11px] text-amber2">Reveal is audit-logged</span>}{can("sales.kyc.reveal") && <select value={c.kyc_status} onChange={(e) => onKyc(e.target.value)} className="input !h-8 !w-auto !text-xs" data-testid="kyc-status-select">{["Pending", "Submitted", "Verified", "Rejected"].map((k) => <option key={k}>{k}</option>)}</select>}</div></Card>
      <Card testId="profile-card"><div className="flex items-center justify-between"><h3 className="font-display text-lg">Profile</h3>{can("sales.customer.edit") && <Link to={`/customers/${c.id}/edit`} className="btn btn-secondary btn-sm" data-testid="profile-edit">Edit</Link>}</div>
        <div className="mt-3 flex flex-wrap gap-1.5">{(c.preferences?.bhk_ids || []).map((b) => <span key={b} className="pill bg-warm-100 text-txt-secondary">{label("bhk_preference", b)}</span>)}{(c.preferences?.facing_ids || []).map((b) => <span key={b} className="pill bg-warm-100 text-txt-secondary">{label("facing", b)} facing</span>)}{c.preferences?.budget_band_id && <span className="pill bg-gold-light text-[#8a6d12]">{label("budget_band", c.preferences.budget_band_id)}</span>}</div>
        <dl className="mt-4 space-y-2 text-sm">{[["Occupation", c.occupation], ["Company", c.company_name], ["Income band", c.annual_income_band], ["Source", c.source], ["Residency", label("residency", c.residency_id)], ["Address", [c.address_current?.line1, c.address_current?.city, c.address_current?.state, c.address_current?.pincode].filter(Boolean).join(", ")]].filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-txt-secondary">{k}</dt><dd className="text-right font-medium text-ink-950">{v}</dd></div>)}</dl></Card>
      <div>{portal}</div>
    </div>
  );
}
