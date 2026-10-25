import { Globe, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from "@kkt/contracts";
import { Badge, Button, ErrorState, PageSkeleton, ProgressRing, StatusChip, Tabs, TabsContent, TabsList, TabsTrigger, PageHeader } from "@/components/ui";
import { isApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import NotFoundPage from "@/pages/NotFoundPage";
import { ProjectFormSheet } from "./ProjectFormSheet";
import { useProject, useProjectBlocks } from "./api";
import { UnitCountsBar, useTabParam } from "./components";
import { BlocksTab } from "./project/BlocksTab";
import { ConstructionTab } from "./project/ConstructionTab";
import { OverviewTab } from "./project/OverviewTab";
import { ParkingTab } from "./project/ParkingTab";
import { RateCardsTab } from "./project/RateCardsTab";
import { VisitSettingsTab } from "./project/VisitSettingsTab";
import { WebsiteTab } from "./project/WebsiteTab";

const TABS = ["overview", "blocks", "parking", "rate-cards", "construction", "website", "visits"] as const;
type Tab = (typeof TABS)[number];

/** `/projects/:id` — facts, towers, parking, rate cards, construction, website and site-visit settings. */
export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const project = useProject(id);
  // Children load only once the project itself resolved: an out-of-scope / unknown project is a single 404, not a cascade.
  const blocks = useProjectBlocks(id, { enabled: project.isSuccess });
  const [tab, setTab] = useTabParam<Tab>(TABS, "overview");
  const [editOpen, setEditOpen] = useState(false);

  if (project.isPending) return <PageSkeleton />;
  if (project.isError) {
    if (isApiClientError(project.error) && project.error.status === 404) return <NotFoundPage />;
    return <ErrorState error={project.error} onRetry={() => void project.refetch()} className="rounded-lg border border-border bg-card" />;
  }
  const row = project.data;
  const canEdit = can("project.write");
  const canBlock = can("block.write");
  const canCms = can("cms.write") || can("cms.read");

  return (
    <>
      <PageHeader
        title={row.name}
        titleAddon={
          <>
            <StatusChip status={row.status} label={PROJECT_STATUS_LABELS[row.status]} />
            {row.is_published && (
              <Badge variant="success">
                <Globe className="size-3" aria-hidden="true" /> Live
              </Badge>
            )}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="font-mono">{row.code}</span>
            <span>{PROJECT_TYPE_LABELS[row.project_type]}</span>
            <span>{row.city}</span>
            {row.rera_number && <span>RERA {row.rera_number}</span>}
          </span>
        }
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Projects", to: "/projects" }, { label: row.name }]}
        backTo="/projects"
        actions={
          <>
            {canEdit && (
              <Button variant="outline" leftIcon={Pencil} onClick={() => setEditOpen(true)} data-testid="project-edit-btn">
                Edit
              </Button>
            )}
            {canBlock && (
              <Button asChild leftIcon={Plus} data-testid="project-new-block-btn">
                <Link to={`/projects/${row.id}/blocks/new`}>
                  <Plus aria-hidden="true" /> New block
                </Link>
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-card sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-center gap-3">
            <ProgressRing value={row.construction_percent} size={56} strokeWidth={5} tone="gold" aria-label="Construction progress" />
            <div className="leading-tight">
              <p className="label-caps">Construction</p>
              <p className="money text-sm font-semibold text-navy-950">{Math.round(row.construction_percent)}% complete</p>
              <p className="text-xs text-ink-subtle">
                {formatNumber(row.block_count)} {row.block_count === 1 ? "block" : "blocks"} · {formatNumber(row.unit_counts.total)} units
              </p>
            </div>
          </div>
          <UnitCountsBar counts={row.unit_counts} />
        </div>
      </PageHeader>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList aria-label="Project sections">
          <TabsTrigger value="overview" data-testid="project-tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="blocks" count={blocks.data?.length} data-testid="project-tab-blocks">
            Blocks
          </TabsTrigger>
          <TabsTrigger value="parking" data-testid="project-tab-parking">
            Parking
          </TabsTrigger>
          <TabsTrigger value="rate-cards" data-testid="project-tab-rate-cards">
            Rate cards
          </TabsTrigger>
          <TabsTrigger value="construction" data-testid="project-tab-construction">
            Construction
          </TabsTrigger>
          {canCms && (
            <TabsTrigger value="website" data-testid="project-tab-website">
              Website
            </TabsTrigger>
          )}
          <TabsTrigger value="visits" data-testid="project-tab-visits">
            Site visits
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab project={row} onEdit={canEdit ? () => setEditOpen(true) : undefined} />
        </TabsContent>
        <TabsContent value="blocks">
          <BlocksTab project={row} blocks={blocks} />
        </TabsContent>
        <TabsContent value="parking">
          <ParkingTab project={row} />
        </TabsContent>
        <TabsContent value="rate-cards">
          <RateCardsTab project={row} />
        </TabsContent>
        <TabsContent value="construction">
          <ConstructionTab project={row} blocks={blocks} />
        </TabsContent>
        {canCms && (
          <TabsContent value="website">
            <WebsiteTab project={row} />
          </TabsContent>
        )}
        <TabsContent value="visits">
          <VisitSettingsTab project={row} />
        </TabsContent>
      </Tabs>

      <ProjectFormSheet open={editOpen} onOpenChange={setEditOpen} project={row} />
    </>
  );
}
