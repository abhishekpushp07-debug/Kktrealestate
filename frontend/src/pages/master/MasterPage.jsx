import { HistoryButton } from "@/components/common/HistoryTimeline";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Plus, Pencil, LayoutGrid, List, ChevronRight, Link2, Search } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useList } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { Card, StatusPill, EmptyState, Skeleton, Monogram } from "@/components/v2";
import { MASTERS } from "./masterConfig";
import { GenericMasterForm } from "./GenericMasterForm";
import { FlatTypeForm } from "./FlatTypeForm";
import { PaymentPlanForm } from "@/pages/master/PaymentPlanForm";
import { FloorPlanForm } from "./FloorPlanForm";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RowMenu } from "@/components/common/RowMenu";

const singular = (l) => l.replace(/ies$/, "y").replace(/s$/, "");
const inrWhole = (v) => `₹${new Intl.NumberFormat("en-IN").format(v)}`;
const chargeDefault = (r) => {
  const v = r.default_value ?? r.default_amount;
  if (!v) return "No default";
  return `Default ${r.calc_method === "percent_of_agreement" ? `${r.default_value}%` : inrWhole(v)}`;
};
const summary = (kind, r) => {
  if (kind === "flat-types")
    return (
      `${r.bhk} BHK · ${r.rooms?.length || 0} rooms · ${r.areas?.length || 0} ` +
      `areas${r.base_rate_per_sqft ? ` · ₹${r.base_rate_per_sqft}/sq ft` : ""}`
    );
  if (kind === "floor-plan-templates")
    return `${r.flats_per_floor} flats / floor · ${r.positions?.filter((p) => p.is_corner).length || 0} corners`;
  if (kind === "payment-plans")
    return `${r.plan_type} · ${r.installments?.map((i) => `${i.percent}%`).join(" + ")}`;
  if (kind === "bank-accounts") return `${r.account_name} · ${r.account_number_masked} · ${r.ifsc}`;
  if (kind === "charge-types")
    return (
      `${chargeDefault(r)} · GST ${r.default_gst_percent ?? 0}% ` +
      `· ${r.is_taxable ? "Taxable" : "Non-taxable"}`
    );
  if (kind === "amenities") return `${r.category}${r.description ? ` · ${r.description}` : ""}`;
  if (kind === "plc-types")
    return `${r.calc.replace("_", " ")}${r.description ? ` · ${r.description}` : ""}`;
  if (kind === "payment-modes")
    return r.requires_reference ? "Reference no. required" : "Reference optional";
  if (kind === "document-types") return `Applies to ${r.applies_to}`;
  if (kind === "construction-stages")
    return `Order ${r.seq_hint ?? "—"}${r.is_possession ? " · Possession" : ""}`;
  if (kind === "allocation-categories") return r.bookable ? "Bookable" : "Not bookable";
  return r.description || "";
};

export default function MasterPage() {
  const { kind } = useParams();
  const cfg = MASTERS.find((m) => m.kind === kind);
  // G1: an unknown list says so instead of silently opening another master
  if (!cfg)
    return (
      <EmptyState
        title="Unknown list"
        description={`There is no master list called "${kind}".`}
        testId="master-unknown"
      />
    );
  return <MasterList key={cfg.kind} cfg={cfg} />;
}

function MasterList({ cfg }) {
  const { can } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const [view, setView] = useState("cards");
  const [q, setQ] = useState("");
  const list = useList(`/master/${cfg.kind}`, {
    include_inactive: showInactive || undefined,
    include_usage: true,
    page_size: 100,
  });
  const [qs] = useSearchParams();
  const [editing, setEditing] = useState(qs.get("new") === "1" ? null : undefined);
  const [confirm, setConfirm] = useState(null);
  const write = can("masters.payment_plan.edit");
  const items = (list.items || list.rows || []).filter(
    (r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()),
  );

  const toggle = async (row) => {
    try {
      await api.post(`/master/${cfg.kind}/${row.id}/${row.is_active ? "deactivate" : "activate"}`);
      toast.success(row.is_active ? "Deactivated" : "Reactivated");
      list.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setConfirm(null);
    }
  };
  const askToggle = (row) => (row.is_active && row.usage_count ? setConfirm(row) : toggle(row));
  const FormComp =
    cfg.custom === "flatType"
      ? FlatTypeForm
      : cfg.custom === "paymentPlan"
        ? PaymentPlanForm
        : cfg.custom === "floorPlan"
          ? FloorPlanForm
          : GenericMasterForm;
  const nameOf = (r) => r.name || r.bank_name || r.title;
  const cols = cfg.columns.filter((c) => c.key !== "code"); // codes stay in the edit form, not on screen
  const Actions = ({ r }) =>
    write && (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-1.5 text-[11px] text-txt-secondary">
          <Switch
            checked={!!r.is_active}
            onCheckedChange={() => askToggle(r)}
            aria-label={r.is_active ? "Active" : "Inactive"}
            data-testid={`master-toggle-${r.id}`}
          />
          {r.is_active ? "Active" : "Inactive"}
        </label>
        <HistoryButton entityType={cfg.kind.replace(/-/g, "_")} entityId={r.id} label={r.name} />
        <RowMenu
          testId={`master-menu-${r.id}`}
          items={[
            {
              label: "Edit",
              icon: Pencil,
              onClick: () => setEditing(r),
              testId: `master-edit-${r.id}`,
            },
          ]}
        />
      </div>
    );

  return (
    <div className="space-y-8" data-testid="master-page">
      <nav
        className="flex items-center gap-1.5 text-[13px] text-txt-secondary"
        aria-label="Breadcrumb"
      >
        <Link to="/settings" className="hover:text-ink-950">
          Settings
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link to="/settings/catalogues" className="hover:text-ink-950">
          Catalogues
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-ink-950">{cfg.label}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="e-title" data-testid="page-title">
            {cfg.label.toLowerCase()}.
          </h1>
          <p className="e-sub" data-testid="master-summary">
            {list.total ?? items.length} {list.total === 1 ? "entry" : "entries"} · used across
            projects, bookings and payments · deactivating keeps history
          </p>
        </div>
        {write && (
          <Button onClick={() => setEditing(null)} variant="primary" data-testid="master-new-btn">
            <Plus className="h-4 w-4" />
            New {singular(cfg.label).toLowerCase()}
          </Button>
        )}
      </header>
      <div className="flex flex-wrap gap-2" data-testid="master-tabs">
        {MASTERS.map((m) => (
          <Link
            key={m.kind}
            to={`/masters/m/${m.kind}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              m.kind === cfg.kind
                ? "border-ink-950 bg-ink-950 text-warm-50"
                : "border-warm-200 bg-white text-txt-secondary hover:border-gold hover:text-ink-950",
            )}
            data-testid={`master-tab-${m.kind}`}
          >
            {m.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" />
          <input
            className="input !pl-9"
            placeholder={`Search ${cfg.label.toLowerCase()}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="master-search"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-txt-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--text-1)]"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            data-testid="master-show-inactive"
          />
          Show inactive
        </label>
        <div className="ml-auto flex rounded-[10px] bg-warm-100 p-1" role="tablist">
          {[
            ["cards", LayoutGrid],
            ["table", List],
          ].map(([v, I]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-lg px-2.5 py-1.5",
                view === v ? "bg-white shadow-sm text-ink-950" : "text-txt-secondary",
              )}
              aria-label={`${v} view`}
              data-testid={`master-view-${v}`}
            >
              <I className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
      {list.loading && !items.length ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={`No ${cfg.label.toLowerCase()}`}
          description={write ? "Create the first one to start using it in dropdowns." : undefined}
          action={
            write && (
              <Button onClick={() => setEditing(null)} variant="primary">
                Add {singular(cfg.label).toLowerCase()}
              </Button>
            )
          }
          testId="master-empty"
        />
      ) : view === "cards" ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="master-cards">
          {items.map((r) => (
            <Card
              key={r.id}
              hover
              className={cn("!p-5", !r.is_active && "opacity-60")}
              onClick={write ? () => setEditing(r) : undefined}
              testId={`master-card-${r.id}`}
            >
              <div className="flex items-start gap-3">
                <Monogram name={nameOf(r)} className="h-10 w-10 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink-950">{nameOf(r)}</p>
                  <p className="truncate text-xs text-txt-secondary">
                    {[summary(cfg.kind, r)]
                      .filter(Boolean)
                      .reduce((acc, x, i) => (i ? [...acc, " · ", x] : [x]), [])}
                  </p>
                </div>
                <StatusPill status={r.is_active ? "Active" : "Inactive"} />
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-warm-100 pt-3">
                <span
                  className="flex items-center gap-1.5 text-xs text-txt-muted"
                  data-testid={`master-usage-${r.id}`}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {`Used in ${r.usage_count ?? 0} ${r.usage_label || "places"}`}
                </span>
                <Actions r={r} />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="!p-0 overflow-hidden" testId="master-table">
          <div className="overflow-x-auto">
            <table className="stack-table w-full text-sm">
              <thead className="bg-warm-100 text-[11px] font-semibold uppercase tracking-wider text-txt-secondary">
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} className={cn("px-4 py-3 text-left", c.className)}>
                      {c.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left">Used in</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "h-11 border-t border-warm-100",
                      i % 2 && "bg-warm-50/60",
                      write && "cursor-pointer hover:bg-warm-100/60",
                    )}
                    onClick={write ? () => setEditing(r) : undefined}
                    data-testid={`master-row-${r.id}`}
                  >
                    {cols.map((c) => (
                      <td key={c.key} className={cn("px-4", c.className)}>
                        {c.render ? c.render(r) : (r[c.key] ?? "—")}
                      </td>
                    ))}
                    <td className="px-4 text-xs text-txt-secondary">{r.usage_count ?? 0}</td>
                    <td className="px-4">
                      <StatusPill status={r.is_active ? "Active" : "Inactive"} />
                    </td>
                    <td className="px-4 text-right">
                      <Actions r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {editing !== undefined && (
        <FormComp
          key={editing?.id || "new"}
          cfg={cfg}
          item={editing}
          open
          onOpenChange={(o) => !o && setEditing(undefined)}
          onSaved={list.reload}
          existing={list.items || list.rows || []}
        />
      )}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent data-testid="master-deactivate-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              Deactivate “{confirm && nameOf(confirm)}”?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-txt-secondary">
            It is used in{" "}
            <b className="text-ink-950">
              {confirm?.usage_count} {confirm?.usage_label}
            </b>
            . Existing records keep their reference; it just disappears from new dropdowns.
          </p>
          <DialogFooter>
            <Button variant="soft" onClick={() => setConfirm(null)}>
              Keep active
            </Button>
            <Button
              variant="danger"
              onClick={() => toggle(confirm)}
              data-testid="master-deactivate-confirm"
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
