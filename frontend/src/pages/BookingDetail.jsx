import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Ban, CheckCircle2, FileEdit, FileText, IndianRupee, Printer } from "lucide-react";
import { openPdf } from "@/pages/Reports";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, KV, StatCard, Field, EmptyState } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { LedgerTable, Due } from "@/components/common/LedgerTable";
import { PaymentDialog } from "@/components/common/PaymentDialog";
import { DocumentsPanel } from "@/components/common/DocumentsPanel";
import { HistoryTimeline } from "@/components/common/HistoryTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inr, fmtDate, fmtDateTime } from "@/lib/format";
import { BOOKING_TONE } from "./Bookings";

const PAY_TONE = { Cleared: "emerald", Pending: "amber", Bounced: "red", Reversed: "red" };
const DEM_TONE = { Open: "red", "Partially Paid": "amber", Paid: "emerald", Voided: "slate", Cancelled: "slate" };

function Table({ head, children, testId }) {
  return <div className="card-elev overflow-x-auto" data-testid={testId}><table className="w-full text-sm"><thead className="bg-surface text-[10px] uppercase text-slate-500"><tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 ${h.r ? "text-right" : "text-left"}`}>{h.l ?? h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export default function BookingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [b, setB] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [pay, setPay] = useState(false);
  const [rev, setRev] = useState(null);
  const [cancel, setCancel] = useState(null);
  const load = useCallback(() => Promise.all([api.get(`/bookings/${id}`), api.get(`/bookings/${id}/ledger`)]).then(([r1, r2]) => { setB(r1.data); setLedger(r2.data.rows); }).catch((e) => toast.error(errMsg(e))), [id]);
  useEffect(() => { load(); }, [load]);
  if (!b) return <Skeleton className="h-96" />;
  const s = b.summary || {};
  const act = async (path, body, msg) => { try { await api.post(path, body); toast.success(msg); load(); } catch (e) { toast.error(errMsg(e), { duration: 8000 }); } };
  const revise = async () => act(`/bookings/${id}/agreement-revisions`, { cash_agreed: Number(rev.cash), account_agreed: Number(rev.account), reason: rev.reason, version: b.version }, "Agreement revised").then(() => setRev(null));
  const doCancel = async () => act(`/bookings/${id}/cancel`, { reason: cancel.reason, refund: Number(cancel.refund) || 0, deduction: Number(cancel.deduction) || 0, version: b.version }, "Booking cancelled").then(() => setCancel(null));
  const complete = async () => act(`/bookings/${id}/complete`, { version: b.version }, "Handover complete — flat marked Sold");
  const canComplete = b.status === "Active" && b.construction_percent >= 100 && s.due <= 0 && s.other_charges_due <= 0;

  return (
    <div data-testid="booking-detail">
      <PageHeader title={b.booking_number} subtitle={`${b.customer_name} · ${b.project_name} · ${b.block_name} · ${b.flat_snapshot.flat_number} (${b.flat_snapshot.flat_type_code}) · booked ${fmtDate(b.booking_date)}`} crumbs={[{ label: "Bookings", to: "/erp/bookings" }, { label: b.booking_number }]}
        actions={<div className="flex flex-wrap gap-2"><Pill tone={BOOKING_TONE[b.status]}>{b.status}</Pill>
          <Button variant="outline" onClick={() => openPdf(`/reports/statement/${id}?format=pdf`)} data-testid="statement-pdf-btn"><FileText className="mr-1 h-4 w-4" />Statement PDF</Button>
          <Button variant="outline" onClick={() => openPdf(`/reports/allotment/${id}?format=pdf`)} data-testid="allotment-pdf-btn"><FileText className="mr-1 h-4 w-4" />Allotment letter</Button>
          {b.status === "Active" && can("payment.post") && <Button onClick={() => setPay(true)} className="bg-navy hover:bg-navy-700" data-testid="post-payment-btn"><IndianRupee className="mr-1 h-4 w-4" />Post payment</Button>}
          {b.status === "Active" && can("agreement.edit") && <Button variant="outline" onClick={() => setRev({ cash: b.cash_agreed, account: b.account_agreed, reason: "" })} data-testid="revise-agreement-btn"><FileEdit className="mr-1 h-4 w-4" />Revise agreement</Button>}
          {b.status === "Active" && can("booking.create") && <Button variant="outline" disabled={!canComplete} onClick={complete} title={canComplete ? "" : "Needs 100% construction and zero dues"} data-testid="complete-booking-btn"><CheckCircle2 className="mr-1 h-4 w-4" />Handover</Button>}
          {b.status === "Active" && can("booking.cancel") && <Button variant="outline" className="text-red-600" onClick={() => setCancel({ reason: "", refund: s.paid, deduction: 0 })} data-testid="cancel-booking-btn"><Ban className="mr-1 h-4 w-4" />Cancel</Button>}</div>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Agreement" value={inr(b.agreement_value)} hint={`${b.construction_percent}% constructed · order raised ${inr(s.total_order_raised)}`} testId="stat-agreement" />
        <StatCard label="Cash" value={inr(s.cash_paid)} hint={<>of {inr(b.cash_agreed)} · due <Due v={s.cash_due} testId="stat-cash-due" /></>} accent="gold" />
        <StatCard label="Account" value={inr(s.account_paid)} hint={<>of {inr(b.account_agreed)} · due <Due v={s.account_due} testId="stat-account-due" /></>} accent="navy" />
        <StatCard label="Total due" value={<Due v={s.due} testId="stat-total-due" />} hint={s.pending_cheques > 0 ? `${inr(s.pending_cheques)} cheques in hand` : "no pending cheques"} accent={s.due > 0 ? "amber" : "emerald"} />
        <StatCard label="Other charges" value={inr(s.other_charges_paid)} hint={<>demanded {inr(s.other_charges_demanded)} · due <Due v={s.other_charges_due} /></>} />
      </div>
      <Tabs defaultValue="overview" className="mt-6">
        <TabsList className="flex-wrap bg-white" data-testid="booking-tabs">{["overview", "ledger", "demands", "payments", "charges", "documents", "revisions", "history"].map((t) => <TabsTrigger key={t} value={t} className="capitalize data-[state=active]:bg-navy data-[state=active]:text-white" data-testid={`booking-tab-${t}`}>{t}</TabsTrigger>)}</TabsList>
        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="card-elev p-5"><h3 className="mb-3 text-base font-bold text-navy">Customer</h3><KV label="Name" value={<Link to={`/customers/${b.customer_id}`} className="hover:underline">{b.customer?.full_name}</Link>} /><KV label="Phone" value={b.customer?.phone} /><KV label="KYC" value={b.customer?.kyc_status} />{b.co_applicants?.length > 0 && <KV label="Co-applicants" value={b.co_applicants.map((c) => c.full_name).join(", ")} />}</div>
          <div className="card-elev p-5"><h3 className="mb-3 text-base font-bold text-navy">Unit</h3><KV label="Flat" value={`${b.flat_snapshot.flat_number} · ${b.flat_snapshot.flat_type_code}`} /><KV label="Super built-up" value={`${b.flat_snapshot.super_builtup_sqft || "—"} sq.ft`} /><KV label="Rate" value={b.rate_per_sqft ? `₹${b.rate_per_sqft}/sq.ft` : "Lump sum"} /><KV label="Parking" value={b.parking_slots?.length ? b.parking_slots.map((p) => p.number).join(", ") : "None"} /><KV label="Sales" value={b.sales_user_id === b.created_by ? "—" : ""} /></div>
          <div className="card-elev p-5"><h3 className="mb-3 text-base font-bold text-navy">Milestones</h3><ol className="space-y-1 text-xs">{b.block_milestones.map((m) => <li key={m.seq} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${m.status === "Completed" ? "bg-emerald-500" : "bg-slate-300"}`} /><span className={m.status === "Completed" ? "text-navy" : "text-slate-500"}>{m.name}</span><span className="ml-auto tabular">{m.cumulative_percent}%</span></li>)}</ol>{b.cancellation && <div className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">Cancelled {fmtDate(b.cancellation.at)}: {b.cancellation.reason}. Refund {inr(b.cancellation.refund)} · deduction {inr(b.cancellation.deduction)}</div>}</div>
        </TabsContent>
        <TabsContent value="ledger" className="mt-4"><LedgerTable rows={ledger} bookingId={id} bookingNumber={b.booking_number} /></TabsContent>
        <TabsContent value="demands" className="mt-4">
          <Table head={["Demand", "Milestone", "%", "Date", "Due date", { l: "Cash", r: 1 }, { l: "Account", r: 1 }, { l: "Total", r: 1 }, { l: "Paid", r: 1 }, "Status", ""]} testId="demands-table">
            {b.demands.map((d) => <tr key={d.id} className="border-t"><td className="px-3 py-2 font-mono text-xs">{d.demand_number}</td><td className="px-3 py-2">{d.milestone_name}</td><td className="px-3 py-2">{d.cumulative_percent}%</td><td className="px-3 py-2">{fmtDate(d.demand_date)}</td><td className="px-3 py-2">{fmtDate(d.due_date)}</td><td className="px-3 py-2 text-right tabular">{inr(d.cash_demand)}</td><td className="px-3 py-2 text-right tabular">{inr(d.account_demand)}</td><td className="px-3 py-2 text-right tabular font-semibold">{inr(d.total_demand)}</td><td className="px-3 py-2 text-right tabular">{inr(d.paid)}</td><td className="px-3 py-2"><Pill tone={DEM_TONE[d.status] || "slate"}>{d.status}</Pill></td><td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => nav(`/erp/print/demand/${id}/${d.id}`)} data-testid={`demand-letter-${d.id}`}><Printer className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => openPdf(`/bookings/${id}/demands/${d.id}/letter.pdf`)} title="Download PDF" data-testid={`demand-pdf-${d.id}`}><FileText className="h-3.5 w-3.5" /></Button></td></tr>)}
            {b.demands.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-500">No demands yet — raised when block milestones complete.</td></tr>}
          </Table>
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <Table head={["Receipt", "Date", "Towards", "Mode", "Instrument", { l: "Amount", r: 1 }, "Status", ""]} testId="booking-payments-table">
            {b.payments.map((p) => <tr key={p.id} className={`border-t ${p.status === "Reversed" ? "line-through opacity-60" : ""}`}><td className="px-3 py-2 font-mono text-xs">{p.receipt_number}</td><td className="px-3 py-2">{fmtDate(p.payment_date)}</td><td className="px-3 py-2">{p.against === "FLAT_VALUE" ? `Flat value · ${p.payment_category}` : p.other_charge_name}</td><td className="px-3 py-2">{p.payment_mode_name}</td><td className="px-3 py-2 text-xs">{p.instrument?.number || "—"}</td><td className="px-3 py-2 text-right tabular font-semibold">{inr(p.amount)}</td><td className="px-3 py-2"><Pill tone={PAY_TONE[p.status]}>{p.status}</Pill></td>
              <td className="px-3 py-2 whitespace-nowrap">{can("receipt.print") && <><Button size="sm" variant="ghost" onClick={() => nav(`/erp/print/receipt/${p.id}`)} data-testid={`receipt-${p.id}`}><Printer className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => openPdf(`/payments/${p.id}/receipt.pdf`)} title="Download PDF" data-testid={`receipt-pdf-${p.id}`}><FileText className="h-3.5 w-3.5" /></Button></>}
                {p.status === "Pending" && can("payment.post") && <><Button size="sm" variant="ghost" className="text-emerald-700" onClick={() => act(`/payments/${p.id}/clear`, {}, "Cheque cleared")} data-testid={`clear-${p.id}`}>Clear</Button><Button size="sm" variant="ghost" className="text-red-600" onClick={() => act(`/payments/${p.id}/bounce`, { reason: "Returned unpaid" }, "Marked bounced")} data-testid={`bounce-${p.id}`}>Bounce</Button></>}
                {p.status === "Cleared" && can("payment.reverse") && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { const r = window.prompt("Reason for reversal"); if (r && r.length >= 3) act(`/payments/${p.id}/reverse`, { reason: r }, "Payment reversed"); }} data-testid={`reverse-${p.id}`}>Reverse</Button>}</td></tr>)}
            {b.payments.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No payments posted.</td></tr>}
          </Table>
        </TabsContent>
        <TabsContent value="charges" className="mt-4">
          <Table head={["Charge", { l: "Amount", r: 1 }, "GST", { l: "Total", r: 1 }, "Demand", { l: "Demanded", r: 1 }, { l: "Paid", r: 1 }, { l: "Due", r: 1 }, ""]} testId="charges-table">
            {b.other_charges.map((l) => <tr key={l.line_id} className="border-t"><td className="px-3 py-2 font-medium text-navy">{l.name}</td><td className="px-3 py-2 text-right tabular">{inr(l.amount)}</td><td className="px-3 py-2">{l.gst_percent}% ({inr(l.gst)})</td><td className="px-3 py-2 text-right tabular font-semibold">{inr(l.total)}</td><td className="px-3 py-2 text-xs">{l.demand_at.replace("_", " ")}{l.demanded_at && ` · ${fmtDate(l.demanded_at)}`}</td><td className="px-3 py-2 text-right tabular">{inr(l.demanded)}</td><td className="px-3 py-2 text-right tabular">{inr(l.paid)}</td><td className="px-3 py-2 text-right"><Due v={l.demanded - l.paid} /></td><td className="px-3 py-2">{!l.demanded_at && b.status === "Active" && can("booking.create") && <Button size="sm" variant="ghost" onClick={() => act(`/bookings/${id}/other-charges/demand`, { line_id: l.line_id, version: b.version }, "Charge demanded")} data-testid={`demand-charge-${l.line_id}`}>Demand now</Button>}</td></tr>)}
            {b.other_charges.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">No other charges.</td></tr>}
          </Table>
        </TabsContent>
        <TabsContent value="documents" className="mt-4"><div className="card-elev p-5"><DocumentsPanel entityType="booking" entityId={id} canWrite={can("booking.create")} /></div></TabsContent>
        <TabsContent value="revisions" className="mt-4">{b.agreement_revisions.length === 0 ? <EmptyState title="No agreement revisions" /> : <div className="card-elev divide-y" data-testid="revisions-list">{b.agreement_revisions.map((r) => <div key={r.id} className="px-4 py-3 text-sm"><p className="font-semibold text-navy">{fmtDateTime(r.at)} · {r.by_name}</p><p className="text-xs">Cash {inr(r.before.cash_agreed)} → <b>{inr(r.after.cash_agreed)}</b> · Account {inr(r.before.account_agreed)} → <b>{inr(r.after.account_agreed)}</b> · Total {inr(r.before.agreement_value)} → <b>{inr(r.after.agreement_value)}</b></p><p className="mt-1 text-xs text-slate-500">Reason: {r.reason}</p></div>)}</div>}</TabsContent>
        <TabsContent value="history" className="mt-4"><div className="card-elev p-5"><HistoryTimeline entityType="booking" entityId={id} /></div></TabsContent>
      </Tabs>
      {pay && <PaymentDialog open={pay} onOpenChange={setPay} booking={b} onPosted={load} />}
      <Dialog open={!!rev} onOpenChange={(o) => !o && setRev(null)}><DialogContent data-testid="revision-dialog"><DialogHeader><DialogTitle>Revise agreement</DialogTitle><DialogDescription>Each bucket must stay ≥ amount already received (Cash {inr(s.cash_paid)}, Account {inr(s.account_paid)}).</DialogDescription></DialogHeader>
        {rev && <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="Cash agreed ₹"><Input type="number" value={rev.cash} onChange={(e) => setRev({ ...rev, cash: e.target.value })} data-testid="rev-cash" /></Field><Field label="Account agreed ₹"><Input type="number" value={rev.account} onChange={(e) => setRev({ ...rev, account: e.target.value })} data-testid="rev-account" /></Field></div><p className="text-sm">New agreement value: <b className="text-navy">{inr(Number(rev.cash) + Number(rev.account))}</b></p><Field label="Reason" required><Textarea value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} data-testid="rev-reason" /></Field><Button disabled={rev.reason.length < 3} onClick={revise} className="w-full bg-navy hover:bg-navy-700" data-testid="rev-submit">Save revision</Button></div>}</DialogContent></Dialog>
      <Dialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)}><DialogContent data-testid="cancel-dialog"><DialogHeader><DialogTitle>Cancel booking</DialogTitle><DialogDescription>Flat and parking return to Available. Refund cannot exceed {inr(s.paid + s.other_charges_paid)} received.</DialogDescription></DialogHeader>
        {cancel && <div className="space-y-3"><Field label="Reason" required><Textarea value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} data-testid="cancel-reason" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Deduction ₹"><Input type="number" value={cancel.deduction} onChange={(e) => setCancel({ ...cancel, deduction: e.target.value, refund: Math.max((s.paid + s.other_charges_paid) - Number(e.target.value), 0) })} /></Field><Field label="Refund ₹"><Input type="number" value={cancel.refund} onChange={(e) => setCancel({ ...cancel, refund: e.target.value })} data-testid="cancel-refund" /></Field></div><Button disabled={cancel.reason.length < 3} onClick={doCancel} className="w-full bg-red-600 hover:bg-red-700" data-testid="cancel-submit">Confirm cancellation</Button></div>}</DialogContent></Dialog>
    </div>
  );
}
