// Root layout: providers + auth-gated navigation.
//   unauthenticated        → /login
//   must_change_password   → /change-password
//   otherwise              → (app) shell (sidebar on desktop, tabs on phones)
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FileViewerHost } from "@/api/files";
import { persistOptions, queryClient } from "@/api/queries";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { BookingProvider } from "@/booking/BookingProvider";
import { Icon } from "@/ui/Icon";
import { ToastProvider } from "@/ui/Toast";
import { colors } from "@/ui/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions?.({ fade: true, duration: 300 });

export default function RootLayout(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <AuthProvider>
            <BookingProvider>
              <ToastProvider>
                <StatusBar style="light" />
                <Gate />
                <FileViewerHost />
              </ToastProvider>
            </BookingProvider>
          </AuthProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Gate(): React.JSX.Element {
  const { status, mustChangePassword } = useAuth();
  const booting = status === "booting";
  useEffect(() => {
    if (!booting) SplashScreen.hideAsync().catch(() => undefined);
  }, [booting]);
  if (booting) return <Boot />;
  const signedIn = status === "authenticated";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ivory }, animation: "fade" }}>
      <Stack.Protected guard={signedIn && !mustChangePassword}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && mustChangePassword}>
        <Stack.Screen name="change-password" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

function Boot(): React.JSX.Element {
  return (
    <View style={styles.boot}>
      <View style={styles.mark}>
        <Icon name="diamond" size={28} color={colors.gold} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  boot: { flex: 1, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  mark: { width: 72, height: 72, borderRadius: 20, borderWidth: 1, borderColor: "rgba(201,162,39,0.5)", backgroundColor: "rgba(201,162,39,0.12)", alignItems: "center", justifyContent: "center" },
});
