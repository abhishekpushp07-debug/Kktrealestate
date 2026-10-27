"use client";

import { useEffect } from "react";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { reportClientError } from "@/lib/errorReporter";

/**
 * Reports uncaught errors and unhandled promise rejections of the page to the API (contract C2). Errors caught by an error boundary are
 * reported by ErrorView / global-error instead. Renders nothing.
 */
export function ErrorReporter() {
  const { apiUrl, release } = useSiteConfig();
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // resource load errors (img/script 404) carry no error object; they are not application bugs
      if (!event.error && !event.message) return;
      void reportClientError(apiUrl, event.error ?? event.message, {
        release,
        extra: { kind: "window.onerror", source: event.filename ? event.filename.split("?")[0] : undefined },
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      void reportClientError(apiUrl, event.reason, { release, extra: { kind: "unhandledrejection" } });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [apiUrl, release]);
  return null;
}
