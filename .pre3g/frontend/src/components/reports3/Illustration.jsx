import { inr } from "@/lib/format";

const TONE = {
  sapphire: "var(--accent)",
  graphite: "var(--text-2, #5b6476)",
  muted: "var(--line-strong)",
  coral: "var(--due)",
  "coral-soft": "color-mix(in srgb, var(--due) 55%, transparent)",
  mint: "var(--advance)",
  steel: "color-mix(in srgb, var(--text-3) 70%, transparent)",
  "sapphire-soft": "color-mix(in srgb, var(--accent) 45%, transparent)",
  slate: "color-mix(in srgb, var(--text-2, #5b6476) 60%, transparent)",
};
const COUNT_LABEL = {
  overdue: "Overdue",
  due: "Due, not late",
  clear: "All clear",
  advance: "Advance",
  cancelled: "Cancelled",
  transferred: "Transferred",
};

/** REQ-269: one illustration per report explaining its main figure — split bar in the Elite palette. */
function Counts({ data }) {
  const entries = data.bars
    ? data.bars.map((b) => [b.label, b.value])
    : Object.entries(data.counts || {});
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const show = (v) => (data.bars && !data.count ? inr(v / 100) : v);
  return (
    <figure className="r3-illus" data-testid="report-illustration">
      <figcaption className="r3-flab">{data.title}</figcaption>
      <div className="grid gap-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3 text-xs">
            <span className="w-36 shrink-0 truncate">{COUNT_LABEL[k] || k}</span>
            <span className="r3-bar flex-1" style={{ height: 10 }}>
              <span style={{ width: `${(v / max) * 100}%`, background: "var(--accent)" }} />
            </span>
            <b className="tabular w-24 text-right">{show(v)}</b>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** Stacking plan: projects → towers side by side (ground floors aligned) → floors (top first) × flats. Status is told by
 * form as well as tone: Available filled, Hold hollow with a dot, Booked slate, Sold graphite (dimmed text), Blocked hatched. */
const Cell = ({ status, children, title }) => (
  <span className={`r3-cell s-${status.toLowerCase()}`} title={title} data-testid="stack-cell">
    {children}
  </span>
);

function Tower({ t }) {
  return (
    <div className="max-w-full overflow-x-auto" data-testid="stack-tower">
      <div className="mb-1 text-xs font-semibold">{t.name}</div>
      {t.floors.map((f) => (
        <div key={f.floor} className="flex items-center gap-1 py-[2px]">
          <span className="tabular w-6 shrink-0 text-right text-[10px] text-[var(--text-3)]">
            {f.floor}
          </span>
          {f.flats.map((c) => (
            <Cell key={c.flat} status={c.status} title={`${c.flat} · ${c.type} · ${c.status}`}>
              {c.flat}
            </Cell>
          ))}
        </div>
      ))}
    </div>
  );
}

function Stack({ data }) {
  return (
    <figure className="r3-illus" data-testid="report-illustration-stack">
      <figcaption className="r3-flab">{data.title}</figcaption>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" data-testid="stack-legend">
        {data.legend.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <Cell status={s} title={s}>
              {" "}
            </Cell>
            {s}
          </span>
        ))}
      </div>
      <div className="grid gap-6">
        {data.projects.map((p) => (
          <section key={p.name} data-testid="stack-project">
            <div className="r3-flab mb-2">{p.name}</div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
              {p.towers.map((t) => (
                <Tower key={t.name} t={t} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </figure>
  );
}

export function Illustration({ data }) {
  if (data?.type === "stack") return <Stack data={data} />;
  if (data?.type === "counts" || data?.type === "bars") return <Counts data={data} />;
  if (!data || data.type !== "split_bar") return null;
  const show = (v) => (data.count ? v.toLocaleString("en-IN") : inr(v / 100));
  const total = data.parts.reduce((s, p) => s + Math.max(p.value, 0), 0) || 1;
  return (
    <figure className="r3-illus" data-testid="report-illustration">
      <figcaption className="r3-flab">{data.title}</figcaption>
      <div className="r3-bar">
        {data.parts.map((p) =>
          p.value > 0 ? (
            <span
              key={p.label}
              title={`${p.label} ${show(p.value)}`}
              style={{ width: `${(p.value / total) * 100}%`, background: TONE[p.tone] }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {data.parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <i className="r3-dot" style={{ background: TONE[p.tone] }} />
            {p.label} <b className="tabular">{show(p.value)}</b>
          </span>
        ))}
      </div>
      {data.note && (
        <p className="text-xs text-[var(--text-3)]" data-testid="report-illustration-note">
          {data.note}
        </p>
      )}
      {data.counts && (
        <div className="flex flex-wrap gap-2 pt-1" data-testid="report-illustration-counts">
          {Object.entries(data.counts).map(([k, v]) => (
            <span key={k} className="r3-chip">
              {COUNT_LABEL[k] || k} · {v}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
