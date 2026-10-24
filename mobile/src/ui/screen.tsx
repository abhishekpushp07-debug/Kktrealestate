import { useEffect, useState, type PropsWithChildren, type ReactNode } from "react";
import { Animated, Platform, RefreshControl, ScrollView, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

import { BREAKPOINT, makeStyles, useTheme } from "@/src/theme";
import { haptic } from "@/src/haptics";
import { Feather } from "@expo/vector-icons";
import { IconButton, Press } from "./primitives";
import { T } from "./text";

export const MAX_W = 1100;
// Space reserved under scroll content for the phone bottom tab bar (bar ≈ 76 + inset).
export const TAB_BAR_SPACE = 124;

export const useWide = () => useWindowDimensions().width >= BREAKPOINT.sidebar;

// Scrollable screen with safe-area top, pull-to-refresh (invalidates the given
// query keys), a gentle fade/slide on mount and a centred max-width column.
export function Screen({
  children,
  refreshKeys,
  testID,
  tabbed,
  contentStyle,
}: PropsWithChildren<{ refreshKeys?: QueryKey[]; testID?: string; tabbed?: boolean; contentStyle?: StyleProp<ViewStyle> }>) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const wide = useWide();
  const [busy, setBusy] = useState(false);
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 260, useNativeDriver: Platform.OS !== "web" }).start();
  }, [enter]);
  const onRefresh = refreshKeys
    ? async () => {
        setBusy(true);
        haptic.select();
        await Promise.all(refreshKeys.map((k) => qc.invalidateQueries({ queryKey: k })));
        setBusy(false);
      }
    : undefined;
  return (
    <ScrollView
      testID={testID}
      style={s.root}
      contentContainerStyle={[s.content, wide && s.contentWide, { paddingTop: insets.top + (wide ? 32 : 12), paddingBottom: (tabbed && !wide ? TAB_BAR_SPACE : 48) + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={busy} onRefresh={onRefresh} tintColor={colors.gold} colors={[colors.gold]} /> : undefined}
    >
      <Animated.View style={[s.col, contentStyle, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>{children}</Animated.View>
    </ScrollView>
  );
}

export function PageHeader({ title, sub, right, back, testID }: { title: string; sub?: string; right?: ReactNode; back?: boolean; testID?: string }) {
  const s = useStyles();
  const router = useRouter();
  const wide = useWide();
  const { colors } = useTheme();
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <View style={s.header} testID={testID}>
      {back && wide ? (
        <Press haptics={false} onPress={goBack} testID="header-back-button" style={s.crumb} accessibilityLabel="Back">
          <Feather name="chevron-left" size={16} color={colors.goldDeep} />
          <T v="small" style={s.crumbText}>
            Back
          </T>
        </Press>
      ) : back ? (
        <View style={{ marginBottom: 16 }}>
          <IconButton icon="chevron-left" label="Back" testID="header-back-button" onPress={goBack} />
        </View>
      ) : null}
      <View style={s.row}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <T v="h1" testID="page-title">
            {title}
          </T>
          <View style={s.accent} />
          {sub ? (
            <T tone="secondary" style={{ marginTop: 4 }}>
              {sub}
            </T>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: 18, flexGrow: 1, alignItems: "center" },
  contentWide: { paddingHorizontal: 40 },
  col: { width: "100%", maxWidth: MAX_W, gap: 24, ...(Platform.OS === "web" ? { paddingHorizontal: 2 } : {}) },
  header: { marginBottom: 0 },
  accent: { width: 28, height: 2, borderRadius: 1, backgroundColor: c.gold, marginTop: 8 },
  crumb: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 32, marginBottom: 8 },
  crumbText: { fontFamily: "Manrope_700Bold", color: c.goldDeep },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
}));
