import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { haptics } from "@/lib/haptics";
import { Icon, type IconName } from "./Icon";
import { T } from "./Text";
import { colors, radius, space } from "./theme";

export type ButtonVariant = "primary" | "gold" | "outline" | "ghost" | "danger" | "onNavy";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "style" | "children"> {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
}

const palette: Record<ButtonVariant, { bg: string; fg: string; border: string; pressed: string }> = {
  primary: { bg: colors.navy, fg: colors.onNavy, border: colors.navy, pressed: colors.navy700 },
  gold: { bg: colors.gold, fg: colors.navy, border: colors.gold, pressed: colors.gold700 },
  outline: { bg: "transparent", fg: colors.navy, border: colors.navy200, pressed: colors.navy50 },
  ghost: { bg: "transparent", fg: colors.navy, border: "transparent", pressed: colors.navy50 },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: colors.dangerBg, pressed: "#F5D5D1" },
  onNavy: {
    bg: "rgba(255,255,255,0.12)",
    fg: colors.onNavy,
    border: "rgba(255,255,255,0.22)",
    pressed: "rgba(255,255,255,0.2)",
  },
};

const sizes: Record<ButtonSize, { h: number; px: number; font: number; icon: number }> = {
  // every size is ≥ 48 px tall (SPEC §15/§16 tap targets); sm only narrows padding and type
  sm: { h: 48, px: 14, font: 13, icon: 16 },
  md: { h: 48, px: 18, font: 15, icon: 18 },
  lg: { h: 54, px: 22, font: 16, icon: 20 },
};

export function Button({
  title,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  loading,
  block,
  style,
  disabled,
  onPress,
  haptic = true,
  ...rest
}: ButtonProps): React.JSX.Element {
  const p = palette[variant];
  const sz = sizes[size];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      hitSlop={size === "sm" ? 4 : undefined}
      onPress={(e) => {
        if (haptic) haptics.tap();
        onPress?.(e);
      }}
      style={({ pressed }) => [
        styles.base,
        { height: sz.h, paddingHorizontal: sz.px, backgroundColor: pressed ? p.pressed : p.bg, borderColor: p.border },
        block ? styles.block : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={sz.icon} color={p.fg} /> : null}
          <T variant="bodyStrong" color={p.fg} style={{ fontSize: sz.font, lineHeight: sz.font + 4 }} numberOfLines={1}>
            {title}
          </T>
          {iconRight ? <Icon name={iconRight} size={sz.icon} color={p.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** Round icon-only button (header actions, close buttons). */
export function IconButton({
  name,
  onPress,
  color = colors.navy,
  bg = "transparent",
  size = 44,
  iconSize = 22,
  label,
  style,
  disabled,
}: {
  name: IconName;
  onPress?: () => void;
  color?: string;
  bg?: string;
  size?: number;
  iconSize?: number;
  label: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: bg,
          opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <Icon name={name} size={iconSize} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  block: { alignSelf: "stretch" },
  disabled: { opacity: 0.55 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
