// Full-screen image viewer with zoom controls, captions and swipe/arrow navigation.
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "./Button";
import { T } from "./Text";
import { colors, space } from "./theme";
import { ZoomableImage, type ZoomableHandle } from "./ZoomableImage";

export interface LightboxImage {
  uri: string;
  caption?: string | null;
  subtitle?: string | null;
}

export function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: ReadonlyArray<LightboxImage>;
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const zoom = useRef<ZoomableHandle>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const open = index !== null && index >= 0 && index < images.length;
  const current = open ? images[index] : undefined;

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < images.length - 1) onIndexChange(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, images.length, onClose, onIndexChange]);

  if (!open || !current) return null;
  const go = (dir: -1 | 1) => {
    const next = index + dir;
    if (next >= 0 && next < images.length) {
      zoom.current?.reset();
      onIndexChange(next);
    }
  };
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <ZoomableImage
          key={current.uri}
          ref={zoom}
          uri={current.uri}
          alt={current.caption ?? "Photo"}
          onSwipe={go}
          onSingleTap={() => setChromeVisible((v) => !v)}
        />
        {chromeVisible ? (
          <>
            <View style={[styles.top, { paddingTop: Math.max(insets.top, 12) }]}>
              <T variant="caption" color={colors.onNavyMuted}>
                {index + 1} / {images.length}
              </T>
              <View style={styles.actions}>
                <IconButton
                  name="zoom-out"
                  label="Zoom out"
                  color={colors.onNavy}
                  bg="rgba(255,255,255,0.12)"
                  onPress={() => zoom.current?.zoomOut()}
                />
                <IconButton
                  name="zoom-in"
                  label="Zoom in"
                  color={colors.onNavy}
                  bg="rgba(255,255,255,0.12)"
                  onPress={() => zoom.current?.zoomIn()}
                />
                <IconButton name="close" label="Close viewer" color={colors.navy} bg={colors.gold} onPress={onClose} />
              </View>
            </View>
            <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <IconButton
                name="chevron-left"
                label="Previous photo"
                color={colors.onNavy}
                bg="rgba(255,255,255,0.12)"
                onPress={() => go(-1)}
                disabled={index === 0}
              />
              <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
                {current.caption ? (
                  <T variant="bodyStrong" color={colors.onNavy} align="center" numberOfLines={2}>
                    {current.caption}
                  </T>
                ) : null}
                {current.subtitle ? (
                  <T variant="caption" color={colors.onNavyMuted} align="center">
                    {current.subtitle}
                  </T>
                ) : null}
              </View>
              <IconButton
                name="chevron-right"
                label="Next photo"
                color={colors.onNavy}
                bg="rgba(255,255,255,0.12)"
                onPress={() => go(1)}
                disabled={index === images.length - 1}
              />
            </View>
          </>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050c18" },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  actions: { flexDirection: "row", gap: space.sm },
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: "rgba(5,12,24,0.55)",
  },
});
