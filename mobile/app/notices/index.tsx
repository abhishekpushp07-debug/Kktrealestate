import { View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useNotices } from "@/src/hooks";
import { errMsg } from "@/src/api/client";
import { makeStyles, useTheme } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Card, Press } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { SkeletonList } from "@/src/ui/skeleton";
import { Empty, ErrorState } from "@/src/ui/states";
import { stripMarkdown } from "@/src/ui/markdown";
import { NoticeMeta, type Notice } from "@/src/screens/notice-meta";

export default function Notices() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const q = useNotices();
  const items: Notice[] = q.data?.items || [];
  return (
    <Screen testID="notices-screen" refreshKeys={[["p-notices"]]}>
      <PageHeader back title="Notices" sub={q.data?.unread ? `${q.data.unread} unread` : "You're up to date"} />
      {q.isLoading ? (
        <SkeletonList rows={3} h={110} />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={q.refetch} />
      ) : !items.length ? (
        <Empty icon="bell" title="No notices" hint="Site updates and announcements will appear here." testID="notices-empty" />
      ) : (
        <View style={{ gap: 10 }} testID="notices-list">
          {items.map((n) => (
            <Press key={n.id} onPress={() => router.push(`/notices/${n.id}`)} testID={`notice-card-${n.id}`}>
              <Card style={[s.card, !n.read && s.unread]}>
                <View style={{ flex: 1, gap: 6 }}>
                  <NoticeMeta n={n} />
                  <T v="h2">{n.title}</T>
                  <T tone="muted" numberOfLines={2}>
                    {stripMarkdown(n.body)}
                  </T>
                </View>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Card>
            </Press>
          ))}
        </View>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  card: { flexDirection: "row", alignItems: "center", gap: 10 },
  unread: { borderLeftWidth: 4, borderLeftColor: c.gold },
}));
