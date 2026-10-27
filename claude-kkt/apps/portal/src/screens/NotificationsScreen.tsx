import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import type { PortalNotificationRow } from "@kkt/contracts";
import { queryClient, useMarkRead, useNotifications } from "@/api/queries";
import { useBooking } from "@/booking/BookingProvider";
import { formatRelative } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Icon, type IconName } from "@/ui/Icon";
import { Header, Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { EmptyState, ErrorState, StatusBar } from "@/ui/States";
import { T } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

/** Where a notification leads (by its `screen`), keeping the booking switcher in sync. */
export function hrefForNotification(n: PortalNotificationRow): string {
  switch (n.screen) {
    case "LEDGER":
      return "/payments?tab=ledger";
    case "DEMANDS":
      return "/payments?tab=demands";
    case "SCHEDULE":
      return "/payments?tab=schedule";
    case "CONSTRUCTION":
      return "/construction";
    case "REQUEST":
      return n.entity_id ? `/more/requests/${n.entity_id}` : "/more/requests";
    case "NOTICE":
      return n.entity_id ? `/more/notices/${n.entity_id}` : "/more/notices";
    case "DOCUMENTS":
      return "/more/documents";
    case "HOME":
    default:
      return "/";
  }
}

const ICONS: Record<PortalNotificationRow["screen"], IconName> = {
  HOME: "home",
  LEDGER: "rupee",
  DEMANDS: "notice",
  SCHEDULE: "calendar",
  CONSTRUCTION: "construction",
  REQUEST: "request",
  NOTICE: "notice",
  DOCUMENTS: "document",
};

export function NotificationsScreen(): React.JSX.Element {
  const router = useRouter();
  const q = useNotifications();
  const markRead = useMarkRead();
  const { select, bookings } = useBooking();
  const rows = q.data?.items ?? [];
  const unread = rows.filter((n) => !n.is_read).length;

  const open = (n: PortalNotificationRow) => {
    if (!n.is_read) markRead.mutate({ ids: [n.id], all: false });
    if (n.booking_id && bookings.some((b) => b.booking_id === n.booking_id)) select(n.booking_id);
    router.navigate(hrefForNotification(n));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up"}
        back
        right={
          unread ? (
            <Button
              title="Mark all read"
              variant="ghost"
              size="sm"
              loading={markRead.isPending}
              onPress={() => markRead.mutate({ all: true })}
            />
          ) : undefined
        }
      />
      {q.isError && q.data ? <StatusBar text="Showing saved notifications — couldn't refresh." tone="warning" /> : null}
      <Screen onRefresh={() => queryClient.invalidateQueries({ queryKey: ["notifications"] })}>
        {!q.data ? (
          q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <SkeletonRows rows={5} />
          )
        ) : rows.length === 0 ? (
          <EmptyState
            icon="bell"
            title="No notifications"
            body="Demands, construction updates, replies and notices will show up here."
          />
        ) : (
          <Card padded={false}>
            {rows.map((n, i) => (
              <Pressable
                key={n.id}
                accessibilityRole="button"
                onPress={() => open(n)}
                style={({ pressed }) => [
                  styles.row,
                  !n.is_read ? styles.unread : null,
                  i < rows.length - 1 ? styles.border : null,
                  pressed ? { opacity: 0.8 } : null,
                ]}
              >
                <View style={[styles.iconWrap, !n.is_read ? { backgroundColor: colors.gold100 } : null]}>
                  <Icon name={ICONS[n.screen]} size={18} color={!n.is_read ? colors.gold700 : colors.navy} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant={n.is_read ? "body" : "bodyStrong"} numberOfLines={2}>
                    {n.title}
                  </T>
                  <T variant="small" color={colors.inkMuted} numberOfLines={3}>
                    {n.body}
                  </T>
                  <T variant="caption" color={colors.inkSubtle}>
                    {formatRelative(n.created_at)}
                  </T>
                </View>
                <Icon name="chevron-right" size={16} color={colors.inkSubtle} />
              </Pressable>
            ))}
          </Card>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md },
  unread: { backgroundColor: colors.gold50 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.navy50,
    alignItems: "center",
    justifyContent: "center",
  },
});
