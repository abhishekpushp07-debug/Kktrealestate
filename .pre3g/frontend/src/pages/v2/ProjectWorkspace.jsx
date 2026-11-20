import { coverOf } from "@/components/project/ProjectCard";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { StructureTab } from "@/components/project/StructureTab";
import { PlansTab } from "@/components/project/PlansTab";
import { ProjectDialog } from "@/components/project/ProjectDialog";
import { ArrowUpRight, Pencil } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { inrShort, initials } from "@/lib/format";
import {
  Card,
  EmptyState,
  EntityCard,
  MiniBar,
  Money,
  PageHero,
  ProgressRing,
  Skeleton,
  StatusPill,
  Tabs,
  CELL,
} from "@/components/v2";
import { RateCardsTab, ParkingTab } from "@/components/common/ProjectTabs";
import { cn } from "@/lib/utils";
import { InventoryGrid } from "@/components/project/InventoryGrid";
import { ConstructionTab, ProjectReportLinks } from "@/components/project/ProjectParts";
import { TowerSalesChart } from "@/components/common/TowerSalesChart";
import { ConnectedTo } from "@/components/common/ConnectedTo";
import { PricingSetupTab } from "@/components/common/PricingSetupTab";
import { Button } from "@/components/ui/button";

const FlatsTable = lazy(() => import("@/components/common/FlatsTable"));
// REQ-123: five tabs; older ?tab= links land where their content now lives
const TABS = [
  ["overview", "Overview"],
  ["structure", "Structure"],
  ["inventory", "Inventory"],
  ["plans", "Plans & Pricing"],
  ["construction", "Construction"],
];
const LEGACY_TAB = {
  pricing: "plans",
  bookings: "overview",
  collections: "overview",
  reports: "overview",
};

function StageStrip({ k, n, testId }) {
  if (!n) return null;
  return (
    <div data-testid={testId}>
      <div className="flex gap-0.5">
        {Array.from({ length: n }, (_, i) => (
          <span
            key={i}
            className={cn("h-1.5 flex-1 rounded-full", i < k ? "bg-gold-600" : "bg-warm-200")}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-txt-secondary">
        Stage {k} of {n}
      </p>
    </div>
  );
}

function FlatDots({ by, testId }) {
  const order = ["Booked", "Sold", "Hold", "Available", "Blocked"];
  const dots = order.flatMap((st) =>
    Array.from({ length: by?.[st] || 0 }, (_, j) => ({ st, key: `${st}-${j}` })),
  );
  return (
    <div className="flex flex-wrap gap-1" data-testid={testId} aria-label="Flats by status">
      {dots.slice(0, 120).map(({ st, key }) => (
        <span key={key} className={cn("h-2.5 w-2.5 rounded-[3px]", CELL[st])} title={st} />
      ))}
    </div>
  );
}

function TowerCard({ t, pid, card }) {
  const c = t.construction;
  return (
    <Card hover className="flex flex-col gap-4" testId={`tower-card-${t.code}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            to={`/projects/${pid}?tab=structure&tower=${t.id}`}
            className="font-display text-xl text-ink-950 hover:text-gold"
          >
            {t.name}
          </Link>
          <p className="text-xs text-txt-secondary">
            {t.floors} floors · {t.units.total} units · {t.plans.length} plan
            {t.plans.length === 1 ? "" : "s"}
          </p>
        </div>
        <ProgressRing value={c.percent} size={52} stroke={5} />
      </div>
      <StageStrip k={card?.stage_k || 0} n={card?.stage_n || 0} testId={`tower-stages-${t.code}`} />
      <FlatDots by={t.units.by_status} testId={`tower-flats-${t.code}`} />
      <p className="text-xs text-txt-secondary">
        {Object.entries(t.units.by_status)
          .filter(([, v]) => v)
          .map(([k, v]) => `${v} ${k.toLowerCase()}`)
          .join(" · ")}
      </p>
      <div className="flex items-end justify-between border-t border-warm-100 pt-3 text-xs text-txt-secondary">
        <div>
          <p>Current stage</p>
          <p className="font-semibold text-ink-950">{c.current || "Not started"}</p>
        </div>
        <div className="text-right">
          <p>Next</p>
          <p className="font-semibold text-ink-950">{c.next || "Possession done"}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Link
          to={`/construction?project=${pid}&block=${t.id}`}
          className="btn btn-ghost btn-sm"
          data-testid={`tower-update-stage-${t.code}`}
        >
          Update stage
        </Link>
        <Link
          to={`/projects/${pid}?tab=structure&tower=${t.id}`}
          className="btn btn-ghost btn-sm"
          data-testid={`tower-open-structure-${t.code}`}
        >
          Floors &amp; flats
        </Link>
      </div>
    </Card>
  );
}

/** REQ-182: photos other than the cover, as a gallery on Overview. */
function ProjectGallery({ p }) {
  const rest = (p.photos || []).filter((x) => x.id !== p.cover_photo_id);
  if (!rest.length) return null;
  return (
    <div className="flex gap-3 overflow-x-auto pb-1" data-testid="project-gallery">
      {rest.map((ph, i) => (
        <a
          key={ph.id}
          href={ph.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0"
          data-testid={`project-gallery-${i}`}
        >
          <img
            src={ph.url}
            alt=""
            className="h-36 w-56 rounded-xl border border-line object-cover"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}

function Overview({ s, p, onEdit }) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <ProjectGallery p={p} />
        <Card testId="project-tower-sales">
          <h3 className="font-display text-xl">Tower sales progress</h3>
          <TowerSalesChart projectId={p.id} className="mt-3" />
        </Card>
        <div>
          <h3 className="mb-4 font-display text-xl">Towers</h3>
          <div className="grid gap-6 md:grid-cols-2">
            {s.towers.map((t) => (
              <TowerCard
                key={t.id}
                t={t}
                pid={p.id}
                card={(p.card?.towers || []).find((x) => x.id === t.id)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-6">
        <Card testId="project-whats-left">
          <h3 className="e-caps-blue">What's left to set up</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {Object.entries(s.checklist).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between">
                <span className="text-txt-secondary">{CHECK_LABEL[k] || k}</span>
                <span
                  className={cn("pill", v ? "bg-sage-50 text-sage" : "bg-amber2-50 text-amber2")}
                >
                  {v ? "Done" : "To do"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <Link to={`/projects/${p.id}?tab=structure`} className="btn btn-ghost btn-sm">
              Structure
            </Link>
            <Link to={`/projects/${p.id}?tab=plans`} className="btn btn-ghost btn-sm">
              Plans
            </Link>
            <Button variant="quiet" size="compact" onClick={onEdit} data-testid="project-edit-btn">
              <Pencil className="h-3.5 w-3.5" />
              Edit project
            </Button>
          </div>
        </Card>
        {p.amenities?.length > 0 && (
          <Card>
            <h3 className="e-caps-blue">Amenities</h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.amenities.map((a) => (
                <span key={a.id || a} className="pill bg-warm-100 text-txt-secondary">
                  {a.name || a}
                </span>
              ))}
            </div>
          </Card>
        )}
        {p.approvals?.length > 0 && (
          <Card>
            <h3 className="e-caps-blue">Approvals</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {p.approvals.map((a) => (
                <li key={a.name} className="flex justify-between">
                  <span>{a.name}</span>
                  <span className="text-txt-muted">{a.number || a.date || ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {p.team_members?.length > 0 && (
          <Card>
            <h3 className="e-caps-blue">Team</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {p.team_members.map((u) => (
                <span
                  key={u.id}
                  className="flex items-center gap-2 rounded-full bg-warm-100 py-1 pl-1 pr-3 text-xs"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-950 text-[10px] font-bold text-gold-400">
                    {initials(u.name)}
                  </span>
                  {u.name}
                </span>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Collections({ s, pid }) {
  const { data } = useFetch(`/projects/${pid}/summary`);
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  const o = data.outstanding;
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4" data-testid="collections-tab">
      {[
        ["Agreement value", data.agreement_paise],
        ["Collected", data.paid_paise],
        ["Outstanding · Cash", o.cash_paise],
        ["Outstanding · Account", o.account_paise],
        ["Outstanding · Other charges", o.other_charges_paise],
        ["Collected this month", data.collections_mtd_paise],
        ["Overdue", data.overdue.amount_paise],
        ["Pending cheques", data.pending_cheques_paise],
      ].map(([l, v]) => (
        <Card key={l} className="!p-5">
          <p className="label">{l}</p>
          <Money value={v / 100} className="mt-2 block text-2xl" />
        </Card>
      ))}
    </div>
  );
}

function BookingsTab({ pid, customers }) {
  const { data } = useFetch(`/bookings?project_id=${pid}&page_size=100&include=customer,flat`);
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  if (!data.items.length)
    return (
      <EmptyState
        title={customers ? "No customers yet" : "No bookings yet"}
        description="Bookings connect buyers to this project's units."
      />
    );
  if (customers) {
    const seen = new Map();
    data.items.forEach(
      (b) =>
        b.customer &&
        !seen.has(b.customer.id) &&
        seen.set(b.customer.id, { ...b.customer, flats: [] }),
    );
    data.items.forEach(
      (b) => b.customer && seen.get(b.customer.id).flats.push(b.flat?.flat_number),
    );
    return (
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {[...seen.values()].map((c) => (
          <EntityCard
            key={c.id}
            to={`/customers/${c.id}`}
            title={c.full_name}
            subtitle={c.phone}
            status={c.lifecycle_stage}
            meta={c.flats.filter(Boolean).map((f) => `Unit ${f}`)}
            testId={`cust-card-${c.customer_code}`}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {data.items.map((b) => (
        <EntityCard
          key={b.id}
          to={`/bookings/${b.id}`}
          title={b.booking_number}
          subtitle={`${b.customer?.full_name || b.customer_name} · Unit ${b.flat?.flat_number || b.flat_snapshot?.flat_number}`}
          status={b.status}
          meta={[inrShort(b.agreement_value_paise / 100), b.block_name]}
          foot={
            <>
              <span>
                Paid{" "}
                <Money value={(b.summary?.paid_paise || 0) / 100} short className="text-ink-950" />
              </span>
              <span>
                Due{" "}
                <Money
                  value={Math.max(b.summary?.due_paise || 0, 0) / 100}
                  short
                  className="text-brick"
                />
              </span>
            </>
          }
          testId={`booking-card-${b.booking_number}`}
        />
      ))}
    </div>
  );
}

const CHECK_LABEL = {
  has_towers: "Towers added",
  has_units: "Flats generated",
  stages_configured: "Construction stages set",
  plans_assigned: "Payment plans assigned",
  pricing_set: "Prices set",
};

export default function ProjectWorkspace() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = LEGACY_TAB[sp.get("tab")] || sp.get("tab") || "overview";
  const { can } = useAuth();
  const { data: p, loading, reload } = useFetch(`/projects/${id}`);
  const [editing, setEditing] = useState(false);
  const { data: s } = useFetch(`/projects/${id}/setup`);
  const { data: sum } = useFetch(`/projects/${id}/summary`);
  const crumbs = useMemo(
    () => [{ label: "Projects", to: "/projects" }, { label: p?.name }],
    [p?.name],
  );
  const fixedInventory = useMemo(() => ({ project_id: id }), [id]);
  if (loading || !p || !s)
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  const units = sum?.units;
  const noBookings = !(
    (units?.by_status?.Booked || 0) +
    (units?.by_status?.Sold || 0) +
    (sum?.paid_paise || 0)
  );
  return (
    <div className="space-y-6" data-testid="project-workspace">
      <PageHero
        cover={coverOf(p)}
        photo={p.cover_image_url?.startsWith("/api/") ? p.cover_image_url : null}
        crumbs={crumbs}
        title={p.name}
        subtitle={[
          p.project_type,
          `${s.towers.length} ${s.towers.length === 1 ? "tower" : "towers"}`,
          [p.address?.line1, p.address?.city].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join(" · ")}
        ring={sum?.progress_pct ?? 0}
        chips={
          <>
            {p.rera_number && <span className="pill pill-hero">RERA {p.rera_number}</span>}
            <StatusPill status={p.status} />
            <HistoryButton entityType="project" entityId={p.id} label={p.code} compact />
          </>
        }
        actions={
          <>
            {can("masters.project.edit") && (
              <Button
                onClick={() => setEditing(true)}
                variant="soft"
                className="!border-white/15 !bg-ink-800 !text-warm-50 hover:!bg-ink-700"
                data-testid="edit-setup-btn"
              >
                <Pencil className="h-4 w-4" strokeWidth={1.75} />
                Edit project
              </Button>
            )}
            {can("sales.booking.create") && (
              <Link
                to={`/bookings/new?project_id=${id}`}
                className="btn btn-gold"
                data-testid="new-booking-btn"
              >
                New booking <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            )}
          </>
        }
        stats={[
          {
            label: "Booked or sold",
            value: `${(units?.by_status?.Booked || 0) + (units?.by_status?.Sold || 0)} / ${units?.total ?? "—"}`,
            hint: `${units?.available ?? "—"} available`,
          },
          // a project with no bookings yet says so instead of a bare ₹0
          noBookings
            ? { label: "Collected", value: "—", hint: "No bookings yet" }
            : {
                label: "Collected",
                value: inrShort((sum?.paid_paise || 0) / 100),
                hint: `${inrShort((sum?.collections_mtd_paise || 0) / 100)} this month`,
              },
          noBookings
            ? { label: "Outstanding", value: "—", hint: "Nothing billed yet" }
            : {
                label: "Outstanding",
                value: inrShort((sum?.outstanding?.total_paise || 0) / 100),
                hint: `${sum?.overdue?.count || 0} overdue`,
                tone: sum?.outstanding?.total_paise ? undefined : "sage",
              },
          {
            label: "Upcoming stage",
            value: s.towers.map((t) => t.construction.next).find(Boolean) || "—",
            hint: s.towers.map((t) => `${t.name} ${t.construction.percent}%`).join(" · "),
          },
        ]}
        testId="project-hero"
      />
      {editing && (
        <ProjectDialog
          project={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      <Tabs
        tabs={TABS.map(([v, l]) => ({ value: v, label: l }))}
        value={tab}
        onChange={(v) => setSp({ tab: v })}
        testId="project-tabs"
      />
      <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
        {tab === "overview" && (
          <div className="space-y-8">
            <Overview s={s} p={p} onEdit={() => setEditing(true)} />
            <ProjectReportLinks id={id} can={can} />
            <section>
              <h3 className="mb-4 font-display text-xl">Collections</h3>
              {noBookings ? (
                <p className="text-sm text-txt-secondary" data-testid="project-collections-empty">
                  No bookings yet — collections start with the first booking.{" "}
                  {can("sales.booking.create") && (
                    <Link
                      to={`/bookings/new?project_id=${id}`}
                      className="font-semibold text-gold hover:underline"
                    >
                      New booking
                    </Link>
                  )}
                </p>
              ) : (
                <Collections s={s} pid={id} />
              )}
            </section>
            <section>
              <h3 className="mb-4 font-display text-xl">Customers</h3>
              <BookingsTab pid={id} customers />
            </section>
            <section>
              <h3 className="mb-4 font-display text-xl">Bookings</h3>
              <BookingsTab pid={id} />
            </section>
            <ConnectedTo entity="project" id={id} />
          </div>
        )}
        {tab === "structure" && (
          <StructureTab
            projectId={id}
            can={can}
            initialTower={sp.get("tower")}
            onChanged={reload}
          />
        )}
        {tab === "plans" && (
          <div className="space-y-6">
            <PlansTab projectId={id} can={can} />
            <PricingSetupTab projectId={id} can={can} />
            <RateCardsTab projectId={id} onApplied={reload} />
            <ParkingTab projectId={id} />
          </div>
        )}
        {tab === "inventory" && (
          <div className="space-y-6">
            <InventoryGrid projectId={id} />
            <Card className="!p-4">
              <FlatsTable fixed={fixedInventory} blocks={p.blocks} />
            </Card>
          </div>
        )}
        {tab === "construction" && <ConstructionTab towers={s.towers} pid={id} can={can} />}
      </Suspense>
    </div>
  );
}
