import { useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { NOTIFICATION_TYPE_LABELS, type NotificationRow } from "@kkt/contracts";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useList, useListParams, useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { NOTIFICATIONS_PATH } from "./adminApi";

const INVALIDATE = [["notifications"], [NOTIFICATIONS_PATH]] as const;

/** `/notifications` — everything that needs attention, newest first, with read state and mark-all-read. */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useListParams({ filterKeys: ["unread_only"], defaultSort: "-created_at" });
  const unreadOnly = list.filters.unread_only === "true";
  const query = useList<NotificationRow>(NOTIFICATIONS_PATH, list.params);

  const invalidate = () => Promise.all(INVALIDATE.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));

  const markRead = useMutationWithToast<unknown, string[]>({
    mutationFn: (ids) => api.post<unknown>(`${NOTIFICATIONS_PATH}/mark-read`, { ids }),
    successMessage: false,
    errorMessage: false,
    onSuccess: () => void invalidate(),
  });
  const markAll = useMutationWithToast<unknown, void>({
    mutationFn: () => api.post<unknown>(`${NOTIFICATIONS_PATH}/mark-read`, { all: true }),
    successMessage: "All notifications marked read",
    onSuccess: () => void invalidate(),
  });

  const open = (item: NotificationRow) => {
    if (!item.is_read) markRead.mutate([item.id]);
    if (item.link) navigate(item.link);
  };

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const unreadOnPage = items.filter((item) => !item.is_read).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Enquiries, bounced cheques, demands, stage completions and service tickets that need your attention."
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Notifications" }]}
        actions={
          <Button variant="outline" leftIcon={CheckCheck} loading={markAll.isPending} disabled={total === 0} onClick={() => markAll.mutate()} data-testid="notifications-mark-all-btn">
            Mark all read
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs value={unreadOnly ? "unread" : "all"} onValueChange={(value) => list.setFilter("unread_only", value === "unread" ? "true" : null)}>
          <TabsList variant="pills">
            <TabsTrigger value="all" data-testid="notifications-tab-all">
              All
            </TabsTrigger>
            <TabsTrigger value="unread" count={unreadOnly ? total : undefined} data-testid="notifications-tab-unread">
              Unread
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {query.data && (
          <span className="money text-xs text-ink-subtle">
            {formatNumber(total)} {unreadOnly ? "unread" : "total"}
            {!unreadOnly && unreadOnPage > 0 ? ` · ${unreadOnPage} unread on this page` : ""}
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        {query.isPending && (
          <ul className="divide-y divide-border">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="flex gap-3 px-4 py-3">
                <Skeleton className="mt-1.5 size-2 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />}
        {query.data && items.length === 0 && <EmptyState icon={Bell} title={unreadOnly ? "You're all caught up" : "No notifications yet"} description="New enquiries, cheques and demands will show here." />}
        {items.length > 0 && (
          <ul className={cn("divide-y divide-border", query.isFetching && "opacity-70")} data-testid="notifications-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-navy-50/70 focus-ring-inset"
                  data-testid={`notification-${item.id}`}
                >
                  <span className={cn("mt-2 size-2 shrink-0 rounded-full", item.is_read ? "bg-border" : "bg-gold")} aria-label={item.is_read ? "Read" : "Unread"} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("truncate text-sm", item.is_read ? "text-ink" : "font-semibold text-navy-950")}>{item.title}</span>
                      <Badge variant="neutral">{NOTIFICATION_TYPE_LABELS[item.type] ?? item.type}</Badge>
                      {item.is_withdrawn && <Badge variant="danger">Withdrawn</Badge>}
                    </span>
                    {item.body && <span className="mt-0.5 block text-xs text-ink-muted">{item.body}</span>}
                    <span className="money mt-1 block text-2xs text-ink-subtle" title={formatDateTime(item.created_at, { zone: true })}>
                      {formatRelative(item.created_at)}
                      {item.read_at ? ` · read ${formatRelative(item.read_at)}` : ""}
                    </span>
                  </span>
                  {item.link && <ExternalLink className="mt-1 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {total > list.pageSize && <Pagination page={list.page} pageSize={list.pageSize} total={total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} className="mt-3" disabled={query.isFetching} />}
    </>
  );
}
