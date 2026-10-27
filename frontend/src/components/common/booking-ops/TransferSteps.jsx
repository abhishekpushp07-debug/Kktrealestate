import { Input } from "@/components/ui/input";
import { inr } from "@/lib/format";
import { Field } from "@/components/common/Bits";

export function SwapStep({ f, setF, others, booking }) {
  return (
    <Field label="Swap with booking" required><select className="input" value={f.other_booking_id} onChange={(e) => setF({ ...f, other_booking_id: e.target.value })} data-testid="swap-booking"><option value="">Select an active booking…</option>{others.map((b) => <option key={b.id} value={b.id}>{b.booking_number} · {b.customer_name} · {b.flat_snapshot?.flat_number}</option>)}</select></Field>
  );
}

export function TransferStep({ f, setF, flats, booking, v }) {
  const { curPct, s, newPrice, revise, newCash, newAcc, belowCash, belowAcc, minPct, maxPct } = v;
  return (<>
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
  </>);
}
