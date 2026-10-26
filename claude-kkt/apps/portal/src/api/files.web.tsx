// Signed-file helpers (web): an in-app viewer modal (iframe for PDFs/images) with
// "Open in new tab" and "Download" actions; `downloadAndShare` triggers a browser download.
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { PortalPdfLinkResponse } from "@kkt/contracts";
import { colors, fonts, radius, space } from "@/ui/theme";

export interface SignedFile extends PortalPdfLinkResponse {
  mime?: string;
}

type Listener = (file: SignedFile | null) => void;
let listener: Listener | null = null;

export async function viewSignedFile(link: SignedFile): Promise<void> {
  if (listener) listener(link);
  else window.open(link.download_url, "_blank", "noopener,noreferrer");
}

export async function downloadAndShare(link: SignedFile): Promise<void> {
  const a = document.createElement("a");
  a.href = link.download_url;
  a.download = link.file_name;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Mount once (root layout). Renders the viewer modal when a file is opened. */
export function FileViewerHost(): React.JSX.Element | null {
  const [file, setFile] = useState<SignedFile | null>(null);
  useEffect(() => {
    listener = setFile;
    return () => {
      listener = null;
    };
  }, []);
  if (!file) return null;
  const isImage = (file.mime ?? "").startsWith("image/");
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setFile(null)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.bar}>
            <Text numberOfLines={1} style={styles.title}>
              {file.file_name}
            </Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => window.open(file.download_url, "_blank", "noopener,noreferrer")}
                style={styles.action}
              >
                <Text style={styles.actionText}>Open in new tab</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void downloadAndShare(file)} style={styles.action}>
                <Text style={styles.actionText}>Download</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close viewer"
                onPress={() => setFile(null)}
                style={[styles.action, styles.close]}
              >
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.body}>
            {isImage ? (
              <img
                src={file.download_url}
                alt={file.file_name}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", margin: "auto" }}
              />
            ) : (
              <iframe
                title={file.file_name}
                src={file.download_url}
                style={{ border: 0, width: "100%", height: "100%", background: "#fff" }}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    padding: space.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    width: "100%",
    maxWidth: 1100,
    height: "100%",
    maxHeight: 900,
    backgroundColor: colors.ivory,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.navy,
  },
  title: { flex: 1, color: colors.onNavy, fontFamily: fonts.body, fontSize: 15, fontWeight: "600" },
  actions: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  action: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  actionText: { color: colors.onNavy, fontFamily: fonts.body, fontSize: 13, fontWeight: "600" },
  close: { backgroundColor: colors.gold },
  closeText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  body: { flex: 1, backgroundColor: "#2b2f36", justifyContent: "center" },
});
