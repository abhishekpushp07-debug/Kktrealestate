import { useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { useActiveBooking, useConfig, useNotices, useNotificationCount } from "@/src/hooks";
import { openFile } from "@/src/api/pdf";
import { errMsg } from "@/src/api/client";
import { firstName, greeting } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { Screen } from "@/src/ui/screen";
import { Card, IconButton, Press } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { SkeletonScreen } from "@/src/ui/skeleton";
import { ErrorState, NoBooking } from "@/src/ui/states";
import { BookingSwitcher } from "@/src/ui/booking-switcher";
import { stripMarkdown } from "@/src/ui/markdown";
import { toast } from "@/src/ui/toast";
import { HeroCard } from "@/src/screens/home/hero-card";
import { NextDue, PaymentSummary } from "@/src/screens/home/payment-cards";
import { QuickAction, RMCard } from "@/src/screens/home/widgets";
import { PaymentPlanCard } from "@/src/screens/plan";

export default function Home() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { me } = useAuth();
  const cfg = useConfig();
  const { width } = useWindowDimensions();
  const { items, active, select, isLoading, isError, error, refetch } = useActiveBooking();
  const notices = useNotices();
  const notifCount = useNotificationCount();
  const [pdfBusy, setPdfBusy] = useState(false);
  const unread = notices.data?.unread ?? me?.unread_notices ?? 0;
  const firstUnread = (notices.data?.items || []).find((n) => !n.read);
  const wide = width >= 768;

  const statement = async () => {
    if (!active) return;
    setPdfBusy(true);
    try {
      await openFile(`/bookings/${active.id}/statement.pdf`, `statement-${active.booking_number}.pdf`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Screen tabbed testID="home-screen" refreshKeys={[["p-bookings"], ["p-notices"], ["p-requests"], ["p-booking"], ["p-notif-count"]]}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <T tone="secondary">{greeting()},</T>
          <T v="display" testID="home-greeting">
            {firstName(me?.customer?.full_name) || "Welcome"}
          </T>
        </View>
        <IconButton icon="bell" label="Notifications" badge={notifCount.data || 0} onPress={() => router.push("/notifications")} testID="home-notifications-bell" />
      </View>

      {isLoading ? (
        <SkeletonScreen />
      ) : isError ? (
        <ErrorState message={errMsg(error)} onRetry={refetch} />
      ) : !active ? (
        <NoBooking />
      ) : (
        <>
          <BookingSwitcher items={items} active={active} select={select} />
          <HeroCard b={active} />

          {unread > 0 && firstUnread ? (
            <Press onPress={() => router.push(`/notices/${firstUnread.id}`)} testID="home-notice-banner">
              <Card style={s.notice}>
                <View style={s.noticeIcon}>
                  <Feather name="bell" size={16} color={colors.onBrandSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <T v="label" tone="gold">
                    {unread} new notice{unread > 1 ? "s" : ""}
                  </T>
                  <T v="bodyStrong" numberOfLines={2}>
                    {firstUnread.title}
                  </T>
                  <T v="small" tone="secondary" numberOfLines={2}>
                    {stripMarkdown(firstUnread.body)}
                  </T>
                </View>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Card>
            </Press>
          ) : null}

          <View style={[s.grid, wide && s.gridWide]}>
            <PaymentSummary b={active} wide={wide} />
            <NextDue b={active} onStatement={statement} busy={pdfBusy} wide={wide} />
          </View>

          <PaymentPlanCard plan={active.payment_plan} next={active.next_installment} showLink testID="home-plan-card" />

          <View style={s.qaRow}>
            <QuickAction icon="download" label="Download statement" onPress={statement} busy={pdfBusy} testID="home-quick-statement" />
            <QuickAction icon="briefcase" label="Bank details" onPress={() => router.push("/bank")} testID="home-quick-bank" />
            <QuickAction icon="plus-circle" label="Raise a request" onPress={() => router.push("/requests/new")} testID="home-quick-request" />
            <QuickAction icon="folder" label="Documents" onPress={() => router.push("/documents")} testID="home-quick-documents" />
          </View>

          <RMCard rm={me?.relationship_manager ?? null} fallbackPhone={cfg.primary_phone} whatsapp={cfg.whatsapp} />
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  header: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginBottom: 4 },
  notice: { flexDirection: "row", alignItems: "center", gap: 12, borderLeftWidth: 4, borderLeftColor: c.gold, paddingVertical: 14 },
  noticeIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  grid: { gap: 14 },
  gridWide: { flexDirection: "row", alignItems: "stretch" },
  qaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
}));
