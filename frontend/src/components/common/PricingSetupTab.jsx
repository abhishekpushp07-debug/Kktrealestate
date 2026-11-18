import { useCallback, useEffect, useState } from "react";
import { AmountInput } from "@/components/common/AmountInput";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Combobox } from "@/components/common/Combobox";
import { Field } from "@/components/v2";
import { Button } from "@/components/ui/button";

const MAINT = [
  { value: "none", label: "None" },
  { value: "per_sqft_months", label: "Rate / sq ft × months" },
  { value: "fixed", label: "Fixed amount" },
];
const ROUND = [
  { value: "none", label: "No rounding" },
  { value: "nearest_100", label: "Nearest ₹100" },
  { value: "nearest_1000", label: "Nearest ₹1,000" },
];
const TIMING = [
  { value: "on_booking", label: "On booking" },
  { value: "on_possession", label: "On possession" },
  { value: "manual", label: "Manual" },
];
const CALC = {
  fixed: "Fixed",
  per_sqft: "Per sq ft",
  per_sqft_months: "Per sq ft × months",
  percent_of_agreement: "% of agreement",
};
const inp = "input h-9";
const n = (v) => (v === "" || v == null ? null : Number(v));

/** Phase PS.1.3 — Project Pricing Setup: GST default on agreement value, enabled charge heads with overrides, maintenance defaults, floor rise, rounding. */
export function PricingSetupTab({ projectId, can }) {
  const [d, setD] = useState(null);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api
        .get(`/projects/${projectId}/pricing-setup`)
        .then((r) => {
          setD(r.data);
          setS({ ...r.data.setup, maintenance: { ...r.data.setup.maintenance } });
        })
        .catch((e) => toast.error(errMsg(e))),
    [projectId],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!d || !s) return <p className="p-4 text-sm text-txt-muted">Loading…</p>;
  const heads = d.charge_heads;
  const row = (id) => s.charge_heads.find((h) => h.charge_type_id === id);
  const setHead = (id, patch) =>
    setS({
      ...s,
      charge_heads: row(id)
        ? s.charge_heads.map((h) => (h.charge_type_id === id ? { ...h, ...patch } : h))
        : [
            ...s.charge_heads,
            {
              charge_type_id: id,
              enabled: true,
              value: null,
              gst_percent: null,
              timing: null,
              ...patch,
            },
          ],
    });
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/projects/${projectId}/pricing-setup`, {
        agreement_gst_percent: Number(s.agreement_gst_percent) || 0,
        floor_rise_enabled: !!s.floor_rise_enabled,
        rounding: s.rounding || "none",
        maintenance: {
          method: s.maintenance.method || "none",
          rate_per_sqft: n(s.maintenance.rate_per_sqft),
          months: n(s.maintenance.months),
          fixed_amount: n(s.maintenance.fixed_amount),
        },
        charge_heads: s.charge_heads.map((h) => ({
          ...h,
          value: n(h.value),
          gst_percent: n(h.gst_percent),
        })),
        version: d.version,
      });
      toast.success("Pricing setup saved");
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const ro = !can("masters.project.edit");
  return (
    <div className="space-y-5" data-testid="pricing-setup-tab">
      {d.pending_pricing > 0 && (
        <p
          className="rounded-xl bg-brick/10 px-4 py-2 text-sm font-semibold text-brick"
          data-testid="pricing-setup-pending"
        >
          {d.pending_pricing} flat(s) still have no saleable area / price — set them in the floor
          designer or flat sheet.
        </p>
      )}
      <section className="card p-5">
        <h3 className="mb-3 e-caps-blue">Agreement value</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Default GST % on agreement value" hint="Editable per booking">
            <input
              className={inp}
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={s.agreement_gst_percent ?? ""}
              disabled={ro}
              onChange={(e) => setS({ ...s, agreement_gst_percent: e.target.value })}
              data-testid="ps-gst-percent"
            />
          </Field>
          <Field label="Price rounding">
            <Combobox
              options={ROUND}
              value={s.rounding || "none"}
              onChange={(v) => setS({ ...s, rounding: v })}
              disabled={ro}
              testId="ps-rounding"
            />
          </Field>
          <Field label="Floor rise" hint="Uses each tower's ₹/sq ft per floor when on">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!s.floor_rise_enabled}
                disabled={ro}
                onChange={(e) => setS({ ...s, floor_rise_enabled: e.target.checked })}
                data-testid="ps-floor-rise"
              />
              Enabled
            </label>
          </Field>
        </div>
      </section>
      <section className="card p-5">
        <h3 className="mb-3 e-caps-blue">Maintenance defaults</h3>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Method">
            <Combobox
              options={MAINT}
              value={s.maintenance.method || "none"}
              onChange={(v) => setS({ ...s, maintenance: { ...s.maintenance, method: v } })}
              disabled={ro}
              testId="ps-maint-method"
            />
          </Field>
          {s.maintenance.method === "per_sqft_months" && (
            <>
              <Field label="₹ / sq ft / month">
                <input
                  className={inp}
                  type="number"
                  min={0}
                  value={s.maintenance.rate_per_sqft ?? ""}
                  disabled={ro}
                  onChange={(e) =>
                    setS({ ...s, maintenance: { ...s.maintenance, rate_per_sqft: e.target.value } })
                  }
                  data-testid="ps-maint-rate"
                />
              </Field>
              <Field label="Months">
                <input
                  className={inp}
                  type="number"
                  min={0}
                  value={s.maintenance.months ?? ""}
                  disabled={ro}
                  onChange={(e) =>
                    setS({ ...s, maintenance: { ...s.maintenance, months: e.target.value } })
                  }
                  data-testid="ps-maint-months"
                />
              </Field>
            </>
          )}
          {s.maintenance.method === "fixed" && (
            <Field label="Fixed amount ₹">
              <AmountInput
                className={inp}
                min={0}
                value={s.maintenance.fixed_amount ?? ""}
                disabled={ro}
                onChange={(e) =>
                  setS({ ...s, maintenance: { ...s.maintenance, fixed_amount: e.target.value } })
                }
                data-testid="ps-maint-fixed"
              />
            </Field>
          )}
        </div>
      </section>
      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="e-caps-blue">Charge heads</h3>
          <a className="text-xs underline" href="/masters/m/charge-types">
            Edit master
          </a>
        </div>
        <table className="w-full text-sm" data-testid="ps-charge-heads">
          <thead className="text-left text-[11px] uppercase text-txt-secondary">
            <tr>
              <th className="py-1">On</th>
              <th>Head</th>
              <th>Calc</th>
              <th>Value for this project</th>
              <th>GST % for this project</th>
              <th>Timing</th>
            </tr>
          </thead>
          <tbody>
            {heads.map((h) => {
              const r = row(h.id) || {
                enabled: false,
                value: null,
                gst_percent: null,
                timing: null,
              };
              return (
                <tr key={h.id} className="border-t" data-testid={`ps-head-${h.code}`}>
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      checked={!!r.enabled}
                      disabled={ro}
                      onChange={(e) => setHead(h.id, { enabled: e.target.checked })}
                      data-testid={`ps-head-on-${h.code}`}
                    />
                  </td>
                  <td className="font-medium">
                    {h.name} <span className="font-mono text-[10px] text-txt-muted">{h.code}</span>
                  </td>
                  <td className="text-txt-secondary">
                    {CALC[h.calc_type] || h.calc_type || "Fixed"}
                  </td>
                  <td>
                    <input
                      className="input !h-8 w-28 tabular"
                      type="number"
                      min={0}
                      placeholder={h.default_value ?? h.default_amount ?? ""}
                      value={r.value ?? ""}
                      disabled={ro || !r.enabled}
                      onChange={(e) => setHead(h.id, { value: e.target.value })}
                      data-testid={`ps-head-value-${h.code}`}
                    />
                  </td>
                  <td>
                    <input
                      className="input !h-8 w-20 tabular"
                      type="number"
                      min={0}
                      max={100}
                      placeholder={h.default_gst_percent ?? 18}
                      value={r.gst_percent ?? ""}
                      disabled={ro || !r.enabled}
                      onChange={(e) => setHead(h.id, { gst_percent: e.target.value })}
                      data-testid={`ps-head-gst-${h.code}`}
                    />
                  </td>
                  <td>
                    <Combobox
                      options={TIMING}
                      value={r.timing || h.default_demand_timing || "on_booking"}
                      onChange={(v) => setHead(h.id, { timing: v })}
                      disabled={ro || !r.enabled}
                      className="!h-8 min-w-[150px] text-xs"
                      testId={`ps-head-timing-${h.code}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {!ro && (
        <Button
          type="button"
          variant="primary"
          disabled={busy}
          onClick={save}
          data-testid="ps-save"
        >
          Save pricing setup
        </Button>
      )}
    </div>
  );
}
