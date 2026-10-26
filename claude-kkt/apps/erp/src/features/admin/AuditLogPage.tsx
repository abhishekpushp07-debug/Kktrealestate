import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, ScrollText } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ACTOR_TYPES, ACTOR_TYPE_LABELS, USER_TYPE_LABELS, type AuditLogRow, type LoginEventRow } from "@kkt/contracts";
import {
  Badge,
  Button,
  Combobox,
  DataTable,
  DateInput,
  Input,
  PageHeader,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusChip,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toolbar,
} from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useList, useListParams } from "@/lib/queries";
import { cn, humanize } from "@/lib/utils";
import { useUserOptions } from "@/features/shared/options";
import { AUDIT_PATH, LOGIN_EVENTS_PATH } from "./adminApi";
import { diffSnapshots, entityHref, formatDiffValue } from "./auditDiff";

const AUDIT_FILTERS = ["entity_type", "action", "actor_id", "actor_type", "from", "to"] as const;

/** Text filter that commits on Enter / blur so every keystroke does not hit the API. */
function TextFilter({
  value,
  onCommit,
  placeholder,
  testId,
}: {
  value: string;
  onCommit: (value: string | null) => void;
  placeholder: string;
  testId: string;
}) {
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
      aria-label={placeholder}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className="h-8 w-full text-xs sm:w-40"
      data-testid={testId}
    />
  );
}

function shortId(id: string | null): string {
  return id ? `${id.slice(0, 8)}…` : "—";
}

/** `/admin/audit-log` — immutable change log with before/after diffs, plus login attempts. */
export default function AuditLogPage() {
  const [tab, setTab] = useState<"changes" | "logins">("changes");
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every create, update, deactivate and status change, with who did it and what changed. Entries are immutable."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Admin" }, { label: "Audit log" }]}
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value === "logins" ? "logins" : "changes")}>
        <TabsList>
          <TabsTrigger value="changes" data-testid="audit-tab-changes">
            Changes
          </TabsTrigger>
          <TabsTrigger value="logins" data-testid="audit-tab-logins">
            Login events
          </TabsTrigger>
        </TabsList>
        <TabsContent value="changes">
          <ChangesTab />
        </TabsContent>
        <TabsContent value="logins">
          <LoginEventsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ChangesTab() {
  const list = useListParams({ filterKeys: AUDIT_FILTERS, defaultSort: "-created_at" });
  const query = useList<AuditLogRow>(AUDIT_PATH, list.params);
  const users = useUserOptions();
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  const userOptions = useMemo(
    () =>
      (users.data ?? []).map((user) => ({
        value: user.id,
        label: user.name,
        description: user.email,
        keywords: [user.email],
      })),
    [users.data],
  );

  const columns = useMemo<ColumnDef<AuditLogRow, unknown>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "When",
        meta: { locked: true, width: 170 },
        cell: ({ row }) => <span className="money">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        id: "actor",
        header: "Actor",
        meta: { sortKey: "actor_name" },
        cell: ({ row }) => (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="truncate">
              {row.original.actor_name ?? (row.original.actor_type === "SYSTEM" ? "System" : "Unknown")}
            </span>
            {row.original.actor_type !== "STAFF" && (
              <Badge variant={row.original.actor_type === "SYSTEM" ? "neutral" : "info"}>
                {ACTOR_TYPE_LABELS[row.original.actor_type]}
              </Badge>
            )}
          </span>
        ),
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => (
          <code className="rounded-xs bg-navy-50 px-1 py-0.5 font-mono text-xs text-navy-950">
            {row.original.action}
          </code>
        ),
      },
      {
        id: "entity",
        header: "Entity",
        meta: { sortKey: "entity_type" },
        cell: ({ row }) => {
          const href = entityHref(row.original.entity_type, row.original.entity_id);
          return (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium">{humanize(row.original.entity_type)}</span>
              <span className="money font-mono text-2xs text-ink-subtle">{shortId(row.original.entity_id)}</span>
              {href && (
                <Link
                  to={href}
                  className="inline-flex text-navy-700 hover:text-navy-950 focus-ring rounded-xs"
                  aria-label="Open entity"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </Link>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "ip",
        header: "IP",
        meta: { hideOnMobile: true },
        cell: ({ row }) => <span className="money font-mono text-xs text-ink-muted">{row.original.ip ?? "—"}</span>,
      },
    ],
    [],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <Toolbar
        filters={
          <>
            <TextFilter
              value={list.filters.entity_type ?? ""}
              onCommit={(value) => list.setFilter("entity_type", value)}
              placeholder="Entity type"
              testId="audit-filter-entity-type"
            />
            <TextFilter
              value={list.filters.action ?? ""}
              onCommit={(value) => list.setFilter("action", value)}
              placeholder="Action (entity.verb)"
              testId="audit-filter-action"
            />
            <Combobox
              aria-label="Actor"
              size="sm"
              className="w-full sm:w-48"
              value={list.filters.actor_id ?? null}
              onValueChange={(value) => list.setFilter("actor_id", value)}
              options={userOptions}
              placeholder="Any actor"
              allowClear
              data-testid="audit-filter-actor"
            />
            <Select
              aria-label="Actor type"
              size="sm"
              className="w-full sm:w-32"
              value={list.filters.actor_type ?? null}
              onValueChange={(value) => list.setFilter("actor_type", value)}
              options={ACTOR_TYPES.map((value) => ({ value, label: ACTOR_TYPE_LABELS[value] }))}
              placeholder="Actor type"
              allowClear
              data-testid="audit-filter-actor-type"
            />
            <div className="w-full sm:w-40">
              <DateInput
                aria-label="From"
                value={list.filters.from ?? null}
                onChange={(value) => list.setFilter("from", value)}
                className="h-12 text-xs sm:h-8"
                max={list.filters.to}
                data-testid="audit-filter-from"
              />
            </div>
            <div className="w-full sm:w-40">
              <DateInput
                aria-label="To"
                value={list.filters.to ?? null}
                onChange={(value) => list.setFilter("to", value)}
                className="h-12 text-xs sm:h-8"
                min={list.filters.from}
                data-testid="audit-filter-to"
              />
            </div>
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        exportSource={{ path: AUDIT_PATH, params: list.params, filename: "audit-log.csv" }}
        exportTotal={query.data?.total}
        summary={query.data ? `${formatNumber(total)} entries` : undefined}
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
        onRowClick={setSelected}
        density="compact"
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          total,
          onPageChange: list.setPage,
          onPageSizeChange: list.setPageSize,
        }}
        emptyState={{
          icon: ScrollText,
          title: "No audit entries",
          description: list.hasActiveFilters
            ? "Nothing matches these filters."
            : "Changes will appear here as staff work.",
        }}
        data-testid="audit-table"
      />
      <AuditDetailSheet entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function AuditDetailSheet({ entry, onClose }: { entry: AuditLogRow | null; onClose: () => void }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const rows = useMemo(() => (entry ? diffSnapshots(entry.before, entry.after) : []), [entry]);
  const changed = rows.filter((row) => row.status !== "same");
  const visible = showUnchanged ? rows : changed;
  const href = entry ? entityHref(entry.entity_type, entry.entity_id) : null;

  return (
    <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent size="lg" data-testid="audit-detail-sheet">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <code className="rounded-xs bg-navy-50 px-1.5 py-0.5 font-mono text-sm">{entry?.action}</code>
            <span className="text-base font-semibold text-ink-muted">{entry ? humanize(entry.entity_type) : ""}</span>
          </SheetTitle>
          <SheetDescription>
            {entry && (
              <>
                {formatDateTime(entry.created_at, { zone: true })} ·{" "}
                {entry.actor_name ?? ACTOR_TYPE_LABELS[entry.actor_type]}
                {entry.ip ? ` · ${entry.ip}` : ""}
                {entry.request_id ? ` · req ${entry.request_id}` : ""}
              </>
            )}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
              <span className="money">{changed.length} changed</span>
              <span className="money">{rows.length - changed.length} unchanged</span>
              {entry?.entity_id && <span className="money font-mono">{entry.entity_id}</span>}
            </div>
            <div className="flex items-center gap-3">
              <Switch
                size="sm"
                label="Show unchanged"
                checked={showUnchanged}
                onCheckedChange={setShowUnchanged}
                data-testid="audit-show-unchanged"
              />
              {href && (
                <Button asChild variant="outline" size="sm" leftIcon={ExternalLink}>
                  <Link to={href}>Open</Link>
                </Button>
              )}
            </div>
          </div>
          {rows.length === 0 && (
            <p className="rounded-md border border-border bg-surface px-3 py-4 text-center text-xs text-ink-subtle">
              This entry carries no before/after snapshot.
            </p>
          )}
          {visible.length === 0 && rows.length > 0 && (
            <p className="rounded-md border border-border bg-surface px-3 py-4 text-center text-xs text-ink-subtle">
              No key changed in this entry.
            </p>
          )}
          {visible.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[32rem] text-xs">
                <thead className="bg-surface text-left text-2xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="w-40 px-2 py-1.5">Field</th>
                    <th className="px-2 py-1.5">Before</th>
                    <th className="px-2 py-1.5">After</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.key}
                      className={cn(
                        "border-t border-border align-top",
                        row.status === "changed" && "bg-gold-light/50",
                        row.status === "added" && "bg-success-bg/60",
                        row.status === "removed" && "bg-danger-bg/50",
                      )}
                      data-testid={`diff-row-${row.key}`}
                    >
                      <td className="px-2 py-1.5">
                        <span className="font-mono font-medium text-navy-950">{row.key}</span>
                        {row.status !== "same" && (
                          <span className="ml-1 text-[10px] uppercase text-ink-subtle">{row.status}</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5",
                          row.status === "changed" || row.status === "removed"
                            ? "text-danger-fg line-through decoration-danger/50"
                            : "text-ink-muted",
                        )}
                      >
                        <pre className="whitespace-pre-wrap break-all font-mono">{formatDiffValue(row.before)}</pre>
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5",
                          row.status === "changed" || row.status === "added"
                            ? "font-semibold text-success-fg"
                            : "text-ink-muted",
                        )}
                      >
                        <pre className="whitespace-pre-wrap break-all font-mono">{formatDiffValue(row.after)}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function LoginEventsTab() {
  const list = useListParams({ filterKeys: ["success", "from", "to"], defaultSort: "-created_at", prefix: "le_" });
  const query = useList<LoginEventRow>(LOGIN_EVENTS_PATH, list.params);

  const columns = useMemo<ColumnDef<LoginEventRow, unknown>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "When",
        meta: { locked: true, width: 170 },
        cell: ({ row }) => <span className="money">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        accessorKey: "identifier",
        header: "Identifier",
        cell: ({ row }) => <span className="font-medium">{row.original.identifier}</span>,
      },
      {
        accessorKey: "subject_type",
        header: "Surface",
        meta: { width: 100 },
        cell: ({ row }) => (
          <Badge variant={row.original.subject_type === "STAFF" ? "navy" : "info"}>
            {USER_TYPE_LABELS[row.original.subject_type]}
          </Badge>
        ),
      },
      {
        accessorKey: "success",
        header: "Result",
        meta: { width: 100 },
        cell: ({ row }) => (
          <StatusChip
            status={row.original.success ? "OK" : "FAILED"}
            label={row.original.success ? "Success" : "Failed"}
            size="sm"
          />
        ),
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: ({ row }) => (
          <span className="text-ink-muted">{row.original.reason ? humanize(row.original.reason) : "—"}</span>
        ),
      },
      {
        accessorKey: "ip",
        header: "IP",
        meta: { hideOnMobile: true },
        cell: ({ row }) => <span className="money font-mono text-xs text-ink-muted">{row.original.ip ?? "—"}</span>,
      },
      {
        accessorKey: "user_agent",
        header: "Device",
        meta: { hideOnMobile: true, sortKey: false },
        cell: ({ row }) => (
          <span
            className="block max-w-xs truncate text-xs text-ink-subtle"
            title={row.original.user_agent ?? undefined}
          >
            {row.original.user_agent ?? "—"}
          </span>
        ),
      },
    ],
    [],
  );

  const total = query.data?.total ?? 0;

  return (
    <>
      <Toolbar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search e-mail / phone…"
        filters={
          <>
            <Select
              aria-label="Result"
              size="sm"
              className="w-full sm:w-36"
              value={list.filters.success ?? null}
              onValueChange={(value) => list.setFilter("success", value)}
              options={[
                { value: "true", label: "Successful" },
                { value: "false", label: "Failed" },
              ]}
              placeholder="Any result"
              allowClear
              data-testid="login-filter-success"
            />
            <div className="w-full sm:w-40">
              <DateInput
                aria-label="From"
                value={list.filters.from ?? null}
                onChange={(value) => list.setFilter("from", value)}
                className="h-12 text-xs sm:h-8"
                data-testid="login-filter-from"
              />
            </div>
            <div className="w-full sm:w-40">
              <DateInput
                aria-label="To"
                value={list.filters.to ?? null}
                onChange={(value) => list.setFilter("to", value)}
                className="h-12 text-xs sm:h-8"
                data-testid="login-filter-to"
              />
            </div>
          </>
        }
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.reset}
        summary={query.data ? `${formatNumber(total)} attempts` : undefined}
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
        density="compact"
        rowClassName={(row) => (row.success ? undefined : "[&>td]:bg-danger-bg/30")}
        pagination={{
          page: list.page,
          pageSize: list.pageSize,
          total,
          onPageChange: list.setPage,
          onPageSizeChange: list.setPageSize,
        }}
        emptyState={{
          icon: ScrollText,
          title: "No login events",
          description: "Sign-in attempts from the ERP and the customer portal show here.",
        }}
        data-testid="login-events-table"
      />
    </>
  );
}
