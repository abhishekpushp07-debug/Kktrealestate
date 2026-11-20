import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { branch } from "@/lib/branch";
import { Link } from "react-router-dom";
import { FileSignature, Plus, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useList } from "@/hooks/useList";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { Card, EmptyState, Money, Skeleton, StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Avatar, CardBalance } from "@/components/v2/CustomerBits";
import { KycBadge } from "@/components/common/KycSlots";
import { Button } from "@/components/ui/button";

const STATUSES = ["Active", "Completed", "Cancelled"];

const SEG = {
  paid: "bg-sage",
  part: "bg-amber",
  overdue: "bg-brick",
  billed: "bg-gold-500",
  awaiting: "bg-warm-200",
};

function PlanBar({ k, testId }) {
  const p = k?.plan;
  if (!p?.segments?.length) return null;
  return (
    <div className="my-4" data-testid={testId}>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {p.segments.map((x) => (
          <span
            key={x.seq}
            className={cn("h-full", SEG[x.status])}
            style={{ flexGrow: x.percent || 1 }}
            title={`${x.name} · ${x.percent}% · ${x.status}`}
          />
        ))}
      </div>
      <p className="mt-2 text-sm text-txt-secondary">
        {p.stage_n ? `Stage ${p.stage_k} of ${p.stage_n}` : "No stages"}
        {p.next_stage ? ` · next: ${p.next_stage}` : ""}
      </p>
    </div>
  );
}

export function BookingTile({ b }) {
  const agr = b.agreement_value_paise || 1;
  return (
    <Link
      to={`/bookings/${b.id}`}
      className="block h-full"
      data-testid={`booking-card-${b.booking_number}`}
    >
      <Card hover className="flex h-full flex-col !rounded-[18px] !p-5">
        <div className="flex items-start gap-3">
          <Avatar name={b.customer_name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-bold text-ink-950">{b.customer_name}</p>
            <p className="truncate text-xs text-txt-secondary">
              {b.booking_number} · {fmtDate(b.booking_date)}
            </p>
          </div>
          <StatusPill status={b.status} />
        </div>
        {b.kyc_completeness?.total > 0 && (
          <div className="mt-2">
            <KycBadge k={b.kyc_completeness} testId={`booking-kyc-${b.booking_number}`} />
          </div>
        )}
        <p className="e-caps mt-3 truncate !text-[10.5px]">
          {[
            b.project_code,
            b.block_code || b.block_name,
            b.flat_snapshot?.flat_number,
            b.flat_snapshot?.flat_type_code,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <PlanBar k={b.card} testId={`booking-plan-${b.booking_number}`} />
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-warm-100 pt-3 text-sm">
          <CardBalance k={b.card?.balance} testId={`booking-balance-${b.booking_number}`} />
          <span className="text-txt-secondary">
            Agreement <Money value={agr / 100} short className="text-ink-950" />
          </span>
        </div>
      </Card>
    </Link>
  );
}

export default function Bookings() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const [f, setF] = useState({
    status: sp.get("status") || "Active",
    project_id: sp.get("project_id") || null,
  });
  const range = sp.get("date_from")
    ? { date_from: sp.get("date_from"), date_to: sp.get("date_to") }
    : {};
  const list = useList(
    "/bookings",
    { status: f.status || undefined, project_id: f.project_id || undefined, ...range },
    { sort: "-booking_date", pageSize: 24 },
  );
  const { data: projects } = useFetch("/projects?page_size=100&with_total=false");
  const pages = Math.max(1, Math.ceil((list.total || 0) / list.pageSize));
  return (
    <div className="space-y-6 md:space-y-8" data-testid="bookings-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="e-title" data-testid="page-title">
            bookings.
          </h1>
          <p className="e-sub" data-testid="bookings-summary">
            {list.status_counts?.Active ?? 0} active · {list.status_counts?.Completed ?? 0}{" "}
            completed · {list.status_counts?.Cancelled ?? 0} cancelled
          </p>
        </div>
        {can("sales.booking.create") && (
          <Link to="/bookings/new" className="btn btn-primary" data-testid="new-booking-btn">
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            New booking
          </Link>
        )}
      </header>
      <section
        className="flex flex-col gap-3 md:flex-row md:items-center"
        data-testid="booking-filters"
      >
        <label className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted"
            strokeWidth={1.75}
          />
          <input
            value={list.search}
            onChange={(e) => list.setSearch(e.target.value)}
            placeholder="Booking no., customer, flat…"
            className="input !pl-10"
            data-testid="booking-search"
          />
        </label>
        <Select
          options={(projects?.items || []).map((p) => ({
            value: p.id,
            label: p.name,
            sub: p.code,
          }))}
          value={f.project_id}
          onChange={(v) => setF({ ...f, project_id: v })}
          placeholder="All projects"
          allowAdd={false}
          className="w-56"
          testId="filter-project"
        />
        <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {["", ...STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setF({ ...f, status: s })}
              className={cn("e-chip shrink-0", f.status === s && "on")}
              data-testid={`chip-status-${(s || "all").toLowerCase()}`}
            >
              {(s || "All").toLowerCase()}
              {list.status_counts && (
                <em
                  className="tabular-nums"
                  data-testid={`chip-count-${(s || "all").toLowerCase()}`}
                >
                  {s
                    ? list.status_counts[s] || 0
                    : Object.values(list.status_counts).reduce((a, n) => a + n, 0)}
                </em>
              )}
            </button>
          ))}
        </div>
      </section>
      {branch(
        list.loading && list.items.length === 0,
        () => (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, n) => n).map((n) => (
              <Skeleton key={n} className="h-56 rounded-2xl" />
            ))}
          </div>
        ),
        list.items.length === 0,
        () => (
          <EmptyState
            icon={FileSignature}
            title="No bookings"
            description="Bookings appear here once a unit is sold."
            testId="bookings-empty"
          />
        ),
        () => (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="bookings-grid">
            {list.items.map((b) => (
              <BookingTile key={b.id} b={b} />
            ))}
          </div>
        ),
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2" data-testid="bookings-pager">
          <Button
            why={list.page <= 1 ? "Already on the first page" : undefined}
            disabled={list.page <= 1}
            onClick={() => list.setPage(list.page - 1)}
            variant="soft"
            size="compact"
          >
            Previous
          </Button>
          <span className="text-xs text-txt-secondary">
            Page {list.page} of {pages}
          </span>
          <Button
            why={list.page >= pages ? "Already on the last page" : undefined}
            disabled={list.page >= pages}
            onClick={() => list.setPage(list.page + 1)}
            variant="soft"
            size="compact"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
