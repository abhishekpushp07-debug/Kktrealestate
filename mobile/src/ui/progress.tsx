import { useEffect, useState } from "react";
import { Animated, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { fonts, makeStyles, useTheme } from "@/src/theme";
import { T } from "./text";

export function ProgressRing({ value, size = 76, stroke = 7, testID }: { value: number; size?: number; stroke?: number; testID?: string }) {
  const { colors } = useTheme();
  const s = useStyles();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.15)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.gold}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - v / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={s.center}>
        <T style={s.pct}>{Math.round(v)}%</T>
      </View>
    </View>
  );
}

export function ProgressBar({ value, tone = "gold", h = 8, testID }: { value: number; tone?: "gold" | "navy" | "success"; h?: number; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [w] = useState(() => new Animated.Value(0));
  const v = Math.max(0, Math.min(100, value || 0));
  useEffect(() => {
    Animated.timing(w, { toValue: v, duration: 700, useNativeDriver: false }).start();
  }, [v, w]);
  const color = tone === "gold" ? colors.gold : tone === "navy" ? colors.brandPrimary : colors.success;
  return (
    <View testID={testID} style={[s.track, { height: h, borderRadius: h / 2 }]}>
      <Animated.View style={{ height: h, borderRadius: h / 2, backgroundColor: color, width: w.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  pct: { fontFamily: fonts.extrabold, fontSize: 16, color: c.onSurfaceInverse },
  track: { backgroundColor: c.surfaceTertiary, overflow: "hidden", width: "100%" },
}));
