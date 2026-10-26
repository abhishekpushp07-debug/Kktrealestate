import type { UseQueryResult } from "@tanstack/react-query";
import { HardHat } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { BlockRow, ProjectRow } from "@kkt/contracts";
import { EmptyState, ErrorState, ProgressRing, Skeleton } from "@/components/ui";
import type { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConstructionPanel } from "../ConstructionPanel";

export interface ConstructionTabProps {
  project: ProjectRow;
  blocks: UseQueryResult<BlockRow[], ApiClientError>;
}

/** Per-block construction status: block strip on the left, the selected block's stage timeline on the right. */
export function ConstructionTab({ project, blocks }: ConstructionTabProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const rows = blocks.data ?? [];
  // Until the user picks a block, the first one is shown (derived; no effect needed).
  const current = rows.find((block) => block.id === selected) ?? rows[0] ?? null;

  if (blocks.isPending) return <Skeleton className="h-72 rounded-lg" />;
  if (blocks.isError)
    return (
      <ErrorState
        error={blocks.error}
        onRetry={() => void blocks.refetch()}
        className="rounded-lg border border-border bg-card"
      />
    );
  if (rows.length === 0)
    return (
      <EmptyState
        icon={HardHat}
        className="rounded-lg border border-border bg-card"
        title="No blocks yet"
        description={`Add a block to ${project.name} to track its construction stages.`}
      />
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <ul className="flex gap-2 overflow-x-auto scrollbar-thin lg:flex-col lg:overflow-visible" aria-label="Blocks">
        {rows.map((block) => {
          const active = current?.id === block.id;
          return (
            <li key={block.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(block.id)}
                className={cn(
                  "flex w-56 items-center gap-3 rounded-lg border bg-card p-3 text-left shadow-card transition-colors focus-ring lg:w-full",
                  active ? "border-gold ring-1 ring-gold/40" : "border-border hover:border-navy-300",
                )}
                data-testid={`construction-block-${block.id}`}
              >
                <ProgressRing
                  value={block.construction_percent}
                  size={40}
                  strokeWidth={4}
                  tone="gold"
                  aria-label={`${block.name} progress`}
                />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-sm font-semibold text-navy-950">{block.name}</span>
                  <span className="block truncate text-2xs text-ink-subtle">
                    {block.current_stage_name ?? "Not started"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-w-0 space-y-3">
        {current && (
          <>
            <p className="text-xs text-ink-subtle">
              Showing <span className="font-semibold text-ink">{current.name}</span> ·{" "}
              <Link
                to={`/blocks/${current.id}?tab=construction`}
                className="text-navy-700 underline underline-offset-2 hover:text-navy-950"
              >
                Open block
              </Link>
            </p>
            <ConstructionPanel key={current.id} blockId={current.id} />
          </>
        )}
      </div>
    </div>
  );
}
