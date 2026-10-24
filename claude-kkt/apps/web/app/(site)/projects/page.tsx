import type { Metadata } from "next";

import { JsonLd } from "@/components/JsonLd";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ProjectFilters } from "@/components/projects/ProjectFilters";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { listProjects } from "@/lib/api";
import { statusLabel } from "@/lib/format";
import { closedMetadata, siteGate } from "@/lib/gate";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import type { ProjectListFilters } from "@/lib/types";

type SearchParams = Record<string, string | string[] | undefined>;

function pick(params: SearchParams, key: string, max = 60): string | undefined {
  const value = params[key];
  const str = Array.isArray(value) ? value[0] : value;
  const trimmed = str?.trim().slice(0, max);
  return trimmed ? trimmed : undefined;
}

function readFilters(params: SearchParams): ProjectListFilters {
  const bhk = pick(params, "bhk", 4);
  return {
    city: pick(params, "city"),
    status: pick(params, "status", 30)?.toUpperCase(),
    bhk: bhk && /^\d+(\.\d)?$/.test(bhk) ? bhk : undefined,
    q: pick(params, "q", 80),
  };
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const closed = await closedMetadata();
  if (closed) return closed;
  const filters = readFilters(await searchParams);
  const parts = [filters.city, filters.status ? statusLabel(filters.status) : undefined, filters.bhk ? `${filters.bhk} BHK` : undefined].filter(Boolean);
  return pageMetadata({
    title: parts.length ? `Projects · ${parts.join(" · ")}` : "Projects",
    description: "Explore our RERA-registered residential and commercial projects: configurations, possession timelines and pricing on request.",
    path: "/projects",
    noIndex: parts.length > 0 || Boolean(filters.q),
  });
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const filters = readFilters(await searchParams);
  const hasFilters = Boolean(filters.city || filters.status || filters.bhk || filters.q);
  const [all, filtered] = await Promise.all([listProjects(), hasFilters ? listProjects(filters) : Promise.resolve(null)]);
  const projects = filtered ?? all;
  const cities = [...new Set(all.map((p) => p.city).filter(Boolean))].sort();
  const bhks = [...new Set(all.flatMap((p) => p.bhk_options ?? []))].sort((a, b) => a - b);

  return (
    <>
      <PageHeader eyebrow="Our portfolio" title="Projects" lead="Residences and commercial addresses, each registered under RERA and built to the standard our families expect." compact />
      <div className="container-site -mt-8 relative z-10">
        <ProjectFilters filters={filters} cities={cities} bhks={bhks} />
      </div>
      <section className="container-site py-12 sm:py-16" aria-live="polite">
        <p className="text-sm text-ink-muted">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
          {hasFilters ? " match your filters" : ""}
        </p>
        {projects.length ? (
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, i) => (
              <Reveal key={project.slug} as="li" delay={(i % 3) * 80}>
                <ProjectCard project={project} priority={i < 3} />
              </Reveal>
            ))}
          </ul>
        ) : (
          <div className="mt-6 rounded-card border border-dashed border-line p-12 text-center">
            <p className="font-display text-2xl text-navy-900">No projects match those filters.</p>
            <p className="mt-2 text-ink-muted">Try widening your search, or let us know what you are looking for.</p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button href="/projects" variant="outline">
                Clear filters
              </Button>
              <Button href="/contact">Talk to us</Button>
            </div>
          </div>
        )}
      </section>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Projects", path: "/projects" }])} />
    </>
  );
}
