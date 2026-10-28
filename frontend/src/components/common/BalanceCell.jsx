import { cn } from "@/lib/utils";
import { inr } from "@/lib/format";

/** Status of a two-sided balance (received − bill raised): negative → due, positive → advance, zero → settled. */
export const balanceStatus = (balance) => (balance < 0 ? "due" : balance > 0 ? "advance" : "settled");
export const balanceLabel = { due: "Due", advance: "Advance", settled: "Settled" };
export const balanceTone = { due: "text-brick", advance: "text-emerald-700", settled: "text-txt-muted" };

/** Renders a signed balance: "-₹2,95,000" red + Due · "₹40,000" green + Advance · "₹0" muted + Settled. */
export function BalanceCell({ balance, className, testId, chip = true }) {
  const b = Math.round(balance || 0);
  const st = balanceStatus(b);
  const text = b < 0 ? `-${inr(-b)}` : inr(b);
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums", balanceTone[st], className)} data-testid={testId} data-balance-status={st} aria-label={`${text} ${balanceLabel[st]}`}>
      <span className="font-semibold">{text}</span>
      {chip && <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", st === "due" && "bg-brick/10 text-brick", st === "advance" && "bg-emerald-50 text-emerald-700", st === "settled" && "bg-warm-100 text-txt-muted")}>{balanceLabel[st]}</span>}
    </span>
  );
}
