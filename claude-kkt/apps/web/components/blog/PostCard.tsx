import Link from "next/link";

import { SmartImage } from "@/components/ui/SmartImage";
import { formatDate } from "@/lib/format";
import { SIZES } from "@/lib/media";
import type { PostCard as PostCardData } from "@/lib/types";

export function PostCard({ post, featured = false }: { post: PostCardData; featured?: boolean }) {
  return (
    <article className={`group relative flex flex-col overflow-hidden rounded-card bg-white shadow-card transition duration-500 hover:-translate-y-1 hover:shadow-float ${featured ? "lg:flex-row" : ""}`}>
      <div className={`relative overflow-hidden bg-navy-900 ${featured ? "aspect-[16/10] lg:aspect-auto lg:w-1/2" : "aspect-[16/10]"}`}>
        <SmartImage src={post.cover_url ?? null} alt="" sizes={featured ? SIZES.half : SIZES.third} className="transition duration-700 ease-luxe group-hover:scale-105" />
      </div>
      <div className={`flex flex-1 flex-col p-6 ${featured ? "lg:p-10" : ""}`}>
        <p className="text-xs uppercase tracking-[0.2em] text-gold-600">
          {post.published_at ? formatDate(post.published_at) : "News"}
          {post.reading_minutes ? ` · ${post.reading_minutes} min read` : ""}
        </p>
        <h3 className={`mt-3 font-display text-navy-900 ${featured ? "text-display-sm" : "text-2xl"}`}>
          <Link href={`/blog/${post.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {post.title}
          </Link>
        </h3>
        {post.excerpt ? <p className="mt-3 line-clamp-3 leading-7 text-ink-muted">{post.excerpt}</p> : null}
        {post.tags?.length ? (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="Tags">
            {post.tags.slice(0, 3).map((tag) => (
              <li key={tag} className="rounded-full bg-ivory-100 px-3 py-1 text-xs text-ink-muted">
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
