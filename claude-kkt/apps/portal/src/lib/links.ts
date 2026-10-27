// Outbound links: phone calls, WhatsApp, mail, and safe http(s) URLs.
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

function digits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
}

export async function openTel(phone: string): Promise<void> {
  await Linking.openURL(`tel:${phone.replace(/[^\d+]/g, "")}`).catch(() => undefined);
}

export async function openWhatsApp(phone: string, text?: string): Promise<void> {
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  await Linking.openURL(`https://wa.me/${digits(phone)}${q}`).catch(() => undefined);
}

export async function openMail(email: string): Promise<void> {
  await Linking.openURL(`mailto:${email}`).catch(() => undefined);
}

/** Opens an http(s) URL: new tab on web, in-app browser on phones. Anything else is ignored. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url).catch(() => undefined));
}
