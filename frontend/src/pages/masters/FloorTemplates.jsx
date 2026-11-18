import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCatalogues } from "@/hooks/useCatalogues";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/v2/Select";
import { TemplateList } from "./TemplateList";
import { useRowKeys } from "@/hooks/useRowKeys";

const FACINGS = ["", "N", "S", "E", "W", "NE", "NW", "SE", "SW"];

/** Floor Template: an ordered mix of flat types for one floor. Area/rate stay empty unless the explicit checkbox is ticked. */
export function FloorTemplateForm({ item, onClose, onSaved }) {
  const { opts } = useCatalogues();
  const ftOpts = opts("flat_types");
  const [name, setName] = useState(item.name || "");
  const [rows, setRows] = useState(
    item.positions?.length ? item.positions : [{ pos: 1, flat_type_id: "", facing: "" }],
  );
  const [useDefaults, setUseDefaults] = useState(!!item.use_type_defaults);
  const keyed = useRowKeys(rows);
  const [err, setErr] = useState(null);
  const setRow = (i, k, v) => setRows((a) => a.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const counts = rows.reduce((m, r) => {
    const l = ftOpts.find((o) => o.value === r.flat_type_id)?.label || "?";
    m[l] = (m[l] || 0) + 1;
    return m;
  }, {});
  const valid = name.trim() && rows.length && rows.every((r) => r.flat_type_id);
  const save = async () => {
    setErr(null);
    const body = {
      name: name.trim(),
      use_type_defaults: useDefaults,
      positions: rows.map((r, i) => ({
        pos: i + 1,
        flat_type_id: r.flat_type_id,
        facing: r.facing || null,
      })),
      ...(item.id ? { version: item.version } : {}),
    };
    try {
      const r = item.id
        ? await api.patch(`/floor-templates/${item.id}`, body)
        : await api.post("/floor-templates", body);
      toast.success(`Floor template "${r.data.name}" saved`);
      onSaved(r.data);
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <div className="card space-y-4 !p-5" data-testid="floor-template-form">
      <label className="block text-sm md:w-1/2">
        <span className="label-xs">Template name *</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Typical 4-flat floor"
          data-testid="ft-name"
        />
      </label>
      <div>
        <p className="label-xs mb-1">Flats on this floor (left → right)</p>
        <div className="space-y-2" data-testid="ft-rows">
          {keyed.map(({ k, row: r }, i) => (
            <div key={k} className="grid grid-cols-[32px_1fr_110px_36px] items-center gap-2">
              <span className="text-xs font-bold text-txt-secondary">{i + 1}</span>
              <Select
                options={ftOpts}
                value={r.flat_type_id}
                onChange={(v) => setRow(i, "flat_type_id", v)}
                allowAdd={false}
                clearable={false}
                placeholder="Flat type…"
                testId={`ft-row-type-${i + 1}`}
              />
              <NativeSelect
                className="input !h-10"
                value={r.facing || ""}
                onChange={(e) => setRow(i, "facing", e.target.value)}
                data-testid={`ft-row-facing-${i + 1}`}
              >
                {FACINGS.map((f) => (
                  <option key={f} value={f}>
                    {f || "Facing"}
                  </option>
                ))}
              </NativeSelect>
              <button
                type="button"
                className="rounded p-1 text-brick hover:bg-warm-50"
                onClick={() => setRows((a) => a.filter((_, j) => j !== i))}
                disabled={rows.length === 1}
                data-testid={`ft-row-remove-${i + 1}`}
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
            setRows((a) => [
              ...a,
              { pos: a.length + 1, flat_type_id: a[a.length - 1]?.flat_type_id || "", facing: "" },
            ])
          }
          data-testid="ft-add-row"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add flat
        </Button>
      </div>
      <p className="rounded-lg bg-warm-50 px-3 py-2 text-sm" data-testid="ft-preview">
        <b>{rows.length} flats:</b>{" "}
        {Object.entries(counts)
          .map(([l, c]) => `${c}×${l}`)
          .join(", ") || "—"}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={useDefaults}
          onChange={(e) => setUseDefaults(e.target.checked)}
          className="mt-1"
          data-testid="ft-use-defaults"
        />
        <span>
          Fill saleable area &amp; rate from the flat type when applying
          <span className="block text-xs text-txt-muted">
            Off by default — flats are created with area and price empty, to be set per flat.
          </span>
        </span>
      </label>
      {err && (
        <p className="rounded-md bg-brick-50 px-3 py-2 text-sm text-brick" data-testid="ft-error">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          className="bg-ink-950 hover:bg-ink-800"
          why={!valid ? "Type a name and give every row a flat type" : undefined}
          disabled={!valid}
          onClick={save}
          data-testid="ft-save"
        >
          Save template
        </Button>
        <Button variant="outline" onClick={onClose} data-testid="ft-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function FloorTemplates() {
  const { can } = useAuth();
  const [items, setItems] = useState(null);
  const load = () =>
    api
      .get("/floor-templates", { params: { include_inactive: true } })
      .then((r) => setItems(r.data.items))
      .catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
  }, []);
  return (
    <TemplateList
      title="Floor Templates"
      subtitle="One floor's flat mix. Pick it per floor on the Project → Structure tab, or inside a Tower Template."
      items={items}
      testId="floor-templates"
      perm={{
        create: can("masters.floor_plan.create"),
        edit: can("masters.floor_plan.edit"),
        del: can("masters.floor_plan.delete"),
      }}
      onDelete={(t) => api.delete(`/floor-templates/${t.id}`)}
      onRestore={(t) => api.post(`/floor-templates/${t.id}/restore`)}
      reload={load}
      Form={FloorTemplateForm}
      render={(t) => (
        <p className="text-xs text-txt-secondary">
          {t.preview}
          {t.use_type_defaults ? " · fills area & rate from type" : ""}
        </p>
      )}
    />
  );
}
