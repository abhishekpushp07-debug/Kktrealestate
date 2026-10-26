import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { haptics } from "@/lib/haptics";
import { Icon, type IconName } from "./Icon";
import { T } from "./Text";
import { colors, radius, space } from "./theme";

export interface ListRowProps {
  icon?: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  first?: boolean;
  last?: boolean;
}

/** Settings-style row (More hub, profile). Group several inside a Card with `padded={false}`. */
export function ListRow({
  icon,
  iconColor,
  title,
  subtitle,
  right,
  onPress,
  chevron = true,
  destructive,
  style,
  last,
}: ListRowProps): React.JSX.Element {
  const fg = destructive ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      style={({ pressed }) => [styles.row, last ? null : styles.border, pressed ? styles.pressed : null, style]}
    >
      {icon ? (
        <View style={[styles.iconWrap, destructive ? { backgroundColor: colors.dangerBg } : null]}>
          <Icon name={icon} size={18} color={iconColor ?? (destructive ? colors.danger : colors.navy)} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong" color={fg}>
          {title}
        </T>
        {subtitle ? (
          <T variant="small" color={colors.inkMuted}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
      {onPress && chevron ? <Icon name="chevron-right" size={16} color={colors.inkSubtle} /> : null}
    </Pressable>
  );
}

export function Avatar({
  name,
  size = 44,
  onNavy,
}: {
  name: string;
  size?: number;
  onNavy?: boolean;
}): React.JSX.Element {
  const parts = name.trim().split(/\s+/);
  const ini =
    ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: onNavy ? "rgba(255,255,255,0.14)" : colors.gold100,
        borderWidth: 1,
        borderColor: onNavy ? "rgba(255,255,255,0.2)" : colors.gold200,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <T
        variant="title"
        color={onNavy ? colors.gold200 : colors.goldText}
        style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}
      >
        {ini}
      </T>
    </View>
  );
}

export function StarRating({
  value,
  onChange,
  size = 30,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
}): React.JSX.Element {
  return (
    // read-only: one image "4 out of 5 stars"; editable: a radio group of five 48 px stars
    onChange ? (
      <View style={{ flexDirection: "row", gap: 4 }} accessibilityRole="radiogroup" accessibilityLabel="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            aria-checked={n === value}
            accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`}
            onPress={() => onChange(n)}
            style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="star" size={size} color={n <= value ? colors.gold : colors.navy200} />
          </Pressable>
        ))}
      </View>
    ) : (
      <View
        style={{ flexDirection: "row", gap: 4 }}
        accessibilityRole="image"
        accessibilityLabel={`${value} out of 5 stars`}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Icon key={n} name="star" size={size} color={n <= value ? colors.gold : colors.navy200} />
        ))}
      </View>
    )
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  pressed: { backgroundColor: colors.navy50 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.navy50,
    alignItems: "center",
    justifyContent: "center",
  },
});
