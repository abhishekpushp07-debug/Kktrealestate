import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ListEnvelope } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface UnreadCountResponse {
  count?: number;
  unread?: number;
  unread_count?: number;
}

export interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  created_at: string | null;
  read: boolean;
  href: string | null;
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/** Tolerant mapping of a notification row (title/body/link field names vary by module). */
export function normaliseNotification(raw: unknown): NotificationRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = pickString(record, ["id"]);
  if (!id) return null;
  return {
    id,
    title: pickString(record, ["title", "subject", "type"]) ?? "Notification",
    body: pickString(record, ["body", "message", "text"]),
    created_at: pickString(record, ["created_at", "createdAt"]),
    read: record.read_at !== undefined ? record.read_at !== null : record.is_read === true || record.read === true,
    href: pickString(record, ["href", "link", "url"]),
  };
}

export const notificationKeys = {
  unread: ["notifications", "unread-count"] as const,
  list: ["notifications", "list", "bell"] as const,
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const unread = useQuery({
    queryKey: notificationKeys.unread,
    queryFn: ({ signal }) => api.get<UnreadCountResponse>("/notifications/unread-count", { signal }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
    select: (data) => data.count ?? data.unread ?? data.unread_count ?? 0,
  });

  const list = useQuery({
    queryKey: notificationKeys.list,
    queryFn: ({ signal }) => api.get<ListEnvelope<unknown> | unknown[]>("/notifications", { query: { page_size: 10 }, signal }),
    enabled: open,
    retry: false,
    select: (data) => (Array.isArray(data) ? data : data.items).map(normaliseNotification).filter((row): row is NotificationRow => row !== null),
  });

  const count = unread.data ?? 0;
  const badge = count > 99 ? "99+" : String(count);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="relative size-9 px-0"
          aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
          title="Notifications"
          data-testid="notification-bell"
        >
          <Bell aria-hidden="true" />
          {count > 0 && (
            <span className="money pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-navy-950 ring-2 ring-card" aria-hidden="true">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="font-display text-sm font-bold text-navy-950">Notifications</p>
          {count > 0 && <span className="text-xs text-ink-subtle">{count} unread</span>}
        </div>
        <div className="max-h-80 overflow-y-auto scrollbar-thin">
          {list.isPending && (
            <div className="space-y-3 p-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          )}
          {list.isError && <EmptyState compact icon={BellOff} title="Notifications unavailable" description="Could not load notifications right now." />}
          {list.data && list.data.length === 0 && <EmptyState compact icon={Bell} title="You're all caught up" description="New enquiries, cheques and demands will show here." />}
          {list.data && list.data.length > 0 && (
            <ul className="divide-y divide-border">
              {list.data.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-navy-50 focus-ring-inset"
                    onClick={() => {
                      setOpen(false);
                      if (item.href) navigate(item.href);
                    }}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-gold")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", item.read ? "text-ink" : "font-semibold text-navy-950")}>{item.title}</span>
                      {item.body && <span className="block truncate text-xs text-ink-subtle">{item.body}</span>}
                    </span>
                    {item.created_at && <time dateTime={item.created_at} className="money shrink-0 text-2xs text-ink-subtle">{formatRelative(item.created_at)}</time>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-border px-3 py-2 text-center">
          <Link to="/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-navy-700 hover:text-navy-950 hover:underline focus-ring rounded-xs">
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
