// Screen-reader helpers shared by the portal's form controls and transient messages.
//  - web (react-native-web): live regions are real DOM (role="alert" / aria-live) and are announced when they appear;
//  - Android: accessibilityLiveRegion on the message;
//  - iOS: no live regions, so the message is announced explicitly.
import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/** Speaks `message` on iOS (web and Android use live regions). */
export function announce(message: string | null | undefined): void {
  if (!message || Platform.OS !== "ios") return;
  AccessibilityInfo.announceForAccessibility(message);
}

/** Announces a message whenever it changes to a new non-empty value. */
export function useAnnounce(message: string | null | undefined): void {
  useEffect(() => {
    announce(message);
  }, [message]);
}

/** Props of an assertive live region (form errors, failure notices). */
export const alertRegion = { role: "alert", "aria-live": "assertive", accessibilityLiveRegion: "assertive" } as const;
/** Props of a polite live region (status / success messages). */
export const statusRegion = { role: "status", "aria-live": "polite", accessibilityLiveRegion: "polite" } as const;

/**
 * Web-only ARIA attributes React Native's types do not declare (react-native-web forwards them to the DOM). Spread onto a TextInput
 * / Pressable; on native they are omitted.
 */
export function webAria(attrs: {
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
}): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  const out: Record<string, unknown> = {};
  if (attrs["aria-invalid"]) out["aria-invalid"] = true;
  if (attrs["aria-describedby"]) out["aria-describedby"] = attrs["aria-describedby"];
  if (attrs["aria-required"]) out["aria-required"] = true;
  return out;
}
