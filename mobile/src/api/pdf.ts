// Opens an authenticated portal file (PDF / document).
// Web: in-app viewer modal (ui/pdf-viewer.web.tsx) — bearer fetch → Blob → object
//      URL in an iframe / pdf.js canvas, with Download + Open-in-new-tab anchors.
// Native: download to cache with the Authorization header → system share sheet.
import { Platform } from "react-native";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

import { API, ApiError, refreshAccess, tokens } from "./client";
import { webFetchBlob } from "./fetch-blob";
import { pdfViewer } from "@/src/ui/pdf-viewer";

export { webFetchBlob };

async function nativeDownload(path: string, name: string, token: string | null) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "-");
  const dest = new File(Paths.cache, safe);
  return File.downloadFileAsync(`${API}${path}`, dest, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    idempotent: true,
  });
}

// Native: download to cache with the bearer token (retried once with a refreshed token).
export async function nativeDownloadAuthed(path: string, name: string): Promise<File> {
  try {
    return await nativeDownload(path, name, tokens.access);
  } catch (e: any) {
    if (!tokens.refresh) throw new ApiError(0, "Could not download the file.");
    // The download API does not expose the status; retry once with a fresh token.
    try {
      return await nativeDownload(path, name, await refreshAccess());
    } catch {
      throw new ApiError(0, e?.message?.includes("404") ? "This file is not available yet." : "Could not download the file.");
    }
  }
}

// Local URI for an authenticated resource: blob: URL on web, file:// in cache on native.
export async function authedUri(path: string, name: string): Promise<string> {
  if (Platform.OS === "web") return URL.createObjectURL(await webFetchBlob(path));
  return (await nativeDownloadAuthed(path, name)).uri;
}

async function openNative(path: string, name: string, mime: string) {
  const file = await nativeDownloadAuthed(path, name);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: mime, UTI: mime === "application/pdf" ? "com.adobe.pdf" : undefined, dialogTitle: name });
  } else {
    throw new ApiError(0, `Saved to ${file.uri}`);
  }
}

export async function openFile(path: string, name: string, mime = "application/pdf") {
  if (Platform.OS === "web") return pdfViewer.open({ path, name, mime });
  return openNative(path, name, mime);
}
