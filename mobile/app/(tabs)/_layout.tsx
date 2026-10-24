import { Platform, View } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/tabs";

import { useRequests } from "@/src/hooks";
import { haptic } from "@/src/haptics";
import { fonts, makeStyles, radius, shadow, useTheme } from "@/src/theme";
import { Press, type IconName } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { MAX_W } from "@/src/ui/screen";

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Home", icon: "home" },
  payments: { label: "Payments", icon: "credit-card" },
  construction: { label: "Construction", icon: "layers" },
  requests: { label: "Requests", icon: "life-buoy" },
  more: { label: "More", icon: "menu" },
};

function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data: reqs } = useRequests();
  const awaiting = (reqs || []).filter((r) => r.status === "Awaiting Customer").length;
  return (
    <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} testID="bottom-tab-bar">
      <View style={s.bar}>
        {state.routes.map((route, i) => {
          const t = TABS[route.name];
          if (!t) return null;
          const on = state.index === i;
          return (
            <Press
              key={route.key}
              haptics={false}
              testID={`tab-${t.label.toLowerCase()}`}
              accessibilityLabel={t.label}
              style={s.item}
              onPress={() => {
                haptic.select();
                if (!on) navigateToTab(route.key);
              }}
            >
              <View style={[s.iconWrap, on && s.iconOn]}>
                <Feather name={t.icon} size={20} color={on ? colors.gold : colors.muted} />
                {route.name === "requests" && awaiting > 0 ? <View style={s.dot} testID="tab-requests-dot" /> : null}
              </View>
              <T style={[s.label, on && s.labelOn]} numberOfLines={1}>
                {t.label}
              </T>
            </Press>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="payments" />
      <Tabs.Screen name="construction" />
      <Tabs.Screen name="requests" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingHorizontal: 12, paddingTop: 8, backgroundColor: Platform.OS === "web" ? "rgba(248,246,241,0.92)" : c.surface, borderTopWidth: 1, borderTopColor: c.border },
  bar: { flexDirection: "row", width: "100%", maxWidth: Math.min(MAX_W, 640) },
  item: { flex: 1, alignItems: "center", gap: 3, minHeight: 52, justifyContent: "center" },
  iconWrap: { width: 48, height: 30, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  iconOn: { backgroundColor: c.surfaceInverse, ...shadow },
  dot: { position: "absolute", top: 3, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: c.error },
  label: { fontFamily: fonts.semibold, fontSize: 10, color: c.muted },
  labelOn: { color: c.onSurface, fontFamily: fonts.bold },
}));
