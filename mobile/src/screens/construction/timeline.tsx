import { useState } from "react";
import { View } from "react-native";
import { LazyImage } from "@/src/ui/lazy-image";
import { Feather } from "@expo/vector-icons";

import { BACKEND } from "@/src/api/client";
import { fmtDate } from "@/src/format";
import { makeStyles, radius, useTheme } from "@/src/theme";
import { Chip, Press } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";

export type Photo = { id: string; caption?: string | null; taken_on?: string | null; url: string };
export type Milestone = { seq: number; name: string; cumulative_percent?: number | null; status: string; completed_on?: string | null; started_on?: string | null; update?: string | null; notes?: string | null; photos: Photo[] };

export const photoUri = (p: Photo) => (p.url.startsWith("http") ? p.url : `${BACKEND}${p.url}`);

// Thumbnails try the backend's `?size=thumb` variant (ignored if unsupported).
export const thumbUri = (p: Photo) => `${photoUri(p)}${photoUri(p).includes("?") ? "&" : "?"}size=thumb`;

// Responsive grid sized to the available width — nothing is clipped; extra
// photos collapse into a "+N" tile that opens the viewer.
function PhotoGrid({ photos, seq, alt, onPhoto }: { photos: Photo[]; seq: number; alt: string; onPhoto: (p: Photo) => void }) {
  const s = useStyles();
  const [w, setW] = useState(0);
  const cols = Math.max(3, Math.min(6, Math.ceil(w / 210)));
  const gap = 8;
  const size = w ? Math.floor((w - gap * (cols - 1)) / cols) : 0;
  const shown = photos.slice(0, cols * 2);
  const extra = photos.length - shown.length;
  return (
    <View style={[s.grid, { gap }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} testID={`construction-photos-${seq}`}>
      {size
        ? shown.map((p, i) => {
            const more = extra > 0 && i === shown.length - 1;
            return (
              <Press key={p.id} onPress={() => onPhoto(p)} testID={`construction-photo-${p.id}`} style={[s.thumbWrap, { width: size, height: Math.round(size * 0.75) }]} accessibilityLabel={p.caption || alt}>
                <LazyImage uri={thumbUri(p)} style={s.fill} recyclingKey={p.id} testID={`construction-thumb-${p.id}`} />
                {more ? (
                  <View style={s.more}>
                    <T style={s.moreText}>+{extra + 1}</T>
                  </View>
                ) : p.taken_on && size >= 120 ? (
                  <View style={s.stamp}>
                    <T style={s.stampText}>{fmtDate(p.taken_on)}</T>
                  </View>
                ) : null}
              </Press>
            );
          })
        : null}
    </View>
  );
}

export function TimelineItem({ m, next, last, onPhoto }: { m: Milestone; next: boolean; last: boolean; onPhoto: (p: Photo) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const done = m.status === "Completed";
  const active = m.status === "In Progress";
  return (
    <View style={s.item} testID={`construction-milestone-${m.seq}`}>
      <View style={s.rail}>
        <View style={[s.dot, done && s.dotDone, (next || active) && s.dotNext]}>
          {done ? <Feather name="check" size={13} color={colors.onBrandSecondary} /> : <T style={[s.dotText, (next || active) && { color: colors.onSurfaceInverse }]}>{m.seq}</T>}
        </View>
        {!last ? <View style={[s.line, done && s.lineDone]} /> : null}
      </View>
      <View style={[s.body, last && { paddingBottom: 4 }, active && s.activeBody]}>
        <View style={s.head}>
          <T v="bodyStrong" style={!done && !next && !active ? { color: colors.muted } : undefined}>
            {m.name}
          </T>
          <Chip label={m.status} tone={done ? "success" : active ? "gold" : "neutral"} testID={`construction-status-${m.seq}`} />
          {next && !active ? <Chip label="Up next" tone="info" testID="construction-up-next" /> : null}
        </View>
        <T v="small" tone="muted">
          {done ? `Completed ${fmtDate(m.completed_on)}` : active ? `Work in progress${m.started_on ? ` since ${fmtDate(m.started_on)}` : ""}` : "Upcoming"}
          {m.cumulative_percent != null ? ` · ${m.cumulative_percent}% of payment plan` : ""}
        </T>
        {m.update ? (
          <View style={s.note} testID={`construction-note-${m.seq}`}>
            <Feather name="message-square" size={14} color={colors.gold} />
            <T v="small" style={{ flex: 1, color: colors.onSurfaceTertiary }}>
              {m.update}
            </T>
          </View>
        ) : null}
        {m.photos.length ? (
          <PhotoGrid photos={m.photos} seq={m.seq} alt={m.name} onPhoto={onPhoto} />
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  item: { flexDirection: "row", gap: 14 },
  rail: { alignItems: "center", width: 28 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: c.borderStrong, backgroundColor: c.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: c.gold, borderColor: c.gold },
  dotNext: { backgroundColor: c.surfaceInverse, borderColor: c.surfaceInverse },
  dotText: { fontFamily: "Manrope_800ExtraBold", fontSize: 11, color: c.muted },
  line: { flex: 1, width: 2, backgroundColor: c.divider, marginVertical: 2 },
  lineDone: { backgroundColor: c.gold },
  body: { flex: 1, paddingBottom: 22, gap: 3 },
  activeBody: { backgroundColor: c.brandTertiary, borderRadius: radius.md, paddingHorizontal: 12, paddingBottom: 12, marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 28 },
  note: { flexDirection: "row", gap: 8, backgroundColor: c.surface, borderRadius: radius.sm, padding: 10, marginTop: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, minHeight: 60 },
  thumbWrap: { borderRadius: radius.md, overflow: "hidden", backgroundColor: c.skeleton },
  fill: { width: "100%", height: "100%" },
  more: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,31,58,0.6)", alignItems: "center", justifyContent: "center" },
  moreText: { fontFamily: "Manrope_800ExtraBold", fontSize: 18, color: c.onSurfaceInverse },
  stamp: { position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(11,31,58,0.75)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  stampText: { fontFamily: "Manrope_700Bold", fontSize: 10, color: c.onSurfaceInverse },
}));
