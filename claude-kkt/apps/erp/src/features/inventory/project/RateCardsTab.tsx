import { CheckCircle2, Copy, MoreHorizontal, Pencil, Plus, Tags, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { PLC_APPLIES_TO_LABELS, PLC_CALC_MODE_LABELS, RATE_CARD_STATUS_LABELS, type ProjectRow, type RateCardApplyResponse, type RateCardRow } from "@kkt/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, ErrorState, IconButton, Skeleton, StatusChip } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatINR, formatNumber, formatPercent } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { RateCardFormSheet } from "../RateCardFormSheet";
import { BLOCKS_PATH, FLATS_PATH, inventoryKeys, PROJECTS_PATH, RATE_CARDS_PATH, useRateCards } from "../api";
import { Notice } from "../components";

export interface RateCardsTabProps {
  project: ProjectRow;
  /** Restrict "Apply" to one block (block detail → Pricing tab). */
  blockId?: string;
}

interface ApplyState {
  card: RateCardRow;
  preview: RateCardApplyResponse | null;
  loading: boolean;
}

export function RateCardsTab({ project, blockId }: RateCardsTabProps) {
  const { can } = useAuth();
  const canWrite = can("rate_card.write");
  const cards = useRateCards(project.id);
  const [sheet, setSheet] = useState<{ open: boolean; row: RateCardRow | null; clone: RateCardRow | null }>({ open: false, row: null, clone: null });
  const [activateTarget, setActivateTarget] = useState<RateCardRow | null>(null);
  const [apply, setApply] = useState<ApplyState | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const rank = { ACTIVE: 0, DRAFT: 1, SUPERSEDED: 2 } as const;
    return [...(cards.data ?? [])].sort((a, b) => rank[a.status] - rank[b.status] || b.effective_from.localeCompare(a.effective_from));
  }, [cards.data]);
  const active = sorted.find((card) => card.status === "ACTIVE") ?? null;

  const invalidate = [inventoryKeys.rateCards(project.id), [RATE_CARDS_PATH], [FLATS_PATH], [BLOCKS_PATH], [PROJECTS_PATH]];

  const activate = useMutationWithToast<RateCardRow, RateCardRow>({
    mutationFn: (card) => api.post<RateCardRow>(`${RATE_CARDS_PATH}/${card.id}/activate`, { version: card.version, apply_to_available_flats: true }, { version: card.version }),
    successMessage: (saved) => `"${saved.name}" is now the active rate card`,
    invalidate,
    entityLabel: "This rate card",
  });

  const applyMutation = useMutationWithToast<RateCardApplyResponse, RateCardRow>({
    mutationFn: (card) => api.post<RateCardApplyResponse>(`${RATE_CARDS_PATH}/${card.id}/apply`, { ...(blockId ? { block_id: blockId } : {}), dry_run: false }),
    successMessage: (result) => `${formatNumber(result.repriced)} available ${result.repriced === 1 ? "flat" : "flats"} re-priced`,
    invalidate,
    entityLabel: "This rate card",
  });

  const openApply = async (card: RateCardRow) => {
    setApply({ card, preview: null, loading: true });
    try {
      const preview = await api.post<RateCardApplyResponse>(`${RATE_CARDS_PATH}/${card.id}/apply`, { ...(blockId ? { block_id: blockId } : {}), dry_run: true });
      setApply({ card, preview, loading: false });
    } catch {
      setApply({ card, preview: null, loading: false });
    }
  };

  if (cards.isPending) return <Skeleton className="h-64 rounded-lg" />;
  if (cards.isError) return <ErrorState error={cards.error} onRetry={() => void cards.refetch()} className="rounded-lg border border-border bg-card" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-ink-muted">
          {active ? (
            <span>
              Active: <span className="font-semibold text-navy-950">{active.name}</span> · effective {formatDate(active.effective_from)}
            </span>
          ) : (
            <span>No active rate card — new flats use the flat-type base prices.</span>
          )}
        </div>
        {canWrite && (
          <Button leftIcon={Plus} onClick={() => setSheet({ open: true, row: null, clone: null })} data-testid="rate-card-new-btn">
            New rate card
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon={Tags} className="rounded-lg border border-border bg-card" title="No rate cards yet" description="Create a draft with rates per flat type, then activate it to price the inventory." action={canWrite ? <Button leftIcon={Plus} onClick={() => setSheet({ open: true, row: null, clone: null })}>New rate card</Button> : undefined} />
      ) : (
        <ul className="space-y-3">
          {sorted.map((card) => {
            const open = expanded === card.id;
            return (
              <li key={card.id}>
                <Card className={cn(card.status === "ACTIVE" && "border-gold-border")}>
                  <CardHeader
                    actions={
                      <>
                        {canWrite && card.status === "DRAFT" && (
                          <Button size="sm" variant="gold" leftIcon={CheckCircle2} onClick={() => setActivateTarget(card)} data-testid={`rate-card-activate-${card.id}`}>
                            Activate
                          </Button>
                        )}
                        {canWrite && card.status === "ACTIVE" && (
                          <Button size="sm" variant="outline" leftIcon={Zap} onClick={() => void openApply(card)} data-testid={`rate-card-apply-${card.id}`}>
                            Apply{blockId ? " to block" : ""}
                          </Button>
                        )}
                        {canWrite && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton icon={MoreHorizontal} label={`Actions for ${card.name}`} size="sm" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {card.status === "DRAFT" && (
                                <DropdownMenuItem onSelect={() => setSheet({ open: true, row: card, clone: null })}>
                                  <Pencil /> Edit draft
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => setSheet({ open: true, row: null, clone: card })}>
                                <Copy /> Duplicate as draft
                              </DropdownMenuItem>
                              {card.status === "DRAFT" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => setActivateTarget(card)}>
                                    <CheckCircle2 /> Activate
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </>
                    }
                  >
                    <button type="button" className="flex min-w-0 flex-wrap items-center gap-2 text-left focus-ring rounded-xs" onClick={() => setExpanded(open ? null : card.id)} aria-expanded={open}>
                      <CardTitle>{card.name}</CardTitle>
                      <StatusChip status={card.status} label={RATE_CARD_STATUS_LABELS[card.status]} size="sm" />
                    </button>
                    <p className="text-xs text-ink-subtle">
                      Effective {formatDate(card.effective_from)} · {formatNumber(card.rates.length)} flat {card.rates.length === 1 ? "type" : "types"} · {formatNumber(card.plc_rules.length)} PLC {card.plc_rules.length === 1 ? "rule" : "rules"}
                      {card.activated_at && ` · activated ${formatDate(card.activated_at)}`}
                      {card.superseded_at && ` · superseded ${formatDate(card.superseded_at)}`}
                    </p>
                  </CardHeader>
                  {(open || card.status === "ACTIVE") && (
                    <CardContent className="grid gap-4 p-0 lg:grid-cols-2">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[20rem] text-sm">
                          <thead>
                            <tr className="text-left text-2xs uppercase tracking-wide text-ink-subtle">
                              <th className="px-4 py-2 font-semibold">Flat type</th>
                              <th className="px-4 py-2 text-right font-semibold">Rate / sq ft</th>
                              <th className="px-4 py-2 text-right font-semibold">Lump sum</th>
                            </tr>
                          </thead>
                          <tbody>
                            {card.rates.map((rate) => (
                              <tr key={rate.flat_type_id} className="border-t border-border">
                                <td className="px-4 py-1.5">
                                  <span className="font-mono text-xs text-navy-950">{rate.flat_type_code}</span> <span className="text-ink-muted">{rate.flat_type_name}</span>
                                </td>
                                <td className="money px-4 py-1.5 text-right">{rate.rate_per_sqft_paise !== null ? formatINR(rate.rate_per_sqft_paise) : "—"}</td>
                                <td className="money px-4 py-1.5 text-right">{rate.lump_sum_paise !== null ? formatINR(rate.lump_sum_paise) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="border-t border-border px-4 py-3 lg:border-l lg:border-t-0">
                        <p className="label-caps mb-2">PLC rules</p>
                        {card.plc_rules.length === 0 ? (
                          <p className="text-xs text-ink-subtle">None</p>
                        ) : (
                          <ul className="space-y-1.5 text-sm">
                            {[...card.plc_rules]
                              .sort((a, b) => a.sort_order - b.sort_order)
                              .map((rule, index) => (
                                <li key={`${rule.plc_type_id}-${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span className="font-medium text-ink">{rule.plc_type_name}</span>
                                  <Badge variant="outline">{PLC_CALC_MODE_LABELS[rule.calc_mode]}</Badge>
                                  <span className="money text-navy-950">{rule.calc_mode === "PERCENT" ? formatPercent(rule.value) : formatINR(rule.value)}</span>
                                  <span className="text-xs text-ink-subtle">
                                    {PLC_APPLIES_TO_LABELS[rule.applies_to]}
                                    {rule.applies_to === "FLOORS_GTE" && rule.floors_gte !== null && ` ${rule.floors_gte}`}
                                    {rule.applies_to === "FACING_IN" && rule.facings && `: ${rule.facings.join(", ")}`}
                                  </span>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <RateCardFormSheet projectId={project.id} open={sheet.open} onOpenChange={(open) => setSheet((state) => ({ ...state, open }))} rateCard={sheet.row} cloneFrom={sheet.clone} />

      <ConfirmDialog
        open={activateTarget !== null}
        onOpenChange={(open) => !open && setActivateTarget(null)}
        title="Activate this rate card?"
        description={activateTarget ? `"${activateTarget.name}" becomes the only Active card for ${project.name}${active ? ` and supersedes "${active.name}"` : ""}. Available flats are re-priced; Hold, Booked and Sold flats keep their price.` : undefined}
        confirmLabel="Activate"
        onConfirm={async () => {
          if (activateTarget) await activate.mutateAsync(activateTarget);
        }}
      />

      <ConfirmDialog
        open={apply !== null}
        onOpenChange={(open) => !open && setApply(null)}
        title={blockId ? "Apply rate card to this block?" : "Apply rate card to the project?"}
        description={apply ? `Re-prices Available flats with "${apply.card.name}". Flats on Hold, Booked or Sold are never touched.` : undefined}
        confirmLabel={apply?.preview ? `Re-price ${formatNumber(apply.preview.repriced)} flats` : "Apply"}
        onConfirm={async () => {
          if (apply) await applyMutation.mutateAsync(apply.card);
        }}
      >
        {apply?.loading && <Skeleton className="h-10" />}
        {apply?.preview && (
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-success-bg p-2">
              <dt className="label-caps">Will re-price</dt>
              <dd className="money text-lg font-bold text-success-fg">{formatNumber(apply.preview.repriced)}</dd>
            </div>
            <div className="rounded-md bg-surface p-2">
              <dt className="label-caps">Not available</dt>
              <dd className="money text-lg font-bold text-ink">{formatNumber(apply.preview.skipped_not_available)}</dd>
            </div>
            <div className="rounded-md bg-warning-bg p-2">
              <dt className="label-caps">No rate</dt>
              <dd className="money text-lg font-bold text-warning-fg">{formatNumber(apply.preview.skipped_no_rate)}</dd>
            </div>
          </dl>
        )}
        {apply && !apply.loading && !apply.preview && <Notice tone="warning">Could not preview the count; applying will still only touch Available flats.</Notice>}
      </ConfirmDialog>
    </div>
  );
}
