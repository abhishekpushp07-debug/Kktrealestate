import type { Metadata } from "next";

import { JsonLd } from "@/components/JsonLd";
import { PostCard } from "@/components/blog/PostCard";
import { EnquirySection } from "@/components/home/EnquirySection";
import { Hero } from "@/components/home/Hero";
import { Testimonials } from "@/components/home/Testimonials";
import { TrustStrip } from "@/components/home/TrustStrip";
import { ValueProps } from "@/components/home/ValueProps";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/Button";
import { ClickToLoadEmbed } from "@/components/ui/ClickToLoadEmbed";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { ArrowRightIcon } from "@/components/ui/icons";
import { listPosts, listProjects } from "@/lib/api";
import { closedMetadata, siteGate } from "@/lib/gate";
import { Markdown } from "@/lib/markdown";
import { brandName, breadcrumbJsonLd } from "@/lib/seo";
import { NO_CONTACTS, type HomeSection, type SiteSettings } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return (await closedMetadata()) ?? { alternates: { canonical: "/" }, openGraph: { url: "/" } };
}

function section(site: SiteSettings | null, ...keys: string[]): HomeSection | undefined {
  return site?.home_sections?.find((s) => keys.includes(s.key));
}

function sectionText(body: HomeSection["body"] | undefined): string | null {
  if (!body) return null;
  const text = body.markdown ?? body.text ?? body.body ?? body.subtitle;
  return typeof text === "string" ? text : null;
}

export default async function HomePage() {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const site = gate.site;
  const brand = brandName(site);
  const featuredFromSite = site?.featured_projects ?? [];
  const [featured, latest] = await Promise.all([
    featuredFromSite.length ? Promise.resolve(featuredFromSite) : listProjects().then((all) => all.slice(0, 6)),
    site?.latest_posts?.length ? Promise.resolve(site.latest_posts) : listPosts(1).then((r) => r.items.slice(0, 3)),
  ]);
  const intro = section(site, "intro", "about", "welcome");
  const introText = sectionText(intro?.body);
  const featuredSection = section(site, "featured", "projects");
  const videoSection = section(site, "walkthrough", "video");

  return (
    <>
      <Hero banners={site?.banners ?? []} brandName={brand} tagline={site?.brand?.tagline ?? null} />
      <TrustStrip stats={site?.trust_stats ?? []} />

      {introText ? (
        <Section tone="ivory">
          <Reveal className="mx-auto max-w-prose text-center">
            <p className="eyebrow text-gold-700">{intro?.title ?? `About ${brand}`}</p>
            <Markdown
              source={introText}
              className="prose-kkt mt-6 font-display text-2xl leading-relaxed text-navy-900 sm:text-3xl [&_p]:font-display"
            />
          </Reveal>
        </Section>
      ) : null}

      <Section tone={introText ? "white" : "ivory"} id="projects">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Featured residences"
            title={featuredSection?.title ?? "Addresses worth coming home to"}
            lead={sectionText(featuredSection?.body) ?? undefined}
          />
          <Button href="/projects" variant="outline" className="shrink-0">
            All projects <ArrowRightIcon size={18} />
          </Button>
        </div>
        {featured.length ? (
          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((project, i) => (
              <Reveal key={project.slug} as="li" delay={(i % 3) * 90}>
                <ProjectCard project={project} priority={i < 3} />
              </Reveal>
            ))}
          </ul>
        ) : (
          <p className="mt-12 rounded-card border border-dashed border-line p-10 text-center text-ink-muted">
            New residences are being prepared for launch. Please check back soon or speak to our team.
          </p>
        )}
      </Section>

      <ValueProps items={site?.value_props ?? []} />

      {site?.walkthrough_video_url ? (
        <Section tone="ivory">
          <SectionHeading
            eyebrow="Walkthrough"
            title={videoSection?.title ?? "Step inside before you visit"}
            lead={sectionText(videoSection?.body) ?? "A cinematic tour of our craft. Loads only when you press play."}
            align="center"
          />
          <Reveal className="mx-auto mt-12 max-w-5xl">
            <ClickToLoadEmbed url={site.walkthrough_video_url} title={`${brand} walkthrough`} />
          </Reveal>
        </Section>
      ) : null}

      <Testimonials items={site?.testimonials ?? []} />

      {latest.length ? (
        <Section tone="white">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading eyebrow="Journal" title="News & perspectives" />
            <Button href="/blog" variant="outline" className="shrink-0">
              Read the journal <ArrowRightIcon size={18} />
            </Button>
          </div>
          <ul className="mt-12 grid gap-6 md:grid-cols-3">
            {latest.slice(0, 3).map((post, i) => (
              <Reveal key={post.slug} as="li" delay={i * 90}>
                <PostCard post={post} />
              </Reveal>
            ))}
          </ul>
        </Section>
      ) : null}

      <EnquirySection
        projects={featured.map((p) => ({ slug: p.slug, name: p.name }))}
        contacts={site?.contacts ?? NO_CONTACTS}
        brandName={brand}
      />
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }])} />
    </>
  );
}
