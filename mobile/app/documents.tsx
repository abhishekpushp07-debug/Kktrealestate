import { View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useActiveBooking, useBookingSub } from "@/src/hooks";
import { errMsg } from "@/src/api/client";
import { fmtDate } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Card, SectionTitle, type IconName } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { SkeletonList } from "@/src/ui/skeleton";
import { Empty, ErrorState, NoBooking } from "@/src/ui/states";
import { BookingSwitcher } from "@/src/ui/booking-switcher";
import { usePdf } from "@/src/screens/shared";
import { DownloadDot } from "@/src/screens/payments/receipts";

type Doc = { id: string; created_at: string; document_type_name?: string; title?: string; file_name: string; mime?: string; size?: number };

function DocRow({ icon, title, sub, onPress, busy, testID, last }: { icon: IconName; title: string; sub: string; onPress: () => void; busy: boolean; testID: string; last?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      <View style={s.icon}>
        <Feather name={icon} size={20} color={colors.onSurface} />
      </View>
      <View style={{ flex: 1 }}>
        <T v="bodyStrong" numberOfLines={1}>
          {title}
        </T>
        <T v="small" tone="muted" numberOfLines={1}>
          {sub}
        </T>
      </View>
      <DownloadDot onPress={onPress} busy={busy} testID={testID} label={`Open ${title}`} />
    </View>
  );
}

export default function Documents() {
  const { items, active, select, isLoading } = useActiveBooking();
  const q = useBookingSub<{ items: Doc[] }>(active?.id, "documents");
  const pdf = usePdf();
  const id = active?.id;
  const allot = `/bookings/${id}/allotment.pdf`;
  const stmt = `/bookings/${id}/statement.pdf`;
  return (
    <Screen testID="documents-screen" refreshKeys={[["p-booking", id, "documents"]]}>
      <PageHeader back title="Documents" sub="Letters and files shared for your booking." />
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : !active ? (
        <NoBooking />
      ) : (
        <>
          <BookingSwitcher items={items} active={active} select={select} />
          <Card testID="documents-generated" style={{ paddingBottom: 4 }}>
            <SectionTitle title="Generated for you" />
            <DocRow icon="award" title="Allotment letter" sub={active.booking_number} busy={pdf.busy === allot} onPress={() => pdf.open(allot, `allotment-${active.booking_number}.pdf`)} testID="doc-allotment-pdf" />
            <DocRow icon="file-text" title="Account statement" sub="Full ledger to date" busy={pdf.busy === stmt} onPress={() => pdf.open(stmt, `statement-${active.booking_number}.pdf`)} testID="doc-statement-pdf" last />
          </Card>
          {q.isLoading ? (
            <SkeletonList rows={2} />
          ) : q.isError ? (
            <ErrorState message={errMsg(q.error)} onRetry={q.refetch} />
          ) : q.data?.items?.length ? (
            <Card testID="shared-documents" style={{ paddingBottom: 4 }}>
              <SectionTitle title="Shared files" />
              {q.data.items.map((d, i) => {
                const path = `/bookings/${id}/documents/${d.id}/download`;
                return (
                  <DocRow
                    key={d.id}
                    icon={d.mime?.startsWith("image/") ? "image" : "file"}
                    title={d.title || d.file_name}
                    sub={`${d.document_type_name || "Document"} · ${fmtDate(d.created_at)}${d.size ? ` · ${Math.max(1, Math.round(d.size / 1024))} KB` : ""}`}
                    busy={pdf.busy === path}
                    onPress={() => pdf.open(path, d.file_name, d.mime || "application/pdf")}
                    testID={`shared-doc-${d.id}`}
                    last={i === q.data!.items.length - 1}
                  />
                );
              })}
            </Card>
          ) : (
            <Empty icon="folder" title="No shared files yet" hint="Your Relationship Manager can share signed copies here." testID="shared-documents-empty" />
          )}
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.navy50, alignItems: "center", justifyContent: "center" },
}));
