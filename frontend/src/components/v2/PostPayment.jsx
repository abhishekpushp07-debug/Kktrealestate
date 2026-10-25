import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { CheckCircle2, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useMasterOptions } from "@/hooks/useList";
import { useCatalogues } from "@/hooks/useCatalogues";
import { cn } from "@/lib/utils";
import { inr } from "@/lib/format";
import { Field, Money, Num, Skeleton, StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Avatar, Segmented, usePeople } from "@/components/v2/CustomerBits";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const today = () => new Date().toISOString().slice(0, 10);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const EMPTY_S = {};

function BookingPicker({ value, onChange, customerId }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  useEffect(() => { const t = setTimeout(() => api.get("/bookings", { params: { search: q || undefined, status: "Active", page_size: 8, customer_id: customerId || undefined, include: "customer" } }).then((r) => setItems(r.data.items)).catch(() => {}), 250); return () => clearTimeout(t); }, [q, customerId]);
  if (value) return (
    <div className="card flex items-start gap-3 !p-4" data-testid="pp-booking-card">
      <Avatar name={value.customer_name} size={40} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{value.customer_name} · {value.booking_number}</p><p className="truncate text-xs text-txt-secondary">{value.project_code} · {value.block_code} · {value.flat_snapshot?.flat_number}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">{[["Cash due", value.summary?.cash_due_paise], ["Account due", value.summary?.account_due_paise], ["Other charges", value.summary?.other_charges_due_paise]].map(([l, v]) => <div key={l}><p className="text-txt-muted">{l}</p><Money value={Math.max(v || 0, 0) / 100} short className={cn("text-sm", v > 0 ? "text-brick" : "text-sage")} /></div>)}</div></div>
      <button type="button" onClick={() => onChange(null)} className="btn btn-ghost btn-sm" data-testid="pp-change-booking">Change</button>
    </div>
  );
  return (
    <div>
      <label className="relative block"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" /><input autoFocus className="input !pl-10" placeholder="Customer name, phone, flat or booking no…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pp-booking-search" /></label>
      <ul className="mt-2 max-h-64 divide-y divide-warm-100 overflow-y-auto rounded-xl border border-warm-200 bg-white" data-testid="pp-booking-results">{items.map((b) => <li key={b.id}><button type="button" onClick={() => onChange(b)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-warm-50" data-testid={`pp-pick-${b.booking_number}`}><Avatar name={b.customer_name} size={30} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{b.customer_name}</p><p className="truncate text-xs text-txt-secondary">{b.booking_number} · {b.project_code} {b.flat_snapshot?.flat_number}</p></div><Money value={Math.max(b.summary?.due_paise || 0, 0) / 100} short className="text-sm text-brick" /></button></li>)}{items.length === 0 && <li className="px-3 py-6 text-center text-xs text-txt-muted">No active bookings match.</li>}</ul>
    </div>
  );
}

export function PostPayment({ open, onOpenChange, bookingId, customerId, onPosted }) {
  const { user, can } = useAuth();
  const nav = useNavigate();
  const people = usePeople();
  const [booking, setBooking] = useState(null);
  const [f, setF] = useState({ against: "FLAT_VALUE", payment_category: "Cash", other_charge_line_id: null, payment_mode_id: null, bank_account_id: null, inst_bank_id: null, number: "", inst_date: "", amount: "", payment_date: today(), received_by: user?.id || null, remarks: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [key, setKey] = useState(uuid);
  const { options: modes } = useMasterOptions("payment-modes", (m) => ({ value: m.id, label: m.name, sub: m.requires_reference ? "ref. required" : undefined, code: m.code, requires_reference: m.requires_reference }));
  const { options: banks } = useMasterOptions("bank-accounts", (b) => ({ value: b.id, label: `${b.bank_name} ${b.account_number_masked || ""}`, sub: b.ifsc }));
  const { data: pre } = useFetch(bookingId ? `/bookings/${bookingId}` : null);
  useEffect(() => { if (pre) setBooking(pre); }, [pre]);
  useEffect(() => { if (open) { setDone(null); setKey(uuid()); setF((p) => ({ ...p, amount: "", number: "", remarks: "" })); } }, [open]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const mode = modes.find((m) => m.value === f.payment_mode_id);
  const isCash = mode?.code === "CASH", needsInst = mode && !isCash && (mode.requires_reference || ["CHEQUE", "DD", "NEFT", "RTGS", "IMPS", "UPI"].includes(mode.code));
  const s = booking?.summary || EMPTY_S;
  const cap = useMemo(() => {
    if (!booking) return null;
    if (f.against === "OTHER_CHARGE") { const l = (booking.other_charges || []).find((x) => x.line_id === f.other_charge_line_id); return l ? { agreed: l.total, received: l.paid, room: l.total - l.paid, label: l.name } : null; }
    const agreed = f.payment_category === "Cash" ? booking.cash_agreed : booking.account_agreed, received = f.payment_category === "Cash" ? s.cash_paid : s.account_paid;
    return { agreed, received, room: agreed - received, label: `${f.payment_category} bucket`, due: Math.max(f.payment_category === "Cash" ? s.cash_due : s.account_due, 0) };
  }, [booking, f.against, f.payment_category, f.other_charge_line_id, s]);
  const amt = Number(f.amount) || 0;
  const over = cap && amt > cap.room;
  const banksCat = useCatalogueBanks();
  const submit = async (e) => {
    e.preventDefault(); if (!booking || over) return; setBusy(true);
    try {
      const body = { booking_id: booking.id, against: f.against, payment_category: f.against === "FLAT_VALUE" ? f.payment_category : null, other_charge_line_id: f.against === "OTHER_CHARGE" ? f.other_charge_line_id : null, amount: amt, payment_date: f.payment_date, payment_mode_id: f.payment_mode_id, bank_account_id: isCash ? null : f.bank_account_id, remarks: f.remarks || null, instrument: isCash ? null : { number: f.number || null, date: f.inst_date || null, bank_name: banksCat.find((b) => b.value === f.inst_bank_id)?.label || null } };
      const r = await api.post("/payments", body, { headers: { "Idempotency-Key": key } });
      setDone(r.data); onPosted?.(r.data);
    } catch (err) { const m = errMsg(err); toast.error(m, { duration: 10000, action: can("agreement.edit") && /Revise agreement/i.test(m) ? { label: "Revise agreement", onClick: () => { onOpenChange(false); nav(`/bookings/${booking.id}?revise=1`); } } : undefined }); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-xl" data-testid="post-payment-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl">Post payment</SheetTitle><SheetDescription>Only cleared money counts toward dues. Cheques and DDs wait in hand until realised.</SheetDescription></SheetHeader>
        {done ? (
          <div className="mt-8 space-y-6 text-center" data-testid="pp-success">
            <span className="icon-tile sage mx-auto h-16 w-16 rounded-2xl"><CheckCircle2 className="!h-8 !w-8" /></span>
            <div><p className="label">{done.status === "Pending" ? "Recorded · cheque in hand" : "Posted"}</p><p className="mt-2 font-display text-4xl text-ink-950"><Num s={inr(done.amount)} /></p><p className="mt-2 font-mono text-sm text-txt-secondary" data-testid="pp-receipt-number">{done.receipt_number}</p></div>
            <div className="flex flex-wrap justify-center gap-2"><button type="button" onClick={() => window.open(`${BASE_PATH}/print/receipt/${done.id}`, "_blank")} className="btn btn-primary" data-testid="pp-print"><Printer className="h-4 w-4" />Print / download receipt</button><button type="button" onClick={() => { setDone(null); setKey(uuid()); setF((p) => ({ ...p, amount: "", number: "", remarks: "" })); }} className="btn btn-secondary" data-testid="pp-another">Post another</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-6">
            <div><p className="label !normal-case !tracking-normal !text-txt-secondary">Booking <span className="text-brick">*</span></p><div className="mt-1.5"><BookingPicker value={booking} onChange={(b) => { setBooking(b); set("other_charge_line_id", null); }} customerId={customerId} /></div></div>
            {booking && <>
              <Field label="Against"><Segmented options={[{ value: "FLAT_VALUE", label: "Flat value" }, { value: "OTHER_CHARGE", label: "Other charge" }]} value={f.against} onChange={(v) => set("against", v)} testId="pp-against" /></Field>
              {f.against === "FLAT_VALUE" ? <Field label="Category"><Segmented options={[{ value: "Cash", label: "Cash", hint: inr(Math.max(s.cash_due || 0, 0)) }, { value: "Account", label: "Account", hint: inr(Math.max(s.account_due || 0, 0)) }]} value={f.payment_category} onChange={(v) => set("payment_category", v)} testId="pp-category" /></Field>
                : <Field label="Charge line" required><Select options={(booking.other_charges || []).map((l) => ({ value: l.line_id, label: l.name, sub: `${inr(l.total - l.paid)} due` }))} value={f.other_charge_line_id} onChange={(v) => set("other_charge_line_id", v)} allowAdd={false} testId="pp-charge-line" /></Field>}
              {cap && <p className={cn("rounded-xl px-4 py-2.5 text-xs ring-1", over ? "bg-brick-50 text-brick ring-brick/30" : "bg-white text-txt-secondary ring-warm-200")} data-testid="pp-cap">{over ? <>{cap.label} agreed <Num s={inr(cap.agreed)} />; already received <Num s={inr(cap.received)} />; cannot accept <Num s={inr(amt)} />. Revise agreement first.{can("agreement.edit") && f.against === "FLAT_VALUE" && <> <Link to={`/bookings/${booking.id}?revise=1`} className="ml-1 font-semibold underline underline-offset-2" data-testid="pp-revise-link">Revise agreement →</Link></>}</> : <>{cap.label}: agreed <Num s={inr(cap.agreed)} /> · received <Num s={inr(cap.received)} />{cap.due != null && <> · due now <b className="text-ink-950"><Num s={inr(cap.due)} /></b></>} · can accept up to <b className="text-ink-950"><Num s={inr(cap.room)} /></b></>}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Mode" required><Select options={modes} value={f.payment_mode_id} onChange={(v) => set("payment_mode_id", v)} allowAdd={false} testId="pp-mode" /></Field>
                {!isCash && f.payment_mode_id && <Field label="Credited to company account" required><Select options={banks} value={f.bank_account_id} onChange={(v) => set("bank_account_id", v)} allowAdd={false} testId="pp-bank" /></Field>}
              </div>
              {needsInst && <div className="grid gap-4 md:grid-cols-3">
                <Field label="Drawn on bank"><Select type="bank" value={f.inst_bank_id} onChange={(v) => set("inst_bank_id", v)} testId="pp-inst-bank" /></Field>
                <Field label={mode?.requires_reference ? "Instrument / UTR no." : "Reference"} required={mode?.requires_reference}><input className="input" value={f.number} onChange={(e) => set("number", e.target.value)} data-testid="pp-instrument" /></Field>
                <Field label="Instrument date"><input type="date" className="input" value={f.inst_date} onChange={(e) => set("inst_date", e.target.value)} data-testid="pp-inst-date" /></Field>
              </div>}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Amount (₹)" required hint={cap && !over ? `Room in this bucket: ${inr(cap.room)}` : undefined} error={over ? `${cap.label} agreed ${inr(cap.agreed)}; already received ${inr(cap.received)}; cannot accept ${inr(amt)}. Revise agreement first.` : null}><input type="number" min="1" step="0.01" className={cn("input font-display text-lg", over && "!border-brick")} value={f.amount} onChange={(e) => set("amount", e.target.value)} required data-testid="pp-amount" /><p className="mt-1.5 font-display text-2xl text-ink-950" data-testid="pp-preview"><Num s={inr(amt)} /></p></Field>
                <div className="space-y-4"><Field label="Payment date" required><input type="date" className="input" value={f.payment_date} max={today()} min={booking.booking_date} onChange={(e) => set("payment_date", e.target.value)} data-testid="pp-date" /></Field><Field label="Received by"><Select options={people} value={f.received_by} onChange={(v) => set("received_by", v)} allowAdd={false} testId="pp-received-by" /></Field></div>
              </div>
              <Field label="Remarks"><input className="input" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} data-testid="pp-remarks" /></Field>
              {(mode?.code === "CHEQUE" || mode?.code === "DD") && <p className="rounded-xl bg-amber2-50 px-4 py-2.5 text-xs text-amber2">Recorded as <b>Pending</b> until realised. Clear or bounce it from Payments → Cheques.</p>}
              <button type="submit" disabled={busy || !f.payment_mode_id || over || !amt} className="btn btn-primary w-full" data-testid="pp-submit">{busy ? "Posting…" : "Post payment"}</button>
            </>}
          </form>
        )}
        <span className="hidden"><StatusPill status="Cleared" /><Skeleton /></span>
      </SheetContent>
    </Sheet>
  );
}

function useCatalogueBanks() {
  const { opts } = useCatalogues();
  return opts("bank");
}
