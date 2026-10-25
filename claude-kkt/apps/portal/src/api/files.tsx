// Signed-file helpers (native): "view" opens the short-lived link in the in-app browser,
// "download" saves it to the cache with expo-file-system and hands it to the system share sheet.
// files.web.tsx is the browser counterpart (in-app viewer modal / new tab).
// NOTE: this file is .tsx on purpose. Metro tries platform variants PER EXTENSION in sourceExts order
// (files.web.ts → files.ts → files.web.tsx → files.tsx), so a .web.tsx counterpart only wins when the
// default file shares its extension; as files.ts the native module was bundled for web.
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import type { PortalPdfLinkResponse } from "@kkt/contracts";
import { ApiError } from "./client";

export interface SignedFile extends PortalPdfLinkResponse {
  mime?: string;
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "document";
}

async function downloadToCache(link: SignedFile): Promise<File> {
  const dir = new Directory(Paths.cache, "kkt-downloads");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, safeName(link.file_name));
  if (dest.exists) dest.delete();
  try {
    return await File.downloadFileAsync(link.download_url, dest, { idempotent: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    throw new ApiError({ status: 0, code: "NETWORK", message: msg.includes("404") ? "This file is not available yet." : "Could not download the file. Please try again." });
  }
}

/** Opens the document for reading (in-app browser renders PDFs on iOS; Android falls back to the share sheet). */
export async function viewSignedFile(link: SignedFile): Promise<void> {
  try {
    const result = await WebBrowser.openBrowserAsync(link.download_url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
    if (result.type === "cancel" || result.type === "dismiss" || result.type === "opened") return;
  } catch {
    /* fall through to download + share */
  }
  await downloadAndShare(link);
}

/** Downloads to cache and shows the native share sheet (save to Files, WhatsApp, mail…). */
export async function downloadAndShare(link: SignedFile): Promise<void> {
  const file = await downloadToCache(link);
  if (await Sharing.isAvailableAsync()) {
    const mime = link.mime ?? "application/pdf";
    await Sharing.shareAsync(file.uri, { mimeType: mime, UTI: mime === "application/pdf" ? "com.adobe.pdf" : undefined, dialogTitle: link.file_name });
    return;
  }
  throw new ApiError({ status: 0, code: "UNKNOWN", message: `Saved to ${file.uri}` });
}

/** Web only: no-op host on native. */
export function FileViewerHost(): null {
  return null;
}
