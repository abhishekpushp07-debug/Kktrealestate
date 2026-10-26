import { Navigate, useParams } from "react-router-dom";
import { ErrorState, PageSkeleton } from "@/components/ui";
import { isApiClientError } from "@/lib/api";
import NotFoundPage from "@/pages/NotFoundPage";
import { usePayment } from "./api";

/** `/payments/:id` (audit links, search) → the booking's Payments tab with the receipt highlighted. */
export default function PaymentRedirect() {
  const { id } = useParams<{ id: string }>();
  const payment = usePayment(id);
  if (payment.isPending) return <PageSkeleton />;
  if (payment.isError) {
    if (isApiClientError(payment.error) && payment.error.status === 404) return <NotFoundPage />;
    return (
      <ErrorState
        error={payment.error}
        onRetry={() => void payment.refetch()}
        className="rounded-lg border border-border bg-card"
      />
    );
  }
  return <Navigate to={`/bookings/${payment.data.booking_id}?tab=payments&highlight=${payment.data.id}`} replace />;
}
