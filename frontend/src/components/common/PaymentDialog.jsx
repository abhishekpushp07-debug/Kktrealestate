import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useMasterOptions } from "@/hooks/useList";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "./Bits";
import { Combobox } from "./Combobox";
import { inr } from "@/lib/format";

export function PaymentDialog({ open, onOpenChange, booking, onPosted }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ against: "FLAT_VALUE", payment_category: "Cash", other_charge_line_id: "", amount: "", payment_date: today, payment_mode_id: null, number: "", inst_date: "", bank_name: "", bank_account_id: null, remarks: "" });
  const [busy, setBusy] = useState(false);
  const { options: modes } = useMasterOptions("payment-modes", (m) => ({ value: m.id, label: m.name, sub: m.requires_reference ? "ref. required" : undefined, code: m.code, requires_reference: m.requires_reference }));
  const { options: banks } = useMasterOptions("bank-accounts", (b) => ({ value: b.id, label: `${b.bank_name} ${b.account_number_masked || ""}`, sub: b.ifsc }));
  const mode = modes.find((m) => m.value === f.payment_mode_id);
  const isCash = mode?.code === "CASH";
  useEffect(() => { if (open) setF((p) => ({ ...p, amount: "", number: "", remarks: "" })); }, [open]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const s = booking?.summary || {};
  const headroom = f.against === "FLAT_VALUE" ? (f.payment_category === "Cash" ? booking.cash_agreed - s.cash_paid : booking.account_agreed - s.account_paid) : null;
  const lines = (booking?.other_charges || []).filter((l) => l.demanded_at || true);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const body = { booking_id: booking.id, against: f.against, payment_category: f.against === "FLAT_VALUE" ? f.payment_category : null, other_charge_line_id: f.against === "OTHER_CHARGE" ? f.other_charge_line_id : null,
        amount: Number(f.amount), payment_date: f.payment_date, payment_mode_id: f.payment_mode_id, bank_account_id: isCash ? null : f.bank_account_id, remarks: f.remarks || null,
        instrument: isCash ? null : { number: f.number || null, date: f.inst_date || null, bank_name: f.bank_name || null } };
      const r = await api.post("/payments", body);
      toast.success(`Receipt ${r.data.receipt_number} ${r.data.status === "Pending" ? "recorded (cheque in hand)" : "posted"}`, { action: { label: "Print receipt", onClick: () => window.open(`${process.env.REACT_APP_BASE_PATH || ""}/print/receipt/${r.data.id}`, "_blank") } });
      onPosted?.(r.data); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err), { duration: 8000 }); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="payment-dialog">
        <DialogHeader><DialogTitle>Post payment · {booking?.booking_number}</DialogTitle><DialogDescription>{booking?.customer_name} · {booking?.flat_snapshot?.flat_number}. Only cleared payments count toward dues.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Against" required><Select value={f.against} onValueChange={(v) => set("against", v)}><SelectTrigger data-testid="pay-against"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FLAT_VALUE">Flat value</SelectItem><SelectItem value="OTHER_CHARGE">Other charge</SelectItem></SelectContent></Select></Field>
            {f.against === "FLAT_VALUE" ? <Field label="Bucket" required><Select value={f.payment_category} onValueChange={(v) => set("payment_category", v)}><SelectTrigger data-testid="pay-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Account">Account</SelectItem></SelectContent></Select></Field>
              : <Field label="Charge line" required><Select value={f.other_charge_line_id} onValueChange={(v) => set("other_charge_line_id", v)}><SelectTrigger data-testid="pay-charge-line"><SelectValue placeholder="Select charge" /></SelectTrigger><SelectContent>{lines.map((l) => <SelectItem key={l.line_id} value={l.line_id}>{l.name} · {inr(l.total - l.paid)} due</SelectItem>)}</SelectContent></Select></Field>}
          </div>
          {headroom != null && <p className="text-xs text-txt-secondary" data-testid="pay-headroom">{f.payment_category} bucket: agreed {inr(f.payment_category === "Cash" ? booking.cash_agreed : booking.account_agreed)} · received {inr(f.payment_category === "Cash" ? s.cash_paid : s.account_paid)} · can accept up to <b className="text-ink-950">{inr(headroom)}</b></p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" required><Input type="number" min="1" step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} required data-testid="pay-amount" /></Field>
            <Field label="Payment date" required><DateInput value={f.payment_date} max={today} min={booking?.booking_date} onChange={(e) => set("payment_date", e.target.value)} required data-testid="pay-date" /></Field>
          </div>
          <Field label="Mode" required><Combobox options={modes} value={f.payment_mode_id} onChange={(v) => set("payment_mode_id", v)} placeholder="Select mode" testId="pay-mode" /></Field>
          {!isCash && f.payment_mode_id && <>
            <div className="grid grid-cols-3 gap-3">
              <Field label={mode?.requires_reference ? "Instrument / UTR no." : "Reference"} required={mode?.requires_reference}><Input value={f.number} onChange={(e) => set("number", e.target.value)} data-testid="pay-instrument" /></Field>
              <Field label="Instrument date"><DateInput value={f.inst_date} onChange={(e) => set("inst_date", e.target.value)} /></Field>
              <Field label="Drawn on bank"><Input value={f.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></Field>
            </div>
            <Field label="Credited to company account" required><Combobox options={banks} value={f.bank_account_id} onChange={(v) => set("bank_account_id", v)} placeholder="Select bank account" testId="pay-bank" /></Field>
          </>}
          <Field label="Remarks"><Input value={f.remarks} onChange={(e) => set("remarks", e.target.value)} data-testid="pay-remarks" /></Field>
          {(mode?.code === "CHEQUE" || mode?.code === "DD") && <p className="rounded-md bg-amber2-50 px-3 py-2 text-xs text-amber2">Cheque/DD is recorded as <b>Pending</b> (subject to realisation). Clear or bounce it from the Payments page.</p>}
          <Button type="submit" disabled={busy || !f.payment_mode_id} className="w-full bg-ink-950 hover:bg-ink-800" data-testid="pay-submit">{busy ? "Posting…" : "Post payment"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
