// Desktop (≥1024 px) navigation shell: persistent navy sidebar beside every
// authenticated screen (tabs and stack screens alike). Mounted in app/_layout.
import { View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { useConfig, useNotificationCount, useRequests } from "@/src/hooks";
import { fonts, makeStyles, radius, useTheme } from "@/src/theme";
import { Press, type IconName } from "./primitives";
import { T } from "./text";

type Item = { href: Href; label: string; icon: IconName; match: (p: string) => boolean; badge?: number; secondary?: boolean };

function SideItem({ it, on }: { it: Item; on: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const tint = on ? colors.gold : it.secondary ? colors.muted : colors.mutedInverse;
  return (
    <Press haptics={false} onPress={() => router.navigate(it.href)} testID={`side-${it.label.toLowerCase()}`} style={[s.side, on && s.sideOn]} accessibilityLabel={it.label}>
      <Feather name={it.icon} size={18} color={tint} />
      <T style={[s.sideText, it.secondary && s.sideTextSecondary, on && s.sideTextOn]} numberOfLines={1}>
        {it.label}
      </T>
      {it.badge ? (
        <View style={s.badge} testID={`side-${it.label.toLowerCase()}-badge`}>
          <T style={s.badgeText}>{it.badge > 99 ? "99+" : it.badge}</T>
        </View>
      ) : null}
    </Press>
  );
}

export function Sidebar() {
  const s = useStyles();
  const path = usePathname() || "/";
  const { me, logout } = useAuth();
  const cfg = useConfig();
  const unread = useNotificationCount().data || 0;
  const awaiting = (useRequests().data || []).filter((r) => r.status === "Awaiting Customer").length;
  const main: Item[] = [
    { href: "/", label: "Home", icon: "home", match: (p) => p === "/" || p.startsWith("/flat") || p.startsWith("/bank") },
    { href: "/payments", label: "Payments", icon: "credit-card", match: (p) => p.startsWith("/payments") },
    { href: "/construction", label: "Construction", icon: "layers", match: (p) => p.startsWith("/construction") },
    { href: "/requests", label: "Requests", icon: "message-square", match: (p) => p.startsWith("/requests"), badge: awaiting },
  ];
  const extra: Item[] = [
    { href: "/notifications", label: "Notifications", icon: "bell", match: (p) => p.startsWith("/notifications"), badge: unread },
    { href: "/documents", label: "Documents", icon: "folder", match: (p) => p.startsWith("/documents") },
    { href: "/notices", label: "Notices", icon: "clipboard", match: (p) => p.startsWith("/notices") },
    { href: "/more", label: "More", icon: "grid", match: (p) => p.startsWith("/more") || p.startsWith("/profile") || p.startsWith("/change-password"), secondary: true },
  ];
  return (
    <View style={s.sidebar} testID="sidebar-nav">
      <View style={s.brand}>
        <Image source={cfg.logo_url ? { uri: cfg.logo_url } : require("@/assets/images/logo-mark.png")} style={s.logo} contentFit="cover" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T style={s.brandName} numberOfLines={2}>
            {cfg.brand}
          </T>
          <T v="small" tone="inverseMuted">
            Customer portal
          </T>
        </View>
      </View>
      <View style={s.buyer} testID="sidebar-buyer">
        <T style={s.buyerLabel} numberOfLines={1}>
          Signed in as
        </T>
        <T v="bodyStrong" tone="inverse" numberOfLines={1}>
          {me?.customer?.full_name || "—"}
        </T>
        <T v="small" tone="inverseMuted" numberOfLines={1}>
          {me?.customer?.customer_code}
        </T>
      </View>
      <View style={{ gap: 4 }}>
        {main.map((it) => (
          <SideItem key={it.label} it={it} on={it.match(path)} />
        ))}
      </View>
      <View style={s.sep} />
      <View style={{ gap: 4 }}>
        {extra.map((it) => (
          <SideItem key={it.label} it={it} on={it.match(path)} />
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <Press haptics={false} onPress={() => logout()} testID="side-logout" style={s.side} accessibilityLabel="Sign out">
        <Feather name="log-out" size={18} color={s.logoutText.color as string} />
        <T style={[s.sideText, s.logoutText]}>Sign out</T>
      </Press>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  sidebar: { width: 264, backgroundColor: c.surfaceInverse, paddingHorizontal: 16, paddingTop: 32, paddingBottom: 24, gap: 24 },
  brand: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8 },
  logo: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: c.gold },
  brandName: { fontFamily: fonts.serifBold, fontSize: 20, lineHeight: 22, color: c.onSurfaceInverse },
  buyer: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  buyerLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: "uppercase", color: c.mutedInverse },
  side: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderLeftWidth: 3, borderLeftColor: "transparent" },
  sideOn: { backgroundColor: "rgba(201,162,39,0.14)", borderLeftColor: c.gold },
  sideText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14.5, color: c.mutedInverse },
  sideTextSecondary: { fontFamily: fonts.medium, fontSize: 13.5, color: "#94A0B4" },
  sideTextOn: { color: c.onSurfaceInverse, fontFamily: fonts.bold },
  logoutText: { color: "#94A0B4" },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { fontFamily: fonts.extrabold, fontSize: 11, color: c.onBrandSecondary },
  sep: { height: 1, backgroundColor: "rgba(255,255,255,0.1)", marginHorizontal: 8 },
}));
