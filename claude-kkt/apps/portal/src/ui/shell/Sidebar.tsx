// Desktop (≥ 1024 px) navigation rail: navy, gold active indicator, booking switcher, sign-out.
import { usePathname, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnreadCount } from "@/api/queries";
import { useAuth } from "@/auth/AuthProvider";
import { Badge } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { Avatar } from "@/ui/ListRow";
import { T } from "@/ui/Text";
import { colors, radius, SIDEBAR_WIDTH, space } from "@/ui/theme";
import { BookingChip } from "./BookingSwitcher";
import { SIDEBAR_SECTIONS } from "./nav";

export function Sidebar(): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const unread = useUnreadCount().data?.count ?? 0;
  return (
    <View style={[styles.rail, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.brand}>
        <View style={styles.mark}>
          <Icon name="diamond" size={18} color={colors.gold} />
        </View>
        <View>
          <T variant="h2" color={colors.onNavy} style={{ fontSize: 24, lineHeight: 28 }}>
            KKT
          </T>
          <T variant="label" color={colors.gold}>
            My Home
          </T>
        </View>
      </View>
      <View style={{ paddingHorizontal: space.lg, marginBottom: space.lg }}>
        <BookingChip onNavy block />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.lg }}>
        {SIDEBAR_SECTIONS.map((section, si) => (
          <View key={si} style={{ gap: 2 }}>
            {section.title ? (
              <T variant="label" color={colors.onNavySubtle} style={styles.sectionTitle}>
                {section.title}
              </T>
            ) : null}
            {section.links.map((link) => {
              const active = link.match(pathname);
              return (
                <Pressable
                  key={link.key}
                  accessibilityRole="link"
                  accessibilityState={{ selected: active }}
                  onPress={() => router.navigate(link.href)}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.link,
                    active ? styles.linkActive : null,
                    pressed || hovered ? styles.linkHover : null,
                  ]}
                >
                  <View style={[styles.indicator, active ? styles.indicatorActive : null]} />
                  <Icon name={link.icon} size={20} color={active ? colors.gold : colors.onNavyMuted} />
                  <T variant="bodyStrong" color={active ? colors.onNavy : colors.onNavyMuted} style={{ flex: 1 }}>
                    {link.label}
                  </T>
                  {link.key === "notifications" ? <Badge count={unread} /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable accessibilityRole="link" onPress={() => router.navigate("/more/profile")} style={styles.user}>
          <Avatar name={user?.full_name ?? "?"} size={36} onNavy />
          <View style={{ flex: 1 }}>
            <T variant="bodyStrong" color={colors.onNavy} numberOfLines={1}>
              {user?.full_name ?? ""}
            </T>
            <T variant="caption" color={colors.onNavySubtle} numberOfLines={1}>
              {user?.customer_code ?? ""}
            </T>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void logout()}
          style={({ pressed }) => [styles.signout, pressed ? styles.linkHover : null]}
        >
          <Icon name="logout" size={18} color={colors.onNavyMuted} />
          <T variant="small" color={colors.onNavyMuted}>
            Sign out
          </T>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.navy,
    height: "100%",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.06)",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xl,
    marginBottom: space.xl,
  },
  mark: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: "rgba(201,162,39,0.14)",
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { paddingHorizontal: space.xl, marginBottom: 6 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 11,
    paddingLeft: space.lg,
    paddingRight: space.xl,
    marginHorizontal: space.sm,
    borderRadius: radius.md,
  },
  linkActive: { backgroundColor: "rgba(255,255,255,0.08)" },
  linkHover: { backgroundColor: "rgba(255,255,255,0.06)" },
  indicator: { width: 3, height: 20, borderRadius: 2, backgroundColor: "transparent", marginLeft: -space.sm },
  indicatorActive: { backgroundColor: colors.gold },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.sm,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  user: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 6 },
  signout: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
  },
});
