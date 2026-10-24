import type { ReactNode } from "react";

interface SectionProps {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: "ivory" | "white" | "navy";
  padded?: boolean;
  wide?: boolean;
}

const TONES = {
  ivory: "bg-ivory-100 text-ink",
  white: "bg-white text-ink",
  navy: "bg-navy-900 text-ivory-100",
};

export function Section({ id, children, className = "", tone = "ivory", padded = true, wide = false }: SectionProps) {
  return (
    <section id={id} className={`${TONES[tone]} ${padded ? "py-16 sm:py-20 lg:py-28" : ""} ${className}`.trim()}>
      <div className={wide ? "container-wide" : "container-site"}>{children}</div>
    </section>
  );
}

interface HeadingProps {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
  light?: boolean;
  as?: "h1" | "h2" | "h3";
  className?: string;
}

export function SectionHeading({ eyebrow, title, lead, align = "left", light = false, as = "h2", className = "" }: HeadingProps) {
  const Tag = as;
  return (
    <div className={`max-w-3xl ${align === "center" ? "mx-auto text-center" : ""} ${className}`.trim()}>
      {eyebrow ? <p className={`eyebrow mb-4 ${light ? "text-gold-300" : "text-gold-600"}`}>{eyebrow}</p> : null}
      <Tag className={`font-display text-display-md ${light ? "text-ivory-100" : "text-navy-900"}`}>{title}</Tag>
      {lead ? <p className={`mt-5 text-lg leading-8 ${light ? "text-ivory-100/75" : "text-ink-muted"}`}>{lead}</p> : null}
    </div>
  );
}

export function Eyebrow({ children, light = false, className = "" }: { children: ReactNode; light?: boolean; className?: string }) {
  return <p className={`eyebrow ${light ? "text-gold-300" : "text-gold-600"} ${className}`.trim()}>{children}</p>;
}

export function Badge({ children, tone = "gold", className = "" }: { children: ReactNode; tone?: "gold" | "navy" | "ivory" | "success"; className?: string }) {
  const tones = {
    gold: "bg-gold-500 text-navy-950",
    navy: "bg-navy-900 text-ivory-100",
    ivory: "bg-ivory-100/90 text-navy-900 backdrop-blur",
    success: "bg-success/10 text-success",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wider uppercase ${tones[tone]} ${className}`.trim()}>
      {children}
    </span>
  );
}
