import { EnquiryForm, type FlatTypeOption } from "@/components/forms/EnquiryForm";
import { BrochureButton } from "@/components/forms/BrochureGate";
import { Button } from "@/components/ui/Button";
import { CalendarIcon, PhoneIcon } from "@/components/ui/icons";
import { formatINRShort, telHref } from "@/lib/format";

interface StickyEnquiryCardProps {
  projectSlug: string;
  projectName: string;
  startingPricePaise: number | null;
  showPrices: boolean;
  brochureAvailable: boolean;
  visitBookingEnabled: boolean;
  flatTypes: FlatTypeOption[];
  phone: string | null;
}

/** Desktop sidebar card: sticks under the navbar while the visitor scrolls the project story. */
export function StickyEnquiryCard({
  projectSlug,
  projectName,
  startingPricePaise,
  showPrices,
  brochureAvailable,
  visitBookingEnabled,
  flatTypes,
  phone,
}: StickyEnquiryCardProps) {
  const tel = telHref(phone);
  return (
    <aside className="lg:sticky lg:top-24" aria-label="Enquire about this project">
      <div className="rounded-card border border-line bg-white p-6 shadow-card sm:p-7">
        {showPrices && startingPricePaise !== null ? (
          <p className="mb-5">
            <span className="block text-xs uppercase tracking-widest text-ink-soft">Starting from</span>
            <span className="font-display text-4xl text-navy-900">{formatINRShort(startingPricePaise)}</span>
            <span className="ml-1 text-xs text-ink-soft">+ taxes</span>
          </p>
        ) : (
          <p className="mb-5">
            <span className="block text-xs uppercase tracking-widest text-ink-soft">Pricing</span>
            <span className="font-display text-2xl text-navy-900">Price on request</span>
          </p>
        )}
        <EnquiryForm
          projects={[{ slug: projectSlug, name: projectName }]}
          defaultProjectSlug={projectSlug}
          flatTypes={flatTypes}
          compact
        />
        <div className="mt-5 grid gap-2">
          {visitBookingEnabled ? (
            <Button href="#visit" variant="outline" className="w-full">
              <CalendarIcon size={18} /> Book a private site visit
            </Button>
          ) : null}
          {brochureAvailable ? (
            <BrochureButton projectSlug={projectSlug} projectName={projectName} variant="outline" className="w-full" />
          ) : null}
          {tel ? (
            <Button href={tel} variant="ghost" className="w-full">
              <PhoneIcon size={18} /> {phone}
            </Button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
