import { Download, ExternalLink, FileText } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BOOKING_STATUS_LABELS, LEDGER_EVENT_LABELS, PAYMENT_BUCKET_LABELS, SCHEDULE_STATUS_LABELS, type CustomerStatementResponse } from "@kkt/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Combobox, EmptyState, ErrorState, FieldWrapper, KeyValueList, PageHeader, Skeleton, StatusChip, type ComboboxOption } from "@/components/ui";
import { describeError } from "@/lib/api";
import { formatDate, formatDateTime, formatINR, formatINRShort, formatNumber, formatPercent, formatSqft } from "@/lib/format";
import { downloadPdf, searchBookings } from "@/features/bookings/api";
import { Due, Money, ReportSection, ReportTable, StatGrid, TwoLine } from "./ReportSections";
import { exportReport, REPORTS_PATH, useCustomerStatement } from "./api";

/** `/reports/customer-statement?booking_id=` — booking picker + statement of account with the branded PDF downloads. */
export default function CustomerStatementPage() {
  const [search, setSearch] = useSearchParams();
  const bookingId = search.get("booking_id");
  const [label, setLabel] = useState<string | null>(null);
  const statement = useCustomerStatement(bookingId);
  const [busy, setBusy] = useState<string | null>(null);

  const pick = (value: string | null, option: ComboboxOption | null) => {
    setLabel(option?.label ?? null);
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set("booking_id", value);
        else next.delete("booking_id");
        return next;
      },
      { replace: true },
    );
  };

  const onSearch = useCallback(async (query: string): Promise<ComboboxOption[]> => {
    const rows = await searchBookings(query);
    return rows.map((booking) => ({ value: booking.id, label: `${booking.booking_number} · ${booking.customer_name}`, description: `${booking.project_name} · ${booking.block_name} ${booking.flat_number}`, keywords: [booking.customer_phone, booking.flat_number, booking.customer_code] }));
  }, []);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    try {
      await action();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const data = statement.data;
  const selectedLabel = label ?? (data ? `${data.booking.booking_number} · ${data.booking.customer_name}` : undefined);

  return (
    <>
      <PageHeader
        title="Customer Statement of Account"
        description="Agreement, revisions, payment schedule, full ledger, other charges and pending cheques for one booking."
        backTo="/reports"
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Reports", to: "/reports" }, { label: "Money" }, { label: "Customer statement" }]}
        actions={
          bookingId ? (
            <>
              <Button asChild variant="outline" leftIcon={ExternalLink}>
                <Link to={`/bookings/${bookingId}`}>
                  <ExternalLink aria-hidden="true" /> Booking
                </Link>
              </Button>
              <Button variant="outline" leftIcon={Download} loading={busy === "allotment"} disabled={busy !== null || !data} onClick={() => void run("allotment", () => downloadPdf(`/bookings/${bookingId}/allotment-letter.pdf`, `allotment-letter-${data?.booking.booking_number ?? bookingId}.pdf`))} data-testid="statement-allotment-pdf">
                Allotment letter
              </Button>
              <Button variant="outline" leftIcon={Download} loading={busy === "csv"} disabled={busy !== null || !data} onClick={() => void run("csv", async () => { await exportReport(`${REPORTS_PATH}/customer-statement`, { booking_id: bookingId }, "csv", `statement-${data?.booking.booking_number ?? bookingId}`); })} data-testid="statement-csv">
                CSV
              </Button>
              <Button leftIcon={FileText} loading={busy === "pdf"} disabled={busy !== null || !data} onClick={() => void run("pdf", () => downloadPdf(`/bookings/${bookingId}/statement.pdf`, `statement-${data?.booking.booking_number ?? bookingId}.pdf`))} data-testid="statement-pdf">
                Statement PDF
              </Button>
            </>
          ) : undefined
        }
      />

      <section className="mb-4 rounded-lg border border-border bg-card p-3 shadow-card">
        <FieldWrapper label="Booking" required hint="Search by booking number, customer name, phone or flat.">
          {(control) => <Combobox id={control.id} value={bookingId} onValueChange={pick} onSearch={onSearch} selectedLabel={selectedLabel} placeholder="Find a booking…" searchPlaceholder="Booking number, customer, phone…" allowClear className="max-w-xl" data-testid="statement-booking" />}
        </FieldWrapper>
      </section>

      {!bookingId && <EmptyState icon={FileText} className="rounded-lg border border-border bg-card" title="Pick a booking" description="The statement shows everything the customer owes and has paid, with the branded PDF ready to send." />}
      {bookingId && statement.isPending && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-40" />
          <Skeleton className="h-80" />
        </div>
      )}
      {bookingId && statement.isError && <ErrorState error={statement.error} onRetry={() => void statement.refetch()} className="rounded-lg border border-border bg-card" />}
      {data && <StatementView data={data} />}
    </>
  );
}

function StatementView({ data }: { data: CustomerStatementResponse }) {
  const { booking, summary } = data;
  const paid = summary.cash_paid_paise + summary.account_paid_paise;
  const raised = summary.cash_order_raised_paise + summary.account_order_raised_paise;
  const sorted = useMemo(() => [...data.ledger].sort((a, b) => a.seq - b.seq), [data.ledger]);

  return (
    <div className="space-y-4" data-testid="statement-view">
      <Card>
        <CardHeader actions={<StatusChip status={booking.status} label={BOOKING_STATUS_LABELS[booking.status]} />}>
          <CardTitle className="money">
            {booking.booking_number} <span className="font-sans text-sm font-normal text-ink-muted">· booked {formatDate(booking.booking_date)}</span>
          </CardTitle>
          <p className="text-xs text-ink-subtle">Generated {formatDateTime(data.generated_at, { zone: true })}</p>
        </CardHeader>
        <CardContent>
          <KeyValueList
            columns={3}
            items={[
              { label: "Customer", value: <TwoLine primary={<span className="font-medium">{booking.customer_name}</span>} secondary={booking.customer_code} /> },
              { label: "Co-applicants", value: booking.co_applicant_names.length ? booking.co_applicant_names.join(", ") : "—" },
              { label: "Address", value: booking.customer_address ?? "—" },
              { label: "Flat", value: <TwoLine primary={<span className="money font-medium">{booking.flat_number}</span>} secondary={`${booking.project_name} · ${booking.block_name}`} /> },
              { label: "Type / area", value: `${booking.flat_type_name} · ${formatSqft(booking.super_builtup_sqft)}` },
              { label: "Payment plan", value: booking.plan_name },
              { label: "Agreement value", value: <span className="money font-semibold text-navy-950">{formatINR(booking.agreement_value_paise)}</span>, numeric: true },
              { label: "Cash agreed", value: <span className="money">{formatINR(booking.cash_agreed_paise)}</span>, numeric: true },
              { label: "Account agreed", value: <span className="money">{formatINR(booking.account_agreed_paise)}</span>, numeric: true },
            ]}
          />
        </CardContent>
      </Card>

      <StatGrid
        items={[
          { label: "Raised", value: formatINRShort(raised), hint: `${formatPercent(booking.agreement_value_paise > 0 ? (raised / booking.agreement_value_paise) * 100 : 0, 1)} of agreement` },
          { label: "Paid (cleared)", value: formatINRShort(paid), tone: "navy" },
          { label: "Total due", value: formatINRShort(Math.abs(summary.total_due_paise)), hint: summary.total_due_paise < 0 ? "in advance" : "outstanding", tone: summary.total_due_paise > 0 ? "gold" : "default" },
          { label: "Cash due", value: formatINRShort(Math.abs(summary.cash_due_paise)), hint: summary.cash_due_paise < 0 ? "advance" : undefined },
          { label: "Account due", value: formatINRShort(Math.abs(summary.account_due_paise)), hint: summary.account_due_paise < 0 ? "advance" : undefined },
          { label: "Other charges due", value: formatINRShort(Math.abs(summary.other_charges_due_paise)), hint: summary.pending_cheques_paise > 0 ? `${formatINRShort(summary.pending_cheques_paise)} cheques pending` : undefined },
        ]}
      />

      <ReportSection title="Agreement revisions" description={data.revisions.length ? `${formatNumber(data.revisions.length)} revisions` : "The agreement has not been revised."} defaultView="table">
        <ReportTable
          columns={[
            { id: "at", header: "Revised", cell: (row) => <TwoLine primary={<span className="money">{formatDateTime(row.revised_at)}</span>} secondary={row.revised_by_name ?? undefined} /> },
            { id: "reason", header: "Reason", cell: (row) => <span className="block max-w-[20rem] truncate" title={row.reason}>{row.reason}</span> },
            { id: "before", header: "Before", align: "right", cell: (row) => <TwoLine primary={<Money paise={row.before.agreement_value_paise} />} secondary={`C ${formatINRShort(row.before.cash_agreed_paise)} · A ${formatINRShort(row.before.account_agreed_paise)}`} /> },
            { id: "after", header: "After", align: "right", cell: (row) => <TwoLine primary={<Money paise={row.after.agreement_value_paise} className="font-semibold" />} secondary={`C ${formatINRShort(row.after.cash_agreed_paise)} · A ${formatINRShort(row.after.account_agreed_paise)}`} /> },
            { id: "delta", header: "Δ", align: "right", cell: (row) => <Money paise={row.after.agreement_value_paise - row.before.agreement_value_paise} signed /> },
          ]}
          rows={data.revisions}
          getRowId={(row) => row.id}
          emptyTitle="No revisions"
        />
      </ReportSection>

      <ReportSection title="Payment schedule" defaultView="table">
        <ReportTable
          columns={[
            { id: "seq", header: "#", align: "right", width: 48, cell: (row) => row.seq, footer: "Total" },
            { id: "name", header: "Installment", cell: (row) => <TwoLine primary={<span className="font-medium">{row.name}</span>} secondary={row.trigger_label} /> },
            { id: "status", header: "Status", cell: (row) => <StatusChip status={row.status} label={SCHEDULE_STATUS_LABELS[row.status]} size="sm" /> },
            { id: "dates", header: "Expected / due", cell: (row) => <TwoLine primary={<span className="money">{row.expected_date ? formatDate(row.expected_date) : "—"}</span>} secondary={row.due_date ? `due ${formatDate(row.due_date)}` : row.demand_number ?? undefined} /> },
            { id: "percent", header: "%", align: "right", hideOnMobile: true, cell: (row) => formatPercent(row.percent) },
            { id: "cash", header: "Cash", align: "right", hideOnMobile: true, cell: (row) => <Money paise={row.cash_paise} />, footer: <Money paise={data.schedule.reduce((sum, row) => sum + row.cash_paise, 0)} className="font-semibold" /> },
            { id: "account", header: "Account", align: "right", hideOnMobile: true, cell: (row) => <Money paise={row.account_paise} />, footer: <Money paise={data.schedule.reduce((sum, row) => sum + row.account_paise, 0)} className="font-semibold" /> },
            { id: "total", header: "Total", align: "right", cell: (row) => <Money paise={row.total_paise} className="font-semibold" />, footer: <Money paise={data.schedule.reduce((sum, row) => sum + row.total_paise, 0)} className="font-semibold" /> },
            { id: "paid", header: "Paid", align: "right", cell: (row) => <Money paise={row.paid_paise} className="text-success-fg" />, footer: <Money paise={data.schedule.reduce((sum, row) => sum + row.paid_paise, 0)} className="font-semibold text-success-fg" /> },
          ]}
          rows={data.schedule}
          getRowId={(row) => String(row.seq)}
          rowClassName={(row) => (row.status === "OVERDUE" ? "[&>td]:bg-danger-bg/40" : undefined)}
        />
      </ReportSection>

      <ReportSection title="Ledger" description={`${formatNumber(sorted.length)} entries with running dues`} defaultView="table">
        <ReportTable
          columns={[
            { id: "seq", header: "#", align: "right", width: 48, cell: (row) => row.seq },
            { id: "date", header: "Date", cell: (row) => <span className="money">{formatDate(row.entry_date)}</span> },
            { id: "event", header: "Entry", cell: (row) => <TwoLine primary={<span className="flex flex-wrap items-center gap-1"><Badge variant={row.event === "PAYMENT" || row.event === "OTHER_CHARGE_PAYMENT" ? "success" : row.event.includes("REVERSAL") || row.event === "CANCELLATION" ? "danger" : "navy"}>{LEDGER_EVENT_LABELS[row.event]}</Badge>{row.bucket && <Badge variant="outline">{PAYMENT_BUCKET_LABELS[row.bucket]}</Badge>}</span>} secondary={row.label ?? row.note ?? undefined} /> },
            { id: "ref", header: "Ref", cell: (row) => <span className="money text-xs">{row.ref_number ?? "—"}</span> },
            { id: "amount", header: "Amount", align: "right", cell: (row) => <Money paise={row.amount_paise} signed className="font-semibold" /> },
            { id: "cash_due", header: "Cash due", align: "right", hideOnMobile: true, cell: (row) => <Due paise={row.cash_due_paise} /> },
            { id: "account_due", header: "Account due", align: "right", hideOnMobile: true, cell: (row) => <Due paise={row.account_due_paise} /> },
            { id: "total_due", header: "Total due", align: "right", cell: (row) => <Due paise={row.total_due_paise} /> },
            { id: "other_due", header: "Charges due", align: "right", hideOnMobile: true, cell: (row) => <Due paise={row.other_charges_due_paise} /> },
          ]}
          rows={sorted}
          getRowId={(row) => row.id}
          maxHeight="40rem"
        />
      </ReportSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReportSection title="Other charges" defaultView="table">
          <ReportTable
            columns={[
              { id: "name", header: "Charge", cell: (row) => <TwoLine primary={<span className="font-medium">{row.name}</span>} secondary={row.demand_number ?? (row.demanded_at ? `demanded ${formatDate(row.demanded_at)}` : "not yet demanded")} />, footer: "Total" },
              { id: "amount", header: "Amount", align: "right", hideOnMobile: true, cell: (row) => <Money paise={row.amount_paise} /> },
              { id: "gst", header: "GST", align: "right", hideOnMobile: true, cell: (row) => <TwoLine primary={<Money paise={row.gst_paise} />} secondary={formatPercent(row.gst_percent)} /> },
              { id: "total", header: "Total", align: "right", cell: (row) => <Money paise={row.total_paise} className="font-semibold" />, footer: <Money paise={data.other_charges.reduce((sum, row) => sum + row.total_paise, 0)} className="font-semibold" /> },
              { id: "paid", header: "Paid", align: "right", cell: (row) => <Money paise={row.paid_paise} className="text-success-fg" />, footer: <Money paise={data.other_charges.reduce((sum, row) => sum + row.paid_paise, 0)} className="font-semibold text-success-fg" /> },
              { id: "due", header: "Due", align: "right", cell: (row) => <Due paise={row.due_paise} />, footer: <Due paise={data.other_charges.reduce((sum, row) => sum + row.due_paise, 0)} /> },
            ]}
            rows={data.other_charges}
            getRowId={(row) => row.id}
            emptyTitle="No other charges"
          />
        </ReportSection>
        <ReportSection title="Pending cheques" defaultView="table">
          <ReportTable
            columns={[
              { id: "instrument", header: "Cheque", cell: (row) => <TwoLine primary={<span className="money font-semibold">{row.instrument?.number ?? row.receipt_number}</span>} secondary={row.instrument?.bank_name ?? undefined} />, footer: "Total" },
              { id: "date", header: "Dates", cell: (row) => <TwoLine primary={<span className="money">{formatDate(row.payment_date)}</span>} secondary={row.instrument_date ? `instr. ${formatDate(row.instrument_date)}` : undefined} /> },
              { id: "days", header: "In hand", align: "right", cell: (row) => <Badge variant={row.days_in_hand > 21 ? "danger" : row.days_in_hand > 7 ? "warning" : "neutral"} numeric>{row.days_in_hand} d</Badge> },
              { id: "amount", header: "Amount", align: "right", cell: (row) => <Money paise={row.amount_paise} className="font-semibold" />, footer: <Money paise={data.pending_cheques.reduce((sum, row) => sum + row.amount_paise, 0)} className="font-semibold" /> },
            ]}
            rows={data.pending_cheques}
            getRowId={(row) => row.id}
            emptyTitle="No cheques pending"
          />
        </ReportSection>
      </div>
    </div>
  );
}
