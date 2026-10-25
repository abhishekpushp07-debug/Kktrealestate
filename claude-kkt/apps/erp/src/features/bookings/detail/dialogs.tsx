import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PAYMENT_BUCKET_LABELS, PLAN_ACCEPTANCE_MODES, PLAN_ACCEPTANCE_MODE_LABELS, type BookingDetailResponse, type BookingRow, type PlanAcceptanceMode, type SchedulePreviewRequest } from "@kkt/contracts";
import { Badge, Button, DateInput, FieldWrapper, FormError, FormRow, MoneyInput, PercentInput, RadioGroup, Select, SimpleDialog, Skeleton, Tabs, TabsList, TabsTrigger, Textarea } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { formatINR, formatPercent, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Notice } from "@/features/inventory/components";
import { BOOKINGS_PATH, bookingInvalidations, useApplicablePlans, useSchedulePreview } from "../api";
import { rebalanceSplitForTotal, splitFromAccount, splitFromAccountPercent, splitFromCash, splitFromCashPercent, splitIsExact, splitPercents, type SplitMode } from "../bookingMath";
import { DueAmount } from "../components";
import { SchedulePreviewTable } from "../wizard/SchedulePreviewTable";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: BookingDetailResponse;
}

function useReasonField(open: boolean) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) setReason("");
  }, [open]);
  return { reason, setReason, valid: reason.trim().length >= 3 };
}

/* ------------------------------------------------------------------ */
/* Revise agreement                                                     */
/* ------------------------------------------------------------------ */

/** New cash / account agreed values (each ≥ that bucket's paid) with a mandatory reason; shows the AGREEMENT_CHANGE effect. */
export function AgreementRevisionDialog({ open, onOpenChange, booking }: DialogProps) {
  const [total, setTotal] = useState<number | null>(booking.agreement_value_paise);
  const [cash, setCash] = useState<number | null>(booking.cash_agreed_paise);
  const [account, setAccount] = useState<number | null>(booking.account_agreed_paise);
  const [mode, setMode] = useState<SplitMode>("AMOUNT");
  const [error, setError] = useState<unknown>(null);
  const { reason, setReason, valid: reasonValid } = useReasonField(open);

  useEffect(() => {
    if (!open) return;
    setTotal(booking.agreement_value_paise);
    setCash(booking.cash_agreed_paise);
    setAccount(booking.account_agreed_paise);
    setError(null);
  }, [open, booking.agreement_value_paise, booking.cash_agreed_paise, booking.account_agreed_paise]);

  const split = { cash_paise: cash ?? 0, account_paise: account ?? 0 };
  const exact = total !== null && total > 0 && splitIsExact(total, split);
  const percents = total ? splitPercents(total, split) : { cash: 0, account: 0 };
  const cashPaid = booking.summary.cash.paid_paise;
  const accountPaid = booking.summary.account.paid_paise;
  const cashBelowPaid = cash !== null && cash < cashPaid;
  const accountBelowPaid = account !== null && account < accountPaid;
  const unchanged = total === booking.agreement_value_paise && cash === booking.cash_agreed_paise && account === booking.account_agreed_paise;
  const canSubmit = exact && !cashBelowPaid && !accountBelowPaid && reasonValid && !unchanged && total !== null && total > 0;

  const applySplit = (next: { cash_paise: number; account_paise: number }) => {
    setCash(next.cash_paise);
    setAccount(next.account_paise);
  };
  const changeTotal = (next: number | null) => {
    setTotal(next);
    if (next !== null && total) applySplit(rebalanceSplitForTotal(split, total, next));
  };

  const effect = useMemo(() => {
    if (!exact || cash === null || account === null) return null;
    const cashRaised = Math.round((booking.summary.raised_percent / 100) * cash);
    const accountRaised = Math.round((booking.summary.raised_percent / 100) * account);
    return { cash_due: cashRaised - cashPaid, account_due: accountRaised - accountPaid, cash_raised: cashRaised, account_raised: accountRaised };
  }, [exact, cash, account, booking.summary.raised_percent, cashPaid, accountPaid]);

  const revise = useMutationWithToast<BookingRow, void>({
    mutationFn: () => api.post<BookingRow>(`${BOOKINGS_PATH}/${booking.id}/agreement-revisions`, { version: booking.version, agreement_value_paise: total ?? 0, cash_agreed_paise: cash ?? 0, account_agreed_paise: account ?? 0, reason: reason.trim() }, { version: booking.version }),
    successMessage: "Agreement revised — dues recomputed",
    errorMessage: false,
    invalidate: bookingInvalidations(booking.id),
    entityLabel: "This booking",
    onSuccess: () => onOpenChange(false),
    onError: (cause: ApiClientError) => {
      if (!cause.isVersionConflict) setError(cause);
    },
  });

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !revise.isPending && onOpenChange(next)}
      title="Revise agreement"
      description="Each bucket's new agreed value must be at least what has already been received in it. Order raised and dues are recomputed; an AGREEMENT_CHANGE row is appended to the ledger."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={revise.isPending}>
            Cancel
          </Button>
          <Button loading={revise.isPending} disabled={!canSubmit} onClick={() => revise.mutate()} data-testid="revision-save">
            Save revision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow columns={2}>
          <FieldWrapper label="Agreement value" required hint={<span className="money">Currently {formatINR(booking.agreement_value_paise)}</span>}>
            {(control) => <MoneyInput id={control.id} value={total} onChange={changeTotal} data-testid="revision-total" />}
          </FieldWrapper>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-muted">Enter the split as</span>
            <Tabs value={mode} onValueChange={(value) => setMode(value as SplitMode)}>
              <TabsList variant="pills">
                <TabsTrigger value="AMOUNT">Amounts</TabsTrigger>
                <TabsTrigger value="PERCENT">Percentages</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </FormRow>
        <FormRow columns={2}>
          {mode === "AMOUNT" ? (
            <>
              <FieldWrapper label="Cash bucket" required error={cashBelowPaid ? `Cannot go below ${formatINR(cashPaid)} already received in cash` : undefined} hint={`Received ${formatINR(cashPaid)} · ${formatPercent(percents.cash)}`}>
                {(control) => <MoneyInput id={control.id} value={cash} invalid={cashBelowPaid} onChange={(value) => (total ? applySplit(splitFromCash(total, value)) : setCash(value))} data-testid="revision-cash" />}
              </FieldWrapper>
              <FieldWrapper label="Account bucket" required error={accountBelowPaid ? `Cannot go below ${formatINR(accountPaid)} already received in account` : undefined} hint={`Received ${formatINR(accountPaid)} · ${formatPercent(percents.account)}`}>
                {(control) => <MoneyInput id={control.id} value={account} invalid={accountBelowPaid} onChange={(value) => (total ? applySplit(splitFromAccount(total, value)) : setAccount(value))} data-testid="revision-account" />}
              </FieldWrapper>
            </>
          ) : (
            <>
              <FieldWrapper label="Cash %" required error={cashBelowPaid ? `Cannot go below ${formatINR(cashPaid)} already received` : undefined} hint={<span className="money">{formatINR(cash)}</span>}>
                {(control) => <PercentInput id={control.id} value={percents.cash} disabled={!total} onChange={(value) => total && applySplit(splitFromCashPercent(total, value))} />}
              </FieldWrapper>
              <FieldWrapper label="Account %" required error={accountBelowPaid ? `Cannot go below ${formatINR(accountPaid)} already received` : undefined} hint={<span className="money">{formatINR(account)}</span>}>
                {(control) => <PercentInput id={control.id} value={percents.account} disabled={!total} onChange={(value) => total && applySplit(splitFromAccountPercent(total, value))} />}
              </FieldWrapper>
            </>
          )}
        </FormRow>
        {!exact && total !== null && total > 0 && <Notice tone="danger">Cash + Account must equal the agreement value exactly.</Notice>}
        {effect && (
          <div className="rounded-md border border-gold-border bg-gold-light p-3 text-xs" data-testid="revision-effect">
            <p className="mb-1 font-semibold text-gold-text">Effect at {formatPercent(booking.summary.raised_percent)} raised</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              <dt className="text-ink-muted">Cash raised</dt>
              <dd className="money text-right font-medium">{formatINR(effect.cash_raised)}</dd>
              <dt className="text-ink-muted">Cash due</dt>
              <dd className="text-right">
                <DueAmount paise={effect.cash_due} />
              </dd>
              <dt className="text-ink-muted">Account raised</dt>
              <dd className="money text-right font-medium">{formatINR(effect.account_raised)}</dd>
              <dt className="text-ink-muted">Account due</dt>
              <dd className="text-right">
                <DueAmount paise={effect.account_due} />
              </dd>
            </dl>
          </div>
        )}
        <FieldWrapper label="Reason" required hint="At least 3 characters — recorded in the revision and audit log">
          {(control) => <Textarea id={control.id} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="Negotiated discount, loan sanction changed the account portion…" data-testid="revision-reason" />}
        </FieldWrapper>
        <FormError error={error} />
      </div>
    </SimpleDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Change plan                                                          */
/* ------------------------------------------------------------------ */

/** Pick another applicable plan with a live preview; disabled with the reason when a demand has been paid. */
export function PlanChangeDialog({ open, onOpenChange, booking }: DialogProps) {
  const plans = useApplicablePlans(booking.project_id, booking.block_id, booking.booking_date);
  const [planId, setPlanId] = useState<string | null>(null);
  const [acceptanceMode, setAcceptanceMode] = useState<PlanAcceptanceMode>(booking.plan_acceptance_mode ?? "IN_PERSON");
  const [acceptedOn, setAcceptedOn] = useState<string>(todayIST());
  const [error, setError] = useState<unknown>(null);
  const { reason, setReason, valid: reasonValid } = useReasonField(open);
  const paidInstallment = booking.schedule.some((row) => row.paid_paise > 0);

  useEffect(() => {
    if (!open) return;
    setPlanId(null);
    setError(null);
    setAcceptedOn(todayIST());
  }, [open]);

  const previewRequest = useMemo<SchedulePreviewRequest | null>(() => (planId ? { plan_id: planId, block_id: booking.block_id, booking_date: booking.booking_date, cash_agreed_paise: booking.cash_agreed_paise, account_agreed_paise: booking.account_agreed_paise } : null), [planId, booking]);
  const preview = useSchedulePreview(previewRequest);

  const change = useMutationWithToast<BookingRow, void>({
    mutationFn: () => api.post<BookingRow>(`${BOOKINGS_PATH}/${booking.id}/plan-change`, { version: booking.version, payment_plan_id: planId ?? "", reason: reason.trim(), plan_acceptance_mode: acceptanceMode, plan_accepted_on: acceptedOn }, { version: booking.version }),
    successMessage: "Payment plan changed — schedule recomputed",
    errorMessage: false,
    invalidate: bookingInvalidations(booking.id),
    entityLabel: "This booking",
    onSuccess: () => onOpenChange(false),
    onError: (cause) => {
      if (!cause.isVersionConflict) setError(cause);
    },
  });

  const options = (plans.data ?? []).filter((plan) => plan.plan_id !== booking.payment_plan_id);
  const canSubmit = Boolean(planId) && reasonValid && !paidInstallment && acceptedOn >= booking.booking_date;

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !change.isPending && onOpenChange(next)}
      title="Change payment plan"
      description={`Current plan: ${booking.plan_snapshot.name}. Allowed only while no installment demand has been paid; everything is recomputed and a PLAN_CHANGE row is appended.`}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={change.isPending}>
            Cancel
          </Button>
          <Button loading={change.isPending} disabled={!canSubmit} onClick={() => change.mutate()} data-testid="plan-change-save">
            Change plan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {paidInstallment && (
          <Notice tone="danger">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="size-4" aria-hidden="true" /> Plan change blocked
            </span>
            <p className="mt-0.5 text-xs">At least one installment demand has a payment applied. Reverse those payments first or keep the current plan.</p>
          </Notice>
        )}
        <FieldWrapper label="New plan" required>
          {() =>
            plans.isPending ? (
              <Skeleton className="h-16" />
            ) : options.length === 0 ? (
              <p className="text-xs text-ink-subtle">No other plan is assigned to this tower.</p>
            ) : (
              <RadioGroup<string>
                cards
                value={planId}
                onValueChange={setPlanId}
                disabled={paidInstallment}
                options={options.map((plan) => ({
                  value: plan.plan_id,
                  label: (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {plan.name} <span className="money text-2xs text-ink-subtle">{plan.code}</span>
                      {plan.is_default && <Badge variant="gold">Default</Badge>}
                    </span>
                  ),
                  description: `${plan.installments.length} installments`,
                }))}
              />
            )
          }
        </FieldWrapper>
        {previewRequest && preview.isPending && <Skeleton className="h-32" />}
        {preview.data && <SchedulePreviewTable preview={preview.data} loading={preview.isFetching} />}
        <FormRow columns={2}>
          <FieldWrapper label="Accepted via" required>
            {(control) => <Select<PlanAcceptanceMode> id={control.id} value={acceptanceMode} onValueChange={(value) => value && setAcceptanceMode(value)} options={PLAN_ACCEPTANCE_MODES.map((value) => ({ value, label: PLAN_ACCEPTANCE_MODE_LABELS[value] }))} />}
          </FieldWrapper>
          <FieldWrapper label="Accepted on" required error={acceptedOn < booking.booking_date ? "Cannot be before the booking date" : undefined}>
            {(control) => <DateInput id={control.id} value={acceptedOn} onChange={(value) => setAcceptedOn(value ?? todayIST())} min={booking.booking_date} max={todayIST()} />}
          </FieldWrapper>
        </FormRow>
        <FieldWrapper label="Reason" required>
          {(control) => <Textarea id={control.id} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="Customer opted for the construction-linked plan…" data-testid="plan-change-reason" />}
        </FieldWrapper>
        <FormError error={error} />
      </div>
    </SimpleDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Cancel                                                               */
/* ------------------------------------------------------------------ */

/** Reason, deduction and refund (≤ paid); surfaces pending cheques that block cancellation. */
export function CancelBookingDialog({ open, onOpenChange, booking }: DialogProps) {
  const [deduction, setDeduction] = useState<number | null>(0);
  const [refund, setRefund] = useState<number | null>(null);
  const [cancelDate, setCancelDate] = useState<string>(todayIST());
  const [error, setError] = useState<unknown>(null);
  const { reason, setReason, valid: reasonValid } = useReasonField(open);
  const paid = booking.summary.total_paid_paise + booking.summary.other_charges_paid_paise;
  const pendingCheques = booking.summary.pending_cheques_paise;

  useEffect(() => {
    if (!open) return;
    setDeduction(0);
    setRefund(paid);
    setCancelDate(todayIST());
    setError(null);
  }, [open, paid]);

  useEffect(() => {
    if (deduction === null) return;
    setRefund(Math.max(0, paid - deduction));
  }, [deduction, paid]);

  const refundTooHigh = refund !== null && refund > paid;
  const canSubmit = reasonValid && refund !== null && !refundTooHigh && (deduction ?? 0) >= 0 && pendingCheques === 0;

  const cancel = useMutationWithToast<BookingRow, void>({
    mutationFn: () => api.post<BookingRow>(`${BOOKINGS_PATH}/${booking.id}/cancel`, { version: booking.version, reason: reason.trim(), deduction_paise: deduction ?? 0, refund_paise: refund ?? 0, cancel_date: cancelDate }, { version: booking.version }),
    successMessage: `Booking ${booking.booking_number} cancelled — flat ${booking.flat_number} is Available again`,
    errorMessage: false,
    invalidate: bookingInvalidations(booking.id),
    entityLabel: "This booking",
    onSuccess: () => onOpenChange(false),
    onError: (cause) => {
      if (!cause.isVersionConflict) setError(cause);
    },
  });

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !cancel.isPending && onOpenChange(next)}
      title="Cancel booking"
      description="The flat and parking return to Available, the ledger is closed with a CANCELLATION row and further payments are rejected."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cancel.isPending}>
            Keep booking
          </Button>
          <Button variant="danger" loading={cancel.isPending} disabled={!canSubmit} onClick={() => cancel.mutate()} data-testid="cancel-confirm">
            Cancel booking
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {pendingCheques > 0 && (
          <Notice tone="danger">
            <span className="font-semibold">Pending cheques of {formatINR(pendingCheques)} block cancellation.</span> Clear or bounce them from the Payments tab first.
          </Notice>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-3 py-2 text-xs">
          <dt className="text-ink-subtle">Total received (cleared)</dt>
          <dd className="money text-right font-semibold text-success-fg">{formatINR(paid)}</dd>
          <dt className="text-ink-subtle">Total due today</dt>
          <dd className="text-right">
            <DueAmount paise={booking.summary.total_due_paise} />
          </dd>
        </dl>
        <FormRow columns={2}>
          <FieldWrapper label="Deduction" hint="Forfeited / cancellation charges">
            {(control) => <MoneyInput id={control.id} value={deduction} onChange={setDeduction} maxPaise={paid} showShort={false} data-testid="cancel-deduction" />}
          </FieldWrapper>
          <FieldWrapper label="Refund" required error={refundTooHigh ? `Refund cannot exceed ${formatINR(paid)} received` : undefined} hint="Defaults to received − deduction">
            {(control) => <MoneyInput id={control.id} value={refund} onChange={setRefund} invalid={refundTooHigh} showShort={false} data-testid="cancel-refund" />}
          </FieldWrapper>
        </FormRow>
        <FieldWrapper label="Cancellation date" required>
          {(control) => <DateInput id={control.id} value={cancelDate} onChange={(value) => setCancelDate(value ?? todayIST())} min={booking.booking_date} max={todayIST()} />}
        </FieldWrapper>
        <FieldWrapper label="Reason" required hint="Mandatory; audited and shown on the cancellations report">
          {(control) => <Textarea id={control.id} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} data-testid="cancel-reason" />}
        </FieldWrapper>
        <FormError error={error} />
      </div>
    </SimpleDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Complete / handover                                                  */
/* ------------------------------------------------------------------ */

function problemsFrom(details: Record<string, unknown> | undefined): string[] {
  const raw = details?.problems;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (typeof entry === "object" && entry !== null && typeof (entry as { message?: unknown }).message === "string") return [(entry as { message: string }).message];
    return [];
  });
}

/** Marks the booking Completed (flat Sold) when possession is complete and dues ≤ 0; lists blockers from HANDOVER_BLOCKED. */
export function CompleteBookingDialog({ open, onOpenChange, booking }: DialogProps) {
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  const [completedOn, setCompletedOn] = useState(todayIST());
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setNotes("");
    setCompletedOn(todayIST());
    setProblems([]);
    setError(null);
  }, [open]);

  const localBlockers = [
    booking.summary.total_due_paise > 0 ? `Flat value due of ${formatINR(booking.summary.total_due_paise)} is outstanding` : null,
    booking.summary.other_charges_due_paise > 0 ? `Other charges due of ${formatINR(booking.summary.other_charges_due_paise)} are outstanding` : null,
    booking.summary.pending_cheques_paise > 0 ? `Cheques of ${formatINR(booking.summary.pending_cheques_paise)} are still pending` : null,
  ].filter((item): item is string => item !== null);

  const complete = useMutationWithToast<BookingRow, void>({
    mutationFn: () => api.post<BookingRow>(`${BOOKINGS_PATH}/${booking.id}/complete`, { version: booking.version, completion_notes: notes.trim() || null, completed_on: completedOn }, { version: booking.version }),
    successMessage: `Booking ${booking.booking_number} completed — flat ${booking.flat_number} is Sold`,
    errorMessage: false,
    invalidate: bookingInvalidations(booking.id),
    entityLabel: "This booking",
    onSuccess: () => onOpenChange(false),
    onError: (cause) => {
      if (cause.status === 409 && cause.code === "HANDOVER_BLOCKED") {
        const list = problemsFrom(cause.details);
        setProblems(list.length ? list : [cause.message]);
        return;
      }
      if (!cause.isVersionConflict) setError(cause);
    },
  });

  const blockers = problems.length ? problems : localBlockers;

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !complete.isPending && onOpenChange(next)}
      title="Complete booking / handover"
      description="Allowed when the possession stage is complete, total due ≤ 0 and other charges due ≤ 0. The flat becomes Sold."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={complete.isPending}>
            Close
          </Button>
          <Button variant="gold" leftIcon={CheckCircle2} loading={complete.isPending} disabled={localBlockers.length > 0} onClick={() => complete.mutate()} data-testid="complete-confirm">
            Mark completed
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {blockers.length > 0 ? (
          <Notice tone={problems.length ? "danger" : "warning"}>
            <p className="font-semibold">{problems.length ? "The server blocked the handover:" : "Not ready yet:"}</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {(booking.summary.total_due_paise > 0 || booking.summary.other_charges_due_paise > 0) && (
              <Button size="xs" variant="link" className="mt-1" onClick={() => {
                onOpenChange(false);
                navigate(`/bookings/${booking.id}?tab=overview&action=pay`);
              }}>
                Post a payment
              </Button>
            )}
          </Notice>
        ) : (
          <Notice tone="success">Dues are settled and no cheques are pending. The possession stage is verified by the server on confirm.</Notice>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-3 py-2 text-xs">
          <dt className="text-ink-subtle">{PAYMENT_BUCKET_LABELS.CASH} due</dt>
          <dd className="text-right">
            <DueAmount paise={booking.summary.cash.due_paise} />
          </dd>
          <dt className="text-ink-subtle">{PAYMENT_BUCKET_LABELS.ACCOUNT} due</dt>
          <dd className="text-right">
            <DueAmount paise={booking.summary.account.due_paise} />
          </dd>
          <dt className="text-ink-subtle">Other charges due</dt>
          <dd className="text-right">
            <DueAmount paise={booking.summary.other_charges_due_paise} />
          </dd>
        </dl>
        <FieldWrapper label="Completed on" required>
          {(control) => <DateInput id={control.id} value={completedOn} onChange={(value) => setCompletedOn(value ?? todayIST())} min={booking.booking_date} max={todayIST()} />}
        </FieldWrapper>
        <FieldWrapper label="Handover notes">
          {(control) => <Textarea id={control.id} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={1000} placeholder="Keys handed over, snag list signed…" className={cn(complete.isPending && "opacity-60")} />}
        </FieldWrapper>
        <FormError error={error} />
      </div>
    </SimpleDialog>
  );
}
