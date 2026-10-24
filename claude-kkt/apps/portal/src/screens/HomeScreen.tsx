import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BOOKING_STATUS_LABELS, PLAN_TYPE_LABELS, type PortalHomeResponse } from "@kkt/contracts";
import { api } from "@/api/client";
import { refreshBooking, useHome } from "@/api/queries";
import { useBooking } from "@/booking/BookingProvider";
import { formatDate, formatINR, greetingForNow } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { openMail, openTel, openWhatsApp } from "@/lib/links";
import { Button } from "@/ui/Button";
import { Card, CardHeader, Divider } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Icon, type IconName } from "@/ui/Icon";
import { Avatar } from "@/ui/ListRow";
import { DueMoney, Money } from "@/ui/Money";
import { ProgressRing } from "@/ui/ProgressRing";
import { useLayout } from "@/ui/Responsive";
import { Col, Columns, Screen } from "@/ui/Screen";
import { Skeleton, SkeletonCard } from "@/ui/Skeleton";
import { ErrorState, Notice, StatusBar } from "@/ui/States";
import { T } from "@/ui/Text";
import { BellButton } from "@/ui/shell/BellButton";
import { BookingChip } from "@/ui/shell/BookingSwitcher";
import { colors, radius, shadow, space } from "@/ui/theme";
import { BookingGate, useFileActions } from "./shared";

export function HomeScreen(): React.JSX.Element {
  return <BookingGate title="Home">{(bookingId) => <HomeBody bookingId={bookingId} />}</BookingGate>;
}

function HomeBody({ bookingId }: { bookingId: string }): React.JSX.Element {
  const home = useHome(bookingId);
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const { current } = useBooking();
  const data = home.data;
  const name = data?.greeting_name ?? "";
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <LinearGradient colors={[colors.navy, colors.navy800]} style={[styles.hero, { paddingTop: insets.top + (layout.isDesktop ? space.xl : space.md), paddingHorizontal: layout.gutter }]}>
        <View style={[styles.heroInner, { maxWidth: layout.maxWidth }]}>
          <View style={styles.heroRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="label" color={colors.gold}>
                {greetingForNow()}
              </T>
              <T variant="h1" color={colors.onNavy} numberOfLines={1}>
                {name ? name : current ? "Welcome" : ""}
              </T>
            </View>
            <View style={styles.heroActions}>
              <BookingChip onNavy />
              <BellButton onNavy count={data?.notifications_unread} />
            </View>
          </View>
        </View>
      </LinearGradient>
      {home.isError && data ? <StatusBar text="Showing the last saved data — we couldn't refresh just now." tone="warning" /> : null}
      <Screen onRefresh={() => refreshBooking(bookingId)} contentStyle={{ paddingTop: space.lg }}>
        {data ? <HomeContent data={data} bookingId={bookingId} /> : home.isError ? <ErrorState error={home.error} onRetry={() => void home.refetch()} /> : <HomeSkeleton />}
      </Screen>
    </View>
  );
}

function HomeSkeleton(): React.JSX.Element {
  return (
    <>
      <SkeletonCard lines={3} height={200} />
      <Columns>
        <Col>
          <SkeletonCard lines={4} />
        </Col>
        <Col>
          <SkeletonCard lines={4} />
        </Col>
      </Columns>
      <Skeleton height={56} />
    </>
  );
}

function HomeContent({ data, bookingId }: { data: PortalHomeResponse; bookingId: string }): React.JSX.Element {
  const router = useRouter();
  const files = useFileActions();
  const { current } = useBooking();
  const b = data.booking;
  const rm = data.relationship_manager;
  const stage = data.construction;
  return (
    <>
      {/* Hero card */}
      <Card padded={false} onPress={() => router.navigate("/flat")} style={styles.flatCard}>
        <View style={styles.flatImageWrap}>
          {b.project_image_url ? <Image source={{ uri: b.project_image_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} /> : null}
          <LinearGradient colors={["rgba(11,31,58,0.05)", "rgba(11,31,58,0.92)"]} style={StyleSheet.absoluteFill} />
          <View style={styles.flatText}>
            <View style={styles.chipRow}>
              <Chip label={BOOKING_STATUS_LABELS[b.status]} tone={b.status === "ACTIVE" ? "gold" : b.status === "COMPLETED" ? "success" : "danger"} small />
              {current ? <Chip label={current.role === "PRIMARY" ? "Primary applicant" : "Co-applicant"} tone="neutral" small /> : null}
            </View>
            <T variant="display" color={colors.onNavy} style={{ fontSize: 40, lineHeight: 44 }}>
              {b.flat_number}
            </T>
            <T variant="bodyStrong" color={colors.onNavy}>
              {b.block_name} · {b.floor_label} · {b.flat_type_name}
            </T>
            <T variant="small" color={colors.onNavyMuted}>
              {b.project_name} · Booking {b.booking_number} · {formatDate(b.booking_date)}
            </T>
          </View>
        </View>
      </Card>

      <Columns>
        <Col>
          {/* Construction */}
          <Card onPress={() => router.navigate("/construction")}>
            <CardHeader eyebrow="Construction" title={stage.current_stage ? stage.current_stage : "Not started"} subtitle={stage.next_stage ? `Up next: ${stage.next_stage}` : stage.percent >= 100 ? "All stages complete" : undefined} action="Timeline" onAction={() => router.navigate("/construction")} />
            <View style={styles.ringRow}>
              <ProgressRing percent={stage.percent} size={120} />
              <View style={{ flex: 1, gap: space.sm }}>
                <T variant="small" color={colors.inkMuted}>
                  {b.block_name} is {Math.round(stage.percent)}% complete.
                </T>
                {data.plan.plan_type === "CONSTRUCTION_LINKED" ? (
                  <T variant="caption" color={colors.inkSubtle}>
                    Installments are raised as stages complete.
                  </T>
                ) : null}
              </View>
            </View>
          </Card>

          {/* Payment plan & next installment */}
          <Card onPress={() => router.navigate("/payments?tab=schedule")}>
            <CardHeader eyebrow="Payment plan" title={data.plan.name} subtitle={`${PLAN_TYPE_LABELS[data.plan.plan_type]}${data.plan.accepted_on ? ` · accepted ${formatDate(data.plan.accepted_on)}` : ""}`} action="Schedule" onAction={() => router.navigate("/payments?tab=schedule")} />
            {data.next_installment ? (
              <View style={styles.nextInst}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="label" color={colors.inkSubtle}>
                    Next installment
                  </T>
                  <T variant="bodyStrong">{data.next_installment.name}</T>
                  <T variant="small" color={colors.inkMuted}>
                    {data.next_installment.trigger_label}
                    {data.next_installment.expected_date ? ` · expected ${formatDate(data.next_installment.expected_date)}` : ""}
                  </T>
                  <View style={styles.chipRow}>
                    <Chip label={`Cash ${formatINR(data.next_installment.cash_paise)}`} tone="gold" small />
                    <Chip label={`Account ${formatINR(data.next_installment.account_paise)}`} tone="navy" small />
                  </View>
                </View>
                <Money paise={data.next_installment.total_paise} variant="h2" color={colors.navy} />
              </View>
            ) : (
              <T variant="small" color={colors.inkMuted}>
                No further installments are pending on this plan.
              </T>
            )}
          </Card>
        </Col>

        <Col>
          {/* Money grid */}
          <Card>
            <CardHeader eyebrow="Your money" title="Paid, due & advance" subtitle="By bucket — Cash and Account" action="Ledger" onAction={() => router.navigate("/payments?tab=ledger")} />
            <MoneyGrid money={data.money} />
            {data.pending_cheques_paise > 0 ? (
              <Notice tone="warning" icon="clock" title={`${formatINR(data.pending_cheques_paise)} in cheques pending`} body="Cheques count once they clear. Until then they appear as “cheques in hand”." style={{ marginTop: space.md }} />
            ) : null}
            {data.money.other_charges_due_paise !== 0 ? (
              <View style={styles.otherCharges}>
                <T variant="small" color={colors.inkMuted}>
                  Other charges due
                </T>
                <DueMoney paise={data.money.other_charges_due_paise} variant="bodyStrong" />
              </View>
            ) : null}
          </Card>

          {/* Notices strip */}
          <Pressable accessibilityRole="button" onPress={() => router.navigate("/more/notices")} style={({ pressed }) => [styles.noticeStrip, pressed ? { opacity: 0.85 } : null]}>
            <View style={styles.noticeIcon}>
              <Icon name="notice" size={18} color={colors.gold700} />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{data.notices_unread > 0 ? `${data.notices_unread} new notice${data.notices_unread > 1 ? "s" : ""}` : "Notices"}</T>
              <T variant="caption" color={colors.inkMuted}>
                {data.notices_unread > 0 ? "From your project and the company" : "You're all caught up"}
              </T>
            </View>
            <Icon name="chevron-right" size={16} color={colors.inkSubtle} />
          </Pressable>
        </Col>
      </Columns>

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <QuickAction icon="download" label="Statement" hint="Download PDF" loading={files.busyKey === "statement:dl"} onPress={() => files.download("statement:dl", () => api.bookings.statementPdf(bookingId))} />
        <QuickAction icon="bank" label="Bank details" hint="For Account transfers" onPress={() => router.navigate("/more/bank-details")} />
        <QuickAction icon="request" label="Raise request" hint="We're here to help" onPress={() => router.navigate("/more/requests/new")} />
      </View>

      {/* Relationship manager */}
      {rm ? (
        <Card>
          <View style={styles.rmRow}>
            <Avatar name={rm.name} size={48} />
            <View style={{ flex: 1 }}>
              <T variant="label" color={colors.inkSubtle}>
                Your relationship manager
              </T>
              <T variant="h3">{rm.name}</T>
              {rm.email ? (
                <T variant="small" color={colors.navy} onPress={() => void openMail(rm.email ?? "")} accessibilityRole="link">
                  {rm.email}
                </T>
              ) : null}
            </View>
          </View>
          <Divider style={{ marginVertical: space.md }} />
          <View style={styles.rmActions}>
            {rm.phone ? <Button title="Call" icon="phone" variant="primary" onPress={() => void openTel(rm.phone ?? "")} /> : null}
            {rm.whatsapp ?? rm.phone ? (
              <Button
                title="WhatsApp"
                icon="chat"
                variant="outline"
                style={{ borderColor: "#25D366" }}
                onPress={() => {
                  haptics.tap();
                  void openWhatsApp(rm.whatsapp ?? rm.phone ?? "", `Hi ${rm.name}, this is ${data.greeting_name} (${b.flat_number}, ${b.block_name}).`);
                }}
              />
            ) : null}
          </View>
        </Card>
      ) : null}
    </>
  );
}

function MoneyGrid({ money }: { money: PortalHomeResponse["money"] }): React.JSX.Element {
  const rows: ReadonlyArray<{ label: string; key: "paid_paise" | "due_paise" | "advance_paise" }> = [
    { label: "Paid", key: "paid_paise" },
    { label: "Due", key: "due_paise" },
    { label: "Advance", key: "advance_paise" },
  ];
  const cell = (key: (typeof rows)[number]["key"], v: number) => {
    if (key === "paid_paise") return <Money paise={v} />;
    if (key === "due_paise") return v > 0 ? <Money paise={v} color={colors.danger} /> : <Money paise={0} color={colors.inkSubtle} />;
    return v > 0 ? <DueMoney paise={-v} /> : <Money paise={0} color={colors.inkSubtle} />;
  };
  return (
    <View style={styles.grid}>
      <View style={styles.gridRow}>
        <View style={styles.gridLabel} />
        <View style={styles.gridCell}>
          <Chip label="Cash" tone="gold" small />
        </View>
        <View style={styles.gridCell}>
          <Chip label="Account" tone="navy" small />
        </View>
      </View>
      {rows.map((r) => (
        <View key={r.key} style={[styles.gridRow, styles.gridBody]}>
          <View style={styles.gridLabel}>
            <T variant="small" color={colors.inkMuted}>
              {r.label}
            </T>
          </View>
          <View style={styles.gridCell}>{cell(r.key, money.cash[r.key])}</View>
          <View style={styles.gridCell}>{cell(r.key, money.account[r.key])}</View>
        </View>
      ))}
      <View style={[styles.gridRow, styles.gridTotal]}>
        <View style={styles.gridLabel}>
          <T variant="bodyStrong">Total due</T>
        </View>
        <View style={[styles.gridCell, { flex: 2, alignItems: "flex-end" }]}>
          <DueMoney paise={money.total_due_paise} variant="h3" />
        </View>
      </View>
      <View style={styles.agreedRow}>
        <T variant="caption" color={colors.inkSubtle}>
          Agreed: Cash {formatINR(money.cash.agreed_paise)} · Account {formatINR(money.account.agreed_paise)}
        </T>
      </View>
    </View>
  );
}

function QuickAction({ icon, label, hint, onPress, loading }: { icon: IconName; label: string; hint: string; onPress: () => void; loading?: boolean }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" disabled={loading} onPress={() => { haptics.tap(); onPress(); }} style={({ pressed }) => [styles.quick, shadow.card, pressed ? { opacity: 0.85 } : null, loading ? { opacity: 0.6 } : null]}>
      <View style={styles.quickIcon}>
        <Icon name={icon} size={20} color={colors.navy} />
      </View>
      <T variant="bodyStrong" numberOfLines={1}>
        {label}
      </T>
      <T variant="caption" color={colors.inkSubtle} numberOfLines={1}>
        {loading ? "Preparing…" : hint}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { paddingBottom: space.xl, alignItems: "center" },
  heroInner: { width: "100%" },
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  heroActions: { flexDirection: "row", alignItems: "center", gap: space.sm },
  flatCard: { marginTop: -space.xs },
  flatImageWrap: { height: 220, backgroundColor: colors.navy700, justifyContent: "flex-end" },
  flatText: { padding: space.lg, gap: 4 },
  chipRow: { flexDirection: "row", gap: space.xs, flexWrap: "wrap", marginBottom: 4 },
  ringRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  nextInst: { flexDirection: "row", alignItems: "center", gap: space.md },
  grid: { gap: 0 },
  gridRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  gridBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  gridLabel: { width: 76 },
  gridCell: { flex: 1, alignItems: "flex-start" },
  gridTotal: { borderTopWidth: 1, borderTopColor: colors.lineStrong, marginTop: 4, paddingTop: 12 },
  agreedRow: { paddingTop: 6 },
  otherCharges: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  noticeStrip: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.gold50, borderWidth: 1, borderColor: colors.gold200, borderRadius: radius.lg, padding: space.md },
  noticeIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.gold100, alignItems: "center", justifyContent: "center" },
  quickRow: { flexDirection: "row", gap: space.md },
  quick: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, gap: 4, minWidth: 0 },
  quickIcon: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  rmRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  rmActions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
});
