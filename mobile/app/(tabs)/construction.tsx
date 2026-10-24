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

type Construction = { block_name: string; construction_percent: number; milestones: Milestone[]; up_next?: string | null };

export default function ConstructionScreen() {
  const { items, active, select, isLoading, isError, error, refetch } = useActiveBooking();
  const q = useBookingSub<Construction>(active?.id, "construction");
  const [lb, setLb] = useState<number | null>(null);
  const data = q.data;
  const photos = useMemo(
    () => (data?.milestones || []).flatMap((m) => m.photos.map((p) => ({ id: p.id, uri: photoUri(p), caption: p.caption || m.name, sub: p.taken_on ? `${m.name} · ${fmtDate(p.taken_on)}` : m.name }))),
    [data],
  );
  const openPhoto = (p: Photo) => setLb(Math.max(0, photos.findIndex((x) => x.id === p.id)));
  const nextIdx = (data?.milestones || []).findIndex((m) => m.status !== "Completed");
  const completed = (data?.milestones || []).filter((m) => m.status === "Completed").length;

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
                {completed} of {data.milestones.length} milestones
              </T>
            </View>
            <View style={{ marginTop: 12 }}>
              <ProgressBar value={data.construction_percent} tone="navy" h={10} />
            </View>
            <T v="small" tone="muted" style={{ marginTop: 10 }}>
              {photos.length} site photo{photos.length === 1 ? "" : "s"} · tap any photo to view full screen
            </T>
          </Card>
          <Card testID="construction-timeline" style={{ paddingTop: 20 }}>
            {data.milestones.map((m, i) => (
              <TimelineItem key={m.seq} m={m} next={i === nextIdx} last={i === data.milestones.length - 1} onPhoto={openPhoto} />
            ))}
          </Card>
          <Lightbox photos={photos} index={lb} onClose={() => setLb(null)} />
        </>
      )}
    </Screen>
  );
}
