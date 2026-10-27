// Phone bottom tab bar: navy, gold active indicator, safe-area aware. The tab bar is laid out
// BELOW the screens (not overlaid), so content is never hidden behind it.
import type { BottomTabBarProps } from "expo-router/tabs";
import { Pressable, StyleSheet, View } from "react-native";
import { useUnreadCount } from "@/api/queries";
import { haptics } from "@/lib/haptics";
import { Badge } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { T } from "@/ui/Text";
import { colors, space, TAB_BAR_BASE_HEIGHT } from "@/ui/theme";
import { TAB_DESTINATIONS } from "./nav";

export function TabBar({ state, navigateToTab, insets }: BottomTabBarProps): React.JSX.Element {
  const unread = useUnreadCount().data?.count ?? 0;
  const bottom = Math.max(insets.bottom, 8);
  return (
    <View
      style={[styles.bar, { height: TAB_BAR_BASE_HEIGHT + bottom, paddingBottom: bottom }]}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, index) => {
        const dest = TAB_DESTINATIONS.find((d) => d.route === route.name);
        if (!dest) return null;
        const active = state.index === index;
        return (
          <View key={route.key} style={styles.itemWrap}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={dest.key === "more" && unread > 0 ? `${dest.label}, ${unread} unread` : dest.label}
              onPress={() => {
                haptics.select();
                navigateToTab(route.key);
              }}
              style={({ pressed }) => [styles.item, pressed ? { opacity: 0.75 } : null]}
            >
              <View style={[styles.indicator, active ? styles.indicatorActive : null]} />
              <Icon name={dest.icon} size={22} color={active ? colors.gold : colors.onNavyMuted} />
              <T
                variant="caption"
                color={active ? colors.onNavy : colors.onNavyMuted}
                style={{ fontSize: 10.5, lineHeight: 13 }}
                numberOfLines={1}
              >
                {dest.label}
              </T>
            </Pressable>
            {/* the unread count sits outside the tab so the tab's visible text stays its label (the count is in its accessible name) */}
            {dest.key === "more" && unread > 0 ? (
              <View aria-hidden pointerEvents="none" style={styles.badge}>
                <Badge count={unread} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.navy,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  itemWrap: { flex: 1 },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingTop: space.sm },
  indicator: {
    position: "absolute",
    top: 0,
    width: 28,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: "transparent",
  },
  indicatorActive: { backgroundColor: colors.gold },
  badge: { position: "absolute", top: space.sm - 6, left: "50%", marginLeft: 4 },
});
