import Link from "next/link";

import { Badge } from "@/components/ui/Section";
import { SmartImage } from "@/components/ui/SmartImage";
import { ArrowRightIcon, MapPinIcon } from "@/components/ui/icons";
import { bhkLabel, formatDate, startingPriceLabel, statusLabel } from "@/lib/format";
import { SIZES } from "@/lib/media";
import type { ProjectCard as ProjectCardData } from "@/lib/types";

export function ProjectCard({ project, priority = false }: { project: ProjectCardData; priority?: boolean }) {
  const price = startingPriceLabel(project.starting_price_paise);
  const bhk = bhkLabel(project.bhk_options);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card bg-white shadow-card transition duration-500 hover:-translate-y-1 hover:shadow-float">
      <div className="relative aspect-[4/3] overflow-hidden bg-navy-900">
        <SmartImage src={project.hero_image_url} alt={`${project.name}, ${project.city}`} sizes={SIZES.card} priority={priority} className="transition duration-700 ease-luxe group-hover:scale-105" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-navy-950/70 via-transparent to-transparent" />
        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          <Badge tone="ivory">{statusLabel(project.status)}</Badge>
        </div>
        <p className={`absolute bottom-4 left-4 rounded-full px-3 py-1 text-sm font-semibold ${price ? "bg-gold-500 text-navy-950" : "bg-ivory-100/90 text-navy-900"}`}>{price ?? "Price on request"}</p>
      </div>
      <div className="flex flex-1 flex-col p-6">
        <p className="flex items-center gap-1.5 text-sm text-ink-muted">
          <MapPinIcon size={16} className="text-gold-600" />
          {[project.locality, project.city].filter(Boolean).join(", ")}
        </p>
        <h3 className="mt-2 font-display text-2xl text-navy-900">
          <Link href={`/projects/${project.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {project.name}
          </Link>
        </h3>
        {project.tagline ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-muted">{project.tagline}</p> : null}
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {bhk ? (
            <div>
              <dt className="sr-only">Configurations</dt>
              <dd className="font-semibold text-navy-900">{bhk}</dd>
            </div>
          ) : null}
          {project.possession_date ? (
            <div>
              <dt className="sr-only">Possession</dt>
              <dd className="text-ink-muted">Possession {formatDate(project.possession_date, "month")}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-auto flex items-center justify-between pt-6">
          {project.rera_number ? <p className="text-[0.7rem] uppercase tracking-wider text-ink-soft">RERA {project.rera_number}</p> : <span />}
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-gold-700 transition group-hover:gap-2" aria-hidden>
            View <ArrowRightIcon size={16} />
          </span>
        </div>
      </div>
    </article>
  );
}
