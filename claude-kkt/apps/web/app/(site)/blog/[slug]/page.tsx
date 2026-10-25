import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import { Button } from "@/components/ui/Button";
import { SmartImage } from "@/components/ui/SmartImage";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { findPost, getPost } from "@/lib/api";
import { publicApiUrl } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { closedMetadata, siteGate } from "@/lib/gate";
import { Markdown, markdownToText } from "@/lib/markdown";
import { resolveMediaUrl } from "@/lib/media";
import { articleJsonLd, breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const closed = await closedMetadata();
  if (closed) return closed;
  const { slug } = await params;
  const post = await findPost(slug);
  if (!post) return { title: "Article not found", robots: { index: false, follow: false } };
  return pageMetadata({
    title: post.seo?.title?.trim() || post.title,
    description: post.seo?.description?.trim() || post.excerpt?.trim() || markdownToText(post.body_md),
    path: `/blog/${post.slug}`,
    image: resolveMediaUrl(post.seo?.og_image_url ?? post.cover_url, publicApiUrl()),
    type: "article",
    publishedTime: post.published_at,
  });
}

export default async function BlogPostPage({ params }: { params: Params }) {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const { slug } = await params;
  const site = gate.site;
  const post = await getPost(slug);

  return (
    <article>
      <header className="relative overflow-hidden bg-navy-900 pt-32 text-ivory-100 sm:pt-40">
        {post.cover_url ? (
          <>
            <SmartImage src={post.cover_url} alt="" sizes="100vw" priority className="opacity-35" />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-navy-950/40 via-navy-900/70 to-navy-900" />
          </>
        ) : null}
        <div className="container-site relative pb-16 sm:pb-24">
          <Link href="/blog" className="inline-flex min-h-12 items-center gap-2 text-sm text-ivory-100/70 hover:text-gold-300">
            <ArrowLeftIcon size={16} /> Journal
          </Link>
          <p className="mt-6 eyebrow text-gold-300">
            {post.published_at ? formatDate(post.published_at, "long") : "News"}
            {post.author_name ? ` · ${post.author_name}` : ""}
            {post.reading_minutes ? ` · ${post.reading_minutes} min read` : ""}
          </p>
          <h1 className="mt-4 max-w-4xl font-display text-display-lg text-balance">{post.title}</h1>
          {post.excerpt ? <p className="mt-6 max-w-2xl text-xl leading-8 text-ivory-100/75">{post.excerpt}</p> : null}
        </div>
      </header>

      <div className="container-site py-12 sm:py-16">
        <div className="mx-auto max-w-prose">
          <Markdown source={post.body_md} className="prose-kkt" />
          {post.tags?.length ? (
            <ul className="mt-12 flex flex-wrap gap-2" aria-label="Tags">
              {post.tags.map((tag) => (
                <li key={tag} className="rounded-full bg-ivory-200 px-3 py-1 text-sm text-ink-muted">
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-12 flex flex-col gap-3 border-t border-line pt-8 sm:flex-row">
            <Button href="/blog" variant="outline">
              <ArrowLeftIcon size={18} /> More from the journal
            </Button>
            <Button href="/contact">Talk to us</Button>
          </div>
        </div>
      </div>
      <JsonLd data={[articleJsonLd(post, site, publicApiUrl()), breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Journal", path: "/blog" }, { name: post.title, path: `/blog/${post.slug}` }])]} />
    </article>
  );
}
