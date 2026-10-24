import { Platform, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import Constants from "expo-constants";
import * as Application from "expo-application";
import { Feather } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { useBookings, useConfig, useNotices, useNotificationCount } from "@/src/hooks";
import { phoneDigits } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Button, Card, IconButton, Press, type IconName } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { openUrl, RMCard } from "@/src/screens/home/widgets";
import { confirm } from "@/src/ui/confirm";

type Row = { title: string; sub: string; icon: IconName; onPress: () => void; testID: string };

function Rows({ rows }: { rows: Row[] }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Card style={{ paddingVertical: 4 }}>
      {rows.map((r, i) => (
        <Press key={r.testID} onPress={r.onPress} testID={r.testID} style={[s.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
          <View style={s.icon}>
            <Feather name={r.icon} size={20} color={colors.onSurface} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{r.title}</T>
            <T v="small" tone="muted" numberOfLines={1}>
              {r.sub}
            </T>
          </View>
          <Feather name="chevron-right" size={18} color={colors.muted} />
        </Press>
      ))}
    </Card>
  );
}

export default function More() {
  const router = useRouter();
  const { me, logout } = useAuth();
  const cfg = useConfig();
  const { data: bookings } = useBookings();
  const notices = useNotices();
  const unread = notices.data?.unread ?? me?.unread_notices ?? 0;
  const notifUnread = useNotificationCount().data || 0;
  const go = (h: Href) => () => router.push(h);
  const version = Application.nativeApplicationVersion || Constants.expoConfig?.version || "1.0.0";
  const build = Application.nativeBuildVersion;
  const support = phoneDigits(cfg.primary_phone);

  const account: Row[] = [
    ...(bookings || []).map((b) => ({ title: `My Flat ${b.flat_number}`, sub: `${b.project_name} · ${b.booking_number}`, icon: "home" as IconName, onPress: go(`/flat/${b.id}`), testID: `more-flat-${b.booking_number}` })),
    { title: "Documents", sub: "Allotment letter, statement, shared files", icon: "folder", onPress: go("/documents"), testID: "more-documents" },
    { title: "Notifications", sub: notifUnread ? `${notifUnread} unread` : "Dues, construction, replies", icon: "bell", onPress: go("/notifications"), testID: "more-notifications" },
    { title: "Notices", sub: unread ? `${unread} unread` : "Updates from the builder", icon: "clipboard", onPress: go("/notices"), testID: "more-notices" },
    { title: "Bank details", sub: "Where to transfer the Account component", icon: "briefcase", onPress: go("/bank"), testID: "more-bank" },
  ];
  const security: Row[] = [
    { title: "Profile & contact details", sub: "Email, alternate phone, address, co-applicants", icon: "user", onPress: go("/profile"), testID: "more-profile" },
    { title: "Change password", sub: "Signs you out on other devices", icon: "key", onPress: go("/change-password"), testID: "more-change-password" },
  ];
  const help: Row[] = [
    ...(support ? [{ title: "Call support", sub: cfg.primary_phone || "", icon: "phone" as IconName, onPress: () => openUrl(`tel:+${support}`), testID: "more-support-call" }] : []),
    ...(cfg.support_email ? [{ title: "Email support", sub: cfg.support_email, icon: "mail" as IconName, onPress: () => openUrl(`mailto:${cfg.support_email}`), testID: "more-support-email" }] : []),
  ];

  return (
    <Screen tabbed testID="more-screen" refreshKeys={[["p-bookings"], ["p-notices"], ["p-notif-count"]]}>
      <PageHeader
        title="More"
        sub={me?.customer ? `${me.customer.full_name} · ${me.customer.customer_code}` : undefined}
        right={<IconButton icon="bell" label="Notifications" badge={notifUnread} onPress={go("/notifications")} testID="more-notifications-bell" />}
      />
      <Rows rows={account} />
      <T v="label" tone="muted" style={{ marginTop: 6 }}>
        Account & security
      </T>
      <Rows rows={security} />
      {help.length ? (
        <>
          <T v="label" tone="muted" style={{ marginTop: 6 }}>
            Help & support
          </T>
          <Rows rows={help} />
        </>
      ) : null}
      <RMCard rm={me?.relationship_manager ?? null} fallbackPhone={cfg.primary_phone} whatsapp={cfg.whatsapp} />
      <View style={{ gap: 10, marginTop: 4 }}>
        <Button kind="ghost" icon="log-out" label="Sign out" onPress={() => logout()} testID="more-logout" />
        <Button kind="danger" icon="shield-off" label="Sign out on all devices" onPress={async () => (await confirm("Sign out everywhere?", "You'll be signed out on every phone and browser, including this one.", "Sign out all", true)) && logout({ everywhere: true })} testID="more-logout-all" />
      </View>
      <View style={{ alignItems: "center", marginTop: 8, gap: 2 }} testID="more-about">
        <T v="small" tone="muted">
          {me?.company?.legal_name || cfg.brand} · Customer portal
        </T>
        <T v="small" tone="muted" testID="more-app-version">
          Version {version}
          {build ? ` (${build})` : ""} · {Platform.OS}
        </T>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.navy50, alignItems: "center", justifyContent: "center" },
}));
