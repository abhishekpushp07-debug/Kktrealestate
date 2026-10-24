"use client";

import { useState } from "react";

import { Lightbox } from "@/components/ui/Lightbox";
import { SmartImage } from "@/components/ui/SmartImage";
import { formatINR, formatINRShort, formatNumber, formatSqft } from "@/lib/format";
import type { Configuration } from "@/lib/types";

function bhk(c: Configuration): string {
  return c.bhk ? `${Number.isInteger(c.bhk) ? c.bhk : c.bhk.toFixed(1)} BHK` : c.name;
}

/** Configurations with room sizes, areas and specs; a tab strip on desktop, stacked on phones. */
export function Configurations({ items, showPrices }: { items: Configuration[]; showPrices: boolean }) {
  const [active, setActive] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);
  const current = items[active];
  if (!current) return null;

  return (
    <div>
      <div role="tablist" aria-label="Configurations" className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {items.map((c, i) => (
          <button
            key={c.code}
            type="button"
            role="tab"
            id={`config-tab-${c.code}`}
            aria-selected={i === active}
            aria-controls={`config-panel-${c.code}`}
            onClick={() => setActive(i)}
            className={`tap shrink-0 rounded-full border px-5 text-sm font-semibold transition ${
              i === active ? "border-navy-900 bg-navy-900 text-ivory-100" : "border-navy-900/15 bg-white text-navy-900 hover:border-gold-500"
            }`}
          >
            {bhk(c)}
            {c.name && c.bhk ? <span className="ml-1 font-normal opacity-70">· {c.name}</span> : null}
          </button>
        ))}
      </div>

      <div id={`config-panel-${current.code}`} role="tabpanel" aria-labelledby={`config-tab-${current.code}`} className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-display-sm text-navy-900">{current.name}</h3>
            {showPrices && typeof current.price_paise === "number" ? (
              <p className="text-right">
                <span className="block text-xs uppercase tracking-widest text-ink-soft">From</span>
                <span className="font-display text-3xl text-gold-700" title={formatINR(current.price_paise)}>
                  {formatINRShort(current.price_paise)}
                </span>
              </p>
            ) : null}
          </div>
          {current.facing ? <p className="mt-1 text-sm text-ink-muted">{current.facing} facing</p> : null}
          {current.description ? <p className="mt-4 leading-7 text-ink-muted">{current.description}</p> : null}

          <dl className="mt-6 grid grid-cols-3 gap-3">
            {[
              ["Carpet", current.carpet_sqft],
              ["Built-up", current.builtup_sqft],
              ["Super built-up", current.super_builtup_sqft],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-line bg-white p-4">
                <dt className="text-xs uppercase tracking-wider text-ink-soft">{label}</dt>
                <dd className="mt-1 font-semibold text-navy-900">{typeof value === "number" ? formatSqft(value) : "—"}</dd>
              </div>
            ))}
          </dl>

          {current.rooms.length ? (
            <div className="mt-8 overflow-hidden rounded-card border border-line bg-white">
              <table className="w-full text-sm">
                <caption className="sr-only">Room sizes for {current.name}</caption>
                <thead className="bg-ivory-100 text-left text-xs uppercase tracking-wider text-ink-soft">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Room</th>
                    <th scope="col" className="px-4 py-3 font-medium">Size (ft)</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Area</th>
                  </tr>
                </thead>
                <tbody>
                  {current.rooms.map((room, i) => (
                    <tr key={`${room.label}-${i}`} className="border-t border-line">
                      <td className="px-4 py-3 font-medium text-navy-900">{room.label}</td>
                      <td className="px-4 py-3 text-ink-muted">{room.length_ft && room.width_ft ? `${formatNumber(room.length_ft, 1)} × ${formatNumber(room.width_ft, 1)}` : "—"}</td>
                      <td className="px-4 py-3 text-right text-ink-muted">{room.sqft ? formatSqft(room.sqft) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {current.areas.length > 3 ? (
            <ul className="mt-4 flex flex-wrap gap-2 text-sm text-ink-muted">
              {current.areas.map((a) => (
                <li key={a.area_type_code} className="rounded-full bg-ivory-200 px-3 py-1">
                  {a.area_type_name}: {formatSqft(a.sqft)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div>
          {current.floor_plan_image_url ? (
            <button type="button" onClick={() => setPlanOpen(true)} className="group relative block aspect-[4/3] w-full overflow-hidden rounded-card border border-line bg-white" aria-label={`Enlarge floor plan for ${current.name}`}>
              <SmartImage src={current.floor_plan_image_url} alt={`Floor plan for ${current.name}`} sizes="(min-width: 1024px) 45vw, 100vw" className="object-contain p-4 transition duration-500 group-hover:scale-[1.02]" />
              <span className="absolute bottom-3 right-3 rounded-full bg-navy-900/85 px-3 py-1 text-xs text-ivory-100">Tap to enlarge</span>
            </button>
          ) : null}
          {current.specifications.length ? (
            <div className={current.floor_plan_image_url ? "mt-6" : ""}>
              <h4 className="font-display text-xl text-navy-900">Specifications</h4>
              <dl className="mt-3 divide-y divide-line rounded-card border border-line bg-white">
                {current.specifications.map((group) => (
                  <div key={group.category} className="grid gap-1 px-5 py-4 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-xs uppercase tracking-wider text-ink-soft sm:pt-1">{group.category}</dt>
                    <dd className="text-sm leading-6 text-ink">{group.items.join(" · ")}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </div>
      {current.floor_plan_image_url ? (
        <Lightbox images={[{ src: current.floor_plan_image_url, alt: `Floor plan for ${current.name}` }]} index={planOpen ? 0 : null} onClose={() => setPlanOpen(false)} onIndexChange={() => undefined} />
      ) : null}
    </div>
  );
}
