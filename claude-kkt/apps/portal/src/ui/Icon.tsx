// A small icon set drawn from Views and a couple of glyph characters, so it renders identically on
// iOS, Android and web without an icon-font package. Names are stable; swap the drawing freely.
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "./theme";

export type IconName =
  | "home" | "flat" | "rupee" | "construction" | "more"
  | "bell" | "chevron-right" | "chevron-left" | "chevron-down" | "chevron-up"
  | "close" | "check" | "plus" | "minus" | "download" | "share" | "external"
  | "document" | "notice" | "request" | "user" | "lock" | "logout" | "bank" | "devices"
  | "camera" | "image" | "star" | "info" | "warning" | "copy" | "search" | "refresh"
  | "calendar" | "phone" | "chat" | "mail" | "zoom-in" | "zoom-out" | "filter" | "clock" | "diamond" | "dot" | "edit";

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

const abs = StyleSheet.absoluteFillObject;

export function Icon({ name, size = 22, color = colors.ink, style }: IconProps): React.JSX.Element {
  const s = size;
  const w = Math.max(1.6, Math.round((s / 11) * 10) / 10);
  const box: ViewStyle = { width: s, height: s, alignItems: "center", justifyContent: "center" };
  const c = color;
  const center = (extra: ViewStyle): ViewStyle => ({ position: "absolute", left: "50%", top: "50%", ...extra });

  const bar = (len: number, thick: number, rotate = "0deg", dx = 0, dy = 0): React.JSX.Element => (
    <View key={`${len}-${rotate}-${dx}-${dy}`} style={center({ width: len, height: thick, backgroundColor: c, borderRadius: thick / 2, marginLeft: -len / 2 + dx, marginTop: -thick / 2 + dy, transform: [{ rotate }] })} />
  );
  const chevron = (rotate: string, len = s * 0.42, dx = 0, dy = 0): React.JSX.Element => (
    <View style={center({ width: len, height: len, borderTopWidth: w, borderRightWidth: w, borderColor: c, marginLeft: -len / 2 + dx, marginTop: -len / 2 + dy, transform: [{ rotate }] })} />
  );
  const ring = (d: number, dx = 0, dy = 0, extra: ViewStyle = {}): React.JSX.Element => (
    <View style={center({ width: d, height: d, borderRadius: d / 2, borderWidth: w, borderColor: c, marginLeft: -d / 2 + dx, marginTop: -d / 2 + dy, ...extra })} />
  );
  const rect = (wd: number, ht: number, dx = 0, dy = 0, extra: ViewStyle = {}): React.JSX.Element => (
    <View style={center({ width: wd, height: ht, borderWidth: w, borderColor: c, borderRadius: Math.max(2, s * 0.12), marginLeft: -wd / 2 + dx, marginTop: -ht / 2 + dy, ...extra })} />
  );
  const glyph = (ch: string, scale = 0.85, dy = 0): React.JSX.Element => (
    <Text style={{ color: c, fontSize: s * scale, lineHeight: s, fontWeight: "700", textAlign: "center", marginTop: dy, includeFontPadding: false }} allowFontScaling={false}>
      {ch}
    </Text>
  );

  let inner: React.ReactNode;
  switch (name) {
    case "home":
      inner = (
        <>
          <View style={center({ width: s * 0.5, height: s * 0.5, borderTopWidth: w, borderLeftWidth: w, borderColor: c, marginLeft: -s * 0.25, marginTop: -s * 0.25 - s * 0.14, transform: [{ rotate: "45deg" }] })} />
          <View style={center({ width: s * 0.56, height: s * 0.38, borderLeftWidth: w, borderRightWidth: w, borderBottomWidth: w, borderColor: c, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, marginLeft: -s * 0.28, marginTop: -s * 0.02 })} />
          <View style={center({ width: s * 0.14, height: s * 0.2, backgroundColor: c, marginLeft: -s * 0.07, marginTop: s * 0.16, borderTopLeftRadius: 2, borderTopRightRadius: 2 })} />
        </>
      );
      break;
    case "flat": {
      const q = s * 0.3;
      const g = s * 0.08;
      inner = (
        <View style={{ width: q * 2 + g, height: q * 2 + g, flexDirection: "row", flexWrap: "wrap", gap: g }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: q, height: q, borderWidth: w, borderColor: c, borderRadius: 3, backgroundColor: i === 3 ? c : "transparent" }} />
          ))}
        </View>
      );
      break;
    }
    case "rupee":
      inner = glyph("₹", 0.95, 0);
      break;
    case "construction":
      inner = (
        <>
          {rect(s * 0.42, s * 0.62, s * 0.18, s * 0.08)}
          {bar(s * 0.2, w, "0deg", s * 0.18, -s * 0.04)}
          {bar(s * 0.2, w, "0deg", s * 0.18, s * 0.14)}
          {bar(s * 0.62, w, "90deg", -s * 0.3, s * 0.04)}
          {bar(s * 0.5, w, "0deg", -s * 0.1, -s * 0.34)}
          {bar(s * 0.16, w, "90deg", s * 0.06, -s * 0.24)}
        </>
      );
      break;
    case "more":
      inner = (
        <View style={{ flexDirection: "row", gap: s * 0.12 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: s * 0.18, height: s * 0.18, borderRadius: s * 0.09, backgroundColor: c }} />
          ))}
        </View>
      );
      break;
    case "bell":
      inner = (
        <>
          <View style={center({ width: s * 0.54, height: s * 0.5, borderWidth: w, borderColor: c, borderTopLeftRadius: s * 0.27, borderTopRightRadius: s * 0.27, borderBottomWidth: 0, marginLeft: -s * 0.27, marginTop: -s * 0.3 })} />
          {bar(s * 0.7, w, "0deg", 0, s * 0.2)}
          {bar(s * 0.2, w * 1.4, "0deg", 0, s * 0.34)}
          {bar(w * 1.2, s * 0.1, "0deg", 0, -s * 0.36)}
        </>
      );
      break;
    case "chevron-right":
      inner = chevron("45deg", s * 0.38, -s * 0.08);
      break;
    case "chevron-left":
      inner = chevron("225deg", s * 0.38, s * 0.08);
      break;
    case "chevron-down":
      inner = chevron("135deg", s * 0.38, 0, -s * 0.08);
      break;
    case "chevron-up":
      inner = chevron("-45deg", s * 0.38, 0, s * 0.08);
      break;
    case "close":
      inner = (
        <>
          {bar(s * 0.7, w, "45deg")}
          {bar(s * 0.7, w, "-45deg")}
        </>
      );
      break;
    case "check":
      inner = (
        <View style={center({ width: s * 0.3, height: s * 0.55, borderBottomWidth: w, borderRightWidth: w, borderColor: c, marginLeft: -s * 0.13, marginTop: -s * 0.34, transform: [{ rotate: "45deg" }] })} />
      );
      break;
    case "plus":
      inner = (
        <>
          {bar(s * 0.66, w)}
          {bar(s * 0.66, w, "90deg")}
        </>
      );
      break;
    case "minus":
      inner = bar(s * 0.66, w);
      break;
    case "download":
      inner = (
        <>
          {bar(s * 0.5, w, "90deg", 0, -s * 0.1)}
          {chevron("135deg", s * 0.3, 0, -s * 0.06)}
          {bar(s * 0.7, w, "0deg", 0, s * 0.34)}
        </>
      );
      break;
    case "share":
      inner = (
        <>
          {bar(s * 0.5, w, "90deg", 0, -s * 0.08)}
          {chevron("-45deg", s * 0.3, 0, -s * 0.16)}
          <View style={center({ width: s * 0.64, height: s * 0.44, borderWidth: w, borderTopWidth: 0, borderColor: c, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, marginLeft: -s * 0.32, marginTop: -s * 0.02 })} />
        </>
      );
      break;
    case "external":
      inner = (
        <>
          <View style={center({ width: s * 0.6, height: s * 0.6, borderWidth: w, borderTopWidth: 0, borderRightWidth: 0, borderColor: c, borderRadius: 3, marginLeft: -s * 0.36, marginTop: -s * 0.24 })} />
          {bar(s * 0.5, w, "-45deg", s * 0.1, -s * 0.1)}
          {chevron("0deg", s * 0.28, s * 0.2, -s * 0.2)}
        </>
      );
      break;
    case "document":
      inner = (
        <>
          {rect(s * 0.56, s * 0.72)}
          {bar(s * 0.3, w, "0deg", 0, -s * 0.12)}
          {bar(s * 0.3, w, "0deg", 0, 0)}
          {bar(s * 0.2, w, "0deg", -s * 0.05, s * 0.12)}
        </>
      );
      break;
    case "notice":
      inner = (
        <>
          {rect(s * 0.66, s * 0.66)}
          {bar(s * 0.66, w * 2.2, "0deg", 0, -s * 0.33 + w)}
          {bar(s * 0.36, w, "0deg", 0, 0)}
          {bar(s * 0.24, w, "0deg", -s * 0.06, s * 0.14)}
        </>
      );
      break;
    case "request":
    case "chat":
      inner = (
        <>
          {rect(s * 0.72, s * 0.56, 0, -s * 0.06, { borderRadius: s * 0.18 })}
          <View style={center({ width: s * 0.18, height: s * 0.18, borderBottomWidth: w, borderLeftWidth: w, borderColor: c, marginLeft: -s * 0.26, marginTop: s * 0.1, transform: [{ rotate: "-20deg" }], backgroundColor: "transparent" })} />
        </>
      );
      break;
    case "user":
      inner = (
        <>
          {ring(s * 0.34, 0, -s * 0.18)}
          <View style={center({ width: s * 0.66, height: s * 0.34, borderWidth: w, borderBottomWidth: 0, borderColor: c, borderTopLeftRadius: s * 0.33, borderTopRightRadius: s * 0.33, marginLeft: -s * 0.33, marginTop: s * 0.08 })} />
        </>
      );
      break;
    case "lock":
      inner = (
        <>
          <View style={center({ width: s * 0.4, height: s * 0.36, borderWidth: w, borderBottomWidth: 0, borderColor: c, borderTopLeftRadius: s * 0.2, borderTopRightRadius: s * 0.2, marginLeft: -s * 0.2, marginTop: -s * 0.4 })} />
          {rect(s * 0.62, s * 0.44, 0, s * 0.12, { backgroundColor: c })}
        </>
      );
      break;
    case "logout":
      inner = (
        <>
          <View style={center({ width: s * 0.5, height: s * 0.66, borderWidth: w, borderRightWidth: 0, borderColor: c, borderRadius: 3, marginLeft: -s * 0.36, marginTop: -s * 0.33 })} />
          {bar(s * 0.5, w, "0deg", s * 0.12)}
          {chevron("45deg", s * 0.26, s * 0.22)}
        </>
      );
      break;
    case "bank":
      inner = (
        <>
          <View style={center({ width: s * 0.5, height: s * 0.5, borderTopWidth: w, borderLeftWidth: w, borderColor: c, marginLeft: -s * 0.25, marginTop: -s * 0.25 - s * 0.14, transform: [{ rotate: "45deg" }] })} />
          {bar(s * 0.3, w, "90deg", -s * 0.22, s * 0.1)}
          {bar(s * 0.3, w, "90deg", 0, s * 0.1)}
          {bar(s * 0.3, w, "90deg", s * 0.22, s * 0.1)}
          {bar(s * 0.72, w, "0deg", 0, s * 0.34)}
        </>
      );
      break;
    case "devices":
      inner = (
        <>
          {rect(s * 0.44, s * 0.74, 0, 0, { borderRadius: s * 0.1 })}
          {bar(s * 0.14, w, "0deg", 0, s * 0.26)}
        </>
      );
      break;
    case "camera":
      inner = (
        <>
          {rect(s * 0.74, s * 0.52, 0, s * 0.06)}
          {ring(s * 0.28, 0, s * 0.06)}
          {bar(s * 0.24, w * 1.5, "0deg", -s * 0.1, -s * 0.22)}
        </>
      );
      break;
    case "image":
      inner = (
        <>
          {rect(s * 0.7, s * 0.6)}
          <View style={center({ width: s * 0.1, height: s * 0.1, borderRadius: s * 0.05, backgroundColor: c, marginLeft: -s * 0.2, marginTop: -s * 0.2 })} />
          <View style={center({ width: s * 0.28, height: s * 0.28, borderTopWidth: w, borderLeftWidth: w, borderColor: c, marginLeft: -s * 0.05, marginTop: -s * 0.06, transform: [{ rotate: "45deg" }] })} />
        </>
      );
      break;
    case "star":
      inner = glyph("★", 0.9, -1);
      break;
    case "info":
      inner = (
        <>
          {ring(s * 0.8)}
          {bar(s * 0.3, w * 1.2, "90deg", 0, s * 0.06)}
          {bar(w * 1.4, w * 1.4, "0deg", 0, -s * 0.2)}
        </>
      );
      break;
    case "warning":
      inner = (
        <>
          {ring(s * 0.8)}
          {bar(s * 0.3, w * 1.2, "90deg", 0, -s * 0.06)}
          {bar(w * 1.4, w * 1.4, "0deg", 0, s * 0.2)}
        </>
      );
      break;
    case "copy":
      inner = (
        <>
          {rect(s * 0.5, s * 0.56, -s * 0.1, -s * 0.1, { borderRadius: 3 })}
          {rect(s * 0.5, s * 0.56, s * 0.1, s * 0.1, { borderRadius: 3, backgroundColor: "transparent" })}
        </>
      );
      break;
    case "search":
      inner = (
        <>
          {ring(s * 0.54, -s * 0.06, -s * 0.06)}
          {bar(s * 0.3, w * 1.2, "45deg", s * 0.22, s * 0.22)}
        </>
      );
      break;
    case "zoom-in":
    case "zoom-out":
      inner = (
        <>
          {ring(s * 0.54, -s * 0.06, -s * 0.06)}
          {bar(s * 0.3, w * 1.2, "45deg", s * 0.22, s * 0.22)}
          {bar(s * 0.26, w, "0deg", -s * 0.06, -s * 0.06)}
          {name === "zoom-in" ? bar(s * 0.26, w, "90deg", -s * 0.06, -s * 0.06) : null}
        </>
      );
      break;
    case "refresh":
      inner = (
        <>
          {ring(s * 0.7, 0, 0, { borderRightColor: "transparent" })}
          {chevron("0deg", s * 0.24, s * 0.26, -s * 0.2)}
        </>
      );
      break;
    case "calendar":
      inner = (
        <>
          {rect(s * 0.7, s * 0.64, 0, s * 0.04)}
          {bar(s * 0.7, w * 2, "0deg", 0, -s * 0.18)}
          {bar(w * 1.6, w * 1.6, "0deg", -s * 0.14, s * 0.06)}
          {bar(w * 1.6, w * 1.6, "0deg", s * 0.04, s * 0.06)}
        </>
      );
      break;
    case "phone":
      inner = (
        <>
          <View style={center({ width: s * 0.26, height: s * 0.72, borderWidth: w, borderColor: c, borderRadius: s * 0.13, marginLeft: -s * 0.13, marginTop: -s * 0.36, transform: [{ rotate: "-40deg" }] })} />
          <View style={center({ width: s * 0.2, height: s * 0.2, borderRadius: s * 0.1, backgroundColor: c, marginLeft: -s * 0.1 - s * 0.16, marginTop: -s * 0.1 - s * 0.2 })} />
          <View style={center({ width: s * 0.2, height: s * 0.2, borderRadius: s * 0.1, backgroundColor: c, marginLeft: -s * 0.1 + s * 0.16, marginTop: -s * 0.1 + s * 0.2 })} />
        </>
      );
      break;
    case "mail":
      inner = (
        <>
          {rect(s * 0.74, s * 0.52, 0, 0, { borderRadius: 3 })}
          <View style={center({ width: s * 0.34, height: s * 0.34, borderBottomWidth: w, borderRightWidth: w, borderColor: c, marginLeft: -s * 0.17, marginTop: -s * 0.3, transform: [{ rotate: "45deg" }] })} />
        </>
      );
      break;
    case "filter":
      inner = (
        <>
          {bar(s * 0.7, w, "0deg", 0, -s * 0.2)}
          {bar(s * 0.46, w, "0deg", 0, 0)}
          {bar(s * 0.22, w, "0deg", 0, s * 0.2)}
        </>
      );
      break;
    case "clock":
      inner = (
        <>
          {ring(s * 0.8)}
          {bar(s * 0.24, w, "90deg", 0, -s * 0.12)}
          {bar(s * 0.2, w, "0deg", s * 0.1, 0)}
        </>
      );
      break;
    case "diamond":
      inner = <View style={{ width: s * 0.5, height: s * 0.5, backgroundColor: c, transform: [{ rotate: "45deg" }], borderRadius: 2 }} />;
      break;
    case "dot":
      inner = <View style={{ width: s * 0.4, height: s * 0.4, borderRadius: s * 0.2, backgroundColor: c }} />;
      break;
    case "edit":
      inner = (
        <>
          {bar(s * 0.66, w * 2.6, "-45deg", 0, 0)}
          {bar(s * 0.66, w * 0.8, "-45deg", 0, 0)}
          {bar(s * 0.4, w, "0deg", 0, s * 0.36)}
        </>
      );
      break;
    default:
      inner = null;
  }

  return (
    <View style={[box, style]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[abs, { alignItems: "center", justifyContent: "center" }]}>{inner}</View>
    </View>
  );
}
