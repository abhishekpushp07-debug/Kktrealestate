// Construction progress ring drawn from tick marks (no SVG dependency). Gold ticks = done.
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { T } from "./Text";
import { colors, fonts } from "./theme";

export function ProgressRing({ percent, size = 132, ticks = 40, children, onNavy, label = "Construction progress" }: { percent: number; size?: number; ticks?: number; children?: ReactNode; onNavy?: boolean; label?: string }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent));
  const done = Math.round((clamped / 100) * ticks);
  const tickLen = Math.max(8, size * 0.1);
  const tickW = Math.max(2, size * 0.028);
  const radius = size / 2 - tickLen / 2 - 2;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}>
      {Array.from({ length: ticks }).map((_, i) => {
        const angle = (360 / ticks) * i;
        const filled = i < done;
        return (
          <View
            key={i}
            style={[
              styles.tick,
              {
                width: tickW,
                height: tickLen,
                borderRadius: tickW / 2,
                backgroundColor: filled ? colors.gold : onNavy ? "rgba(255,255,255,0.18)" : colors.navy100,
                transform: [{ rotate: `${angle}deg` }, { translateY: -radius }],
              },
            ]}
          />
        );
      })}
      <View style={styles.center}>
        {children ?? (
          <T style={{ fontFamily: fonts.display, fontSize: size * 0.24, lineHeight: size * 0.28, fontWeight: "700" }} color={onNavy ? colors.onNavy : colors.navy}>
            {Math.round(clamped)}%
          </T>
        )}
      </View>
    </View>
  );
}

/** Horizontal progress bar. */
export function ProgressBar({ percent, height = 8, onNavy }: { percent: number; height?: number; onNavy?: boolean }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: onNavy ? "rgba(255,255,255,0.18)" : colors.navy100, overflow: "hidden" }}>
      <View style={{ width: `${clamped}%`, height, borderRadius: height / 2, backgroundColor: colors.gold }} />
    </View>
  );
}

const styles = StyleSheet.create({
  tick: { position: "absolute" },
  center: { alignItems: "center", justifyContent: "center" },
});
