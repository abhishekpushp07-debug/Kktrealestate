import type { Metadata } from "next";

import { LegalPageView } from "@/components/layout/LegalPageView";
import { findPage } from "@/lib/api";
import { markdownToText } from "@/lib/markdown";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const page = await findPage("privacy");
  return pageMetadata({
    title: page?.seo?.title?.trim() || page?.title || "Privacy Policy",
    description: page?.seo?.description?.trim() || markdownToText(page?.body_md) || "How we collect, use and protect your personal information.",
    path: "/privacy",
  });
}

export default function PrivacyPage() {
  return <LegalPageView slug="privacy" eyebrow="Legal" />;
}
