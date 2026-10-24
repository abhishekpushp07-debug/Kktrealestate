"use client";

import { ErrorView } from "@/components/layout/ErrorView";

export default function LegalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
