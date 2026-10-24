import { Reveal } from "@/components/ui/Reveal";
import type { TrustStat } from "@/lib/types";

export function TrustStrip({ stats }: { stats: TrustStat[] }) {
  if (!stats.length) return null;
  return (
    <div className="border-y border-gold-500/20 bg-navy-900 text-ivory-100">
      <dl className="container-site grid grid-cols-2 gap-x-6 gap-y-8 py-10 sm:grid-cols-4 lg:py-12">
        {stats.slice(0, 4).map((stat, i) => (
          <Reveal key={stat.label} delay={i * 80} className="text-center sm:text-left">
            <dd className="font-display text-4xl text-gold-300 sm:text-5xl">{stat.value}</dd>
            <dt className="mt-2 text-xs uppercase tracking-[0.2em] text-ivory-100/70">{stat.label}</dt>
          </Reveal>
        ))}
      </dl>
    </div>
  );
}
