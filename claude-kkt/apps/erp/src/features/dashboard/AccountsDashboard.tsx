import { AlertTriangle, CalendarDays, FileCheck2, IndianRupee, ReceiptText } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DEMAND_STATUS_LABELS, MONEY_CATEGORY_LABELS, type AccountsDashboardResponse } from "@kkt/contracts";
import { Badge, Button, StatCard, StatusChip } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR, formatINRShort, formatNumber } from "@/lib/format";
import {
  PaymentActionButtons,
  PaymentActionDialogs,
  type PaymentActionState,
} from "@/features/payments/PaymentActions";
import { PaymentDialog } from "@/features/payments/PaymentDialog";
import { ageingLabel } from "@/features/payments/paymentMath";
import { MiniTable, Widget } from "./widgets";

/** Accounts: today / month tiles, cheques to clear, overdue demands, bounced alerts, quick post payment. */
export function AccountsDashboard({ data }: { data: AccountsDashboardResponse }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [postOpen, setPostOpen] = useState(false);
  const [action, setAction] = useState<PaymentActionState | null>(null);
  const chequesTotal = data.cheques_to_clear.reduce((sum, row) => sum + row.amount_paise, 0);
  const openDemands = data.demand_status_counts.find((row) => row.status === "OPEN");

  return (
    <div className="space-y-4" data-testid="accounts-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          Only cleared money counts. Cheques and DDs wait here until you clear or bounce them.
        </p>
        {can("payment.post") && (
          <Button leftIcon={IndianRupee} onClick={() => setPostOpen(true)} data-testid="dashboard-post-payment">
            Post payment
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected today"
          value={formatINRShort(data.today.amount_paise)}
          hint={`${formatNumber(data.today.count)} receipts`}
          icon={IndianRupee}
          tone="navy"
        />
        <StatCard
          label="Collected this month"
          value={formatINRShort(data.this_month.amount_paise)}
          hint={data.this_month.by_category
            .map((row) => `${MONEY_CATEGORY_LABELS[row.category]} ${formatINRShort(row.amount_paise)}`)
            .join(" · ")}
          icon={CalendarDays}
        />
        <StatCard
          label="Cheques to clear"
          value={formatINRShort(chequesTotal)}
          hint={`${formatNumber(data.cheques_to_clear.length)} instruments`}
          icon={FileCheck2}
          tone="gold"
          onClick={() => navigate("/payments/cheques")}
        />
        <StatCard
          label="Open demands"
          value={openDemands ? formatINRShort(openDemands.amount_paise) : "₹0"}
          hint={
            openDemands
              ? `${formatNumber(openDemands.count)} open · ${formatNumber(data.overdue_demands.length)} overdue`
              : "Nothing open"
          }
          icon={ReceiptText}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Widget title="Cheques to clear" description="By instrument date" icon={FileCheck2} to="/payments/cheques">
          <MiniTable
            rows={data.cheques_to_clear}
            rowKey={(row) => row.id}
            empty="No cheques in hand"
            columns={[
              {
                key: "date",
                label: "Instrument",
                cell: (row) => (
                  <span className="block leading-tight">
                    <span className="money block font-semibold">{formatDate(row.instrument_date)}</span>
                    <span className="money block text-2xs text-ink-subtle">
                      {row.instrument?.number ?? "—"} · {row.instrument?.bank_name ?? row.mode_code}
                    </span>
                  </span>
                ),
              },
              {
                key: "customer",
                label: "Customer",
                cell: (row) => (
                  <span className="block truncate leading-tight">
                    <span className="block">{row.customer_name}</span>
                    <span className="money block text-2xs text-ink-subtle">
                      {row.booking_number} · {row.flat_number}
                    </span>
                  </span>
                ),
              },
              {
                key: "amount",
                label: "Amount",
                align: "right",
                cell: (row) => <span className="font-semibold text-navy-950">{formatINR(row.amount_paise)}</span>,
              },
              {
                key: "actions",
                label: "",
                cell: (row) => <PaymentActionButtons payment={row} onAction={setAction} hidePrint />,
              },
            ]}
          />
        </Widget>
        <Widget title="Overdue demands" icon={ReceiptText} to="/demands?overdue_only=true">
          <MiniTable
            rows={data.overdue_demands}
            rowKey={(row) => row.id}
            empty="No overdue demands"
            columns={[
              {
                key: "demand",
                label: "Demand",
                cell: (row) => (
                  <span className="block leading-tight">
                    <span className="money block font-semibold">{row.demand_number}</span>
                    <span className="block text-2xs text-ink-subtle">{row.installment_name}</span>
                  </span>
                ),
              },
              {
                key: "customer",
                label: "Customer",
                cell: (row) => (
                  <span className="block truncate leading-tight">
                    <span className="block">{row.customer_name}</span>
                    <span className="money block text-2xs text-ink-subtle">
                      <Link to={`/bookings?q=${encodeURIComponent(row.booking_number)}`} className="hover:underline">
                        {row.booking_number}
                      </Link>{" "}
                      · {row.project_name} · {row.flat_number}
                    </span>
                  </span>
                ),
              },
              {
                key: "due",
                label: "Due",
                cell: (row) => (
                  <span className="block leading-tight">
                    <span className="money block">{formatDate(row.due_date)}</span>
                    <Badge variant={row.days_overdue > 60 ? "danger" : "warning"} className="mt-0.5">
                      {ageingLabel(row.days_overdue)}
                    </Badge>
                  </span>
                ),
              },
              {
                key: "amount",
                label: "Balance",
                align: "right",
                cell: (row) => (
                  <span className="font-semibold text-danger-fg">
                    {formatINR(row.total_demand_paise - row.paid_paise)}
                  </span>
                ),
              },
            ]}
          />
        </Widget>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Widget title="Bounced recently" icon={AlertTriangle}>
          <MiniTable
            rows={data.bounced_recent}
            rowKey={(row) => row.id}
            empty="Nothing bounced recently"
            columns={[
              {
                key: "receipt",
                label: "Receipt",
                cell: (row) => (
                  <span className="block leading-tight">
                    <span className="money block font-semibold">{row.receipt_number}</span>
                    <span className="money block text-2xs text-ink-subtle">{row.instrument?.number ?? "—"}</span>
                  </span>
                ),
              },
              {
                key: "customer",
                label: "Customer",
                cell: (row) => (
                  <span className="block truncate leading-tight">
                    <span className="block">{row.customer_name}</span>
                    <span className="block text-2xs text-danger-fg">{row.bounce_reason ?? "—"}</span>
                  </span>
                ),
              },
              {
                key: "amount",
                label: "Amount",
                align: "right",
                cell: (row) => (
                  <span className="font-semibold text-ink-subtle line-through">{formatINR(row.amount_paise)}</span>
                ),
              },
              { key: "status", label: "", cell: (row) => <StatusChip status={row.status} size="sm" /> },
            ]}
          />
        </Widget>
        <Widget title="Demands by status" icon={ReceiptText} to="/demands">
          <MiniTable
            rows={data.demand_status_counts}
            rowKey={(row) => row.status}
            columns={[
              {
                key: "status",
                label: "Status",
                cell: (row) => <StatusChip status={row.status} label={DEMAND_STATUS_LABELS[row.status]} />,
              },
              { key: "count", label: "#", align: "right", cell: (row) => formatNumber(row.count) },
              {
                key: "amount",
                label: "Amount",
                align: "right",
                cell: (row) => <span className="font-semibold">{formatINR(row.amount_paise)}</span>,
              },
            ]}
          />
        </Widget>
      </div>

      <PaymentDialog open={postOpen} onOpenChange={setPostOpen} />
      <PaymentActionDialogs state={action} onClose={() => setAction(null)} invalidate={[["/dashboard"]]} />
    </div>
  );
}
