import { Sparkles } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_GROUPS, findNavItem } from "@/lib/permissions";

export interface PlaceholderProps {
  title?: string;
  description?: string;
}

/** Stand-in page so every route resolves before its real screen is built. */
export default function Placeholder({ title, description }: PlaceholderProps) {
  const location = useLocation();
  const item = findNavItem(location.pathname);
  const group = item ? NAV_GROUPS.find((candidate) => candidate.items.includes(item)) : undefined;
  const heading = title ?? item?.label ?? "Page";
  const breadcrumbs = [{ label: "Home", to: "/" }, ...(group && group.id !== "overview" ? [{ label: group.label }] : []), { label: heading }];

  return (
    <>
      <PageHeader title={heading} description={description} breadcrumbs={breadcrumbs} />
      <Card>
        <EmptyState
          icon={Sparkles}
          title="Coming in the next build step"
          description={`The ${heading} screen is scaffolded and routed. Its data table, filters and forms arrive with the module that owns it.`}
        />
      </Card>
    </>
  );
}
