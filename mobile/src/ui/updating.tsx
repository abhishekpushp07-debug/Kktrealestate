// Subtle "Updating…" pill while cached data is being refreshed in the background.
import { useEffect, useState } from "react";
import { ActivityIndicator, Animated, View } from "react-native";
import { useIsFetching } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { T } from "./text";

export function UpdatingPill() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { status } = useAuth();
  const fetching = useIsFetching() > 0 && status === "in";
  const [shown, setShown] = useState(false);
  const [a] = useState(() => new Animated.Value(0));
  // Only show for fetches longer than ~400 ms to avoid flicker.
  useEffect(() => {
    if (!fetching) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), 400);
    return () => clearTimeout(t);
  }, [fetching]);
  useEffect(() => {
    Animated.timing(a, { toValue: shown ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [shown, a]);
  return (
    <View pointerEvents="none" style={[s.wrap, { top: insets.top + 8 }]}>
      <Animated.View style={[s.pill, { opacity: a }]} testID={shown ? "updating-indicator" : undefined}>
        <ActivityIndicator size="small" color={colors.gold} />
        <T style={s.text}>Updating…</T>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", right: 16, zIndex: 900 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  text: { fontFamily: fonts.semibold, fontSize: 12, color: c.onSurfaceTertiary },
}));
