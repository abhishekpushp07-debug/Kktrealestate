import type { ColumnDef } from "@tanstack/react-table";
import { ArchiveRestore, KeyRound, Lock, LockOpen, MoreHorizontal, Pencil, Plus, Power, ShieldCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import type { ActiveStateResponse, UserRow } from "@kkt/contracts";
import {
  Avatar,
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
  Select,
  SimpleDialog,
  StatusChip,
  Toolbar,
  Tooltip,
} from "@/components/ui";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { CopyField } from "@/features/shared/CopyField";
import { useProjectOptions, useRoleOptions } from "@/features/shared/options";
import { UserFormSheet } from "./UserFormSheet";
import { USERS_PATH, activateUser, deactivateUser, isLocked, resetUserPassword, unlockUser } from "./adminApi";

interface TempPasswordState {
  user: UserRow;
  password: string;
}

/** `/admin/users` — staff accounts, roles, project scope and security actions. */
export default function UsersPage() {
  const { user: me } = useAuth();
  const navigate = useNavigate();
  const list = useListParams({ filterKeys: ["role_id", "is_locked"], defaultSort: "name" });
  const query = useList<UserRow>(USERS_PATH, list.params);
  const roles = useRoleOptions();
  const projects = useProjectOptions();
  const [editing, setEditing] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const [confirm, setConfirm] = useState<{ kind: "reset" | "deactivate"; user: UserRow } | null>(null);
  const [tempPassword, setTempPassword] = useState<TempPasswordState | null>(null);

  const projectName = useMemo(() => new Map((projects.data ?? []).map((project) => [project.id, project.name] as const)), [projects.data]);

  const deactivate = useMutationWithToast<ActiveStateResponse, UserRow>({ mutationFn: deactivateUser, successMessage: (_data, user) => `${user.name} deactivated`, invalidate: [[USERS_PATH]], entityLabel: "This user" });
  const activate = useMutationWithToast<ActiveStateResponse, UserRow>({ mutationFn: activateUser, successMessage: (_data, user) => `${user.name} restored`, invalidate: [[USERS_PATH]], entityLabel: "This user" });
  const unlock = useMutationWithToast<ActiveStateResponse, UserRow>({ mutationFn: unlockUser, successMessage: (_data, user) => `${user.name} unlocked`, invalidate: [[USERS_PATH]], entityLabel: "This user" });
  const reset = useMutationWithToast<string | null, UserRow>({
    mutationFn: resetUserPassword,
    successMessage: (password, user) => (password ? `Temporary password issued for ${user.name}` : `Password reset for ${user.name}`),
    invalidate: [[USERS_PATH]],
    entityLabel: "This user",
    onSuccess: (password, user) => {
      if (password) setTempPassword({ user, password });
    },
  });

  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "User",
        meta: { locked: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar name={row.original.name} size="sm" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-semibold text-navy-950">{row.original.name}</span>
              <span className="block truncate text-xs font-normal text-ink-subtle">{row.original.email}</span>
            </span>
          </span>
        ),
      },
      { accessorKey: "role_name", header: "Role", cell: ({ row }) => <Badge variant="gold">{row.original.role_name}</Badge> },
      {
        id: "scope",
        header: "Scope",
        meta: { sortKey: "all_projects" },
        cell: ({ row }) => {
          if (row.original.all_projects) return <Badge variant="navy">All projects</Badge>;
          const names = row.original.project_ids.map((id) => projectName.get(id) ?? "Unknown project");
          return (
            <Tooltip content={names.length ? names.join(", ") : "No projects"}>
              <span className="inline-flex">
                <Badge variant="neutral" numeric>
                  {formatNumber(row.original.project_ids.length)} project{row.original.project_ids.length === 1 ? "" : "s"}
                </Badge>
              </span>
            </Tooltip>
          );
        },
      },
      {
        accessorKey: "mfa_enabled",
        header: "MFA",
        meta: { align: "center", width: 90 },
        cell: ({ row }) => (row.original.mfa_enabled ? <StatusChip status="ENABLED" label="On" size="sm" /> : <span className="text-xs text-ink-subtle">Off</span>),
      },
      {
        accessorKey: "locked_until",
        header: "Locked",
        meta: { align: "center", width: 110 },
        cell: ({ row }) =>
          isLocked(row.original.locked_until) ? (
            <Tooltip content={`Locked until ${formatDateTime(row.original.locked_until, { zone: true })}`}>
              <span className="inline-flex">
                <StatusChip status="LOCKED" tone="danger" label="Locked" size="sm" />
              </span>
            </Tooltip>
          ) : (
            <span className="text-xs text-ink-subtle">—</span>
          ),
      },
      {
        accessorKey: "last_login_at",
        header: "Last login",
        cell: ({ row }) =>
          row.original.last_login_at ? (
            <Tooltip content={formatDateTime(row.original.last_login_at, { zone: true })}>
              <span className="money">{formatRelative(row.original.last_login_at)}</span>
            </Tooltip>
          ) : (
            <span className="text-xs text-ink-subtle">Never</span>
          ),
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
          const user = row.original;
          // Your own account: role, scope, active state and password change elsewhere (403 SELF_CHANGE; password → Change password).
          const self = me?.id === user.id;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon={MoreHorizontal} label={`Actions for ${user.name}`} size="sm" data-testid={`user-actions-${user.id}`} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing({ open: true, user })}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                {self ? (
                  <DropdownMenuItem onSelect={() => navigate("/change-password")} data-testid="user-change-own-password">
                    <KeyRound /> Change my password
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setConfirm({ kind: "reset", user })}>
                    <KeyRound /> Reset password
                  </DropdownMenuItem>
                )}
                {isLocked(user.locked_until) && (
                  <DropdownMenuItem onSelect={() => unlock.mutate(user)}>
                    <LockOpen /> Unlock
                  </DropdownMenuItem>
                )}
                {!self && <DropdownMenuSeparator />}
                {self ? null : user.is_active ? (
                  <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: "deactivate", user })}>
                    <Power /> Deactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => activate.mutate(user)}>
                    <ArchiveRestore /> Activate
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [projectName, activate, unlock, me?.id, navigate],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts, their role and project scope. Locked accounts unlock automatically after 15 minutes."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Admin" }, { label: "Users" }]}
        actions={
          <Button leftIcon={Plus} onClick={() => setEditing({ open: true, user: null })} data-testid="user-new-btn">
            New user
          </Button>
        }
      />
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search name, e-mail or phone…"
        filters={
          <>
            <Select
              aria-label="Role"
              size="sm"
              className="w-full sm:w-44"
              value={list.filters.role_id ?? null}
              onValueChange={(value) => list.setFilter("role_id", value)}
              options={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))}
              placeholder="Any role"
              allowClear
              data-testid="users-filter-role"
            />
            <Select
              aria-label="Locked"
              size="sm"
              className="w-full sm:w-36"
              value={list.filters.is_locked ?? null}
              onValueChange={(value) => list.setFilter("is_locked", value)}
              options={[
                { value: "true", label: "Locked only" },
                { value: "false", label: "Not locked" },
              ]}
              placeholder="Lock state"
              allowClear
              data-testid="users-filter-locked"
            />
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: USERS_PATH, params: list.params, filename: "users.csv" }}
        exportTotal={query.data?.total}
        summary={query.data ? `${formatNumber(total)} ${total === 1 ? "user" : "users"}` : undefined}
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
        onRowClick={(user) => setEditing({ open: true, user })}
        rowClassName={(user) => (user.is_active ? undefined : "[&>td]:text-ink-subtle")}
        pagination={{ page: list.page, pageSize: list.pageSize, total, onPageChange: list.setPage, onPageSizeChange: list.setPageSize }}
        emptyState={{ icon: Users, title: list.hasActiveFilters ? "No users match" : "No users yet", description: list.hasActiveFilters ? "Try another search or clear the filters." : "Create the first staff account." }}
        data-testid="users-table"
      />

      <UserFormSheet open={editing.open} onOpenChange={(open) => setEditing((state) => ({ ...state, open }))} user={editing.user} onTemporaryPassword={(user, password) => setTempPassword({ user, password })} />

      <ConfirmDialog
        open={confirm?.kind === "reset"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reset password?"
        description={confirm ? `${confirm.user.name} gets a new temporary password (shown once) and must change it at the next sign-in. Active sessions stay signed in until they expire.` : undefined}
        confirmLabel="Reset password"
        onConfirm={async () => {
          if (confirm) await reset.mutateAsync(confirm.user).catch(() => undefined);
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "deactivate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Deactivate user?"
        description={confirm ? `${confirm.user.name} can no longer sign in. Their history and audit trail stay intact; you can activate them again later.` : undefined}
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={async () => {
          if (confirm) await deactivate.mutateAsync(confirm.user).catch(() => undefined);
        }}
      />

      <SimpleDialog
        open={tempPassword !== null}
        onOpenChange={(open) => !open && setTempPassword(null)}
        title="Temporary password"
        description={tempPassword ? `Share it with ${tempPassword.user.name} over a secure channel. It is shown only once.` : undefined}
        size="sm"
        footer={
          <Button onClick={() => setTempPassword(null)} data-testid="temp-password-done-btn">
            Done
          </Button>
        }
      >
        {tempPassword && (
          <div className="space-y-3">
            <CopyField value={tempPassword.password} secret label="Copy" />
            <p className="flex items-start gap-2 text-xs text-ink-subtle">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              The user must set a new password at their next sign-in.
            </p>
            {isLocked(tempPassword.user.locked_until) && (
              <p className="flex items-start gap-2 text-xs text-warning-fg">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                This account is currently locked; unlock it from the row menu.
              </p>
            )}
          </div>
        )}
      </SimpleDialog>
    </>
  );
}
