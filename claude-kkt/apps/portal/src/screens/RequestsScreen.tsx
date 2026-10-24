import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SERVICE_STATUSES, SERVICE_STATUS_LABELS, type PortalRequestRow, type ServiceStatus } from "@kkt/contracts";
import { queryClient, useRequests } from "@/api/queries";
import { useBooking } from "@/booking/BookingProvider";
import { formatRelative } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Chip, PriorityChip, ServiceStatusChip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { StarRating } from "@/ui/ListRow";
import { Header, Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { SkeletonRows } from "@/ui/Skeleton";
import { EmptyState, ErrorState, StatusBar } from "@/ui/States";
import { T } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

type Filter = "ALL" | "OPEN" | ServiceStatus;
const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "OPEN", label: "Open" },
  ...SERVICE_STATUSES.map((s) => ({ key: s, label: SERVICE_STATUS_LABELS[s] })),
];
const OPEN: ReadonlySet<ServiceStatus> = new Set(["NEW", "IN_PROGRESS", "AWAITING_CUSTOMER"]);

export function RequestsScreen(): React.JSX.Element {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("ALL");
  const { bookings } = useBooking();
  const q = useRequests({});
  const all = q.data?.items ?? [];
  const rows = all.filter((r) => (filter === "ALL" ? true : filter === "OPEN" ? OPEN.has(r.status) : r.status === filter));
  const counts = { ALL: all.length, OPEN: all.filter((r) => OPEN.has(r.status)).length };
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Requests" subtitle="Questions, documents, snags — we track every one" back right={<Button title="New" icon="plus" variant="gold" size="sm" onPress={() => router.navigate("/more/requests/new")} />}>
        <SegmentedControl segments={FILTERS.map((f) => ({ ...f, count: f.key === "ALL" ? counts.ALL : f.key === "OPEN" ? counts.OPEN : undefined }))} value={filter} onChange={setFilter} scroll />
      </Header>
      {q.isError && q.data ? <StatusBar text="Showing saved requests — couldn't refresh." tone="warning" /> : null}
      <Screen onRefresh={() => queryClient.invalidateQueries({ queryKey: ["requests"] })}>
        {!q.data ? (
          q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon="request" title={all.length === 0 ? "No requests yet" : "Nothing here"} body={all.length === 0 ? "Raise a request for payment queries, documents, construction questions or snags. Our team replies right here." : "No requests match this filter."} action={all.length === 0 ? "Raise a request" : undefined} onAction={() => router.navigate("/more/requests/new")} />
        ) : (
          <View style={{ gap: space.md }}>
            {rows.map((r) => (
              <RequestCard key={r.id} r={r} showFlat={bookings.length > 1} onPress={() => router.navigate(`/more/requests/${r.id}`)} />
            ))}
          </View>
        )}
      </Screen>
    </View>
  );
}

function RequestCard({ r, showFlat, onPress }: { r: PortalRequestRow; showFlat: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Card onPress={onPress}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="caption" color={colors.inkSubtle}>
            {r.ticket_number} · {r.category_name}
            {showFlat ? ` · ${r.flat_number}` : ""}
          </T>
          <T variant="bodyStrong" numberOfLines={2}>
            {r.subject}
          </T>
          <T variant="small" color={colors.inkMuted} numberOfLines={2}>
            {r.description}
          </T>
        </View>
        <Icon name="chevron-right" size={16} color={colors.inkSubtle} />
      </View>
      <View style={styles.foot}>
        <ServiceStatusChip status={r.status} small />
        <PriorityChip priority={r.priority} small />
        {r.status === "AWAITING_CUSTOMER" ? <Chip label="Your reply needed" tone="warning" small icon="chat" /> : null}
        {r.rating ? <StarRating value={r.rating} size={14} /> : null}
        <T variant="caption" color={colors.inkSubtle} style={{ marginLeft: "auto" }}>
          {formatRelative(r.last_message_at ?? r.updated_at)}
        </T>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  foot: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: space.md },
});
