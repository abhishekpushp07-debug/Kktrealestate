import { plural } from "@/lib/format";
import { NativeSelect } from "@/components/common/EliteInputs";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Star } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { Card, Skeleton } from "@/components/v2";
import { cn } from "@/lib/utils";
import { StageOrderEditor, useStages } from "@/pages/masters/StagePlanTemplates";
import { Button } from "@/components/ui/button";

function StagePlanInline({ row, stages, onDone }) {
  const [sel, setSel] = useState(row.stage_plan?.stages.map((s) => s.stage_id) || []);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/stage-plans/${row.stage_plan.id}`, {
        name: row.stage_plan.name,
        project_id: row.project_id,
        block_id: row.block_id,
        stage_ids: sel,
      });
      toast.success(`${row.block_name}: stage plan updated`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="mt-3 space-y-3 rounded-xl border border-warm-200 p-3"
      data-testid={`plans-stage-inline-${row.block_code}`}
    >
      <StageOrderEditor
        stages={stages}
        value={sel}
        onChange={setSel}
        testId={`plans-sp-${row.block_code}`}
      />
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="compact"
          why={!sel.length ? "Pick at least one stage" : undefined}
          disabled={busy || !sel.length}
          onClick={save}
          data-testid={`plans-stage-save-${row.block_code}`}
        >
          Save tower copy
        </Button>
        <Button variant="soft" size="compact" onClick={onDone}>
          Close
        </Button>
      </div>
    </div>
  );
}

function TowerPlansRow({ row, projectId, spTpls, ppTpls, stages, can, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // "stage" | plan id
  const run = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      onChanged();
    } catch (e) {
      const d = e.response?.data;
      toast.error(
        d?.code === "MISSING_STAGES" ? `${d.detail}` : errMsg(e),
        d?.code === "MISSING_STAGES" && can
          ? { action: { label: "Add missing stages", onClick: () => fixMissing(d) } }
          : undefined,
      );
    } finally {
      setBusy(false);
    }
  };
  const fixMissing = async (d) => {
    try {
      const sp = (
        await api.get(`/stage-plans/${d.stage_plan_id || d.error?.details?.[0]?.stage_plan_id}`)
      ).data;
      await api.patch(`/stage-plans/${sp.id}`, {
        name: sp.name,
        project_id: sp.project_id,
        block_id: sp.block_id,
        stage_ids: [...sp.stage_ids, ...(d.missing || d.error?.details?.[0]?.missing || [])],
      });
      toast.success("Stages added to the tower's stage plan — apply the payment plan again");
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const applySp = (id) => {
    if (!id) return;
    run(
      () => api.post(`/blocks/${row.block_id}/apply-stage-plan-template`, { template_id: id }),
      `${row.block_name}: stage plan applied`,
    );
  };
  const applyPp = (id, isDefault = false) =>
    run(
      () =>
        api.post(`/blocks/${row.block_id}/apply-payment-plan-template`, {
          template_id: id,
          is_default: isDefault,
        }),
      `${row.block_name}: payment plan ${isDefault ? "set as default" : "added"}`,
    );
  const spTplId = row.stage_plan?.template_id || "";
  return (
    <div className="py-4" data-testid={`plans-row-${row.block_code}`}>
      <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr] md:items-start">
        <div>
          <p className="font-semibold text-ink-950">{row.block_name}</p>
          <p className="text-xs text-txt-muted" data-testid={`plans-summary-${row.block_code}`}>
            {row.stage_plan
              ? `stage plan: ${row.stage_plan.name} (${row.stage_plan.count} stages)`
              : "no stage plan"}{" "}
            · plans:{" "}
            {row.payment_plans.length ? row.payment_plans.map((p) => p.name).join(", ") : "none"}
            {row.payment_plans.some((p) => p.is_default)
              ? ` (default ${row.payment_plans.find((p) => p.is_default).name})`
              : ""}
          </p>
        </div>
        <div>
          <p className="label-xs mb-1">Stage plan</p>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              className="input !h-9 !w-auto text-sm"
              value={spTplId}
              disabled={busy || !can}
              onChange={(e) => applySp(e.target.value)}
              data-testid={`plans-stage-select-${row.block_code}`}
            >
              <option value="">{row.stage_plan ? "Custom…" : "Pick a stage plan…"}</option>
              {spTpls.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.stages.length} stages)
                </option>
              ))}
            </NativeSelect>
            {row.stage_plan?.id && can && (
              <Button
                variant="quiet"
                size="compact"
                onClick={() => setOpen(open === "stage" ? null : "stage")}
                data-testid={`plans-stage-edit-${row.block_code}`}
              >
                Edit tower copy
              </Button>
            )}
          </div>
          {open === "stage" && row.stage_plan?.id && (
            <StagePlanInline
              row={{ ...row, project_id: projectId }}
              stages={stages}
              onDone={() => {
                setOpen(null);
                onChanged();
              }}
            />
          )}
        </div>
        <div>
          <p className="label-xs mb-1">
            Payment plans{" "}
            <span className="font-normal normal-case text-txt-muted">(★ default)</span>
          </p>
          <div className="flex flex-wrap gap-2" data-testid={`plans-payment-${row.block_code}`}>
            {ppTpls.map((t) => {
              const applied = row.payment_plans.find((p) => p.template_id === t.id);
              const isDef = applied?.is_default;
              return (
                <span
                  key={t.id}
                  className={cn(
                    "inline-flex items-center overflow-hidden rounded-full border text-xs",
                    applied ? "border-ink-950 bg-ink-950 text-white" : "border-warm-200",
                  )}
                >
                  <button
                    type="button"
                    className="px-3 py-1"
                    disabled={busy || !can || !!applied}
                    onClick={() => applyPp(t.id, row.payment_plans.length === 0)}
                    data-testid={`plans-pp-${row.block_code}-${t.id}`}
                  >
                    {t.name}
                  </button>
                  {applied && (
                    <button
                      type="button"
                      className={cn("border-l border-white/20 px-2 py-1", isDef && "text-gold-400")}
                      disabled={busy || !can || isDef}
                      title={isDef ? "Default plan" : "Make default"}
                      onClick={() => applyPp(t.id, true)}
                      data-testid={`plans-pp-default-${row.block_code}-${t.id}`}
                    >
                      <Star className="h-3 w-3" fill={isDef ? "currentColor" : "none"} />
                    </button>
                  )}
                </span>
              );
            })}
            {row.payment_plans
              .filter((p) => !p.template_id)
              .map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center rounded-full border border-warm-300 bg-warm-50 px-3 py-1 text-xs"
                  title="Tower-specific plan (no template)"
                >
                  {p.name}
                  {p.is_default && " ★"}
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Project → Plans tab: one row per tower — stage plan + payment plans from templates; tower copies editable inline. */
export function PlansTab({ projectId, can }) {
  const [data, setData] = useState(null);
  const [tpls, setTpls] = useState({ sp: [], pp: [] });
  const [all, setAll] = useState({ sp: "", pp: [], def: "" });
  const { stages } = useStages();
  const load = useCallback(
    () =>
      Promise.all([
        api.get(`/projects/${projectId}/plans`),
        api.get("/stage-plan-templates"),
        api.get("/payment-plan-templates"),
      ])
        .then(([a, b, c]) => {
          setData(a.data);
          setTpls({ sp: b.data.items, pp: c.data.items });
        })
        .catch((e) => toast.error(errMsg(e))),
    [projectId],
  );
  useEffect(() => {
    load();
  }, [load]);
  const editable = can("masters.stage_plan.create") && can("masters.payment_plan.create");
  const applyAll = async () => {
    try {
      const r = await api.post(`/projects/${projectId}/apply-plans-to-all`, {
        stage_plan_template_id: all.sp || null,
        payment_plan_template_ids: all.pp,
        default_payment_plan_template_id: all.def || null,
      });
      toast.success(`Applied to ${plural(r.data.towers.length, "tower")}`);
      r.data.errors.forEach((e) => toast.error(`${e.block}: ${e.message}`));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  if (!data) return <Skeleton className="h-80 rounded-2xl" />;
  return (
    <div className="space-y-6" data-testid="plans-tab">
      {editable && (
        <Card testId="plans-project-default">
          <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr_auto] md:items-end">
            <div>
              <p className="font-semibold text-ink-950">Project default</p>
              <p className="text-xs text-txt-muted">Apply the same plans to every tower.</p>
            </div>
            <label className="block text-sm">
              <span className="label-xs">Stage plan</span>
              <NativeSelect
                className="input !h-9"
                value={all.sp}
                onChange={(e) => setAll({ ...all, sp: e.target.value })}
                data-testid="plans-all-stage"
              >
                <option value="">Keep as is</option>
                {tpls.sp.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <div className="text-sm">
              <span className="label-xs">Payment plans (★ default)</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {tpls.pp.map((t) => {
                  const on = all.pp.includes(t.id);
                  return (
                    <span
                      key={t.id}
                      className={cn(
                        "inline-flex items-center overflow-hidden rounded-full border text-xs",
                        on ? "border-ink-950 bg-ink-950 text-white" : "border-warm-200",
                      )}
                    >
                      <button
                        type="button"
                        className="px-3 py-1"
                        onClick={() =>
                          setAll({
                            ...all,
                            pp: on ? all.pp.filter((x) => x !== t.id) : [...all.pp, t.id],
                            def: on && all.def === t.id ? "" : all.def,
                          })
                        }
                        data-testid={`plans-all-pp-${t.id}`}
                      >
                        {t.name}
                      </button>
                      {on && (
                        <button
                          type="button"
                          className={cn(
                            "border-l border-white/20 px-2 py-1",
                            all.def === t.id && "text-gold-400",
                          )}
                          onClick={() => setAll({ ...all, def: t.id })}
                          data-testid={`plans-all-def-${t.id}`}
                        >
                          ★
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
            <Button
              variant="primary"
              size="compact"
              why={!all.sp && !all.pp.length ? "Pick a stage plan or a payment plan" : undefined}
              disabled={!all.sp && !all.pp.length}
              onClick={applyAll}
              data-testid="plans-apply-all"
            >
              Apply to all towers
            </Button>
          </div>
        </Card>
      )}
      <Card testId="plans-towers">
        <div className="divide-y divide-warm-100">
          {data.towers.map((row) => (
            <TowerPlansRow
              key={row.block_id}
              row={row}
              projectId={projectId}
              spTpls={tpls.sp}
              ppTpls={tpls.pp}
              stages={stages}
              can={editable}
              onChanged={load}
            />
          ))}
          {data.towers.length === 0 && (
            <p className="py-4 text-sm text-txt-muted">
              No towers yet — add one on the Structure tab.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
