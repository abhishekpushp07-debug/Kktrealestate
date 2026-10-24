import { Text as RNText, StyleSheet, type StyleProp, type TextProps, type TextStyle } from "react-native";
import { colors, fonts } from "./theme";

export type TextVariant = "display" | "h1" | "h2" | "h3" | "title" | "body" | "bodyStrong" | "small" | "caption" | "label" | "mono" | "money";

const variants: Record<TextVariant, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, fontWeight: "600", letterSpacing: -0.2 },
  h1: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, fontWeight: "600" },
  h2: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, fontWeight: "600" },
  h3: { fontFamily: fonts.body, fontSize: 17, lineHeight: 22, fontWeight: "700" },
  title: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, fontWeight: "500" },
  label: { fontFamily: fonts.body, fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 },
  money: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
};

export interface TProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle["textAlign"];
  style?: StyleProp<TextStyle>;
}

/** Themed text. Defaults to body / ink. */
export function T({ variant = "body", color, align, style, ...rest }: TProps): React.JSX.Element {
  return <RNText {...rest} style={[styles.base, variants[variant], color ? { color } : null, align ? { textAlign: align } : null, style]} />;
}

const styles = StyleSheet.create({ base: { color: colors.ink } });
