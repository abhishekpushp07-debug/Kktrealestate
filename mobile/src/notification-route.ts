// Pure mapping from a portal notification to an in-app destination (no imports,
// so it can be unit-checked with plain Node: see memory/mobile/iteration_5.md).

export type PortalNotification = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  booking_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  is_read: boolean;
  created_at: string;
};

export type NotificationTarget = {
  pathname: string;
  params?: Record<string, string>;
  bookingId?: string | null; // switch the active booking before navigating
} | null;

export function notificationTarget(n: Pick<PortalNotification, "type" | "booking_id" | "entity_type" | "entity_id">): NotificationTarget {
  const t = n.type || "";
  if (t.startsWith("demand.")) return { pathname: "/payments", params: { tab: "demands" }, bookingId: n.booking_id ?? null };
  if (t === "stage.completed") return { pathname: "/construction", bookingId: n.booking_id ?? null };
  if (t === "ticket.reply") return n.entity_id ? { pathname: `/requests/${n.entity_id}` } : { pathname: "/requests" };
  if (t === "notice.published") return n.entity_id ? { pathname: `/notices/${n.entity_id}` } : { pathname: "/notices" };
  return null;
}

export const notificationIcon = (type: string) =>
  type.startsWith("demand.overdue")
    ? "alert-triangle"
    : type.startsWith("demand.")
      ? "file-text"
      : type === "stage.completed"
        ? "layers"
        : type === "ticket.reply"
          ? "message-circle"
          : type === "notice.published"
            ? "bell"
            : "info";
