import { Text as RNText, type TextProps } from "react-native";

import { fonts, makeStyles } from "@/src/theme";

type Variant = "display" | "h1" | "h2" | "title" | "cardTitle" | "body" | "bodyStrong" | "small" | "label" | "money" | "moneyLg";
type Tone = "default" | "secondary" | "muted" | "inverse" | "inverseMuted" | "gold" | "goldBright" | "success" | "error" | "warning";

export function T({ v = "body", tone = "default", style, ...rest }: TextProps & { v?: Variant; tone?: Tone }) {
  const s = useStyles();
  return <RNText {...rest} style={[s[v], s[tone], style]} />;
}

const useStyles = makeStyles((c) => ({
  display: { fontFamily: fonts.serif, fontSize: 32, lineHeight: 38, letterSpacing: -0.2 },
  h1: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 36 },
  h2: { fontFamily: fonts.serif, fontSize: 23, lineHeight: 28 },
  title: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22.5 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: "uppercase" },
  money: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, fontVariant: ["tabular-nums"] },
  moneyLg: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  default: { color: c.onSurface },
  secondary: { color: c.onSurfaceTertiary },
  muted: { color: c.muted },
  inverse: { color: c.onSurfaceInverse },
  inverseMuted: { color: c.mutedInverse },
  gold: { color: c.goldDeep },
  goldBright: { color: c.gold },
  success: { color: c.success },
  error: { color: c.error },
  warning: { color: c.warning },
}));
