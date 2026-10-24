import { useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useNotices } from "@/src/hooks";
import { api, errMsg } from "@/src/api/client";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Card } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { SkeletonScreen } from "@/src/ui/skeleton";
import { Empty, ErrorState } from "@/src/ui/states";
import { Markdown } from "@/src/ui/markdown";
import { NoticeMeta, type Notice } from "@/src/screens/notice-meta";

export default function NoticeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useNotices();
  const n: Notice | undefined = (q.data?.items || []).find((x: Notice) => x.id === id);

  useEffect(() => {
    if (!n || n.read) return;
    api
      .post(`/notices/${n.id}/read`)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["p-notices"] });
      })
      .catch(() => {});
  }, [n, qc]);

  return (
    <Screen testID="notice-detail-screen" refreshKeys={[["p-notices"]]}>
      <PageHeader back title="Notice" />
      {q.isLoading ? (
        <SkeletonScreen />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={q.refetch} />
      ) : !n ? (
        <Empty icon="bell-off" title="Notice not available" hint="It may have expired or been withdrawn." testID="notice-not-found" />
      ) : (
        <Card testID="notice-detail" style={{ gap: 10, padding: 22 }}>
          <NoticeMeta n={n} />
          <T v="h1" testID="notice-title">
            {n.title}
          </T>
          <Markdown text={n.body} testID="notice-body" />
        </Card>
      )}
    </Screen>
  );
}
