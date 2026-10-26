import { ShieldX } from "lucide-react";
import { useState } from "react";
import type { CustomerRow } from "@kkt/contracts";
import { Button, FieldWrapper, Input, SimpleDialog, Textarea } from "@/components/ui";
import { api, describeError } from "@/lib/api";
import { useMutationWithToast } from "@/lib/queries";
import { Notice } from "@/features/inventory/components";
import { CUSTOMERS_PATH, crmKeys } from "../api";

export const ERASE_CONFIRM_WORD = "ERASE";

/** True when the typed confirmation and reason allow the erase request. */
export function canSubmitErase(typed: string, reason: string): boolean {
  return typed.trim() === ERASE_CONFIRM_WORD && reason.trim().length >= 3;
}

export interface EraseCustomerDialogProps {
  customer: CustomerRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Mount with a `key` that changes when it opens (the form starts empty each time).
 * Right to erasure (Super Admin): POST /customers/:id/erase {confirm:"ERASE", reason}. Personal data of the customer, co-applicants, portal
 * login, documents, leads, visits and enquiries is anonymised; bookings, payments, demands and the ledger stay. 409 HAS_ACTIVE_BOOKING
 * while a booking is active.
 */
export function EraseCustomerDialog({ customer, open, onOpenChange }: EraseCustomerDialogProps) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const erase = useMutationWithToast<CustomerRow, void>({
    mutationFn: () =>
      api.post<CustomerRow>(`${CUSTOMERS_PATH}/${customer.id}/erase`, {
        confirm: ERASE_CONFIRM_WORD,
        reason: reason.trim(),
      }),
    successMessage: () => "Personal data erased. Financial records were kept.",
    errorMessage: false,
    invalidate: [[CUSTOMERS_PATH], crmKeys.customer360(customer.id)],
    onSuccess: () => onOpenChange(false),
    onError: (cause) => setError(describeError(cause)),
  });

  const blocked = customer.active_booking_count > 0;

  return (
    <SimpleDialog
      open={open}
      onOpenChange={(next) => !erase.isPending && onOpenChange(next)}
      title={`Erase ${customer.full_name}'s personal data?`}
      description="This cannot be undone. Name, phone, e-mail, PAN, Aadhaar, bank details, addresses and KYC documents are anonymised for the customer and their co-applicants; their portal login is disabled. Bookings, payments, demands, the ledger and the audit history stay for accounting."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={erase.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            leftIcon={ShieldX}
            loading={erase.isPending}
            disabled={blocked || !canSubmitErase(typed, reason)}
            onClick={() => erase.mutate()}
            data-testid="customer-erase-submit"
          >
            Erase permanently
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {blocked && (
          <Notice tone="warning" data-testid="customer-erase-blocked">
            {customer.full_name} has{" "}
            {customer.active_booking_count === 1
              ? "an active booking"
              : `${customer.active_booking_count} active bookings`}
            . Cancel or complete {customer.active_booking_count === 1 ? "it" : "them"} first.
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <FieldWrapper
          label="Reason"
          required
          hint="Recorded in the audit log (e.g. the customer's written request reference)"
        >
          {(control) => (
            <Textarea
              id={control.id}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              disabled={blocked}
              data-testid="customer-erase-reason"
            />
          )}
        </FieldWrapper>
        <FieldWrapper label={`Type ${ERASE_CONFIRM_WORD} to confirm`} required>
          {(control) => (
            <Input
              id={control.id}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={blocked}
              data-testid="customer-erase-confirm"
            />
          )}
        </FieldWrapper>
      </div>
    </SimpleDialog>
  );
}
