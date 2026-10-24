import type { Metadata } from "next";

import { LegalPageView } from "@/components/layout/LegalPageView";
import { findPage } from "@/lib/api";
import { markdownToText } from "@/lib/markdown";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const page = await findPage("disclaimer");
  return pageMetadata({
    title: page?.seo?.title?.trim() || page?.title || "Disclaimer",
    description: page?.seo?.description?.trim() || markdownToText(page?.body_md) || "Important information about the content of this website and RERA.",
    path: "/disclaimer",
  });
}

export default function DisclaimerPage() {
  return <LegalPageView slug="disclaimer" eyebrow="Legal" />;
}
