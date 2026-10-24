import { View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

import type { Booking } from "@/src/hooks";
import { makeStyles, radius, shadow, useTheme } from "@/src/theme";
import { Chip, Press } from "@/src/ui/primitives";
import { ProgressRing } from "@/src/ui/progress";
import { T } from "@/src/ui/text";

export function HeroCard({ b }: { b: Booking }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Press testID="home-flat-card" onPress={() => router.push(`/flat/${b.id}`)} style={s.card}>
      <View style={s.bg}>
        {b.cover_image ? <Image source={{ uri: b.cover_image }} style={s.img} contentFit="cover" cachePolicy="memory-disk" transition={250} /> : null}
        <LinearGradient colors={["rgba(11,31,58,0.35)", "rgba(11,31,58,0.92)"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.shade} pointerEvents="none" />
        <View style={s.inner}>
          <View style={s.topRow}>
            <T v="label" tone="goldBright" style={{ flex: 1 }} numberOfLines={1}>
              {b.project_name}
            </T>
            {!b.is_primary ? <Chip label="Co-applicant" tone="gold" testID="home-coapplicant-chip" /> : null}
            {b.status !== "Active" ? <Chip label={b.status} tone={b.status === "Completed" ? "success" : "neutral"} testID="home-booking-status" /> : null}
          </View>
          <T v="display" tone="inverse" style={{ marginTop: 6 }} testID="home-flat-number">
            Flat {b.flat_number}
          </T>
          <T tone="inverseMuted" style={{ marginTop: 2 }}>
            {b.block_name} · Floor {b.floor} · {b.flat_type} · {b.super_builtup_sqft?.toLocaleString?.("en-IN") ?? b.super_builtup_sqft} sq ft
          </T>
          <View style={s.progRow}>
            <ProgressRing value={b.construction_percent} testID="home-progress-ring" />
            <View style={{ flex: 1 }}>
              <T v="small" tone="inverseMuted">
                Construction · current milestone
              </T>
              <T v="title" tone="inverse" testID="home-current-milestone">
                {b.current_milestone || "Starting soon"}
              </T>
              {b.next_milestone ? (
                <T v="small" tone="goldBright" style={{ marginTop: 2 }}>
                  Up next: {b.next_milestone}
                </T>
              ) : b.construction_percent >= 100 ? (
                <T v="small" tone="goldBright" style={{ marginTop: 2 }}>
                  Construction complete
                </T>
              ) : null}
            </View>
            <View style={s.arrow}>
              <Feather name="arrow-up-right" size={18} color={colors.onBrandSecondary} />
            </View>
          </View>
        </View>
      </View>
    </Press>
  );
}

const useStyles = makeStyles((c) => ({
  card: { borderRadius: radius.xl, overflow: "hidden", backgroundColor: c.surfaceInverse, ...shadow },
  bg: { width: "100%", minHeight: 250 },
  img: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  shade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  inner: { padding: 22 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  progRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 22 },
  arrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.gold, alignItems: "center", justifyContent: "center" },
}));
