import { useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { useBookingSub } from "@/src/hooks";
import { ApiError, errMsg } from "@/src/api/client";
import { fmtDate, inr } from "@/src/format";
import { makeStyles, radius, useTheme } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Button, Card, KV, SectionTitle } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { SkeletonScreen } from "@/src/ui/skeleton";
import { Empty, ErrorState } from "@/src/ui/states";
import { Lightbox } from "@/src/ui/lightbox";
import { usePdf } from "@/src/screens/shared";

type Room = { room?: string; label?: string; length_ft?: number | null; width_ft?: number | null };

function specRows(spec: Record<string, any>): { cat: string; rows: [string, string][] }[] {
  return Object.entries(spec || {}).map(([cat, v]) => {
    if (Array.isArray(v)) return { cat, rows: v.map((x, i) => (typeof x === "object" && x ? [String(x.name || x.item || x.label || `Item ${i + 1}`), String(x.value ?? x.description ?? x.brand ?? "")] : [String(x), ""])) as [string, string][] };
    if (v && typeof v === "object") return { cat, rows: Object.entries(v).map(([k, x]) => [k, String(x)]) as [string, string][] };
    return { cat: "General", rows: [[cat, String(v)]] as [string, string][] };
  });
}

export default function FlatScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useBookingSub<any>(id, "");
  const pdf = usePdf();
  const [zoom, setZoom] = useState<number | null>(null);
  const b = q.data;

  if (q.isLoading)
    return (
      <Screen testID="flat-screen">
        <PageHeader back title="My Flat" />
        <SkeletonScreen />
      </Screen>
    );
  if (q.isError || !b)
    return (
      <Screen testID="flat-screen">
        <PageHeader back title="My Flat" />
        {q.error instanceof ApiError && q.error.status === 404 ? <Empty icon="home" title="Flat not found" hint="This booking isn't linked to your account." testID="flat-not-found" /> : <ErrorState message={errMsg(q.error)} onRetry={q.refetch} />}
      </Screen>
    );

  const plan = b.flat?.floor_plan_image || b.cover_image;
  const rooms: Room[] = b.flat?.rooms || [];
  const areas: { area: string; sqft: number | null }[] = b.flat?.areas || [];
  const specs = specRows(b.flat?.specifications);
  const revs: { at: string; reason?: string; new_agreement_value_paise?: number }[] = b.agreement_revisions || [];
  const allot = `/bookings/${b.id}/allotment.pdf`;

  return (
    <Screen testID="flat-screen" refreshKeys={[["p-booking", id, ""]]}>
      <PageHeader
        back
        title={`Flat ${b.flat_number}`}
        sub={`${b.project_name} · ${b.block_name} · ${b.booking_number}${b.co_applicant ? " · you are a co-applicant" : ""}`}
        right={<Button small kind="ghost" icon="download" label="Allotment" loading={pdf.busy === allot} onPress={() => pdf.open(allot, `allotment-${b.booking_number}.pdf`)} testID="flat-allotment-pdf" />}
      />
      {plan ? (
        <Pressable onPress={() => setZoom(0)} testID="flat-plan-image" accessibilityRole="imagebutton" accessibilityLabel="Open floor plan">
          <View style={s.planWrap}>
            <Image source={{ uri: plan }} style={s.plan} contentFit="cover" transition={250} />
            <View style={s.planTag}>
              <Feather name="maximize-2" size={13} color={colors.onSurfaceInverse} />
              <T v="small" tone="inverse">
                {b.flat?.floor_plan_image ? "Floor plan · tap to zoom" : "Project image · tap to zoom"}
              </T>
            </View>
          </View>
        </Pressable>
      ) : null}

      <Card testID="flat-unit-details">
        <SectionTitle title="Unit details" />
        <KV k="Type" v={`${b.flat?.type_name || b.flat_type}${b.flat?.bhk ? ` · ${b.flat.bhk} BHK` : ""}`} />
        <KV k="Floor" v={String(b.floor)} />
        <KV k="Super built-up" v={`${b.super_builtup_sqft} sq ft`} />
        <KV k="Facing" v={b.flat?.facing} />
        <KV k="Booking date" v={fmtDate(b.booking_date)} />
        <KV k="Status" v={b.status} testID="flat-status" />
        <KV k="Parking" v={b.parking?.length ? b.parking.map((p: any) => [p.slot_number, p.type, p.level].filter(Boolean).join(" · ")).join(", ") : "Not allotted"} testID="flat-parking" />
        {b.rera_number ? <KV k="RERA" v={b.rera_number} /> : null}
        {b.address ? <KV k="Site address" v={[b.address.line1, b.address.city, b.address.pincode].filter(Boolean).join(", ")} last /> : null}
      </Card>

      {rooms.length || areas.length ? (
        <Card testID="flat-rooms">
          <SectionTitle title="Rooms & areas" />
          {rooms.map((r, i) => {
            const sq = r.length_ft && r.width_ft ? Math.round(r.length_ft * r.width_ft) : null;
            return <KV key={`r${i}`} k={r.label || r.room || `Room ${i + 1}`} v={r.length_ft && r.width_ft ? `${r.length_ft}′ × ${r.width_ft}′ · ${sq} sq ft` : "—"} />;
          })}
          {areas.map((a, i) => (
            <KV key={`a${i}`} k={a.area} v={a.sqft ? `${a.sqft} sq ft` : "—"} last={i === areas.length - 1} />
          ))}
        </Card>
      ) : null}

      <Card testID="flat-specifications">
        <SectionTitle title="Specifications" />
        {specs.length ? (
          specs.map((g) => (
            <View key={g.cat} style={{ marginTop: 6 }}>
              <T v="label" tone="gold">
                {g.cat}
              </T>
              {g.rows.map(([k, v], i) => (
                <KV key={k + i} k={k} v={v || "—"} />
              ))}
            </View>
          ))
        ) : (
          <T tone="muted" style={{ marginTop: 4 }}>
            Detailed specifications will be shared by your Relationship Manager.
          </T>
        )}
      </Card>

      <Card testID="flat-price-breakup">
        <SectionTitle title="Price breakup" />
        <KV k="Agreement value" v={inr(b.price_breakup?.agreement_value)} testID="flat-agreement-value" />
        <KV k="Cash component" v={inr(b.price_breakup?.cash)} />
        <KV k="Account component" v={inr(b.price_breakup?.account)} />
        {(b.price_breakup?.other_charges || []).map((c: any) => (
          <KV key={c.name} k={`${c.name}${c.gst ? " (incl. GST)" : ""}`} v={`${inr(c.total)}${c.paid ? ` · paid ${inr(c.paid)}` : ""}`} />
        ))}
      </Card>

      <Card testID="flat-agreement-revisions">
        <SectionTitle title="Agreement & revisions" />
        {revs.length ? (
          <>
            <T tone="muted">Revised {revs.length}× since booking.</T>
            {revs.map((r, i) => (
              <KV key={i} k={`${fmtDate(r.at)}${r.reason ? ` · ${r.reason}` : ""}`} v={r.new_agreement_value_paise != null ? inr(r.new_agreement_value_paise / 100) : "—"} last={i === revs.length - 1} />
            ))}
          </>
        ) : (
          <T tone="muted" testID="flat-no-revisions">
            Your agreement has not been revised since booking on {fmtDate(b.booking_date)}.
          </T>
        )}
      </Card>

      {b.relationship_manager ? (
        <T v="small" tone="muted" style={{ textAlign: "center" }}>
          Relationship Manager: {b.relationship_manager.name}
          {b.relationship_manager.phone ? ` · ${b.relationship_manager.phone}` : ""}
        </T>
      ) : null}
      {plan ? <Lightbox photos={[{ uri: plan, caption: b.flat?.floor_plan_image ? "Floor plan" : b.project_name, sub: `Flat ${b.flat_number}` }]} index={zoom} onClose={() => setZoom(null)} /> : null}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  planWrap: { borderRadius: radius.lg, overflow: "hidden", backgroundColor: c.skeleton },
  plan: { width: "100%", height: 230 },
  planTag: { position: "absolute", left: 12, bottom: 12, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(11,31,58,0.75)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
}));
