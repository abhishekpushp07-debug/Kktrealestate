import type { Metadata } from "next";

import { SiteShell } from "@/components/layout/SiteShell";
import { Button } from "@/components/ui/Button";
import { ArrowRightIcon } from "@/components/ui/icons";
import { getSiteSettings } from "@/lib/api";
import { ComingSoon } from "@/components/layout/ComingSoon";
import { isClosed } from "@/lib/gate";
import { brandName } from "@/lib/seo";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default async function NotFound() {
  const site = await getSiteSettings();
  if (isClosed(site)) return <ComingSoon site={site} brandName={brandName(site)} />;
  return (
    <SiteShell site={site}>
      <div className="relative overflow-hidden bg-navy-900 text-ivory-100">
        <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 80% 10%, rgb(201 162 39 / 0.18), transparent 50%)" }} />
        <div className="container-site relative flex min-h-[80vh] flex-col items-start justify-center py-32">
          <p className="eyebrow text-gold-300">404</p>
          <h1 className="mt-4 max-w-2xl font-display text-display-lg">This address does not exist.</h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-ivory-100/75">The page may have moved, or the project you are looking for is no longer listed. Our current residences are a click away.</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button href="/projects">
              Explore projects <ArrowRightIcon size={18} />
            </Button>
            <Button href="/" variant="outline-light">
              Back to home
            </Button>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
