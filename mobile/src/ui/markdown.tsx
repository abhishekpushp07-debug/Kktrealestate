// Minimal markdown renderer for notices: headings, paragraphs, bullet/numbered
// lists, **bold**, *italic*, `code` and [links](url). No HTML.
import { Linking, View } from "react-native";

import { fonts, makeStyles } from "@/src/theme";
import { T } from "./text";

type Span = { t: string; b?: boolean; i?: boolean; code?: boolean; href?: string };

function inline(src: string): Span[] {
  const out: Span[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: src.slice(last, m.index) });
    if (m[2] || m[3]) out.push({ t: m[2] || m[3], b: true });
    else if (m[4] || m[5]) out.push({ t: m[4] || m[5], i: true });
    else if (m[6]) out.push({ t: m[6], code: true });
    else if (m[7]) out.push({ t: m[7], href: m[8] });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ t: src.slice(last) });
  return out;
}

function Inline({ text, style }: { text: string; style?: any }) {
  const s = useStyles();
  return (
    <T style={[s.p, style]}>
      {inline(text).map((sp, k) => (
        <T
          key={k}
          style={[s.p, style, sp.b && s.b, sp.i && s.i, sp.code && s.code, sp.href && s.link]}
          onPress={sp.href ? () => Linking.openURL(sp.href!) : undefined}
        >
          {sp.t}
        </T>
      ))}
    </T>
  );
}

export function Markdown({ text, testID }: { text: string; testID?: string }) {
  const s = useStyles();
  const blocks = (text || "").replace(/\r/g, "").split(/\n{2,}/);
  return (
    <View testID={testID} style={{ gap: 10 }}>
      {blocks.map((blk, i) => {
        const lines = blk.split("\n");
        const h = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
        if (h && lines.length === 1) return <Inline key={i} text={h[2]} style={h[1].length === 1 ? s.h1 : s.h2} />;
        if (lines.every((l) => /^\s*([-*+]|\d+\.)\s+/.test(l))) {
          return (
            <View key={i} style={{ gap: 6 }}>
              {lines.map((l, j) => {
                const num = /^\s*(\d+)\./.exec(l);
                return (
                  <View key={j} style={s.li}>
                    <T style={s.bullet}>{num ? `${num[1]}.` : "•"}</T>
                    <View style={{ flex: 1 }}>
                      <Inline text={l.replace(/^\s*([-*+]|\d+\.)\s+/, "")} />
                    </View>
                  </View>
                );
              })}
            </View>
          );
        }
        return <Inline key={i} text={lines.join("\n")} />;
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  p: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: c.onSurfaceTertiary },
  b: { fontFamily: fonts.bold, color: c.onSurface },
  i: { fontStyle: "italic" },
  code: { fontFamily: fonts.medium, backgroundColor: c.surfaceTertiary },
  link: { color: c.info, textDecorationLine: "underline" },
  h1: { fontFamily: fonts.serifBold, fontSize: 24, lineHeight: 28, color: c.onSurface },
  h2: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: c.onSurface },
  li: { flexDirection: "row", gap: 8 },
  bullet: { fontFamily: fonts.bold, color: c.gold, fontSize: 15, lineHeight: 23, minWidth: 14 },
}));

export const stripMarkdown = (t: string) => (t || "").replace(/[*_`#>]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
