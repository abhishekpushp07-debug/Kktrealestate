// Photo attachments: camera (native) + library → LocalFile[] for multipart field `file`.
import { Platform, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";

import type { LocalFile } from "@/src/utils/upload";
import { fonts, makeStyles, radius, useTheme } from "@/src/theme";
import { Press } from "./primitives";
import { T } from "./text";
import { toast } from "./toast";

const MAX = 5;
const MAX_BYTES = 8 * 1024 * 1024;

function toFile(a: ImagePicker.ImagePickerAsset, i: number): LocalFile | null {
  if (a.fileSize && a.fileSize > MAX_BYTES) {
    toast.error("Each photo must be under 8 MB");
    return null;
  }
  const ext = (a.mimeType?.split("/")[1] || "jpg").replace("jpeg", "jpg");
  return { uri: a.uri, name: a.fileName || `photo-${Date.now()}-${i}.${ext}`, mimeType: a.mimeType || "image/jpeg" };
}

export function AttachmentPicker({ files, onChange, testIDPrefix }: { files: LocalFile[]; onChange: (f: LocalFile[]) => void; testIDPrefix: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const room = MAX - files.length;

  const add = (assets: ImagePicker.ImagePickerAsset[]) => {
    const next = assets.map(toFile).filter(Boolean) as LocalFile[];
    onChange([...files, ...next].slice(0, MAX));
  };

  const library = async () => {
    if (room <= 0) return toast.info(`Up to ${MAX} photos per message`);
    if (Platform.OS !== "web") {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!p.granted) return toast.error("Allow photo access in Settings to attach photos");
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: room, quality: 0.7 });
    if (!r.canceled) add(r.assets);
  };

  const camera = async () => {
    if (room <= 0) return toast.info(`Up to ${MAX} photos per message`);
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) return toast.error("Allow camera access in Settings to take photos");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (!r.canceled) add(r.assets);
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={s.row}>
        {Platform.OS !== "web" ? (
          <Press onPress={camera} style={s.btn} testID={`${testIDPrefix}-camera`}>
            <Feather name="camera" size={17} color={colors.onSurface} />
            <T style={s.btnText}>Camera</T>
          </Press>
        ) : null}
        <Press onPress={library} style={s.btn} testID={`${testIDPrefix}-library`}>
          <Feather name="image" size={17} color={colors.onSurface} />
          <T style={s.btnText}>{Platform.OS === "web" ? "Attach photos" : "Gallery"}</T>
        </Press>
      </View>
      {files.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {files.map((f, i) => (
            <View key={f.uri + i} style={s.thumbWrap}>
              <Image source={{ uri: f.uri }} style={s.thumb} contentFit="cover" />
              <Press haptics={false} onPress={() => onChange(files.filter((_, j) => j !== i))} style={s.remove} testID={`${testIDPrefix}-remove-${i}`} accessibilityLabel="Remove photo">
                <Feather name="x" size={14} color={colors.onSurfaceInverse} />
              </Press>
            </View>
          ))}
        </ScrollView>
      ) : (
        <T v="small" tone="muted">
          Optional · up to {MAX} photos (JPG/PNG/WEBP, max 8 MB each)
        </T>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: 10 },
  btn: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: c.borderStrong, backgroundColor: c.surfaceSecondary },
  btnText: { fontFamily: fonts.semibold, fontSize: 13, color: c.onSurface },
  thumbWrap: { width: 72, height: 72 },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: c.skeleton },
  remove: { position: "absolute", top: -6, right: -6, width: 26, height: 26, borderRadius: 13, backgroundColor: c.surfaceInverse, alignItems: "center", justifyContent: "center" },
}));
