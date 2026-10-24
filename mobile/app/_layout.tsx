import { useEffect } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Manrope_400Regular } from "@expo-google-fonts/manrope/400Regular";
import { Manrope_500Medium } from "@expo-google-fonts/manrope/500Medium";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { Manrope_800ExtraBold } from "@expo-google-fonts/manrope/800ExtraBold";
import { CormorantGaramond_600SemiBold } from "@expo-google-fonts/cormorant-garamond/600SemiBold";
import { CormorantGaramond_700Bold } from "@expo-google-fonts/cormorant-garamond/700Bold";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { persistOptions, queryClient } from "@/src/query-client";
import { Sidebar } from "@/src/ui/sidebar";
import { UpdatingPill } from "@/src/ui/updating";
import { useWide } from "@/src/ui/screen";
import { AuthProvider, useAuth } from "@/src/auth";
import { ActiveBookingProvider } from "@/src/hooks";
import { ToastHost } from "@/src/ui/toast";
import { PdfViewerHost } from "@/src/ui/pdf-viewer";
import { useTheme } from "@/src/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Nav({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useAuth();
  const { colors } = useTheme();
  const ready = fontsReady && status !== "loading";
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.surface }} testID="app-booting" />;
  const authed = status === "in";
  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface }, animation: Platform.OS === "android" ? "fade_from_bottom" : "default" }}>
      <Stack.Protected guard={authed}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="flat/[id]" />
        <Stack.Screen name="documents" />
        <Stack.Screen name="bank" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="notices/index" />
        <Stack.Screen name="notices/[id]" />
        <Stack.Screen name="requests/new" options={{ presentation: Platform.OS === "ios" ? "modal" : "card" }} />
        <Stack.Screen name="requests/[id]" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="change-password" />
      </Stack.Protected>
      <Stack.Protected guard={!authed}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
  return <Shell authed={authed}>{stack}</Shell>;
}

// ≥1024 px: sidebar + content area (stack screens and the PDF viewer render inside it).
function Shell({ authed, children }: { authed: boolean; children: React.ReactNode }) {
  const wide = useWide();
  if (!authed || !wide)
    return (
      <>
        {children}
        <PdfViewerHost />
      </>
    );
  return (
    <View style={{ flex: 1, flexDirection: "row" }} testID="desktop-shell">
      <Sidebar />
      <View style={{ flex: 1, overflow: "hidden" }}>
        {children}
        <PdfViewerHost inline />
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    ...Feather.font,
  });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
            <KeyboardProvider>
              <AuthProvider>
                <ActiveBookingProvider>
                  <StatusBar style="dark" />
                  <Nav fontsReady={loaded || !!error} />
                  <UpdatingPill />
                  <ToastHost />
                </ActiveBookingProvider>
              </AuthProvider>
            </KeyboardProvider>
          </PersistQueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
