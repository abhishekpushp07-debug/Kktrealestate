// Full-screen photo viewer with pinch zoom, swipe / arrows and captions.
import { useState } from "react";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { makeStyles } from "@/src/theme";
import { IconButton } from "./primitives";
import { T } from "./text";
import { ZoomableImage } from "./zoomable";

export type LightboxPhoto = { uri: string; caption?: string | null; sub?: string | null };

export function Lightbox({ photos, index, onClose }: { photos: LightboxPhoto[]; index: number | null; onClose: () => void }) {
  const open = index != null && photos.length > 0;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {open ? <Viewer key={index} photos={photos} start={index} onClose={onClose} /> : null}
    </Modal>
  );
}

function Viewer({ photos, start, onClose }: { photos: LightboxPhoto[]; start: number; onClose: () => void }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(start);
  const p = photos[Math.min(i, photos.length - 1)];
  const go = (d: -1 | 1) => setI((x) => Math.max(0, Math.min(photos.length - 1, x + d)));
  return (
    <>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={s.root} testID="photo-lightbox">
          <View style={[s.top, { paddingTop: insets.top + 8 }]}>
            <T tone="inverseMuted" v="small" testID="lightbox-counter">
              {photos.length > 1 ? `${i + 1} / ${photos.length}` : ""}
            </T>
            <IconButton icon="x" label="Close" tone="navy" onPress={onClose} testID="lightbox-close" />
          </View>
          <View style={s.stage}>{p ? <ZoomableImage key={p.uri} uri={p.uri} onSwipe={go} testID="lightbox-image" /> : null}</View>
          <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>
            {photos.length > 1 ? <IconButton icon="chevron-left" label="Previous photo" tone="navy" onPress={() => go(-1)} testID="lightbox-prev" /> : null}
            <View style={{ flex: 1, alignItems: "center" }}>
              {p?.caption ? (
                <T tone="inverse" v="bodyStrong" style={{ textAlign: "center" }} testID="lightbox-caption">
                  {p.caption}
                </T>
              ) : null}
              {p?.sub ? (
                <T tone="inverseMuted" v="small">
                  {p.sub}
                </T>
              ) : null}
              <T tone="inverseMuted" v="small" style={{ marginTop: 4 }}>
                Pinch or double-tap to zoom
              </T>
            </View>
            {photos.length > 1 ? <IconButton icon="chevron-right" label="Next photo" tone="navy" onPress={() => go(1)} testID="lightbox-next" /> : null}
          </View>
        </View>
      </GestureHandlerRootView>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.overlay },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16 },
  stage: { flex: 1, overflow: "hidden" },
  bottom: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 12 },
}));
