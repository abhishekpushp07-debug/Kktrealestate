"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { SmartImage } from "@/components/ui/SmartImage";
import { usePrefersReducedMotion } from "@/components/ui/hooks";
import { ArrowRightIcon, CalendarIcon } from "@/components/ui/icons";
import type { Banner } from "@/lib/types";

interface HeroProps {
  banners: Banner[];
  brandName: string;
  tagline: string | null;
  intervalMs?: number;
}

/** Cinematic crossfading hero with Ken Burns. Slides auto-advance unless the visitor prefers reduced motion. */
export function Hero({ banners, brandName, tagline, intervalMs = 6500 }: HeroProps) {
  const slides: Banner[] = banners.length
    ? banners
    : [
        {
          title: tagline ?? `Homes crafted for generations`,
          subtitle: `Discover the latest residences by ${brandName}.`,
          cta_label: "Explore projects",
          cta_url: "/projects",
          image_url: "",
          image_medium_url: null,
        },
      ];
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (slides.length < 2 || paused || reduced) return;
    const timer = window.setInterval(() => setActive((i) => (i + 1) % slides.length), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, paused, reduced, slides.length]);

  const current = slides[active] ?? slides[0];

  return (
    <section
      className="relative flex min-h-[100svh] items-end overflow-hidden bg-navy-950 text-ivory-100"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {slides.map((slide, i) => (
        <div key={`${slide.title}-${i}`} className="hero-slide" data-active={i === active} aria-hidden={i !== active}>
          <div className="hero-media absolute inset-0 will-change-transform">
            <SmartImage
              src={slide.image_url || null}
              alt=""
              sizes="100vw"
              priority={i === 0}
              quality={70}
              objectPosition="center"
            />
          </div>
        </div>
      ))}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/40 to-navy-950/30" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-navy-950/60 to-transparent" />

      <div className="container-site relative pb-28 pt-40 sm:pb-32 lg:pb-36">
        <div key={active} className="max-w-3xl animate-fade-up" aria-live="polite">
          <p className="eyebrow text-gold-300">{brandName}</p>
          <h1 className="mt-5 font-display text-display-xl text-balance">{current?.title}</h1>
          {current?.subtitle ? (
            <p className="mt-6 max-w-xl text-lg leading-8 text-ivory-100/80 sm:text-xl">{current.subtitle}</p>
          ) : null}
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button href={current?.cta_url || "/projects"} size="lg">
              {current?.cta_label || "Explore projects"} <ArrowRightIcon size={18} />
            </Button>
            <Button href="/contact#visit" variant="outline-light" size="lg">
              <CalendarIcon size={18} /> Book a site visit
            </Button>
          </div>
        </div>

        {slides.length > 1 ? (
          <div className="mt-12 flex items-center gap-3" role="tablist" aria-label="Slides">
            {slides.map((slide, i) => (
              <button
                key={`dot-${i}`}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`Slide ${i + 1}: ${slide.title}`}
                onClick={() => setActive(i)}
                className="tap flex items-center justify-center"
              >
                <span
                  className={`block h-1 rounded-full transition-all duration-500 ${i === active ? "w-10 bg-gold-500" : "w-5 bg-ivory-100/40"}`}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 text-[0.65rem] uppercase tracking-[0.3em] text-ivory-100/50 md:block"
      >
        Scroll
      </div>
    </section>
  );
}
