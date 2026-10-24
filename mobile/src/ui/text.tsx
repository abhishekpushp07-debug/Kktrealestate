import { Text as RNText, type TextProps } from "react-native";

import { fonts, makeStyles } from "@/src/theme";

type Variant = "display" | "h1" | "h2" | "title" | "body" | "bodyStrong" | "small" | "label" | "money" | "moneyLg";
type Tone = "default" | "muted" | "inverse" | "inverseMuted" | "gold" | "success" | "error" | "warning";

export function T({ v = "body", tone = "default", style, ...rest }: TextProps & { v?: Variant; tone?: Tone }) {
  const s = useStyles();
  return <RNText {...rest} style={[s[v], s[tone], style]} />;
}

const useStyles = makeStyles((c) => ({
  display: { fontFamily: fonts.serif, fontSize: 36, lineHeight: 40, letterSpacing: -0.3 },
  h1: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 36 },
  h2: { fontFamily: fonts.serif, fontSize: 24, lineHeight: 28 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  label: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  money: { fontFamily: fonts.bold, fontSize: 15, fontVariant: ["tabular-nums"] },
  moneyLg: { fontFamily: fonts.serifBold, fontSize: 30, lineHeight: 34, fontVariant: ["tabular-nums"] },
  default: { color: c.onSurface },
  muted: { color: c.muted },
  inverse: { color: c.onSurfaceInverse },
  inverseMuted: { color: c.mutedInverse },
  gold: { color: c.gold },
  success: { color: c.success },
  error: { color: c.error },
  warning: { color: c.warning },
}));
