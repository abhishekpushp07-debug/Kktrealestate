"use client";

import { useCallback, useEffect, useRef } from "react";

import { SmartImage } from "@/components/ui/SmartImage";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon } from "@/components/ui/icons";
import { useFocusTrap, useIsClient, useLockBodyScroll } from "@/components/ui/hooks";

export interface LightboxImage {
  src: string;
  alt: string;
  caption?: string | null;
}

interface LightboxProps {
  images: LightboxImage[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

/** Keyboard-accessible, focus-trapped image viewer. Esc closes; arrows navigate; swipe on touch. */
export function Lightbox({ images, index, onClose, onIndexChange }: LightboxProps) {
  const open = index !== null && images.length > 0;
  const ref = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);
  const mounted = useIsClient();
  useFocusTrap(ref, open && mounted, onClose);
  useLockBodyScroll(open);

  const go = useCallback(
    (delta: number) => {
      if (index === null || images.length === 0) return;
      onIndexChange((index + delta + images.length) % images.length);
    },
    [images.length, index, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, open]);

  if (!open || !mounted || index === null) return null;
  const current = images[index];
  if (!current) return null;

  const nav =
    "tap inline-flex items-center justify-center rounded-full bg-ivory-100/10 text-ivory-100 backdrop-blur hover:bg-ivory-100/20";

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Image ${index + 1} of ${images.length}${current.caption ? `: ${current.caption}` : ""}`}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col bg-navy-950/95 text-ivory-100 outline-none animate-fade-in"
      onTouchStart={(e) => {
        touchStart.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        const end = e.changedTouches[0]?.clientX;
        if (start !== null && end !== undefined && Math.abs(end - start) > 48) go(end < start ? 1 : -1);
        touchStart.current = null;
      }}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <p className="text-sm tracking-wider text-ivory-100/70" aria-live="polite">
          {index + 1} / {images.length}
        </p>
        <button type="button" onClick={onClose} className={nav} aria-label="Close image viewer" data-autofocus>
          <CloseIcon />
        </button>
      </div>
      <div className="relative flex-1 min-h-0">
        <SmartImage
          key={current.src}
          src={current.src}
          alt={current.alt}
          sizes="100vw"
          className="object-contain"
          quality={85}
        />
        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className={`${nav} absolute left-3 top-1/2 -translate-y-1/2 sm:left-6`}
              aria-label="Previous image"
            >
              <ArrowLeftIcon />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className={`${nav} absolute right-3 top-1/2 -translate-y-1/2 sm:right-6`}
              aria-label="Next image"
            >
              <ArrowRightIcon />
            </button>
          </>
        ) : null}
      </div>
      <div className="min-h-14 px-4 py-4 text-center text-sm text-ivory-100/80 sm:px-6">
        {current.caption ?? current.alt}
      </div>
    </div>
  );
}
