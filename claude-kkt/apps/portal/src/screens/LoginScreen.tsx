import { LinearGradient } from "expo-linear-gradient";
import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ERP_URL } from "@/api/client";
import { useAuth, type LoginFailure } from "@/auth/AuthProvider";
import { formatDateTime } from "@/lib/format";
import { openExternal } from "@/lib/links";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { useLayout } from "@/ui/Responsive";
import { Notice } from "@/ui/States";
import { T } from "@/ui/Text";
import { colors, radius, shadow, space } from "@/ui/theme";

function failureCopy(f: LoginFailure): { title: string; body: string; tone: "danger" | "warning" } {
  if (f.code === "LOCKED") {
    return { title: "Account temporarily locked", body: f.lockedUntil ? `Too many failed attempts. Try again after ${formatDateTime(f.lockedUntil)}.` : f.message, tone: "warning" };
  }
  if (f.code === "RATE_LIMITED") {
    return { title: "Slow down a moment", body: f.retryAfterSeconds ? `Too many attempts from this device. Try again in ${f.retryAfterSeconds} seconds.` : f.message, tone: "warning" };
  }
  if (f.code === "NETWORK") return { title: "You're offline", body: f.message, tone: "warning" };
  return { title: f.code === "INVALID_CREDENTIALS" ? "Sign-in failed" : "Check your details", body: f.message, tone: "danger" };
}

export function LoginScreen(): React.JSX.Element {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const res = await login(phone, password);
    setBusy(false);
    if (!res.ok) setFailure(res.failure);
  };

  const wide = layout.width >= 900;
  const form = (
    <View style={[styles.card, shadow.raised, wide ? styles.cardWide : null]}>
      <View style={{ gap: 4 }}>
        <T variant="h2">Sign in</T>
        <T variant="small" color={colors.inkMuted}>
          Use the mobile number registered with your booking.
        </T>
      </View>
      {failure ? <Notice tone={failureCopy(failure).tone} title={failureCopy(failure).title} body={failureCopy(failure).body} /> : null}
      <Field
        label="Mobile number"
        icon="phone"
        value={phone}
        onChangeText={(v) => setPhone(v.replace(/[^\d+\s-]/g, ""))}
        placeholder="98765 43210"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoCapitalize="none"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        hint="10 digits, with or without +91"
      />
      <Field
        ref={passwordRef}
        label="Password"
        icon="lock"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry
        secureToggle
        textContentType="password"
        autoComplete="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      <Button title="Sign in" variant="gold" size="lg" block loading={busy} onPress={() => void submit()} />
      <T variant="caption" color={colors.inkSubtle} align="center">
        First time here? Use the temporary password our team shared with you — you'll set your own next.
      </T>
      <View style={styles.erpRow}>
        <T variant="small" color={colors.inkMuted}>
          Staff?
        </T>
        <Pressable accessibilityRole="link" onPress={() => void openExternal(ERP_URL || "http://localhost:5173")} hitSlop={12} style={styles.erpLink}>
          <T variant="bodyStrong" color={colors.navy}>
            Go to ERP
          </T>
          <Icon name="external" size={14} color={colors.navy} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <LinearGradient colors={[colors.navy, colors.navy800, "#071528"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.xxxl, paddingBottom: insets.bottom + space.xxl, paddingHorizontal: layout.gutter }]} keyboardShouldPersistTaps="handled">
          <View style={[styles.inner, wide ? styles.innerWide : null]}>
            <View style={[styles.hero, wide ? styles.heroWide : null]}>
              <View style={styles.markRow}>
                <View style={styles.mark}>
                  <Icon name="diamond" size={22} color={colors.gold} />
                </View>
                <T variant="label" color={colors.gold}>
                  KKT · Customer Portal
                </T>
              </View>
              <T variant="display" color={colors.onNavy} style={wide ? { fontSize: 46, lineHeight: 52 } : null}>
                Welcome home.
              </T>
              <T variant="body" color={colors.onNavyMuted} style={{ maxWidth: 420 }}>
                Your flat, payments, receipts, construction updates and documents — all in one place.
              </T>
              {wide ? (
                <View style={styles.bullets}>
                  {["Track every installment, cash and account", "Download receipts and demand letters", "Watch your tower rise, stage by stage"].map((b) => (
                    <View key={b} style={styles.bullet}>
                      <Icon name="check" size={14} color={colors.gold} />
                      <T variant="small" color={colors.onNavyMuted}>
                        {b}
                      </T>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
            {form}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
  inner: { width: "100%", maxWidth: 440, gap: space.xxl },
  innerWide: { maxWidth: 1040, flexDirection: "row", alignItems: "center", gap: space.xxxl * 2 },
  hero: { gap: space.md },
  heroWide: { flex: 1.1 },
  markRow: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.sm },
  mark: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: "rgba(201,162,39,0.14)", borderWidth: 1, borderColor: "rgba(201,162,39,0.5)", alignItems: "center", justifyContent: "center" },
  bullets: { gap: space.sm, marginTop: space.md },
  bullet: { flexDirection: "row", alignItems: "center", gap: space.sm },
  card: { backgroundColor: colors.ivory, borderRadius: radius.xl, padding: space.xxl, gap: space.lg, width: "100%" },
  cardWide: { flex: 1, maxWidth: 440 },
  erpRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
  erpLink: { flexDirection: "row", alignItems: "center", gap: 4 },
});
