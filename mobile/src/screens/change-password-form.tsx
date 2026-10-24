// Shared change-password form: forced (first login with temp token) or from profile.
import { useState } from "react";
import { View } from "react-native";

import { useAuth } from "@/src/auth";
import { errMsg } from "@/src/api/client";
import { haptic } from "@/src/haptics";
import { Button } from "@/src/ui/primitives";
import { Field } from "@/src/ui/field";
import { toast } from "@/src/ui/toast";

const policy = (p: string) => p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);

export function ChangePasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { changePassword } = useAuth();
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ cur?: string; n1?: string; n2?: string }>({});

  const submit = async () => {
    const e: typeof err = {};
    if (!cur) e.cur = forced ? "Enter the temporary password" : "Enter your current password";
    if (!policy(n1)) e.n1 = "Use 8+ characters with upper, lower, number and symbol";
    if (n1 !== n2) e.n2 = "Passwords do not match";
    if (cur && n1 && cur === n1) e.n1 = "New password must differ from the current one";
    setErr(e);
    if (Object.keys(e).length) return haptic.error();
    setBusy(true);
    try {
      await changePassword(cur, n1);
      haptic.success();
      toast.success(forced ? "Password set — welcome!" : "Password changed. Other devices were signed out.");
      setCur("");
      setN1("");
      setN2("");
      onDone?.();
    } catch (x) {
      haptic.error();
      const m = errMsg(x);
      if (/current/i.test(m)) setErr({ cur: m });
      else toast.error(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 14 }} testID="change-password-form">
      <Field label={forced ? "Temporary password" : "Current password"} secureToggle autoCapitalize="none" value={cur} onChangeText={setCur} error={err.cur} testID="pw-current-input" />
      <Field label="New password" secureToggle autoCapitalize="none" value={n1} onChangeText={setN1} error={err.n1} hint="At least 8 characters with upper, lower, number and symbol." testID="pw-new-input" />
      <Field label="Confirm new password" secureToggle autoCapitalize="none" value={n2} onChangeText={setN2} error={err.n2} testID="pw-confirm-input" onSubmitEditing={submit} />
      <Button kind={forced ? "gold" : "primary"} label={busy ? "Saving…" : forced ? "Save & continue" : "Update password"} loading={busy} onPress={submit} testID="pw-submit-button" style={{ marginTop: 6 }} />
    </View>
  );
}
