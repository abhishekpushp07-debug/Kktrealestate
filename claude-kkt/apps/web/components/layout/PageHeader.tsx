import type { ReactNode } from "react";

import { SmartImage } from "@/components/ui/SmartImage";

interface PageHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  image?: string | null;
  children?: ReactNode;
  compact?: boolean;
}

/** Navy editorial header under the glass navbar; every page opens with one so the nav always reads. */
export function PageHeader({ eyebrow, title, lead, image, children, compact = false }: PageHeaderProps) {
  return (
    <div className={`relative overflow-hidden bg-navy-900 text-ivory-100 ${compact ? "pt-32 pb-14 sm:pt-36 sm:pb-16" : "pt-36 pb-20 sm:pt-44 sm:pb-28"}`}>
      {image ? (
        <>
          <SmartImage src={image} alt="" sizes="100vw" priority className="opacity-40" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-navy-950/60 via-navy-900/70 to-navy-900" />
        </>
      ) : (
        <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 15% 0%, rgb(201 162 39 / 0.16), transparent 50%), radial-gradient(ellipse at 90% 100%, rgb(47 71 122 / 0.55), transparent 55%)" }} />
      )}
      <div className="container-site relative">
        {eyebrow ? <p className="eyebrow text-gold-300">{eyebrow}</p> : null}
        <h1 className="mt-4 max-w-4xl font-display text-display-lg">{title}</h1>
        {lead ? <p className="mt-6 max-w-2xl text-lg leading-8 text-ivory-100/75">{lead}</p> : null}
        {children}
      </div>
    </div>
  );
}
