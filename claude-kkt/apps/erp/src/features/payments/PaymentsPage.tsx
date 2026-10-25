import { FileCheck2, IndianRupee } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PAYMENT_AGAINSTS, PAYMENT_AGAINST_LABELS, PAYMENT_MODE_CODES, PAYMENT_MODE_CODE_LABELS, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, type PaymentRow } from "@kkt/contracts";
import { Button, DateInput, PageHeader, Select, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { useList, useListParams } from "@/lib/queries";
import { useProjectOptions } from "@/features/shared/options";
import { PAYMENTS_PATH } from "./api";
import { PaymentDialog } from "./PaymentDialog";
import { PaymentsTable } from "./PaymentsTable";

const FILTERS = ["project_id", "status", "mode_code", "against", "from", "to"] as const;

/** `/payments` — every receipt with filters, CSV, row actions and the Post payment dialog. */
export default function PaymentsPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const list = useListParams({ filterKeys: FILTERS, defaultSort: "-payment_date" });
  const query = useList<PaymentRow>(PAYMENTS_PATH, list.params);
  const projects = useProjectOptions();
  const [postOpen, setPostOpen] = useState(() => params.get("action") === "post");
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.exportCsv(PAYMENTS_PATH, { ...list.params, page: 1, page_size: 200 }, "payments.csv");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Payments"
        description="Receipts across every booking. Cheques and DDs stay pending until cleared; only cleared money counts."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Accounts" }, { label: "Payments" }]}
        actions={
          <>
            <Button asChild variant="outline" leftIcon={FileCheck2}>
              <Link to="/payments/cheques">Cheques in hand</Link>
            </Button>
            {can("payment.post") && (
              <Button leftIcon={IndianRupee} onClick={() => setPostOpen(true)} data-testid="payments-post-btn">
                Post payment
              </Button>
            )}
          </>
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Receipt, booking, customer, instrument…"
        summary={query.data ? `${formatNumber(query.data.total)} receipts` : undefined}
        filters={
          <>
            <Select aria-label="Project" size="sm" className="w-full sm:w-48" value={list.filters.project_id ?? null} onValueChange={(value) => list.setFilter("project_id", value)} options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name }))} placeholder="All projects" allowClear />
            <Select aria-label="Status" size="sm" className="w-full sm:w-36" value={list.filters.status ?? null} onValueChange={(value) => list.setFilter("status", value)} options={PAYMENT_STATUSES.map((status) => ({ value: status, label: PAYMENT_STATUS_LABELS[status] }))} placeholder="Any status" allowClear />
            <Select aria-label="Mode" size="sm" className="w-full sm:w-40" value={list.filters.mode_code ?? null} onValueChange={(value) => list.setFilter("mode_code", value)} options={PAYMENT_MODE_CODES.map((code) => ({ value: code, label: PAYMENT_MODE_CODE_LABELS[code] }))} placeholder="Any mode" allowClear />
            <Select aria-label="Against" size="sm" className="w-full sm:w-36" value={list.filters.against ?? null} onValueChange={(value) => list.setFilter("against", value)} options={PAYMENT_AGAINSTS.map((value) => ({ value, label: PAYMENT_AGAINST_LABELS[value] }))} placeholder="Flat / charges" allowClear />
            <DateInput aria-label="From date" className="h-8 text-xs" wrapperClassName="w-full sm:w-40" value={list.filters.from ?? null} onChange={(value) => list.setFilter("from", value)} />
            <DateInput aria-label="To date" className="h-8 text-xs" wrapperClassName="w-full sm:w-40" value={list.filters.to ?? null} onChange={(value) => list.setFilter("to", value)} />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        onExportCsv={exportCsv}
        exporting={exporting}
      />
      <PaymentsTable
        rows={query.data?.items ?? []}
        loading={query.isPending || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        pagination={{ page: list.page, pageSize: list.pageSize, total: query.data?.total ?? 0, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        highlightId={params.get("highlight")}
        emptyAction={can("payment.post") ? <Button size="sm" leftIcon={IndianRupee} onClick={() => setPostOpen(true)}>Post payment</Button> : undefined}
      />
      <PaymentDialog open={postOpen} onOpenChange={setPostOpen} />
    </>
  );
}
