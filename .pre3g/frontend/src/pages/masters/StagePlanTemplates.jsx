import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TemplateList } from "./TemplateList";

/** Ordered stage list reused by Stage Plan Templates and the per-tower copy editor on the Plans tab. */
export function StageOrderEditor({ stages, value, onChange, testId = "sp" }) {
  const byId = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);
  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const move = (i, d) => {
    const a = [...value];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    onChange(a);
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="label-xs mb-1">Tick stages</p>
        <div
          className="max-h-72 space-y-1 overflow-auto rounded-md border p-2"
          data-testid={`${testId}-picker`}
        >
          {stages.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-warm-50"
            >
              <input
                type="checkbox"
                checked={value.includes(s.id)}
                onChange={() => toggle(s.id)}
                data-testid={`${testId}-pick-${s.code || s.id}`}
              />
              {s.name}
              {s.auto_complete_on_booking && (
                <span className="rounded-full bg-gold-light px-1.5 text-[10px] font-bold text-[var(--accent)]">
                  at booking
                </span>
              )}
              {s.is_possession && (
                <span className="rounded-full bg-amber2-50 px-1.5 text-[10px] font-bold text-[var(--accent)]">
                  possession
                </span>
              )}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="label-xs mb-1">Order ({value.length})</p>
        <ol className="space-y-1 rounded-md border p-2" data-testid={`${testId}-order`}>
          {value.map((id, i) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded bg-warm-50/60 px-2 py-1 text-sm"
              data-testid={`${testId}-order-${i + 1}`}
            >
              <span className="w-5 text-xs font-bold text-txt-secondary">{i + 1}</span>
              <span className="flex-1">{byId[id]?.name}</span>
              <button
                type="button"
                onClick={() => move(i, -1)}
                className="rounded p-1 hover:bg-white"
                data-testid={`${testId}-up-${i + 1}`}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                className="rounded p-1 hover:bg-white"
                data-testid={`${testId}-down-${i + 1}`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => toggle(id)}
                className="rounded p-1 text-brick hover:bg-white"
                data-testid={`${testId}-remove-${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {value.length === 0 && (
            <li className="px-2 py-3 text-xs text-txt-secondary">Tick stages on the left.</li>
          )}
        </ol>
      </div>
    </div>
  );
}

export function useStages() {
  const [stages, setStages] = useState([]);
  const load = () =>
    api
      .get("/master/construction-stages?page_size=200")
      .then((r) => setStages(r.data.items.filter((s) => s.is_active)))
      .catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
  }, []);
  return { stages, reload: load };
}

export function StagePlanTemplateForm({ item, onClose, onSaved, stages, reloadStages }) {
  const [name, setName] = useState(item.name || "");
  const [sel, setSel] = useState(item.stage_ids || []);
  const [newStage, setNewStage] = useState("");
  const [err, setErr] = useState(null);
  const addStage = async () => {
    if (!newStage.trim()) return;
    try {
      const r = await api.post("/master/construction-stages", {
        name: newStage.trim(),
        code: newStage
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .slice(0, 20),
        seq_hint: 50,
      });
      toast.success(`Stage "${r.data.name}" added`);
      setNewStage("");
      await reloadStages();
      setSel((s) => [...s, r.data.id]);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const save = async () => {
    setErr(null);
    const body = {
      name: name.trim(),
      stage_ids: sel,
      ...(item.id ? { version: item.version } : {}),
    };
    try {
      const r = item.id
        ? await api.patch(`/stage-plan-templates/${item.id}`, body)
        : await api.post("/stage-plan-templates", body);
      toast.success(`Stage plan template "${r.data.name}" saved`);
      onSaved(r.data);
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <div className="card space-y-4 !p-5" data-testid="stage-plan-template-form">
      <label className="block text-sm md:w-1/2">
        <span className="label-xs">Template name *</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. G+11 standard"
          data-testid="spt-name"
        />
      </label>
      <StageOrderEditor stages={stages} value={sel} onChange={setSel} testId="spt" />
      <div className="flex gap-2 md:w-1/2">
        <Input
          placeholder="Quick-add a stage to the master…"
          value={newStage}
          onChange={(e) => setNewStage(e.target.value)}
          className="h-9"
          data-testid="spt-quick-add-input"
        />
        <Button size="sm" variant="outline" onClick={addStage} data-testid="spt-quick-add-btn">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {err && (
        <p className="rounded-md bg-brick-50 px-3 py-2 text-sm text-brick" data-testid="spt-error">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          className="bg-ink-950 hover:bg-ink-800"
          why={!name.trim() || !sel.length ? "Type a name and pick stages" : undefined}
          disabled={!name.trim() || !sel.length}
          onClick={save}
          data-testid="spt-save"
        >
          Save template
        </Button>
        <Button variant="outline" onClick={onClose} data-testid="spt-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function StagePlanTemplates() {
  const { can } = useAuth();
  const [items, setItems] = useState(null);
  const { stages, reload } = useStages();
  const load = () =>
    api
      .get("/stage-plan-templates", { params: { include_inactive: true } })
      .then((r) => setItems(r.data.items))
      .catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
  }, []);
  return (
    <TemplateList
      title="Stage Plan Templates"
      subtitle="Ordered construction stages. Applying to a tower gives it an editable copy; the template stays as is."
      items={items}
      testId="stage-plan-templates"
      perm={{
        create: can("masters.stage_plan.create"),
        edit: can("masters.stage_plan.edit"),
        del: can("masters.stage_plan.delete"),
      }}
      onDelete={(t) => api.delete(`/stage-plan-templates/${t.id}`)}
      onRestore={(t) => api.post(`/stage-plan-templates/${t.id}/restore`)}
      reload={load}
      Form={StagePlanTemplateForm}
      formProps={{ stages, reloadStages: reload }}
      render={(t) => (
        <ol className="mt-1 flex flex-wrap gap-1">
          {t.stages.map((s) => (
            <li
              key={s.stage_id}
              className="rounded-full bg-warm-50 px-2 py-0.5 text-[11px] text-ink-950"
            >
              {s.seq}. {s.name}
            </li>
          ))}
        </ol>
      )}
    />
  );
}
