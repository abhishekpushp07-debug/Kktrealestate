// Money display helpers: signed amounts with due (red) / advance (green) colouring.
import { StyleSheet, View } from "react-native";
import { formatINR } from "@/lib/format";
import { T, type TextVariant } from "./Text";
import { colors, space } from "./theme";

export function Money({ paise, variant = "money", color, signed, style }: { paise: number; variant?: TextVariant; color?: string; signed?: boolean; style?: object }): React.JSX.Element {
  return (
    <T variant={variant} color={color ?? colors.ink} style={style} selectable>
      {formatINR(paise, { signed })}
    </T>
  );
}

/**
 * Due figure the customer way: positive = due (red), negative = advance (green, "(advance)"), zero = settled.
 */
export function DueMoney({ paise, variant = "money", onNavy, showZeroLabel = true }: { paise: number; variant?: TextVariant; onNavy?: boolean; showZeroLabel?: boolean }): React.JSX.Element {
  if (paise < 0) {
    return (
      <View style={styles.inline}>
        <T variant={variant} color={onNavy ? "#7FD9A4" : colors.success} selectable>
          {formatINR(-paise)}
        </T>
        <T variant="caption" color={onNavy ? "#7FD9A4" : colors.success}>
          (advance)
        </T>
      </View>
    );
  }
  if (paise === 0) {
    return (
      <T variant={variant} color={onNavy ? colors.onNavy : colors.ink} selectable>
        {showZeroLabel ? "₹0 · settled" : "₹0"}
      </T>
    );
  }
  return (
    <T variant={variant} color={onNavy ? "#FFB4A8" : colors.danger} selectable>
      {formatINR(paise)}
    </T>
  );
}

const styles = StyleSheet.create({ inline: { flexDirection: "row", alignItems: "baseline", gap: space.xs, flexWrap: "wrap" } });
