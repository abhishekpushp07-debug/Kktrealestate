import { useState } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";

import { useActiveBooking, useNotifications } from "@/src/hooks";
import { api, errMsg } from "@/src/api/client";
import { fmtDateTime } from "@/src/format";
import { haptic } from "@/src/haptics";
import { notificationIcon, notificationTarget, type PortalNotification } from "@/src/notification-route";
import { makeStyles, radius, useTheme } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Button, Card, Press } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { SkeletonList } from "@/src/ui/skeleton";
import { Empty, ErrorState } from "@/src/ui/states";
import { toast } from "@/src/ui/toast";

function Row({ n, onPress, last }: { n: PortalNotification; onPress: () => void; last: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const overdue = n.type === "demand.overdue";
  return (
    <Press onPress={onPress} testID={`notification-${n.id}`} style={[s.row, !n.is_read && s.unread, last && { borderBottomWidth: 0 }]}>
      <View style={[s.icon, overdue && s.iconOverdue]}>
        <Feather name={notificationIcon(n.type) as any} size={17} color={overdue ? colors.error : colors.gold} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={s.titleRow}>
          <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
            {n.title}
          </T>
          {!n.is_read ? <View style={s.dot} testID={`notification-unread-${n.id}`} /> : null}
        </View>
        {n.body ? (
          <T v="small" tone="muted" numberOfLines={3}>
            {n.body}
          </T>
        ) : null}
        <T v="small" tone="muted" style={{ marginTop: 2 }}>
          {fmtDateTime(n.created_at)}
        </T>
      </View>
    </Press>
  );
}

export default function Notifications() {
  const router = useRouter();
  const qc = useQueryClient();
  const { select } = useActiveBooking();
  const q = useNotifications();
  const [busyAll, setBusyAll] = useState(false);
  const items = (q.data?.pages || []).flatMap((p) => p.items);
  const unread = q.data?.pages?.[0]?.unread_count ?? 0;
  const total = q.data?.pages?.[0]?.total ?? 0;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["p-notifs"] });
    qc.invalidateQueries({ queryKey: ["p-notif-count"] });
  };

  const open = async (n: PortalNotification) => {
    if (!n.is_read) api.post(`/notifications/${n.id}/read`).then(refresh).catch(() => {});
    const t = notificationTarget(n);
    if (!t) return;
    if (t.bookingId) select(t.bookingId);
    router.push({ pathname: t.pathname, params: t.params } as Href);
  };

  const readAll = async () => {
    setBusyAll(true);
    try {
      await api.post("/notifications/read-all");
      haptic.success();
      toast.success("All notifications marked as read");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyAll(false);
    }
  };

  return (
    <Screen testID="notifications-screen" refreshKeys={[["p-notifs"], ["p-notif-count"]]}>
      <PageHeader
        back
        title="Notifications"
        sub={unread ? `${unread} unread` : total ? "You're all caught up" : undefined}
        right={unread ? <Button small kind="ghost" icon="check-circle" label="Mark all read" loading={busyAll} onPress={readAll} testID="notifications-mark-all" /> : null}
      />
      {q.isLoading ? (
        <SkeletonList rows={4} h={84} />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={q.refetch} />
      ) : !items.length ? (
        <Empty
          icon="bell"
          title="No notifications yet"
          hint="We'll let you know here when a payment is due, a construction stage is completed, our team replies to your request or a new notice is published."
          testID="notifications-empty"
        />
      ) : (
        <>
          <Card style={{ paddingVertical: 4 }} testID="notifications-list">
            {items.map((n, i) => (
              <Row key={n.id} n={n} last={i === items.length - 1} onPress={() => open(n)} />
            ))}
          </Card>
          {q.hasNextPage ? (
            <Button kind="ghost" label={q.isFetchingNextPage ? "Loading…" : "Load more"} loading={q.isFetchingNextPage} onPress={() => q.fetchNextPage()} testID="notifications-load-more" />
          ) : (
            <T v="small" tone="muted" style={{ textAlign: "center" }} testID="notifications-end">
              {total} notification{total === 1 ? "" : "s"}
            </T>
          )}
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: 12, paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.divider, borderRadius: radius.sm },
  unread: { backgroundColor: c.brandTertiary, paddingHorizontal: 10, marginHorizontal: -6 },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surfaceInverse, alignItems: "center", justifyContent: "center" },
  iconOverdue: { backgroundColor: c.errorSoft },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.gold, marginTop: 6 },
}));
