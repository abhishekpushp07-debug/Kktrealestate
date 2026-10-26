import { useEffect, useState } from "react";
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

const NATIVE_DRIVER = Platform.OS !== "web";
import { colors, radius, space } from "./theme";

export function Skeleton({
  width = "100%",
  height = 16,
  round,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  round?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const [opacity] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[styles.base, { width, height, borderRadius: round ? height / 2 : radius.sm, opacity }, style]}
    />
  );
}

export function SkeletonCard({ lines = 3, height }: { lines?: number; height?: number }): React.JSX.Element {
  return (
    <View style={[styles.card, height ? { height } : null]}>
      <Skeleton width="40%" height={14} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "90%"} height={12} style={{ marginTop: space.md }} />
      ))}
    </View>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }): React.JSX.Element {
  return (
    <View style={{ gap: space.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={40} height={40} round />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="80%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.navy100 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg },
  row: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
  },
});
