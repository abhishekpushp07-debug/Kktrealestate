import { useMemo, useState } from "react";
import { View } from "react-native";

import { useActiveBooking, useBookingSub } from "@/src/hooks";
import { errMsg } from "@/src/api/client";
import { fmtDate } from "@/src/format";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Card } from "@/src/ui/primitives";
import { ProgressBar } from "@/src/ui/progress";
import { T } from "@/src/ui/text";
import { SkeletonScreen } from "@/src/ui/skeleton";
import { ErrorState, NoBooking } from "@/src/ui/states";
import { BookingSwitcher } from "@/src/ui/booking-switcher";
import { Lightbox } from "@/src/ui/lightbox";
import { photoUri, TimelineItem, type Milestone, type Photo } from "@/src/screens/construction/timeline";

type Construction = { block_name: string; construction_percent: number; stages?: Milestone[]; milestones?: Milestone[]; up_next?: string | null };

// Prefer Phase-7 `stages` (progress text in `notes`); fall back to legacy
// `milestones` (and their `update` text) when a field is missing.
function stagesOf(d?: Construction): Milestone[] {
  if (!d) return [];
  const legacy = d.milestones || [];
  if (!d.stages?.length) return legacy;
  const notes = new Map(legacy.map((m) => [m.name, m.update]));
  return d.stages.map((st) => ({ ...st, photos: st.photos || [], update: st.notes ?? st.update ?? notes.get(st.name) ?? null }));
}

export default function ConstructionScreen() {
  const { items, active, select, isLoading, isError, error, refetch } = useActiveBooking();
  const q = useBookingSub<Construction>(active?.id, "construction");
  const [lb, setLb] = useState<number | null>(null);
  const data = q.data;
  const stages = useMemo(() => stagesOf(data), [data]);
  const photos = useMemo(
    () => stages.flatMap((m) => m.photos.map((p) => ({ id: p.id, uri: photoUri(p), caption: p.caption || m.name, sub: p.taken_on ? `${m.name} · ${fmtDate(p.taken_on)}` : m.name }))),
    [stages],
  );
  const openPhoto = (p: Photo) => setLb(Math.max(0, photos.findIndex((x) => x.id === p.id)));
  const nextIdx = stages.findIndex((m) => m.status !== "Completed");
  const completed = stages.filter((m) => m.status === "Completed").length;
  const inProgress = stages.find((m) => m.status === "In Progress");

  return (
    <Screen tabbed testID="construction-screen" refreshKeys={[["p-bookings"], ["p-booking", active?.id, "construction"]]}>
      <PageHeader title="Construction" sub={data ? `${data.block_name} · ${data.construction_percent}% complete${data.up_next ? ` · up next: ${data.up_next}` : ""}` : undefined} />
      {isLoading || (active && q.isLoading) ? (
        <SkeletonScreen />
      ) : isError || q.isError ? (
        <ErrorState message={errMsg(error || q.error)} onRetry={() => (isError ? refetch() : q.refetch())} />
      ) : !active || !data ? (
        <NoBooking />
      ) : (
        <>
          <BookingSwitcher items={items} active={active} select={select} />
          <Card testID="construction-progress-card">
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
              <View>
                <T v="small" tone="muted">
                  Overall progress · {data.block_name}
                </T>
                <T v="moneyLg" testID="construction-percent">
                  {data.construction_percent}%
                </T>
              </View>
              <T v="small" tone="muted">
                {completed} of {stages.length} stages
              </T>
            </View>
            <View style={{ marginTop: 12 }}>
              <ProgressBar value={data.construction_percent} tone="navy" h={10} />
            </View>
            {inProgress ? (
              <T v="small" tone="gold" style={{ marginTop: 10, fontFamily: "Manrope_700Bold" }} testID="construction-in-progress">
                In progress now: {inProgress.name}
              </T>
            ) : data.up_next ? (
              <T v="small" tone="muted" style={{ marginTop: 10 }} testID="construction-next-stage">
                Next stage: {data.up_next}
              </T>
            ) : null}
            <T v="small" tone="muted" style={{ marginTop: 6 }}>
              {photos.length} site photo{photos.length === 1 ? "" : "s"} · tap any photo to view full screen
            </T>
          </Card>
          <Card testID="construction-timeline" style={{ paddingTop: 20 }}>
            {stages.map((m, i) => (
              <TimelineItem key={m.seq} m={m} next={i === nextIdx} last={i === stages.length - 1} onPhoto={openPhoto} />
            ))}
          </Card>
          <Lightbox photos={photos} index={lb} onClose={() => setLb(null)} />
        </>
      )}
    </Screen>
  );
}
