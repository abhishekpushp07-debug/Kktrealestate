"use client";

import { ErrorView } from "@/components/layout/ErrorView";

export default function SiteError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
