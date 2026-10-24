import { Carousel } from "@/components/ui/Carousel";
import { Section, SectionHeading } from "@/components/ui/Section";
import { SmartImage } from "@/components/ui/SmartImage";
import { QuoteIcon, StarIcon } from "@/components/ui/icons";
import type { Testimonial } from "@/lib/types";

export function Testimonials({ items }: { items: Testimonial[] }) {
  if (!items.length) return null;
  return (
    <Section tone="navy">
      <SectionHeading eyebrow="Stories from home" title="What our families say" light />
      <div className="mt-12">
        <Carousel label="Testimonials" light itemClassName="w-[88%] sm:w-[60%] lg:w-[42%]">
          {items.map((t, i) => (
            <figure key={`${t.name}-${i}`} className="flex h-full flex-col rounded-card border border-ivory-100/10 bg-ivory-100/5 p-7 backdrop-blur-sm sm:p-8">
              <QuoteIcon size={28} className="text-gold-400" />
              {typeof t.rating === "number" && t.rating > 0 ? (
                <p className="mt-4 flex gap-1 text-gold-400" aria-label={`${t.rating} out of 5 stars`}>
                  {Array.from({ length: 5 }, (_, s) => (
                    <StarIcon key={s} size={14} className={s < (t.rating ?? 0) ? "" : "opacity-25"} />
                  ))}
                </p>
              ) : null}
              <blockquote className="mt-4 flex-1 font-display text-xl leading-relaxed text-ivory-100/90 sm:text-2xl">“{t.quote}”</blockquote>
              <figcaption className="mt-6 flex items-center gap-4">
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-navy-700">
                  <SmartImage src={t.photo_url ?? null} alt="" sizes="48px" />
                </span>
                <span>
                  <span className="block font-semibold">{t.name}</span>
                  {t.project_name ? <span className="block text-sm text-ivory-100/60">{t.project_name}</span> : null}
                </span>
              </figcaption>
            </figure>
          ))}
        </Carousel>
      </div>
    </Section>
  );
}
