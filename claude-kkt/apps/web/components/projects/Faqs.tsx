import { ChevronDownIcon } from "@/components/ui/icons";
import type { Faq } from "@/lib/types";

/** Native <details> accordion: accessible with zero JS. */
export function Faqs({ items }: { items: Faq[] }) {
  if (!items.length) return null;
  return (
    <div className="divide-y divide-line rounded-card border border-line bg-white">
      {items.map((faq, i) => (
        <details key={`${faq.q}-${i}`} className="group px-5 sm:px-7" {...(i === 0 ? { open: true } : {})}>
          <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 py-4 text-left font-semibold text-navy-900 marker:content-none [&::-webkit-details-marker]:hidden">
            <span>{faq.q}</span>
            <ChevronDownIcon className="shrink-0 text-gold-600 transition duration-300 group-open:rotate-180" />
          </summary>
          <p className="pb-6 leading-7 text-ink-muted">{faq.a}</p>
        </details>
      ))}
    </div>
  );
}
