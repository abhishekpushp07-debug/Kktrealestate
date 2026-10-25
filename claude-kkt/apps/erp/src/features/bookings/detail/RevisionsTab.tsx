import { ArrowRight, FileSignature, Route } from "lucide-react";
import { TRIGGER_TYPE_LABELS, type AgreementRevisionRow, type BookingDetailResponse, type PlanRevisionRow, type PlanSnapshot } from "@kkt/contracts";
import { Badge, EmptyState, Timeline, type TimelineItem } from "@/components/ui";
import { formatINR, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

function Delta({ before, after }: { before: number; after: number }) {
  const diff = after - before;
  return (
    <span className="money inline-flex flex-wrap items-center gap-1">
      <span className="text-ink-subtle line-through">{formatINR(before)}</span>
      <ArrowRight className="size-3 text-ink-subtle" aria-hidden="true" />
      <span className="font-semibold text-navy-950">{formatINR(after)}</span>
      {diff !== 0 && <span className={cn("text-2xs font-semibold", diff > 0 ? "text-success-fg" : "text-danger-fg")}>({formatINR(diff, { signed: true })})</span>}
    </span>
  );
}

function AgreementDiff({ revision }: { revision: AgreementRevisionRow }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-surface/60 px-3 py-2 text-xs">
      <dt className="text-ink-subtle">Agreement</dt>
      <dd>
        <Delta before={revision.before.agreement_value_paise} after={revision.after.agreement_value_paise} />
      </dd>
      <dt className="text-ink-subtle">Cash</dt>
      <dd>
        <Delta before={revision.before.cash_agreed_paise} after={revision.after.cash_agreed_paise} />
      </dd>
      <dt className="text-ink-subtle">Account</dt>
      <dd>
        <Delta before={revision.before.account_agreed_paise} after={revision.after.account_agreed_paise} />
      </dd>
    </dl>
  );
}

function PlanColumn({ snapshot, label }: { snapshot: PlanSnapshot; label: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface/60 p-3 text-xs">
      <p className="label-caps mb-1">{label}</p>
      <p className="font-semibold text-navy-950">
        {snapshot.name} <span className="money text-2xs font-normal text-ink-subtle">{snapshot.code}</span>
      </p>
      <ol className="mt-1 space-y-0.5">
        {snapshot.installments.map((installment) => (
          <li key={installment.seq} className="flex justify-between gap-2">
            <span className="truncate">
              {installment.seq}. {installment.name} <span className="text-ink-subtle">· {TRIGGER_TYPE_LABELS[installment.trigger_type]}</span>
            </span>
            <span className="money shrink-0 font-medium">{formatPercent(installment.percent)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanDiff({ revision }: { revision: PlanRevisionRow }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <PlanColumn snapshot={revision.before_plan_snapshot} label="Before" />
      <PlanColumn snapshot={revision.after_plan_snapshot} label="After" />
    </div>
  );
}

/** Agreement and plan revisions interleaved by time, each with its before / after. */
export function RevisionsTab({ booking }: { booking: BookingDetailResponse }) {
  const items: TimelineItem[] = [
    ...booking.agreement_revisions.map<TimelineItem>((revision) => ({
      id: `agreement-${revision.id}`,
      title: (
        <span className="inline-flex flex-wrap items-center gap-2">
          Agreement revised <Badge variant="warning">AGREEMENT_CHANGE</Badge>
        </span>
      ),
      description: revision.reason,
      actor: revision.revised_by_name,
      at: revision.revised_at,
      icon: FileSignature,
      tone: "warning",
      children: <AgreementDiff revision={revision} />,
    })),
    ...booking.plan_revisions.map<TimelineItem>((revision) => ({
      id: `plan-${revision.id}`,
      title: (
        <span className="inline-flex flex-wrap items-center gap-2">
          Payment plan changed <Badge variant="info">PLAN_CHANGE</Badge>
        </span>
      ),
      description: revision.reason,
      actor: revision.by_name,
      at: revision.at,
      icon: Route,
      tone: "info",
      children: <PlanDiff revision={revision} />,
    })),
  ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  if (items.length === 0) {
    return <EmptyState compact icon={FileSignature} title="No revisions" description="Agreement revisions and plan changes are recorded here with their before / after values." />;
  }
  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="revisions-tab">
      <Timeline items={items} absolute />
    </div>
  );
}
