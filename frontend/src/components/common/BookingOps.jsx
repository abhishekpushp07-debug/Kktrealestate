import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Field, EmptyState } from "@/components/common/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, StatusPill } from "@/components/v2";
import { inr, fmtDate } from "@/lib/format";
import { useMasterOptions } from "@/hooks/useList";

const today = () => new Date().toISOString().slice(0, 10);

export function RefundsTab({ bookingId, canPay, onChanged }) {
  const [items, setItems] = useState(null);
  const [pay, setPay] = useState(null);
  const { options: banks } = useMasterOptions("bank-accounts", (b) => ({ value: b.id, label: `${b.bank_name} · ${b.account_name}` }));
  const load = () => api.get(`/bookings/${bookingId}/refunds`).then((r) => setItems(r.data.items)).catch(() => setItems([]));
  useEffect(() => { load(); }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    try { await api.post(`/refunds/${pay.id}/pay`, { paid_date: pay.paid_date, mode: pay.mode, bank_account_id: pay.mode === "CASH" ? null : pay.bank_account_id || null, reference: pay.reference || null }); toast.success("Refund paid — contra posted to ledger and Roznamcha"); setPay(null); load(); onChanged?.(); }
    catch (e) { toast.error(errMsg(e), { duration: 8000 }); }
  };
  if (!items) return null;
  if (items.length === 0) return <EmptyState title="No refunds" description="Refund records are created when a booking is cancelled with money received." />;
  return (
    <Card className="overflow-x-auto !p-0" testId="refunds-table">
      <table className="w-full text-sm"><thead className="text-[11px] font-semibold uppercase tracking-wide text-txt-muted"><tr><th className="px-3 py-2 text-left">Refund</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Deduction</th><th className="px-3 py-2 text-right">Payable</th><th className="px-3 py-2 text-left">Due by</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Paid</th><th /></tr></thead>
        <tbody>{items.filter((r) => !r.parent_refund_id).map((r) => <tr key={r.id} className="border-t" data-testid={`refund-row-${r.status}`}><td className="px-3 py-2 font-mono text-xs"><span className="inline-flex items-center gap-2"><HistoryButton entityType="refund" entityId={r.id} />{r.refund_number}</span></td><td className="px-3 py-2 text-right">{inr(r.received)}</td><td className="px-3 py-2 text-right">{inr(r.deduction)}</td><td className="px-3 py-2 text-right font-semibold">{inr(r.amount_total ?? r.amount)}</td><td className="px-3 py-2">{r.due_by ? fmtDate(r.due_by) : "—"}</td><td className="px-3 py-2"><StatusPill status={r.status} /></td><td className="px-3 py-2 text-xs">{r.status === "Paid" ? `${fmtDate(r.paid_date)} · ${r.mode} ${r.reference || ""}` : "—"}</td>
          <td className="px-3 py-2 text-right">{r.status === "Pending" && canPay && <Button size="sm" onClick={() => setPay({ id: r.id, paid_date: today(), mode: "NEFT_RTGS", bank_account_id: "", reference: "" })} data-testid="refund-pay-btn">Mark paid</Button>}</td></tr>)}</tbody></table>
      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}><DialogContent data-testid="refund-pay-dialog"><DialogHeader><DialogTitle>Pay refund</DialogTitle><DialogDescription>Posts a contra row in the bucket the money came from and a cash-out/bank-out line in the Roznamcha.</DialogDescription></DialogHeader>
        {pay && <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Field label="Paid on" required><Input type="date" value={pay.paid_date} max={today()} onChange={(e) => setPay({ ...pay, paid_date: e.target.value })} data-testid="refund-date" /></Field>
          <Field label="Mode" required><select className="input" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })} data-testid="refund-mode">{["CASH", "NEFT_RTGS", "CHEQUE", "UPI", "DD"].map((m) => <option key={m}>{m}</option>)}</select></Field></div>
          {pay.mode !== "CASH" && <Field label="From bank account" required><select className="input" value={pay.bank_account_id} onChange={(e) => setPay({ ...pay, bank_account_id: e.target.value })} data-testid="refund-bank"><option value="">Select…</option>{banks.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></Field>}
          <Field label="Reference / UTR"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} data-testid="refund-reference" /></Field>
          <Button className="w-full" disabled={pay.mode !== "CASH" && !pay.bank_account_id} onClick={submit} data-testid="refund-pay-submit">Confirm payout</Button></div>}
      </DialogContent></Dialog>
    </Card>
  );
}

export function TransferDialog({ open, onOpenChange, booking, onDone }) {
  const [mode, setMode] = useState("transfer");
  const [flats, setFlats] = useState([]);
  const [others, setOthers] = useState([]);
  const curPct = booking.agreement_value_paise ? Math.round((booking.cash_agreed_paise * 10000) / booking.agreement_value_paise) / 100 : 0;
  const [f, setF] = useState({ new_flat_id: "", reason: "", price_handling: "revise_agreement", old_flat_status: "Available", cash_percent: curPct, other_booking_id: "" });
  useEffect(() => { if (!open) return; api.get("/flats", { params: { status: "Available", page_size: 200 } }).then((r) => setFlats(r.data.items)).catch(() => setFlats([])); api.get("/bookings", { params: { status: "Active", page_size: 100 } }).then((r) => setOthers((r.data.items || []).filter((b) => b.id !== booking.id))).catch(() => setOthers([])); }, [open, booking.id]);
  const target = flats.find((x) => x.id === f.new_flat_id);
  const s = booking.summary || {};
  const newPrice = target?.price_paise ?? (target?.price != null ? Math.round(target.price * 100) : null);
  const revise = f.price_handling === "revise_agreement" && newPrice != null && newPrice !== booking.agreement_value_paise;
  const newCash = revise ? Math.round((newPrice * Number(f.cash_percent || 0)) / 100) : booking.cash_agreed_paise;
  const newAcc = revise ? newPrice - newCash : booking.account_agreed_paise;
  const belowCash = revise && newCash < (s.cash_paid_paise || 0);
  const belowAcc = revise && newAcc < (s.account_paid_paise || 0);
  const minPct = revise && newPrice ? Math.ceil(((s.cash_paid_paise || 0) * 10000) / newPrice) / 100 : null;
  const maxPct = revise && newPrice ? Math.floor(((newPrice - (s.account_paid_paise || 0)) * 10000) / newPrice) / 100 : null;
  const submit = async () => {
    try {
      if (mode === "swap") { await api.post(`/bookings/${booking.id}/swap`, { other_booking_id: f.other_booking_id, reason: f.reason, version: booking.version }); toast.success("Units swapped between the two bookings"); }
      else { const r = await api.post(`/bookings/${booking.id}/transfer`, { new_flat_id: f.new_flat_id, reason: f.reason, price_handling: f.price_handling, old_flat_status: f.old_flat_status, cash_percent: revise ? Number(f.cash_percent) : null, version: booking.version }); toast.success(`Transferred ${r.data.transfer.from_flat} → ${r.data.transfer.to_flat} · ${r.data.rebind.rebound} demand(s) re-bound`); }
      onOpenChange(false); onDone?.();
    } catch (e) { toast.error(errMsg(e), { duration: 8000 }); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-testid="transfer-dialog"><DialogHeader><DialogTitle>Transfer unit</DialogTitle><DialogDescription>Money follows the customer: ledgers and receipts stay on {booking.booking_number}. Open demands and the unpaid schedule are recomputed from the new agreement.</DialogDescription></DialogHeader>
      <div className="mb-3 flex gap-1.5">{[["transfer", "Move to an available unit"], ["swap", "Swap with another booking"]].map(([m, l]) => <button key={m} onClick={() => setMode(m)} className={`pill ${mode === m ? "bg-ink-950 text-warm-50" : "bg-warm-100 text-ink-950"}`} data-testid={`transfer-mode-${m}`}>{l}</button>)}</div>
      <div className="space-y-3">
        {mode === "swap" ? (
          <Field label="Swap with booking" required><select className="input" value={f.other_booking_id} onChange={(e) => setF({ ...f, other_booking_id: e.target.value })} data-testid="swap-booking"><option value="">Select an active booking…</option>{others.map((b) => <option key={b.id} value={b.id}>{b.booking_number} · {b.customer_name} · {b.flat_snapshot?.flat_number}</option>)}</select></Field>
        ) : (<>
          <Field label="New unit" required><select className="input" value={f.new_flat_id} onChange={(e) => setF({ ...f, new_flat_id: e.target.value })} data-testid="transfer-flat"><option value="">Select an available unit…</option>{flats.filter((x) => x.id !== booking.flat_id).map((x) => <option key={x.id} value={x.id}>{x.flat_number} · {x.flat_type_code || ""} · {x.price != null ? inr(x.price) : "no price"}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price handling"><select className="input" value={f.price_handling} onChange={(e) => setF({ ...f, price_handling: e.target.value })} data-testid="transfer-price-handling"><option value="revise_agreement">Revise agreement to new unit price</option><option value="keep_agreement">Keep current agreement</option></select></Field>
            <Field label="Old unit becomes"><select className="input" value={f.old_flat_status} onChange={(e) => setF({ ...f, old_flat_status: e.target.value })} data-testid="transfer-old-status"><option>Available</option><option>Hold</option></select></Field>
          </div>
          {revise && <div className="grid grid-cols-2 gap-3">
            <Field label="Cash %" hint={`current ${curPct}%`}><Input type="number" min="0" max="100" step="0.01" value={f.cash_percent} onChange={(e) => setF({ ...f, cash_percent: e.target.value })} data-testid="transfer-cash-pct" /></Field>
            <Field label="Cash amount ₹"><Input type="number" value={Math.round(newCash / 100)} onChange={(e) => setF({ ...f, cash_percent: newPrice ? Math.round((Number(e.target.value) * 100 * 10000) / newPrice) / 100 : f.cash_percent })} data-testid="transfer-cash-amt" /></Field>
            <p className={`col-span-2 text-xs ${belowCash || belowAcc ? "text-brick" : "text-txt-secondary"}`} data-testid="transfer-split-check">
              {belowCash ? `Cash bucket ${inr(newCash / 100)} is below cash already received ${inr((s.cash_paid_paise || 0) / 100)} — raise cash % to at least ${minPct}%.` : belowAcc ? `Account bucket ${inr(newAcc / 100)} is below account money received ${inr((s.account_paid_paise || 0) / 100)} — lower cash % to at most ${maxPct}%.` : `New agreement ${inr(newPrice / 100)} → cash ${inr(newCash / 100)} / account ${inr(newAcc / 100)} (received: cash ${inr((s.cash_paid_paise || 0) / 100)}, account ${inr((s.account_paid_paise || 0) / 100)}).`}
            </p>
          </div>}
        </>)}
        <Field label="Reason" required><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="transfer-reason" /></Field>
        <Button className="w-full" disabled={f.reason.length < 3 || (mode === "swap" ? !f.other_booking_id : !f.new_flat_id || belowCash || belowAcc)} onClick={submit} data-testid="transfer-submit">{mode === "swap" ? "Swap units" : "Transfer"}</Button>
      </div>
    </DialogContent></Dialog>
  );
}
