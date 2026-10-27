import type { Metadata } from "next";

import { JsonLd } from "@/components/JsonLd";
import { PostCard } from "@/components/blog/PostCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/ui/icons";
import { listPosts } from "@/lib/api";
import { closedMetadata, siteGate } from "@/lib/gate";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

/** Reads ?page, so it renders per request; its API data is cached 5 minutes (lib/api.ts). */
export const revalidate = 300;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readPage(params: Record<string, string | string[] | undefined>): number {
  const raw = Array.isArray(params.page) ? params.page[0] : params.page;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 10_000 ? n : 1;
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const closed = await closedMetadata();
  if (closed) return closed;
  const page = readPage(await searchParams);
  return pageMetadata({
    title: page > 1 ? `Journal · Page ${page}` : "Journal",
    description: "News, launches and perspectives on building and buying homes in India.",
    path: page > 1 ? `/blog?page=${page}` : "/blog",
  });
}

export default async function BlogPage({ searchParams }: { searchParams: SearchParams }) {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const page = readPage(await searchParams);
  const result = await listPosts(page);
  const totalPages = result.page_size > 0 ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1;
  const [first, ...rest] = result.items;

  return (
    <>
      <PageHeader
        eyebrow="Journal"
        title="News & perspectives"
        lead="Launch announcements, construction updates and considered writing on homes and the cities they shape."
        compact
      />
      <section className="container-site py-12 sm:py-16">
        {first ? (
          <>
            {page === 1 ? (
              <Reveal>
                <PostCard post={first} featured />
              </Reveal>
            ) : null}
            <ul className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {(page === 1 ? rest : result.items).map((post, i) => (
                <Reveal key={post.slug} as="li" delay={(i % 3) * 80}>
                  <PostCard post={post} />
                </Reveal>
              ))}
            </ul>
          </>
        ) : (
          <p className="rounded-card border border-dashed border-line p-12 text-center text-ink-muted">
            Our first stories are being written. Please check back soon.
          </p>
        )}
        {totalPages > 1 ? (
          <nav className="mt-12 flex items-center justify-between gap-4" aria-label="Pagination">
            {page > 1 ? (
              <Button href={page === 2 ? "/blog" : `/blog?page=${page - 1}`} variant="outline">
                <ArrowLeftIcon size={18} /> Newer
              </Button>
            ) : (
              <span />
            )}
            <p className="text-sm text-ink-muted">
              Page {page} of {totalPages}
            </p>
            {page < totalPages ? (
              <Button href={`/blog?page=${page + 1}`} variant="outline">
                Older <ArrowRightIcon size={18} />
              </Button>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Journal", path: "/blog" },
        ])}
      />
    </>
  );
}
