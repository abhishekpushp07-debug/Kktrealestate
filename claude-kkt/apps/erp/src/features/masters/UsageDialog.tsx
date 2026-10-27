import { useQuery } from "@tanstack/react-query";
import { Link2, ShieldAlert } from "lucide-react";
import type { MasterRow } from "@kkt/contracts";
import { Button, EmptyState, ErrorState, SimpleDialog, Skeleton } from "@/components/ui";
import { api, type ApiClientError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { humanize } from "@/lib/utils";
import { usageFromDetails, type UsageBreakdown } from "@/features/shared/errors";
import { masterPath } from "./api";
import type { AnyMasterConfig } from "./types";

export interface UsageDialogProps {
  config: AnyMasterConfig;
  row: MasterRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Breakdown already known (from a 409 IN_USE); skips the GET. */
  preset?: UsageBreakdown | null;
  /** When set, the dialog explains that the deactivate was refused. */
  blocked?: boolean;
}

/** Where a master record is referenced (`GET /masters/{kind}/:id/usage`) or why it could not be deactivated. */
export function UsageDialog({ config, row, open, onOpenChange, preset = null, blocked = false }: UsageDialogProps) {
  const query = useQuery<unknown, ApiClientError, UsageBreakdown | null>({
    queryKey: [masterPath(config.slug), "usage", row?.id ?? ""],
    queryFn: ({ signal }) => api.get<unknown>(`${masterPath(config.slug)}/${row?.id}/usage`, { signal }),
    select: usageFromDetails,
    enabled: open && row !== null && preset === null,
  });
  const usage = preset ?? query.data ?? null;

  return (
    <SimpleDialog
      open={open}
      onOpenChange={onOpenChange}
      title={blocked ? "Cannot deactivate — in use" : "Where it is used"}
      description={row ? config.displayName(row) : undefined}
      size="sm"
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="usage-dialog-close-btn">
          Close
        </Button>
      }
    >
      {blocked && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-status-hold-border bg-warning-bg px-3 py-2 text-sm text-warning-fg">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Master records that are referenced anywhere stay active; remove the references first or keep the record.
        </p>
      )}
      {preset === null && query.isPending && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}
      {preset === null && query.isError && (
        <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
      )}
      {usage && usage.usage_count === 0 && (
        <EmptyState
          compact
          icon={Link2}
          title="Not referenced anywhere"
          description={`This ${config.singular.toLowerCase()} can be deactivated safely.`}
        />
      )}
      {usage && usage.usage_count > 0 && (
        <div className="space-y-3">
          <p className="money font-display text-3xl font-extrabold text-navy-950">
            {formatNumber(usage.usage_count)}{" "}
            <span className="text-base font-semibold text-ink-muted">
              reference{usage.usage_count === 1 ? "" : "s"}
            </span>
          </p>
          {usage.used_by.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {usage.used_by.map((entry) => (
                <li key={entry.entity_type} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-ink">{humanize(entry.entity_type)}</span>
                  <span className="money font-semibold text-navy-950">{formatNumber(entry.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SimpleDialog>
  );
}
