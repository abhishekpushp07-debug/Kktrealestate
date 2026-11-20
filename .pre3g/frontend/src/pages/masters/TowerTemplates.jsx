import { useEffect, useMemo, useState } from "react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TemplateList } from "./TemplateList";
import { useRowKeys } from "@/hooks/useRowKeys";

const PATTERNS = [
  ["{block}-{floor}{pos2}", "A-101"],
  ["{floor}{pos2}", "101"],
  ["{block}{seq}", "A001"],
];

export function TowerTemplateForm({ item, onClose, onSaved, floorTpls, stageTpls, payTpls }) {
  const [f, setF] = useState({
    name: item.name || "",
    floors: item.floors || 12,
    floor_start: item.floor_start ?? 1,
    ground_floor_label: item.ground_floor_label || "",
    numbering_pattern: item.numbering_pattern || "{block}-{floor}{pos2}",
    refuge_floors: (item.refuge_floors || []).join(","),
    podium_floors: (item.podium_floors || []).join(","),
    default_stage_plan_template_id: item.default_stage_plan_template_id || "",
    default_payment_plan_template_ids: item.default_payment_plan_template_ids || [],
    default_payment_plan_template_id: item.default_payment_plan_template_id || "",
  });
  const [map, setMap] = useState(
    item.floor_map?.length ? item.floor_map : [{ from: 1, to: 12, floor_template_id: "" }],
  );
  const [more, setMore] = useState(false);
  const keyedMap = useRowKeys(map);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const ints = (s) =>
    String(s)
      .split(",")
      .map((x) => parseInt(x, 10))
      .filter((n) => !Number.isNaN(n));
  const flats = useMemo(
    () =>
      map.reduce(
        (s, m) =>
          s +
          (floorTpls.find((t) => t.id === m.floor_template_id)?.flats_per_floor || 0) *
            Math.max(0, Number(m.to) - Number(m.from) + 1),
        0,
      ),
    [map, floorTpls],
  );
  const sp = stageTpls.find((t) => t.id === f.default_stage_plan_template_id);
  const pays = payTpls.filter((t) => f.default_payment_plan_template_ids.includes(t.id));
  const togglePay = (id) =>
    set(
      "default_payment_plan_template_ids",
      f.default_payment_plan_template_ids.includes(id)
        ? f.default_payment_plan_template_ids.filter((x) => x !== id)
        : [...f.default_payment_plan_template_ids, id],
    );
  const valid = f.name.trim() && Number(f.floors) >= 1 && map.every((m) => m.floor_template_id);
  const save = async () => {
    setErr(null);
    const body = {
      name: f.name.trim(),
      floors: Number(f.floors),
      floor_start: Number(f.floor_start),
      ground_floor_label: f.ground_floor_label || null,
      numbering_pattern: f.numbering_pattern,
      refuge_floors: ints(f.refuge_floors),
      podium_floors: ints(f.podium_floors),
      floor_map: map.map((m) => ({
        from: Number(m.from),
        to: Number(m.to),
        floor_template_id: m.floor_template_id,
      })),
      default_stage_plan_template_id: f.default_stage_plan_template_id || null,
      default_payment_plan_template_ids: f.default_payment_plan_template_ids,
      default_payment_plan_template_id: f.default_payment_plan_template_id || null,
      ...(item.id ? { version: item.version } : {}),
    };
    try {
      const r = item.id
        ? await api.patch(`/tower-templates/${item.id}`, body)
        : await api.post("/tower-templates", body);
      toast.success(`Tower template "${r.data.name}" saved`);
      onSaved(r.data);
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <div className="card space-y-4 !p-5" data-testid="tower-template-form">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block text-sm">
          <span className="label-xs">Template name *</span>
          <Input
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. G+11 standard"
            data-testid="tt-name"
          />
        </label>
        <label className="block text-sm">
          <span className="label-xs">Floors *</span>
          <Input
            type="number"
            min="1"
            max="200"
            value={f.floors}
            onChange={(e) => set("floors", e.target.value)}
            data-testid="tt-floors"
          />
        </label>
        <label className="block text-sm">
          <span className="label-xs">First floor number</span>
          <Input
            type="number"
            min="0"
            value={f.floor_start}
            onChange={(e) => set("floor_start", e.target.value)}
            data-testid="tt-floor-start"
          />
        </label>
        <label className="block text-sm">
          <span className="label-xs">Flat numbering</span>
          <NativeSelect
            className="input !h-10"
            value={f.numbering_pattern}
            onChange={(e) => set("numbering_pattern", e.target.value)}
            data-testid="tt-pattern"
          >
            {PATTERNS.map(([v, ex]) => (
              <option key={v} value={v}>
                like {ex}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div>
        <p className="label-xs mb-1">
          Floor templates by floor range{" "}
          <span className="font-normal normal-case text-txt-muted">
            (gaps are allowed — those floors stay empty for custom design)
          </span>
        </p>
        <div className="space-y-2" data-testid="tt-floor-map">
          {keyedMap.map(({ k, row: m }, i) => (
            <div key={k} className="grid grid-cols-[70px_20px_70px_1fr_36px] items-center gap-2">
              <Input
                type="number"
                value={m.from}
                onChange={(e) =>
                  setMap((a) => a.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                }
                data-testid={`tt-map-from-${i + 1}`}
              />
              <span className="text-center text-xs text-txt-muted">to</span>
              <Input
                type="number"
                value={m.to}
                onChange={(e) =>
                  setMap((a) => a.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))
                }
                data-testid={`tt-map-to-${i + 1}`}
              />
              <NativeSelect
                className="input !h-10"
                value={m.floor_template_id}
                onChange={(e) =>
                  setMap((a) =>
                    a.map((x, j) => (j === i ? { ...x, floor_template_id: e.target.value } : x)),
                  )
                }
                data-testid={`tt-map-template-${i + 1}`}
              >
                <option value="">Floor template…</option>
                {floorTpls.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.preview}
                  </option>
                ))}
              </NativeSelect>
              <button
                type="button"
                className="rounded p-1 text-brick hover:bg-warm-50"
                onClick={() => setMap((a) => a.filter((_, j) => j !== i))}
                data-testid={`tt-map-remove-${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() =>
            setMap((a) => [
              ...a,
              {
                from: (Number(a[a.length - 1]?.to) || Number(f.floor_start) - 1) + 1,
                to: Number(f.floor_start) + Number(f.floors) - 1,
                floor_template_id: "",
              },
            ])
          }
          data-testid="tt-map-add"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add range
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="label-xs">Stage plan (applied to the tower)</span>
          <NativeSelect
            className="input !h-10"
            value={f.default_stage_plan_template_id}
            onChange={(e) => set("default_stage_plan_template_id", e.target.value)}
            data-testid="tt-stage-plan"
          >
            <option value="">None — pick later on the Plans tab</option>
            {stageTpls.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.stages.length} stages)
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="text-sm">
          <span className="label-xs">Payment plans (applied to the tower) · ★ = default</span>
          <div className="mt-1 flex flex-wrap gap-2" data-testid="tt-payment-plans">
            {payTpls.map((t) => {
              const on = f.default_payment_plan_template_ids.includes(t.id);
              const isDef = f.default_payment_plan_template_id === t.id;
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
                    onClick={() => togglePay(t.id)}
                    data-testid={`tt-pay-${t.id}`}
                  >
                    {t.name}
                  </button>
                  {on && (
                    <button
                      type="button"
                      className={cn("border-l border-white/20 px-2 py-1", isDef && "text-gold-400")}
                      title="Default plan"
                      onClick={() => set("default_payment_plan_template_id", isDef ? "" : t.id)}
                      data-testid={`tt-pay-default-${t.id}`}
                    >
                      ★
                    </button>
                  )}
                </span>
              );
            })}
            {payTpls.length === 0 && (
              <span className="text-xs text-txt-muted">No payment plan templates yet.</span>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-txt-secondary"
        onClick={() => setMore((o) => !o)}
        data-testid="tt-more-toggle"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")} />
        More
      </button>
      {more && (
        <div className="grid gap-3 md:grid-cols-3" data-testid="tt-more">
          <label className="block text-sm">
            <span className="label-xs">Ground floor label</span>
            <Input
              value={f.ground_floor_label}
              onChange={(e) => set("ground_floor_label", e.target.value)}
              placeholder="G"
              data-testid="tt-ground-label"
            />
          </label>
          <label className="block text-sm">
            <span className="label-xs">Refuge floors (comma separated)</span>
            <Input
              value={f.refuge_floors}
              onChange={(e) => set("refuge_floors", e.target.value)}
              data-testid="tt-refuge"
            />
          </label>
          <label className="block text-sm">
            <span className="label-xs">Podium floors (comma separated)</span>
            <Input
              value={f.podium_floors}
              onChange={(e) => set("podium_floors", e.target.value)}
              data-testid="tt-podium"
            />
          </label>
        </div>
      )}
      <p className="rounded-lg bg-warm-50 px-3 py-2 text-sm" data-testid="tt-preview">
        <b>
          {f.floors} floors · {flats} flats
        </b>
        {sp ? ` · ${sp.name} stage plan` : ""}
        {pays.length
          ? ` · ${pays.map((p) => p.name + (p.id === f.default_payment_plan_template_id ? " (default)" : "")).join(", ")}`
          : ""}
      </p>
      {err && (
        <p className="rounded-md bg-brick-50 px-3 py-2 text-sm text-brick" data-testid="tt-error">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          className="bg-ink-950 hover:bg-ink-800"
          why={!valid ? "Type a name, floors, and a floor template per floor" : undefined}
          disabled={!valid}
          onClick={save}
          data-testid="tt-save"
        >
          Save template
        </Button>
        <Button variant="outline" onClick={onClose} data-testid="tt-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function useTemplateSets() {
  const [sets, setSets] = useState({ floorTpls: [], stageTpls: [], payTpls: [] });
  const load = () =>
    Promise.all([
      api.get("/floor-templates"),
      api.get("/stage-plan-templates"),
      api.get("/payment-plan-templates"),
    ])
      .then(([a, b, c]) =>
        setSets({ floorTpls: a.data.items, stageTpls: b.data.items, payTpls: c.data.items }),
      )
      .catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
  }, []);
  return sets;
}

export default function TowerTemplates() {
  const { can } = useAuth();
  const [items, setItems] = useState(null);
  const sets = useTemplateSets();
  const load = () =>
    api
      .get("/tower-templates", { params: { include_inactive: true } })
      .then((r) => setItems(r.data.items))
      .catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
  }, []);
  return (
    <TemplateList
      title="Tower Templates"
      subtitle="Floors, numbering, floor templates per range, stage plan and payment plans — one pick builds a whole tower on the Project → Structure tab."
      items={items}
      testId="tower-templates"
      perm={{
        create: can("masters.tower.create"),
        edit: can("masters.tower.edit"),
        del: can("masters.tower.edit"),
      }}
      onDelete={(t) => api.delete(`/tower-templates/${t.id}`)}
      onRestore={(t) => api.post(`/tower-templates/${t.id}/restore`)}
      reload={load}
      Form={TowerTemplateForm}
      formProps={sets}
      render={(t) => <p className="text-xs text-txt-secondary">{t.preview}</p>}
    />
  );
}
