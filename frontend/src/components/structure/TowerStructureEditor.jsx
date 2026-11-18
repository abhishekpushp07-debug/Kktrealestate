import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Bits";
import { Combobox } from "@/components/common/Combobox";
import { Button } from "@/components/ui/button";

const PATTERNS = ["{block}-{floor}{pos2}", "{floor}{pos2}", "{block}{seq}"].map((p) => ({
  value: p,
  label: p,
}));
const list = (v) =>
  (v || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => !isNaN(n));
const formOf = (b) => ({
  floors: b.floors,
  floor_start: b.floor_start ?? 1,
  numbering_pattern: b.numbering_pattern || "{block}-{floor}{pos2}",
  refuge_floors: (b.refuge_floors || []).join(", "),
  podium_floors: (b.podium_floors || []).join(", "),
});

/**
 * PS.4 — tower structure editor: floors, floor start, numbering, refuge/podium. Preview (renames,
 * dropped floors) before apply; booked floors refuse inline.
 */
export function TowerStructureEditor({ block: initial, onChanged }) {
  const [block, setBlock] = useState(initial);
  useEffect(() => {
    api
      .get(`/blocks/${initial.id}`)
      .then((r) => {
        setBlock(r.data);
        setF(formOf(r.data));
      })
      .catch(() => {});
  }, [initial.id, initial.version]);
  const [f, setF] = useState(formOf(block));
  const patterns = PATTERNS.some((p) => p.value === f.numbering_pattern)
    ? PATTERNS
    : [{ value: f.numbering_pattern, label: f.numbering_pattern }, ...PATTERNS];
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const body = (apply) => ({
    floors: Number(f.floors),
    floor_start: Number(f.floor_start),
    numbering_pattern: f.numbering_pattern,
    refuge_floors: list(f.refuge_floors),
    podium_floors: list(f.podium_floors),
    preview: !apply,
    version: block.version,
  });
  const run = async (apply) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.patch(`/blocks/${block.id}/structure`, body(apply));
      if (apply) {
        toast.success("Tower structure updated");
        setPreview(null);
        onChanged?.();
      } else setPreview(r.data);
    } catch (e) {
      setErr(e.response?.data || { detail: errMsg(e) });
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-4" data-testid="tower-structure-editor">
      <h3 className="mb-3 e-caps-blue">Tower structure</h3>
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="Floors">
          <Input
            type="number"
            min="1"
            value={f.floors}
            onChange={(e) => setF({ ...f, floors: e.target.value })}
            data-testid="ts-floors"
          />
        </Field>
        <Field label="Floor start">
          <Input
            type="number"
            min="0"
            value={f.floor_start}
            onChange={(e) => setF({ ...f, floor_start: e.target.value })}
            data-testid="ts-floor-start"
          />
        </Field>
        <Field label="Numbering pattern">
          <Combobox
            options={patterns}
            value={f.numbering_pattern}
            onChange={(v) => setF({ ...f, numbering_pattern: v })}
            allowAdd={false}
            clearable={false}
            testId="ts-pattern"
          />
        </Field>
        <Field label="Refuge floors" hint="comma separated">
          <Input
            value={f.refuge_floors}
            onChange={(e) => setF({ ...f, refuge_floors: e.target.value })}
            data-testid="ts-refuge"
          />
        </Field>
        <Field label="Podium floors" hint="comma separated">
          <Input
            value={f.podium_floors}
            onChange={(e) => setF({ ...f, podium_floors: e.target.value })}
            data-testid="ts-podium"
          />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="soft"
          size="compact"
          disabled={busy}
          onClick={() => run(false)}
          data-testid="ts-preview"
        >
          Preview changes
        </Button>
        {preview && (
          <Button
            type="button"
            variant="primary"
            size="compact"
            disabled={busy}
            onClick={() => run(true)}
            data-testid="ts-apply"
          >
            Apply{preview.renames.length ? ` (${preview.renames.length} renumbered)` : ""}
          </Button>
        )}
      </div>
      {err && (
        <p
          className="mt-3 flex items-start gap-2 rounded-lg bg-brick/10 px-3 py-2 text-sm text-brick"
          data-testid="ts-error"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {err.detail}
            {err.locked?.length ? ` — locked: ${err.locked.join(", ")}` : ""}
          </span>
        </p>
      )}
      {preview && (
        <div
          className="mt-3 rounded-lg border border-warm-200 bg-warm-50/50 p-3 text-sm"
          data-testid="ts-preview-panel"
        >
          <p className="font-medium">
            Preview — {preview.unit_floors.length} unit floors
            {preview.floors_removed.length
              ? ` · floors removed: ${preview.floors_removed.join(", ")} (${preview.flats_removed} unbooked flats)`
              : ""}{" "}
            · {preview.renames.length} flat(s) renumbered
          </p>
          {preview.renames.length > 0 && (
            <div className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-auto">
              {preview.renames.map((r) => (
                <span
                  key={r.id}
                  className={`rounded-full px-2 py-0.5 text-xs ${r.locked ? "bg-amber2-50 text-amber2" : "bg-white"}`}
                  title={r.locked ? "Locked by booking — keeps its number" : ""}
                >
                  {r.from} → {r.to}
                  {r.locked ? " (kept)" : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
