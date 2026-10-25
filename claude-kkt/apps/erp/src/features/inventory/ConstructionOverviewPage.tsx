import { HardHat, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BlockRow, ProjectRow } from "@kkt/contracts";
import { useQuery } from "@tanstack/react-query";
import { PROJECT_STATUS_LABELS } from "@kkt/contracts";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Input, PageHeader, ProgressRing, Select, Skeleton, StatusChip } from "@/components/ui";
import { api, type ApiClientError, type ListEnvelope } from "@/lib/api";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BLOCKS_PATH, PROJECTS_PATH } from "./api";

function useAllProjects() {
  return useQuery<ListEnvelope<ProjectRow>, ApiClientError, ProjectRow[], readonly unknown[]>({
    queryKey: [PROJECTS_PATH, "construction-overview"],
    queryFn: ({ signal }) => api.list<ProjectRow>(PROJECTS_PATH, { page_size: 200, sort: "name" }, { signal }),
    select: (data) => data.items,
    staleTime: 60_000,
  });
}

function useAllBlocks() {
  return useQuery<ListEnvelope<BlockRow>, ApiClientError, BlockRow[], readonly unknown[]>({
    queryKey: [BLOCKS_PATH, "construction-overview"],
    queryFn: ({ signal }) => api.list<BlockRow>(BLOCKS_PATH, { page_size: 200, sort: "sort_order" }, { signal }),
    select: (data) => data.items,
    staleTime: 60_000,
  });
}

function ringTone(percent: number): "navy" | "gold" | "success" {
  if (percent >= 100) return "success";
  if (percent >= 50) return "gold";
  return "navy";
}

/** `/construction` — every project as a card with its towers' progress rings and current stage; a tower opens its construction tab. */
export default function ConstructionOverviewPage() {
  const projects = useAllProjects();
  const blocks = useAllBlocks();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const byProject = new Map<string, BlockRow[]>();
    for (const block of blocks.data ?? []) {
      const list = byProject.get(block.project_id) ?? [];
      list.push(block);
      byProject.set(block.project_id, list);
    }
    const needle = query.trim().toLowerCase();
    return (projects.data ?? [])
      .filter((project) => (!status || project.status === status) && (!needle || project.name.toLowerCase().includes(needle) || project.code.toLowerCase().includes(needle)))
      .map((project) => ({ project, blocks: (byProject.get(project.id) ?? []).filter((block) => block.is_active) }));
  }, [projects.data, blocks.data, query, status]);

  const totals = useMemo(() => {
    const all = (blocks.data ?? []).filter((block) => block.is_active);
    const complete = all.filter((block) => block.construction_percent >= 100).length;
    const average = all.length ? all.reduce((sum, block) => sum + block.construction_percent, 0) / all.length : 0;
    return { towers: all.length, complete, average };
  }, [blocks.data]);

  if (projects.isPending || blocks.isPending) {
    return (
      <>
        <PageHeader title="Construction" breadcrumbs={[{ label: "Home", to: "/" }, { label: "Construction" }]} />
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-56 rounded-lg" />
          ))}
        </div>
      </>
    );
  }
  if (projects.isError) return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} className="rounded-lg border border-border bg-card" />;
  if (blocks.isError) return <ErrorState error={blocks.error} onRetry={() => void blocks.refetch()} className="rounded-lg border border-border bg-card" />;

  return (
    <>
      <PageHeader
        title="Construction"
        description={`${formatNumber(totals.towers)} towers · ${formatNumber(totals.complete)} complete · average ${formatPercent(totals.average, 0)} progress. Stage completion raises the linked installments.`}
        breadcrumbs={[{ label: "Home", to: "/" }, { label: "Construction" }]}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Input type="search" role="searchbox" aria-label="Search projects" placeholder="Search projects…" leftIcon={Search} value={query} onChange={(event) => setQuery(event.target.value)} data-testid="construction-search" />
          </div>
          <Select aria-label="Project status" size="md" className="w-full sm:w-48" value={status} onValueChange={setStatus} options={Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} placeholder="Any project status" allowClear data-testid="construction-filter-status" />
        </div>
      </PageHeader>

      {grouped.length === 0 ? (
        <EmptyState icon={HardHat} className="rounded-lg border border-border bg-card" title="No projects match" description="Adjust the search or status filter." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="construction-overview">
          {grouped.map(({ project, blocks: towers }) => (
            <Card key={project.id} className="min-w-0">
              <CardHeader actions={<StatusChip status={project.status} label={PROJECT_STATUS_LABELS[project.status]} size="sm" />}>
                <CardTitle className="flex items-center gap-3">
                  <ProgressRing value={project.construction_percent} size={44} strokeWidth={5} tone={ringTone(project.construction_percent)} aria-label={`${project.name} progress`} />
                  <span className="min-w-0">
                    <Link to={`/projects/${project.id}?tab=construction`} className="block truncate hover:underline focus-ring rounded-xs" data-testid={`construction-project-${project.id}`}>
                      {project.name}
                    </Link>
                    <span className="block text-xs font-normal text-ink-subtle">
                      {project.city} · {formatNumber(towers.length)} {towers.length === 1 ? "block" : "blocks"}
                      {project.possession_date && ` · possession ${formatDate(project.possession_date)}`}
                    </span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {towers.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-ink-subtle">No blocks yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {towers.map((block) => (
                      <li key={block.id}>
                        <Link to={`/blocks/${block.id}?tab=construction`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-navy-50/60 focus-ring" data-testid={`construction-block-${block.id}`}>
                          <ProgressRing value={block.construction_percent} size={40} strokeWidth={4} tone={ringTone(block.construction_percent)} aria-label={`${block.name} progress`} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-medium text-navy-950">{block.name}</span>
                              <span className="font-mono text-2xs text-ink-subtle">{block.code}</span>
                              <Badge variant="outline">{block.block_type_name}</Badge>
                            </span>
                            <span className={cn("block truncate text-xs", block.current_stage_name ? "text-ink-muted" : "text-ink-subtle")}>{block.current_stage_name ? `Current stage: ${block.current_stage_name}` : "Not started"}</span>
                          </span>
                          <span className="hidden shrink-0 text-right text-xs text-ink-muted sm:block">
                            <span className="money block font-semibold text-navy-950">{formatNumber(block.unit_counts.total)} units</span>
                            <span className="block">{formatNumber(block.floors)} floors</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
