import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { FieldError, useFieldErrors } from "@/lib/formErrors";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useMasterOptions } from "@/hooks/useList";
import { Field, KV } from "@/components/common/Bits";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";
import { Select as Combobox } from "@/components/v2/Select";
import { Card, Money, Num, Stepper } from "@/components/v2";
import { Avatar } from "@/components/v2/CustomerBits";
import { Link } from "react-router-dom";
import { inr, num, fmtRelative } from "@/lib/format";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { cn } from "@/lib/utils";
import { QuickAddButton, useQuickCreate } from "@/components/common/QuickCreate";
import { useRowKeys } from "@/hooks/useRowKeys";
import { KycSlots } from "@/components/common/KycSlots";
import { useCatalogues } from "@/hooks/useCatalogues";
import { Select } from "@/components/v2/Select";

const CustomerForm = lazy(() => import("@/components/v2/QuickCustomerSheet"));
const SchedulePreview = lazy(() => import("@/components/common/PaymentSchedule").then((m) => ({ default: m.SchedulePreview })));
const UnitGrid = lazy(() => import("@/components/booking/UnitGrid"));

const STEPS = ["Project & Tower", "Unit", "Customer", "Agreement", "Payment plan", "Charges & Parking", "Review"];
const STEP_DESC = ["Choose where the unit sits", "Pick an available unit from the grid", "Who is buying", "Agreement value split into Cash and Account", "Pick a project/tower payment plan", "Optional charges and parking", "Confirm and raise initial demands"];

export default function BookingWizard() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { can, user } = useAuth();
  const fe = useFieldErrors();
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState(sp.get("project") || null);
  const [blockId, setBlockId] = useState(sp.get("block") || null);
  const [flat, setFlat] = useState(null);
  const [flatQ, setFlatQ] = useState("");
  const [customer, setCustomer] = useState(null);
  const [coApps, setCoApps] = useState([]);
  const { label } = useCatalogues();
  const coRows = useRowKeys(coApps);
  useEffect(() => {  // prefill from ?flat=&customer_id= (Customer 360 "New booking", Flat drawer "Convert hold → booking")
    const fid = sp.get("flat"), cid = sp.get("customer_id");
    if (cid) api.get(`/customers/${cid}`).then((r) => setCustomer(r.data)).catch(() => {});
    if (fid) api.get(`/flats/${fid}`).then((r) => { const f = r.data; setProjectId(f.project_id); setBlockId(f.block_id); setFlat(f); setStep(cid ? 3 : 2); }).catch((e) => toast.error(errMsg(e)));
  }, []); // eslint-disable-line
  const [leads, setLeads] = useState([]);
  const [leadId, setLeadId] = useState("");
  useEffect(() => { if (!customer?.phone) { setLeads([]); setLeadId(""); return; } api.get("/leads", { params: { search: customer.phone, page_size: 20 } }).then((r) => { const open = (r.data.items || []).filter((l) => !["Converted", "Lost"].includes(l.status)); setLeads(open); setLeadId(open[0]?.id || ""); }).catch(() => setLeads([])); }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState([]);
  const [newCust, setNewCust] = useState(false);
  const [agr, setAgr] = useState({ total: "", cash: "", account: "", mode: "amount", cashPct: "" });
  const [discount, setDiscount] = useState("");
  const canEditAgr = can("sales.agreement.revise") || can("sales.agreement.revise");
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
  // localStorage: unsaved wizard draft (ids + step, no credentials) — non-sensitive (CR-7)
  const [draft, setDraft] = useState(() => { try { const d = JSON.parse(localStorage.getItem(draftKey) || "null"); return d && d.step > 0 ? d : null; } catch { return null; } });
  useEffect(() => { if (step === 0 && !projectId) return; localStorage.setItem(draftKey, JSON.stringify({ step, projectId, blockId, flat, customer, agr, charges, slots, bookingDate, remarks, planId, acceptMode, saved_at: Date.now() })); }, [step, projectId, blockId, flat, customer, agr, charges, slots, bookingDate, remarks, planId, acceptMode, draftKey]);
  const resume = () => { const d = draft; setStep(d.step); setProjectId(d.projectId); setBlockId(d.blockId); setFlat(d.flat); setCustomer(d.customer); setAgr(d.agr); setCharges(d.charges || []); setSlots(d.slots || []); setBookingDate(d.bookingDate); setRemarks(d.remarks || ""); setPlanId(d.planId || ""); setAcceptMode(d.acceptMode || "In person"); setDraft(null); };
  const discard = () => { localStorage.removeItem(draftKey); setDraft(null); };
  useUnsavedGuard(step > 0 && !busy, "Your booking draft is saved locally, but unsent changes will be lost if you leave. Continue?");
  const { data: projects, reload: reloadProjects } = useFetch("/projects?page_size=50");
  const { data: blocks, reload: reloadBlocks } = useFetch(projectId ? `/blocks?project_id=${projectId}&page_size=50` : null, [projectId]);
  const { data: grid, reload: reloadGrid } = useFetch(blockId ? `/blocks/${blockId}/grid?bookable_for=${encodeURIComponent(customer?.id || "")}` : null, [blockId, customer?.id]);
  const qcProject = useQuickCreate("project", {}, async (p) => { await reloadProjects(); setProjectId(p.id); setBlockId(null); setFlat(null); });
  const qcTower = useQuickCreate("tower", { project_id: projectId }, async (t) => { await reloadBlocks(); setBlockId(t.id); setFlat(null); });
  const { data: parking } = useFetch(projectId ? `/parking?project_id=${projectId}&page_size=100` : null, [projectId]);
  const { items: chargeTypes } = useMasterOptions("charge-types");
  const { data: company } = useFetch("/settings/company");
  const gst = company?.default_gst_percent ?? 18;

  useEffect(() => { if (custSearch.length < 2) { setCustResults([]); return; } const t = setTimeout(() => api.get("/customers", { params: { search: custSearch, page_size: 8 } }).then((r) => setCustResults(r.data.items)), 250); return () => clearTimeout(t); }, [custSearch]);
  const tower = (blocks?.items || []).find((b) => b.id === blockId);
  const defaultCashPct = tower?.default_cash_percent != null ? Number(tower.default_cash_percent) : Number((projects?.items || []).find((p) => p.id === projectId)?.default_cash_percent) || 0;
  const listPrice = flat?.price ? Math.round(flat.price) : 0;
  useEffect(() => { if (!listPrice) return; const t = Math.max(listPrice - (Math.round(Number(discount)) || 0), 0); if (String(t) === agr.total) return; const pct = Number(agr.cashPct) || defaultCashPct; const c = Math.round(t * pct / 100); setAgr((a) => ({ ...a, total: String(t), cash: String(c), account: String(t - c), cashPct: String(pct), mode: "percent" })); }, [listPrice, discount, defaultCashPct]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const body = { flat_id: flat.id, customer_id: customer.id, lead_id: leadId || null, booking_date: bookingDate, agreement_value: total, cash_agreed: cash, account_agreed: account, remarks: remarks || null, parking_slot_ids: slots, payment_plan_id: planId || null, plan_acceptance_mode: acceptMode,
        other_charges: selCharges.map((c) => ({ charge_type_id: c.charge_type_id, amount: Number(c.amount), gst_percent: c.gst_percent || 0, demand_at: c.demand_at })),
        co_applicants: coApps.filter((c) => c.name.trim()).map((c) => ({ id: c.id, name: c.name.trim(), relation: label("relation", c.relation_id) || null, phone: c.phone.replace(/\D/g, "") || null })) };
      localStorage.removeItem(draftKey);
      const r = await api.post("/bookings", body);
      toast.success(`Booking ${r.data.booking_number} created`); nav(`/bookings/${r.data.id}`);
    } catch (e) { toast.error(fe.capture(e), { duration: 8000 }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-8" data-testid="booking-wizard">
      <header><nav className="text-xs text-txt-muted"><Link to="/bookings" className="hover:text-ink-950">Bookings</Link> › New</nav><h1 className="mt-2 font-display text-4xl text-ink-950">New booking</h1><p className="mt-2 text-sm text-txt-secondary">Reserve a unit, capture the agreement and raise initial demands.</p></header>
      {draft && <div className="notice" data-testid="wiz-resume-banner"><span className="text-sm font-semibold text-ink-950">Resume booking?</span><span className="text-sm text-txt-secondary">Unfinished booking from {fmtRelative(new Date(draft.saved_at).toISOString())} (step {draft.step + 1}: {STEPS[draft.step]}).</span><div className="ml-auto flex gap-2"><button className="btn btn-ghost btn-sm" onClick={discard} data-testid="wiz-discard">Discard</button><button className="btn btn-primary btn-sm" onClick={resume} data-testid="wiz-resume">Resume</button></div></div>}
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
      <div className="min-w-0 lg:sticky lg:top-24 lg:self-start" data-testid="wizard-steps">
        <Stepper steps={STEPS.map((s, i) => ({ label: s, desc: STEP_DESC[i] }))} current={step} onJump={(i) => i < step && setStep(i)} testId="wiz-stepper" />
        <div className="hidden">{STEPS.map((s, i) => <span key={s} data-testid={`wiz-step-${i}`} />)}</div>
        <p className="mt-2 text-sm font-semibold text-ink-950 lg:hidden" data-testid="wiz-step-label">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
      </div>
      <Card className="min-w-0 !p-5 sm:!p-6">
        <div className="mb-5"><p className="label">Step {step + 1}</p><h2 className="mt-1 font-display text-2xl text-ink-950">{STEPS[step]}</h2><p className="mt-1 text-sm text-txt-secondary">{STEP_DESC[step]}</p></div>
        {step === 0 && <div className="grid gap-4 md:grid-cols-2">
          <Field label="Project" required><Combobox options={(projects?.items || []).map((p) => ({ value: p.id, label: p.name, sub: p.code }))} value={projectId} onChange={(v) => { setProjectId(v); setBlockId(null); setFlat(null); }} allowAdd={false} testId="wiz-project" onCreateNew={qcProject.onCreateNew} createLabel={qcProject.createLabel} />{qcProject.node}</Field>
          <Field label="Tower" required><Combobox options={(blocks?.items || []).map((b) => ({ value: b.id, label: b.name, sub: `${b.inventory?.Available ?? 0} available · ${b.construction_percent}%` }))} value={blockId} onChange={(v) => { setBlockId(v); setFlat(null); }} disabled={!projectId} allowAdd={false} testId="wiz-block" onCreateNew={projectId ? qcTower.onCreateNew : undefined} createLabel={qcTower.createLabel} />{qcTower.node}</Field>
        </div>}
        {step === 1 && <div><div className="mb-2 flex justify-end"><QuickAddButton kind="flat" prefill={{ project_id: projectId, block_id: blockId }} onCreated={async (f) => { await reloadGrid(); setFlat(f); }} testId="wiz-quick-add-flat" className="btn btn-secondary btn-sm" /></div><Suspense fallback={<p className="text-sm text-txt-muted">Loading grid…</p>}><UnitGrid grid={grid} flat={flat} setFlat={setFlat} flatQ={flatQ} setFlatQ={setFlatQ} /></Suspense></div>}
        {step === 2 && <div>
          <div className="flex flex-col gap-2 sm:flex-row"><input value={custSearch} onChange={(e) => setCustSearch(e.target.value)} placeholder="Search by phone, name or code…" className="input sm:max-w-md" data-testid="wiz-customer-search" />{can("sales.customer.edit") && <button type="button" className="btn btn-secondary" onClick={() => setNewCust(true)} data-testid="wiz-new-customer"><Plus className="h-4 w-4" />New customer</button>}</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">{custResults.map((c) => <button key={c.id} onClick={() => setCustomer(c)} className={cn("card card-hover flex items-center gap-3 !p-4 text-left", customer?.id === c.id && "!border-ink-950 ring-1 ring-ink-950")} data-testid={`wiz-customer-${c.customer_code}`}><Avatar name={c.full_name} size={36} /><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-950">{c.salutation} {c.full_name}</p><p className="truncate text-xs text-txt-secondary">{c.customer_code} · {c.phone} · KYC {c.kyc_status}</p></div></button>)}</div>
          {customer && <p className="mt-4 text-sm text-txt-secondary">Selected: <b className="text-ink-950">{customer.full_name}</b> ({customer.customer_code})</p>}
          {customer && can("sales.customer.edit") && <div className="mt-4 rounded-2xl border border-warm-200 bg-white/70 p-4" data-testid="wiz-coapplicants">
            <div className="flex items-center justify-between"><div><h3 className="font-display text-lg">Co-applicants <span className="text-sm font-normal text-txt-muted">(optional)</span></h3><p className="text-xs text-txt-muted">Saved on {customer.full_name}'s profile with this booking — same fields as Customer 360.</p></div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCoApps([...coApps, { id: crypto.randomUUID(), name: "", relation_id: null, phone: "", kyc: {} }])} data-testid="wiz-coapp-add"><Plus className="h-3.5 w-3.5" />Add co-applicant</button></div>
            {(customer.co_applicants || []).length > 0 && <p className="mt-2 text-xs text-txt-secondary">Already on file: {customer.co_applicants.map((c) => c.name).join(", ")}</p>}
            {coRows.map(({ k, row: c }, i) => <div key={k} className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2" data-testid={`wiz-coapp-${i}`}>
              <Field label="Relation"><Select type="relation" value={c.relation_id} onChange={(v) => setCoApps(coApps.map((x, j) => (j === i ? { ...x, relation_id: v } : x)))} testId={`wiz-coapp-relation-${i}`} /></Field>
              <Field label="Name" required><input className="input" value={c.name} onChange={(e) => setCoApps(coApps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-testid={`wiz-coapp-name-${i}`} /></Field>
              <Field label="Phone"><input className="input" value={c.phone} onChange={(e) => setCoApps(coApps.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} data-testid={`wiz-coapp-phone-${i}`} /></Field>
              <button type="button" onClick={() => setCoApps(coApps.filter((_, j) => j !== i))} className="btn btn-ghost !h-10 !w-10 !px-0 text-brick" aria-label="Remove" data-testid={`wiz-coapp-remove-${i}`}><X className="h-4 w-4" /></button>
              <div className="col-span-4"><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-txt-muted">KYC documents <span className="font-normal normal-case">(PDF/JPG/PNG/HEIC · 10 MB · private, signed links only)</span></p>
                <KycSlots coId={c.id} value={c.kyc} customerId={customer.id} onChange={(v) => setCoApps(coApps.map((x, j) => (j === i ? { ...x, kyc: v } : x)))} testId={`wiz-coapp-kyc-${i}`} /></div></div>)}
          </div>}
          {customer && <div className="mt-3 max-w-md"><Field label="Lead this booking converts" hint="Keeps the sales funnel truthful. Walk-in creates a Converted lead with source Walk-in."><select className="input" value={leadId} onChange={(e) => setLeadId(e.target.value)} data-testid="wiz-lead"><option value="">No lead / walk-in</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.lead_number} · {l.status} · {l.source || ""}</option>)}</select></Field></div>}
          {newCust && <Suspense fallback={null}><CustomerForm open={newCust} onOpenChange={setNewCust} onSaved={(c) => { setCustomer(c); setCustResults([c]); }} /></Suspense>}
        </div>}
        {step === 3 && <div className="grid gap-4 md:grid-cols-3">
          <Field label="Agreement value ₹" required hint={canEditAgr ? "Derived from list price − discount · editable (agreement.edit)" : "Derived from list price − discount"}>
            <Input type="number" value={agr.total} readOnly={!canEditAgr} onChange={(e) => { const t = Math.round(Number(e.target.value) || 0); setAgr((a) => a.mode === "percent" ? { ...a, total: e.target.value, cash: String(Math.round(t * (Number(a.cashPct) || 0) / 100)), account: String(t - Math.round(t * (Number(a.cashPct) || 0) / 100)) } : { ...a, total: e.target.value, account: String(Math.max(t - cash, 0)) }); }} data-testid="wiz-total" />
            <FieldError name="agreement_value" fields={fe.fields} /><FieldError name="cash_agreed" fields={fe.fields} />
            <div className="mt-2 rounded-lg bg-warm-50 px-3 py-2 text-xs text-txt-secondary" data-testid="wiz-price-breakup">
              {(flat?.price_breakup || []).map((b) => <div key={b.label} className="flex justify-between"><span>{b.label}</span><span>{inr(b.amount)}</span></div>)}
              <div className="flex justify-between font-semibold text-ink-950"><span>List price</span><span>{inr(listPrice)}</span></div>
              {Number(discount) > 0 && <div className="flex justify-between text-sage"><span>Negotiated discount</span><span>− {inr(Number(discount))}</span></div>}
            </div>
          </Field>
          <Field label="Negotiated discount ₹" hint="Typed · reduces the agreement value"><Input type="number" min="0" max={listPrice || undefined} value={discount} onChange={(e) => setDiscount(e.target.value)} data-testid="wiz-discount" /></Field>
          <Field label={agr.mode === "percent" ? "Cash share %" : "Cash bucket ₹"} required>
            <div className="flex gap-2"><Input type="number" min="0" max={agr.mode === "percent" ? 100 : undefined} step={agr.mode === "percent" ? "0.5" : "1"} value={agr.mode === "percent" ? agr.cashPct : agr.cash} onChange={(e) => agr.mode === "percent" ? setCashPct(e.target.value) : setCash(e.target.value)} data-testid="wiz-cash" />
              <div className="flex shrink-0 overflow-hidden rounded-md border text-xs font-semibold" role="group" aria-label="Cash entry mode">{[["amount", "₹"], ["percent", "%"]].map(([m, l]) => <button key={m} type="button" onClick={() => setAgr((a) => ({ ...a, mode: m, cashPct: m === "percent" && total ? String(Math.round((cash / total) * 1000) / 10) : a.cashPct }))} className={cn("px-3", agr.mode === m ? "bg-ink-950 text-white" : "bg-white text-txt-secondary hover:bg-warm-50")} data-testid={`wiz-cash-mode-${m}`}>{l}</button>)}</div></div>
            <div className="mt-1 flex items-center gap-1">{[0, 20, 30, 40, 50, 60].map((p) => <button key={p} type="button" onClick={() => setCashPct(p)} className={cn("rounded border px-1.5 py-0.5 text-[10px] hover:bg-warm-50", Number(agr.cashPct) === p && "border-ink-950 bg-ink-950 text-white")} data-testid={`wiz-cash-pct-${p}`}>{p}%</button>)}{agr.mode === "percent" && <span className="ml-auto text-[11px] tabular-nums text-txt-secondary" data-testid="wiz-cash-derived">= {inr(cash)}</span>}</div>
            <input type="range" min="0" max="100" step="0.5" value={total ? Math.round((cash / total) * 1000) / 10 : 0} onChange={(e) => setCashPct(e.target.value)} className="mt-2 w-full accent-[#0A0C10]" aria-label="Cash share slider" data-testid="wiz-cash-slider" />
{total > 0 && cash === 0 && <p className="mt-2 rounded-lg bg-amber2-50 px-3 py-2 text-xs font-semibold text-amber2" role="status" data-testid="wiz-zero-cash-warning">0% cash — the whole agreement goes to the Account bucket. Adjust the slider or % if cash is expected.</p>}
            <p className="mt-1 text-[11px] text-txt-muted" data-testid="wiz-split-hint">{tower?.default_cash_percent != null ? "Tower" : "Project"} default {defaultCashPct}% cash · {100 - defaultCashPct}% account</p></Field>
          <Field label="Account bucket ₹" required hint="Auto-balanced to the rupee"><Input type="number" value={agr.account} onChange={(e) => { const acc = Math.round(Number(e.target.value) || 0); setAgr((a) => ({ ...a, account: e.target.value, cash: String(Math.max(total - acc, 0)), cashPct: total ? String(Math.round(((total - acc) / total) * 1000) / 10) : a.cashPct })); }} data-testid="wiz-account" /></Field>
          <div className={cn("md:col-span-3 rounded-xl px-4 py-2.5 text-sm", sumOk ? "bg-sage-50 text-sage" : "bg-brick-50 text-brick")} data-testid="wiz-sum-check">{sumOk ? `✓ Cash ${inr(cash)} + Account ${inr(account)} = ${inr(total)}` : `Cash + Account must equal the agreement value exactly (currently ${inr(cash + account)} vs ${inr(total)})`}</div>
          <Field label="Booking date" required><DateInput value={bookingDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBookingDate(e.target.value)} data-testid="wiz-date" /></Field>
        </div>}
        {step === 4 && <div data-testid="wiz-plan-step">
          <div className="mb-2 flex justify-end"><QuickAddButton kind="payment_plan" prefill={{ project_id: projectId, block_id: blockId }} onCreated={(p) => api.get(`/projects/${projectId}/blocks/${blockId}/payment-plans`).then((r) => { setPlans(r.data.items); setPlanId(p.id); })} testId="wiz-quick-add-plan" className="btn btn-secondary btn-sm" /></div>
          <FieldError name="payment_plan_id" fields={fe.fields} />
          {plans === null ? <p className="text-sm text-txt-muted">Loading plans…</p> : plans.length === 0 ? <div className="rounded-xl bg-amber2-50 px-4 py-3 text-sm text-amber2" data-testid="wiz-plan-none">No payment plan assigned to this tower — assign one under Project → Setup → Payment plans. Booking will proceed without a plan (no automatic dues).</div> : <div className="grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="space-y-3" data-testid="wiz-plan-list">{plans.map((p) => <button type="button" key={p.id} onClick={() => setPlanId(p.id)} className={cn("card card-hover w-full !p-4 text-left", planId === p.id && "!border-ink-950 ring-1 ring-ink-950")} data-testid={`wiz-plan-${p.code}`}><div className="flex items-start justify-between gap-2"><p className="font-display text-base font-semibold text-ink-950">{p.name}</p>{p.is_default && <span className="pill bg-gold-light text-[#8a6d12]">Default</span>}</div><p className="mt-1 text-xs text-txt-secondary">{p.stage_plan_name ? <span className="rounded-full bg-gold-light px-2 py-0.5 text-[10px] font-bold text-[#8a6d12]" data-testid={`wiz-plan-${p.code}-stage-plan`}>Stage plan: {p.stage_plan_name}</span> : p.plan_type} · {p.installments.map((i) => `${i.name} ${i.percent}%`).join(" + ")}</p>{p.description && <p className="mt-1 text-xs text-txt-muted">{p.description}</p>}</button>)}</div>
            <div className="card min-w-0 overflow-x-auto !p-4">{plan && <><p className="mb-2 font-display text-base text-ink-950">Schedule preview — {plan.name}</p><Suspense fallback={<p className="text-xs text-txt-muted">Loading schedule…</p>}><SchedulePreview plan={plan} cash={cash} account={account} bookingDate={bookingDate} /></Suspense><Field label="Plan accepted by customer via" className="mt-4"><Combobox options={["In person", "Signed copy", "Portal"].map((m) => ({ value: m, label: m }))} value={acceptMode} onChange={(v) => setAcceptMode(v || "In person")} allowAdd={false} clearable={false} className="w-56" testId="wiz-plan-accept" /></Field><p className="mt-2 text-xs text-txt-muted">Upload the signed plan later under Booking → Documents (type "Payment Plan Acceptance").</p></>}</div>
          </div>}
        </div>}
        {step === 5 && <div className="grid gap-6 lg:grid-cols-2">
          <div><p className="label mb-3">Other charges</p>
            {charges.map((c, i) => <div key={c.charge_type_id} className="mb-2 grid grid-cols-[auto_1fr_110px_70px_140px] items-center gap-2 text-sm"><input type="checkbox" checked={c.on} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} data-testid={`wiz-charge-${c.charge_type_id}`} /><span className="text-ink-950">{c.name}</span><Input type="number" value={c.amount} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="input !h-9" /><Input type="number" value={c.gst_percent} disabled={!c.is_taxable} onChange={(e) => setCharges(charges.map((x, j) => j === i ? { ...x, gst_percent: Number(e.target.value) } : x))} className="input !h-9" title="GST %" /><Combobox options={[["on_booking", "On booking"], ["on_possession", "On possession"], ["manual", "Manual"]].map(([v, l]) => ({ value: v, label: l }))} value={c.demand_at} onChange={(v) => setCharges(charges.map((x, j) => j === i ? { ...x, demand_at: v || "on_booking" } : x))} allowAdd={false} clearable={false} /></div>)}
            <p className="mt-3 text-sm text-txt-secondary">Selected charges incl. GST: <Money value={chargeTotal} className="text-base text-ink-950" /></p></div>
          <div><p className="label mb-3">Parking ({freeSlots.length} available)</p>
            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">{freeSlots.map((s) => <button key={s.id} onClick={() => setSlots(slots.includes(s.id) ? slots.filter((x) => x !== s.id) : [...slots, s.id])} className={cn("pill border transition-colors", slots.includes(s.id) ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-txt-secondary hover:border-gold")} title={`${s.type} · ${s.level || ""}`} data-testid={`wiz-slot-${s.number}`}>{s.number}</button>)}</div></div>
        </div>}
        {step === 6 && <div className="grid gap-4 md:grid-cols-2">
          <div><KV label="Unit" value={`${flat?.flat_number} · ${flat?.flat_type_code} · ${num(flat?.super_builtup_sqft)} sq.ft`} /><KV label="Customer" value={`${customer?.full_name} (${customer?.customer_code})`} /><KV label="Co-applicants" value={coApps.filter((c) => c.name.trim()).length ? coApps.filter((c) => c.name.trim()).map((c) => `${c.name.trim()} (KYC ${["kyc_pan", "kyc_aadhaar"].filter((k) => c.kyc?.[k]).length}/2)`).join(", ") : "None"} /><KV label="Booking date" value={bookingDate} /><KV label="Agreement" value={inr(total)} /><KV label="Cash / Account" value={`${inr(cash)} / ${inr(account)}`} /></div>
          <div><KV label="Other charges" value={selCharges.length ? selCharges.map((c) => c.name).join(", ") : "None"} /><KV label="Charges total" value={inr(chargeTotal)} /><KV label="Parking" value={slots.length ? `${slots.length} slot(s)` : "None"} /><KV label="Construction" value={`${grid?.block.construction_percent ?? 0}% — demands raised on confirm`} /><Field label="Remarks"><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="input" data-testid="wiz-remarks" /></Field></div>
        </div>}
        <div className="sticky bottom-0 z-20 -mx-5 mt-6 flex justify-between gap-3 border-t border-warm-100 bg-white/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6" data-testid="wiz-footer">
          <button type="button" className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="wiz-back"><ChevronLeft className="h-4 w-4" />Back</button>
          {step < 6 ? <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)} className="btn btn-primary" data-testid="wiz-next">Next<ChevronRight className="h-4 w-4" /></button>
            : <button type="button" disabled={busy} onClick={submit} className="btn btn-gold" data-testid="wiz-confirm"><Check className="h-4 w-4" />{busy ? "Booking…" : "Confirm booking"}</button>}
        </div>
      </Card>
      <aside className="hidden lg:block lg:sticky lg:top-24 lg:self-start" data-testid="wiz-summary">
        <Card className="!p-5 text-sm">
          <p className="label mb-3">Booking summary</p>
          <dl className="space-y-3">
            <SRow k="Project" v={projects?.items?.find((p) => p.id === projectId)?.name} />
            <SRow k="Tower" v={blocks?.items?.find((b) => b.id === blockId)?.name} />
            <SRow k="Unit" v={flat ? [flat.flat_number, flat.flat_type_name].filter(Boolean).join(" · ") : null} />
            <SRow k="Customer" v={customer?.full_name} sub={customer?.phone} />
            <SRow k="Agreement" v={total ? inr(total) : null} sub={total && (cash || account) ? `Cash ${inr(cash)} · Account ${inr(account)}` : null} warn={total > 0 && !sumOk ? "Cash + Account ≠ total" : null} />
            <SRow k="Payment plan" v={plan?.name} sub={plan ? `${plan.plan_type} · accepted ${acceptMode}` : null} />
            <SRow k="Other charges" v={charges.length ? inr(chargesTotal) : null} sub={charges.length ? `${charges.length} line(s) incl. GST` : null} />
            <SRow k="Parking" v={slots.length ? `${slots.length} slot(s)` : null} />
          </dl>
          <div className="mt-4 border-t border-warm-100 pt-4"><p className="label">Grand total</p><p className="mt-1 font-display text-3xl text-ink-950" data-testid="wiz-grand-total"><Num s={inr(total + chargesTotal)} /></p></div>
        </Card>
      </aside>
      </div>
    </div>
  );
}

function SRow({ k, v, sub, warn }) {
  return <div className="flex flex-col gap-0.5"><dt className="text-[11px] font-semibold text-txt-secondary">{k}</dt><dd className={cn("font-semibold leading-snug", v ? "text-ink-950" : "text-txt-muted")}>{v && String(v).startsWith("₹") ? <Num s={v} className="font-display text-base" /> : v || "—"}</dd>{sub && <dd className="text-xs text-txt-secondary">{sub}</dd>}{warn && <dd className="text-xs font-semibold text-brick">{warn}</dd>}</div>;
}
