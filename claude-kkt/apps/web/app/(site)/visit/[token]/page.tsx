import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { ManageVisit } from "@/components/visit/ManageVisit";
import { getVisit } from "@/lib/api";
import { siteGate } from "@/lib/gate";

type Params = Promise<{ token: string }>;

export const metadata: Metadata = {
  title: "Your site visit",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function VisitPage({ params }: { params: Params }) {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const { token } = await params;
  const visit = await getVisit(token);
  return (
    <>
      <PageHeader eyebrow="Manage your visit" title="Your private site visit" lead="Add it to your calendar, find the site office, or cancel if your plans change." compact />
      <div className="container-site py-12 sm:py-16">
        <div className="mx-auto max-w-2xl">
          <ManageVisit visit={visit} token={token} />
          <div className="mt-8 text-center">
            <Button href={visit.project_slug ? `/projects/${visit.project_slug}` : "/projects"} variant="link">
              {visit.project_slug ? `About ${visit.project_name}` : "Explore our projects"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
