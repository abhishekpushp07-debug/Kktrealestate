"use client";

import { useRef, type ReactNode } from "react";

import { CloseIcon } from "@/components/ui/icons";
import { useFocusTrap, useIsClient, useLockBodyScroll } from "@/components/ui/hooks";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** "center" dialog on all sizes; "sheet" is a bottom sheet on phones, centred dialog on desktop. */
  variant?: "center" | "sheet";
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-3xl" };

export function Modal({ open, onClose, title, description, children, variant = "sheet", size = "md" }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useIsClient();
  useFocusTrap(ref, open && mounted, onClose);
  useLockBodyScroll(open);

  if (!open || !mounted) return null;
  const titleId = `modal-title-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-navy-950/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full flex-col bg-ivory-50 text-ink shadow-float animate-fade-up outline-none ${
          variant === "sheet" ? "rounded-t-3xl sm:rounded-3xl" : "rounded-3xl m-4"
        } ${SIZES[size]}`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 sm:px-8 sm:pt-8">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-display-sm text-navy-900">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap -mr-2 -mt-2 inline-flex shrink-0 items-center justify-center rounded-full text-navy-900 hover:bg-navy-900/5"
            aria-label="Close dialog"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-8 pt-5 sm:px-8">{children}</div>
      </div>
    </div>
  );
}
