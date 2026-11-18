import { useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/Bits";
import { Combobox } from "@/components/common/Combobox";
import { Button } from "@/components/ui/button";

const MAINT = [
  { value: "", label: "— leave as is —" },
  { value: "none", label: "None" },
  { value: "per_sqft_months", label: "Rate / sq ft × months" },
  { value: "fixed", label: "Fixed amount" },
];
const n = (v) => (v === "" || v == null ? null : Number(v));

/** PS.4 — bulk edit for selected flats: saleable area / rate / maintenance method / apply type defaults (locked flats are skipped, reported). */
export function BulkEditBar({ selectedIds, onDone, onClear }) {
  const [f, setF] = useState({
    saleable_sqft: "",
    rate_per_sqft: "",
    method: "",
    rate: "",
    months: "",
    fixed: "",
    apply: false,
  });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const body = { flat_ids: selectedIds, apply_type_defaults: f.apply };
      if (f.saleable_sqft !== "") body.saleable_sqft = Number(f.saleable_sqft);
      if (f.rate_per_sqft !== "") body.rate_per_sqft = Number(f.rate_per_sqft);
      if (f.method)
        body.maintenance = {
          method: f.method,
          rate_per_sqft: n(f.rate),
          months: n(f.months),
          fixed_amount: n(f.fixed),
        };
      const r = await api.post("/flats/bulk-edit", body);
      toast.success(
        "" +
          r.data.updated +
          " flat(s) updated" +
          (r.data.skipped_locked.length
            ? ` · ${r.data.skipped_locked.length} ` +
              `locked skipped (${r.data.skipped_locked.map((x) => x.flat_number).join(", ")})`
            : ""),
      );
      onDone?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="sticky bottom-3 z-20 rounded-xl border border-ink-950 bg-ink-950 p-3 text-warm-50 shadow-xl"
      data-testid="bulk-edit-bar"
    >
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-sm font-semibold" data-testid="bulk-edit-count">
          {selectedIds.length} flat(s) selected
        </p>
        <Field label="Saleable area (sq ft)">
          <Input
            type="number"
            min="0"
            value={f.saleable_sqft}
            onChange={(e) => setF({ ...f, saleable_sqft: e.target.value })}
            placeholder="leave blank"
            className="!h-8 w-36 bg-white text-ink-950"
            data-testid="bulk-saleable"
          />
        </Field>
        <Field label="Rate ₹ / sq ft">
          <Input
            type="number"
            min="0"
            value={f.rate_per_sqft}
            onChange={(e) => setF({ ...f, rate_per_sqft: e.target.value })}
            placeholder="leave blank"
            className="!h-8 w-32 bg-white text-ink-950"
            data-testid="bulk-rate"
          />
        </Field>
        <Field label="Maintenance">
          <Combobox
            options={MAINT}
            value={f.method}
            onChange={(v) => setF({ ...f, method: v || "" })}
            allowAdd={false}
            clearable={false}
            className="!h-8 min-w-[170px] bg-white text-ink-950"
            testId="bulk-maint"
          />
        </Field>
        {f.method === "per_sqft_months" && (
          <>
            <Input
              type="number"
              placeholder="₹/sq ft/mo"
              value={f.rate}
              onChange={(e) => setF({ ...f, rate: e.target.value })}
              className="!h-8 w-24 text-ink-950"
              data-testid="bulk-maint-rate"
            />
            <Input
              type="number"
              placeholder="months"
              value={f.months}
              onChange={(e) => setF({ ...f, months: e.target.value })}
              className="!h-8 w-20 text-ink-950"
              data-testid="bulk-maint-months"
            />
          </>
        )}
        {f.method === "fixed" && (
          <Input
            type="number"
            placeholder="₹ fixed"
            value={f.fixed}
            onChange={(e) => setF({ ...f, fixed: e.target.value })}
            className="!h-8 w-28 text-ink-950"
            data-testid="bulk-maint-fixed"
          />
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={f.apply}
            onChange={(e) => setF({ ...f, apply: e.target.checked })}
            data-testid="bulk-apply-defaults"
          />
          Apply flat-type defaults
        </label>
        <Button
          type="button"
          variant="plain"
          size="compact"
          className="bg-gold text-on-accent hover:bg-gold/90"
          why={!selectedIds.length ? "Select at least one flat" : undefined}
          disabled={busy || !selectedIds.length}
          onClick={run}
          data-testid="bulk-apply"
        >
          Apply to selected
        </Button>
        <Button
          type="button"
          variant="quiet"
          size="compact"
          className="text-warm-50"
          onClick={onClear}
          data-testid="bulk-clear"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
