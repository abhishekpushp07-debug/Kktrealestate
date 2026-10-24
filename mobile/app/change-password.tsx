import { KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";

import { Screen, PageHeader } from "@/src/ui/screen";
import { Card } from "@/src/ui/primitives";
import { ChangePasswordForm } from "@/src/screens/change-password-form";

export default function ChangePassword() {
  const router = useRouter();
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Screen testID="change-password-screen">
        <PageHeader back title="Change password" sub="You'll stay signed in here; other devices will be signed out." />
        <Card style={{ padding: 20 }}>
          <ChangePasswordForm onDone={() => (router.canGoBack() ? router.back() : router.replace("/more"))} />
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
