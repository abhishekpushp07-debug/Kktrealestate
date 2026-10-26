"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ArrowLeftIcon, ArrowRightIcon } from "@/components/ui/icons";

interface CarouselProps {
  children: ReactNode;
  label: string;
  className?: string;
  /** Tailwind classes applied to each slide, e.g. "w-[85%] sm:w-[48%] lg:w-[32%]". */
  itemClassName?: string;
  light?: boolean;
}

/** CSS scroll-snap carousel. Works with swipe/scroll alone; buttons are progressive enhancement. */
export function Carousel({
  children,
  label,
  className = "",
  itemClassName = "w-[85%] sm:w-[60%] lg:w-[40%]",
  light = false,
}: CarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    update();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const scrollBy = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const btn = `tap inline-flex items-center justify-center rounded-full border transition disabled:opacity-30 ${
    light
      ? "border-ivory-100/40 text-ivory-100 hover:bg-ivory-100/10"
      : "border-navy-900/20 text-navy-900 hover:bg-navy-900 hover:text-ivory-100"
  }`;

  return (
    <div className={`relative ${className}`.trim()} role="region" aria-roledescription="carousel" aria-label={label}>
      <div
        ref={trackRef}
        // keyboard users can focus the track and scroll it with the arrow keys (it may hold no focusable item)
        tabIndex={0}
        className="hide-scrollbar rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-2 [-webkit-overflow-scrolling:touch]"
      >
        {Array.isArray(children)
          ? children.map((child, i) => (
              <div key={i} className={`shrink-0 snap-start ${itemClassName}`}>
                {child}
              </div>
            ))
          : children}
      </div>
      <div className="mt-6 flex items-center justify-end gap-3">
        <button type="button" className={btn} onClick={() => scrollBy(-1)} disabled={atStart} aria-label="Previous">
          <ArrowLeftIcon />
        </button>
        <button type="button" className={btn} onClick={() => scrollBy(1)} disabled={atEnd} aria-label="Next">
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  );
}

export function CarouselItem({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
