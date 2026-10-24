import { useState, type PropsWithChildren, type ReactNode } from "react";
import { Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

import { makeStyles, useTheme } from "@/src/theme";
import { haptic } from "@/src/haptics";
import { IconButton } from "./primitives";
import { T } from "./text";

export const MAX_W = 980;

// Scrollable screen with safe-area top, pull-to-refresh (invalidates the given
// query keys) and a centred max-width column for desktop web.
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
  const [busy, setBusy] = useState(false);
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
      contentContainerStyle={[s.content, { paddingTop: insets.top + 12, paddingBottom: (tabbed ? 110 : 40) + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={busy} onRefresh={onRefresh} tintColor={colors.gold} colors={[colors.gold]} /> : undefined}
    >
      <View style={[s.col, contentStyle]}>{children}</View>
    </ScrollView>
  );
}

export function PageHeader({ title, sub, right, back, testID }: { title: string; sub?: string; right?: ReactNode; back?: boolean; testID?: string }) {
  const s = useStyles();
  const router = useRouter();
  return (
    <View style={s.header} testID={testID}>
      {back ? (
        <View style={{ marginBottom: 14 }}>
          <IconButton icon="chevron-left" label="Back" testID="header-back-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        </View>
      ) : null}
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <T v="h1" testID="page-title">
            {title}
          </T>
          {sub ? (
            <T tone="muted" style={{ marginTop: 4 }}>
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
  col: { width: "100%", maxWidth: MAX_W, gap: 14, ...(Platform.OS === "web" ? { paddingHorizontal: 2 } : {}) },
  header: { marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
}));
