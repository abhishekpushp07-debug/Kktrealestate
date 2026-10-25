import { Download, IndianRupee, Printer, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PAYMENT_BUCKET_LABELS, PaymentCreateSchema, type BookingDetailResponse, type BookingRow, type PaymentAgainst, type PaymentBucket, type PaymentCreate, type PaymentModeRow, type PaymentRow } from "@kkt/contracts";
import { z } from "zod";
import { applyServerErrors, Badge, Button, Combobox, DateInput, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FormError, FormField, FormRow, Input, MoneyInput, RadioGroup, Select, Skeleton, Textarea, type ComboboxOption } from "@/components/ui";
import { describeError, isApiClientError, type ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { amountInWords, formatDate, formatINR, formatINRShort, formatPercent, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { bookingInvalidations, searchBookings, useBookingDetail } from "@/features/bookings/api";
import { DueAmount, UnitLabel } from "@/features/bookings/components";
import { controlOf, Notice } from "@/features/inventory/components";
import { contractResolver } from "@/features/shared/contractResolver";
import { bankAccountLabel, PAYMENT_INVALIDATIONS, paymentFromPostResponse, postPayment, useBankAccounts, usePaymentModes, useReceipt } from "./api";
import { openReceiptPrint } from "./PaymentActions";
import { bucketMeter, checkBucketCap, checkChargeCap, modeRules, type BucketMeter } from "./paymentMath";
import { ReceiptView } from "./ReceiptView";
import { downloadPdf } from "@/features/bookings/api";

/* ------------------------------------------------------------------ */
/* Form values & schema                                                 */
/* ------------------------------------------------------------------ */

export interface PaymentFormValues {
  against: PaymentAgainst;
  bucket: PaymentBucket | null;
  other_charge_id: string | null;
  amount_paise: number | null;
  payment_date: string;
  payment_mode_id: string | null;
  instrument_number: string;
  instrument_date: string | null;
  instrument_bank: string;
  instrument_branch: string;
  bank_account_id: string | null;
  remarks: string;
}

interface SchemaContext {
  bookingId: string | null;
  bookingDate: string | null;
  today: string;
  modeById: ReadonlyMap<string, Pick<PaymentModeRow, "code" | "requires_instrument" | "clears_immediately" | "is_cash">>;
}

const nullable = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** UI values → `PaymentCreate`, layering the date, instrument and bank-account rules the service enforces. */
function buildPaymentSchema(context: SchemaContext) {
  return z
    .looseObject({})
    .transform((raw, ctx): unknown => {
      const values = raw as unknown as PaymentFormValues;
      const mode = values.payment_mode_id ? context.modeById.get(values.payment_mode_id) : undefined;
      const rules = modeRules(mode ?? null);
      if (!context.bookingId) ctx.addIssue({ code: "custom", message: "Pick the booking", path: ["booking_id"] });
      if (!values.payment_mode_id) ctx.addIssue({ code: "custom", message: "Pick the payment mode", path: ["payment_mode_id"] });
      if (!values.payment_date) ctx.addIssue({ code: "custom", message: "Enter the payment date", path: ["payment_date"] });
      else {
        if (values.payment_date > context.today) ctx.addIssue({ code: "custom", message: "Payment date cannot be in the future", path: ["payment_date"] });
        if (context.bookingDate && values.payment_date < context.bookingDate) ctx.addIssue({ code: "custom", message: `Payment date cannot be before the booking date (${formatDate(context.bookingDate)})`, path: ["payment_date"] });
      }
      if (values.amount_paise === null || values.amount_paise <= 0) ctx.addIssue({ code: "custom", message: "Enter an amount greater than zero", path: ["amount_paise"] });
      if (rules.requiresInstrument && values.instrument_number.trim() === "") ctx.addIssue({ code: "custom", message: "Reference / instrument number is required for this mode", path: ["instrument_number"] });
      if (rules.hasInstrumentDate && !values.instrument_date) ctx.addIssue({ code: "custom", message: "Instrument date is required", path: ["instrument_date"] });
      if (rules.requiresBankAccount && !values.bank_account_id) ctx.addIssue({ code: "custom", message: "Pick the company bank account credited", path: ["bank_account_id"] });
      const instrument = rules.requiresInstrument
        ? { number: values.instrument_number.trim(), date: values.instrument_date ?? null, bank_name: nullable(values.instrument_bank), branch: nullable(values.instrument_branch) }
        : null;
      return {
        booking_id: context.bookingId ?? "",
        against: values.against,
        bucket: values.against === "FLAT_VALUE" ? values.bucket : null,
        other_charge_id: values.against === "OTHER_CHARGE" ? values.other_charge_id : null,
        amount_paise: values.amount_paise ?? 0,
        payment_date: values.payment_date,
        payment_mode_id: values.payment_mode_id ?? "",
        instrument,
        bank_account_id: rules.requiresBankAccount ? values.bank_account_id : null,
        remarks: nullable(values.remarks),
      };
    })
    .pipe(PaymentCreateSchema);
}

function defaultValues(seed: Partial<PaymentFormValues> = {}): PaymentFormValues {
  return {
    against: "FLAT_VALUE",
    bucket: "CASH",
    other_charge_id: null,
    amount_paise: null,
    payment_date: todayIST(),
    payment_mode_id: null,
    instrument_number: "",
    instrument_date: null,
    instrument_bank: "",
    instrument_branch: "",
    bank_account_id: null,
    remarks: "",
    ...seed,
  };
}

/* ------------------------------------------------------------------ */
/* Dialog                                                               */
/* ------------------------------------------------------------------ */

export interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled booking (detail page). When omitted the dialog offers a booking search. */
  booking?: BookingRow | BookingDetailResponse | null;
  defaultAgainst?: PaymentAgainst;
  defaultBucket?: PaymentBucket | null;
  defaultOtherChargeId?: string | null;
  onPosted?: (payment: PaymentRow) => void;
}

type Phase = { kind: "form" } | { kind: "receipt"; payment: PaymentRow };

/** Post a payment against a booking (flat value bucket or other-charge line) and show the receipt on success. */
export function PaymentDialog({ open, onOpenChange, booking: prefilled, defaultAgainst = "FLAT_VALUE", defaultBucket = "CASH", defaultOtherChargeId = null, onPosted }: PaymentDialogProps) {
  const { can } = useAuth();
  const today = todayIST();
  const [bookingId, setBookingId] = useState<string | null>(prefilled?.id ?? null);
  const [bookingLabel, setBookingLabel] = useState<string | undefined>(prefilled ? `${prefilled.booking_number} · ${prefilled.customer_name}` : undefined);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [serverError, setServerError] = useState<unknown>(null);
  const [capError, setCapError] = useState<ApiClientError | null>(null);
  const idempotency = useRef<{ key: string; body: string } | null>(null);

  const modes = usePaymentModes(open);
  const banks = useBankAccounts(open);
  const prefilledDetail = prefilled && "other_charges" in prefilled ? prefilled : null;
  const detailQuery = useBookingDetail(open && bookingId && !prefilledDetail ? bookingId : null);
  const booking: BookingDetailResponse | BookingRow | null = prefilledDetail ?? detailQuery.data ?? (prefilled && prefilled.id === bookingId ? prefilled : null);
  const otherCharges = booking && "other_charges" in booking ? booking.other_charges : [];

  const modeById = useMemo(() => new Map((modes.data ?? []).map((mode) => [mode.id, mode] as const)), [modes.data]);
  const schema = useMemo(() => buildPaymentSchema({ bookingId, bookingDate: booking?.booking_date ?? null, today, modeById }), [bookingId, booking?.booking_date, today, modeById]);
  const resolver = useMemo(() => contractResolver<PaymentFormValues, PaymentCreate>(schema), [schema]);
  const form = useForm<PaymentFormValues, unknown, PaymentCreate>({ resolver, defaultValues: defaultValues({ against: defaultAgainst, bucket: defaultBucket, other_charge_id: defaultOtherChargeId }), mode: "onTouched" });
  const control = controlOf(form);

  // Reset whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setPhase({ kind: "form" });
    setServerError(null);
    setCapError(null);
    idempotency.current = null;
    setBookingId(prefilled?.id ?? null);
    setBookingLabel(prefilled ? `${prefilled.booking_number} · ${prefilled.customer_name}` : undefined);
    form.reset(defaultValues({ against: defaultAgainst, bucket: defaultBucket, other_charge_id: defaultOtherChargeId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefilled?.id]);

  // Default the bank account to the company default once accounts load.
  const defaultBank = useMemo(() => (banks.data ?? []).find((account) => account.is_default) ?? banks.data?.[0] ?? null, [banks.data]);
  useEffect(() => {
    if (!open || !defaultBank) return;
    if (!form.getValues("bank_account_id")) form.setValue("bank_account_id", defaultBank.id);
  }, [open, defaultBank, form]);

  const against = form.watch("against");
  const bucket = form.watch("bucket");
  const otherChargeId = form.watch("other_charge_id");
  const amount = form.watch("amount_paise");
  const modeId = form.watch("payment_mode_id");
  const selectedMode = modeId ? (modeById.get(modeId) ?? null) : null;
  const rules = modeRules(selectedMode);

  const meter: BucketMeter | null = booking && against === "FLAT_VALUE" && bucket ? bucketMeter(bucket, bucket === "CASH" ? booking.summary.cash : booking.summary.account) : null;
  const bucketCap = meter ? checkBucketCap(meter, amount, `${PAYMENT_BUCKET_LABELS[meter.bucket]} agreed`) : null;
  const selectedCharge = otherCharges.find((line) => line.id === otherChargeId) ?? null;
  const chargeCap = selectedCharge ? checkChargeCap(selectedCharge.total_paise, selectedCharge.paid_paise, amount) : null;

  const post = useMutationWithToast<PaymentRow, PaymentCreate>({
    mutationFn: async (body) => {
      const serialised = JSON.stringify(body);
      if (!idempotency.current || idempotency.current.body !== serialised) idempotency.current = { key: crypto.randomUUID(), body: serialised };
      const response = await postPayment(body, idempotency.current.key);
      return paymentFromPostResponse(response);
    },
    successMessage: (payment) => `Receipt ${payment.receipt_number} — ${formatINR(payment.amount_paise)} ${payment.status === "PENDING" ? "received (pending clearance)" : "received"}`,
    errorMessage: false,
    invalidate: [...PAYMENT_INVALIDATIONS, ...(bookingId ? bookingInvalidations(bookingId) : [])],
    onSuccess: (payment) => {
      idempotency.current = null;
      setPhase({ kind: "receipt", payment });
      onPosted?.(payment);
    },
    onError: (error) => {
      if (error.status === 409 && (error.code === "BUCKET_CAP_EXCEEDED" || error.code === "CHARGE_CAP_EXCEEDED")) {
        setCapError(error);
        return;
      }
      if (!applyServerErrors(error, form.setError)) setServerError(error);
    },
  });

  const submit = form.handleSubmit(
    (body) => {
      setServerError(null);
      setCapError(null);
      post.mutate(body);
    },
    () => setServerError(null),
  );

  const searchOptions = useCallback(async (query: string): Promise<ComboboxOption[]> => {
    const rows = await searchBookings(query);
    return rows.map((row) => ({ value: row.id, label: `${row.booking_number} · ${row.customer_name}`, description: `${row.project_name} · ${row.block_name} · ${row.flat_number} · due ${formatINRShort(row.summary.total_due_paise)}`, keywords: [row.customer_phone, row.flat_number, row.customer_name] }));
  }, []);

  const bookingMissingError = form.formState.errors.booking_id?.message;
  const postAnother = () => {
    setPhase({ kind: "form" });
    setServerError(null);
    setCapError(null);
    form.reset(defaultValues({ against, bucket, payment_date: form.getValues("payment_date"), payment_mode_id: modeId, bank_account_id: form.getValues("bank_account_id") }));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !post.isPending && onOpenChange(next)}>
      <DialogContent size="lg" data-testid="payment-dialog">
        {phase.kind === "form" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex min-h-0 flex-1 flex-col"
            noValidate
          >
            <DialogHeader>
              <DialogTitle>Post payment</DialogTitle>
              <DialogDescription>Only cleared money counts towards paid. Cheques and DDs stay pending until cleared.</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              {/* Booking */}
              {prefilled ? (
                <BookingBanner booking={booking ?? prefilled} />
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-muted" htmlFor="payment-booking">
                    Booking <span className="text-danger">*</span>
                  </label>
                  <Combobox
                    id="payment-booking"
                    value={bookingId}
                    selectedLabel={bookingLabel}
                    onValueChange={(value, option) => {
                      setBookingId(value);
                      setBookingLabel(option?.label);
                      form.clearErrors("booking_id");
                      form.setValue("other_charge_id", null);
                    }}
                    onSearch={searchOptions}
                    placeholder="Search by booking number, customer or phone…"
                    searchPlaceholder="Booking no., customer, phone, flat…"
                    emptyText="No active bookings match"
                    invalid={Boolean(bookingMissingError)}
                    data-testid="payment-booking-search"
                  />
                  {bookingMissingError && <p className="text-xs font-medium text-danger-fg">{bookingMissingError}</p>}
                  {bookingId && (detailQuery.isPending ? <Skeleton className="h-16" /> : booking ? <BookingBanner booking={booking} /> : null)}
                </div>
              )}

              {/* Against */}
              <FormField
                control={control}
                name="against"
                label="Against"
                required
                render={({ field }) => (
                  <RadioGroup<PaymentAgainst>
                    inline
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      if (value === "FLAT_VALUE" && !form.getValues("bucket")) form.setValue("bucket", "CASH");
                    }}
                    options={[
                      { value: "FLAT_VALUE", label: "Flat value", description: "Cash or Account bucket of the agreement" },
                      { value: "OTHER_CHARGE", label: "Other charge", description: otherCharges.length ? `${otherCharges.length} line${otherCharges.length === 1 ? "" : "s"} on this booking` : "Registry, maintenance, GST…", disabled: Boolean(booking) && otherCharges.length === 0 },
                    ]}
                  />
                )}
              />

              {against === "FLAT_VALUE" ? (
                <div className="space-y-3">
                  <FormField
                    control={control}
                    name="bucket"
                    label="Bucket"
                    required
                    render={({ field }) => (
                      <RadioGroup<PaymentBucket>
                        inline
                        cards
                        value={field.value}
                        onValueChange={field.onChange}
                        options={(["CASH", "ACCOUNT"] as const).map((value) => {
                          const summary = booking ? (value === "CASH" ? booking.summary.cash : booking.summary.account) : null;
                          return {
                            value,
                            label: PAYMENT_BUCKET_LABELS[value],
                            description: summary ? `Remaining ${formatINRShort(Math.max(0, summary.agreed_paise - summary.paid_paise))} of ${formatINRShort(summary.agreed_paise)}` : undefined,
                          };
                        })}
                      />
                    )}
                  />
                  {meter && <BucketMeterBar meter={meter} />}
                </div>
              ) : (
                <FormField
                  control={control}
                  name="other_charge_id"
                  label="Charge line"
                  required
                  render={({ field }) => (
                    <Select
                      id={field.id}
                      value={field.value}
                      onValueChange={field.onChange}
                      invalid={field.invalid}
                      placeholder={booking ? "Choose the charge line" : "Pick a booking first"}
                      disabled={!booking}
                      options={otherCharges.map((line) => ({ value: line.id, label: `${line.name} — ${formatINR(line.total_paise)}`, description: `Paid ${formatINR(line.paid_paise)} · remaining ${formatINR(Math.max(0, line.total_paise - line.paid_paise))}${line.demanded_at ? "" : " · not yet demanded"}` }))}
                    />
                  )}
                />
              )}

              <FormRow columns={2}>
                <FormField
                  control={control}
                  name="amount_paise"
                  label="Amount"
                  required
                  hint={amount && amount > 0 ? amountInWords(amount) : "Rupees; shorthand like 5L or 1.2cr works"}
                  render={({ field }) => <MoneyInput id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={field.invalid} aria-describedby={field["aria-describedby"]} autoFocus={Boolean(prefilled)} data-testid="payment-amount" />}
                />
                <FormField
                  control={control}
                  name="payment_date"
                  label="Payment date"
                  required
                  hint={booking ? `Between ${formatDate(booking.booking_date)} and today` : "Not after today"}
                  render={({ field }) => <DateInput id={field.id} value={field.value} onChange={(value) => field.onChange(value ?? "")} min={booking?.booking_date} max={today} invalid={field.invalid} />}
                />
              </FormRow>

              {bucketCap?.exceeded && (
                <Notice tone="warning">
                  <span className="font-semibold">Over the bucket cap by {formatINR(bucketCap.excess_paise)}.</span> {bucketCap.message} The server will reject this posting unless the agreement is revised first.
                </Notice>
              )}
              {chargeCap?.exceeded && <Notice tone="warning">{chargeCap.message}</Notice>}

              <FormRow columns={2}>
                <FormField
                  control={control}
                  name="payment_mode_id"
                  label="Mode"
                  required
                  render={({ field }) => (
                    <Select
                      id={field.id}
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        const mode = value ? modeById.get(value) : undefined;
                        if (mode && modeRules(mode).isCash) form.setValue("bank_account_id", null);
                        else if (!form.getValues("bank_account_id") && defaultBank) form.setValue("bank_account_id", defaultBank.id);
                      }}
                      invalid={field.invalid}
                      placeholder={modes.isPending ? "Loading modes…" : "Choose mode"}
                      options={(modes.data ?? []).map((mode) => ({ value: mode.id, label: mode.name, description: modeRules(mode).clearsImmediately ? "Clears immediately" : "Pending until cleared" }))}
                      data-testid="payment-mode"
                    />
                  )}
                />
                {rules.requiresBankAccount && (
                  <FormField
                    control={control}
                    name="bank_account_id"
                    label="Credited to (company account)"
                    required
                    render={({ field }) => <Select id={field.id} value={field.value} onValueChange={field.onChange} invalid={field.invalid} placeholder={banks.isPending ? "Loading accounts…" : "Choose bank account"} options={(banks.data ?? []).map((account) => ({ value: account.id, label: bankAccountLabel(account), description: account.account_name }))} data-testid="payment-bank-account" />}
                  />
                )}
              </FormRow>

              {rules.requiresInstrument && (
                <div className="space-y-3 rounded-md border border-border bg-surface/60 p-3">
                  <p className="text-xs font-semibold text-ink-muted">{selectedMode?.code === "CHEQUE" ? "Cheque details" : selectedMode?.code === "DD" ? "Demand draft details" : "Reference details"}</p>
                  <FormRow columns={2}>
                    <FormField control={control} name="instrument_number" label={rules.hasInstrumentDate ? "Instrument number" : "Reference / UTR"} required render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={field.invalid} maxLength={40} className="money" data-testid="payment-instrument-number" />} />
                    {rules.hasInstrumentDate ? (
                      <FormField control={control} name="instrument_date" label="Instrument date" required render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} invalid={field.invalid} />} />
                    ) : (
                      <FormField control={control} name="instrument_date" label="Transaction date" render={({ field }) => <DateInput id={field.id} value={field.value} onChange={field.onChange} invalid={field.invalid} max={today} />} />
                    )}
                    <FormField control={control} name="instrument_bank" label="Drawn on (bank)" render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} maxLength={120} />} />
                    <FormField control={control} name="instrument_branch" label="Branch" render={({ field }) => <Input id={field.id} value={field.value} onChange={field.onChange} maxLength={120} />} />
                  </FormRow>
                  {!rules.clearsImmediately && <p className="text-xs text-ink-subtle">This receipt will be marked “subject to realisation” and counts only after it is cleared.</p>}
                </div>
              )}

              <FormField control={control} name="remarks" label="Remarks" render={({ field }) => <Textarea id={field.id} value={field.value} onChange={field.onChange} rows={2} maxLength={1000} placeholder="Token money, part payment for…" />} />

              {capError && (
                <div role="alert" className="space-y-2 rounded-md border border-danger/40 bg-danger-bg p-3 text-sm text-danger-fg" data-testid="payment-cap-error">
                  <p className="font-semibold">{capError.message}</p>
                  <CapDetails details={capError.details} />
                  {capError.code === "BUCKET_CAP_EXCEEDED" && can("agreement.edit") && bookingId && (
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/bookings/${bookingId}?tab=overview&action=revise`} onClick={() => onOpenChange(false)}>
                        Revise agreement
                      </Link>
                    </Button>
                  )}
                </div>
              )}
              <FormError error={serverError} />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={post.isPending}>
                Cancel
              </Button>
              <Button type="submit" leftIcon={IndianRupee} loading={post.isPending} disabled={!bookingId} data-testid="payment-submit">
                Post payment{amount && amount > 0 ? ` · ${formatINRShort(amount)}` : ""}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <ReceiptPhase payment={phase.payment} onClose={() => onOpenChange(false)} onPostAnother={postAnother} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                               */
/* ------------------------------------------------------------------ */

function BookingBanner({ booking }: { booking: BookingRow | BookingDetailResponse }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-navy-100 bg-navy-50 px-3 py-2" data-testid="payment-booking-banner">
      <div className="min-w-0">
        <p className="money text-sm font-bold text-navy-950">
          {booking.booking_number} <span className="font-medium text-ink">· {booking.customer_name}</span>
        </p>
        <UnitLabel project={booking.project_name} block={booking.block_name} flat={booking.flat_number} className="text-xs" />
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-ink-subtle">Total due</span>
        <DueAmount paise={booking.summary.total_due_paise} />
        {booking.summary.pending_cheques_paise > 0 && <Badge variant="warning">Cheques in hand {formatINRShort(booking.summary.pending_cheques_paise)}</Badge>}
        {booking.status !== "ACTIVE" && <Badge variant="danger">{booking.status}</Badge>}
      </div>
    </div>
  );
}

function BucketMeterBar({ meter }: { meter: BucketMeter }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface/60 p-3" data-testid="bucket-meter">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span>
          Agreed <span className="money font-semibold text-navy-950">{formatINR(meter.agreed_paise)}</span>
        </span>
        <span>
          Received <span className="money font-semibold text-success-fg">{formatINR(meter.paid_paise)}</span>
        </span>
        <span>
          Remaining <span className="money font-semibold text-ink">{formatINR(meter.remaining_paise)}</span>
        </span>
        {meter.pending_paise > 0 && (
          <span>
            In hand <span className="money font-semibold text-warning-fg">{formatINR(meter.pending_paise)}</span>
          </span>
        )}
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-navy-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.paid_percent)} aria-label={`${PAYMENT_BUCKET_LABELS[meter.bucket]} bucket received`}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${meter.paid_percent}%` }} />
        {meter.pending_paise > 0 && <span className="absolute inset-y-0 rounded-full bg-warning/70" style={{ left: `${meter.paid_percent}%`, width: `${Math.min(100 - meter.paid_percent, (meter.pending_paise / Math.max(1, meter.agreed_paise)) * 100)}%` }} />}
      </div>
      <p className="money text-2xs text-ink-subtle">{formatPercent(meter.paid_percent, 1)} of the {PAYMENT_BUCKET_LABELS[meter.bucket].toLowerCase()} bucket received</p>
    </div>
  );
}

function CapDetails({ details }: { details: Record<string, unknown> | undefined }) {
  if (!details) return null;
  const rows: Array<[string, string]> = [];
  const money = (key: string, label: string) => {
    const value = details[key];
    if (typeof value === "number") rows.push([label, formatINR(value)]);
  };
  if (typeof details.bucket === "string") rows.push(["Bucket", details.bucket]);
  money("agreed_paise", "Agreed");
  money("paid_paise", "Already received");
  money("amount_paise", "This payment");
  money("remaining_paise", "Remaining");
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-danger-fg/80">{label}</dt>
          <dd className="money text-right font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReceiptPhase({ payment, onClose, onPostAnother }: { payment: PaymentRow; onClose: () => void; onPostAnother: () => void }) {
  const receipt = useReceipt(payment.id);
  const { can } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadPdf(`/payments/${payment.id}/receipt.pdf`, `Receipt ${payment.receipt_number.replace(/[\\/]/g, "-")}.pdf`);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setDownloading(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Receipt {payment.receipt_number}</DialogTitle>
        <DialogDescription>
          {formatINR(payment.amount_paise)} · {payment.mode_name} · <span className={cn("font-semibold", payment.status === "PENDING" ? "text-warning-fg" : "text-success-fg")}>{payment.status === "PENDING" ? "Pending clearance" : "Cleared"}</span>
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {receipt.isPending && <Skeleton className="h-64" />}
        {receipt.isError && <Notice tone="warning">The receipt data could not be loaded ({isApiClientError(receipt.error) ? receipt.error.code : "error"}). You can still print it from the payments list.</Notice>}
        {receipt.data && (
          <div className="rounded-md border border-border bg-white p-4 sm:p-6">
            <ReceiptView receipt={receipt.data} />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button variant="outline" leftIcon={Plus} onClick={onPostAnother} data-testid="payment-post-another">
          Post another
        </Button>
        {can(["receipt.print", "payment.read"]) && (
          <>
            <Button variant="outline" leftIcon={Download} loading={downloading} onClick={() => void download()} data-testid="receipt-download">
              PDF
            </Button>
            <Button leftIcon={Printer} onClick={() => openReceiptPrint(payment.id)} data-testid="receipt-print">
              Print
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
