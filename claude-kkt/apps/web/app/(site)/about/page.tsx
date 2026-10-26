import type { Metadata } from "next";

import { JsonLd } from "@/components/JsonLd";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { SmartImage } from "@/components/ui/SmartImage";
import { ArrowRightIcon } from "@/components/ui/icons";
import { findPage, getPeople, getSiteSettings } from "@/lib/api";
import { closedMetadata, siteGate } from "@/lib/gate";
import { Markdown } from "@/lib/markdown";
import { brandName, breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import type { SiteSettings } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const closed = await closedMetadata();
  if (closed) return closed;
  const site = await getSiteSettings();
  return pageMetadata({
    title: "About",
    description: `The story, leadership and milestones of ${brandName(site)}.`,
    path: "/about",
  });
}

interface Milestone {
  label: string;
  title: string;
  body: string | null;
}

/** Reads a timeline from the CMS home section "timeline" / "milestones" ({ items: [{ year|label, title, body }] }). */
function readTimeline(site: SiteSettings | null): Milestone[] {
  const section = site?.home_sections?.find((s) => ["timeline", "milestones", "journey"].includes(s.key));
  const body = section?.body;
  if (!body || typeof body === "string") return [];
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((raw): Milestone | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const item = raw as Record<string, unknown>;
      const label = String(item.year ?? item.label ?? "").trim();
      const title = String(item.title ?? "").trim();
      if (!label && !title) return null;
      return { label, title, body: typeof item.body === "string" ? item.body : null };
    })
    .filter((m): m is Milestone => m !== null);
}

export default async function AboutPage() {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const site = gate.site;
  const [people, page] = await Promise.all([getPeople(), findPage("about")]);
  const brand = brandName(site);
  const timeline = readTimeline(site);
  const stats = site?.trust_stats ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Our story"
        title={page?.title && page.title.toLowerCase() !== "about" ? page.title : `The people behind ${brand}`}
        lead={site?.brand?.tagline ?? "Building homes with the patience of craftsmen and the discipline of engineers."}
      />

      <Section tone="ivory">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
          <Reveal>
            {page?.body_md ? (
              <Markdown source={page.body_md} className="prose-kkt" />
            ) : (
              <div className="prose-kkt">
                <p className="font-display text-2xl leading-relaxed text-navy-900 sm:text-3xl">
                  {brand} builds homes the way they ought to be built: registered, transparent and finished with care.
                </p>
                <p>
                  From the first site visit to the day you receive your keys, you work with one relationship manager who
                  knows your home as well as you do. Every tower follows a published construction schedule, every
                  payment is reflected in your ledger the day it clears, and every approval sits in your documents
                  folder.
                </p>
                <p>
                  We believe a home is the most important purchase a family makes, and that the process of buying one
                  should feel as considered as the home itself.
                </p>
              </div>
            )}
          </Reveal>
          {stats.length ? (
            <Reveal delay={120}>
              <dl className="grid grid-cols-2 gap-4">
                {stats.slice(0, 4).map((stat) => (
                  <div key={stat.label} className="rounded-card border border-line bg-white p-6">
                    <dd className="font-display text-4xl text-navy-900">{stat.value}</dd>
                    <dt className="mt-2 text-xs uppercase tracking-[0.2em] text-ink-soft">{stat.label}</dt>
                  </div>
                ))}
              </dl>
            </Reveal>
          ) : null}
        </div>
      </Section>

      {people.length ? (
        <Section tone="white" id="leadership">
          <SectionHeading eyebrow="Leadership" title="Guided by experience" />
          <ul className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((person, i) => (
              <Reveal key={`${person.name}-${i}`} as="li" delay={(i % 3) * 90} className="group">
                <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-navy-900">
                  <SmartImage
                    src={person.photo_url ?? null}
                    alt={person.name}
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="transition duration-700 ease-luxe group-hover:scale-105"
                  />
                </div>
                <h3 className="mt-5 font-display text-2xl text-navy-900">{person.name}</h3>
                <p className="text-sm uppercase tracking-wider text-gold-700">{person.title}</p>
                {person.bio ? <p className="mt-3 leading-7 text-ink-muted">{person.bio}</p> : null}
              </Reveal>
            ))}
          </ul>
        </Section>
      ) : null}

      {timeline.length ? (
        <Section tone="navy" id="timeline">
          <SectionHeading eyebrow="Milestones" title="Our journey so far" light />
          <ol className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {timeline.map((m, i) => (
              <Reveal
                key={`${m.label}-${i}`}
                as="li"
                delay={i * 80}
                className="relative border-t border-gold-500/40 pt-6"
              >
                <span aria-hidden className="absolute -top-1.5 left-0 h-3 w-3 rounded-full bg-gold-500" />
                <p className="font-display text-4xl text-gold-300">{m.label}</p>
                <h3 className="mt-2 font-semibold">{m.title}</h3>
                {m.body ? <p className="mt-2 text-sm leading-6 text-ivory-100/70">{m.body}</p> : null}
              </Reveal>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section tone="ivory">
        <div className="flex flex-col items-start justify-between gap-6 rounded-card border border-line bg-white p-8 sm:flex-row sm:items-center sm:p-10">
          <div>
            <p className="eyebrow text-gold-700">Next step</p>
            <h2 className="mt-2 font-display text-display-sm text-navy-900">See the craft for yourself.</h2>
          </div>
          <Button href="/projects">
            Explore projects <ArrowRightIcon size={18} />
          </Button>
        </div>
      </Section>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "About", path: "/about" },
        ])}
      />
    </>
  );
}
