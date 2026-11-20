import { plural } from "@/lib/format";
import { TypedMasterInput } from "@/components/common/TypedMasterInput";
import { NativeSelect } from "@/components/common/EliteInputs";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { showNextStep } from "@/components/common/NextStep";
import { AmountInput } from "@/components/common/AmountInput";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Lock, Plus, X } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { FieldError, useFieldErrors } from "@/lib/formErrors";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { Field, KV } from "@/components/common/Bits";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";
import { Select as Combobox, Select } from "@/components/v2/Select";
import { Card, Num, Stepper } from "@/components/v2";
import { Avatar, usePeople } from "@/components/v2/CustomerBits";
import { WhyDisabled } from "@/components/common/WhyDisabled";
import { inr, num, fmtRelative } from "@/lib/format";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { cn } from "@/lib/utils";
import { useRowKeys } from "@/hooks/useRowKeys";
import { useBookingDraft } from "@/hooks/useBookingDraft";
import { BreakdownCard } from "@/components/common/BreakdownCard";
import { KycSlots } from "@/components/common/KycSlots";
import { useCatalogues } from "@/hooks/useCatalogues";
import { Button } from "@/components/ui/button";
import { businessToday } from "@/lib/businessDay";

const CustomerForm = lazy(() => import("@/components/v2/QuickCustomerSheet"));
const SchedulePreview = lazy(() =>
  import("@/components/common/PaymentSchedule").then((m) => ({ default: m.SchedulePreview })),
);
const UnitGrid = lazy(() => import("@/components/booking/UnitGrid"));

/** Phase S2.1 — three steps: Who · Price & Plan · Confirm. Flat known (Flat → Book) or customer known (Customer → New booking). */
const STEPS = ["Who", "Price & Plan", "Confirm"];
const STEP_DESC = [
  "Customer and co-applicants",
  "Agreement, split, GST, charges and payment plan — one card",
  "Check and book",
];

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
  useEffect(() => {
    const fid = sp.get("flat"),
      cid = sp.get("customer_id");
    if (cid)
      api
        .get(`/customers/${cid}`)
        .then((r) => setCustomer(r.data))
        .catch(() => {});
    if (fid)
      api
        .get(`/flats/${fid}`)
        .then((r) => {
          const f = r.data;
          setProjectId(f.project_id);
          setBlockId(f.block_id);
          setFlat(f);
        })
        .catch((e) => toast.error(errMsg(e)));
  }, [sp]);
  const [leadId, setLeadId] = useState("");
  const customerPhone = customer?.phone;
  useEffect(() => {
    if (!customerPhone) {
      setLeadId("");
      return;
    }
    api
      .get("/leads", { params: { search: customerPhone, page_size: 20 } })
      .then((r) =>
        setLeadId(
          (r.data.items || []).find((l) => !["Converted", "Lost"].includes(l.status))?.id || "",
        ),
      )
      .catch(() => setLeadId(""));
  }, [customerPhone]); // lead auto-linked by phone
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState([]);
  const [newCust, setNewCust] = useState(false);
  const [agr, setAgr] = useState({ total: "", cash: "", account: "", cashPct: "" });
  const [discount, setDiscount] = useState("");
  const canEditAgr = can("sales.agreement.revise");
  const [breakdown, setBreakdown] = useState(null);
  const [slots, setSlots] = useState([]);
  const [bookingDate, setBookingDate] = useState(businessToday());
  const [remarks, setRemarks] = useState("");
  const [salesUserId, setSalesUserId] = useState(null);
  const people = usePeople();
  const [plans, setPlans] = useState(null);
  const [planId, setPlanId] = useState("");
  useEffect(() => {
    if (projectId && blockId)
      api
        .get(`/projects/${projectId}/blocks/${blockId}/payment-plans`)
        .then((r) => {
          setPlans(r.data.items);
          setPlanId(
            (p) => p || (r.data.items.find((x) => x.is_default) || r.data.items[0])?.id || "",
          );
        })
        .catch(() => setPlans([]));
  }, [projectId, blockId]);
  const plan = plans?.find((p) => p.id === planId);
  const [busy, setBusy] = useState(false);
  const draftKey = `kkt:booking-draft:${user?.id || "anon"}`;
  const draftSlice = useMemo(
    () => ({
      step,
      projectId,
      blockId,
      flatId: flat?.id || null,
      customerId: customer?.id || null,
      agr,
      slots,
      bookingDate,
      remarks,
      planId,
    }),
    [step, projectId, blockId, flat?.id, customer?.id, agr, slots, bookingDate, remarks, planId],
  );
  const {
    draft,
    clear: clearDraft,
    dismiss: dismissDraft,
  } = useBookingDraft(draftKey, draftSlice, step > 0 || Boolean(flat));
  const resume = async () => {
    const d = draft;
    dismissDraft();
    setProjectId(d.projectId);
    setBlockId(d.blockId);
    setAgr(d.agr);
    setSlots(d.slots || []);
    setBookingDate(d.bookingDate);
    setRemarks(d.remarks || "");
    setPlanId(d.planId || "");
    try {
      const [f, c] = await Promise.all([
        d.flatId ? api.get(`/flats/${d.flatId}`) : null,
        d.customerId ? api.get(`/customers/${d.customerId}`) : null,
      ]);
      if (f) setFlat(f.data);
      if (c) setCustomer(c.data);
    } catch (e) {
      toast.error(errMsg(e));
    }
    setStep(Math.min(d.step, 2));
  };
  useUnsavedGuard(
    step > 0 && !busy,
    "Your booking draft is saved locally, but unsent changes will be lost if you leave. Continue?",
  );
  const { data: projects } = useFetch("/projects?page_size=50");
  const { data: blocks } = useFetch(
    projectId ? `/blocks?project_id=${projectId}&page_size=50` : null,
    [projectId],
  );
  const { data: grid } = useFetch(
    blockId && !flat
      ? `/blocks/${blockId}/grid?bookable_for=${encodeURIComponent(customer?.id || "")}`
      : null,
    [blockId, customer?.id, flat],
  );
  const { data: parking, reload: refetchParking } = useFetch(
    projectId ? `/parking?project_id=${projectId}&page_size=200` : null,
    [projectId],
  );
  useEffect(() => {
    if (custSearch.length < 2) {
      setCustResults([]);
      return;
    }
    const t = setTimeout(
      () =>
        api
          .get("/customers", { params: { search: custSearch, page_size: 8 } })
          .then((r) => setCustResults(r.data.items)),
      250,
    );
    return () => clearTimeout(t);
  }, [custSearch]);
  const tower = (blocks?.items || []).find((b) => b.id === blockId);
  const defaultCashPct =
    tower?.default_cash_percent != null
      ? Number(tower.default_cash_percent)
      : Number((projects?.items || []).find((p) => p.id === projectId)?.default_cash_percent) || 0;
  const listPrice = flat?.price ? Math.round(flat.price) : 0;
  useEffect(() => {
    if (!listPrice) return;
    const t = Math.max(listPrice - (Math.round(Number(discount)) || 0), 0);
    setAgr((a) => {
      if (String(t) === a.total) return a;
      const pct = a.cashPct !== "" ? Number(a.cashPct) : defaultCashPct;
      const c = Math.round((t * pct) / 100);
      return { total: String(t), cash: String(c), account: String(t - c), cashPct: String(pct) };
    });
  }, [listPrice, discount, defaultCashPct]);
  const total = Number(agr.total) || 0,
    cash = Number(agr.cash) || 0,
    account = Number(agr.account) || 0;
  const sumOk = total > 0 && Math.round((cash + account) * 100) === Math.round(total * 100);
  const [discReason, setDiscReason] = useState("");
  const discGiven = listPrice ? listPrice - total : 0;
  const discMissing = discGiven > 0 && discReason.trim().length < 2;
  const setCashPct = (p) => {
    const c = Math.round((total * (Number(p) || 0)) / 100);
    setAgr((a) => ({ ...a, cashPct: String(p), cash: String(c), account: String(total - c) }));
  };
  const [slotQ, setSlotQ] = useState("");
  const freeSlots = useMemo(() => {
    const q = slotQ.trim().toLowerCase();
    return (parking?.items || []).filter(
      (s) =>
        s.status === "Available" &&
        (!q || `${s.number} ${s.type || ""} ${s.level || ""}`.toLowerCase().includes(q)),
    );
  }, [parking, slotQ]);
  const ownSlots = useMemo(
    () =>
      (parking?.items || []).filter(
        (s) => s.status === "Attached" && flat && s.flat_id === flat.id,
      ),
    [parking, flat],
  );
  const detachSlot = async (s) => {
    try {
      await api.post(`/parking/${s.id}/detach`, {});
      toast.success(`${s.number} detached`);
      refetchParking();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const canNext = [
    !!customer && !!flat,
    sumOk && (!plans?.length || !!planId) && !discMissing,
    true,
  ][step];
  const nextWhy = canNext
    ? null
    : step === 0
      ? !flat
        ? "Pick the flat"
        : "Pick or add the customer"
      : !sumOk
        ? "Cash + Account must equal the agreement value"
        : discMissing
          ? "Pick the discount reason"
          : "Pick the payment plan";

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        flat_id: flat.id,
        customer_id: customer.id,
        lead_id: leadId || null,
        sales_user_id: salesUserId || null,
        discount_reason: discGiven > 0 ? discReason.trim() : null,
        booking_date: bookingDate,
        agreement_value: total,
        cash_agreed: cash,
        account_agreed: account,
        remarks: remarks || null,
        parking_slot_ids: slots,
        payment_plan_id: planId || null,
        other_charges: (breakdown?.charges || []).map((c) => ({
          charge_type_id: c.charge_type_id || null,
          name: c.name,
          source: c.source || null,
          amount: Number(c.amount) || 0,
          gst_percent: Number(c.gst_percent) || 0,
          demand_at: c.demand_at,
        })),
        agreement_gst_percent: breakdown?.agreement_gst_percent ?? null,
        co_applicants: coApps
          .filter((c) => c.name.trim())
          .map((c) => ({
            id: c.id,
            name: c.name.trim(),
            relation: label("relation", c.relation_id) || null,
            phone: c.phone.replace(/\D/g, "") || null,
          })),
      };
      const r = await api.post("/bookings", body);
      clearDraft();
      toast.success(
        `Booking ${r.data.booking_number} created — cost sheet and allotment letter are ready on the booking page`,
      );
      nav(`/bookings/${r.data.id}`);
      showNextStep({
        title: `Booking ${r.data.booking_number} saved`,
        actions: [
          can("finance.payment.create") && {
            label: "Record booking amount",
            to: `/bookings/${r.data.id}?pay=1`,
          },
          { label: "Print allotment letter", to: `/print/allotment/${r.data.id}` },
        ].filter(Boolean),
      });
    } catch (e) {
      toast.error(fe.capture(e), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8" data-testid="booking-wizard">
      <header>
        <h1 className="e-title" data-testid="page-title">
          new booking.
        </h1>
        <p className="mt-2 text-sm text-txt-secondary">
          Three steps: who, price &amp; plan, confirm.
        </p>
      </header>
      {draft && (
        <div className="notice" data-testid="wiz-resume-banner">
          <span className="text-sm font-semibold text-ink-950">Resume booking?</span>
          <span className="text-sm text-txt-secondary">
            Unfinished booking from {fmtRelative(new Date(draft.saved_at).toISOString())}.
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="quiet"
              size="compact"
              onClick={() => clearDraft()}
              data-testid="wiz-discard"
            >
              Discard
            </Button>
            <Button variant="primary" size="compact" onClick={resume} data-testid="wiz-resume">
              Resume
            </Button>
          </div>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start" data-testid="wizard-steps">
          <Stepper
            steps={STEPS.map((s, i) => ({ label: s, desc: STEP_DESC[i] }))}
            current={step}
            onJump={(i) => i < step && setStep(i)}
            testId="wiz-stepper"
          />
          <div className="hidden">
            {STEPS.map((s, i) => (
              <span key={s} data-testid={`wiz-step-${i}`} />
            ))}
          </div>
          <p
            className="mt-2 text-sm font-semibold text-ink-950 lg:hidden"
            data-testid="wiz-step-label"
          >
            Step {step + 1} of 3 · {STEPS[step]}
          </p>
        </div>
        <Card className="min-w-0 !p-5 sm:!p-6">
          <div className="mb-5">
            <p className="label">Step {step + 1} of 3</p>
            <h2 className="mt-1 font-display text-2xl text-ink-950">{STEPS[step]}</h2>
            <p className="mt-1 text-sm text-txt-secondary">{STEP_DESC[step]}</p>
          </div>
          {step === 0 && (
            <div className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                  placeholder="Search customer by phone, name or code…"
                  className="input sm:max-w-md"
                  data-testid="wiz-customer-search"
                />
                {can("sales.customer.edit") && (
                  <Button
                    type="button"
                    variant="soft"
                    onClick={() => setNewCust(true)}
                    data-testid="wiz-new-customer"
                  >
                    <Plus className="h-4 w-4" />
                    New customer
                  </Button>
                )}
              </div>
              {custResults.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {custResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCustomer(c);
                        setCustResults([]);
                        setCustSearch("");
                      }}
                      className={cn(
                        "card card-hover flex items-center gap-3 !p-4 text-left",
                        customer?.id === c.id && "!border-ink-950 ring-1 ring-ink-950",
                      )}
                      data-testid={`wiz-customer-${c.customer_code}`}
                    >
                      <Avatar name={c.full_name} size={36} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-950">
                          {c.salutation} {c.full_name}
                        </p>
                        <p className="truncate text-xs text-txt-secondary">
                          {c.customer_code} · {c.phone} · KYC {c.kyc_status}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {customer && (
                <div
                  className="flex items-center gap-3 rounded-xl bg-warm-50 px-4 py-3"
                  data-testid="wiz-customer-selected"
                >
                  <Avatar name={customer.full_name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-950">
                      {customer.full_name}{" "}
                      <span className="font-normal text-txt-secondary">
                        ({customer.customer_code}) · {customer.phone}
                      </span>
                    </p>
                    {leadId && (
                      <p className="text-xs text-txt-muted">
                        Open lead with this phone will be marked Converted.
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="quiet"
                    size="compact"
                    onClick={() => setCustomer(null)}
                    data-testid="wiz-customer-change"
                  >
                    Change
                  </Button>
                </div>
              )}
              {customer && can("sales.customer.edit") && (
                <div
                  className="rounded-2xl border border-warm-200 bg-white/70 p-4"
                  data-testid="wiz-coapplicants"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="e-caps-blue">
                      Co-applicants{" "}
                      <span className="text-sm font-normal text-txt-muted">(optional)</span>
                    </h3>
                    <Button
                      type="button"
                      variant="soft"
                      size="compact"
                      onClick={() =>
                        setCoApps([
                          ...coApps,
                          {
                            id: crypto.randomUUID(),
                            name: "",
                            relation_id: null,
                            phone: "",
                            kyc: {},
                          },
                        ])
                      }
                      data-testid="wiz-coapp-add"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                  {(customer.co_applicants || []).length > 0 && (
                    <p className="mt-2 text-xs text-txt-secondary">
                      Already on file: {customer.co_applicants.map((c) => c.name).join(", ")}
                    </p>
                  )}
                  {coRows.map(({ k, row: c }, i) => (
                    <div
                      key={k}
                      className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2"
                      data-testid={`wiz-coapp-${i}`}
                    >
                      <Field label="Relation">
                        <Select
                          type="relation"
                          value={c.relation_id}
                          onChange={(v) =>
                            setCoApps(
                              coApps.map((x, j) => (j === i ? { ...x, relation_id: v } : x)),
                            )
                          }
                          testId={`wiz-coapp-relation-${i}`}
                        />
                      </Field>
                      <Field label="Name" required>
                        <input
                          className="input"
                          value={c.name}
                          onChange={(e) =>
                            setCoApps(
                              coApps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                            )
                          }
                          data-testid={`wiz-coapp-name-${i}`}
                        />
                      </Field>
                      <Field label="Phone">
                        <input
                          className="input"
                          value={c.phone}
                          onChange={(e) =>
                            setCoApps(
                              coApps.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)),
                            )
                          }
                          data-testid={`wiz-coapp-phone-${i}`}
                        />
                      </Field>
                      <Button
                        type="button"
                        onClick={() => setCoApps(coApps.filter((_, j) => j !== i))}
                        variant="quiet"
                        className="!h-10 !w-10 !px-0 text-brick"
                        aria-label="Remove"
                        data-testid={`wiz-coapp-remove-${i}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <div className="col-span-4">
                        <KycSlots
                          coId={c.id}
                          value={c.kyc}
                          customerId={customer.id}
                          onChange={(v) =>
                            setCoApps(coApps.map((x, j) => (j === i ? { ...x, kyc: v } : x)))
                          }
                          testId={`wiz-coapp-kyc-${i}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {newCust && (
                <Suspense fallback={null}>
                  <CustomerForm
                    open={newCust}
                    onOpenChange={setNewCust}
                    onSaved={(c) => {
                      setCustomer(c);
                    }}
                  />
                </Suspense>
              )}
              <div className="rounded-2xl border border-warm-200 p-4" data-testid="wiz-unit">
                <p className="label mb-3">Flat</p>
                {flat ? (
                  <div className="flex items-center gap-3">
                    <p className="text-sm">
                      <b className="text-ink-950">{flat.flat_number}</b> · {flat.flat_type_code} ·{" "}
                      {num(flat.saleable_sqft)} sq.ft · {inr(listPrice)}
                    </p>
                    {!sp.get("flat") && (
                      <Button
                        type="button"
                        variant="quiet"
                        size="compact"
                        onClick={() => setFlat(null)}
                        data-testid="wiz-flat-change"
                      >
                        Change
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Project" required>
                        <Combobox
                          options={(projects?.items || []).map((p) => ({
                            value: p.id,
                            label: p.name,
                            sub: p.code,
                          }))}
                          value={projectId}
                          onChange={(v) => {
                            setProjectId(v);
                            setBlockId(null);
                          }}
                          allowAdd={false}
                          testId="wiz-project"
                        />
                      </Field>
                      <Field label="Tower" required>
                        <Combobox
                          options={(blocks?.items || []).map((b) => ({
                            value: b.id,
                            label: b.name,
                            sub: `${b.inventory?.Available ?? 0} available`,
                          }))}
                          value={blockId}
                          onChange={setBlockId}
                          disabled={!projectId}
                          placeholder={projectId ? "Select…" : "Pick the project first"}
                          allowAdd={false}
                          testId="wiz-block"
                        />
                      </Field>
                    </div>
                    {blockId && (
                      <Suspense fallback={<p className="text-sm text-txt-muted">Loading units…</p>}>
                        <UnitGrid
                          grid={grid}
                          flat={flat}
                          setFlat={setFlat}
                          flatQ={flatQ}
                          setFlatQ={setFlatQ}
                        />
                      </Suspense>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-5" data-testid="wiz-price-plan">
              <div className="grid gap-4 md:grid-cols-4">
                <Field
                  label="Agreement value ₹"
                  required
                  hint={`List price ${inr(listPrice)}${canEditAgr ? " · editable" : ""}`}
                >
                  <AmountInput
                    value={agr.total}
                    readOnly={!canEditAgr}
                    onChange={(e) => {
                      const t = Math.round(Number(e.target.value) || 0);
                      const c = Math.round((t * (Number(agr.cashPct) || 0)) / 100);
                      setAgr((a) => ({
                        ...a,
                        total: e.target.value,
                        cash: String(c),
                        account: String(t - c),
                      }));
                    }}
                    data-testid="wiz-total"
                  />
                  <FieldError name="agreement_value" fields={fe.fields} />
                </Field>
                <Field label="Discount ₹">
                  <AmountInput
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    data-testid="wiz-discount"
                  />
                </Field>
                <Field
                  label="Cash share %"
                  required
                  hint={`Default ${defaultCashPct}% · cash ${inr(cash)} / account ${inr(account)}`}
                >
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={agr.cashPct}
                    onChange={(e) => setCashPct(e.target.value)}
                    data-testid="wiz-cash"
                  />
                  <FieldError name="cash_agreed" fields={fe.fields} />
                </Field>
                <Field label="Account ₹" required>
                  <AmountInput
                    value={agr.account}
                    onChange={(e) => {
                      const acc = Math.round(Number(e.target.value) || 0);
                      setAgr((a) => ({
                        ...a,
                        account: e.target.value,
                        cash: String(Math.max(total - acc, 0)),
                        cashPct: total
                          ? String(Math.round(((total - acc) / total) * 1000) / 10)
                          : a.cashPct,
                      }));
                    }}
                    data-testid="wiz-account"
                  />
                </Field>
              </div>
              <div
                className="rounded-2xl border border-warm-200 bg-white/70 p-4"
                data-testid="wiz-discount-strip"
              >
                {listPrice ? (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <span>
                      List <b data-testid="wiz-list-price">{inr(listPrice)}</b>
                    </span>
                    <span>
                      Agreed <b>{inr(total)}</b>
                    </span>
                    <span className={discGiven > 0 ? "text-brick" : "text-txt-secondary"}>
                      {discGiven >= 0 ? "Discount given" : "Above list"}{" "}
                      <b data-testid="wiz-discount-given">
                        {inr(Math.abs(discGiven))} (
                        {((Math.abs(discGiven) / listPrice) * 100).toFixed(2)}%)
                      </b>
                    </span>
                    <span className="text-xs text-txt-muted">
                      list − agreed = discount · no money effect
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-txt-secondary" data-testid="wiz-list-missing">
                    List price not set — discount not recorded
                  </p>
                )}
                {discGiven > 0 && (
                  <div className="mt-3 max-w-md">
                    <Field label="Discount reason" required>
                      <TypedMasterInput
                        list="discount_reason"
                        value={discReason}
                        onChange={setDiscReason}
                        placeholder="e.g. Festival offer"
                        testId="wiz-discount-reason"
                      />
                    </Field>
                  </div>
                )}
              </div>
              {!sumOk && total > 0 && (
                <p
                  className="rounded-xl bg-brick-50 px-4 py-2 text-sm text-brick"
                  data-testid="wiz-sum-check"
                >
                  Cash + Account must equal the agreement value (currently {inr(cash + account)} vs{" "}
                  {inr(total)})
                </p>
              )}
              <BreakdownCard
                flatId={flat?.id}
                agreementValue={total}
                hasPlan={!!planId}
                canEditAgreement={canEditAgr}
                value={breakdown}
                onChange={setBreakdown}
              />
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="label">Parking</p>
                  <input
                    className="input !h-8 w-full max-w-[220px] text-sm"
                    placeholder="Search slot or type"
                    value={slotQ}
                    onChange={(e) => setSlotQ(e.target.value)}
                    aria-label="Search parking slots"
                    data-testid="wiz-slot-search"
                  />
                </div>
                <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                  {ownSlots.map((s) => (
                    <span
                      key={s.id}
                      className="pill inline-flex items-center gap-1 border border-gold bg-gold-light text-[var(--accent)]"
                      data-testid={`wiz-own-slot-${s.number}`}
                    >
                      <Lock className="h-3 w-3" />
                      {s.number}
                      <button
                        type="button"
                        onClick={() => detachSlot(s)}
                        className="ml-1 underline"
                        data-testid={`wiz-detach-${s.number}`}
                      >
                        remove
                      </button>
                    </span>
                  ))}
                  {freeSlots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setSlots(
                          slots.includes(s.id) ? slots.filter((x) => x !== s.id) : [...slots, s.id],
                        )
                      }
                      className={cn(
                        "pill border",
                        slots.includes(s.id)
                          ? "border-ink-950 bg-ink-950 text-warm-50"
                          : "border-warm-200 bg-white text-txt-secondary hover:border-gold",
                      )}
                      data-testid={`wiz-slot-${s.number}`}
                    >
                      {s.number}
                    </button>
                  ))}
                  {!freeSlots.length && !ownSlots.length && (
                    <span className="text-xs text-txt-muted">
                      {slotQ
                        ? `No free slot matches "${slotQ}".`
                        : "No free slots in this project."}
                    </span>
                  )}
                </div>
              </div>
              <div data-testid="wiz-plan-step">
                <FieldError name="payment_plan_id" fields={fe.fields} />
                {plans === null ? (
                  <p className="text-sm text-txt-muted">Loading plans…</p>
                ) : plans.length === 0 ? (
                  <div
                    className="rounded-xl bg-amber2-50 px-4 py-3 text-sm text-amber2"
                    data-testid="wiz-plan-none"
                  >
                    No payment plan on this tower — pick one on Project → Plans. Booking proceeds
                    without automatic dues.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
                    <Field label="Payment plan" required>
                      <NativeSelect
                        className="input"
                        value={planId}
                        onChange={(e) => setPlanId(e.target.value)}
                        data-testid="wiz-plan"
                      >
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.is_default ? " (default)" : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <div className="card min-w-0 overflow-x-auto !p-4">
                      {plan && (
                        <>
                          <p className="mb-2 text-sm font-semibold text-ink-950">
                            Schedule — {plan.name}
                          </p>
                          <Suspense fallback={null}>
                            <SchedulePreview
                              plan={plan}
                              cash={cash}
                              account={account}
                              bookingDate={bookingDate}
                            />
                          </Suspense>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between rounded-xl bg-ink-950 px-4 py-3 text-warm-50">
                <span className="label !text-warm-200/80">Total final value</span>
                <span className="font-display text-2xl" data-testid="wiz-total-final">
                  {inr(breakdown?.total_final_value || total)}
                </span>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 grid gap-3 rounded-2xl border border-warm-200 p-4 sm:grid-cols-2">
                <Field label="Sales person">
                  <Select
                    options={people}
                    value={salesUserId || user?.id}
                    onChange={setSalesUserId}
                    allowAdd={false}
                    testId="wiz-sales-person"
                  />
                </Field>
                <Field label="Came from lead">
                  <p className="pt-2 text-sm text-ink-950" data-testid="wiz-lead-link">
                    {leadId
                      ? "Linked — the lead is marked Converted"
                      : "No lead (walk-in / direct)"}
                  </p>
                </Field>
              </div>
              <div>
                <KV
                  label="Flat"
                  value={`${flat?.flat_number} · ${flat?.flat_type_code} · ${num(flat?.saleable_sqft)} sq.ft`}
                />
                <KV
                  label="Customer"
                  value={`${customer?.full_name} (${customer?.customer_code})`}
                />
                <KV
                  label="Co-applicants"
                  value={
                    coApps
                      .filter((c) => c.name.trim())
                      .map((c) => c.name.trim())
                      .join(", ") || "None"
                  }
                />
                <KV label="Agreement" value={inr(total)} />
                <KV label="Cash / Account" value={`${inr(cash)} / ${inr(account)}`} />
              </div>
              <div>
                <KV
                  label="Charges"
                  value={
                    breakdown?.charges?.length
                      ? breakdown.charges.map((c) => c.name).join(", ")
                      : "None"
                  }
                />
                <KV label="Payment plan" value={plan?.name || "None"} />
                <KV
                  label="Parking"
                  value={
                    slots.length + ownSlots.length
                      ? `${plural(slots.length + ownSlots.length, "slot")}`
                      : "None"
                  }
                />
                <KV label="Total final value" value={inr(breakdown?.total_final_value || total)} />
                <Field label="Booking date" required>
                  <DateInput
                    value={bookingDate}
                    max={businessToday()}
                    onChange={(e) => setBookingDate(e.target.value)}
                    data-testid="wiz-date"
                  />
                </Field>
                <Field label="Remarks" className="mt-3">
                  <Input
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    data-testid="wiz-remarks"
                  />
                </Field>
              </div>
            </div>
          )}
          <div
            className="sticky bottom-0 z-20 -mx-5 mt-6 flex justify-between gap-3 border-t border-warm-100 bg-white/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6"
            data-testid="wiz-footer"
          >
            <Button
              type="button"
              variant="quiet"
              why={step === 0 ? "This is the first step" : undefined}
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
              data-testid="wiz-back"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            {step < 2 ? (
              <WhyDisabled reason={nextWhy} className="text-right" testId="wiz-next-why">
                <Button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setStep(step + 1)}
                  variant="primary"
                  data-testid="wiz-next"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </WhyDisabled>
            ) : (
              <Button
                type="button"
                disabled={busy}
                onClick={submit}
                variant="gold"
                data-testid="wiz-confirm"
              >
                <Check className="h-4 w-4" />
                {busy ? "Booking…" : "Book"}
              </Button>
            )}
          </div>
        </Card>
        <aside
          className="hidden lg:block lg:sticky lg:top-24 lg:self-start"
          data-testid="wiz-summary"
        >
          <Card className="!p-5 text-sm">
            <p className="label mb-3">Booking summary</p>
            <dl className="space-y-3">
              <SRow
                k="Flat"
                v={
                  flat
                    ? `${flat.flat_number} · ${(blocks?.items || []).find((b) => b.id === blockId)?.name || ""}`
                    : null
                }
              />
              <SRow k="Customer" v={customer?.full_name} sub={customer?.phone} />
              <SRow
                k="Agreement"
                v={total ? inr(total) : null}
                sub={total ? `Cash ${inr(cash)} · Account ${inr(account)}` : null}
                warn={total > 0 && !sumOk ? "Cash + Account ≠ total" : null}
              />
              <SRow k="Payment plan" v={plan?.name} />
              <SRow
                k="GST + charges"
                v={breakdown ? inr(Math.max((breakdown.total_final_value || 0) - total, 0)) : null}
              />
            </dl>
            <div className="mt-4 border-t border-warm-100 pt-4">
              <p className="label">Total final value</p>
              <p className="mt-1 font-display text-3xl text-ink-950" data-testid="wiz-grand-total">
                <Num s={inr(breakdown?.total_final_value || total)} />
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function SRow({ k, v, sub, warn }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold text-txt-secondary">{k}</dt>
      <dd className={cn("font-semibold leading-snug", v ? "text-ink-950" : "text-txt-muted")}>
        {v && String(v).startsWith("₹") ? (
          <Num s={v} className="font-display text-base" />
        ) : (
          v || "—"
        )}
      </dd>
      {sub && <dd className="text-xs text-txt-secondary">{sub}</dd>}
      {warn && <dd className="text-xs font-semibold text-brick">{warn}</dd>}
    </div>
  );
}
