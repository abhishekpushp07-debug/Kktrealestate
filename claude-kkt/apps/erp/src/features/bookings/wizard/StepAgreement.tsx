import { Lock, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button, FieldWrapper, FormRow, MoneyInput, PercentInput, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { formatINR, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFlatDetail } from "@/features/inventory/api";
import { Notice } from "@/features/inventory/components";
import { rebalanceSplitForTotal, splitFromAccount, splitFromAccountPercent, splitFromCash, splitFromCashPercent, splitIsExact, splitPercents, type SplitMode } from "../bookingMath";
import type { StepProps } from "./types";

/** Step 3 — agreement value (prefilled from the flat) and the Cash / Account split with auto-balance. */
export function StepAgreement({ state, update, errors, showErrors, can }: StepProps) {
  const flat = useFlatDetail(state.flat_id);
  const listPrice = flat.data?.price_paise ?? null;
  const total = state.agreement_value_paise;

  // Prefill from the flat's price the first time we see it.
  useEffect(() => {
    if (total !== null || listPrice === null) return;
    update({ agreement_value_paise: listPrice, cash_agreed_paise: listPrice, account_agreed_paise: 0 });
  }, [listPrice, total, update]);

  const split = { cash_paise: state.cash_agreed_paise ?? 0, account_paise: state.account_agreed_paise ?? 0 };
  const percents = total ? splitPercents(total, split) : { cash: 0, account: 0 };
  const exact = total !== null && total > 0 && state.cash_agreed_paise !== null && state.account_agreed_paise !== null && splitIsExact(total, split);
  const difference = total !== null && state.cash_agreed_paise !== null && state.account_agreed_paise !== null ? total - state.cash_agreed_paise - state.account_agreed_paise : null;
  const error = (key: string) => (showErrors ? errors[key] : undefined);
  const canEdit = can.editAgreement;

  const setTotal = (next: number | null) => {
    if (next === null) {
      update({ agreement_value_paise: null });
      return;
    }
    const rebalanced = total ? rebalanceSplitForTotal(split, total, next) : splitFromCash(next, next);
    update({ agreement_value_paise: next, cash_agreed_paise: rebalanced.cash_paise, account_agreed_paise: rebalanced.account_paise });
  };

  const applySplit = (next: { cash_paise: number; account_paise: number }) => update({ cash_agreed_paise: next.cash_paise, account_agreed_paise: next.account_paise });

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <FormRow columns={2}>
          <FieldWrapper
            label="Agreement value"
            required
            error={error("agreement_value_paise")}
            hint={
              listPrice !== null ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  List price <span className="money font-medium text-ink">{formatINR(listPrice)}</span>
                  {total !== null && total !== listPrice && (
                    <span className={cn("money font-medium", total < listPrice ? "text-warning-fg" : "text-success-fg")}>
                      ({total < listPrice ? "−" : "+"}
                      {formatINR(Math.abs(total - listPrice))})
                    </span>
                  )}
                  {canEdit && total !== null && total !== listPrice && (
                    <Button size="xs" variant="link" leftIcon={RotateCcw} onClick={() => setTotal(listPrice)}>
                      Reset to list price
                    </Button>
                  )}
                </span>
              ) : (
                "Prefilled from the flat's price breakup"
              )
            }
          >
            {(control) => (
              <div className="relative">
                <MoneyInput id={control.id} value={total} onChange={setTotal} invalid={control.invalid} readOnly={!canEdit} aria-readonly={!canEdit || undefined} className={cn(!canEdit && "pr-9")} data-testid="wizard-agreement-value" />
                {!canEdit && <Lock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />}
              </div>
            )}
          </FieldWrapper>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-muted">Enter the split as</span>
            <Tabs value={state.split_mode} onValueChange={(value) => update({ split_mode: value as SplitMode })}>
              <TabsList variant="pills" aria-label="Split entry mode">
                <TabsTrigger value="AMOUNT">Amounts</TabsTrigger>
                <TabsTrigger value="PERCENT">Percentages</TabsTrigger>
              </TabsList>
            </Tabs>
            {!canEdit && <p className="text-xs text-ink-subtle">The agreement value needs the “Edit agreement” permission to change; the split is yours to set.</p>}
          </div>
        </FormRow>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface/60 p-4">
        <FormRow columns={2}>
          {state.split_mode === "AMOUNT" ? (
            <>
              <FieldWrapper label="Cash bucket" required error={error("cash_agreed_paise")} hint={total ? `${formatPercent(percents.cash)} of the agreement` : undefined}>
                {(control) => <MoneyInput id={control.id} value={state.cash_agreed_paise} invalid={control.invalid} maxPaise={total ?? undefined} onChange={(value) => (total !== null ? applySplit(splitFromCash(total, value)) : update({ cash_agreed_paise: value }))} data-testid="wizard-cash-amount" />}
              </FieldWrapper>
              <FieldWrapper label="Account bucket" required error={error("account_agreed_paise")} hint={total ? `${formatPercent(percents.account)} of the agreement · bank / loan / official` : undefined}>
                {(control) => <MoneyInput id={control.id} value={state.account_agreed_paise} invalid={control.invalid} maxPaise={total ?? undefined} onChange={(value) => (total !== null ? applySplit(splitFromAccount(total, value)) : update({ account_agreed_paise: value }))} data-testid="wizard-account-amount" />}
              </FieldWrapper>
            </>
          ) : (
            <>
              <FieldWrapper label="Cash %" required error={error("cash_agreed_paise")} hint={<span className="money">{formatINR(state.cash_agreed_paise)}</span>}>
                {(control) => <PercentInput id={control.id} value={percents.cash} invalid={control.invalid} disabled={!total} onChange={(value) => total !== null && applySplit(splitFromCashPercent(total, value))} data-testid="wizard-cash-percent" />}
              </FieldWrapper>
              <FieldWrapper label="Account %" required error={error("account_agreed_paise")} hint={<span className="money">{formatINR(state.account_agreed_paise)}</span>}>
                {(control) => <PercentInput id={control.id} value={percents.account} invalid={control.invalid} disabled={!total} onChange={(value) => total !== null && applySplit(splitFromAccountPercent(total, value))} data-testid="wizard-account-percent" />}
              </FieldWrapper>
            </>
          )}
        </FormRow>

        {total !== null && total > 0 && (
          <div className="space-y-1.5" data-testid="wizard-split-bar">
            <div className="flex h-3 overflow-hidden rounded-full bg-navy-100" role="img" aria-label={`Cash ${formatPercent(percents.cash)}, account ${formatPercent(percents.account)}`}>
              <span className="bg-navy-950" style={{ width: `${percents.cash}%` }} />
              <span className="bg-gold" style={{ width: `${percents.account}%` }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-ink-muted">
                <span className="size-2.5 rounded-xs bg-navy-950" /> Cash <span className="money font-semibold text-ink">{formatINR(state.cash_agreed_paise)}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-ink-muted">
                <span className="size-2.5 rounded-xs bg-gold" /> Account <span className="money font-semibold text-ink">{formatINR(state.account_agreed_paise)}</span>
              </span>
              <span className={cn("money font-semibold", exact ? "text-success-fg" : "text-danger-fg")} aria-live="polite">
                {exact ? "Sums exactly ✓" : difference !== null ? `Off by ${formatINR(Math.abs(difference))}` : "Enter both buckets"}
              </span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {[0, 25, 50, 75, 100].map((cashPct) => (
            <Button key={cashPct} size="xs" variant="outline" disabled={!total} onClick={() => total !== null && applySplit(splitFromCashPercent(total, cashPct))}>
              {cashPct}/{100 - cashPct}
            </Button>
          ))}
          <span className="self-center text-2xs text-ink-subtle">Cash / Account presets</span>
        </div>
      </section>

      <Notice tone="info">
        Each installment percent applies equally to both buckets. The customer may pay Cash or Account in any order; the system only tracks where money sits and blocks payments above a bucket's agreed amount.
      </Notice>
    </div>
  );
}
