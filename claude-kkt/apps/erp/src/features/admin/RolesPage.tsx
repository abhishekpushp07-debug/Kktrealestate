import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Lock, MoreHorizontal, Pencil, Plus, Power, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { ActiveStateResponse, RoleRow } from "@kkt/contracts";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  PageHeader,
  StatusChip,
  Switch,
  Toolbar,
  Tooltip,
} from "@/components/ui";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { RoleFormSheet } from "./RoleFormSheet";
import { ROLES_PATH } from "./adminApi";

/** `/admin/roles` — system roles (read-only) and custom roles with their permission bundles. */
export default function RolesPage() {
  const list = useListParams({ defaultSort: "name" });
  const query = useList<RoleRow>(ROLES_PATH, list.params);
  const [sheet, setSheet] = useState<{ open: boolean; role: RoleRow | null; readOnly: boolean }>({
    open: false,
    role: null,
    readOnly: false,
  });
  const [confirmDeactivate, setConfirmDeactivate] = useState<RoleRow | null>(null);

  const deactivate = useMutationWithToast<ActiveStateResponse, RoleRow>({
    mutationFn: (role) =>
      api.post<ActiveStateResponse>(
        `${ROLES_PATH}/${role.id}/deactivate`,
        { version: role.version },
        { version: role.version },
      ),
    successMessage: (_data, role) => `Role ${role.name} deactivated`,
    invalidate: [[ROLES_PATH]],
    entityLabel: "This role",
  });

  const columns = useMemo<ColumnDef<RoleRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Role",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            {row.original.is_system && (
              <Tooltip content="System role — permissions are fixed">
                <Lock className="size-3.5 text-ink-subtle" aria-label="System role" />
              </Tooltip>
            )}
            <span className="font-semibold text-navy-950">{row.original.name}</span>
          </span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="block max-w-md truncate text-ink-muted">{row.original.description || "—"}</span>
        ),
      },
      {
        id: "permissions",
        header: "Permissions",
        meta: { align: "right", sortKey: false, width: 120 },
        cell: ({ row }) => (
          <Badge variant={row.original.permissions.length > 0 ? "gold" : "neutral"} numeric>
            {formatNumber(row.original.permissions.length)}
          </Badge>
        ),
      },
      {
        accessorKey: "user_count",
        header: "Users",
        meta: { align: "right", width: 90 },
        cell: ({ row }) => formatNumber(row.original.user_count),
      },
      {
        accessorKey: "is_active",
        header: "Status",
        meta: { width: 110 },
        cell: ({ row }) => <StatusChip status={row.original.is_active ? "ACTIVE" : "INACTIVE"} size="sm" />,
      },
      {
        id: "actions",
        header: "",
        meta: { sortKey: false, width: 56, align: "right", locked: true, label: "Actions" },
        cell: ({ row }) => {
          const role = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  icon={MoreHorizontal}
                  label={`Actions for ${role.name}`}
                  size="sm"
                  data-testid={`role-actions-${role.id}`}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setSheet({ open: true, role, readOnly: true })}>
                  <Eye /> View permissions
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet({ open: true, role, readOnly: false })}>
                  <Pencil /> {role.is_system ? "Edit description" : "Edit"}
                </DropdownMenuItem>
                {!role.is_system && role.is_active && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      disabled={role.user_count > 0}
                      onSelect={() => setConfirmDeactivate(role)}
                    >
                      <Power /> Deactivate{role.user_count > 0 ? ` (${role.user_count} users)` : ""}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Roles"
        description="System roles follow the specification and cannot be deleted. Custom roles bundle any set of permission codes."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Admin" }, { label: "Roles" }]}
        actions={
          <Button
            leftIcon={Plus}
            onClick={() => setSheet({ open: true, role: null, readOnly: false })}
            data-testid="role-new-btn"
          >
            New role
          </Button>
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search roles…"
        filters={
          <Switch
            size="sm"
            label="Show inactive"
            checked={list.includeInactive}
            onCheckedChange={list.setIncludeInactive}
            data-testid="roles-include-inactive-switch"
          />
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "role" : "roles"}` : undefined}
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
        onRowClick={(role) => setSheet({ open: true, role, readOnly: role.is_system })}
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          total,
          onPageChange: list.setPage,
          onPageSizeChange: list.setPageSize,
        }}
        emptyState={{
          icon: ShieldCheck,
          title: "No roles found",
          description: "System roles are seeded with the company; create a custom role for anything else.",
        }}
        data-testid="roles-table"
      />
      <RoleFormSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((state) => ({ ...state, open }))}
        role={sheet.role}
        readOnly={sheet.readOnly}
      />
      <ConfirmDialog
        open={confirmDeactivate !== null}
        onOpenChange={(open) => !open && setConfirmDeactivate(null)}
        title="Deactivate role?"
        description={confirmDeactivate ? `${confirmDeactivate.name} can no longer be assigned to users.` : undefined}
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={async () => {
          if (confirmDeactivate) await deactivate.mutateAsync(confirmDeactivate).catch(() => undefined);
        }}
      />
    </>
  );
}
