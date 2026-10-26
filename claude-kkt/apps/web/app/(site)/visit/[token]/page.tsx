import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { ManageVisit } from "@/components/visit/ManageVisit";
import { getVisit, isApiError } from "@/lib/api";
import type { SiteVisitManage } from "@/lib/types";
import { siteGate } from "@/lib/gate";

type Params = Promise<{ token: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = {
  title: "Your site visit",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function VisitPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const gate = await siteGate();
  if (gate.closed) return gate.page;
  const { token } = await params;
  const moved = (await searchParams).moved === "1";
  let visit: SiteVisitManage;
  try {
    visit = await getVisit(token);
  } catch (error) {
    // 410 LINK_EXPIRED: the visit is over, was cancelled, or was rescheduled (which rotates the link). Unknown links still 404.
    if (isApiError(error) && error.status === 410) return <ExpiredVisitLink message={error.message} />;
    throw error;
  }
  return (
    <>
      <PageHeader
        eyebrow="Manage your visit"
        title="Your private site visit"
        lead="Add it to your calendar, find the site office, or cancel if your plans change."
        compact
      />
      <div className="container-site py-12 sm:py-16">
        <div className="mx-auto max-w-2xl">
          <ManageVisit visit={visit} token={token} justMoved={moved} />
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

function ExpiredVisitLink({ message }: { message: string }) {
  return (
    <>
      <PageHeader eyebrow="Manage your visit" title="This visit link has expired" lead={message} compact />
      <div className="container-site py-12 sm:py-16">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center" role="status">
          <p className="text-ink-muted">
            Links stop working once a visit is over, cancelled or rescheduled. Use the link in your latest confirmation,
            or book a new visit.
          </p>
          <Button href="/contact#visit">Book a site visit</Button>
          <Button href="/projects" variant="link">
            Explore our projects
          </Button>
        </div>
      </div>
    </>
  );
}
