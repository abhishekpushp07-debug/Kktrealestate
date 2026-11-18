import { useState } from "react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { Link } from "react-router-dom";
import { useFetch } from "@/hooks/useList";
import { Card, Skeleton, UNIT_COLORS } from "@/components/v2";
import { cn } from "@/lib/utils";

const CAT = {
  sold: ["Booked or sold", UNIT_COLORS.Sold, "Booked"],
  available: ["Available", UNIT_COLORS.Available, "Available"],
  hold: ["Hold", UNIT_COLORS.Hold, "Hold"],
  landowner: ["Landowner", "var(--champagne)", "Available"],
  blocked: ["Blocked / Other", UNIT_COLORS.Blocked, "Blocked"],
};
const PACE_WORD = { fast: "fast", steady: "steady", slow: "slow" };

/** Z.3 pace as quiet grey text (owner: calm — no sparkline, no coloured chip); tooltip lists week-by-week counts. */
function Pace({ r, weeks }) {
  const tip = (r.series || []).map((v, i) => `${weeks?.[i] || i + 1}: ${v}`).join("\n");
  return (
    <span
      className="whitespace-nowrap text-right text-xs tabular-nums text-txt-muted"
      title={tip}
      data-testid={`tower-sales-pace-${r.code}`}
      data-pace={r.pace}
    >
      {r.pace === "sold_out"
        ? "sold out"
        : `${r.last4} in the last 4 weeks · ${PACE_WORD[r.pace] || "steady"}`}
    </span>
  );
}

function Row({ r, cats, projectId, spark, weeks }) {
  const total = r.total || 1;
  return (
    <div
      className={cn(
        "grid items-center gap-3 text-sm",
        // phones: name + bar on one row, the figures wrap below (no clipped columns at 390 px)
        spark
          ? "grid-cols-[90px_1fr] md:grid-cols-[120px_1fr_150px_190px]"
          : "grid-cols-[90px_1fr] md:grid-cols-[120px_1fr_150px]",
      )}
      data-testid={`tower-sales-row-${r.code}`}
    >
      <Link
        to={`/blocks/${r.block_id}`}
        className="truncate font-semibold text-ink-950 hover:text-gold"
      >
        {r.tower}
      </Link>
      <div className="flex h-6 w-full gap-px overflow-hidden rounded-md bg-warm-100">
        {cats
          .filter((c) => r[c])
          .map((c) => (
            <Link
              key={c}
              to={`/flats?project_id=${projectId}&block_id=${r.block_id}&status=${CAT[c][2]}`}
              style={{ width: `${(r[c] / total) * 100}%`, background: CAT[c][1] }}
              className="flex items-center justify-center text-[11px] font-semibold text-white/95 transition-opacity hover:opacity-80"
              title={`${CAT[c][0]}: ${r[c]}`}
              data-testid={`tower-sales-seg-${r.code}-${c}`}
            >
              {r[c] / total > 0.08 ? r[c] : ""}
            </Link>
          ))}
      </div>
      <span
        className="whitespace-nowrap text-right tabular-nums text-txt-secondary"
        data-testid={`tower-sales-pct-${r.code}`}
      >
        <b className="text-ink-950">{r.sold_pct}%</b> · {r.total} units
      </span>
      {spark && <Pace r={r} weeks={weeks} />}
    </div>
  );
}

/**
 * Y.1 — tower-wise Sold vs Available (stacked, server-aggregated, masked per role; Real/Display
 * toggle for privileged users). `spark` adds the Z.3 pace column.
 */
export function TowerSalesChart({ projectId, compact, spark = !compact, className }) {
  const view = "real"; // one definition everywhere; the server falls back to the sales display view without real-status access
  const { data, loading } = useFetch(
    projectId ? `/projects/${projectId}/tower-sales?view=${view}&weeks=12` : null,
    [projectId, view],
  );
  if (!projectId) return <p className="text-sm text-txt-muted">Pick a project.</p>;
  if (loading || !data) return <Skeleton className="h-40 rounded-xl" />;
  const cats = data.categories;
  return (
    <div className={className} data-testid="tower-sales-chart" data-view={data.view}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap gap-3 text-xs text-txt-secondary"
          data-testid="tower-sales-legend"
        >
          {cats.map((c) => (
            <span key={c} className="inline-flex items-center gap-1">
              <i
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: CAT[c][1] }}
              />
              {CAT[c][0]}
            </span>
          ))}
        </div>
      </div>
      <div className={cn("mt-3 space-y-2", compact && "max-h-56 overflow-y-auto pr-1")}>
        {data.towers.map((r) => (
          <Row
            key={r.block_id}
            r={r}
            cats={cats}
            projectId={projectId}
            spark={spark}
            weeks={data.weeks}
          />
        ))}
      </div>
      <p className="mt-3 border-t border-warm-100 pt-2 text-sm" data-testid="tower-sales-total">
        Project total: <b>{data.total.sold}</b> of <b>{data.total.total}</b> booked or sold ·{" "}
        <b>{data.total.sold_pct}%</b>
        {data.total.available != null && ` · ${data.total.available} available`}
        {data.view === "display" && " · as shown to sales"}
        {data.total.hold ? ` · ${data.total.hold} on hold` : ""}
        {data.total.last4 != null && (
          <>
            {" "}
            · <b>{data.total.last4}</b> sold in the last 4 weeks
          </>
        )}
      </p>
    </div>
  );
}

/** Home widget wrapper with its own project selector; size L shows the pace sparklines. */
export function TowerSalesWidget({ projects, size }) {
  const [pid, setPid] = useState(projects?.[0]?.id || "");
  const list = projects || [];
  const sel = pid || list[0]?.id || "";
  return (
    <Card testId="tower-sales-widget">
      <div className="flex items-center justify-between gap-3">
        <h3 className="e-caps-blue">Tower sales progress</h3>
        <NativeSelect
          className="input !h-8 w-44 text-xs"
          value={sel}
          onChange={(e) => setPid(e.target.value)}
          data-testid="tower-sales-project"
        >
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <TowerSalesChart projectId={sel} compact spark={size === "L"} className="mt-3" />
    </Card>
  );
}
