import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { useAuth } from "@/src/auth";
import { useConfig } from "@/src/hooks";
import { ApiError, BACKEND, errMsg } from "@/src/api/client";
import { openUrl } from "@/src/screens/home/widgets";
import { haptic } from "@/src/haptics";
import { makeStyles, radius, useTheme } from "@/src/theme";
import { Button, Card, Press } from "@/src/ui/primitives";
import { Field } from "@/src/ui/field";
import { T } from "@/src/ui/text";
import { toast } from "@/src/ui/toast";
import { ChangePasswordForm } from "@/src/screens/change-password-form";

function Brand({ name, logo, inverse }: { name: string; logo?: string | null; inverse?: boolean }) {
  const s = useStyles();
  return (
    <View style={s.brand} testID="login-brand">
      <Image source={logo ? { uri: logo } : require("@/assets/images/logo-mark.png")} style={[s.logo, inverse && s.logoInverse]} contentFit="cover" />
      <View>
        <T v="h2" tone={inverse ? "inverse" : "default"} testID="login-brand-name">
          {name}
        </T>
        <T v="small" tone={inverse ? "inverseMuted" : "muted"}>
          Customer portal
        </T>
      </View>
    </View>
  );
}

function SiteLinks({ erpUrl }: { erpUrl?: string | null }) {
  const s = useStyles();
  const { colors } = useTheme();
  const site = BACKEND.replace(/\/+$/, "") + "/";
  return (
    <View style={s.links} testID="login-links">
      {erpUrl ? (
        <Press onPress={() => openUrl(erpUrl)} style={s.link} testID="login-erp-link" accessibilityLabel="Staff? Go to ERP">
          <Feather name="briefcase" size={14} color={colors.muted} />
          <T v="small" tone="muted" style={s.linkText}>Staff? Go to ERP</T>
        </Press>
      ) : null}
      <Press onPress={() => openUrl(site)} style={s.link} testID="login-website-link" accessibilityLabel="Visit website">
        <Feather name="globe" size={14} color={colors.muted} />
        <T v="small" tone="muted" style={s.linkText}>Visit website</T>
      </Press>
    </View>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const { colors } = useTheme();
  const s = useStyles();
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; locked?: boolean } | null>(null);
  const digits = phone.replace(/\D/g, "").slice(-10);
  const valid = digits.length === 10 && pw.length > 0;

  const submit = async () => {
    if (!valid) return setErr({ msg: digits.length !== 10 ? "Enter your 10-digit registered mobile number" : "Enter your password" });
    setBusy(true);
    setErr(null);
    try {
      const r = await login(digits, pw);
      haptic.success();
      toast.success(r.must_change_password ? "Please set a new password" : `Welcome, ${r.name}`);
    } catch (e) {
      haptic.error();
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 423) setErr({ locked: true, msg: "Your account is locked for 15 minutes after too many wrong attempts. Try again later or call your Relationship Manager." });
      else if (st === 429) setErr({ msg: "Too many sign-in attempts. Please wait a minute and try again." });
      else setErr({ msg: errMsg(e, "Sign in failed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={s.card} testID="login-form">
      <T v="h1">Sign in</T>
      <T tone="muted" style={{ marginTop: 4, marginBottom: 20 }}>
        Use the mobile number registered with your booking.
      </T>
      <View style={{ gap: 16 }}>
        <Field label="Mobile number" icon="phone" placeholder="10-digit mobile" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" value={phone} onChangeText={setPhone} maxLength={14} testID="login-phone-input" returnKeyType="next" />
        <Field label="Password" icon="lock" placeholder="Your password" secureToggle autoComplete="password" textContentType="password" autoCapitalize="none" value={pw} onChangeText={setPw} testID="login-password-input" returnKeyType="go" onSubmitEditing={submit} />
      </View>
      {err ? (
        <View style={[s.alert, err.locked && s.alertLocked]} testID={err.locked ? "login-locked-message" : "login-error-message"}>
          <Feather name={err.locked ? "lock" : "alert-circle"} size={16} color={colors.error} />
          <T v="small" tone="error" style={{ flex: 1 }}>
            {err.msg}
          </T>
        </View>
      ) : null}
      <Button kind="gold" label={busy ? "Signing in…" : "Sign in"} onPress={submit} loading={busy} testID="login-submit-button" style={{ marginTop: 22 }} />
      <T v="small" tone="secondary" style={{ textAlign: "center", marginTop: 16, alignSelf: "center", maxWidth: 300 }} testID="login-forgot-hint">
        Forgot your password? Call your Relationship Manager to reset it.
      </T>
    </Card>
  );
}

const VALUE_PROPS: [string, string][] = [
  ["credit-card", "Every payment, receipt and due — Cash and Account, always reconciled."],
  ["layers", "Construction progress stage by stage, with site photos."],
  ["message-square", "Raise requests and hear back from your relationship manager."],
];

export default function Login() {
  const s = useStyles();
  const { colors } = useTheme();
  const { status, pendingName, logout } = useAuth();
  const cfg = useConfig();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 1024;
  const forced = status === "pwchange";
  return (
    <View style={s.root} testID="login-screen">
      {wide ? (
        <View style={s.side} testID="login-brand-panel">
          <Image source={require("@/assets/images/login-hero.jpg")} style={s.sideImg} contentFit="cover" cachePolicy="memory-disk" />
          <LinearGradient colors={["rgba(11,31,58,0.55)", "rgba(11,31,58,0.96)"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.sideImg} pointerEvents="none" />
          <View style={s.sideInner}>
            <Brand name={cfg.brand} logo={cfg.logo_url} inverse />
            <View style={{ gap: 22 }}>
              <T style={s.sideTitle}>Your home,{"\n"}always within reach.</T>
              <View style={{ gap: 14 }}>
                {VALUE_PROPS.map(([icon, text]) => (
                  <View key={text} style={s.prop}>
                    <View style={s.propIcon}>
                      <Feather name={icon as any} size={16} color={colors.gold} />
                    </View>
                    <T tone="inverse" style={{ flex: 1, fontSize: 16, lineHeight: 23 }}>
                      {text}
                    </T>
                  </View>
                ))}
              </View>
            </View>
            <T v="small" tone="inverseMuted">
              {cfg.brand} · Customer portal
            </T>
          </View>
        </View>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
          <View style={s.col}>
            {!wide ? (
              <>
                <Brand name={cfg.brand} logo={cfg.logo_url} />
                <T style={s.hero}>Your home,{"\n"}always within reach.</T>
              </>
            ) : null}
            {forced ? (
              <Card style={s.card} testID="force-change-form">
                <T v="h1">Set a new password</T>
                <T tone="muted" style={{ marginTop: 4, marginBottom: 20 }}>
                  Hi {pendingName || "there"}. For your security, please replace the temporary password you were given.
                </T>
                <ChangePasswordForm forced />
                <Button kind="ghost" small label="Use a different account" onPress={() => logout({ silent: true })} testID="force-change-cancel" style={{ marginTop: 12 }} />
              </Card>
            ) : (
              <LoginForm />
            )}
            <SiteLinks erpUrl={cfg.erp_url} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, flexDirection: "row", backgroundColor: c.surface },
  side: { flex: 1, maxWidth: 720, backgroundColor: c.surfaceInverse, overflow: "hidden" },
  sideImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sideInner: { flex: 1, padding: 56, justifyContent: "space-between", gap: 32 },
  sideTitle: { fontFamily: "CormorantGaramond_600SemiBold", fontSize: 56, lineHeight: 60, color: c.onSurfaceInverse },
  prop: { flexDirection: "row", alignItems: "center", gap: 14, maxWidth: 460 },
  propIcon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "rgba(201,162,39,0.6)", alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 20 },
  col: { width: "100%", maxWidth: 420, gap: 24 },
  brand: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 48, height: 48, borderRadius: radius.md },
  logoInverse: { borderWidth: 1, borderColor: c.gold },
  hero: { fontFamily: "CormorantGaramond_600SemiBold", fontSize: 38, lineHeight: 42, color: c.onSurface },
  card: { padding: 24 },
  alert: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: c.errorSoft, padding: 12, borderRadius: radius.sm, marginTop: 16 },
  links: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  link: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 8 },
  linkText: { fontFamily: "Manrope_700Bold", color: c.onSurfaceTertiary, textDecorationLine: "underline" },
  alertLocked: { borderWidth: 1, borderColor: c.error },
}));
