// Pieces shared by several screens: PDF open/download actions, the booking gate and tab headers.
import { useRouter } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { PortalPdfLinkResponse } from "@kkt/contracts";
import { errorMessage } from "@/api/client";
import { downloadAndShare, viewSignedFile } from "@/api/files";
import { useBooking } from "@/booking/BookingProvider";
import { haptics } from "@/lib/haptics";
import { Button } from "@/ui/Button";
import { Header, Screen } from "@/ui/Screen";
import { SkeletonCard } from "@/ui/Skeleton";
import { EmptyState, ErrorState } from "@/ui/States";
import { useToast } from "@/ui/Toast";
import { BellButton } from "@/ui/shell/BellButton";
import { BookingChip } from "@/ui/shell/BookingSwitcher";
import { space } from "@/ui/theme";

export type PdfLinkFn = () => Promise<PortalPdfLinkResponse>;

/** View / download a signed PDF link with busy state and toast errors. */
export function useFileActions() {
  const toast = useToast();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fetchLink: PdfLinkFn, mode: "view" | "download", mime = "application/pdf") => {
      if (busyKey) return;
      haptics.tap();
      setBusyKey(key);
      try {
        const link = await fetchLink();
        if (mode === "view") await viewSignedFile({ ...link, mime });
        else {
          await downloadAndShare({ ...link, mime });
          if (Platform.OS === "web") toast.success(`Downloading ${link.file_name}`);
        }
      } catch (e) {
        toast.error(errorMessage(e, "Could not open the file."));
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, toast],
  );
  return {
    busyKey,
    view: (key: string, fn: PdfLinkFn, mime?: string) => void run(key, fn, "view", mime),
    download: (key: string, fn: PdfLinkFn, mime?: string) => void run(key, fn, "download", mime),
  };
}

/** Renders children only when a booking is selected; otherwise loading / empty / error states. */
export function BookingGate({ children, title }: { children: (bookingId: string) => ReactNode; title: string }): React.JSX.Element {
  const booking = useBooking();
  const router = useRouter();
  if (booking.bookingId) return <>{children(booking.bookingId)}</>;
  return (
    <>
      <TabHeader title={title} />
      <Screen onRefresh={booking.refetch}>
        {booking.isLoading ? (
          <>
            <SkeletonCard lines={4} />
            <SkeletonCard lines={2} />
          </>
        ) : booking.isError ? (
          <ErrorState error={new Error("We couldn't load your bookings.")} onRetry={() => void booking.refetch()} />
        ) : (
          <EmptyState icon="flat" title="No booking on your name yet" body="Once your booking is confirmed by our team, your flat, payments and documents will appear here." action="Contact us" onAction={() => router.navigate("/more/requests/new")} />
        )}
      </Screen>
    </>
  );
}

/** Header for tab roots: title, booking chip and bell. */
export function TabHeader({ title, subtitle, tone = "ivory", children, back }: { title: string; subtitle?: string; tone?: "ivory" | "navy"; children?: ReactNode; back?: boolean }): React.JSX.Element {
  return (
    <Header
      title={title}
      subtitle={subtitle}
      tone={tone}
      back={back}
      large
      right={
        <View style={styles.right}>
          <BookingChip onNavy={tone === "navy"} />
          <BellButton onNavy={tone === "navy"} />
        </View>
      }
    >
      {children}
    </Header>
  );
}

/** Sticky-ish footer actions inside a Screen (rendered at the end of the content). */
export function FooterActions({ children }: { children: ReactNode }): React.JSX.Element {
  return <View style={styles.footer}>{children}</View>;
}

export function PdfButtons({ keyBase, fetchLink, actions, compact }: { keyBase: string; fetchLink: PdfLinkFn; actions: ReturnType<typeof useFileActions>; compact?: boolean }): React.JSX.Element {
  const busy = actions.busyKey?.startsWith(keyBase) ?? false;
  return (
    <View style={styles.pdfRow}>
      <Button title="View" variant="outline" size="sm" icon="external" loading={busy && actions.busyKey === `${keyBase}:view`} disabled={busy} onPress={() => actions.view(`${keyBase}:view`, fetchLink)} />
      <Button title={compact ? "Save" : Platform.OS === "web" ? "Download" : "Share"} variant="ghost" size="sm" icon={Platform.OS === "web" ? "download" : "share"} loading={busy && actions.busyKey === `${keyBase}:dl`} disabled={busy} onPress={() => actions.download(`${keyBase}:dl`, fetchLink)} />
    </View>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: "row", alignItems: "center", gap: space.sm },
  footer: { flexDirection: "row", gap: space.sm, flexWrap: "wrap", marginTop: space.sm },
  pdfRow: { flexDirection: "row", gap: space.xs, alignItems: "center" },
});
