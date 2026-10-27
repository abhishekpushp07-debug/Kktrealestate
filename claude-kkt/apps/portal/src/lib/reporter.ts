// The app's error reporter (wires src/lib/errorReporting.ts to the API origin, the session token and the platform).
import { Platform } from "react-native";
import { API_ORIGIN, session } from "@/api/client";
import {
  createReporter,
  fetchSender,
  installGlobalErrorReporting,
  sampleRateOf,
  type ReportContext,
} from "./errorReporting";

const reporter = createReporter(() => ({
  endpoint: `${API_ORIGIN}/api/v1/client-errors`,
  url: Platform.OS === "web" && typeof location !== "undefined" ? location.href : null,
  userAgent: typeof navigator !== "undefined" && typeof navigator.userAgent === "string" ? navigator.userAgent : null,
  release: process.env.EXPO_PUBLIC_RELEASE || "dev",
  platform: Platform.OS,
  sampleRate: sampleRateOf(process.env.EXPO_PUBLIC_CLIENT_ERROR_SAMPLE_RATE),
  random: Math.random,
  token: () => session.accessToken,
  send: fetchSender,
}));

export function reportClientError(error: unknown, context: ReportContext): boolean {
  return reporter.report(error, context);
}

let installed = false;
/** Web: uncaught errors and unhandled rejections are reported too (once per app start). */
export function installWebErrorReporting(): void {
  if (installed || Platform.OS !== "web" || typeof window === "undefined") return;
  installed = true;
  installGlobalErrorReporting(window, reportClientError);
}
