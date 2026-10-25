import { Ban, CheckCircle2, FileDown, FileSignature, IndianRupee, MoreHorizontal, Route, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { OtherChargeRow, PaymentAgainst } from "@kkt/contracts";
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, ErrorState, PageHeader, PageSkeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { describeError, isApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINRShort } from "@/lib/format";
import { DocumentsPanel } from "@/features/inventory/DocumentsPanel";
import { useTabParam } from "@/features/inventory/components";
import { PaymentDialog } from "@/features/payments/PaymentDialog";
import NotFoundPage from "@/pages/NotFoundPage";
import { downloadPdf, useBookingDetail } from "./api";
import { BookingStatusChip, DueAmount, UnitLabel } from "./components";
import { DemandsTab } from "./detail/DemandsTab";
import { HistoryTab } from "./detail/HistoryTab";
import { LedgerTab } from "./detail/LedgerTab";
import { OtherChargesTab } from "./detail/OtherChargesTab";
import { OverviewTab } from "./detail/OverviewTab";
import { PaymentsTab } from "./detail/PaymentsTab";
import { RevisionsTab } from "./detail/RevisionsTab";
import { ScheduleTab } from "./detail/ScheduleTab";
import { AgreementRevisionDialog, CancelBookingDialog, CompleteBookingDialog, PlanChangeDialog } from "./detail/dialogs";

const TABS = ["overview", "ledger", "schedule", "demands", "payments", "charges", "documents", "revisions", "history"] as const;
type Tab = (typeof TABS)[number];

type DialogKind = "revise" | "plan" | "cancel" | "complete" | null;

interface PaymentPrefill {
  against: PaymentAgainst;
  otherChargeId: string | null;
}

/** `/bookings/:id` — header with actions by permission and the SPEC §12 tabs. */
export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const booking = useBookingDetail(id);
  const [tab, setTab] = useTabParam<Tab>(TABS, "overview");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [payment, setPayment] = useState<PaymentPrefill | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Deep links: ?action=revise | pay | plan | cancel | complete (e.g. from the payment dialog's cap error).
  useEffect(() => {
    const action = params.get("action");
    if (!action || !booking.data) return;
    if (action === "revise" && can("agreement.edit")) setDialog("revise");
    else if (action === "pay" && can("payment.post")) setPayment({ against: "FLAT_VALUE", otherChargeId: null });
    else if (action === "plan" && can("booking.create")) setDialog("plan");
    else if (action === "cancel" && can("booking.cancel")) setDialog("cancel");
    else if (action === "complete" && can("booking.complete")) setDialog("complete");
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("action");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.data, params]);

  if (booking.isPending) return <PageSkeleton />;
  if (booking.isError) {
    if (isApiClientError(booking.error) && booking.error.status === 404) return <NotFoundPage />;
    return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} className="rounded-lg border border-border bg-card" />;
  }
  const row = booking.data;
  const active = row.status === "ACTIVE";

  const download = async (kind: "allotment" | "statement") => {
    setDownloading(kind);
    try {
      await downloadPdf(`/bookings/${row.id}/${kind === "allotment" ? "allotment-letter.pdf" : "statement.pdf"}`, `${row.booking_number.replace(/[\\/]/g, "-")}-${kind}.pdf`);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setDownloading(null);
    }
  };

  const openPayment = (line?: OtherChargeRow) => setPayment(line ? { against: "OTHER_CHARGE", otherChargeId: line.id } : { against: "FLAT_VALUE", otherChargeId: null });

  return (
    <>
      <PageHeader
        title={row.booking_number}
        titleAddon={
          <>
            <BookingStatusChip status={row.status} />
            {row.summary.pending_cheques_paise > 0 && <Badge variant="warning">Cheques in hand {formatINRShort(row.summary.pending_cheques_paise)}</Badge>}
            {row.revision_count > 0 && <Badge variant="outline" numeric>{row.revision_count} revision{row.revision_count === 1 ? "" : "s"}</Badge>}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-ink">{row.customer_name}</span>
            <UnitLabel project={row.project_name} block={row.block_name} flat={row.flat_number} />
            <span>Booked {formatDate(row.booking_date)}</span>
            <span>
              Due <DueAmount paise={row.summary.total_due_paise} />
            </span>
          </span>
        }
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Sales" }, { label: "Bookings", to: "/bookings" }, { label: row.booking_number }]}
        backTo="/bookings"
        actions={
          <>
            {active && can("payment.post") && (
              <Button leftIcon={IndianRupee} onClick={() => openPayment()} data-testid="booking-post-payment">
                Post payment
              </Button>
            )}
            {active && can("agreement.edit") && (
              <Button variant="outline" leftIcon={FileSignature} onClick={() => setDialog("revise")} data-testid="booking-revise">
                Revise agreement
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" leftIcon={MoreHorizontal} data-testid="booking-more">
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Documents</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void download("allotment")} disabled={downloading !== null}>
                  <FileDown className="size-4" aria-hidden="true" /> Allotment letter PDF
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void download("statement")} disabled={downloading !== null}>
                  <ScrollText className="size-4" aria-hidden="true" /> Statement of account PDF
                </DropdownMenuItem>
                {active && (can("booking.create") || can("booking.cancel") || can("booking.complete")) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Booking</DropdownMenuLabel>
                    {can("booking.create") && (
                      <DropdownMenuItem onSelect={() => setDialog("plan")}>
                        <Route className="size-4" aria-hidden="true" /> Change payment plan
                      </DropdownMenuItem>
                    )}
                    {can("booking.complete") && (
                      <DropdownMenuItem onSelect={() => setDialog("complete")}>
                        <CheckCircle2 className="size-4" aria-hidden="true" /> Complete / handover
                      </DropdownMenuItem>
                    )}
                    {can("booking.cancel") && (
                      <DropdownMenuItem destructive onSelect={() => setDialog("cancel")}>
                        <Ban className="size-4" aria-hidden="true" /> Cancel booking
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="schedule" count={row.schedule.length}>
            Schedule
          </TabsTrigger>
          <TabsTrigger value="demands">Demands</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="charges" count={row.other_charges.length}>
            Other charges
          </TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="revisions" count={row.agreement_revisions.length + row.plan_revisions.length}>
            Revisions
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab booking={row} />
        </TabsContent>
        <TabsContent value="ledger">{tab === "ledger" && <LedgerTab bookingId={row.id} />}</TabsContent>
        <TabsContent value="schedule">{tab === "schedule" && <ScheduleTab bookingId={row.id} initial={row.schedule} />}</TabsContent>
        <TabsContent value="demands">{tab === "demands" && <DemandsTab bookingId={row.id} />}</TabsContent>
        <TabsContent value="payments">{tab === "payments" && <PaymentsTab booking={row} highlightId={params.get("highlight")} onPostPayment={() => openPayment()} />}</TabsContent>
        <TabsContent value="charges">{tab === "charges" && <OtherChargesTab booking={row} onPostPayment={openPayment} />}</TabsContent>
        <TabsContent value="documents">{tab === "documents" && <DocumentsPanel entityType="BOOKING" entityId={row.id} appliesTo="BOOKING" />}</TabsContent>
        <TabsContent value="revisions">{tab === "revisions" && <RevisionsTab booking={row} />}</TabsContent>
        <TabsContent value="history">{tab === "history" && <HistoryTab bookingId={row.id} />}</TabsContent>
      </Tabs>

      <PaymentDialog open={payment !== null} onOpenChange={(open) => !open && setPayment(null)} booking={row} defaultAgainst={payment?.against ?? "FLAT_VALUE"} defaultOtherChargeId={payment?.otherChargeId ?? null} />
      <AgreementRevisionDialog open={dialog === "revise"} onOpenChange={(open) => !open && setDialog(null)} booking={row} />
      <PlanChangeDialog open={dialog === "plan"} onOpenChange={(open) => !open && setDialog(null)} booking={row} />
      <CancelBookingDialog open={dialog === "cancel"} onOpenChange={(open) => !open && setDialog(null)} booking={row} />
      <CompleteBookingDialog open={dialog === "complete"} onOpenChange={(open) => !open && setDialog(null)} booking={row} />
    </>
  );
}
