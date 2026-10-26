import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import type { PortalNoticeRow } from "@kkt/contracts";
import { queryClient, useNotices } from "@/api/queries";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { Markdown } from "@/ui/Markdown";
import { Header, Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { EmptyState, ErrorState, StatusBar } from "@/ui/States";
import { T } from "@/ui/Text";
import { colors, space } from "@/ui/theme";

function excerpt(md: string): string {
  return md
    .replace(/[#*_`>[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function NoticesScreen(): React.JSX.Element {
  const router = useRouter();
  const q = useNotices();
  const rows = q.data?.items ?? [];
  const unread = rows.filter((n) => !n.is_read).length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Notices" subtitle={unread ? `${unread} unread` : "From your project and the company"} back />
      {q.isError && q.data ? <StatusBar text="Showing saved notices — couldn't refresh." tone="warning" /> : null}
      <Screen onRefresh={() => queryClient.invalidateQueries({ queryKey: ["notices"] })}>
        {!q.data ? (
          q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <SkeletonRows rows={4} />
          )
        ) : rows.length === 0 ? (
          <EmptyState icon="notice" title="No notices yet" body="Announcements about your project will appear here." />
        ) : (
          <View style={{ gap: space.md }}>
            {rows.map((n) => (
              <NoticeCard key={n.id} n={n} onPress={() => router.navigate(`/more/notices/${n.id}`)} />
            ))}
          </View>
        )}
      </Screen>
    </View>
  );
}

function NoticeCard({ n, onPress }: { n: PortalNoticeRow; onPress: () => void }): React.JSX.Element {
  return (
    <Card onPress={onPress} style={!n.is_read ? styles.unread : null}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.meta}>
            {!n.is_read ? <View style={styles.dot} /> : null}
            <Chip label={n.project_name ?? "Company-wide"} tone={n.project_name ? "navy" : "gold"} small />
            <T variant="caption" color={colors.inkSubtle}>
              {formatDateTime(n.publish_at, { time: false })}
            </T>
          </View>
          <T variant="h3" numberOfLines={2}>
            {n.title}
          </T>
          <T variant="small" color={colors.inkMuted} numberOfLines={2}>
            {excerpt(n.body_md)}
          </T>
        </View>
        <Icon name="chevron-right" size={16} color={colors.inkSubtle} />
      </View>
    </Card>
  );
}

export function NoticeDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useNotices();
  const n = q.data?.items.find((x) => x.id === id);
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Notice" back />
      <Screen onRefresh={() => queryClient.invalidateQueries({ queryKey: ["notices"] })}>
        {n ? (
          <Card>
            <View style={styles.meta}>
              <Chip label={n.project_name ?? "Company-wide"} tone={n.project_name ? "navy" : "gold"} small />
              <T variant="caption" color={colors.inkSubtle}>
                Published {formatDateTime(n.publish_at)}
              </T>
            </View>
            <T variant="h1" style={{ marginTop: space.sm, marginBottom: space.md }}>
              {n.title}
            </T>
            <Markdown source={n.body_md} />
            {n.expires_at ? (
              <T variant="caption" color={colors.inkSubtle} style={{ marginTop: space.lg }}>
                Valid until {formatDateTime(n.expires_at, { time: false })}
              </T>
            ) : null}
          </Card>
        ) : q.isPending ? (
          <SkeletonRows rows={3} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <EmptyState icon="notice" title="Notice not found" body="It may have expired or been withdrawn." />
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  unread: { borderLeftWidth: 3, borderLeftColor: colors.gold },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold },
});
