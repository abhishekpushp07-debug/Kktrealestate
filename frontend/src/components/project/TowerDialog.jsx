import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Field } from "@/components/v2";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const PATTERNS = [
  ["{block}-{floor}{pos2}", "A-101"],
  ["{floor}{pos2}", "101"],
  ["{block}{seq}", "A001"],
];

/** THE "+ Tower" dialog (single implementation: Structure tab + QuickCreate). Template → floors, flats and plans in one action. */
export function TowerDialog({ projectId, onClose, onCreated }) {
  const [tpls, setTpls] = useState(null);
  const [f, setF] = useState({
    name: "",
    code: "",
    tower_template_id: "",
    floors: 10,
    numbering_pattern: "{block}-{floor}{pos2}",
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => {
    api
      .get("/tower-templates")
      .then((r) => setTpls(r.data.items))
      .catch(() => setTpls([]));
  }, []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const tpl = (tpls || []).find((t) => t.id === f.tower_template_id);
  const save = async () => {
    setBusy(true);
    setErr(null);
    const body = {
      name: f.name.trim(),
      code: f.code.trim().toUpperCase(),
      tower_template_id: f.tower_template_id || null,
      ...(f.tower_template_id
        ? {}
        : { floors: Number(f.floors), numbering_pattern: f.numbering_pattern }),
    };
    try {
      const r = await api.post(`/projects/${projectId}/towers-from-template`, body);
      const d = r.data;
      toast.success(
        tpl
          ? "" +
              d.block.name +
              ": " +
              d.floors_applied +
              " floors, " +
              d.flats_created +
              " flats" +
              (d.stage_plan ? ", stage " + "plan" : "") +
              (d.payment_plans.length ? ` and ${d.payment_plans.length} payment plan(s)` : "") +
              " created"
          : `${d.block.name} created — add floor templates per floor`,
      );
      if (d.warnings?.length) setResult(d);
      else onCreated(d.block);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md"
        data-testid="tower-dialog"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">New tower</SheetTitle>
        </SheetHeader>
        <div className="mt-5 space-y-4 text-sm">
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <Field label="Tower name" required>
              <input
                className="input !h-10"
                value={f.name}
                onChange={(e) => {
                  set("name", e.target.value);
                  if (!f.code || f.code === f.name.trim().slice(-1).toUpperCase())
                    set("code", e.target.value.trim().slice(-1).toUpperCase());
                }}
                placeholder="Tower A"
                data-testid="tower-name"
              />
            </Field>
            <Field label="Code" required>
              <input
                className="input !h-10 uppercase"
                value={f.code}
                onChange={(e) => set("code", e.target.value)}
                maxLength={10}
                data-testid="tower-code"
              />
            </Field>
          </div>
          <Field
            label="Tower template"
            hint={
              tpl
                ? tpl.preview
                : "Pick one to create floors, flats, stage plan and payment plans in one go."
            }
          >
            <NativeSelect
              className="input !h-10"
              value={f.tower_template_id}
              onChange={(e) => set("tower_template_id", e.target.value)}
              data-testid="tower-template"
            >
              <option value="">No template — I'll design floors myself</option>
              {(tpls || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {!f.tower_template_id && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Floors" required>
                <input
                  type="number"
                  min="1"
                  max="200"
                  className="input !h-10"
                  value={f.floors}
                  onChange={(e) => set("floors", e.target.value)}
                  data-testid="tower-floors"
                />
              </Field>
              <Field label="Flat numbering">
                <NativeSelect
                  className="input !h-10"
                  value={f.numbering_pattern}
                  onChange={(e) => set("numbering_pattern", e.target.value)}
                  data-testid="tower-pattern"
                >
                  {PATTERNS.map(([v, ex]) => (
                    <option key={v} value={v}>
                      like {ex}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
          {err && (
            <p
              className="rounded-lg border border-brick/30 bg-brick/5 px-3 py-2 text-xs text-brick"
              data-testid="tower-error"
            >
              {err}
            </p>
          )}
          {result && (
            <div
              className="rounded-lg border border-amber2/40 bg-amber2-50/60 px-3 py-2 text-xs"
              data-testid="tower-warnings"
            >
              <p className="font-semibold text-ink-950">
                {result.block.name} created, but not everything could be attached:
              </p>
              <ul className="mt-1 list-disc pl-4">
                {result.warnings.map((w) => (
                  <li key={w} data-testid="tower-warning">
                    {w}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-txt-secondary">
                Fix it on the Plans tab, then apply the plan again.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {result ? (
              <Button
                variant="primary"
                onClick={() => onCreated(result.block)}
                data-testid="tower-warnings-ok"
              >
                Open tower
              </Button>
            ) : (
              <>
                <Button variant="soft" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  why={
                    !f.name.trim() ||
                    !f.code.trim() ||
                    (!f.tower_template_id && !(Number(f.floors) >= 1))
                      ? "Fill name, code and floors (or a template)"
                      : undefined
                  }
                  disabled={
                    busy ||
                    !f.name.trim() ||
                    !f.code.trim() ||
                    (!f.tower_template_id && !(Number(f.floors) >= 1))
                  }
                  onClick={save}
                  data-testid="tower-save"
                >
                  {tpl ? "Create tower with floors & plans" : "Create empty tower"}
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
