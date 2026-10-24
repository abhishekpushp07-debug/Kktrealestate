import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { useActiveBooking, useBookingSub } from "@/src/hooks";
import { errMsg } from "@/src/api/client";
import { inrShort } from "@/src/format";
import { makeStyles } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Button, Card } from "@/src/ui/primitives";
import { Pills } from "@/src/ui/pills";
import { T } from "@/src/ui/text";
import { SkeletonList, SkeletonScreen } from "@/src/ui/skeleton";
import { Empty, ErrorState, NoBooking } from "@/src/ui/states";
import { BookingSwitcher } from "@/src/ui/booking-switcher";
import { usePdf } from "@/src/screens/shared";
import { Receipts, type Payment } from "@/src/screens/payments/receipts";
import { Demands, type Demand } from "@/src/screens/payments/demands";
import { Schedule, type ScheduleData } from "@/src/screens/payments/schedule";
import { Ledger, type LedgerRow } from "@/src/screens/payments/ledger";

const TABS = [
  { key: "receipts", label: "Receipts" },
  { key: "ledger", label: "Ledger" },
  { key: "demands", label: "Demands" },
  { key: "schedule", label: "Schedule" },
  { key: "cheques", label: "Pending cheques" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Body({ tab, id, bn }: { tab: Tab; id: string; bn: string }) {
  const pdf = usePdf();
  const pay = useBookingSub<{ items: Payment[]; pending_cheques: Payment[] }>(id, "payments", tab === "receipts" || tab === "cheques");
  const dem = useBookingSub<{ items: Demand[] }>(id, "demands", tab === "demands");
  const sch = useBookingSub<ScheduleData>(id, "schedule", tab === "schedule");
  const led = useBookingSub<{ items: LedgerRow[] }>(id, "ledger", tab === "ledger");
  const q = tab === "receipts" || tab === "cheques" ? pay : tab === "demands" ? dem : tab === "schedule" ? sch : led;
  if (q.isLoading) return <SkeletonList rows={4} />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={q.refetch} />;
  const receiptPdf = (p: Payment) => pdf.open(`/bookings/${id}/payments/${p.id}/receipt.pdf`, `${p.receipt_number.replace(/\//g, "-")}.pdf`);
  if (tab === "receipts") return <Receipts items={pay.data?.items || []} onPdf={receiptPdf} busy={pdf.busy} empty={<Empty icon="credit-card" title="No payments recorded yet" hint="Receipts appear here as soon as a payment is posted." testID="receipts-empty" />} />;
  if (tab === "cheques")
    return <Receipts items={pay.data?.pending_cheques || []} onPdf={receiptPdf} busy={pdf.busy} empty={<Empty icon="check-circle" title="No cheques pending" hint="Cheques awaiting clearance will show here." testID="cheques-empty" />} />;
  if (tab === "demands")
    return dem.data?.items?.length ? (
      <Demands items={dem.data.items} busy={pdf.busy} onPdf={(d) => pdf.open(`/bookings/${id}/demands/${d.id}/letter.pdf`, `${d.demand_number}.pdf`)} />
    ) : (
      <Empty icon="file-text" title="No demands raised yet" hint="Demands are raised when construction milestones are certified." testID="demands-empty" />
    );
  if (tab === "schedule") return sch.data?.items?.length ? <Schedule data={sch.data} /> : <Empty icon="calendar" title="No payment schedule yet" testID="schedule-empty" />;
  return led.data?.items?.length ? (
    <Ledger items={led.data.items} />
  ) : (
    <Empty icon="book-open" title="No ledger entries yet" hint={`Statement for ${bn} will fill in as demands and payments are recorded.`} testID="ledger-empty" />
  );
}

export default function Payments() {
  const s = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = (TABS.find((t) => t.key === params.tab)?.key as Tab) || "receipts";
  const { items, active, select, isLoading, isError, error, refetch } = useActiveBooking();
  const pdf = usePdf();
  const statementPath = active ? `/bookings/${active.id}/statement.pdf` : "";
  return (
    <Screen tabbed testID="payments-screen" refreshKeys={[["p-bookings"], ["p-booking"]]}>
      <PageHeader
        title="Payments"
        sub={active ? `${active.booking_number} · Flat ${active.flat_number}` : undefined}
        right={active ? <Button small kind="ghost" icon="download" label="Statement" loading={pdf.busy === statementPath} onPress={() => pdf.open(statementPath, `statement-${active.booking_number}.pdf`)} testID="payments-statement-pdf" /> : null}
      />
      {isLoading ? (
        <SkeletonScreen />
      ) : isError ? (
        <ErrorState message={errMsg(error)} onRetry={refetch} />
      ) : !active ? (
        <NoBooking />
      ) : (
        <>
          <BookingSwitcher items={items} active={active} select={select} />
          <Card navy testID="payments-summary" style={s.summary}>
            {[
              ["Agreement", inrShort(active.agreement_value), "inverse"],
              ["Paid", inrShort(active.paid), "inverse"],
              [active.total_due < 0 ? "Advance" : "Due now", inrShort(Math.abs(active.total_due)), active.total_due > 0 ? "due" : active.total_due < 0 ? "adv" : "inverse"],
              ["Pending cheques", inrShort(active.pending_cheques), "inverse"],
            ].map(([l, v, tone]) => (
              <View key={l} style={s.sumCell}>
                <T v="label" tone="inverseMuted">
                  {l}
                </T>
                <T v="moneyLg" style={tone === "due" ? s.due : tone === "adv" ? s.adv : s.inv} testID={`payments-summary-${l.toLowerCase().replace(/\s+/g, "-")}`}>
                  {v}
                </T>
              </View>
            ))}
          </Card>
          <Pills testIDPrefix="payments-tab" items={TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={(k) => router.setParams({ tab: k })} />
          <Body tab={tab} id={active.id} bn={active.booking_number} />
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  summary: { flexDirection: "row", flexWrap: "wrap", rowGap: 16, padding: 20 },
  sumCell: { width: "50%", minWidth: 140, flexGrow: 1, gap: 4 },
  inv: { color: c.onSurfaceInverse, fontSize: 26 },
  due: { color: c.dueOnInverse, fontSize: 26 },
  adv: { color: c.advanceOnInverse, fontSize: 26 },
}));
