import { Pressable, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { Icon } from "./Icon";
import { T } from "./Text";
import { colors, radius, shadow, space } from "./theme";

export interface CardProps extends ViewProps {
  padded?: boolean;
  tone?: "surface" | "navy" | "gold" | "muted";
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const toneBg = { surface: colors.surface, navy: colors.navy, gold: colors.gold50, muted: colors.surfaceMuted } as const;

/** Elevated ivory surface; `tone="navy"` for the hero card. */
export function Card({ padded = true, tone = "surface", onPress, style, children, ...rest }: CardProps): React.JSX.Element {
  const base = [styles.card, { backgroundColor: toneBg[tone] }, tone === "surface" ? shadow.card : null, tone === "gold" ? styles.goldBorder : null, padded ? styles.padded : null, style];
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed ? styles.pressed : null]} {...rest}>
        {children}
      </Pressable>
    );
  }
  return (
    <View style={base} {...rest}>
      {children}
    </View>
  );
}

export function CardHeader({ title, subtitle, action, onAction, eyebrow }: { title: string; subtitle?: string; eyebrow?: string; action?: string; onAction?: () => void }): React.JSX.Element {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        {eyebrow ? (
          <T variant="label" color={colors.gold700}>
            {eyebrow}
          </T>
        ) : null}
        <T variant="h3">{title}</T>
        {subtitle ? (
          <T variant="small" color={colors.inkMuted}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={styles.actionRow}>
          <T variant="caption" color={colors.navy}>
            {action}
          </T>
          <Icon name="chevron-right" size={14} color={colors.navy} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  return <View style={[styles.divider, { marginLeft: inset }, style]} />;
}

/** Label/value pair used across detail screens. */
export function KeyValue({ label, value, mono, right }: { label: string; value: string; mono?: boolean; right?: boolean }): React.JSX.Element {
  return (
    <View style={styles.kv}>
      <T variant="small" color={colors.inkMuted} style={{ flex: 1 }}>
        {label}
      </T>
      <T variant={mono ? "mono" : "bodyStrong"} style={[{ flex: 1.4 }, right ? { textAlign: "right" } : null]} selectable>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: "hidden" },
  padded: { padding: space.lg },
  goldBorder: { borderWidth: 1, borderColor: colors.gold200 },
  pressed: { opacity: 0.92 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: space.md, marginBottom: space.md },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 2, paddingTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, alignSelf: "stretch" },
  kv: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: 8 },
});
