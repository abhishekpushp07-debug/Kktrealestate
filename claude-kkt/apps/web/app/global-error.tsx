"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/errorReporter";

/**
 * Last-resort error boundary: replaces the root layout when it (or anything above the segment error boundaries) throws. It renders its
 * own <html>/<body> with inline styles only (the root layout, fonts and SiteConfig are gone) and reports the error to the API (contract
 * C2) using the build-time NEXT_PUBLIC_API_URL.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    void reportClientError(apiUrl, error, {
      release: process.env.NEXT_PUBLIC_RELEASE ?? null,
      extra: { kind: "global-error" },
    });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0B1F3A", color: "#F8F6F1", fontFamily: "system-ui, sans-serif" }}>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "4rem 1.5rem",
            maxWidth: "42rem",
            margin: "0 auto",
          }}
        >
          <p style={{ color: "#E4C766", letterSpacing: "0.2em", textTransform: "uppercase", fontSize: "0.75rem" }}>
            Something went wrong
          </p>
          <h1 style={{ fontSize: "2.25rem", lineHeight: 1.2, margin: "1rem 0", fontFamily: "Georgia, serif" }}>
            We are briefly unable to load this page.
          </h1>
          <p style={{ lineHeight: 1.7, color: "rgb(248 246 241 / 0.8)" }}>
            Our team has been notified. Please try again in a moment.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "2rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 48,
                padding: "0 1.5rem",
                borderRadius: 999,
                border: 0,
                background: "#C9A227",
                color: "#0B1F3A",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                minHeight: 48,
                display: "inline-flex",
                alignItems: "center",
                padding: "0 1.5rem",
                borderRadius: 999,
                border: "1px solid rgb(248 246 241 / 0.4)",
                color: "#F8F6F1",
                textDecoration: "none",
              }}
            >
              Back to home
            </a>
          </div>
          {error.digest ? (
            <p style={{ marginTop: "2rem", fontSize: "0.75rem", color: "rgb(248 246 241 / 0.5)" }}>
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
