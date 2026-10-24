import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useMasterOptions } from "@/hooks/useList";
import { PageHeader, Field, KV } from "@/components/common/Bits";
import { STATUS_STYLES } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/common/Combobox";
import { CustomerForm } from "./Customers";
import { inr, num } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = ["Project & Block", "Unit", "Customer", "Agreement", "Charges & Parking", "Review"];

export default function BookingWizard() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { can, user } = useAuth();
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState(sp.get("project") || null);
  const [blockId, setBlockId] = useState(sp.get("block") || null);
  const [flat, setFlat] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState([]);
  const [newCust, setNewCust] = useState(false);
  const [agr, setAgr] = useState({ total: "", cash: "", account: "", mode: "amount", cashPct: "" });
  const [charges, setCharges] = useState([]);
  const [slots, setSlots] = useState([]);
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: projects } = useFetch("/projects?page_size=50");
  const { data: blocks } = useFetch(projectId ? `/blocks?project_id=${projectId}&page_size=50` : null, [projectId]);
  const { data: grid } = useFetch(blockId ? `/blocks/${blockId}/grid` : null, [blockId]);
  const { data: parking } = useFetch(projectId ? `/parking?project_id=${projectId}&page_size=100` : null, [projectId]);
  const { items: chargeTypes } = useMasterOptions("charge-types");
  const { data: company } = useFetch("/settings/company");
  const gst = company?.default_gst_percent ?? 18;

  useEffect(() => { if (custSearch.length < 2) { setCustResults([]); return; } const t = setTimeout(() => api.get("/customers", { params: { search: custSearch, page_size: 8 } }).then((r) => setCustResults(r.data.items)), 250); return () => clearTimeout(t); }, [custSearch]);
  useEffect(() => { if (flat?.price && !agr.total) setAgr((a) => ({ ...a, total: String(flat.price), cash: "", account: String(flat.price) })); }, [flat, agr.total]);
  useEffect(() => { if (chargeTypes.length && charges.length === 0) setCharges(chargeTypes.filter((c) => c.default_amount).map((c) => ({ charge_type_id: c.id, name: c.name, amount: c.default_amount, is_taxable: c.is_taxable, gst_percent: c.is_taxable ? gst : 0, demand_at: "on_booking", on: ["PARKING", "CLUB"].includes(c.code) }))); }, [chargeTypes, charges.length, gst]);

  const total = Number(agr.total) || 0, cash = Number(agr.cash) || 0, account = Number(agr.account) || 0;
  const sumOk = total > 0 && Math.round((cash + account) * 100) === Math.round(total * 100);
  const setCash = (v) => { const c = Number(v) || 0; setAgr((a) => ({ ...a, cash: v, account: String(Math.max(total - c, 0)) })); };
  const setCashPct = (p) => { const c = Math.round(total * (Number(p) || 0)) / 100; setAgr((a) => ({ ...a, cashPct: p, cash: String(c), account: String(total - c) })); };
  const selCharges = charges.filter((c) => c.on);
  const chargeTotal = selCharges.reduce((s, c) => s + Number(c.amount) * (1 + (c.gst_percent || 0) / 100), 0);
  const freeSlots = useMemo(() => (parking?.items || []).filter((s) => s.status === "Available"), [parking]);
  const canNext = [!!blockId, !!flat, !!customer, sumOk, true, true][step];

  const submit = async () => {
    setBusy(true);
    try {
      const body = { flat_id: flat.id, customer_id: customer.id, booking_date: bookingDate, agreement_value: total, cash_agreed: cash, account_agreed: account, remarks: remarks || null, parking_slot_ids: slots,
        other_charges: selCharges.map((c) => ({ charge_type_id: c.charge_type_id, amount: Number(c.amount), gst_percent: c.gst_percent || 0, demand_at: c.demand_at })) };
      const r = await api.post("/bookings", body);
      toast.success(`Booking ${r.data.booking_number} created`); nav(`/bookings/${r.data.id}`);
    } catch (e) { toast.error(errMsg(e), { duration: 8000 }); } finally { setBusy(false); }
  };

  return (
    <div data-testid="booking-wizard">
      <PageHeader title="New booking" subtitle="Reserve a unit, capture the agreement and raise initial demands." crumbs={[{ label: "Bookings", to: "/bookings" }, { label: "New" }]} />
      <ol className="mb-6 flex flex-wrap gap-2" data-testid="wizard-steps">{STEPS.map((s, i) => <li key={s} className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", i === step ? "border-navy bg-navy text-white" : i < step ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500")}>{i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}{s}</li>)}</ol>
      <div className="card-elev p-6">
        {step === 0 && <div className="grid gap-4 md:grid-cols-2">
          <Field label="Project" required><Combobox options={(projects?.items || []).map((p) => ({ value: p.id, label: p.name, sub: p.code }))} value={projectId} onChange={(v) => { setProjectId(v); setBlockId(null); setFlat(null); }} testId="wiz-project" /></Field>
          <Field label="Block" required><Combobox options={(blocks?.items || []).map((b) => ({ value: b.id, label: b.name, sub: `${b.inventory?.Available ?? 0} available · ${b.construction_percent}%` }))} value={blockId} onChange={(v) => { setBlockId(v); setFlat(null); }} disabled={!projectId} testId="wiz-block" /></Field>
        </div>}
        {step === 1 && <div data-testid="wiz-grid">{!grid ? <p className="text-sm text-slate-500">Loading grid…</p> : <>
          <p className="mb-3 text-xs text-slate-500">Only Available / Hold units are selectable. Construction at <b>{grid.block.construction_percent}%</b>{grid.block.construction_percent > 0 && " — demands up to this stage will be raised immediately."}</p>
          <div className="space-y-1.5">{grid.floors.filter((f) => f.kind === "units").map((fl) => <div key={fl.floor} className="flex items-center gap-1.5"><span className="w-8 text-right text-xs font-bold text-navy">{fl.label}</span>{fl.flats.map((f) => { const ok = ["Available", "Hold"].includes(f.status); return <button key={f.id} disabled={!ok} onClick={() => setFlat(f)} className={cn("min-w-[88px] rounded-md border px-2 py-1.5 text-left text-xs transition-all", STATUS_STYLES[f.status]?.tile, !ok && "cursor-not-allowed opacity-50", flat?.id === f.id && "ring-2 ring-gold")} data-testid={`wiz-flat-${f.flat_number}`}><p className="font-semibold">{f.flat_number}</p><p className="text-[10px] opacity-80">{f.flat_type_code} · {inr(f.price)}</p></button>; })}</div>)}</div></>}</div>}
        {step === 2 && <div>
          <div className="flex gap-2"><Input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Search by phone, name or code…" className="max-w-md" data-testid="wiz-customer-search" />{can("customer.write") && <Button variant="outline" onClick={() => setNewCust(true)} data-testid="wiz-new-customer"><Plus className="mr-1 h-4 w-4" />New customer</Button>}</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">{custResults.map((c) => <button key={c.id} onClick={() => setCustomer(c)} className={cn("rounded-lg border bg-white p-3 text-left text-sm hover:border-navy", customer?.id === c.id && "border-navy ring-1 ring-navy")} data-testid={`wiz-customer-${c.customer_code}`}><p className="font-semibold text-navy">{c.salutation} {c.full_name}</p><p className="text-xs text-slate-500">{c.customer_code} · {c.phone} · KYC {c.kyc_status}</p></button>)}</div>
          {customer && <p className="mt-3 text-sm">Selected: <b className="text-navy">{customer.full_name}</b> ({customer.customer_code})</p>}
          {newCust && <CustomerForm open={newCust} onOpenChange={setNewCust} onSaved={(c) => { setCustomer(c); setCustResults([c]); }} />}
        </div>}
        {step === 3 && <div className="grid gap-4 md:grid-cols-3">
          <Field label="Agreement value ₹" required hint={`Listed price ${inr(flat?.price)}`}><Input type="number" value={agr.total} onChange={(e) => setAgr({ ...agr, total: e.target.value, account: String(Math.max(Number(e.target.value) - cash, 0)) })} disabled={!can("agreement.edit") && !can("settings.manage")} data-testid="wiz-total" /></Field>
          <Field label="Cash bucket ₹" required><Input type="number" value={agr.cash} onChange={(e) => setCash(e.target.value)} data-testid="wiz-cash" /><div className="mt-1 flex gap-1">{[0, 20, 30, 40, 50].map((p) => <button key={p} type="button" onClick={() => setCashPct(p)} className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-surface">{p}%</button>)}</div></Field>
          <Field label="Account bucket ₹" required><Input type="number" value={agr.account} onChange={(e) => setAgr({ ...agr, account: e.target.value })} data-testid="wiz-account" /></Field>
          <div className={cn("md:col-span-3 rounded-md px-3 py-2 text-sm", sumOk ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")} data-testid="wiz-sum-check">{sumOk ? `✓ Cash ${inr(cash)} + Account ${inr(account)} = ${inr(total)}` : `Cash + Account must equal the agreement value exactly (currently ${inr(cash + account)} vs ${inr(total)})`}</div>
          <Field label="Booking date" required><Input type="date" value={bookingDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBookingDate(e.target.value)} data-testid="wiz-date" /></Field>
        </div>}
        {step === 4 && <div className="grid gap-6 lg:grid-cols-2">
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Other charges</p>
            {charges.map((c, i) => <div key={c.charge_type_id} className="mb-2 grid grid-cols-[auto_1fr_110px_70px_130px] items-center gap-2 text-sm"><input type="checkbox" checked={c.on} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} data-testid={`wiz-charge-${c.charge_type_id}`} /><span>{c.name}</span><Input type="number" value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="h-8" /><Input type="number" value={c.gst_percent} disabled={!c.is_taxable} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, gst_percent: Number(e.target.value) } : x))} className="h-8" title="GST %" /><select value={c.demand_at} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, demand_at: e.target.value } : x))} className="h-8 rounded-md border bg-white px-1 text-xs"><option value="on_booking">On booking</option><option value="on_possession">On possession</option><option value="manual">Manual</option></select></div>)}
            <p className="mt-2 text-sm">Selected charges incl. GST: <b className="text-navy">{inr(chargeTotal)}</b></p></div>
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Parking ({freeSlots.length} available)</p>
            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">{freeSlots.map((s) => <button key={s.id} onClick={() => setSlots(slots.includes(s.id) ? slots.filter((x) => x !== s.id) : [...slots, s.id])} className={cn("rounded border px-2 py-1 text-xs", slots.includes(s.id) ? "border-navy bg-navy text-white" : "bg-white hover:border-navy")} title={`${s.type} · ${s.level || ""}`} data-testid={`wiz-slot-${s.number}`}>{s.number}</button>)}</div></div>
        </div>}
        {step === 5 && <div className="grid gap-4 md:grid-cols-2">
          <div><KV label="Unit" value={`${flat?.flat_number} · ${flat?.flat_type_code} · ${num(flat?.super_builtup_sqft)} sq.ft`} /><KV label="Customer" value={`${customer?.full_name} (${customer?.customer_code})`} /><KV label="Booking date" value={bookingDate} /><KV label="Agreement" value={inr(total)} /><KV label="Cash / Account" value={`${inr(cash)} / ${inr(account)}`} /></div>
          <div><KV label="Other charges" value={selCharges.length ? selCharges.map((c) => c.name).join(", ") : "None"} /><KV label="Charges total" value={inr(chargeTotal)} /><KV label="Parking" value={slots.length ? `${slots.length} slot(s)` : "None"} /><KV label="Construction" value={`${grid?.block.construction_percent ?? 0}% — demands raised on confirm`} /><Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} data-testid="wiz-remarks" /></Field></div>
        </div>}
        <div className="mt-6 flex justify-between border-t pt-4">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="wiz-back"><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
          {step < 5 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)} className="bg-navy hover:bg-navy-700" data-testid="wiz-next">Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
            : <Button disabled={busy} onClick={submit} className="bg-gold text-navy hover:bg-gold-hover" data-testid="wiz-confirm">{busy ? "Booking…" : "Confirm booking"}</Button>}
        </div>
      </div>
    </div>
  );
}
