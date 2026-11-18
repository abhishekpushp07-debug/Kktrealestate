import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { pick } from "@/lib/branch";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { fmtRelative } from "@/lib/format";
import { syncServerDay } from "@/lib/businessDay";
import { HomeCustomize } from "@/components/home/HomeCustomize";
import { cn } from "@/lib/utils";
import { MoneyTodayHero } from "@/components/home/HomeElite";
import { HomeWidgets } from "@/components/home/HomeWidgets";
import { Button } from "@/components/ui/button";

const greet = (h) => pick(h < 12, "good morning", h < 17, "good afternoon", "good evening");
// D3: the business day / hour come from the server (company time zone), never the browser clock
const businessDate = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const PERIODS = [
  ["today", "Today"],
  ["month", "This month"],
  ["fy", "FY"],
];

function Controls({ period, setPeriod, project, setProject, projects }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Period"
        className="inline-flex rounded-[10px] border border-warm-200 bg-warm-100 p-0.5"
      >
        {PERIODS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={period === id}
            onClick={() => setPeriod(id)}
            className={cn(
              "h-8 rounded-lg px-3 text-[13px] font-medium",
              period === id ? "bg-white text-ink-950 shadow-warm" : "text-txt-secondary",
            )}
            data-testid={`home-period-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      <NativeSelect
        value={project}
        onChange={(e) => setProject(e.target.value)}
        className="h-9 max-w-[180px] rounded-[10px] border border-warm-200 bg-white px-2 text-[13px] text-ink-950"
        aria-label="Project"
        data-testid="home-project-filter"
      >
        <option value="">All projects</option>
        {(projects || []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("month");
  const [project, setProject] = useState("");
  const qs = `/home/bundle?period=${period}${project ? `&project_id=${project}` : ""}`;
  const { data, loading, reload } = useFetch(qs);
  useEffect(() => syncServerDay(data?.business_day), [data?.business_day]);
  // the bundle already carries the layout; the editable copy is fetched only once Customize has been opened
  const [customizeOpened, setCustomizeOpened] = useState(false);
  const { data: ownLayout, setData: setSavedLayout } = useFetch(
    customizeOpened ? "/me/home-layout" : null,
  );
  const savedLayout = ownLayout || data?.layout;
  const [layout, setLayout] = useState(null);
  const [customize, setCustomize] = useState(false);
  useEffect(() => {
    if (savedLayout && !customize) setLayout(savedLayout);
  }, [savedLayout, customize]); // never clobber in-progress edits on background refetch
  const first = (user?.name || "").split(" ")[0];
  const labels = Object.fromEntries((layout?.available || []).map((a) => [a.id, a.label]));
  const widgets = (layout?.widgets || []).filter((w) => w.visible && labels[w.id]);
  const on = new Set(widgets.map((w) => w.id));
  const W = (id) => (on.has(id) && data?.widgets?.[id]?.ok ? data.widgets[id].data : null);
  const calls = W("call_today")?.overdue_customers?.length || 0;
  return (
    <div className="space-y-2" data-testid="home-page">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="e-title" data-testid="home-greeting">
            {data
              ? `${greet(data.business_hour)}, ${first.toLowerCase()}.`
              : `hello, ${first.toLowerCase()}.`}
          </h1>
          <p className="e-sub" data-testid="home-business-date">
            {data?.business_day ? businessDate(data.business_day) : "\u00a0"}
            {calls > 0 && ` · ${calls} ${calls === 1 ? "customer" : "customers"} to call today`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Controls
            period={period}
            setPeriod={setPeriod}
            project={project}
            setProject={setProject}
            projects={data?.projects}
          />
          <Button
            variant="soft"
            size="compact"
            onClick={() => {
              setCustomizeOpened(true);
              setCustomize((v) => !v);
            }}
            data-testid="home-customize-btn"
          >
            <Settings2 className="h-3.5 w-3.5" /> Customize
          </Button>
        </div>
      </header>
      {customize && layout && (
        <HomeCustomize
          layout={layout}
          onChange={setLayout}
          onSaved={(l) => {
            setSavedLayout(l);
            setLayout(l);
            setCustomize(false);
            reload();
          }}
          onClose={() => {
            setLayout(savedLayout);
            setCustomize(false);
          }}
        />
      )}
      {W("money_today") && (
        <MoneyTodayHero
          d={W("money_today")}
          month={data.widgets.due_vs_received?.data}
          day={data.business_day}
        />
      )}
      {data ? (
        <HomeWidgets data={data} on={on} reload={reload} />
      ) : (
        <div className="e-wgrid pt-6" data-testid="home-grid">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="skel h-[176px] rounded-[18px]" />
          ))}
        </div>
      )}
      {data && (
        <p className="text-xs text-txt-muted" data-testid="home-computed-at">
          Updated {fmtRelative(data.computed_at)} · every figure opens the list it adds up from
        </p>
      )}
    </div>
  );
}
