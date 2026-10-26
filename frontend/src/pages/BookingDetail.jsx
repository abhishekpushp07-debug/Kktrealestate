import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Ban, CheckCircle2, FileEdit, FileText, IndianRupee, Printer } from "lucide-react";
import { openPdf } from "@/pages/Reports";
import { toast } from "sonner";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { KV, Field, EmptyState } from "@/components/common/Bits";

import { LedgerTable, Due } from "@/components/common/LedgerTable";
import { DocumentsPanel } from "@/components/common/DocumentsPanel";
import { HistoryTimeline } from "@/components/common/HistoryTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BookingScheduleTab } from "@/components/common/PaymentSchedule";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inr, fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, Money, Num, StatusPill, Tabs } from "@/components/v2";
import { Avatar, ThreeLedgers } from "@/components/v2/CustomerBits";
import { PostPayment } from "@/components/v2/PostPayment";
import { JourneyButton } from "@/components/common/JourneyPanel";
import { RefundsTab, TransferDialog } from "@/components/common/BookingOps";

const TABS = ["overview", "ledgers", "schedule", "ledger", "demands", "payments", "charges", "refunds", "documents", "revisions", "history"];

function Table({ head, children, testId }) {
  return <div className="card overflow-x-auto !p-0" data-testid={testId}><table className="w-full text-sm"><thead className="text-[11px] font-semibold uppercase tracking-wide text-txt-muted"><tr>{head.map((h, i) => <th key={i} className={`px-4 py-3 ${h.r ? "text-right" : "text-left"}`}>{h.l ?? h}</th>)}</tr></thead><tbody className="divide-y divide-warm-100">{children}</tbody></table></div>;
}
function Stat({ label, value, hint, tone }) {
  return <Card className="!p-5"><p className="stat-label">{label}</p><p className={cn("stat-value font-display", tone === "brick" && "text-brick", tone === "sage" && "text-sage")}><Num s={value} /></p><p className="stat-hint">{hint}</p></Card>;
}

export default function BookingDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [b, setB] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [pay, setPay] = useState(false);
  const [rev, setRev] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [transfer, setTransfer] = useState(false);
  const [preview, setPreview] = useState(null);
  useEffect(() => { if (!cancel) { setPreview(null); return; } const t = setTimeout(() => api.get(`/bookings/${id}/cancellation-preview`, { params: cancel.deduction !== "" && cancel.deduction != null ? { deduction: Number(cancel.deduction) } : {} }).then((r) => setPreview(r.data)).catch(() => setPreview(null)), 250); return () => clearTimeout(t); }, [cancel?.deduction, !!cancel, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState("overview");
  const load = useCallback(() => Promise.all([api.get(`/bookings/${id}`), api.get(`/bookings/${id}/ledger`)]).then(([r1, r2]) => { setB(r1.data); setLedger(r2.data.rows); }).catch((e) => toast.error(errMsg(e))), [id]);
  useEffect(() => { load(); }, [load]);
  const [sp] = useSearchParams();
  useEffect(() => { if (b && sp.get("revise") === "1" && b.status === "Active" && can("sales.agreement.revise") && !rev) setRev({ cash: b.cash_agreed, account: b.account_agreed, reason: "" }); }, [b, sp]); // eslint-disable-line
  if (!b) return <Skeleton className="h-96" />;
  const s = b.summary || {};
  const act = async (path, body, msg) => { try { await api.post(path, body); toast.success(msg); load(); } catch (e) { toast.error(errMsg(e), { duration: 8000 }); } };
  const revise = async () => act(`/bookings/${id}/agreement-revisions`, { cash_agreed: Number(rev.cash), account_agreed: Number(rev.account), reason: rev.reason, version: b.version }, "Agreement revised").then(() => setRev(null));
  const doCancel = async () => act(`/bookings/${id}/cancel`, { reason: cancel.reason, ...(cancel.deduction !== "" && cancel.deduction != null ? { deduction: Number(cancel.deduction) } : {}), version: b.version }, "Booking cancelled").then(() => setCancel(null));
  const complete = async () => act(`/bookings/${id}/complete`, { version: b.version }, "Handover complete — flat marked Sold");
  const canComplete = b.status === "Active" && b.construction_percent >= 100 && s.due <= 0 && s.other_charges_due <= 0;

  return (
    <div className="space-y-8" data-testid="booking-detail">
      <Card className="relative overflow-hidden !p-6 md:!p-8" testId="booking-hero">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg,#D8B64A,#B8911C)" }} />
        <nav className="mb-4 text-xs text-txt-muted"><Link to="/bookings" className="hover:text-ink-950">Bookings</Link> › {b.booking_number}</nav>
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-5">
            <Avatar name={b.customer_name} size={64} />
            <div className="min-w-0">
              <h1 className="font-display text-3xl text-ink-950 md:text-[36px]"><Link to={`/customers/${b.customer_id}`} className="hover:text-gold" data-testid="hero-customer-link">{b.customer_name}</Link></h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5"><StatusPill status={b.status} /><span className="pill bg-ink-950 text-warm-50">{b.flat_snapshot.flat_number}</span><span className="pill bg-warm-100 text-txt-secondary">{b.project_name} · {b.block_name}</span><span className="pill bg-warm-100 text-txt-secondary">{b.flat_snapshot.flat_type_code}</span>{b.payment_plan_name && <span className="pill bg-gold-light text-[#8a6d12]">{b.payment_plan_name}</span>}</div>
              <p className="mt-3 text-sm text-txt-secondary">{b.booking_number} · booked {fmtDate(b.booking_date)} · {b.construction_percent}% constructed</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.open(`${BASE_PATH}/print/statement/${id}`, "_blank")} className="btn btn-secondary" data-testid="statement-pdf-btn"><FileText className="h-4 w-4" strokeWidth={1.75} />Statement</Button>
            <Button variant="outline" onClick={() => window.open(`${BASE_PATH}/print/allotment/${id}`, "_blank")} className="btn btn-ghost" data-testid="allotment-pdf-btn"><FileText className="h-4 w-4" strokeWidth={1.75} />Allotment</Button>
            <JourneyButton entityType="booking" entityId={id} size="default" className="btn btn-ghost" /><HistoryButton entityType="booking" entityId={id} label={b.booking_number} />
            {b.status === "Active" && can("sales.booking.transfer") && <Button variant="outline" onClick={() => setTransfer(true)} className="btn btn-ghost" data-testid="transfer-booking-btn">Transfer unit</Button>}
            {b.status === "Active" && can("finance.payment.create") && <Button onClick={() => setPay(true)} className="btn btn-primary" data-testid="post-payment-btn"><IndianRupee className="h-4 w-4" strokeWidth={1.75} />Post payment</Button>}
            {b.status === "Active" && can("sales.agreement.revise") && <Button variant="outline" onClick={() => setRev({ cash: b.cash_agreed, account: b.account_agreed, reason: "" })} className="btn btn-ghost" data-testid="revise-agreement-btn"><FileEdit className="h-4 w-4" strokeWidth={1.75} />Revise</Button>}
            {b.status === "Active" && can("sales.booking.edit") && <Button variant="outline" disabled={!canComplete} onClick={complete} title={canComplete ? "" : "Needs 100% construction and zero dues"} className="btn btn-ghost" data-testid="complete-booking-btn"><CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />Handover</Button>}
            {b.status === "Active" && can("sales.booking.cancel") && <Button variant="outline" className="btn btn-ghost text-brick" onClick={() => setCancel({ reason: "", deduction: "" })} data-testid="cancel-booking-btn"><Ban className="h-4 w-4" strokeWidth={1.75} />Cancel</Button>}
          </div>
        </div>
        <div className="mt-6 border-t border-warm-200 pt-6"><div className="flex items-center justify-between text-xs text-txt-secondary"><span>Paid <Money value={s.paid} short className="text-ink-950" /> of <Money value={b.agreement_value} short className="text-ink-950" /></span><span className="font-semibold text-ink-950">{Math.round((s.paid / (b.agreement_value || 1)) * 100)}%</span></div><div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-warm-100"><span className="block h-full rounded-full bg-sage" style={{ width: `${Math.min(100, (s.paid / (b.agreement_value || 1)) * 100)}%` }} /></div></div>
      </Card>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
        <Stat label="Agreement" value={inr(b.agreement_value)} hint={`order raised ${inr(s.total_order_raised)}`} />
        <Stat label="Cash" value={inr(s.cash_paid)} hint={`of ${inr(b.cash_agreed)} · due ${inr(Math.max(s.cash_due, 0))}`} tone={s.cash_due > 0 ? undefined : "sage"} />
        <Stat label="Account" value={inr(s.account_paid)} hint={`of ${inr(b.account_agreed)} · due ${inr(Math.max(s.account_due, 0))}`} />
        <Stat label="Outstanding" value={inr(s.outstanding ?? Math.max(s.due, 0))} hint={(s.advance ?? 0) > 0 ? `Advance held ${inr(s.advance)}` : s.pending_cheques > 0 ? `${inr(s.pending_cheques)} cheques in hand` : "no pending cheques"} tone={(s.outstanding ?? s.due) > 0 ? "brick" : "sage"} />
        <Stat label="Other charges" value={inr(s.other_charges_paid)} hint={`demanded ${inr(s.other_charges_demanded)} · due ${inr(Math.max(s.other_charges_due, 0))}`} />
      </div>
      <Tabs tabs={TABS.map((t) => ({ value: t, label: t === "ledger" ? "Statement" : t[0].toUpperCase() + t.slice(1) }))} value={tab} onChange={setTab} testId="booking-tabs" />
      <div className="hidden">{TABS.map((t) => <span key={t} data-testid={`booking-tab-${t}`} />)}</div>
      {tab === "overview" && <div className="grid gap-6 lg:grid-cols-3" data-testid="booking-overview">
          <Card><h3 className="mb-3 font-display text-lg">Customer</h3><KV label="Name" value={<Link to={`/customers/${b.customer_id}`} className="hover:underline">{b.customer?.full_name}</Link>} /><KV label="Phone" value={b.customer?.phone} /><KV label="KYC" value={b.customer?.kyc_status} />{b.co_applicants?.length > 0 && <KV label="Co-applicants" value={b.co_applicants.map((c) => c.full_name).join(", ")} />}</Card>
          <Card><h3 className="mb-3 font-display text-lg">Unit</h3><KV label="Flat" value={`${b.flat_snapshot.flat_number} · ${b.flat_snapshot.flat_type_code}`} /><KV label="Super built-up" value={`${b.flat_snapshot.super_builtup_sqft || "—"} sq.ft`} /><KV label="Rate" value={b.rate_per_sqft ? `₹${b.rate_per_sqft}/sq.ft` : "Lump sum"} /><KV label="Parking" value={b.parking_slots?.length ? b.parking_slots.map((p) => p.number).join(", ") : "None"} /></Card>
          <Card><h3 className="mb-3 font-display text-lg">Milestones</h3><ol className="space-y-1.5 text-xs">{b.block_milestones.map((m) => <li key={m.seq} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${m.status === "Completed" ? "bg-sage" : "bg-warm-200"}`} /><span className={m.status === "Completed" ? "text-ink-950" : "text-txt-muted"}>{m.name}</span><span className="ml-auto tabular-nums">{m.cumulative_percent}%</span></li>)}</ol>{b.cancellation && <div className="mt-3 rounded-xl bg-brick-50 p-3 text-xs text-brick">Cancelled {fmtDate(b.cancellation.at)}: {b.cancellation.reason}. Refund {inr(b.cancellation.refund)} · deduction {inr(b.cancellation.deduction)}</div>}</Card>
        </div>}
      {tab === "ledgers" && <ThreeLedgers bookingId={id} testId="booking-ledgers" />}
      {tab === "schedule" && <BookingScheduleTab bookingId={id} />}
      {tab === "ledger" && <LedgerTable rows={ledger} bookingId={id} bookingNumber={b.booking_number} />}
      {tab === "demands" && (
          <Table head={["Demand", "Milestone", "%", "Date", "Due date", { l: "Cash", r: 1 }, { l: "Account", r: 1 }, { l: "Total", r: 1 }, { l: "Paid", r: 1 }, "Status", ""]} testId="demands-table">
            {b.demands.map((d) => <tr key={d.id} className="border-t"><td className="px-3 py-2 font-mono text-xs"><span className="inline-flex items-center gap-2">{d.demand_number}<HistoryButton entityType="demand" entityId={d.id} label={d.demand_number} /></span></td><td className="px-3 py-2">{d.milestone_name}</td><td className="px-3 py-2">{d.cumulative_percent}%</td><td className="px-3 py-2">{fmtDate(d.demand_date)}</td><td className="px-3 py-2">{fmtDate(d.due_date)}</td><td className="px-3 py-2 text-right tabular">{inr(d.cash_demand)}</td><td className="px-3 py-2 text-right tabular">{inr(d.account_demand)}</td><td className="px-3 py-2 text-right tabular font-semibold">{inr(d.total_demand)}</td><td className="px-3 py-2 text-right tabular">{inr(d.paid)}</td><td className="px-3 py-2"><StatusPill status={d.status} /></td><td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => window.open(`${BASE_PATH}/print/demand/${id}/${d.id}`, "_blank")} data-testid={`demand-letter-${d.id}`}><Printer className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => openPdf(`/bookings/${id}/demands/${d.id}/letter.pdf`)} title="Download PDF" data-testid={`demand-pdf-${d.id}`}><FileText className="h-3.5 w-3.5" /></Button></td></tr>)}
            {b.demands.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-txt-secondary">No demands yet — raised automatically by the payment plan (booking, dates, construction stages).</td></tr>}
          </Table>
        )}
      {tab === "payments" && (
          <Table head={["Receipt", "Date", "Towards", "Mode", "Instrument", { l: "Amount", r: 1 }, "Status", ""]} testId="booking-payments-table">
            {b.payments.map((p) => <tr key={p.id} className={`border-t ${p.status === "Reversed" ? "line-through opacity-60" : ""}`}><td className="px-3 py-2 font-mono text-xs">{p.receipt_number}</td><td className="px-3 py-2">{fmtDate(p.payment_date)}</td><td className="px-3 py-2">{p.against === "FLAT_VALUE" ? `Flat value · ${p.payment_category}` : p.other_charge_name}</td><td className="px-3 py-2">{p.payment_mode_name}</td><td className="px-3 py-2 text-xs">{p.instrument?.number || "—"}</td><td className="px-3 py-2 text-right tabular font-semibold">{inr(p.amount)}</td><td className="px-3 py-2"><StatusPill status={p.status} /></td>
              <td className="px-3 py-2 whitespace-nowrap">{can("finance.receipt.print") && <><Button size="sm" variant="ghost" onClick={() => window.open(`${BASE_PATH}/print/receipt/${p.id}`, "_blank")} data-testid={`receipt-${p.id}`}><Printer className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => openPdf(`/payments/${p.id}/receipt.pdf`)} title="Download PDF" data-testid={`receipt-pdf-${p.id}`}><FileText className="h-3.5 w-3.5" /></Button></>}
                {p.status === "Pending" && can("finance.payment.create") && <><Button size="sm" variant="ghost" className="text-sage" onClick={() => act(`/payments/${p.id}/clear`, {}, "Cheque cleared")} data-testid={`clear-${p.id}`}>Clear</Button><Button size="sm" variant="ghost" className="text-brick" onClick={() => act(`/payments/${p.id}/bounce`, { reason: "Returned unpaid" }, "Marked bounced")} data-testid={`bounce-${p.id}`}>Bounce</Button></>}
                {p.status === "Cleared" && can("finance.refund.pay") && <Button size="sm" variant="ghost" className="text-brick" onClick={() => { const r = window.prompt("Reason for reversal"); if (r && r.length >= 3) act(`/payments/${p.id}/reverse`, { reason: r }, "Payment reversed"); }} data-testid={`reverse-${p.id}`}>Reverse</Button>}</td></tr>)}
            {b.payments.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-txt-secondary">No payments posted.</td></tr>}
          </Table>
        )}
      {tab === "charges" && (
          <Table head={["Charge", { l: "Amount", r: 1 }, "GST", { l: "Total", r: 1 }, "Demand", { l: "Demanded", r: 1 }, { l: "Paid", r: 1 }, { l: "Due", r: 1 }, ""]} testId="charges-table">
            {b.other_charges.map((l) => <tr key={l.line_id} className="border-t"><td className="px-3 py-2 font-medium text-ink-950">{l.name}</td><td className="px-3 py-2 text-right tabular">{inr(l.amount)}</td><td className="px-3 py-2">{l.gst_percent}% ({inr(l.gst)})</td><td className="px-3 py-2 text-right tabular font-semibold">{inr(l.total)}</td><td className="px-3 py-2 text-xs">{l.demand_at.replace("_", " ")}{l.demanded_at && ` · ${fmtDate(l.demanded_at)}`}</td><td className="px-3 py-2 text-right tabular">{inr(l.demanded)}</td><td className="px-3 py-2 text-right tabular">{inr(l.paid)}</td><td className="px-3 py-2 text-right"><Due v={l.demanded - l.paid} /></td><td className="px-3 py-2">{!l.demanded_at && b.status === "Active" && can("sales.booking.edit") && <Button size="sm" variant="ghost" onClick={() => act(`/bookings/${id}/other-charges/demand`, { line_id: l.line_id, version: b.version }, "Charge demanded")} data-testid={`demand-charge-${l.line_id}`}>Demand now</Button>}</td></tr>)}
            {b.other_charges.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-txt-secondary">No other charges.</td></tr>}
          </Table>
        )}
      {tab === "refunds" && <RefundsTab bookingId={id} canPay={can("finance.refund.pay")} onChanged={load} />}
      {tab === "documents" && <Card><DocumentsPanel entityType="booking" entityId={id} canWrite={can("sales.booking.edit")} /></Card>}
      {tab === "revisions" && (b.agreement_revisions.length === 0 ? <EmptyState title="No agreement revisions" /> : <Card className="divide-y divide-warm-100 !p-0" testId="revisions-list">{b.agreement_revisions.map((r) => <div key={r.id} className="px-5 py-3 text-sm"><p className="font-semibold text-ink-950">{fmtDateTime(r.at)} · {r.by_name}</p><p className="text-xs">Cash {inr(r.before.cash_agreed)} → <b>{inr(r.after.cash_agreed)}</b> · Account {inr(r.before.account_agreed)} → <b>{inr(r.after.account_agreed)}</b> · Total {inr(r.before.agreement_value)} → <b>{inr(r.after.agreement_value)}</b></p><p className="mt-1 text-xs text-txt-muted">Reason: {r.reason}</p></div>)}</Card>)}
      {tab === "history" && <Card><HistoryTimeline entityType="booking" entityId={id} /></Card>}
      {pay && <PostPayment open={pay} onOpenChange={setPay} bookingId={id} onPosted={load} />}
      {transfer && <TransferDialog open={transfer} onOpenChange={setTransfer} booking={b} onDone={load} />}
      <Dialog open={!!rev} onOpenChange={(o) => !o && setRev(null)}><DialogContent data-testid="revision-dialog"><DialogHeader><DialogTitle>Revise agreement</DialogTitle><DialogDescription>Each bucket must stay ≥ amount already received (Cash {inr(s.cash_paid)}, Account {inr(s.account_paid)}).</DialogDescription></DialogHeader>
        {rev && <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="Cash agreed ₹"><Input type="number" value={rev.cash} onChange={(e) => setRev({ ...rev, cash: e.target.value })} data-testid="rev-cash" /></Field><Field label="Account agreed ₹"><Input type="number" value={rev.account} onChange={(e) => setRev({ ...rev, account: e.target.value })} data-testid="rev-account" /></Field></div><p className="text-sm">New agreement value: <b className="text-ink-950">{inr(Number(rev.cash) + Number(rev.account))}</b></p><Field label="Reason" required><Textarea value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} data-testid="rev-reason" /></Field><Button disabled={rev.reason.length < 3} onClick={revise} className="w-full bg-ink-950 hover:bg-ink-800" data-testid="rev-submit">Save revision</Button></div>}</DialogContent></Dialog>
      <Dialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)}><DialogContent data-testid="cancel-dialog"><DialogHeader><DialogTitle>Cancel booking</DialogTitle><DialogDescription>Flat and parking return to Available. Refund cannot exceed {inr(s.paid + s.other_charges_paid)} received.</DialogDescription></DialogHeader>
        {cancel && <div className="space-y-3"><Field label="Reason" required><Textarea value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} data-testid="cancel-reason" /></Field><Field label="Deduction ₹ (blank = project cancellation policy)"><Input type="number" value={cancel.deduction} onChange={(e) => setCancel({ ...cancel, deduction: e.target.value })} data-testid="cancel-deduction" /></Field>{preview && <div className="rounded-xl bg-warm-50 p-3 text-xs" data-testid="cancel-refund-hint"><p className="label mb-1">Refund formula ({preview.policy.deduction_base === "received" ? "% of received" : preview.policy.deduction_base === "fixed" ? "fixed" : "% of agreement"} policy)</p>{preview.lines.map((l, i) => <div key={i} className={`flex justify-between py-0.5 ${l.info ? "text-txt-muted" : ""} ${l.label.startsWith("=") ? "border-t border-warm-200 mt-1 pt-1 font-semibold text-ink-950" : ""}`} data-testid={`cancel-line-${i}`}><span>{l.label}</span><span className="font-mono">{inr(l.amount_paise / 100)}</span></div>)}<p className="mt-2 text-txt-secondary">{preview.refund_paise > 0 ? "A refund record (Pending) is created for Accounts to pay; the payout posts contra ledger rows and a Roznamcha cash-out." : "Nothing refundable → a forfeiture record is created; no payout."}</p></div>}<Button disabled={cancel.reason.length < 3} onClick={doCancel} className="w-full bg-red-600 hover:bg-red-700" data-testid="cancel-submit">Confirm cancellation</Button></div>}</DialogContent></Dialog>
    </div>
  );
}
