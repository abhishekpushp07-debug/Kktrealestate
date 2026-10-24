import { useEffect, useMemo, useState, lazy, Suspense } from "react";
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
import { DateInput } from "@/components/common/DateInput";
import { Combobox } from "@/components/common/Combobox";
import { inr, num, fmtRelative } from "@/lib/format";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { cn } from "@/lib/utils";

const CustomerForm = lazy(() => import("./Customers").then((m) => ({ default: m.CustomerForm })));
const SchedulePreview = lazy(() => import("@/components/common/PaymentSchedule").then((m) => ({ default: m.SchedulePreview })));
const UnitGrid = lazy(() => import("@/components/booking/UnitGrid"));

const STEPS = ["Project & Block", "Unit", "Customer", "Agreement", "Payment Plan", "Charges & Parking", "Review"];

export default function BookingWizard() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { can, user } = useAuth();
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState(sp.get("project") || null);
  const [blockId, setBlockId] = useState(sp.get("block") || null);
  const [flat, setFlat] = useState(null);
  const [flatQ, setFlatQ] = useState("");
  const [customer, setCustomer] = useState(null);
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState([]);
  const [newCust, setNewCust] = useState(false);
  const [agr, setAgr] = useState({ total: "", cash: "", account: "", mode: "amount", cashPct: "" });
  const [charges, setCharges] = useState([]);
  const [slots, setSlots] = useState([]);
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [plans, setPlans] = useState(null);
  const [planId, setPlanId] = useState("");
  const [acceptMode, setAcceptMode] = useState("In person");
  useEffect(() => { if (projectId && blockId) api.get(`/projects/${projectId}/blocks/${blockId}/payment-plans`).then((r) => { setPlans(r.data.items); setPlanId((p) => p || r.data.items[0]?.id || ""); }).catch(() => setPlans([])); }, [projectId, blockId]);
  const plan = plans?.find((p) => p.id === planId);
  const [busy, setBusy] = useState(false);
  const draftKey = `kkt:booking-draft:${user?.id || "anon"}`;
  const [draft, setDraft] = useState(() => { try { const d = JSON.parse(localStorage.getItem(draftKey) || "null"); return d && d.step > 0 ? d : null; } catch { return null; } });
  useEffect(() => { if (step === 0 && !projectId) return; localStorage.setItem(draftKey, JSON.stringify({ step, projectId, blockId, flat, customer, agr, charges, slots, bookingDate, remarks, planId, acceptMode, saved_at: Date.now() })); }, [step, projectId, blockId, flat, customer, agr, charges, slots, bookingDate, remarks, planId, acceptMode, draftKey]);
  const resume = () => { const d = draft; setStep(d.step); setProjectId(d.projectId); setBlockId(d.blockId); setFlat(d.flat); setCustomer(d.customer); setAgr(d.agr); setCharges(d.charges || []); setSlots(d.slots || []); setBookingDate(d.bookingDate); setRemarks(d.remarks || ""); setPlanId(d.planId || ""); setAcceptMode(d.acceptMode || "In person"); setDraft(null); };
  const discard = () => { localStorage.removeItem(draftKey); setDraft(null); };
  useUnsavedGuard(step > 0 && !busy, "Your booking draft is saved locally, but unsent changes will be lost if you leave. Continue?");
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
  const chargesTotal = charges.reduce((a, c) => a + (Number(c.amount) || 0) * (1 + (c.is_taxable ? (c.gst_percent || 0) / 100 : 0)), 0);
  const setCash = (v) => { const c = Math.round(Number(v) || 0); setAgr((a) => ({ ...a, cash: v, account: String(Math.max(total - c, 0)), cashPct: total ? String(Math.round((c / total) * 1000) / 10) : a.cashPct })); };
  const setCashPct = (p) => { const c = Math.round(total * (Number(p) || 0) / 100); setAgr((a) => ({ ...a, cashPct: String(p), cash: String(c), account: String(total - c) })); };
  const selCharges = charges.filter((c) => c.on);
  const chargeTotal = selCharges.reduce((s, c) => s + Number(c.amount) * (1 + (c.gst_percent || 0) / 100), 0);
  const freeSlots = useMemo(() => (parking?.items || []).filter((s) => s.status === "Available"), [parking]);
  const canNext = [!!blockId, !!flat, !!customer, sumOk, !plans?.length || !!planId, true, true][step];

  const submit = async () => {
    setBusy(true);
    try {
      const body = { flat_id: flat.id, customer_id: customer.id, booking_date: bookingDate, agreement_value: total, cash_agreed: cash, account_agreed: account, remarks: remarks || null, parking_slot_ids: slots, payment_plan_id: planId || null, plan_acceptance_mode: acceptMode,
        other_charges: selCharges.map((c) => ({ charge_type_id: c.charge_type_id, amount: Number(c.amount), gst_percent: c.gst_percent || 0, demand_at: c.demand_at })) };
      localStorage.removeItem(draftKey);
      const r = await api.post("/bookings", body);
      toast.success(`Booking ${r.data.booking_number} created`); nav(`/bookings/${r.data.id}`);
    } catch (e) { toast.error(errMsg(e), { duration: 8000 }); } finally { setBusy(false); }
  };

  return (
    <div data-testid="booking-wizard">
      <PageHeader title="New booking" subtitle="Reserve a unit, capture the agreement and raise initial demands." crumbs={[{ label: "Bookings", to: "/bookings" }, { label: "New" }]} />
      {draft && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gold-border bg-gold-light px-4 py-3 text-sm text-navy" data-testid="wiz-resume-banner"><span className="font-semibold">Resume booking?</span><span className="text-slate-600">You have an unfinished booking from {fmtRelative(new Date(draft.saved_at).toISOString())} (step {draft.step + 1}: {STEPS[draft.step]}).</span><div className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={discard} data-testid="wiz-discard">Discard</Button><Button size="sm" className="bg-navy hover:bg-navy-700" onClick={resume} data-testid="wiz-resume">Resume</Button></div></div>}
      <div className="grid gap-6 lg:grid-cols-[200px_1fr_280px]">
      <div className="min-w-0 lg:sticky lg:top-20 lg:self-start" data-testid="wizard-steps">
        <ol className="flex items-center gap-1.5 lg:block lg:space-y-1">{STEPS.map((s, i) => <li key={s} onClick={() => i < step && setStep(i)} aria-current={i === step ? "step" : undefined} className={cn("flex shrink-0 items-center gap-2 rounded-full text-xs font-semibold lg:rounded-lg lg:px-3 lg:py-2.5", i === step ? "lg:bg-navy-50 lg:text-navy" : i < step ? "cursor-pointer lg:text-emerald-800" : "lg:text-slate-600")} data-testid={`wiz-step-${i}`}><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] lg:h-5 lg:w-5 lg:text-[10px]", i < step ? "bg-emerald-600 text-white" : i === step ? "gold-grad text-navy ring-2 ring-navy/20" : "bg-slate-200 text-slate-700")}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span><span className="hidden lg:inline">{s}</span></li>)}</ol>
        <p className="mt-2 text-sm font-bold text-navy lg:hidden" data-testid="wiz-step-label">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
      </div>
      <div className="card-elev min-w-0 p-4 sm:p-6">
        {step === 0 && <div className="grid gap-4 md:grid-cols-2">
          <Field label="Project" required><Combobox options={(projects?.items || []).map((p) => ({ value: p.id, label: p.name, sub: p.code }))} value={projectId} onChange={(v) => { setProjectId(v); setBlockId(null); setFlat(null); }} testId="wiz-project" /></Field>
          <Field label="Block" required><Combobox options={(blocks?.items || []).map((b) => ({ value: b.id, label: b.name, sub: `${b.inventory?.Available ?? 0} available · ${b.construction_percent}%` }))} value={blockId} onChange={(v) => { setBlockId(v); setFlat(null); }} disabled={!projectId} testId="wiz-block" /></Field>
        </div>}
        {step === 1 && <Suspense fallback={<p className="text-sm text-slate-500">Loading grid…</p>}><UnitGrid grid={grid} flat={flat} setFlat={setFlat} flatQ={flatQ} setFlatQ={setFlatQ} /></Suspense>}
        {step === 2 && <div>
          <div className="flex gap-2"><Input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Search by phone, name or code…" className="max-w-md" data-testid="wiz-customer-search" />{can("customer.write") && <Button variant="outline" onClick={() => setNewCust(true)} data-testid="wiz-new-customer"><Plus className="mr-1 h-4 w-4" />New customer</Button>}</div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">{custResults.map((c) => <button key={c.id} onClick={() => setCustomer(c)} className={cn("rounded-lg border bg-white p-3 text-left text-sm hover:border-navy", customer?.id === c.id && "border-navy ring-1 ring-navy")} data-testid={`wiz-customer-${c.customer_code}`}><p className="font-semibold text-navy">{c.salutation} {c.full_name}</p><p className="text-xs text-slate-500">{c.customer_code} · {c.phone} · KYC {c.kyc_status}</p></button>)}</div>
          {customer && <p className="mt-3 text-sm">Selected: <b className="text-navy">{customer.full_name}</b> ({customer.customer_code})</p>}
          {newCust && <Suspense fallback={null}><CustomerForm open={newCust} onOpenChange={setNewCust} onSaved={(c) => { setCustomer(c); setCustResults([c]); }} /></Suspense>}
        </div>}
        {step === 3 && <div className="grid gap-4 md:grid-cols-3">
          <Field label="Agreement value ₹" required hint={`Listed price ${inr(flat?.price)}`}><Input type="number" value={agr.total} onChange={(e) => { const t = Math.round(Number(e.target.value) || 0); setAgr((a) => a.mode === "percent" ? { ...a, total: e.target.value, cash: String(Math.round(t * (Number(a.cashPct) || 0) / 100)), account: String(t - Math.round(t * (Number(a.cashPct) || 0) / 100)) } : { ...a, total: e.target.value, account: String(Math.max(t - cash, 0)) }); }} disabled={!can("agreement.edit") && !can("settings.manage")} data-testid="wiz-total" /></Field>
          <Field label={agr.mode === "percent" ? "Cash share %" : "Cash bucket ₹"} required>
            <div className="flex gap-2"><Input type="number" min="0" max={agr.mode === "percent" ? 100 : undefined} step={agr.mode === "percent" ? "0.5" : "1"} value={agr.mode === "percent" ? agr.cashPct : agr.cash} onChange={(e) => agr.mode === "percent" ? setCashPct(e.target.value) : setCash(e.target.value)} data-testid="wiz-cash" />
              <div className="flex shrink-0 overflow-hidden rounded-md border text-xs font-semibold" role="group" aria-label="Cash entry mode">{[["amount", "₹"], ["percent", "%"]].map(([m, l]) => <button key={m} type="button" onClick={() => setAgr((a) => ({ ...a, mode: m, cashPct: m === "percent" && total ? String(Math.round((cash / total) * 1000) / 10) : a.cashPct }))} className={cn("px-3", agr.mode === m ? "bg-navy text-white" : "bg-white text-slate-600 hover:bg-surface")} data-testid={`wiz-cash-mode-${m}`}>{l}</button>)}</div></div>
            <div className="mt-1 flex items-center gap-1">{[0, 20, 30, 40, 50].map((p) => <button key={p} type="button" onClick={() => setCashPct(p)} className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-surface" data-testid={`wiz-cash-pct-${p}`}>{p}%</button>)}{agr.mode === "percent" && <span className="ml-auto text-[11px] tabular-nums text-slate-500" data-testid="wiz-cash-derived">= {inr(cash)}</span>}</div></Field>
          <Field label="Account bucket ₹" required hint="Auto-balanced to the rupee"><Input type="number" value={agr.account} onChange={(e) => { const acc = Math.round(Number(e.target.value) || 0); setAgr((a) => ({ ...a, account: e.target.value, cash: String(Math.max(total - acc, 0)), cashPct: total ? String(Math.round(((total - acc) / total) * 1000) / 10) : a.cashPct })); }} data-testid="wiz-account" /></Field>
          <div className={cn("md:col-span-3 rounded-md px-3 py-2 text-sm", sumOk ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")} data-testid="wiz-sum-check">{sumOk ? `✓ Cash ${inr(cash)} + Account ${inr(account)} = ${inr(total)}` : `Cash + Account must equal the agreement value exactly (currently ${inr(cash + account)} vs ${inr(total)})`}</div>
          <Field label="Booking date" required><DateInput value={bookingDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBookingDate(e.target.value)} data-testid="wiz-date" /></Field>
        </div>}
        {step === 4 && <div data-testid="wiz-plan-step">
          {plans === null ? <p className="text-sm text-slate-500">Loading plans…</p> : plans.length === 0 ? <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700" data-testid="wiz-plan-none">No payment plan assigned to this tower — assign one under Project → Payment Plans. Booking will proceed without a plan (no automatic dues).</div> : <div className="grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="space-y-2" data-testid="wiz-plan-list">{plans.map((p) => <button type="button" key={p.id} onClick={() => setPlanId(p.id)} className={cn("w-full rounded-lg border p-3 text-left transition-colors", planId === p.id ? "border-navy bg-navy-50" : "bg-white hover:bg-surface")} data-testid={`wiz-plan-${p.code}`}><p className="font-semibold text-navy">{p.name}{p.is_default && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-[#6B4E00]">Default</span>}</p><p className="text-xs text-slate-500">{p.plan_type} · {p.installments.map((i) => `${i.percent}%`).join(" + ")}</p>{p.description && <p className="mt-1 text-xs text-slate-500">{p.description}</p>}</button>)}</div>
            <div className="card-elev min-w-0 overflow-x-auto p-4">{plan && <><p className="mb-2 text-sm font-bold text-navy">Schedule preview — {plan.name}</p><Suspense fallback={<p className="text-xs text-slate-500">Loading schedule…</p>}><SchedulePreview plan={plan} cash={cash} account={account} bookingDate={bookingDate} /></Suspense><Field label="Plan accepted by customer via" className="mt-4"><select className="h-10 rounded-md border px-3 text-sm" value={acceptMode} onChange={(e) => setAcceptMode(e.target.value)} data-testid="wiz-plan-accept">{["In person", "Signed copy", "Portal"].map((m) => <option key={m}>{m}</option>)}</select></Field><p className="mt-2 text-xs text-slate-500">Upload the signed plan later under Booking → Documents (type “Payment Plan Acceptance”).</p></>}</div>
          </div>}
        </div>}
        {step === 5 && <div className="grid gap-6 lg:grid-cols-2">
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Other charges</p>
            {charges.map((c, i) => <div key={c.charge_type_id} className="mb-2 grid grid-cols-[auto_1fr_110px_70px_130px] items-center gap-2 text-sm"><input type="checkbox" checked={c.on} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} data-testid={`wiz-charge-${c.charge_type_id}`} /><span>{c.name}</span><Input type="number" value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="h-8" /><Input type="number" value={c.gst_percent} disabled={!c.is_taxable} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, gst_percent: Number(e.target.value) } : x))} className="h-8" title="GST %" /><select value={c.demand_at} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, demand_at: e.target.value } : x))} className="h-8 rounded-md border bg-white px-1 text-xs"><option value="on_booking">On booking</option><option value="on_possession">On possession</option><option value="manual">Manual</option></select></div>)}
            <p className="mt-2 text-sm">Selected charges incl. GST: <b className="text-navy">{inr(chargeTotal)}</b></p></div>
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Parking ({freeSlots.length} available)</p>
            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">{freeSlots.map((s) => <button key={s.id} onClick={() => setSlots(slots.includes(s.id) ? slots.filter((x) => x !== s.id) : [...slots, s.id])} className={cn("rounded border px-2 py-1 text-xs", slots.includes(s.id) ? "border-navy bg-navy text-white" : "bg-white hover:border-navy")} title={`${s.type} · ${s.level || ""}`} data-testid={`wiz-slot-${s.number}`}>{s.number}</button>)}</div></div>
        </div>}
        {step === 6 && <div className="grid gap-4 md:grid-cols-2">
          <div><KV label="Unit" value={`${flat?.flat_number} · ${flat?.flat_type_code} · ${num(flat?.super_builtup_sqft)} sq.ft`} /><KV label="Customer" value={`${customer?.full_name} (${customer?.customer_code})`} /><KV label="Booking date" value={bookingDate} /><KV label="Agreement" value={inr(total)} /><KV label="Cash / Account" value={`${inr(cash)} / ${inr(account)}`} /></div>
          <div><KV label="Other charges" value={selCharges.length ? selCharges.map((c) => c.name).join(", ") : "None"} /><KV label="Charges total" value={inr(chargeTotal)} /><KV label="Parking" value={slots.length ? `${slots.length} slot(s)` : "None"} /><KV label="Construction" value={`${grid?.block.construction_percent ?? 0}% — demands raised on confirm`} /><Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} data-testid="wiz-remarks" /></Field></div>
        </div>}
        <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex justify-between gap-3 border-t bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6" data-testid="wiz-footer">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="wiz-back"><ChevronLeft className="mr-1 h-4 w-4" />Back</Button>
          {step < 6 ? <Button disabled={!canNext} onClick={() => setStep(step + 1)} className="bg-navy hover:bg-navy-700" data-testid="wiz-next">Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
            : <Button disabled={busy} onClick={submit} className="bg-gold text-navy hover:bg-gold-hover" data-testid="wiz-confirm">{busy ? "Booking…" : "Confirm booking"}</Button>}
        </div>
      </div>
      <aside className="hidden lg:block lg:sticky lg:top-20 lg:self-start" data-testid="wiz-summary">
        <div className="card-elev p-5 text-sm">
          <p className="label-xs mb-3">Booking summary</p>
          <dl className="space-y-2.5">
            <SRow k="Project" v={projects?.items?.find((p) => p.id === projectId)?.name} />
            <SRow k="Tower" v={blocks?.items?.find((b) => b.id === blockId)?.name} />
            <SRow k="Unit" v={flat ? [flat.flat_number, flat.flat_type_name].filter(Boolean).join(" · ") : null} />
            <SRow k="Customer" v={customer?.full_name} sub={customer?.phone} />
            <SRow k="Agreement" v={total ? inr(total) : null} sub={total && (cash || account) ? `Cash ${inr(cash)} · Account ${inr(account)}` : null} warn={total > 0 && !sumOk ? "Cash + Account ≠ total" : null} />
            <SRow k="Payment plan" v={plan?.name} sub={plan ? `${plan.plan_type} · accepted ${acceptMode}` : null} />
            <SRow k="Other charges" v={charges.length ? inr(chargesTotal) : null} sub={charges.length ? `${charges.length} line(s) incl. GST` : null} />
            <SRow k="Parking" v={slots.length ? `${slots.length} slot(s)` : null} />
          </dl>
          <div className="mt-4 border-t pt-3"><p className="label-xs">Grand total</p><p className="text-xl font-bold tabular text-navy" data-testid="wiz-grand-total">{inr(total + chargesTotal)}</p></div>
        </div>
      </aside>
      </div>
    </div>
  );
}

function SRow({ k, v, sub, warn }) {
  return <div className="flex flex-col gap-0.5"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</dt><dd className={cn("font-semibold leading-snug", v ? "text-navy" : "text-slate-400")}>{v || "—"}</dd>{sub && <dd className="text-xs text-slate-600">{sub}</dd>}{warn && <dd className="text-xs font-semibold text-red-700">{warn}</dd>}</div>;
}
