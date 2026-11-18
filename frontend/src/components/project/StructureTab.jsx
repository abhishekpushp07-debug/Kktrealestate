import { useCallback, useEffect, useState } from "react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { toast } from "sonner";
import { Copy, Lock, Pencil, Plus, Building2 } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useFetch } from "@/hooks/useList";
import { inrShort } from "@/lib/format";
import { Card, Skeleton } from "@/components/v2";
import { cn } from "@/lib/utils";
import { TowerDialog } from "./TowerDialog";
import { AddFlatSheet } from "@/components/structure/StructureSheets";
import { TowerStructureEditor } from "@/components/structure/TowerStructureEditor";
import { FloorDesigner } from "@/components/structure/FloorDesigner";
import { FlatDrawer } from "@/components/common/FlatDrawer";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { Button } from "@/components/ui/button";

function WhatsLeft({ r, towers, onFix }) {
  const items = [
    ...r.project_checks.map((c) => ({ ...c, scope: "Project" })),
    ...towers.flatMap((t) => t.checks.map((c) => ({ ...c, scope: t.name, block_id: t.id }))),
  ];
  if (!items.length)
    return (
      <Card testId="structure-whats-left">
        <p className="text-sm text-sage" data-testid="whats-left-done">
          Everything is set up — towers, floors, flats, plans and prices are in place.
        </p>
      </Card>
    );
  return (
    <Card testId="structure-whats-left">
      <h3 className="e-caps-blue">
        What's left to set up{" "}
        <span className="text-sm font-normal text-txt-muted">({items.length})</span>
      </h3>
      <ul className="mt-3 divide-y divide-warm-100" data-testid="whats-left-list">
        {items.map((c) => (
          <li
            key={`${c.scope}-${c.code}`}
            className="flex items-center justify-between gap-3 py-2 text-sm"
            data-testid={`whats-left-${c.code}`}
          >
            <span>
              <span className="label-xs mr-2 text-txt-muted">{c.scope}</span>
              {c.label}
            </span>
            <Button
              variant="soft"
              size="compact"
              onClick={() => onFix(c)}
              data-testid={`whats-left-fix-${c.code}`}
            >
              {c.fix.label}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FlatChip({ f, onOpen }) {
  const locked = f.status === "Booked" || f.status === "Sold";
  return (
    <button
      type="button"
      onClick={() => onOpen(f.id)}
      className={cn(
        "flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left text-xs hover:border-ink-950",
        locked ? "border-amber2/40 bg-amber2-50/40" : "border-warm-200 bg-white",
      )}
      title={locked ? `Locked by ${f.booking_number || "booking"}` : f.status}
      data-testid={`flat-chip-${f.flat_number}`}
    >
      <span className="flex items-center gap-1 font-semibold">
        {locked && <Lock className="h-3 w-3 text-amber" />}
        {f.flat_number}
      </span>
      <span className="text-[11px] text-txt-muted">
        {f.flat_type_code}
        {f.saleable_sqft ? ` · ${f.saleable_sqft} sq.ft` : ""} ·{" "}
        {f.price != null ? inrShort(f.price) : <span className="text-brick">no price</span>}
      </span>
      {locked && (
        <span className="text-[10px] text-amber">Locked by {f.booking_number || "a booking"}</span>
      )}
    </button>
  );
}

function FloorRow({ t, fl, tpls, can, onChanged, onAddFlat, onOpenFlat }) {
  const [busy, setBusy] = useState(false);
  const cur = t.floor_templates?.[fl.floor] || "";
  const run = async (fn, msg) => {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(typeof msg === "function" ? msg(r.data) : msg);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = (id) => {
    if (!id) return;
    run(
      () =>
        api.post(`/blocks/${t.id}/floors/${fl.floor}/apply-template`, { floor_template_id: id }),
      (d) =>
        `Floor ${fl.label}: ${d.created} added, ${d.updated} updated${d.kept_locked.length ? `, ${d.kept_locked.length} locked kept` : ""}`,
    );
  };
  const copy = () => {
    const to = window.prompt(`Copy floor ${fl.label} to floors (e.g. 4-9 or 4,5,6):`);
    if (!to) return;
    const m = to.match(/^(\d+)\s*-\s*(\d+)$/);
    const list = m
      ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i)
      : to
          .split(",")
          .map((x) => parseInt(x, 10))
          .filter((n) => !Number.isNaN(n));
    if (!list.length) return;
    run(
      () => api.post(`/blocks/${t.id}/floors/${fl.floor}/copy`, { to_floors: list }),
      `Floor ${fl.label} copied to ${list.length} floor(s)`,
    );
  };
  return (
    <div className="py-3" data-testid={`floor-row-${t.code}-${fl.floor}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="w-20 font-semibold">Floor {fl.label}</span>
        <span className="text-xs text-txt-muted" data-testid={`floor-count-${t.code}-${fl.floor}`}>
          {fl.flats.length} flats{fl.locked ? ` · ${fl.locked} locked` : ""}
        </span>
        {can("masters.tower.edit") && (
          <NativeSelect
            className="input !h-8 !w-auto text-xs"
            value={cur}
            disabled={busy}
            onChange={(e) => apply(e.target.value)}
            data-testid={`floor-template-${t.code}-${fl.floor}`}
          >
            <option value="">{fl.flats.length ? "Custom" : "Floor template…"}</option>
            {tpls.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.preview}
              </option>
            ))}
          </NativeSelect>
        )}
        {can("masters.tower.edit") && (
          <div className="ml-auto flex gap-1">
            {fl.flats.length > 0 && (
              <Button
                variant="quiet"
                size="compact"
                disabled={busy}
                onClick={copy}
                data-testid={`floor-copy-${t.code}-${fl.floor}`}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy to floors…
              </Button>
            )}
            {can("masters.flat.create") && (
              <Button
                variant="quiet"
                size="compact"
                onClick={() => onAddFlat(fl.floor)}
                data-testid={`floor-add-flat-${t.code}-${fl.floor}`}
              >
                <Plus className="h-3.5 w-3.5" />
                Flat
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid={`floor-flats-${t.code}-${fl.floor}`}>
        {fl.flats.map((f) => (
          <FlatChip key={f.id} f={f} onOpen={onOpenFlat} />
        ))}
        {fl.flats.length === 0 && (
          <span className="text-xs text-txt-muted">
            Empty floor — pick a floor template or add flats one by one.
          </span>
        )}
      </div>
    </div>
  );
}

/** Project → Structure tab: the ONE place for towers, floors and flats. */
export function StructureTab({ projectId, can, onChanged, initialTower }) {
  const { data, loading, reload } = useFetch(`/projects/${projectId}/structure`);
  const [tpls, setTpls] = useState([]);
  const [sel, setSel] = useState(initialTower || null);
  const [dialog, setDialog] = useState(null); // "tower" | {flat, floor} | "edit" | "designer"
  const [flatId, setFlatId] = useState(null);
  useEffect(() => {
    api
      .get("/floor-templates")
      .then((r) => setTpls(r.data.items))
      .catch(() => {});
  }, []);
  const refresh = useCallback(() => {
    reload();
    onChanged?.();
  }, [reload, onChanged]);
  if (loading || !data) return <Skeleton className="h-96 rounded-2xl" />;
  const towers = data.towers;
  const t = towers.find((x) => x.id === sel) || towers[0];
  const onFix = (c) => {
    if (c.fix.action === "add_tower") setDialog("tower");
    else if (c.fix.to) window.location.assign(c.fix.to);
    else if (c.block_id) {
      setSel(c.block_id);
      setDialog(c.fix.action === "add_floors" ? null : "designer");
    }
  };
  const floors = t
    ? (t.all_floors || [])
        .map((lbl, i) => {
          const fl = t.floors_list.find(
            (x) => String(x.label) === String(lbl) || x.floor === (t.unit_floors || [])[i],
          );
          const num = fl?.floor ?? (t.unit_floors || [])[i];
          return {
            floor: num,
            label: lbl,
            flats: fl?.flats || [],
            locked: (fl?.flats || []).filter((f) => f.status === "Booked" || f.status === "Sold")
              .length,
          };
        })
        .filter((x) => x.floor !== undefined)
    : [];
  return (
    <div className="grid gap-6 xl:grid-cols-[300px_1fr]" data-testid="structure-tab">
      <div className="space-y-4">
        <Card className="!p-3" testId="structure-tower-list">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="label">Towers · {towers.length}</p>
            {can("masters.tower.create") && (
              <Button
                variant="primary"
                size="compact"
                onClick={() => setDialog("tower")}
                data-testid="structure-add-tower"
              >
                <Plus className="h-3.5 w-3.5" />
                Tower
              </Button>
            )}
          </div>
          {towers.length === 0 && (
            <p className="px-1 py-3 text-sm text-txt-muted" data-testid="structure-empty">
              No towers yet. “+ Tower” with a template builds floors, flats and plans in one go.
            </p>
          )}
          {towers.map((x) => (
            <button
              key={x.id}
              onClick={() => setSel(x.id)}
              className={cn(
                "mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left",
                x.id === t?.id ? "bg-ink-950 text-warm-50" : "hover:bg-warm-50",
              )}
              data-testid={`structure-tower-${x.code}`}
            >
              <span>
                <span className="font-semibold">{x.name}</span>
                <span
                  className={cn(
                    "block text-xs",
                    x.id === t?.id ? "text-warm-200/70" : "text-txt-muted",
                  )}
                >
                  {x.floors} floors · {x.units.total} flats · {x.units.by_status.Booked || 0} booked
                </span>
              </span>
              {x.missing_price > 0 && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    x.id === t?.id ? "bg-white/15" : "bg-brick/10 text-brick",
                  )}
                >
                  {x.missing_price} no price
                </span>
              )}
            </button>
          ))}
        </Card>
        <WhatsLeft r={data.readiness} towers={towers} onFix={onFix} />
      </div>
      <div className="space-y-4">
        {t ? (
          <Card testId={`structure-tower-panel-${t.code}`}>
            <div className="flex flex-wrap items-center gap-3">
              <Building2 className="h-5 w-5 text-txt-muted" />
              <h3 className="font-display text-xl">{t.name}</h3>
              <span className="text-xs text-txt-muted">
                {t.floors} floors · {t.units.total} flats · numbering like{" "}
                {t.numbering_pattern === "{floor}{pos2}"
                  ? "101"
                  : t.numbering_pattern === "{block}{seq}"
                    ? `${t.code}001`
                    : `${t.code}-101`}
              </span>
              <span className="text-xs text-txt-muted" data-testid={`structure-plans-${t.code}`}>
                ·{" "}
                {t.stage_plan.total
                  ? `stage plan ${t.stage_plan.completed}/${t.stage_plan.total}`
                  : "no stage plan"}{" "}
                ·{" "}
                {t.payment_plans.length
                  ? t.payment_plans.map((p) => p.name).join(", ")
                  : "no payment plan"}
              </span>
              <div className="ml-auto flex gap-1">
                <HistoryButton entityType="block" entityId={t.id} />
                {can("masters.tower.edit") && (
                  <>
                    <Button
                      variant="soft"
                      size="compact"
                      onClick={() => setDialog(dialog === "edit" ? null : "edit")}
                      data-testid="structure-edit-tower"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit tower
                    </Button>
                    <Button
                      variant="soft"
                      size="compact"
                      onClick={() => setDialog(dialog === "designer" ? null : "designer")}
                      data-testid="structure-bulk-edit"
                    >
                      Bulk edit flats
                    </Button>
                  </>
                )}
              </div>
            </div>
            {dialog === "edit" && (
              <div className="mt-4">
                <TowerStructureEditor
                  block={t}
                  onChanged={() => {
                    setDialog(null);
                    refresh();
                  }}
                />
              </div>
            )}
            {dialog === "designer" && (
              <div className="mt-4">
                <FloorDesigner blockId={t.id} can={can} onChanged={refresh} />
              </div>
            )}
            <div
              className="mt-3 divide-y divide-warm-100"
              data-testid={`structure-floors-${t.code}`}
            >
              {[...floors].reverse().map((fl) => (
                <FloorRow
                  key={fl.floor}
                  t={t}
                  fl={fl}
                  tpls={tpls}
                  can={can}
                  onChanged={refresh}
                  onAddFlat={(floor) => setDialog({ flat: true, floor })}
                  onOpenFlat={setFlatId}
                />
              ))}
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-txt-muted">Add the first tower to start.</p>
          </Card>
        )}
      </div>
      {dialog === "tower" && (
        <TowerDialog
          projectId={projectId}
          onClose={() => setDialog(null)}
          onCreated={(b) => {
            setDialog(null);
            setSel(b.id);
            refresh();
          }}
        />
      )}
      {dialog?.flat && t && (
        <AddFlatSheet
          tower={t}
          floor={dialog.floor}
          onClose={() => setDialog(null)}
          onSaved={(f) => {
            toast.success(`Flat ${f.flat_number} added`);
            setDialog(null);
            refresh();
          }}
        />
      )}
      {flatId && <FlatDrawer flatId={flatId} onClose={() => setFlatId(null)} onChanged={refresh} />}
    </div>
  );
}
