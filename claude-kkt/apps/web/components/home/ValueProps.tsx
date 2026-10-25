import { Section, SectionHeading } from "@/components/ui/Section";
import { Reveal } from "@/components/ui/Reveal";
import { HomeIcon, ShieldIcon, SparkleIcon, CheckIcon } from "@/components/ui/icons";
import type { ValueProp } from "@/lib/types";

const ICONS = [ShieldIcon, SparkleIcon, HomeIcon, CheckIcon];

const DEFAULTS: ValueProp[] = [
  { title: "RERA-registered, always", body: "Every project is registered and every approval is on record, so you buy with clarity.", icon: null },
  { title: "Craft in every detail", body: "Considered layouts, premium specifications and finishes selected to last.", icon: null },
  { title: "On time, as promised", body: "Construction-linked transparency with stage photos you can follow from your phone.", icon: null },
  { title: "Relationship, not transaction", body: "A dedicated manager from the first visit to the day you receive your keys.", icon: null },
];

export function ValueProps({ items }: { items: ValueProp[] }) {
  const props = items.length ? items : DEFAULTS;
  return (
    <Section tone="white">
      <SectionHeading eyebrow="Why choose us" title="Built on trust, finished with care" align="center" />
      <ul className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {props.slice(0, 4).map((item, i) => {
          const Icon = ICONS[i % ICONS.length] ?? CheckIcon;
          return (
            <Reveal key={item.title} as="li" delay={i * 90} className="rounded-card border border-line bg-ivory-50 p-7">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-900 text-gold-300">
                <Icon size={22} />
              </span>
              <h3 className="mt-6 font-display text-2xl text-navy-900">{item.title}</h3>
              {item.body ? <p className="mt-3 leading-7 text-ink-muted">{item.body}</p> : null}
            </Reveal>
          );
        })}
      </ul>
    </Section>
  );
}
