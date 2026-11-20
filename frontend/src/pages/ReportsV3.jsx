import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bookmark, Sparkles } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { fmtDate, inrShort } from "@/lib/format";
import { Skeleton } from "@/components/v2";
import { useHeadlines } from "@/pages/Reports";

function Tile({ t, head, nav }) {
  const to = t.live ? `/reports/v3/${t.key}` : t.legacy ? `/reports/${t.legacy}` : null;
  const fig = t.headline_paise != null ? inrShort(t.headline_paise / 100) : t.headline;
  const h = t.live ? { value: fig, caption: t.caption } : head;
  return (
    <button
      type="button"
      onClick={() => to && nav(to)}
      disabled={!to}
      title={to ? t.purpose : "Coming soon"}
      className={`e-rtile ${to ? "" : "opacity-60"}`}
      data-testid={`hub-tile-${t.key}`}
    >
      <b data-testid={`hub-figure-${t.key}`}>
        {!to ? "soon" : h === undefined ? "…" : h ? h.value : "—"}
      </b>
      <span className="e-rname">{t.title}</span>
      <small data-testid={`hub-caption-${t.key}`}>
        {!to
          ? t.purpose
          : h
            ? h.caption
            : h === null
              ? "figure unavailable · tap to open"
              : t.purpose}
      </small>
    </button>
  );
}

/** REQ-274: Customer status one click on top, 5 segments × 10 tiles, saved views, control room. */
export default function ReportsHubV3() {
  const nav = useNavigate();
  const { data, loading } = useFetch("/reports/v3");
  const legacyKeys = useMemo(() => {
    const keys = new Set();
    for (const s of data?.segments || [])
      for (const t of s.tiles) if (!t.live && t.legacy) keys.add(t.legacy);
    for (const t of data?.control_room || []) if (t.legacy) keys.add(t.legacy);
    return [...keys].map((key) => ({ key }));
  }, [data]);
  const heads = useHeadlines(legacyKeys);
  if (loading || !data) return <Skeleton className="h-96 w-full" />;
  const one = data.segments.flatMap((s) => s.tiles).find((t) => t.key === data.one_click);
  return (
    <div className="space-y-9" data-testid="reports-hub">
      <header>
        <h1 className="e-title" data-testid="page-title">
          reports.
        </h1>
        <p className="e-sub" data-testid="hub-subtitle">
          {data.count} reports · as of {fmtDate(data.as_of)} · India time
        </p>
      </header>
      {one && (
        <button
          type="button"
          className="r3-oneclick"
          onClick={() => nav(`/reports/v3/${one.key}`)}
          data-testid="hub-one-click"
        >
          <Sparkles className="h-5 w-5" />
          <span className="flex-1 text-left">
            <b>Customer status · one click</b>
            <small>{one.caption}</small>
          </span>
          <em className="tabular">
            {one.headline_paise != null ? inrShort(one.headline_paise / 100) : one.headline}
          </em>
          <ArrowRight className="h-5 w-5" />
        </button>
      )}
      {data.views.length > 0 && (
        <section data-testid="hub-views">
          <p className="e-grpcap">
            Saved views <span>{data.views.length}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {data.views.map((v) => (
              <Link
                key={v.id}
                to={`/reports/v3/${v.report_key}?${new URLSearchParams(v.filters || {})}`}
                className="r3-chip"
                data-testid={`hub-view-${v.id}`}
              >
                <Bookmark className="h-3 w-3" /> {v.name}
              </Link>
            ))}
          </div>
        </section>
      )}
      {data.segments.map((s) => (
        <section
          key={s.segment}
          data-testid={`hub-segment-${s.segment.toLowerCase().replace(/[^a-z]+/g, "-")}`}
        >
          <p className="e-grpcap">
            {s.segment} <span>{s.tiles.length}</span>
            <small
              className="ml-2 font-normal normal-case tracking-normal text-txt-muted"
              data-testid={`hub-summary-${s.segment.toLowerCase().replace(/[^a-z]+/g, "-")}`}
            >
              {s.tiles.length} reports
              {s.figure ? ` · ${s.figure.label} ${inrShort(s.figure.amount_paise / 100)}` : ""}
            </small>
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {s.tiles.map((t) => (
              <Tile key={t.key} t={t} head={heads[t.legacy]} nav={nav} />
            ))}
          </div>
        </section>
      ))}
      {data.control_room.length > 0 && (
        <section data-testid="hub-control-room">
          <p className="e-grpcap">Control room</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {data.control_room.map((t) => (
              <Tile key={t.key} t={t} head={heads[t.legacy]} nav={nav} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
