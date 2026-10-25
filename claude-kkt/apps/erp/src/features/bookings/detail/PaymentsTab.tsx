import { IndianRupee } from "lucide-react";
import type { BookingDetailResponse } from "@kkt/contracts";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { PaymentsTable } from "@/features/payments/PaymentsTable";
import { bookingInvalidations, useBookingPayments } from "../api";

export interface PaymentsTabProps {
  booking: BookingDetailResponse;
  highlightId?: string | null;
  onPostPayment: () => void;
}

/** Receipts on this booking with clear / bounce / reverse actions and receipt print. */
export function PaymentsTab({ booking, highlightId, onPostPayment }: PaymentsTabProps) {
  const { can } = useAuth();
  const payments = useBookingPayments(booking.id);
  const canPost = booking.status === "ACTIVE" && can("payment.post");
  return (
    <div className="space-y-3" data-testid="payments-tab">
      {canPost && (
        <div className="flex justify-end">
          <Button size="sm" leftIcon={IndianRupee} onClick={onPostPayment} data-testid="payments-tab-post">
            Post payment
          </Button>
        </div>
      )}
      <PaymentsTable
        rows={payments.data ?? []}
        loading={payments.isPending}
        error={payments.error}
        onRetry={() => void payments.refetch()}
        showBooking={false}
        invalidate={bookingInvalidations(booking.id)}
        highlightId={highlightId}
        emptyTitle="No payments yet"
        emptyAction={canPost ? <Button size="sm" leftIcon={IndianRupee} onClick={onPostPayment}>Post the first payment</Button> : undefined}
      />
    </div>
  );
}
