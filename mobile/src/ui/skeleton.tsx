import { useEffect, useState } from "react";
import { Animated, View, type DimensionValue } from "react-native";

import { makeStyles, radius } from "@/src/theme";

export function Skeleton({ h = 80, w = "100%", r = radius.lg, mt = 0 }: { h?: number; w?: DimensionValue; r?: number; mt?: number }) {
  const s = useStyles();
  const [a] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(a, { toValue: 0.5, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return <Animated.View accessibilityElementsHidden style={[s.sk, { height: h, width: w, borderRadius: r, marginTop: mt, opacity: a }]} />;
}

export function SkeletonList({ rows = 3, h = 76 }: { rows?: number; h?: number }) {
  return (
    <View testID="skeleton-list" style={{ gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} h={h} />
      ))}
    </View>
  );
}

export function SkeletonScreen() {
  return (
    <View testID="skeleton-screen" style={{ gap: 14 }}>
      <Skeleton h={36} w="55%" r={10} />
      <Skeleton h={200} />
      <Skeleton h={120} />
      <Skeleton h={90} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  sk: { backgroundColor: c.skeleton },
}));
