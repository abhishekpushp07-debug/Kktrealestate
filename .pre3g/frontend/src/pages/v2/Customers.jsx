import { useEffect, useMemo, useRef, useState } from "react";
import { branch } from "@/lib/branch";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LayoutGrid, Plus, Rows3, Search, SlidersHorizontal, UserRound } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { useCatalogues } from "@/hooks/useCatalogues";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { EmptyState, Money, Skeleton, StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Avatar, CardBalance, usePeople } from "@/components/v2/CustomerBits";
import { EliteCustomerCard } from "@/components/customer/EliteCustomerCard";

const SEGMENTS = [
  ["attention", "Needs attention"],
  ["overdue30", "Overdue 30+"],
  ["on_track", "On track"],
  ["clear", "All clear"],
  ["advance", "Advance"],
  ["no_booking", "No booking yet"],
  ["kyc_pending", "KYC pending"],
  ["all", "All"],
];
const PAGE = 24;

function Chip({ active, onClick, children, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pill border transition-colors",
        active
          ? "border-ink-950 bg-ink-950 text-warm-50"
          : "border-warm-200 bg-white text-txt-secondary hover:border-gold",
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

export default function Customers() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { label } = useCatalogues();
  const people = usePeople();
  const [sp] = useSearchParams();
  // localStorage: cards/table view preference — non-sensitive (CR-7)
  const [view, setView] = useState(() => localStorage.getItem("kkt_cust_view") || "cards");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [f, setF] = useState({
    segment_id: null,
    lifecycle_stage: null,
    assigned_sales_user_id: null,
    city_id: null,
    has_overdue: false,
    kyc_status: null,
  });
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const sentinel = useRef(null);
  const { data: counts } = useFetch("/customers?page_size=1&with_total=true");
  const { data: segCounts } = useFetch("/customers/segments");
  const [seg, setSeg] = useState(sp.get("segment") || "attention");
  useEffect(() => {
    localStorage.setItem("kkt_cust_view", view);
  }, [view]);
  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (sp.get("new")) nav("/customers/new", { replace: true });
  }, [sp, nav]);
  const params = useMemo(
    () => ({
      page_size: PAGE,
      sort: "-created_at",
      search: q || undefined,
      card_segment: q ? undefined : seg,
      ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)),
    }),
    [q, f, seg],
  );
  useEffect(() => {
    setPage(1);
    setItems([]);
  }, [params]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get("/customers", { params: { ...params, page } })
      .then((r) => {
        if (!alive) return;
        setItems((prev) => (page === 1 ? r.data.items : [...prev, ...r.data.items]));
        setTotal(r.data.total ?? 0);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [params, page]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting && !loading && items.length < total) setPage((p) => p + 1);
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loading, items.length, total]);
  const activeFilters = [f.segment_id, f.assigned_sales_user_id, f.city_id].filter(Boolean).length;
  const filterFields = (
    <>
      <Select
        type="customer_segment"
        value={f.segment_id}
        onChange={(v) => setF({ ...f, segment_id: v })}
        placeholder="Segment"
        allowAdd={false}
        className="w-full md:w-40"
        testId="filter-segment"
      />
      <Select
        options={people}
        value={f.assigned_sales_user_id}
        onChange={(v) => setF({ ...f, assigned_sales_user_id: v })}
        placeholder="RM"
        allowAdd={false}
        className="w-full md:w-40"
        testId="filter-rm"
      />
      <Select
        type="city"
        value={f.city_id}
        onChange={(v) => setF({ ...f, city_id: v })}
        placeholder="City"
        allowAdd={false}
        className="w-full md:w-36"
        testId="filter-city"
      />
    </>
  );
  return (
    <div className="space-y-6 md:space-y-8" data-testid="customers-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="e-title" data-testid="page-title">
            customers.
          </h1>
          <p className="e-sub" data-testid="customers-summary">
            {counts?.total ?? total} relationships
            {segCounts?.counts?.attention != null &&
              ` · ${segCounts.counts.attention} need attention`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("sales.customer.create") && (
            <Link to="/customers/new" className="btn btn-primary" data-testid="new-customer-btn">
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              New customer
            </Link>
          )}
        </div>
      </header>
      <section className="space-y-4" data-testid="customer-filters">
        <div className="flex items-center gap-3">
          <label className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted"
              strokeWidth={1.75}
            />
            <input
              type="search"
              aria-label="Search customers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, code, PAN…"
              className="input !pl-10"
              data-testid="customer-search"
            />
          </label>
          <div className="flex items-center gap-2">
            <div className="hidden flex-wrap gap-2 md:flex">{filterFields}</div>
            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="e-chip inline-flex items-center gap-2 md:!hidden"
                  data-testid="filters-btn"
                >
                  <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} />
                  filters
                  {activeFilters > 0 && <em>{activeFilters}</em>}
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-[22px]" data-testid="filters-sheet">
                <SheetHeader>
                  <SheetTitle>filters.</SheetTitle>
                </SheetHeader>
                <div className="mt-4 grid gap-3">{filtersOpen && filterFields}</div>
              </SheetContent>
            </Sheet>
            <div
              className="inline-flex rounded-[10px] border border-warm-200 bg-white p-0.5"
              data-testid="view-toggle"
            >
              {[
                ["cards", LayoutGrid],
                ["table", Rows3],
              ].map(([v, I]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-label={v}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg transition-colors",
                    view === v ? "bg-ink-950 text-warm-50" : "text-txt-secondary hover:bg-warm-100",
                  )}
                  data-testid={`view-${v}`}
                >
                  <I className="h-4 w-4" strokeWidth={1.75} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
          data-testid="customer-segments"
        >
          {SEGMENTS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSeg(k)}
              className={cn("e-chip shrink-0", seg === k && "on")}
              data-testid={`segment-${k}`}
            >
              {l.toLowerCase()}
              {segCounts?.counts?.[k] != null && <em>{segCounts.counts[k]}</em>}
            </button>
          ))}
        </div>
      </section>
      {branch(
        !loading && items.length === 0,
        () => (
          <EmptyState
            icon={UserRound}
            title="No customers match"
            description="Try clearing a filter or search by phone."
            action={
              can("sales.customer.create") && (
                <Link to="/customers/new" className="btn btn-primary">
                  Add a customer
                </Link>
              )
            }
            testId="customers-empty"
          />
        ),
        view === "cards",
        () => (
          <div className="e-jgrid" data-testid="customers-grid">
            {items.map((c) => (
              <EliteCustomerCard key={c.id} c={c} />
            ))}
            {loading &&
              Array.from({ length: 3 }, (_, n) => n).map((n) => (
                <Skeleton key={n} className="h-[330px] rounded-[26px]" />
              ))}
          </div>
        ),
        () => (
          <div className="card overflow-x-auto !p-0" data-testid="customers-table">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-warm-200 text-left text-xs font-medium text-txt-muted">
                  {["Customer", "Phone", "Stage", "KYC", "RM", "Bookings", "Balance", "Since"].map(
                    (h) => (
                      <th key={h} className="px-4 py-3">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100">
                {items.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => nav(`/customers/${c.id}`)}
                    className="cursor-pointer transition-colors hover:bg-warm-50"
                    data-testid={`customer-row-${c.customer_code}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.full_name} size={32} />
                        <div>
                          <p className="font-semibold text-ink-950">{c.full_name}</p>
                          <p className="font-mono text-[11px] text-txt-muted">{c.customer_code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{c.phone}</td>
                    <td className="px-4 py-3">
                      {c.lifecycle_stage ? <StatusPill status={c.lifecycle_stage} /> : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={c.kyc_status} />
                    </td>
                    <td className="px-4 py-3 text-txt-secondary">
                      {people.find((p) => p.value === c.assigned_sales_user_id)?.label || "—"}
                    </td>
                    <td className="px-4 py-3">{c.bookings_count ?? 0}</td>
                    <td className="px-4 py-3">
                      <CardBalance k={c.card} testId={`customer-row-balance-${c.customer_code}`} />
                    </td>
                    <td className="px-4 py-3 text-txt-secondary">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
      <div ref={sentinel} className="h-4" />
      {items.length > 0 && (
        <p className="text-center text-xs text-txt-muted" data-testid="customers-count">
          {items.length} of {total} customers{label ? "" : ""}
        </p>
      )}
    </div>
  );
}
