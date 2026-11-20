import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Columns3,
  FileSpreadsheet,
  FileText,
  Layers,
  Link2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { setParam, splitList } from "@/lib/reportsV3";
import { setCrumbLabel } from "@/lib/crumbs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/v2";
import { FilterBar } from "@/components/reports3/FilterBar";
import { Illustration } from "@/components/reports3/Illustration";
import { SavedViews } from "@/components/reports3/SavedViews";
import { FlatTable, GroupTable, PhoneCards } from "@/components/reports3/ReportTable";
import { MultiSelect } from "@/components/reports3/MultiSelect";

const UI_ONLY = /_preset$/;

function usePhone() {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mm = window.matchMedia(q);
    const f = () => setM(mm.matches);
    mm.addEventListener("change", f);
    return () => mm.removeEventListener("change", f);
  }, []);
  return m;
}

const apiParams = (sp) => {
  const p = new URLSearchParams();
  for (const [k, v] of sp) if (!UI_ONLY.test(k)) p.set(k, v);
  return p;
};

function download(path, sp, name) {
  api
    .get(path, { params: apiParams(sp), responseType: "blob" })
    .then((r) => {
      const url = URL.createObjectURL(r.data);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (name.endsWith(".pdf")) window.open(url, "_blank");
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
      }
    })
    .catch((e) => toast.error(errMsg(e)));
}

function ColumnChooser({ meta, cols, set }) {
  const on = new Set(cols.map((c) => c.key));
  const toggle = (k) => {
    const next = on.has(k)
      ? cols.map((c) => c.key).filter((x) => x !== k)
      : [...cols.map((c) => c.key), k];
    if (next.length) set(next);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="r3-tool" data-testid="report-columns-btn">
          <Columns3 className="h-4 w-4" /> Columns · {cols.length}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end" data-testid="report-columns-menu">
        <button
          type="button"
          className="r3-flab mb-1 px-2"
          onClick={() => set(null)}
          data-testid="report-columns-reset"
        >
          Back to default columns
        </button>
        {meta.columns.map((c) => (
          <button
            type="button"
            key={c.key}
            onClick={() => toggle(c.key)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-black/5"
            data-testid={`report-col-${c.key}`}
          >
            <span className={`r3-check ${on.has(c.key) ? "on" : ""}`} />
            {c.label}
            {c.default && (
              <em className="ml-auto text-[10px] not-italic text-txt-muted">default</em>
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** REQ-259…273: the one sheet every v3 report uses. All state lives in the URL (share link = same view). */
export function ReportSheet({ reportKey }) {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const phone = usePhone();
  const set = (n) => setSp(n, { replace: true });
  const params = apiParams(sp);
  if (!params.get("page_size")) params.set("page_size", "500");
  const q = useQuery({
    queryKey: ["r3", reportKey, params.toString()],
    queryFn: () => api.get(`/reports/v3/${reportKey}`, { params }).then((r) => r.data),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
  const d = q.data;
  const meta = d?.meta;
  useEffect(() => setCrumbLabel(reportKey, meta?.title), [reportKey, meta?.title]);
  const cols = d?.cols || [];
  const groupBy = splitList(sp.get("group"));
  const onSort = (k) => {
    const same = sp.get("sort") === k;
    set(setParam(setParam(sp, "sort", k), "dir", same && sp.get("dir") !== "desc" ? "desc" : ""));
  };
  const onRow = (r) => {
    if (!meta?.row_link) return;
    let missing = false;
    const to = meta.row_link.replace(/\{(\w+)\}/g, (_, k) =>
      r[k] == null ? ((missing = true), "") : r[k],
    );
    if (!missing) nav(to);
  };
  const groupOpts = useMemo(
    () => (meta?.groups || []).map((g) => ({ value: g.key, label: g.label })),
    [meta],
  );
  if (q.isError && !d)
    return (
      <div className="e-card p-8 text-center" data-testid="report-error">
        <p className="font-semibold">Couldn't load this report</p>
        <p className="mt-1 text-sm text-txt-muted">{errMsg(q.error)}</p>
        <button
          type="button"
          className="r3-tool on mx-auto mt-4"
          onClick={() => q.refetch()}
          data-testid="report-retry"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  if (!d) return <Skeleton className="h-96 w-full" />;
  const pages = Math.ceil(d.count / d.page_size);
  return (
    <div className="space-y-5" data-testid={`report-sheet-${reportKey}`}>
      <header className="r3-head">
        <p className="r3-flab">
          <Link to="/reports" data-testid="report-back-hub">
            Reports
          </Link>{" "}
          · {meta.segment}
        </p>
        <h1 className="e-title" data-testid="page-title">
          {meta.title}
        </h1>
        <p className="e-sub">{meta.purpose}</p>
        <p className="r3-sentence" data-testid="report-sentence">
          {d.sentence}
          {q.isFetching && <span className="r3-live" />}
        </p>
        {d.formula && (
          <p className="r3-formula" data-testid="report-formula">
            {d.formula}
          </p>
        )}
      </header>
      <FilterBar meta={meta} options={d.options} sp={sp} set={set} defaults={d.defaults} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-txt-muted" />
          <MultiSelect
            label="Group by"
            options={groupOpts}
            value={groupBy}
            onChange={(v) =>
              v.length <= 5 ? set(setParam(sp, "group", v)) : toast.info("Group by up to 5 levels")
            }
            max={5}
            testId="report-group-by"
          />
        </span>
        <span className="flex-1" />
        <ColumnChooser meta={meta} cols={cols} set={(v) => set(setParam(sp, "cols", v))} />
        <SavedViews reportKey={reportKey} sp={sp} apply={(f) => set(new URLSearchParams(f))} />
        {meta.can_export && (
          <>
            <button
              type="button"
              className="r3-tool"
              onClick={() =>
                download(`/reports/v3/${reportKey}/export.xlsx`, sp, `${reportKey}.xlsx`)
              }
              data-testid="report-export-xlsx"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
            <button
              type="button"
              className="r3-tool"
              onClick={() =>
                download(`/reports/v3/${reportKey}/export.pdf`, sp, `${reportKey}.pdf`)
              }
              data-testid="report-export-pdf"
            >
              <FileText className="h-4 w-4" /> PDF
            </button>
          </>
        )}
        <button
          type="button"
          className="r3-tool"
          onClick={() => window.print()}
          data-testid="report-print"
        >
          <Printer className="h-4 w-4" /> Print
        </button>
        <button
          type="button"
          className="r3-tool"
          onClick={() =>
            navigator.clipboard
              ?.writeText(window.location.href)
              .then(() => toast.success("Link copied — opens this exact view"))
          }
          data-testid="report-share"
        >
          <Link2 className="h-4 w-4" /> Share
        </button>
      </div>
      <Illustration data={d.illustration} />
      {d.count === 0 && meta.needs && !sp.get(meta.needs.filter) ? (
        <div className="e-card p-8 text-center" data-testid="report-needs">
          <p className="font-semibold">{meta.needs.message}</p>
          <p className="mt-1 text-sm text-txt-muted">Use the {meta.needs.filter} filter above.</p>
        </div>
      ) : d.count === 0 ? (
        <div className="e-card p-8 text-center" data-testid="report-empty">
          <p className="font-semibold">No {meta.unit[1]} match these filters</p>
          <button
            type="button"
            className="r3-tool on mx-auto mt-4"
            onClick={() => set(new URLSearchParams())}
            data-testid="report-empty-clear"
          >
            Clear filters
          </button>
        </div>
      ) : d.groups ? (
        <GroupTable
          cols={cols}
          groups={d.groups}
          totals={d.totals}
          sort={sp.get("sort")}
          dir={sp.get("dir")}
          onSort={onSort}
          onRow={onRow}
        />
      ) : phone ? (
        <PhoneCards cols={cols} rows={d.rows || []} totals={d.totals} onRow={onRow} />
      ) : (
        <FlatTable
          cols={cols}
          rows={d.rows}
          totals={d.totals}
          sort={sp.get("sort")}
          dir={sp.get("dir")}
          onSort={onSort}
          onRow={onRow}
        />
      )}
      {!d.groups && pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm" data-testid="report-pager">
          <button
            type="button"
            className="r3-tool"
            disabled={d.page <= 1}
            title={d.page <= 1 ? "Already on the first page" : "Previous page"}
            onClick={() => set(setParam(sp, "page", d.page - 1))}
            data-testid="report-prev"
          >
            Previous
          </button>
          <span>
            Page {d.page} of {pages}
          </span>
          <button
            type="button"
            className="r3-tool"
            disabled={d.page >= pages}
            title={d.page >= pages ? "Already on the last page" : "Next page"}
            onClick={() => set(setParam(sp, "page", d.page + 1))}
            data-testid="report-next"
          >
            Next
          </button>
        </div>
      )}
      {meta.tieout && (
        <p className="text-xs text-txt-muted" data-testid="report-tieout">
          Ties out: {meta.tieout}
        </p>
      )}
    </div>
  );
}
