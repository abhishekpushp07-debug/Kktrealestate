// Multipart upload parts that work in BOTH runtimes.
// On a phone the global fetch cannot read file:// URIs on Android and `expo/fetch` rejects the old
// RN `{ uri, name, type }` part shape, so a local file is read through `expo/fetch` into a Blob first.
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";

export interface LocalFile {
  /** asset.uri from expo-image-picker / document picker (file:// on native, blob:/data: on web). */
  uri: string;
  name?: string;
  mimeType?: string;
}

export function fileNameFor(file: LocalFile): string {
  return file.name || file.uri.split("?")[0]?.split("/").pop() || "file";
}

export async function toBlob(file: LocalFile): Promise<Blob> {
  const res = Platform.OS === "web" ? await fetch(file.uri) : await expoFetch(file.uri);
  const blob = await res.blob();
  return file.mimeType && file.mimeType !== blob.type ? new Blob([blob], { type: file.mimeType }) : blob;
}

export async function buildMultipart(
  field: string,
  file: LocalFile,
  fields: Record<string, string> = {},
): Promise<FormData> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append(field, await toBlob(file), fileNameFor(file));
  return form;
}
