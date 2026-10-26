import type { ColumnDef } from "@tanstack/react-table";
import { Contact, Plus, UsersRound } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KYC_STATUSES, KYC_STATUS_LABELS, type CustomerRow } from "@kkt/contracts";
import { Badge, Button, Combobox, DataTable, Input, PageHeader, Select, StatusChip, Toolbar } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatNumber, formatPhone } from "@/lib/format";
import { useList, useListParams } from "@/lib/queries";
import { useSalesUserOptions } from "@/features/inventory/api";
import { BulkPortalEnableDialog } from "./BulkPortalEnableDialog";
import { CustomerFormSheet } from "./CustomerFormSheet";
import { CUSTOMERS_PATH } from "./api";

const CUSTOMER_FILTERS = ["kyc_status", "relationship_manager_id", "tag", "portal_enabled"] as const;

function TagFilter({ value, onCommit }: { value: string; onCommit: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  const commit = () => onCommit(draft.trim() || null);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
  };
  return (
    <Input
      aria-label="Tag"
      placeholder="Tag"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className="h-8 w-full text-xs sm:w-32"
      data-testid="customers-filter-tag"
    />
  );
}

/** `/customers` — buyers with KYC state, relationship manager and booking counts. */
export default function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canWrite = can("customer.write");
  const canPortal = can("customer.portal_manage");
  const list = useListParams({ filterKeys: CUSTOMER_FILTERS, defaultSort: "full_name" });
  const query = useList<CustomerRow>(CUSTOMERS_PATH, list.params);
  const users = useSalesUserOptions();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const columns = useMemo<ColumnDef<CustomerRow, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "Customer",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="block min-w-0 leading-tight">
            <span className="block truncate font-semibold text-navy-950">
              {row.original.salutation ? `${row.original.salutation} ` : ""}
              {row.original.full_name}
            </span>
            <span className="block truncate font-mono text-2xs font-normal text-ink-subtle">
              {row.original.customer_code}
            </span>
          </span>
        ),
      },
      {
        accessorKey: "phone",
        header: "Phone",
        meta: { width: 130 },
        cell: ({ row }) => <span className="money">{formatPhone(row.original.phone)}</span>,
      },
      {
        accessorKey: "email",
        header: "E-mail",
        meta: { hideOnMobile: true },
        cell: ({ row }) => row.original.email ?? <span className="text-ink-subtle">—</span>,
      },
      {
        accessorKey: "relationship_manager_name",
        header: "RM",
        cell: ({ row }) =>
          row.original.relationship_manager_name ?? <span className="text-ink-subtle">Unassigned</span>,
      },
      {
        accessorKey: "kyc_status",
        header: "KYC",
        meta: { width: 120 },
        cell: ({ row }) => (
          <StatusChip status={row.original.kyc_status} label={KYC_STATUS_LABELS[row.original.kyc_status]} size="sm" />
        ),
      },
      {
        accessorKey: "active_booking_count",
        header: "Bookings",
        meta: { align: "right", width: 90 },
        cell: ({ row }) => formatNumber(row.original.active_booking_count),
      },
      {
        accessorKey: "portal_enabled",
        header: "Portal",
        meta: { width: 100 },
        cell: ({ row }) =>
          row.original.portal_enabled ? (
            <StatusChip status="ENABLED" label="Enabled" size="sm" />
          ) : (
            <span className="text-xs text-ink-subtle">Off</span>
          ),
      },
      {
        id: "tags",
        header: "Tags",
        meta: { sortKey: false },
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
            {row.original.tags.length > 3 && <Badge variant="neutral">+{row.original.tags.length - 3}</Badge>}
          </span>
        ),
      },
    ],
    [],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Buyers and prospects converted from leads. KYC values stay masked; reveal is audited."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Sales" }, { label: "Customers" }]}
        actions={
          <>
            {canPortal && (
              <Button
                variant="outline"
                leftIcon={UsersRound}
                onClick={() => setBulkOpen(true)}
                data-testid="customers-bulk-portal"
              >
                Enable portal for buyers
              </Button>
            )}
            {canWrite && (
              <Button leftIcon={Plus} onClick={() => setSheetOpen(true)} data-testid="customer-new-btn">
                New customer
              </Button>
            )}
          </>
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search name, code, phone or e-mail…"
        filters={
          <>
            <Select
              aria-label="KYC status"
              size="sm"
              className="w-full sm:w-36"
              value={list.filters.kyc_status ?? null}
              onValueChange={(value) => list.setFilter("kyc_status", value)}
              options={KYC_STATUSES.map((value) => ({ value, label: KYC_STATUS_LABELS[value] }))}
              placeholder="Any KYC"
              allowClear
              data-testid="customers-filter-kyc"
            />
            <Combobox
              aria-label="Relationship manager"
              size="sm"
              className="w-full sm:w-44"
              value={list.filters.relationship_manager_id ?? null}
              onValueChange={(value) => list.setFilter("relationship_manager_id", value)}
              options={(users.data ?? []).map((user) => ({ value: user.id, label: user.name, keywords: [user.email] }))}
              placeholder="Any RM"
              allowClear
              data-testid="customers-filter-rm"
            />
            <TagFilter value={list.filters.tag ?? ""} onCommit={(value) => list.setFilter("tag", value)} />
            <Select
              aria-label="Portal"
              size="sm"
              className="w-full sm:w-32"
              value={list.filters.portal_enabled ?? null}
              onValueChange={(value) => list.setFilter("portal_enabled", value)}
              options={[
                { value: "true", label: "Portal on" },
                { value: "false", label: "Portal off" },
              ]}
              placeholder="Portal"
              allowClear
            />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: CUSTOMERS_PATH, params: list.params, filename: "customers.csv" }}
        exportTotal={query.data?.total}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "customer" : "customers"}` : undefined}
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        getRowId={(row) => row.id}
        loading={query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        rowClassName={(row) => (row.is_active ? undefined : "[&>td]:text-ink-subtle")}
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          total,
          onPageChange: list.setPage,
          onPageSizeChange: list.setPageSize,
        }}
        emptyState={{
          icon: Contact,
          title: list.hasActiveFilters ? "No customers match" : "No customers yet",
          description: list.hasActiveFilters
            ? "Try another search or clear the filters."
            : "Convert a lead or create the first customer.",
        }}
        data-testid="customers-table"
      />
      <CustomerFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        customer={null}
        onSaved={(saved) => navigate(`/customers/${saved.id}`)}
      />
      <BulkPortalEnableDialog key={bulkOpen ? "open" : "closed"} open={bulkOpen} onOpenChange={setBulkOpen} />
    </>
  );
}
