import { useState, type PropsWithChildren, type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";

import { haptic } from "@/src/haptics";
import { fonts, makeStyles, radius, shadow, useTheme } from "@/src/theme";
import { T } from "./text";

export type IconName = keyof typeof Feather.glyphMap;

const APressable = Animated.createAnimatedComponent(Pressable);

// Pressable with a gentle scale-down press animation.
export function Press({
  onPress,
  style,
  children,
  testID,
  disabled,
  haptics = true,
  accessibilityLabel,
}: PropsWithChildren<{ onPress?: () => void; style?: StyleProp<ViewStyle>; testID?: string; disabled?: boolean; haptics?: boolean; accessibilityLabel?: string }>) {
  const [scale] = useState(() => new Animated.Value(1));
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: false, speed: 40, bounciness: 4 }).start();
  return (
    <APressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      onPress={() => {
        if (haptics) haptic.tap();
        onPress?.();
      }}
      style={[style, { transform: [{ scale }] }, disabled && { opacity: 0.55 }]}
    >
      {children}
    </APressable>
  );
}

export function Card({ children, style, testID, navy }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; testID?: string; navy?: boolean }>) {
  const s = useStyles();
  return (
    <View testID={testID} style={[s.card, navy && s.cardNavy, style]}>
      {children}
    </View>
  );
}

type BtnKind = "primary" | "gold" | "ghost" | "danger";
export function Button({
  label,
  onPress,
  kind = "primary",
  icon,
  loading,
  disabled,
  testID,
  small,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: BtnKind;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const fg = kind === "primary" || kind === "danger" ? colors.onBrandPrimary : colors.onSurface;
  return (
    <Press testID={testID} onPress={onPress} disabled={disabled || loading} style={[s.btn, small && s.btnSm, s[kind], style]}>
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Feather name={icon} size={small ? 15 : 17} color={fg} /> : null}
      <T style={[s.btnText, small && s.btnTextSm, { color: fg }]}>{label}</T>
    </Press>
  );
}

export function IconButton({ icon, onPress, testID, label, badge, tone = "light" }: { icon: IconName; onPress?: () => void; testID?: string; label: string; badge?: number; tone?: "light" | "navy" }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Press testID={testID} onPress={onPress} accessibilityLabel={label} style={[s.iconBtn, tone === "navy" && s.iconBtnNavy]}>
      <Feather name={icon} size={19} color={tone === "navy" ? colors.onSurfaceInverse : colors.onSurface} />
      {badge ? (
        <View style={s.badge} testID={testID ? `${testID}-badge` : undefined}>
          <T style={s.badgeText}>{badge > 9 ? "9+" : badge}</T>
        </View>
      ) : null}
    </Press>
  );
}

type ChipTone = "neutral" | "success" | "warning" | "error" | "info" | "gold";
export function Chip({ label, tone = "neutral", testID }: { label: string; tone?: ChipTone; testID?: string }) {
  const s = useStyles();
  return (
    <View testID={testID} style={[s.chip, s[`chip_${tone}`]]}>
      <T style={[s.chipText, s[`chipText_${tone}`]]}>{label}</T>
    </View>
  );
}

export function KV({ k, v, testID, last, vTone }: { k: string; v?: ReactNode; testID?: string; last?: boolean; vTone?: "success" | "error" }) {
  const s = useStyles();
  return (
    <View style={[s.kv, last && { borderBottomWidth: 0 }]}>
      <T tone="muted" style={s.kvK}>
        {k}
      </T>
      {typeof v === "string" || typeof v === "number" || v == null ? (
        <T v="bodyStrong" tone={vTone} style={s.kvV} testID={testID}>
          {v ?? "—"}
        </T>
      ) : (
        v
      )}
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.section}>
      <T v="title">{title}</T>
      {right}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: 18, borderWidth: 1, borderColor: c.border, ...shadow },
  cardNavy: { backgroundColor: c.surfaceInverse, borderColor: c.surfaceInverse },
  btn: { minHeight: 50, borderRadius: radius.pill, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnSm: { minHeight: 44, paddingHorizontal: 16 },
  primary: { backgroundColor: c.brandPrimary },
  gold: { backgroundColor: c.brandSecondary },
  ghost: { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.borderStrong },
  danger: { backgroundColor: c.error },
  btnText: { fontFamily: fonts.bold, fontSize: 15 },
  btnTextSm: { fontSize: 13 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceSecondary, alignItems: "center", justifyContent: "center", ...shadow },
  iconBtnNavy: { backgroundColor: "rgba(255,255,255,0.12)" },
  badge: { position: "absolute", top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: c.surface },
  badgeText: { fontFamily: fonts.extrabold, fontSize: 10, color: c.onBrandSecondary },
  chip: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontFamily: fonts.bold, fontSize: 11 },
  chip_neutral: { backgroundColor: c.surfaceTertiary },
  chipText_neutral: { color: c.onSurfaceTertiary },
  chip_success: { backgroundColor: c.successSoft },
  chipText_success: { color: c.success },
  chip_warning: { backgroundColor: c.warningSoft },
  chipText_warning: { color: c.warning },
  chip_error: { backgroundColor: c.errorSoft },
  chipText_error: { color: c.error },
  chip_info: { backgroundColor: c.infoSoft },
  chipText_info: { color: c.info },
  chip_gold: { backgroundColor: c.brandTertiary },
  chipText_gold: { color: c.onBrandTertiary },
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  kvK: { flexShrink: 1 },
  kvV: { textAlign: "right", flexShrink: 1, maxWidth: "62%" },
  section: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
}));
