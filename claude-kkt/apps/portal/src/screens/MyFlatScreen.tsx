import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { PortalMyFlatResponse } from "@kkt/contracts";
import { refreshBooking, useFlat } from "@/api/queries";
import { formatDateTime, formatFloor, formatINR, formatSqft } from "@/lib/format";
import { Card, CardHeader, Divider, KeyValue } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { Lightbox } from "@/ui/Lightbox";
import { Money } from "@/ui/Money";
import { useLayout } from "@/ui/Responsive";
import { useDocumentTitle, Col, Columns, Screen } from "@/ui/Screen";
import { SkeletonCard } from "@/ui/Skeleton";
import { EmptyState, ErrorState, StatusBar } from "@/ui/States";
import { Table } from "@/ui/Table";
import { T } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { BookingGate, TabHeader } from "./shared";

export function MyFlatScreen(): React.JSX.Element {
  useDocumentTitle("My Flat");
  return <BookingGate title="My Flat">{(id) => <Body bookingId={id} />}</BookingGate>;
}

function Body({ bookingId }: { bookingId: string }): React.JSX.Element {
  const q = useFlat(bookingId);
  const d = q.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <TabHeader title="My Flat" subtitle={d ? `${d.flat_number} · ${d.block_name} · ${d.project_name}` : undefined} />
      {q.isError && d ? <StatusBar text="Showing saved details — couldn't refresh." tone="warning" /> : null}
      <Screen onRefresh={() => refreshBooking(bookingId)}>
        {d ? (
          <FlatContent d={d} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <SkeletonCard lines={4} />
            <SkeletonCard lines={6} />
          </>
        )}
      </Screen>
    </View>
  );
}

function FlatContent({ d }: { d: PortalMyFlatResponse }): React.JSX.Element {
  const [plan, setPlan] = useState<number | null>(null);
  const { isPhone } = useLayout();
  const totalRooms = d.rooms.reduce((s, r) => s + r.sqft, 0);
  return (
    <>
      <Card padded={false}>
        <Pressable
          accessibilityRole={d.floor_plan_url ? "button" : undefined}
          accessibilityLabel="Floor plan — tap to zoom"
          disabled={!d.floor_plan_url}
          onPress={() => setPlan(0)}
          style={styles.planWrap}
        >
          {d.floor_plan_url ? (
            <Image
              source={{ uri: d.floor_plan_url }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              transition={300}
              accessibilityLabel="Floor plan"
            />
          ) : (
            <View style={styles.planEmpty}>
              <Icon name="image" size={28} color={colors.inkSubtle} />
              <T variant="small" color={colors.inkMuted}>
                Floor plan will appear here once shared
              </T>
            </View>
          )}
          {d.floor_plan_url ? (
            <View style={styles.zoomHint}>
              <Icon name="zoom-in" size={14} color={colors.onNavy} />
              <T variant="caption" color={colors.onNavy}>
                Tap to zoom
              </T>
            </View>
          ) : null}
        </Pressable>
        <View style={{ padding: space.lg, gap: 6 }}>
          <View style={styles.chipRow}>
            <Chip label={`${d.bhk} BHK`} tone="gold" small />
            {d.facing ? <Chip label={`${d.facing} facing`} tone="neutral" small /> : null}
            <Chip label={formatFloor(d.floor_label)} tone="neutral" small />
          </View>
          <T variant="h2">
            {d.flat_number} · {d.flat_type_name}
          </T>
          <T variant="small" color={colors.inkMuted}>
            {d.block_name}, {d.project_name}
          </T>
        </View>
      </Card>

      <Columns>
        <Col>
          <Card>
            <CardHeader
              eyebrow="Rooms"
              title="Rooms & sizes"
              subtitle={`${d.rooms.length} rooms · ${formatSqft(totalRooms)}`}
            />
            {isPhone ? (
              d.rooms.map((r, i) => (
                <View key={`${r.label}-${i}`}>
                  <View style={styles.roomRow}>
                    <View style={{ flex: 1 }}>
                      <T variant="bodyStrong">{r.label}</T>
                      <T variant="caption" color={colors.inkSubtle}>
                        {r.room_type}
                      </T>
                    </View>
                    <T variant="small" color={colors.inkMuted}>
                      {r.length_ft} × {r.width_ft} ft
                    </T>
                    <T variant="money" style={{ minWidth: 86, textAlign: "right" }}>
                      {formatSqft(r.sqft)}
                    </T>
                  </View>
                  {i < d.rooms.length - 1 ? <Divider /> : null}
                </View>
              ))
            ) : (
              <Table
                minWidth={420}
                rows={d.rooms}
                keyOf={(r, i) => `${r.label}-${i}`}
                columns={[
                  { key: "label", title: "Room", flex: 1.4, render: (r) => <T variant="bodyStrong">{r.label}</T> },
                  {
                    key: "type",
                    title: "Type",
                    render: (r) => (
                      <T variant="small" color={colors.inkMuted}>
                        {r.room_type}
                      </T>
                    ),
                  },
                  {
                    key: "size",
                    title: "Size (ft)",
                    align: "right",
                    render: (r) => (
                      <T variant="small">
                        {r.length_ft} × {r.width_ft}
                      </T>
                    ),
                  },
                  {
                    key: "sqft",
                    title: "Area",
                    align: "right",
                    render: (r) => <T variant="money">{formatSqft(r.sqft)}</T>,
                  },
                ]}
              />
            )}
          </Card>
          <Card>
            <CardHeader eyebrow="Areas" title="Area statement" />
            {d.areas.map((a, i) => (
              <KeyValue key={`${a.code}-${i}`} label={a.name} value={formatSqft(a.sqft)} right />
            ))}
            {d.areas.length === 0 ? (
              <T variant="small" color={colors.inkMuted}>
                Area details will appear once finalised.
              </T>
            ) : null}
          </Card>
          <Card>
            <CardHeader
              eyebrow="Parking"
              title={
                d.parking.length ? `${d.parking.length} slot${d.parking.length > 1 ? "s" : ""} allotted` : "Parking"
              }
            />
            {d.parking.length ? (
              d.parking.map((p, i) => (
                <KeyValue
                  key={`${p.number}-${i}`}
                  label={p.number}
                  value={`${p.slot_type}${p.level ? ` · ${p.level}` : ""}`}
                  right
                />
              ))
            ) : (
              <T variant="small" color={colors.inkMuted}>
                No parking allotted to this booking.
              </T>
            )}
          </Card>
        </Col>
        <Col>
          <Card>
            <CardHeader eyebrow="Price" title="Price breakup" />
            {d.price_breakup.map((l, i) => (
              <View key={`${l.label}-${i}`} style={styles.priceRow}>
                <T variant="small" color={colors.inkMuted} style={{ flex: 1 }}>
                  {l.label}
                </T>
                <Money paise={l.amount_paise} color={l.amount_paise < 0 ? colors.success : colors.ink} />
              </View>
            ))}
            <Divider style={{ marginVertical: space.sm }} />
            <View style={styles.priceRow}>
              <T variant="bodyStrong" style={{ flex: 1 }}>
                Agreement value
              </T>
              <Money paise={d.agreement.agreement_value_paise} variant="h3" color={colors.navy} />
            </View>
            <View style={styles.chipRow}>
              <Chip label={`Cash ${formatINR(d.agreement.cash_agreed_paise)}`} tone="gold" small />
              <Chip label={`Account ${formatINR(d.agreement.account_agreed_paise)}`} tone="navy" small />
            </View>
          </Card>
          <Card>
            <CardHeader
              eyebrow="Agreement"
              title="Revisions"
              subtitle={
                d.agreement.revisions.length
                  ? `${d.agreement.revisions.length} audited change${d.agreement.revisions.length > 1 ? "s" : ""}`
                  : "No changes since booking"
              }
            />
            {d.agreement.revisions.map((r, i) => (
              <View key={`${r.revised_at}-${i}`} style={styles.revision}>
                <T variant="caption" color={colors.inkSubtle}>
                  {formatDateTime(r.revised_at)}
                </T>
                <T variant="bodyStrong">{r.reason}</T>
                <T variant="small" color={colors.inkMuted}>
                  Value {formatINR(r.before_value_paise)} → {formatINR(r.after_value_paise)}
                </T>
                <T variant="small" color={colors.inkMuted}>
                  Cash {formatINR(r.before_cash_paise)} → {formatINR(r.after_cash_paise)} · Account{" "}
                  {formatINR(r.before_account_paise)} → {formatINR(r.after_account_paise)}
                </T>
              </View>
            ))}
          </Card>
          <Card>
            <CardHeader eyebrow="Finish" title="Specifications" />
            {d.specifications.length === 0 ? (
              <EmptyState icon="document" title="Specifications coming soon" style={{ paddingVertical: space.lg }} />
            ) : null}
            {d.specifications.map((s, i) => (
              <View key={`${s.category}-${i}`} style={{ gap: 4, marginBottom: space.md }}>
                <T variant="label" color={colors.goldText}>
                  {s.category}
                </T>
                {s.items.map((it, j) => (
                  <View key={j} style={styles.specRow}>
                    <Icon name="dot" size={12} color={colors.gold} />
                    <T variant="small" style={{ flex: 1 }}>
                      {it}
                    </T>
                  </View>
                ))}
              </View>
            ))}
          </Card>
        </Col>
      </Columns>
      {d.floor_plan_url ? (
        <Lightbox
          images={[{ uri: d.floor_plan_url, caption: `Floor plan · ${d.flat_number}` }]}
          index={plan}
          onClose={() => setPlan(null)}
          onIndexChange={setPlan}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  planWrap: { height: 240, backgroundColor: colors.surfaceMuted },
  planEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  zoomHint: {
    position: "absolute",
    right: space.md,
    bottom: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(11,31,58,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.sm },
  roomRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 10 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 6 },
  revision: {
    gap: 2,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  specRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingLeft: 2 },
});
