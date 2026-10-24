import { ActivityIndicator, View } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { fmtDateTime } from "@/src/format";
import { makeStyles, radius, useTheme } from "@/src/theme";
import { Press } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";

export type Attachment = { name: string; mime?: string | null; size?: number | null };
export type ThreadMsg = { by: string; author_name?: string; message: string; attachments?: Attachment[]; at: string };

// One attachment as shown in the thread; `idx` is the ticket-wide index used by
// GET /service-requests/{id}/attachments/{idx}.
export type AttView = { att: Attachment; idx: number; isImage: boolean; uri?: string; loading?: boolean; error?: boolean };

export const isImageAtt = (a: Attachment) => (a.mime ? a.mime.startsWith("image/") : /\.(jpe?g|png|webp|gif|heic)$/i.test(a.name || ""));

function Thumb({ v, mine, onPress }: { v: AttView; mine: boolean; onPress: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Press onPress={onPress} disabled={!v.uri} testID={`thread-attachment-thumb-${v.idx}`} style={[s.thumb, mine && s.thumbMine]} accessibilityLabel={`Open photo ${v.att.name}`}>
      {v.uri ? (
        <Image source={{ uri: v.uri }} style={s.thumbImg} contentFit="cover" transition={200} testID={`thread-attachment-image-${v.idx}`} />
      ) : v.error ? (
        <View style={s.center}>
          <Feather name="image" size={18} color={colors.muted} />
          <T v="small" tone="muted">Unavailable</T>
        </View>
      ) : (
        <View style={s.center}>
          <ActivityIndicator size="small" color={colors.gold} />
        </View>
      )}
    </Press>
  );
}

function FileChip({ v, mine, onPress, busy }: { v: AttView; mine: boolean; onPress: () => void; busy: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const fg = mine ? colors.mutedInverse : colors.onSurfaceTertiary;
  return (
    <Press onPress={onPress} disabled={busy} testID={`thread-attachment-file-${v.idx}`} style={[s.chip, mine && s.chipMine]} accessibilityLabel={`Open ${v.att.name}`}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Feather name={v.att.mime === "application/pdf" ? "file-text" : "paperclip"} size={13} color={fg} />}
      <T v="small" numberOfLines={1} style={{ color: fg, maxWidth: 180 }}>
        {v.att.name}
      </T>
      <Feather name="download" size={12} color={fg} />
    </Press>
  );
}

export function Bubble({ m, i, atts, onImage, onFile, fileBusy }: { m: ThreadMsg; i: number; atts: AttView[]; onImage: (idx: number) => void; onFile: (v: AttView) => void; fileBusy: number | null }) {
  const s = useStyles();
  const { colors } = useTheme();
  const mine = m.by === "customer";
  const imgs = atts.filter((a) => a.isImage);
  const files = atts.filter((a) => !a.isImage);
  return (
    <View style={[s.wrap, mine ? s.right : s.left]} testID={`thread-msg-${i}`}>
      <View style={[s.bubble, mine ? s.mine : s.theirs]}>
        <T v="small" style={{ fontFamily: "Manrope_700Bold", color: mine ? colors.gold : colors.muted }}>
          {mine ? "You" : m.author_name || "KKT team"} · {fmtDateTime(m.at)}
        </T>
        <T style={{ marginTop: 4, color: mine ? colors.onSurfaceInverse : colors.onSurface }}>{m.message}</T>
        {imgs.length ? (
          <View style={s.thumbs}>
            {imgs.map((v) => (
              <Thumb key={v.idx} v={v} mine={mine} onPress={() => onImage(v.idx)} />
            ))}
          </View>
        ) : null}
        {files.length ? (
          <View style={s.atts}>
            {files.map((v) => (
              <FileChip key={v.idx} v={v} mine={mine} busy={fileBusy === v.idx} onPress={() => onFile(v)} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flexDirection: "row" },
  left: { justifyContent: "flex-start" },
  right: { justifyContent: "flex-end" },
  bubble: { maxWidth: "86%", borderRadius: radius.lg, padding: 14 },
  mine: { backgroundColor: c.surfaceInverse, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 6 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  thumb: { width: 96, height: 96, borderRadius: radius.md, overflow: "hidden", backgroundColor: c.surface },
  thumbMine: { backgroundColor: "rgba(255,255,255,0.08)" },
  thumbImg: { width: 96, height: 96 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  atts: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, backgroundColor: c.surface, borderRadius: radius.pill, paddingHorizontal: 10 },
  chipMine: { backgroundColor: "rgba(255,255,255,0.1)" },
}));
