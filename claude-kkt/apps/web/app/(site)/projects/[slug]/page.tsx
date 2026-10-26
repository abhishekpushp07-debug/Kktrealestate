import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import { BrochureButton } from "@/components/forms/BrochureGate";
import { VisitBooking } from "@/components/forms/VisitBooking";
import { AvailabilityGrid } from "@/components/projects/AvailabilityGrid";
import { Configurations } from "@/components/projects/Configurations";
import { Faqs } from "@/components/projects/Faqs";
import { HeroGallery } from "@/components/projects/HeroGallery";
import { ProgressTimeline } from "@/components/projects/ProgressTimeline";
import { StickyEnquiryCard } from "@/components/projects/StickyEnquiryCard";
import { Button } from "@/components/ui/Button";
import { ClickToLoadEmbed } from "@/components/ui/ClickToLoadEmbed";
import { Reveal } from "@/components/ui/Reveal";
import { Badge } from "@/components/ui/Section";
import { CalendarIcon, CheckIcon, ExternalLinkIcon, MapPinIcon } from "@/components/ui/icons";
import { findProject, getProject } from "@/lib/api";
import { publicApiUrl } from "@/lib/env";
import { bhkLabel, formatDate, formatNumber, formatSqft, statusLabel, typeLabel } from "@/lib/format";
import { closedMetadata, siteGate } from "@/lib/gate";
import { Markdown, markdownToText } from "@/lib/markdown";
import { resolveMediaUrl } from "@/lib/media";
import { breadcrumbJsonLd, faqJsonLd, pageMetadata, projectJsonLd } from "@/lib/seo";
import { NO_ADDRESS, type Amenity, type ProjectDetail } from "@/lib/types";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const closed = await closedMetadata();
  if (closed) return closed;
  const { slug } = await params;
  const project = await findProject(slug);
  if (!project) return { title: "Project not found", robots: { index: false, follow: false } };
  const image = resolveMediaUrl(project.seo?.og_image_url ?? project.hero_images?.[0]?.url, publicApiUrl());
  return pageMetadata({
    title: project.seo?.title?.trim() || `${project.name}, ${project.city}`,
    description: project.seo?.description?.trim() || markdownToText(project.description ?? "", 160),
    path: `/projects/${project.slug}`,
    image,
  });
}

function sectionsFor(project: ProjectDetail) {
  return [
    { id: "overview", label: "Overview", show: true },
    { id: "configurations", label: "Configurations", show: project.configurations.length > 0 },
    { id: "amenities", label: "Amenities", show: project.amenities.length > 0 },
    { id: "availability", label: "Availability", show: Boolean(project.availability?.blocks.length) },
    { id: "progress", label: "Progress", show: Boolean(project.construction_progress?.blocks.length) },
    { id: "media", label: "Walkthrough", show: project.video_urls.length + project.tour_urls.length > 0 },
    { id: "location", label: "Location", show: Boolean(project.map_embed_url || project.landmarks.length) },
    { id: "faqs", label: "FAQs", show: project.faqs.length > 0 },
    { id: "visit", label: "Site visit", show: project.visit_booking_enabled },
  ].filter((s) => s.show);
}

function groupAmenities(amenities: Amenity[]): Array<[string, Amenity[]]> {
  const groups = new Map<string, Amenity[]>();
  for (const a of amenities) {
    const key = a.category?.trim() || "Amenities";
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups.entries()];
}

const H2 = "font-display text-display-sm text-navy-900";
const SECTION = "scroll-mt-32 border-t border-line pt-12 first:border-t-0 first:pt-0";

export default async function ProjectPage({ params }: { params: Params }) {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const { slug } = await params;
  const site = gate.site;
  const project = await getProject(slug);
  const facts = project.key_facts;
  const address = facts?.address ?? NO_ADDRESS;
  const addressLine = [
    address.line1,
    address.line2,
    address.locality,
    address.city ?? project.city,
    address.state,
    address.pincode,
  ]
    .filter(Boolean)
    .join(", ");
  const sections = sectionsFor(project);
  const flatTypes = project.configurations.map((c) => ({
    code: c.code,
    label: c.bhk ? `${c.bhk} BHK · ${c.name}` : c.name,
  }));
  const bhk = bhkLabel(project.bhk_options ?? project.configurations.map((c) => c.bhk ?? 0).filter(Boolean));
  const mapsSearch =
    typeof project.latitude === "number" && typeof project.longitude === "number"
      ? `https://www.google.com/maps/search/?api=1&query=${project.latitude},${project.longitude}`
      : addressLine
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${project.name}, ${addressLine}`)}`
        : null;

  return (
    <>
      {/* Header */}
      <div className="relative overflow-hidden bg-navy-900 pt-28 text-ivory-100 sm:pt-32">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 10% 0%, rgb(201 162 39 / 0.14), transparent 50%)" }}
        />
        <div className="container-site relative pb-10">
          <nav aria-label="Breadcrumb" className="text-sm text-ivory-100/60">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/" className="inline-flex min-h-12 items-center hover:text-gold-300">
                  Home
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li>
                <Link href="/projects" className="inline-flex min-h-12 items-center hover:text-gold-300">
                  Projects
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li aria-current="page" className="inline-flex min-h-12 items-center text-ivory-100">
                {project.name}
              </li>
            </ol>
          </nav>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>{statusLabel(project.status)}</Badge>
            <Badge tone="ivory">{typeLabel(project.project_type)}</Badge>
            {(project.rera_number ?? facts?.rera_number) ? (
              <Badge tone="ivory">RERA {project.rera_number ?? facts?.rera_number}</Badge>
            ) : null}
          </div>
          <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="font-display text-display-lg text-balance">{project.name}</h1>
              <p className="mt-3 flex items-center gap-2 text-lg text-ivory-100/80">
                <MapPinIcon className="text-gold-300" />{" "}
                {[address.locality, address.city ?? project.city].filter(Boolean).join(", ")}
              </p>
              {project.tagline ? (
                <p className="mt-4 max-w-2xl text-xl leading-8 text-ivory-100/75">{project.tagline}</p>
              ) : null}
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-3 lg:shrink-0">
              {bhk ? (
                <div>
                  <dt className="text-xs uppercase tracking-widest text-ivory-100/60">Configurations</dt>
                  <dd className="mt-1 font-semibold">{bhk}</dd>
                </div>
              ) : null}
              {(project.possession_date ?? facts?.possession_date) ? (
                <div>
                  <dt className="text-xs uppercase tracking-widest text-ivory-100/60">Possession</dt>
                  <dd className="mt-1 font-semibold">
                    {formatDate(project.possession_date ?? facts?.possession_date, "month")}
                  </dd>
                </div>
              ) : null}
              {facts?.total_units ? (
                <div>
                  <dt className="text-xs uppercase tracking-widest text-ivory-100/60">Homes</dt>
                  <dd className="mt-1 font-semibold">{formatNumber(facts.total_units)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div className="bg-gradient-to-b from-navy-900 from-50% to-ivory-100 to-50%">
        <div className="container-site">
          <HeroGallery images={project.hero_images ?? []} projectName={project.name} />
        </div>
      </div>

      {/* In-page navigation */}
      <nav
        aria-label="On this page"
        data-section-nav
        className="sticky top-18 z-30 border-b border-line bg-ivory-100/90 backdrop-blur"
      >
        <ul className="container-site hide-scrollbar flex gap-1 overflow-x-auto">
          {sections.map((s) => (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                className="tap inline-flex items-center px-3 text-sm font-medium text-ink-muted transition hover:text-navy-900"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="container-site grid gap-12 py-12 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16 lg:py-16 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-12">
          {/* Overview & highlights */}
          <section id="overview" className={SECTION} aria-labelledby="overview-title">
            <p className="eyebrow text-gold-700">Overview</p>
            <h2 id="overview-title" className={`${H2} mt-3`}>
              About {project.name}
            </h2>
            <Markdown source={project.description ?? ""} className="prose-kkt mt-6" />
            {project.highlights.length ? (
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {project.highlights.map((h) => (
                  <li
                    key={h}
                    className="flex gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-[0.95rem] leading-6 text-navy-900"
                  >
                    <CheckIcon size={18} className="mt-1 shrink-0 text-gold-600" /> {h}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Key facts & approvals */}
            <div className="mt-12 grid gap-8 md:grid-cols-2">
              <div>
                <h3 className="font-display text-2xl text-navy-900">Key facts</h3>
                <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-white">
                  {[
                    ["Project type", typeLabel(project.project_type)],
                    ["Status", statusLabel(project.status)],
                    ["RERA number", project.rera_number ?? facts?.rera_number ?? null],
                    ["Launched", facts?.launch_date ? formatDate(facts.launch_date, "month") : null],
                    [
                      "Possession",
                      (project.possession_date ?? facts?.possession_date)
                        ? formatDate(project.possession_date ?? facts?.possession_date, "month")
                        : null,
                    ],
                    ["Land area", facts?.land_area_sqft ? formatSqft(facts.land_area_sqft) : null],
                    ["Total homes", facts?.total_units ? formatNumber(facts.total_units) : null],
                    ["Towers / blocks", facts?.block_count ? formatNumber(facts.block_count) : null],
                    ["Floors", facts?.floors ?? null],
                    ["Address", addressLine || null],
                  ]
                    .filter((row): row is [string, string] => typeof row[1] === "string" && row[1].length > 0)
                    .map(([label, value]) => (
                      <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[9rem_1fr]">
                        <dt className="text-xs uppercase tracking-wider text-ink-soft sm:pt-0.5">{label}</dt>
                        <dd className="text-sm font-medium text-navy-900">{value}</dd>
                      </div>
                    ))}
                </dl>
              </div>
              <div>
                <h3 className="font-display text-2xl text-navy-900">Approvals</h3>
                {project.approvals.length ? (
                  <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-white">
                    {project.approvals.map((a, i) => (
                      <li key={`${a.name}-${i}`} className="flex items-start gap-3 px-5 py-3">
                        <CheckIcon size={18} className="mt-1 shrink-0 text-success" />
                        <div className="min-w-0 text-sm">
                          <p className="font-medium text-navy-900">{a.name}</p>
                          <p className="text-ink-muted">{[a.number, a.status].filter(Boolean).join(" · ")}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-ink-muted">Approval details are available on request.</p>
                )}
              </div>
            </div>
          </section>

          {project.configurations.length ? (
            <section id="configurations" className={SECTION} aria-labelledby="configurations-title">
              <p className="eyebrow text-gold-700">Configurations & floor plans</p>
              <h2 id="configurations-title" className={`${H2} mt-3 mb-6`}>
                Choose the home that fits your life
              </h2>
              <Configurations items={project.configurations} showPrices={project.show_prices} />
            </section>
          ) : null}

          {project.amenities.length ? (
            <section id="amenities" className={SECTION} aria-labelledby="amenities-title">
              <p className="eyebrow text-gold-700">Amenities</p>
              <h2 id="amenities-title" className={`${H2} mt-3`}>
                Everyday luxuries, thoughtfully placed
              </h2>
              <div className="mt-6 space-y-8">
                {groupAmenities(project.amenities).map(([category, items]) => (
                  <div key={category}>
                    {groupAmenities(project.amenities).length > 1 ? (
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-soft">{category}</h3>
                    ) : null}
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {items.map((a) => (
                        <li
                          key={a.name}
                          className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-navy-900"
                        >
                          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-gold-500" /> {a.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {project.availability?.blocks.length ? (
            <section id="availability" className={SECTION} aria-labelledby="availability-title">
              <p className="eyebrow text-gold-700">Availability</p>
              <h2 id="availability-title" className={`${H2} mt-3 mb-6`}>
                Live inventory
              </h2>
              <AvailabilityGrid grid={project.availability} />
            </section>
          ) : null}

          {project.construction_progress?.blocks.length ? (
            <section id="progress" className={SECTION} aria-labelledby="progress-title">
              <p className="eyebrow text-gold-700">Construction progress</p>
              <h2 id="progress-title" className={`${H2} mt-3 mb-6`}>
                Watch your home take shape
              </h2>
              <ProgressTimeline progress={project.construction_progress} />
            </section>
          ) : null}

          {project.video_urls.length + project.tour_urls.length > 0 ? (
            <section id="media" className={SECTION} aria-labelledby="media-title">
              <p className="eyebrow text-gold-700">Walkthrough & virtual tour</p>
              <h2 id="media-title" className={`${H2} mt-3`}>
                Step inside from wherever you are
              </h2>
              <p className="mt-2 text-sm text-ink-muted">Players load only when you press play.</p>
              <div className="mt-6 grid gap-6">
                {project.video_urls.map((url, i) => (
                  <Reveal key={url}>
                    <ClickToLoadEmbed
                      url={url}
                      kind="video"
                      title={`${project.name} walkthrough ${project.video_urls.length > 1 ? i + 1 : ""}`.trim()}
                    />
                  </Reveal>
                ))}
                {project.tour_urls.map((url, i) => (
                  <Reveal key={url}>
                    <ClickToLoadEmbed
                      url={url}
                      kind="tour"
                      title={`${project.name} 360° tour ${project.tour_urls.length > 1 ? i + 1 : ""}`.trim()}
                    />
                  </Reveal>
                ))}
              </div>
            </section>
          ) : null}

          {project.map_embed_url || project.landmarks.length ? (
            <section id="location" className={SECTION} aria-labelledby="location-title">
              <p className="eyebrow text-gold-700">Location</p>
              <h2 id="location-title" className={`${H2} mt-3`}>
                Well connected, beautifully placed
              </h2>
              {addressLine ? <p className="mt-2 text-ink-muted">{addressLine}</p> : null}
              <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                {project.map_embed_url ? (
                  <ClickToLoadEmbed url={project.map_embed_url} kind="map" title={`${project.name} on the map`} />
                ) : null}
                <div>
                  {project.landmarks.length ? (
                    <ul className="divide-y divide-line rounded-card border border-line bg-white">
                      {project.landmarks.map((l, i) => (
                        <li
                          key={`${l.name}-${i}`}
                          className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
                        >
                          <span className="text-navy-900">{l.name}</span>
                          {typeof l.distance_km === "number" ? (
                            <span className="shrink-0 text-ink-muted">{formatNumber(l.distance_km, 1)} km</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {mapsSearch ? (
                    <a
                      href={mapsSearch}
                      className="mt-4 inline-flex min-h-12 items-center gap-2 font-semibold text-gold-700 underline-offset-4 hover:underline"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Get directions <ExternalLinkIcon size={16} />
                    </a>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {project.brochure_available ? (
            <section
              id="brochure"
              className="scroll-mt-32 overflow-hidden rounded-card bg-navy-900 p-8 text-ivory-100 sm:p-10"
              aria-labelledby="brochure-title"
            >
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="eyebrow text-gold-300">Brochure</p>
                  <h2 id="brochure-title" className="mt-2 font-display text-display-sm">
                    Take {project.name} with you
                  </h2>
                  <p className="mt-2 text-ivory-100/75">Floor plans, specifications and the full story in one PDF.</p>
                </div>
                <BrochureButton projectSlug={project.slug} projectName={project.name} className="shrink-0" />
              </div>
            </section>
          ) : null}

          {project.faqs.length ? (
            <section id="faqs" className={SECTION} aria-labelledby="faqs-title">
              <p className="eyebrow text-gold-700">Questions</p>
              <h2 id="faqs-title" className={`${H2} mt-3 mb-6`}>
                Frequently asked
              </h2>
              <Faqs items={project.faqs} />
            </section>
          ) : null}
        </div>

        <div id="enquire" className="scroll-mt-32 min-w-0">
          <StickyEnquiryCard
            projectSlug={project.slug}
            projectName={project.name}
            startingPricePaise={project.starting_price_paise}
            showPrices={project.show_prices}
            brochureAvailable={project.brochure_available}
            visitBookingEnabled={project.visit_booking_enabled}
            flatTypes={flatTypes}
            phone={site?.contacts?.phone ?? null}
          />
        </div>
      </div>

      {project.visit_booking_enabled ? (
        <section
          id="visit"
          className="scroll-mt-20 bg-navy-900 py-16 text-ivory-100 sm:py-24"
          aria-labelledby="visit-title"
        >
          <div className="container-site grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div>
              <p className="eyebrow text-gold-300">Private site visit</p>
              <h2 id="visit-title" className="mt-4 font-display text-display-md">
                See {project.name} in person
              </h2>
              <p className="mt-6 text-lg leading-8 text-ivory-100/75">
                Choose a time that suits you. A relationship manager will walk you through the site, the show flat and
                every detail you want to see.
              </p>
              <ul className="mt-8 space-y-3 text-ivory-100/80">
                <li className="flex gap-3">
                  <CalendarIcon className="shrink-0 text-gold-300" /> Confirmed instantly, with a calendar invite
                </li>
                <li className="flex gap-3">
                  <CheckIcon className="shrink-0 text-gold-300" /> Reschedule or cancel from your manage link
                </li>
              </ul>
            </div>
            <div className="rounded-card border border-ivory-100/10 bg-ivory-100/5 p-6 backdrop-blur-sm sm:p-8">
              <VisitBooking
                projects={[{ slug: project.slug, name: project.name }]}
                defaultProjectSlug={project.slug}
                fixedProject
                tone="dark"
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-navy-900 py-16 text-ivory-100">
          <div className="container-site flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <p className="eyebrow text-gold-300">Visit us</p>
              <h2 className="mt-3 font-display text-display-sm">Prefer to see {project.name} in person?</h2>
            </div>
            <Button href="/contact" variant="primary">
              Arrange a visit
            </Button>
          </div>
        </section>
      )}

      <JsonLd
        data={[
          projectJsonLd(project, publicApiUrl()),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Projects", path: "/projects" },
            { name: project.name, path: `/projects/${project.slug}` },
          ]),
          ...(project.faqs.length ? [faqJsonLd(project.faqs)] : []),
        ]}
      />
    </>
  );
}
