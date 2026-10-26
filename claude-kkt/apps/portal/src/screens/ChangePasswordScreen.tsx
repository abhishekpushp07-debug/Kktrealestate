import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { PasswordSchema } from "@kkt/contracts";
import { ApiError } from "@/api/client";
import { useChangePassword } from "@/api/queries";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { Header, Screen } from "@/ui/Screen";
import { Notice } from "@/ui/States";
import { T } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { colors, space } from "@/ui/theme";

const RULES: ReadonlyArray<{ label: string; test: (p: string) => boolean }> = [
  { label: "At least 10 characters", test: (p) => p.length >= 10 },
  { label: "An upper-case letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lower-case letter", test: (p) => /[a-z]/.test(p) },
  { label: "A digit", test: (p) => /[0-9]/.test(p) },
];

export function ChangePasswordScreen({ forced }: { forced: boolean }): React.JSX.Element {
  const { markPasswordChanged, logout, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const mutation = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const policy = PasswordSchema.safeParse(next);
    if (!policy.success) return setError(policy.error.issues[0]?.message ?? "Choose a stronger password.");
    if (next !== confirm) return setError("The two new passwords don't match.");
    if (next === current) return setError("Your new password must be different from the current one.");
    try {
      await mutation.mutateAsync({ current_password: current, new_password: next });
      markPasswordChanged();
      toast.success("Password updated");
      if (!forced) router.back();
    } catch (e) {
      if (e instanceof ApiError && e.code === "INVALID_CREDENTIALS") setError("Your current password is incorrect.");
      else if (e instanceof ApiError && e.code === "PASSWORD_POLICY") setError(e.message);
      else if (e instanceof ApiError && e.code === "VALIDATION_ERROR")
        setError("Choose a stronger password (10+ characters with upper, lower case and a digit).");
      else setError(e instanceof Error ? e.message : "Could not change the password.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header
        title={forced ? "Set your password" : "Change password"}
        subtitle={forced ? `Welcome, ${user?.full_name ?? ""}` : undefined}
        back={!forced}
      />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Screen>
          {forced ? (
            <Notice
              tone="info"
              title="One quick step"
              body="You signed in with a temporary password. Choose your own to continue — it keeps your payments and documents private."
            />
          ) : null}
          <Card style={{ gap: space.lg, maxWidth: 520 }}>
            {error ? <Notice tone="danger" body={error} /> : null}
            <Field
              label={forced ? "Temporary password" : "Current password"}
              icon="lock"
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              secureToggle
              textContentType="password"
              autoComplete="current-password"
            />
            <Field
              label="New password"
              icon="lock"
              value={next}
              onChangeText={setNext}
              secureTextEntry
              secureToggle
              textContentType="newPassword"
              autoComplete="new-password"
            />
            <View style={styles.rules}>
              {RULES.map((r) => {
                const ok = r.test(next);
                return (
                  <View key={r.label} style={styles.rule}>
                    <Icon name={ok ? "check" : "dot"} size={14} color={ok ? colors.success : colors.navy200} />
                    <T variant="caption" color={ok ? colors.success : colors.inkSubtle}>
                      {r.label}
                    </T>
                  </View>
                );
              })}
            </View>
            <Field
              label="Confirm new password"
              icon="lock"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              secureToggle
              textContentType="newPassword"
              autoComplete="new-password"
              onSubmitEditing={() => void submit()}
            />
            <Button
              title={forced ? "Save and continue" : "Update password"}
              variant="gold"
              size="lg"
              block
              loading={mutation.isPending}
              onPress={() => void submit()}
            />
            {forced ? (
              <Button
                title="Sign out instead"
                variant="ghost"
                onPress={() => void logout()}
                style={{ alignSelf: "center" }}
              />
            ) : null}
          </Card>
        </Screen>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  rules: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: -space.sm },
  rule: { flexDirection: "row", alignItems: "center", gap: 4, paddingRight: space.sm },
});
