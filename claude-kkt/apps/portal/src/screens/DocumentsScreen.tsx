import { StyleSheet, View } from "react-native";
import type { PortalDocumentRow } from "@kkt/contracts";
import { api } from "@/api/client";
import { refreshBooking, useDocuments } from "@/api/queries";
import { formatBytes, formatDateTime } from "@/lib/format";
import { Card } from "@/ui/Card";
import { Icon, type IconName } from "@/ui/Icon";
import { Header, Screen, Section } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { EmptyState, ErrorState, StatusBar } from "@/ui/States";
import { T } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { BookingGate, PdfButtons, useFileActions } from "./shared";

export function DocumentsScreen(): React.JSX.Element {
  return <BookingGate title="Documents">{(id) => <Body bookingId={id} />}</BookingGate>;
}

const KIND_ICON: Record<PortalDocumentRow["kind"], IconName> = { STATEMENT: "rupee", ALLOTMENT_LETTER: "notice", SHARED: "document", PLAN_ACCEPTANCE: "check" };

function Body({ bookingId }: { bookingId: string }): React.JSX.Element {
  const q = useDocuments(bookingId);
  const files = useFileActions();
  const items = q.data?.items ?? [];
  const shared = items.filter((d) => d.kind === "SHARED" || d.kind === "PLAN_ACCEPTANCE");
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Documents" subtitle="Statements, letters and files shared with you" back />
      {q.isError && q.data ? <StatusBar text="Showing saved list — couldn't refresh." tone="warning" /> : null}
      <Screen onRefresh={() => refreshBooking(bookingId)}>
        <Section title="Generated for you">
          <Card padded={false}>
            <DocRow icon="rupee" title="Account statement" subtitle="Every demand and payment with running balances" keyBase="statement" fetchLink={() => api.bookings.statementPdf(bookingId)} files={files} />
            <DocRow icon="notice" title="Allotment letter" subtitle="Confirms your flat allotment" keyBase="allotment" fetchLink={() => api.bookings.allotmentLetterPdf(bookingId)} files={files} last />
          </Card>
        </Section>
        <Section title="Shared by our team">
          {!q.data ? (
            q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonRows rows={3} />
          ) : shared.length === 0 ? (
            <EmptyState icon="document" title="Nothing shared yet" body="Agreements, plans and other files our team shares with you will appear here." />
          ) : (
            <Card padded={false}>
              {shared.map((d, i) => (
                <DocRow
                  key={d.document_id}
                  icon={KIND_ICON[d.kind]}
                  title={d.title}
                  subtitle={`${d.document_type_name ? `${d.document_type_name} · ` : ""}${formatBytes(d.size_bytes)}${d.shared_at ? ` · ${formatDateTime(d.shared_at, { time: false })}` : ""}`}
                  keyBase={`doc:${d.document_id}`}
                  mime={d.mime}
                  fetchLink={() => api.bookings.documentDownload(bookingId, d.document_id)}
                  files={files}
                  last={i === shared.length - 1}
                />
              ))}
            </Card>
          )}
        </Section>
      </Screen>
    </View>
  );
}

function DocRow({ icon, title, subtitle, keyBase, fetchLink, files, mime, last }: { icon: IconName; title: string; subtitle: string; keyBase: string; fetchLink: () => Promise<import("@kkt/contracts").PortalPdfLinkResponse>; files: ReturnType<typeof useFileActions>; mime?: string; last?: boolean }): React.JSX.Element {
  const fetchTyped = async () => fetchLink();
  const actions = {
    ...files,
    view: (k: string, fn: () => Promise<import("@kkt/contracts").PortalPdfLinkResponse>) => files.view(k, fn, mime),
    download: (k: string, fn: () => Promise<import("@kkt/contracts").PortalPdfLinkResponse>) => files.download(k, fn, mime),
  };
  return (
    <View style={[styles.row, last ? null : styles.border]}>
      <View style={styles.iconWrap}>
        <Icon name={icon} size={18} color={colors.navy} />
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <T variant="bodyStrong" numberOfLines={2}>
          {title}
        </T>
        <T variant="caption" color={colors.inkMuted} numberOfLines={2}>
          {subtitle}
        </T>
      </View>
      <PdfButtons keyBase={keyBase} fetchLink={fetchTyped} actions={actions} compact />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, flexWrap: "wrap" },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  iconWrap: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center" },
});
