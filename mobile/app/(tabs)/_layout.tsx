import { View } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import type { BottomTabBarProps } from "expo-router/tabs";

import { useRequests } from "@/src/hooks";
import { haptic } from "@/src/haptics";
import { fonts, makeStyles, shadow, useTheme } from "@/src/theme";
import { Press, type IconName } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { useWide } from "@/src/ui/screen";

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Home", icon: "home" },
  payments: { label: "Payments", icon: "credit-card" },
  construction: { label: "Construction", icon: "layers" },
  requests: { label: "Requests", icon: "message-square" },
  more: { label: "More", icon: "grid" },
};

function useAwaiting() {
  const { data } = useRequests();
  return (data || []).filter((r) => r.status === "Awaiting Customer").length;
}

function BottomBar({ state, navigateToTab }: BottomTabBarProps) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const awaiting = useAwaiting();
  return (
    <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]} testID="bottom-tab-bar">
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
              <View style={[s.indicator, on && s.indicatorOn]} />
              <View>
                <Feather name={t.icon} size={21} color={on ? colors.goldDeep : colors.muted} />
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
  const wide = useWide();
  return (
    <Tabs
      tabBar={(p) => (wide ? null : <BottomBar {...p} />)}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="payments" />
      <Tabs.Screen name="construction" />
      <Tabs.Screen name="requests" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingHorizontal: 2, backgroundColor: c.surfaceSecondary, borderTopWidth: 1, borderTopColor: c.border, ...shadow },
  bar: { flexDirection: "row", width: "100%", maxWidth: 640 },
  item: { flex: 1, alignItems: "center", gap: 3, paddingTop: 8, paddingBottom: 6, minHeight: 60 },
  indicator: { position: "absolute", top: 0, width: 28, height: 3, borderRadius: 2 },
  indicatorOn: { backgroundColor: c.gold },
  dot: { position: "absolute", top: -2, right: -6, width: 8, height: 8, borderRadius: 4, backgroundColor: c.error },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: -0.4, color: c.muted },
  labelOn: { color: c.onSurface, fontFamily: fonts.semibold },
}));
