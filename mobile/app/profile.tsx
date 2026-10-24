import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { useAuth } from "@/src/auth";
import { api, errMsg } from "@/src/api/client";
import { fmtDateTime } from "@/src/format";
import { haptic } from "@/src/haptics";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Button, Card, KV, SectionTitle } from "@/src/ui/primitives";
import { Field } from "@/src/ui/field";
import { T } from "@/src/ui/text";
import { SkeletonScreen } from "@/src/ui/skeleton";
import { toast } from "@/src/ui/toast";
import { confirm } from "@/src/ui/confirm";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function Profile() {
  const { me, refreshMe, logout } = useAuth();
  const c = me?.customer;
  const [f, setF] = useState(() => ({ email: c?.email || "", alt_phone: c?.alt_phone || "", line1: c?.address_current?.line1 || "", city: c?.address_current?.city || "", state: c?.address_current?.state || "", pincode: c?.address_current?.pincode || "" }));
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (f.email && !EMAIL.test(f.email.trim())) e.email = "Enter a valid email address";
    const alt = f.alt_phone.replace(/\D/g, "");
    if (f.alt_phone && alt.length !== 10 && !(alt.length === 12 && alt.startsWith("91"))) e.alt_phone = "Enter a 10-digit mobile number";
    if (f.pincode && !/^\d{6}$/.test(f.pincode.trim())) e.pincode = "PIN code must be 6 digits";
    setErr(e);
    if (Object.keys(e).length) return haptic.error();
    setBusy(true);
    try {
      await api.patch("/me", { email: f.email.trim() || null, alt_phone: f.alt_phone.trim() || null, address_current: { line1: f.line1.trim(), city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim() } });
      await refreshMe();
      haptic.success();
      toast.success("Contact details updated");
    } catch (x) {
      haptic.error();
      toast.error(errMsg(x));
    } finally {
      setBusy(false);
    }
  };

  const logoutAll = async () => {
    if (await confirm("Sign out everywhere?", "You'll be signed out on every phone and browser, including this one.", "Sign out all", true)) logout({ everywhere: true });
  };

  if (!c)
    return (
      <Screen testID="profile-screen">
        <PageHeader back title="Profile" />
        <SkeletonScreen />
      </Screen>
    );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Screen testID="profile-screen">
        <PageHeader back title="Profile" sub={`${c.customer_code} · last sign-in ${fmtDateTime(me?.last_login_at)}`} />
        <Card testID="profile-identity">
          <SectionTitle title="Identity" />
          <KV k="Name" v={`${c.salutation ? `${c.salutation} ` : ""}${c.full_name}`} testID="profile-name" />
          <KV k="Registered mobile" v={c.phone} />
          <KV k="KYC status" v={c.kyc_status} />
          <KV k="PAN" v={c.pan_masked} />
          <KV k="Aadhaar" v={c.aadhaar_masked} last />
          <T v="small" tone="muted" style={{ marginTop: 8 }}>
            To change your name or registered mobile, contact your Relationship Manager.
          </T>
        </Card>

        <Card testID="profile-coapplicants">
          <SectionTitle title="Co-applicants" />
          {me?.co_applicants?.length ? (
            me.co_applicants.map((x, i) => <KV key={i} k={x.full_name} v={x.phone || "—"} last={i === me.co_applicants.length - 1} />)
          ) : (
            <T tone="muted">No co-applicants on your bookings.</T>
          )}
        </Card>

        <Card testID="profile-edit-form" style={{ gap: 14 }}>
          <SectionTitle title="Contact details" />
          <Field label="Email" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={f.email} onChangeText={set("email")} error={err.email} testID="profile-email-input" />
          <Field label="Alternate phone" keyboardType="phone-pad" value={f.alt_phone} onChangeText={set("alt_phone")} error={err.alt_phone} maxLength={14} testID="profile-alt-phone-input" />
          <Field label="Address" placeholder="House / street / locality" value={f.line1} onChangeText={set("line1")} testID="profile-address-input" />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Field label="City" value={f.city} onChangeText={set("city")} testID="profile-city-input" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="State" value={f.state} onChangeText={set("state")} testID="profile-state-input" />
            </View>
          </View>
          <Field label="PIN code" keyboardType="number-pad" maxLength={6} value={f.pincode} onChangeText={set("pincode")} error={err.pincode} testID="profile-pincode-input" />
          <Button label={busy ? "Saving…" : "Save changes"} loading={busy} onPress={save} testID="profile-save-button" />
        </Card>

        <Card testID="profile-sessions" style={{ gap: 10 }}>
          <SectionTitle title="Sessions" />
          <T tone="muted">Sign out from this device, or everywhere if you suspect misuse.</T>
          <Button kind="ghost" icon="log-out" label="Sign out" onPress={() => logout()} testID="profile-logout" />
          <Button kind="danger" icon="shield-off" label="Sign out on all devices" onPress={logoutAll} testID="profile-logout-all" />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
