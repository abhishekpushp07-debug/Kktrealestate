import { Card, Money } from "@/components/v2";
import { useFetch } from "@/hooks/useList";
import { fmtDate, inrShort } from "@/lib/format";
import { cn } from "@/lib/utils";

function trigger(r) {
  if (r.trigger_type === "ON_BOOKING") return "on booking";
  if (r.trigger_type === "ON_STAGE") return `on ${r.stage?.name || "stage"}`;
  if (r.trigger_type === "ON_DATE") return `on ${fmtDate(r.trigger_date)}`;
  if (r.trigger_type === "ON_POSSESSION") return "on possession";
  if (r.trigger_type === "DAYS_AFTER_BOOKING") return `${r.trigger_days} days after booking`;
  return "—";
}

// Elite: sapphire = progress (paid filled, billed/part-paid ring), coral = overdue, grey = not billed yet
const BILL = {
  paid: [
    "Paid",
    "text-txt-secondary",
    "bg-[var(--accent)] border-[var(--accent)] text-white",
    "var(--accent)",
  ],
  part_paid: [
    "Part-paid",
    "text-[var(--accent)]",
    "border-[var(--accent)] text-[var(--accent)]",
    "color-mix(in srgb, var(--accent) 55%, transparent)",
  ],
  overdue: ["Overdue", "text-[var(--due)]", "border-[var(--due)] text-[var(--due)]", "var(--due)"],
  billed: [
    "Billed",
    "text-ink-950",
    "border-[var(--accent)] text-[var(--accent)]",
    "color-mix(in srgb, var(--accent) 35%, transparent)",
  ],
  not_billed: [
    "Not billed",
    "text-txt-muted",
    "border-warm-300 text-txt-muted",
    "var(--line-strong)",
  ],
};

/** REQ-160: one segment per instalment, coloured by its bill state; width = plan %. */
function PlanBar({ rows, data }) {
  const next = rows.find((r) => r.bill.state === "not_billed");
  return (
    <div className="mb-6" data-testid="plan-bar">
      <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full">
        {rows.map((r) => (
          <span
            key={r.seq}
            title={`${r.name} · ${BILL[r.bill.state][0]}`}
            style={{
              flex: `${Math.max(r.percent || 0, 1)} 1 0`,
              background: BILL[r.bill.state][3],
            }}
            data-testid={`plan-seg-${r.seq}`}
            data-state={r.bill.state}
          />
        ))}
      </div>
      <p className="mt-2 text-[12.5px] text-txt-secondary" data-testid="plan-bar-caption">
        {data.stage_n ? `Stage ${data.stage_k} of ${data.stage_n}` : `${rows.length} instalments`}
        {next ? ` · next: ${next.stage?.name || next.name}` : " · every instalment billed"}
      </p>
    </div>
  );
}

function billText(b) {
  if (b.state === "overdue")
    return `Overdue ${b.overdue_days} day${b.overdue_days === 1 ? "" : "s"}${b.paid_paise > 0 ? " · part-paid" : ""}`;
  if (b.state === "billed") return `Billed · due ${fmtDate(b.due_date)}`;
  if (b.state === "part_paid") return `Part-paid · ${inrShort(b.open_paise / 100)} open`;
  return BILL[b.state][0];
}

function stageText(s, tower) {
  if (!s) return null;
  if (s.state === "completed") return `completed ${fmtDate(s.completed_on)}`;
  return `awaiting stage (${tower || "tower"} at ${s.tower_current_stage || "not started"})`;
}

function OtherLine({ l }) {
  let st = ["Billed", "text-ink-950"];
  if ((l.demanded || 0) <= 0) st = ["Not billed", "text-txt-muted"];
  else if (l.paid >= l.demanded - 0.5) st = ["Paid", "text-txt-secondary"];
  else if (l.paid > 0) st = ["Part-paid", "text-[var(--accent)]"];
  return (
    <li
      className="flex items-center justify-between gap-3 py-2 text-sm"
      data-testid={`plan-oc-${l.code || l.line_id}`}
    >
      <span className="text-ink-950">{l.name}</span>
      <span className="flex items-center gap-4">
        <Money value={l.total || 0} />
        <span className={cn("w-28 text-right", st[1])}>{st[0]}</span>
      </span>
    </li>
  );
}

/** REQ-160/162: plan stepper from GET /bookings/{id}/plan-timeline (row stage + bill state from the server). */
export function PlanTimeline({ b }) {
  const { data } = useFetch(`/bookings/${b.id}/plan-timeline`);
  const rows = data?.rows || [];
  if (!rows.length) return null;
  const oc = (b.other_charges || []).filter((l) => (l.total || 0) > 0);
  return (
    <Card testId="plan-timeline" className="!rounded-[18px]">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h3 className="e-caps">Payment plan</h3>
        <span className="text-sm text-txt-secondary">
          {b.payment_plan_snapshot?.name}
          {data.stage_n ? ` · stage ${data.stage_k} of ${data.stage_n}` : ""}
        </span>
      </div>
      <PlanBar rows={rows} data={data} />
      <ol>
        {rows.map((r, k) => {
          const done = r.bill.state === "paid";
          return (
            <li
              key={r.seq}
              className="grid grid-cols-[30px_1fr] gap-3 pb-5 last:pb-0"
              data-testid={`plan-row-${r.seq}`}
            >
              <span className="relative flex justify-center">
                <span
                  className={cn(
                    "z-[1] grid h-[26px] w-[26px] place-items-center rounded-full border text-[11px] font-bold tabular-nums",
                    BILL[r.bill.state][2],
                  )}
                >
                  {r.seq}
                </span>
                {k < rows.length - 1 && (
                  <span
                    className={cn(
                      "absolute top-[28px] h-[calc(100%-6px)] w-[2px]",
                      done ? "bg-[var(--accent)]" : "bg-warm-200",
                    )}
                  />
                )}
              </span>
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink-950">
                    {r.name} <span className="font-normal text-txt-secondary">· {r.percent}%</span>
                  </p>
                  <p className="text-[12.5px] text-txt-muted">
                    {trigger(r)}
                    {r.stage && (
                      <span data-testid={`plan-stage-${r.seq}`}>
                        {" "}
                        · {stageText(r.stage, b.block_name)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tnum text-[15px] font-semibold text-ink-950">
                    {r.amount_is_estimate ? (
                      <span
                        className="text-txt-secondary"
                        title="estimate: plan % of the agreement value"
                      >
                        ≈ {inrShort(r.amount_paise / 100)} <span className="text-xs">(est.)</span>
                      </span>
                    ) : (
                      <Money value={r.amount_paise / 100} />
                    )}
                  </p>
                  <p
                    className={cn("text-xs", BILL[r.bill.state][1])}
                    data-testid={`plan-bill-${r.seq}`}
                  >
                    {billText(r.bill)}
                    {r.bill.demand_number ? ` · ${r.bill.demand_number}` : ""}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {oc.length > 0 && (
        <div className="mt-5 border-t border-warm-200 pt-3">
          <p className="e-caps mb-1 !text-[10.5px]">Other charges</p>
          <ul className="divide-y divide-warm-100">
            {oc.map((l) => (
              <OtherLine key={l.line_id} l={l} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
