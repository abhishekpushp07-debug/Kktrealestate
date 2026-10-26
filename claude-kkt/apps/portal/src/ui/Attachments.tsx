// Photo attachments for service requests: camera or library via expo-image-picker (web: file dialog).
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LocalFile } from "@/lib/upload";
import { haptics } from "@/lib/haptics";
import { Button, IconButton } from "./Button";
import { T } from "./Text";
import { colors, radius, space } from "./theme";

const MAX_FILES = 10;
const MAX_BYTES = 15 * 1024 * 1024;

export function AttachmentPicker({
  files,
  onChange,
  onError,
  max = MAX_FILES,
}: {
  files: LocalFile[];
  onChange: (files: LocalFile[]) => void;
  onError: (msg: string) => void;
  max?: number;
}): React.JSX.Element {
  const add = (assets: ImagePicker.ImagePickerAsset[]) => {
    const next = [...files];
    for (const a of assets) {
      if (next.length >= max) break;
      if (a.fileSize && a.fileSize > MAX_BYTES) {
        onError(`${a.fileName ?? "A photo"} is larger than 15 MB and was skipped.`);
        continue;
      }
      next.push({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, mimeType: a.mimeType ?? "image/jpeg" });
    }
    onChange(next);
  };

  const pickLibrary = async () => {
    haptics.tap();
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return onError("Allow photo access in Settings to attach pictures.");
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: max - files.length,
      quality: 0.8,
    });
    if (!res.canceled) add(res.assets);
  };

  const pickCamera = async () => {
    haptics.tap();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return onError("Allow camera access in Settings to take a photo.");
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!res.canceled) add(res.assets);
  };

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.buttons}>
        {Platform.OS !== "web" ? (
          <Button
            title="Camera"
            variant="outline"
            size="sm"
            icon="camera"
            onPress={() => void pickCamera()}
            disabled={files.length >= max}
          />
        ) : null}
        <Button
          title={Platform.OS === "web" ? "Add photos" : "Library"}
          variant="outline"
          size="sm"
          icon="image"
          onPress={() => void pickLibrary()}
          disabled={files.length >= max}
        />
        <T variant="caption" color={colors.inkSubtle}>
          {files.length}/{max} · JPG, PNG, WebP up to 15 MB
        </T>
      </View>
      {files.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {files.map((f, i) => (
            <View key={`${f.uri}-${i}`} style={styles.thumbWrap}>
              <Image source={{ uri: f.uri }} style={styles.thumb} contentFit="cover" accessibilityLabel="" />
              <IconButton
                name="close"
                label="Remove photo"
                size={24}
                iconSize={12}
                color={colors.onNavy}
                bg={colors.navy}
                style={styles.remove}
                onPress={() => onChange(files.filter((_, j) => j !== i))}
              />
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

export function AttachmentThumb({
  uri,
  name,
  onPress,
}: {
  uri: string | null;
  name: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={styles.attachment}
    >
      {uri ? <Image source={{ uri }} style={styles.attachmentImg} contentFit="cover" accessibilityLabel="" /> : null}
      <T variant="caption" color={colors.navy} numberOfLines={1} style={{ maxWidth: 140 }}>
        {name}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  thumbWrap: { width: 84, height: 84 },
  thumb: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.navy100 },
  remove: { position: "absolute", top: -6, right: -6 },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.navy50,
    borderRadius: radius.sm,
    padding: 6,
    paddingRight: 10,
  },
  attachmentImg: { width: 32, height: 32, borderRadius: 6, backgroundColor: colors.navy100 },
});
