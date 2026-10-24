import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { PortalConstructionStage, PortalConstructionTimelineResponse } from "@kkt/contracts";
import { refreshBooking, useConstruction } from "@/api/queries";
import { formatDate } from "@/lib/format";
import { Card } from "@/ui/Card";
import { StageStatusChip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { Lightbox, type LightboxImage } from "@/ui/Lightbox";
import { ProgressBar, ProgressRing } from "@/ui/ProgressRing";
import { useLayout } from "@/ui/Responsive";
import { Screen } from "@/ui/Screen";
import { SkeletonCard } from "@/ui/Skeleton";
import { EmptyState, ErrorState, StatusBar } from "@/ui/States";
import { T } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { BookingGate, TabHeader } from "./shared";

export function ConstructionScreen(): React.JSX.Element {
  return <BookingGate title="Construction">{(id) => <Body bookingId={id} />}</BookingGate>;
}

function Body({ bookingId }: { bookingId: string }): React.JSX.Element {
  const q = useConstruction(bookingId);
  const d = q.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <TabHeader title="Construction" subtitle={d ? `${d.block_name} · ${Math.round(d.percent)}% complete` : undefined} />
      {q.isError && d ? <StatusBar text="Showing saved progress — couldn't refresh." tone="warning" /> : null}
      <Screen onRefresh={() => refreshBooking(bookingId)}>
        {d ? <Timeline d={d} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <><SkeletonCard lines={2} /><SkeletonCard lines={5} /></>}
      </Screen>
    </View>
  );
}

function Timeline({ d }: { d: PortalConstructionTimelineResponse }): React.JSX.Element {
  const [viewer, setViewer] = useState<{ stage: number; index: number } | null>(null);
  const completed = d.stages.filter((s) => s.status === "COMPLETED").length;
  const images = useMemo<LightboxImage[]>(() => {
    if (!viewer) return [];
    const stage = d.stages[viewer.stage];
    return (stage?.photos ?? []).map((p) => ({ uri: p.medium_url, caption: p.caption ?? stage?.name ?? null, subtitle: p.taken_on ? formatDate(p.taken_on) : null }));
  }, [viewer, d.stages]);
  return (
    <>
      <Card tone="navy">
        <View style={styles.summary}>
          <ProgressRing percent={d.percent} size={110} onNavy />
          <View style={{ flex: 1, gap: 6 }}>
            <T variant="label" color={colors.gold}>
              {d.block_name}
            </T>
            <T variant="h2" color={colors.onNavy}>
              {d.current_stage ?? (d.percent >= 100 ? "Complete" : "Not started")}
            </T>
            <T variant="small" color={colors.onNavyMuted}>
              {completed} of {d.stages.length} stages complete
            </T>
            <ProgressBar percent={d.percent} onNavy />
          </View>
        </View>
      </Card>
      {d.stages.length === 0 ? <EmptyState icon="construction" title="No stages yet" body="Construction stages for your tower will appear here as work begins." /> : null}
      <View style={styles.timeline}>
        {d.stages.map((s, i) => (
          <StageRow key={`${s.name}-${i}`} stage={s} isLast={i === d.stages.length - 1} onOpenPhoto={(index) => setViewer({ stage: i, index })} />
        ))}
      </View>
      <Lightbox images={images} index={viewer?.index ?? null} onClose={() => setViewer(null)} onIndexChange={(index) => setViewer((v) => (v ? { ...v, index } : v))} />
    </>
  );
}

function StageRow({ stage, isLast, onOpenPhoto }: { stage: PortalConstructionStage; isLast: boolean; onOpenPhoto: (index: number) => void }): React.JSX.Element {
  const active = stage.status === "IN_PROGRESS";
  const done = stage.status === "COMPLETED";
  const { isPhone } = useLayout();
  const thumbWidth = isPhone ? "31%" : "23%";
  return (
    <View style={styles.stageRow}>
      <View style={styles.rail}>
        <View style={[styles.dot, done ? styles.dotDone : active ? styles.dotActive : null]}>{done ? <Icon name="check" size={12} color={colors.onNavy} /> : null}</View>
        {!isLast ? <View style={[styles.line, done ? styles.lineDone : null]} /> : null}
      </View>
      <Card style={[styles.stageCard, active ? styles.stageActive : null]}>
        <View style={styles.stageHead}>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="h3">{stage.name}</T>
            <T variant="caption" color={colors.inkSubtle}>
              {stage.started_on ? `Started ${formatDate(stage.started_on)}` : "Not started"}
              {stage.completed_on ? ` · Completed ${formatDate(stage.completed_on)}` : ""}
            </T>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <StageStatusChip status={stage.status} small />
            {stage.is_possession ? <T variant="caption" color={colors.gold700}>Possession stage</T> : null}
          </View>
        </View>
        {stage.notes ? (
          <T variant="small" color={colors.inkMuted} style={{ marginTop: space.sm }}>
            {stage.notes}
          </T>
        ) : null}
        {stage.photos.length ? (
          <View style={styles.photoGrid}>
            {stage.photos.map((p, i) => (
              <Pressable key={`${p.thumb_url}-${i}`} accessibilityRole="imagebutton" accessibilityLabel={p.caption ?? `Photo ${i + 1} of ${stage.name}`} onPress={() => onOpenPhoto(i)} style={({ pressed }) => [{ width: thumbWidth, aspectRatio: 1 }, pressed ? { opacity: 0.8 } : null]}>
                <Image source={{ uri: p.thumb_url }} style={styles.photo} contentFit="cover" transition={200} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: space.lg },
  timeline: { gap: 0 },
  stageRow: { flexDirection: "row", gap: space.md },
  rail: { width: 24, alignItems: "center" },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.navy200, alignItems: "center", justifyContent: "center", marginTop: 18 },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotActive: { borderColor: colors.gold, backgroundColor: colors.gold100 },
  line: { flex: 1, width: 2, backgroundColor: colors.navy100, marginTop: 4, marginBottom: -space.lg },
  lineDone: { backgroundColor: colors.success },
  stageCard: { flex: 1, marginBottom: space.lg },
  stageActive: { borderWidth: 1.5, borderColor: colors.gold },
  stageHead: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  photo: { width: "100%", height: "100%", borderRadius: radius.md, backgroundColor: colors.navy100 },
});
