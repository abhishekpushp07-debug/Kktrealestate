import { PageHeader } from "@/components/layout/PageHeader";
import { getPage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Markdown } from "@/lib/markdown";

/** Renders a CMS legal page (/pages/:slug); a missing or unpublished page is a 404. */
export async function LegalPageView({ slug, eyebrow }: { slug: string; eyebrow: string }) {
  const page = await getPage(slug);
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={page.title} lead={page.updated_at ? `Last updated ${formatDate(page.updated_at)}` : undefined} compact />
      <div className="container-site py-12 sm:py-16">
        <Markdown source={page.body_md} className="prose-kkt mx-auto max-w-prose" />
      </div>
    </>
  );
}
