import { CheckCircle2, Printer, RotateCcw, Undo2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ChequeRow, PaymentRow } from "@kkt/contracts";
import { Button, ConfirmDialog, DateInput, FieldWrapper, Input, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR, todayIST } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { bouncePayment, clearPayment, PAYMENT_INVALIDATIONS, reversePayment } from "./api";

/** The minimum a row needs for the action buttons (payments and cheques share them). */
export type ActionablePayment = Pick<PaymentRow, "id" | "version" | "status" | "receipt_number" | "amount_paise" | "mode_code"> & Partial<Pick<PaymentRow, "customer_name" | "booking_id">> & Partial<Pick<ChequeRow, "instrument">>;

export type PaymentAction = "clear" | "bounce" | "reverse";

export interface PaymentActionState {
  action: PaymentAction;
  payment: ActionablePayment;
}

/** Opens the print route for a receipt in a new tab (auto-prints there). */
export function openReceiptPrint(paymentId: string): void {
  window.open(`/print/receipt/${paymentId}?autoprint=1`, "_blank", "noopener");
}

/* ------------------------------------------------------------------ */
/* Hook: one mutation per action with toasts + invalidations            */
/* ------------------------------------------------------------------ */

export function usePaymentActions(extraInvalidate: readonly (readonly unknown[])[] = []) {
  const invalidate = [...PAYMENT_INVALIDATIONS, ...extraInvalidate];
  const clear = useMutationWithToast<PaymentRow, { payment: ActionablePayment; cleared_on: string; remarks: string }>({
    mutationFn: ({ payment, cleared_on, remarks }) => clearPayment(payment, { cleared_on, remarks: remarks.trim() || null }),
    successMessage: (row) => `${row.receipt_number} cleared`,
    invalidate,
    entityLabel: "This payment",
  });
  const bounce = useMutationWithToast<PaymentRow, { payment: ActionablePayment; reason: string; bounced_on: string }>({
    mutationFn: ({ payment, reason, bounced_on }) => bouncePayment(payment, { reason, bounced_on }),
    successMessage: (row) => `${row.receipt_number} marked bounced`,
    invalidate,
    entityLabel: "This payment",
  });
  const reverse = useMutationWithToast<PaymentRow, { payment: ActionablePayment; reason: string; reversal_date: string }>({
    mutationFn: ({ payment, reason, reversal_date }) => reversePayment(payment, { reason, reversal_date }),
    successMessage: (row) => `${row.receipt_number} reversed — receipt cancelled`,
    invalidate,
    entityLabel: "This payment",
  });
  return { clear, bounce, reverse };
}

/* ------------------------------------------------------------------ */
/* Permission-aware action buttons                                      */
/* ------------------------------------------------------------------ */

export interface PaymentActionButtonsProps {
  payment: ActionablePayment;
  onAction: (state: PaymentActionState) => void;
  size?: "xs" | "sm";
  /** Hide the print button (lists that already show one). */
  hidePrint?: boolean;
  className?: string;
}

/** Clear / Bounce (pending), Reverse (cleared) and Print receipt, filtered by permission and status. */
export function PaymentActionButtons({ payment, onAction, size = "xs", hidePrint = false, className }: PaymentActionButtonsProps) {
  const { can } = useAuth();
  const canClear = can("payment.clear");
  const canReverse = can("payment.reverse");
  const canPrint = can(["receipt.print", "payment.read"]);
  const pending = payment.status === "PENDING";
  const cleared = payment.status === "CLEARED";
  return (
    <div className={className ?? "flex flex-wrap items-center justify-end gap-1"} data-no-row-click>
      {pending && canClear && (
        <>
          <Button size={size} variant="outline" leftIcon={CheckCircle2} onClick={() => onAction({ action: "clear", payment })} data-testid={`payment-clear-${payment.id}`}>
            Clear
          </Button>
          <Button size={size} variant="danger-outline" leftIcon={XCircle} onClick={() => onAction({ action: "bounce", payment })} data-testid={`payment-bounce-${payment.id}`}>
            Bounce
          </Button>
        </>
      )}
      {cleared && canReverse && (
        <Button size={size} variant="ghost" leftIcon={Undo2} onClick={() => onAction({ action: "reverse", payment })} data-testid={`payment-reverse-${payment.id}`}>
          Reverse
        </Button>
      )}
      {!hidePrint && canPrint && (
        <Button size={size} variant="ghost" leftIcon={Printer} onClick={() => openReceiptPrint(payment.id)} aria-label={`Print receipt ${payment.receipt_number}`} data-testid={`payment-print-${payment.id}`}>
          Receipt
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                              */
/* ------------------------------------------------------------------ */

export interface PaymentActionDialogsProps {
  state: PaymentActionState | null;
  onClose: () => void;
  /** Extra query keys to refresh (e.g. a booking's detail keys). */
  invalidate?: readonly (readonly unknown[])[];
}

/** Clear (date + remarks), Bounce (reason + date) and Reverse (reason + date) confirmations. */
export function PaymentActionDialogs({ state, onClose, invalidate = [] }: PaymentActionDialogsProps) {
  const actions = usePaymentActions(invalidate);
  const [date, setDate] = useState<string>(todayIST());
  const [remarks, setRemarks] = useState("");
  const today = todayIST();

  useEffect(() => {
    if (state) {
      setDate(todayIST());
      setRemarks("");
    }
  }, [state]);

  const close = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  if (!state) return null;
  const { action, payment } = state;
  const summary = (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border bg-surface px-3 py-2 text-xs">
      <dt className="text-ink-subtle">Receipt</dt>
      <dd className="money text-right font-semibold">{payment.receipt_number}</dd>
      <dt className="text-ink-subtle">Amount</dt>
      <dd className="money text-right font-semibold">{formatINR(payment.amount_paise)}</dd>
      {payment.instrument?.number && (
        <>
          <dt className="text-ink-subtle">Instrument</dt>
          <dd className="money text-right">
            {payment.instrument.number}
            {payment.instrument.date ? ` · ${formatDate(payment.instrument.date)}` : ""}
          </dd>
        </>
      )}
      {payment.customer_name && (
        <>
          <dt className="text-ink-subtle">Customer</dt>
          <dd className="truncate text-right">{payment.customer_name}</dd>
        </>
      )}
    </dl>
  );

  if (action === "clear") {
    return (
      <ConfirmDialog
        open
        onOpenChange={close}
        title="Mark as cleared?"
        description="The amount starts counting towards the booking's paid figures. The bucket cap is re-checked by the server."
        confirmLabel="Mark cleared"
        onConfirm={() => actions.clear.mutateAsync({ payment, cleared_on: date, remarks })}
      >
        {summary}
        <FieldWrapper label="Cleared on" required>
          {(control) => <DateInput id={control.id} value={date} onChange={(value) => setDate(value ?? today)} max={today} />}
        </FieldWrapper>
        <FieldWrapper label="Remarks">{(control) => <Input id={control.id} value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={1000} placeholder="Bank reference, clearing note…" />}</FieldWrapper>
      </ConfirmDialog>
    );
  }

  if (action === "bounce") {
    return (
      <ConfirmDialog
        open
        onOpenChange={close}
        title="Mark as bounced?"
        description="Bounced instruments never count towards paid. Accounts are notified."
        confirmLabel="Mark bounced"
        variant="destructive"
        requireReason
        reasonLabel="Bounce reason"
        reasonPlaceholder="Insufficient funds, signature mismatch…"
        onConfirm={(reason) => actions.bounce.mutateAsync({ payment, reason: reason ?? "", bounced_on: date })}
      >
        {summary}
        <FieldWrapper label="Bounced on" required>
          {(control) => <DateInput id={control.id} value={date} onChange={(value) => setDate(value ?? today)} max={today} />}
        </FieldWrapper>
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={close}
      title="Reverse this payment?"
      description="A negative REVERSAL row is appended to the ledger, the summary is decremented and the receipt is marked CANCELLED (never deleted)."
      confirmLabel="Reverse payment"
      variant="destructive"
      requireReason
      reasonLabel="Reversal reason"
      reasonPlaceholder="Why is this receipt being reversed? (audited)"
      onConfirm={(reason) => actions.reverse.mutateAsync({ payment, reason: reason ?? "", reversal_date: date })}
    >
      {summary}
      <FieldWrapper label="Reversal date" required>
        {(control) => <DateInput id={control.id} value={date} onChange={(value) => setDate(value ?? today)} max={today} />}
      </FieldWrapper>
      <p className="flex items-start gap-1.5 text-xs text-ink-subtle">
        <RotateCcw className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        Post a fresh payment afterwards if the money was received against a different bucket or booking.
      </p>
    </ConfirmDialog>
  );
}

/** Convenience: textarea for ad-hoc notes in dialogs that do not use ConfirmDialog's reason box. */
export function NotesField({ value, onChange, label = "Notes" }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <FieldWrapper label={label}>{(control) => <Textarea id={control.id} value={value} onChange={(event) => onChange(event.target.value)} rows={2} maxLength={1000} />}</FieldWrapper>;
}
