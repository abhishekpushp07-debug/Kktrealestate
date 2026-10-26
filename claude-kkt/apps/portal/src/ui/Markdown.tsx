// Minimal, safe Markdown renderer for notices: headings, paragraphs, bold/italic/code, links,
// bullet & numbered lists, quotes and rules. No raw HTML is interpreted; links open only http(s).
import { Fragment, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { openExternal } from "@/lib/links";
import { T } from "./Text";
import { colors, fonts, radius, space } from "./theme";

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "hr" };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: "h", level: h[1]!.length as 1 | 2 | 3, text: h[2] ?? "" });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push({ kind: "hr" });
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((ul ?? ol)![1] ?? "");
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      blocks.push({ kind: "quote", text: q[1] ?? "" });
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<Fragment key={`${keyPrefix}-t${i++}`}>{text.slice(last, idx)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <T key={`${keyPrefix}-b${i++}`} variant="bodyStrong">
          {tok.slice(2, -2)}
        </T>,
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <T key={`${keyPrefix}-c${i++}`} variant="mono" style={styles.code}>
          {tok.slice(1, -1)}
        </T>,
      );
    } else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const url = m[2] ?? "";
      out.push(
        <T key={`${keyPrefix}-l${i++}`} variant="bodyStrong" color={colors.navy} style={styles.link} accessibilityRole="link" onPress={() => void openExternal(url)}>
          {label}
        </T>,
      );
    } else {
      out.push(
        <T key={`${keyPrefix}-i${i++}`} style={styles.italic}>
          {tok.slice(1, -1)}
        </T>,
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(<Fragment key={`${keyPrefix}-t${i++}`}>{text.slice(last)}</Fragment>);
  return out;
}

export function Markdown({ source }: { source: string }): React.JSX.Element {
  const blocks = parseBlocks(source);
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case "h":
            return (
              <T key={k} variant={b.level === 1 ? "h1" : b.level === 2 ? "h2" : "h3"} style={{ marginTop: i === 0 ? 0 : space.sm }}>
                {renderInline(b.text, k)}
              </T>
            );
          case "p":
            return (
              <T key={k} variant="body">
                {renderInline(b.text, k)}
              </T>
            );
          case "ul":
          case "ol":
            return (
              <View key={k} style={styles.list}>
                {b.items.map((it, j) => (
                  <View key={`${k}-${j}`} style={styles.li}>
                    <T variant="body" color={colors.goldText} style={styles.bullet}>
                      {b.kind === "ul" ? "•" : `${j + 1}.`}
                    </T>
                    <T variant="body" style={{ flex: 1 }}>
                      {renderInline(it, `${k}-${j}`)}
                    </T>
                  </View>
                ))}
              </View>
            );
          case "quote":
            return (
              <View key={k} style={styles.quote}>
                <T variant="body" color={colors.inkMuted}>
                  {renderInline(b.text, k)}
                </T>
              </View>
            );
          case "hr":
            return <View key={k} style={styles.hr} />;
          default:
            return null;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  list: { gap: 6 },
  li: { flexDirection: "row", gap: space.sm },
  bullet: { width: 22, textAlign: "right", fontFamily: fonts.body },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.gold, paddingLeft: space.md, paddingVertical: 2 },
  hr: { height: 1, backgroundColor: colors.line, marginVertical: space.xs },
  code: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 4, borderRadius: radius.sm },
  italic: { fontStyle: "italic" },
  link: { textDecorationLine: "underline" },
});
