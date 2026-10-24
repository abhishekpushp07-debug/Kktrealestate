import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { KYC_STATUS_LABELS, PortalProfileUpdateSchema, type PortalProfileResponse } from "@kkt/contracts";
import { errorMessage } from "@/api/client";
import { queryClient, useProfile, useUpdateProfile } from "@/api/queries";
import { useAuth } from "@/auth/AuthProvider";
import { formatDateTime } from "@/lib/format";
import { openTel, openWhatsApp } from "@/lib/links";
import { Button } from "@/ui/Button";
import { Card, CardHeader, Divider, KeyValue } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Avatar } from "@/ui/ListRow";
import { Col, Columns, Header, Screen } from "@/ui/Screen";
import { SkeletonCard } from "@/ui/Skeleton";
import { ErrorState, Notice } from "@/ui/States";
import { T } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { colors, space } from "@/ui/theme";

export function ProfileScreen(): React.JSX.Element {
  const q = useProfile();
  const router = useRouter();
  const d = q.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Profile" subtitle={d ? `${d.customer_code} · last sign-in ${formatDateTime(d.last_login_at)}` : undefined} back right={<Button title="Password" icon="lock" variant="outline" size="sm" onPress={() => router.navigate("/more/password")} />} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Screen onRefresh={() => queryClient.invalidateQueries({ queryKey: ["profile"] })}>
          {d ? <ProfileBody d={d} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <><SkeletonCard lines={3} /><SkeletonCard lines={5} /></>}
        </Screen>
      </KeyboardAvoidingView>
    </View>
  );
}

function ProfileBody({ d }: { d: PortalProfileResponse }): React.JSX.Element {
  const toast = useToast();
  const update = useUpdateProfile();
  const { refreshUser } = useAuth();
  const [altPhone, setAltPhone] = useState(d.alt_phone ?? "");
  const [email, setEmail] = useState(d.email ?? "");
  const [addr, setAddr] = useState({ line1: d.address_current?.line1 ?? "", line2: d.address_current?.line2 ?? "", locality: d.address_current?.locality ?? "", city: d.address_current?.city ?? "", state: d.address_current?.state ?? "", pincode: d.address_current?.pincode ?? "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setAltPhone(d.alt_phone ?? "");
    setEmail(d.email ?? "");
  }, [d.alt_phone, d.email]);

  const dirty = altPhone !== (d.alt_phone ?? "") || email !== (d.email ?? "") || addr.line1 !== (d.address_current?.line1 ?? "") || addr.line2 !== (d.address_current?.line2 ?? "") || addr.locality !== (d.address_current?.locality ?? "") || addr.city !== (d.address_current?.city ?? "") || addr.state !== (d.address_current?.state ?? "") || addr.pincode !== (d.address_current?.pincode ?? "");

  const save = async () => {
    setError(null);
    const anyAddress = addr.line1 || addr.city || addr.state || addr.pincode;
    const payload = {
      alt_phone: altPhone.trim() ? altPhone.trim() : null,
      email: email.trim() ? email.trim() : null,
      address_current: anyAddress ? { line1: addr.line1.trim(), line2: addr.line2.trim() || null, locality: addr.locality.trim() || null, city: addr.city.trim(), state: addr.state.trim(), pincode: addr.pincode.trim() } : null,
    };
    const parsed = PortalProfileUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.map(String).join(".") ?? "";
      setError(path.startsWith("address") ? `Address: ${issue?.message ?? "check the details"} (${path.replace("address_current.", "")})` : `${path || "Details"}: ${issue?.message ?? "invalid"}`);
      return;
    }
    try {
      await update.mutateAsync(parsed.data);
      await refreshUser();
      toast.success("Profile updated");
    } catch (e) {
      setError(errorMessage(e, "Could not save your changes."));
    }
  };

  return (
    <>
      <Card>
        <View style={styles.head}>
          <Avatar name={d.full_name} size={56} />
          <View style={{ flex: 1, gap: 4 }}>
            <T variant="h2">{d.full_name}</T>
            <T variant="small" color={colors.inkMuted}>
              {d.phone} · {d.customer_code}
            </T>
            <Chip label={`KYC ${KYC_STATUS_LABELS[d.kyc_status]}`} tone={d.kyc_status === "VERIFIED" ? "success" : d.kyc_status === "REJECTED" ? "danger" : "warning"} small />
          </View>
        </View>
        <Divider style={{ marginVertical: space.md }} />
        <KeyValue label="PAN" value={d.pan_masked ?? "Not on file"} mono right />
        <KeyValue label="Aadhaar" value={d.aadhaar_masked ?? "Not on file"} mono right />
        <T variant="caption" color={colors.inkSubtle}>
          Identity details are masked for your privacy. To update them, raise a request.
        </T>
      </Card>

      <Columns>
        <Col>
          <Card style={{ gap: space.md }}>
            <CardHeader eyebrow="Contact" title="Contact details" subtitle="Changes are recorded on your account" />
            {error ? <Notice tone="danger" body={error} /> : null}
            <Field label="Alternate phone" icon="phone" value={altPhone} onChangeText={setAltPhone} keyboardType="phone-pad" placeholder="Optional" />
            <Field label="Email" icon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="Optional" />
            <T variant="label" color={colors.inkSubtle} style={{ marginTop: space.xs }}>
              Current address
            </T>
            <Field label="Line 1" value={addr.line1} onChangeText={(v) => setAddr((a) => ({ ...a, line1: v }))} placeholder="House / flat, street" />
            <Field label="Line 2" value={addr.line2} onChangeText={(v) => setAddr((a) => ({ ...a, line2: v }))} placeholder="Optional" />
            <Field label="Locality" value={addr.locality} onChangeText={(v) => setAddr((a) => ({ ...a, locality: v }))} placeholder="Optional" />
            <View style={styles.twoCol}>
              <Field label="City" value={addr.city} onChangeText={(v) => setAddr((a) => ({ ...a, city: v }))} containerStyle={{ flex: 1 }} />
              <Field label="State" value={addr.state} onChangeText={(v) => setAddr((a) => ({ ...a, state: v }))} containerStyle={{ flex: 1 }} />
            </View>
            <Field label="PIN code" value={addr.pincode} onChangeText={(v) => setAddr((a) => ({ ...a, pincode: v.replace(/\D/g, "").slice(0, 6) }))} keyboardType="number-pad" maxLength={6} containerStyle={{ maxWidth: 200 }} />
            <Button title="Save changes" variant="gold" loading={update.isPending} disabled={!dirty} onPress={() => void save()} />
          </Card>
        </Col>
        <Col>
          <Card>
            <CardHeader eyebrow="Booking" title="Co-applicants" subtitle={d.co_applicants.length ? `${d.co_applicants.length} on your bookings` : "None added"} />
            {d.co_applicants.map((c, i) => (
              <View key={`${c.full_name}-${i}`} style={styles.co}>
                <Avatar name={c.full_name} size={36} />
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">{c.full_name}</T>
                  <T variant="caption" color={colors.inkMuted}>
                    {c.relation}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </T>
                </View>
              </View>
            ))}
          </Card>
          {d.relationship_manager ? (
            <Card>
              <CardHeader eyebrow="Your RM" title={d.relationship_manager.name} subtitle={d.relationship_manager.email ?? undefined} />
              <View style={styles.rmActions}>
                {d.relationship_manager.phone ? <Button title="Call" icon="phone" size="sm" onPress={() => void openTel(d.relationship_manager?.phone ?? "")} /> : null}
                {d.relationship_manager.whatsapp ?? d.relationship_manager.phone ? <Button title="WhatsApp" icon="chat" size="sm" variant="outline" onPress={() => void openWhatsApp(d.relationship_manager?.whatsapp ?? d.relationship_manager?.phone ?? "")} /> : null}
              </View>
            </Card>
          ) : null}
        </Col>
      </Columns>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  twoCol: { flexDirection: "row", gap: space.md },
  co: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8 },
  rmActions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
});
