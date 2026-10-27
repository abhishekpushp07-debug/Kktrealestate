import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalPageView } from "@/components/layout/LegalPageView";
import { findPage } from "@/lib/api";
import { markdownToText } from "@/lib/markdown";
import { pageMetadata } from "@/lib/seo";

/**
 * Any other published CMS page at `/<slug>` (terms, refund policy, RERA disclosures…). The API's sitemap lists every published page at
 * this path; static routes (/about, /privacy, /projects…) take precedence over it. Rendered on first request and kept for 5 minutes
 * (ISR) or until the API revalidates it after a CMS write; an unpublished page answers 404.
 */
export const revalidate = 300;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

type Params = Promise<{ slug: string }>;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = SLUG.test(slug) ? await findPage(slug) : null;
  if (!page) return { title: "Page not found", robots: { index: false, follow: false } };
  return pageMetadata({
    title: page.seo?.title?.trim() || page.title,
    description: page.seo?.description?.trim() || markdownToText(page.body_md, 160),
    path: `/${page.slug}`,
  });
}

export default async function CmsPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  return <LegalPageView slug={slug} eyebrow="Information" />;
}
