import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useRequests } from "@/src/hooks";
import { errMsg } from "@/src/api/client";
import { fmtDateTime } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Button, Card, Chip, Press } from "@/src/ui/primitives";
import { Pills } from "@/src/ui/pills";
import { T } from "@/src/ui/text";
import { SkeletonList } from "@/src/ui/skeleton";
import { Empty, ErrorState } from "@/src/ui/states";
import { statusTone } from "@/src/screens/shared";

const FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "open", label: "Open", match: (s: string) => ["New", "In Progress"].includes(s) },
  { key: "awaiting", label: "Needs my reply", match: (s: string) => s === "Awaiting Customer" },
  { key: "resolved", label: "Resolved", match: (s: string) => s === "Resolved" },
  { key: "closed", label: "Closed", match: (s: string) => s === "Closed" },
] as const;
type F = (typeof FILTERS)[number]["key"];

export default function Requests() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useRequests();
  const [f, setF] = useState<F>("all");
  const all = data || [];
  const list = all.filter((r) => FILTERS.find((x) => x.key === f)!.match(r.status));
  return (
    <Screen tabbed testID="requests-screen" refreshKeys={[["p-requests"]]}>
      <PageHeader title="Requests" sub="Questions, documents, snags — we're here." right={<Button small kind="gold" icon="plus" label="New" onPress={() => router.push("/requests/new")} testID="new-request-button" />} />
      {isLoading ? (
        <SkeletonList rows={3} h={96} />
      ) : isError ? (
        <ErrorState message={errMsg(error)} onRetry={refetch} />
      ) : !all.length ? (
        <Empty icon="message-square" title="No requests yet" hint="Raise a request for payment queries, documents or site snags. We usually reply within a day." action={{ label: "Raise a request", onPress: () => router.push("/requests/new"), testID: "requests-empty-new" }} testID="requests-empty" />
      ) : (
        <>
          <Pills testIDPrefix="requests-filter" items={FILTERS.map((x) => ({ key: x.key, label: x.label, count: x.key === "all" ? 0 : all.filter((r) => x.match(r.status)).length }))} value={f} onChange={setF} />
          {list.length ? (
            <View style={{ gap: 10 }} testID="requests-list">
              {list.map((r) => (
                <Press key={r.id} onPress={() => router.push(`/requests/${r.id}`)} testID={`request-card-${r.ticket_number}`}>
                  <Card style={s.card}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={s.line}>
                        <T v="small" tone="muted">
                          {r.ticket_number}
                        </T>
                        <Chip label={r.status} tone={statusTone(r.status)} />
                        {r.priority === "High" ? <Chip label="High" tone="error" /> : null}
                      </View>
                      <T v="bodyStrong" numberOfLines={2}>
                        {r.subject}
                      </T>
                      <T v="small" tone="muted">
                        {r.category} · Flat {r.flat_number} · {fmtDateTime(r.updated_at || r.created_at)}
                      </T>
                      {r.status === "Awaiting Customer" ? (
                        <T v="small" tone="gold" style={{ fontFamily: "Manrope_700Bold" }}>
                          Your reply is needed
                        </T>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.muted} />
                  </Card>
                </Press>
              ))}
            </View>
          ) : (
            <Empty icon="filter" title="Nothing here" hint="No requests match this filter." testID="requests-filter-empty" />
          )}
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
}));
