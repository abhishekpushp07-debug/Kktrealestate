import { useEffect, useMemo, useState } from "react";
import { showNextStep } from "@/components/common/NextStep";
import { DateInput } from "@/components/common/DateInput";
import { TypedMasterInput } from "@/components/common/TypedMasterInput";
import { WhyDisabled } from "@/components/common/WhyDisabled";
import { AmountInput } from "@/components/common/AmountInput";
import { useNavigate, Link } from "react-router-dom";
import { CheckCircle2, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { FieldError, useFieldErrors } from "@/lib/formErrors";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useMasterOptions } from "@/hooks/useList";
import { cn } from "@/lib/utils";
import { fmtDate, inr } from "@/lib/format";
import { Field, Money, Num, Skeleton, StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Avatar, Segmented } from "@/components/v2/CustomerBits";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { QuickAddButton } from "@/components/common/QuickCreate";
import { Button } from "@/components/ui/button";
import { businessToday } from "@/lib/businessDay";

const today = () => businessToday();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const EMPTY_S = {};

function BookingPicker({ value, onChange, customerId }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  useEffect(() => {
    const t = setTimeout(
      () =>
        api
          .get("/bookings", {
            params: {
              search: q || undefined,
              status: "Active",
              page_size: 8,
              customer_id: customerId || undefined,
              include: "customer",
            },
          })
          .then((r) => setItems(r.data.items))
          .catch(() => {}),
      250,
    );
    return () => clearTimeout(t);
  }, [q, customerId]);
  if (value)
    return (
      <div className="card flex items-start gap-3 !p-4" data-testid="pp-booking-card">
        <Avatar name={value.customer_name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-950">
            {value.customer_name} · {value.booking_number}
          </p>
          <p className="truncate text-xs text-txt-secondary">
            {value.project_code} · {value.block_code} · {value.flat_snapshot?.flat_number}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            {[
              ["Cash due", value.summary?.cash_due_paise],
              ["Account due", value.summary?.account_due_paise],
              ["Other charges", value.summary?.other_charges_due_paise],
            ].map(([l, v]) => (
              <div key={l}>
                <p className="text-txt-muted">{l}</p>
                <Money
                  value={Math.max(v || 0, 0) / 100}
                  short
                  className={cn("text-sm", v > 0 ? "text-brick" : "text-sage")}
                />
              </div>
            ))}
          </div>
        </div>
        <Button
          type="button"
          onClick={() => onChange(null)}
          variant="quiet"
          size="compact"
          data-testid="pp-change-booking"
        >
          Change
        </Button>
      </div>
    );
  return (
    <div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" />
        <input
          autoFocus
          className="input !pl-10"
          placeholder="Customer name, phone, flat or booking no…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="pp-booking-search"
        />
      </label>
      <div className="mt-2 flex items-center gap-2 text-xs text-txt-muted">
        <QuickAddButton
          kind="customer"
          onCreated={(c) => {
            setQ(c.phone || c.full_name || "");
            toast.info("Customer created — a booking is needed before a payment can be posted");
          }}
          testId="pp-quick-add-customer"
        />
        <Link to="/bookings/new" className="btn btn-ghost btn-sm" data-testid="pp-new-booking-link">
          New booking →
        </Link>
        <span>A payment needs a booking; bookings are created in the wizard.</span>
      </div>
      <ul
        className="mt-2 max-h-64 divide-y divide-warm-100 overflow-y-auto rounded-xl border border-warm-200 bg-white"
        data-testid="pp-booking-results"
      >
        {items.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onChange(b)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-warm-50"
              data-testid={`pp-pick-${b.booking_number}`}
            >
              <Avatar name={b.customer_name} size={30} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">{b.customer_name}</p>
                <p className="truncate text-xs text-txt-secondary">
                  {b.booking_number} · {b.project_code} {b.flat_snapshot?.flat_number}
                </p>
              </div>
              <Money
                value={Math.max(b.summary?.due_paise || 0, 0) / 100}
                short
                className="text-sm text-brick"
              />
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-txt-muted">
            No active bookings match.
          </li>
        )}
      </ul>
    </div>
  );
}

export function PostPayment({ open, onOpenChange, bookingId, customerId, onPosted }) {
  const { user, can } = useAuth();
  const fe = useFieldErrors();
  const [serverErr, setServerErr] = useState(null);
  const nav = useNavigate();
  const [booking, setBooking] = useState(null);
  const [f, setF] = useState({
    against: "FLAT_VALUE",
    payment_category: "Cash",
    other_charge_line_id: null,
    payment_mode_id: null,
    bank_account_id: null,
    inst_bank: "",
    number: "",
    inst_date: "",
    amount: "",
    payment_date: today(),
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [key, setKey] = useState(uuid);
  const [manual, setManual] = useState(false);
  const [note, setNote] = useState(false); // Remarks (since Phase 1) tucked behind "+ add note": the sheet shows the 5 fields
  const [preview, setPreview] = useState(null);
  const { options: modes } = useMasterOptions("payment-modes", (m) => ({
    value: m.id,
    label: m.name,
    sub: m.requires_reference ? "ref. required" : undefined,
    code: m.code,
    requires_reference: m.requires_reference,
  }));
  const { options: banks } = useMasterOptions("bank-accounts", (b) => ({
    value: b.id,
    label: `${b.bank_name} ${b.account_number_masked || ""}`,
    sub: b.ifsc,
    is_default: b.is_default,
  }));
  const { data: pre } = useFetch(bookingId ? `/bookings/${bookingId}` : null);
  useEffect(() => {
    if (pre) setBooking(pre);
  }, [pre]);
  useEffect(() => {
    if (open) {
      setDone(null);
      setManual(false);
      setKey(uuid());
      setF((p) => ({ ...p, amount: "", number: "", remarks: "" }));
    }
  }, [open]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const mode = modes.find((m) => m.value === f.payment_mode_id);
  const isCash = mode?.code === "CASH";
  const needsInst =
    mode &&
    !isCash &&
    (mode.requires_reference ||
      ["CHEQUE", "DD", "NEFT", "RTGS", "IMPS", "UPI"].includes(mode.code));
  const s = booking?.summary || EMPTY_S;
  const defaultBank = (banks.find((b) => b.is_default) || banks[0])?.value;
  useEffect(() => {
    if (defaultBank) setF((p) => (p.bank_account_id ? p : { ...p, bank_account_id: defaultBank }));
  }, [defaultBank]);
  useEffect(() => {
    if (!f.payment_mode_id || manual) return;
    const cat = isCash ? "Cash" : "Account";
    setF((p) => {
      // demanded other charges are Account share: auto allocation settles them with an Account payment
      const due = Math.max(
        (cat === "Cash" ? s.cash_due : (s.account_due || 0) + (s.other_charges_due || 0)) || 0,
        0,
      );
      const amount = p.payment_category === cat && p.amount ? p.amount : due ? String(due) : "";
      if (p.against === "FLAT_VALUE" && p.payment_category === cat && p.amount === amount) return p;
      return { ...p, against: "FLAT_VALUE", payment_category: cat, amount };
    });
  }, [f.payment_mode_id, isCash, manual, s.cash_due, s.account_due, s.other_charges_due]);
  const amtForPreview = Number(f.amount) || 0;
  useEffect(() => {
    if (manual || !booking?.id || !f.payment_mode_id || !amtForPreview) {
      setPreview(null);
      return;
    }
    const t = setTimeout(
      () =>
        api
          .post("/payments/allocation-preview", {
            booking_id: booking.id,
            amount: amtForPreview,
            payment_mode_id: f.payment_mode_id,
          })
          .then((r) => setPreview(r.data))
          .catch(() => setPreview(null)),
      250,
    );
    return () => clearTimeout(t);
  }, [manual, booking?.id, f.payment_mode_id, amtForPreview]);
  const cap = useMemo(() => {
    if (!booking) return null;
    if (f.against === "OTHER_CHARGE") {
      const l = (booking.other_charges || []).find((x) => x.line_id === f.other_charge_line_id);
      return l
        ? { agreed: l.total, received: l.paid, room: l.total - l.paid, label: l.name }
        : null;
    }
    const agreed = f.payment_category === "Cash" ? booking.cash_agreed : booking.account_agreed,
      received = f.payment_category === "Cash" ? s.cash_paid : s.account_paid;
    return {
      agreed,
      received,
      room: agreed - received,
      label: `${f.payment_category} share`,
      due: Math.max(f.payment_category === "Cash" ? s.cash_due : s.account_due, 0),
    };
  }, [booking, f.against, f.payment_category, f.other_charge_line_id, s]);
  const amt = Number(f.amount) || 0;
  const over = manual && cap && amt > cap.room;
  const payWhy = !f.payment_mode_id
    ? "Choose how the money came in"
    : !amt
      ? "Enter the amount"
      : over
        ? "The amount is more than what is open on this booking"
        : !isCash && !f.bank_account_id
          ? "Pick the bank account the money went into"
          : mode?.requires_reference && !f.number.trim()
            ? `Enter the ${mode.name || "instrument"} reference number`
            : null;
  const submit = async (e) => {
    e.preventDefault();
    if (!booking || over || payWhy) return;
    setBusy(true);
    try {
      const body = {
        booking_id: booking.id,
        against: f.against,
        payment_category: f.against === "FLAT_VALUE" ? f.payment_category : null,
        other_charge_line_id: f.against === "OTHER_CHARGE" ? f.other_charge_line_id : null,
        allocation: manual ? "manual" : "auto",
        amount: amt,
        payment_date: f.payment_date,
        payment_mode_id: f.payment_mode_id,
        bank_account_id: isCash ? null : f.bank_account_id,
        remarks: f.remarks || null,
        instrument: isCash
          ? null
          : {
              number: f.number || null,
              date: f.inst_date || null,
              bank_name: f.inst_bank?.trim() || null,
            },
      };
      const r = await api.post("/payments", body, { headers: { "Idempotency-Key": key } });
      setDone(r.data);
      onPosted?.(r.data);
      showNextStep({
        title: `Receipt ${r.data.receipt_number} saved`,
        actions: [{ label: "Print / share receipt", to: `/print/receipt/${r.data.id}` }],
      });
    } catch (err) {
      const m = errMsg(err);
      fe.capture(err);
      setServerErr(/cap|exceed|Revise agreement/i.test(m) ? m.split(" — ")[0] : null);
      toast.error(m, {
        duration: 10000,
        action:
          can("sales.agreement.revise") && /Revise agreement/i.test(m)
            ? {
                label: "Revise agreement",
                onClick: () => {
                  onOpenChange(false);
                  nav(`/bookings/${booking.id}?revise=1`);
                },
              }
            : undefined,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-xl"
        data-testid="post-payment-sheet"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Record payment</SheetTitle>
          <SheetDescription>
            Only cleared money counts toward dues. Cheques and DDs wait in hand until realised.
          </SheetDescription>
        </SheetHeader>
        {done ? (
          <div className="mt-8 space-y-6 text-center" data-testid="pp-success">
            <span className="icon-tile sage mx-auto h-16 w-16 rounded-2xl">
              <CheckCircle2 className="!h-8 !w-8" />
            </span>
            {done.warnings?.length > 0 && (
              <div
                role="status"
                data-testid="pp-headroom-warning"
                className="rounded-xl border border-amber/40 bg-amber2-50 px-4 py-3 text-left text-sm text-amber"
              >
                <p className="font-semibold">Pending instruments exceed the agreed amount</p>
                {done.warnings.map((w) => (
                  <p key={w.code} className="mt-1">
                    {w.message}
                  </p>
                ))}
              </div>
            )}
            <div>
              <p className="label">
                {done.status === "Pending" ? "Recorded · cheque in hand" : "Posted"}
              </p>
              <p className="mt-2 font-display text-4xl text-ink-950">
                <Num s={inr(done.amount)} />
              </p>
              <p
                className="mt-2 font-mono text-sm text-txt-secondary"
                data-testid="pp-receipt-number"
              >
                {done.receipt_number}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                onClick={() => window.open(`${BASE_PATH}/print/receipt/${done.id}`, "_blank")}
                variant="primary"
                data-testid="pp-print"
              >
                <Printer className="h-4 w-4" />
                Print / share receipt
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setDone(null);
                  setKey(uuid());
                  setF((p) => ({ ...p, amount: "", number: "", remarks: "" }));
                }}
                variant="soft"
                data-testid="pp-another"
              >
                Post another
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-6">
            <div>
              <p className="label !normal-case !tracking-normal !text-txt-secondary">
                Booking <span className="text-brick">*</span>
              </p>
              <div className="mt-1.5">
                <BookingPicker
                  value={booking}
                  onChange={(b) => {
                    setBooking(b);
                    set("other_charge_line_id", null);
                  }}
                  customerId={customerId}
                />
              </div>
            </div>
            {booking && (
              <>
                {manual ? (
                  <>
                    <Field label="Against">
                      <Segmented
                        options={[
                          { value: "FLAT_VALUE", label: "Flat value" },
                          { value: "OTHER_CHARGE", label: "Other charge" },
                        ]}
                        value={f.against}
                        onChange={(v) => set("against", v)}
                        testId="pp-against"
                      />
                    </Field>
                    {f.against === "FLAT_VALUE" ? (
                      <Field label="Owner share">
                        <Segmented
                          options={[
                            {
                              value: "Cash",
                              label: "Cash",
                              hint: inr(Math.max(s.cash_due || 0, 0)),
                            },
                            {
                              value: "Account",
                              label: "Account",
                              hint: inr(Math.max(s.account_due || 0, 0)),
                            },
                          ]}
                          value={f.payment_category}
                          onChange={(v) => set("payment_category", v)}
                          testId="pp-category"
                        />
                      </Field>
                    ) : (
                      <Field label="Charge line" required>
                        <Select
                          options={(booking.other_charges || []).map((l) => ({
                            value: l.line_id,
                            label: l.name,
                            sub: `${inr(l.total - l.paid)} due`,
                          }))}
                          value={f.other_charge_line_id}
                          onChange={(v) => set("other_charge_line_id", v)}
                          allowAdd={false}
                          testId="pp-charge-line"
                        />
                      </Field>
                    )}
                  </>
                ) : (
                  f.payment_mode_id && (
                    <div
                      className="rounded-xl bg-white px-4 py-2.5 text-xs text-txt-secondary ring-1 ring-warm-200"
                      data-testid="pp-auto-allocation"
                    >
                      <p>
                        Will apply to <b className="text-ink-950">oldest open bills first</b> (
                        {f.payment_category} share for instalments) · open bills{" "}
                        <b className="text-ink-950">
                          <Num
                            s={inr(
                              preview
                                ? preview.open_total_paise / 100
                                : Math.max(s.cash_due || 0, 0) +
                                    Math.max(s.account_due || 0, 0) +
                                    Math.max(s.other_charges_due || 0, 0),
                            )}
                          />
                        </b>{" "}
                        <button
                          type="button"
                          className="ml-1 font-semibold underline underline-offset-2"
                          onClick={() => setManual(true)}
                          data-testid="pp-allocation-change"
                        >
                          Change
                        </button>
                      </p>
                      {preview && (
                        <ul className="mt-2 space-y-0.5" data-testid="pp-allocation-list">
                          {preview.allocations.map((a) => (
                            <li
                              key={a.demand_id || a.line_id || a.kind}
                              className="flex justify-between gap-3"
                            >
                              <span className={a.kind === "ADVANCE" ? "text-amber2" : ""}>
                                {a.demand_number ? `${a.demand_number} · ` : ""}
                                {a.name}
                                {a.due_date ? ` · due ${fmtDate(a.due_date)}` : ""}
                              </span>
                              <b className="text-ink-950">
                                <Num s={inr(a.amount_paise / 100)} />
                              </b>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                )}
                {manual && cap && (
                  <p
                    className={cn(
                      "rounded-xl px-4 py-2.5 text-xs ring-1",
                      over
                        ? "bg-brick-50 text-brick ring-brick/30"
                        : "bg-white text-txt-secondary ring-warm-200",
                    )}
                    data-testid="pp-cap"
                  >
                    {over ? (
                      <>
                        {cap.label} agreed <Num s={inr(cap.agreed)} />; already received{" "}
                        <Num s={inr(cap.received)} />; cannot accept <Num s={inr(amt)} />. Revise
                        agreement first.
                        {can("sales.agreement.revise") && f.against === "FLAT_VALUE" && (
                          <>
                            {" "}
                            <Link
                              to={`/bookings/${booking.id}?revise=1`}
                              className="ml-1 font-semibold underline underline-offset-2"
                              data-testid="pp-revise-link"
                            >
                              Revise agreement →
                            </Link>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {cap.label}: agreed <Num s={inr(cap.agreed)} /> · received{" "}
                        <Num s={inr(cap.received)} />
                        {cap.due != null && (
                          <>
                            {" "}
                            · due now{" "}
                            <b className="text-ink-950">
                              <Num s={inr(cap.due)} />
                            </b>
                          </>
                        )}{" "}
                        · can accept up to{" "}
                        <b className="text-ink-950">
                          <Num s={inr(cap.room)} />
                        </b>
                      </>
                    )}
                  </p>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Amount (₹)"
                    required
                    hint={
                      manual
                        ? cap && !over
                          ? `Can accept up to ${inr(cap.room)}`
                          : undefined
                        : preview?.open_total_paise
                          ? `Open now ${inr(preview.open_total_paise / 100)} · settled oldest first`
                          : undefined
                    }
                    error={
                      over
                        ? `${cap.label} agreed ${inr(cap.agreed)}; already received ${inr(cap.received)}; cannot accept ${inr(amt)}. Revise agreement first.`
                        : null
                    }
                  >
                    <AmountInput
                      className={cn("input font-display text-lg", over && "!border-brick")}
                      value={f.amount}
                      onChange={(e) => set("amount", e.target.value)}
                      required
                      data-testid="pp-amount"
                    />
                    <FieldError
                      name="amount"
                      fields={{
                        ...fe.fields,
                        amount: fe.fields.amount || fe.fields.amount_paise || serverErr,
                      }}
                    />
                    <p
                      className="mt-1.5 font-display text-2xl text-ink-950"
                      data-testid="pp-preview"
                    >
                      <Num s={inr(amt)} />
                    </p>
                  </Field>
                  <div className="space-y-4">
                    <Field label="Date" required>
                      <DateInput
                        className="input"
                        value={f.payment_date}
                        max={today()}
                        min={booking.booking_date}
                        onChange={(e) => set("payment_date", e.target.value)}
                        data-testid="pp-date"
                      />
                    </Field>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2" data-testid="pp-mode-row">
                  <Field label="Mode" required>
                    <Select
                      options={modes}
                      value={f.payment_mode_id}
                      onChange={(v) => set("payment_mode_id", v)}
                      allowAdd={false}
                      testId="pp-mode"
                    />
                  </Field>
                  {!isCash && f.payment_mode_id && (
                    <Field label="Bank account" required>
                      <Select
                        options={banks}
                        value={f.bank_account_id}
                        onChange={(v) => set("bank_account_id", v)}
                        allowAdd={false}
                        testId="pp-bank"
                      />
                    </Field>
                  )}
                </div>
                {needsInst && (
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field label="Drawn on bank">
                      <TypedMasterInput
                        list="bank"
                        value={f.inst_bank}
                        onChange={(v) => set("inst_bank", v)}
                        placeholder="Bank name"
                        testId="pp-inst-bank"
                      />
                    </Field>
                    <Field
                      label={mode?.requires_reference ? "Instrument / UTR no." : "Reference"}
                      required={mode?.requires_reference}
                    >
                      <input
                        className="input"
                        value={f.number}
                        onChange={(e) => set("number", e.target.value)}
                        data-testid="pp-instrument"
                      />
                    </Field>
                    <Field label="Instrument date">
                      <DateInput
                        className="input"
                        value={f.inst_date}
                        onChange={(e) => set("inst_date", e.target.value)}
                        data-testid="pp-inst-date"
                      />
                    </Field>
                  </div>
                )}
                {note || f.remarks ? (
                  <Field label="Remarks">
                    <input
                      className="input"
                      value={f.remarks}
                      onChange={(e) => set("remarks", e.target.value)}
                      autoFocus={!f.remarks}
                      data-testid="pp-remarks"
                    />
                  </Field>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-semibold text-sapphire hover:underline"
                    onClick={() => setNote(true)}
                    data-testid="pp-add-note"
                  >
                    + add note
                  </button>
                )}
                {(mode?.code === "CHEQUE" || mode?.code === "DD") && (
                  <p className="rounded-xl bg-amber2-50 px-4 py-2.5 text-xs text-amber2">
                    Recorded as <b>Pending</b> until realised. Clear or bounce it from Payments →
                    Cheques.
                  </p>
                )}
                <WhyDisabled reason={payWhy} className="block" testId="pp-why">
                  <Button
                    type="submit"
                    disabled={busy || !!payWhy}
                    variant="primary"
                    className="w-full"
                    data-testid="pp-submit"
                  >
                    {busy ? "Recording…" : "Record payment"}
                  </Button>
                </WhyDisabled>
              </>
            )}
          </form>
        )}
        <span className="hidden">
          <StatusPill status="Cleared" />
          <Skeleton />
        </span>
      </SheetContent>
    </Sheet>
  );
}
