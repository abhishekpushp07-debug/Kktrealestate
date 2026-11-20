import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TemplateList } from "./TemplateList";
import { useStages } from "./StagePlanTemplates";
import { useRowKeys } from "@/hooks/useRowKeys";

const TRIGGERS = [
  ["on_booking", "On booking"],
  ["stage", "When a stage completes"],
  ["on_possession", "On possession"],
  ["days_after_booking", "Days after booking"],
];
const blank = () => ({ label: "", percent: "", trigger: "stage", stage_id: "", days: "" });

export function PaymentPlanTemplateForm({ item, onClose, onSaved, stages }) {
  const [name, setName] = useState(item.name || "");
  const [rows, setRows] = useState(
    item.installments?.length
      ? item.installments.map((i) => ({ ...i, days: i.days ?? "", stage_id: i.stage_id || "" }))
      : [{ label: "Booking", percent: 10, trigger: "on_booking", stage_id: "", days: "" }, blank()],
  );
  const [err, setErr] = useState(null);
  const keyed = useRowKeys(rows);
  const setRow = (i, k, v) =>
    setRows((a) =>
      a.map((r, j) =>
        j === i ? { ...r, [k]: v, ...(k === "trigger" && v === "stage" && !r.label ? {} : {}) } : r,
      ),
    );
  const total = Math.round(rows.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0) * 100) / 100;
  const valid =
    name.trim() &&
    rows.length &&
    total === 100 &&
    rows.every(
      (r) =>
        r.label.trim() &&
        parseFloat(r.percent) > 0 &&
        (r.trigger !== "stage" || r.stage_id) &&
        (r.trigger !== "days_after_booking" || r.days !== ""),
    );
  const save = async () => {
    setErr(null);
    const body = {
      name: name.trim(),
      installments: rows.map((r) => ({
        label: r.label.trim(),
        percent: parseFloat(r.percent),
        trigger: r.trigger,
        stage_id: r.trigger === "stage" ? r.stage_id : null,
        days: r.trigger === "days_after_booking" ? Number(r.days) : null,
      })),
      ...(item.id ? { version: item.version } : {}),
    };
    try {
      const r = item.id
        ? await api.patch(`/payment-plan-templates/${item.id}`, body)
        : await api.post("/payment-plan-templates", body);
      toast.success(`Payment plan template "${r.data.name}" saved`);
      onSaved(r.data);
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <div className="card space-y-4 !p-5" data-testid="payment-plan-template-form">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm md:w-1/2">
          <span className="label-xs">Template name *</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CLP 10:80:10"
            data-testid="ppt-name"
          />
        </label>
        <span
          className={cn(
            "ml-auto rounded-full px-3 py-1 text-xs font-bold",
            total === 100 ? "bg-sage-50 text-sage" : "bg-brick-50 text-brick",
          )}
          data-testid="ppt-total"
        >
          Total {total.toFixed(2)}%{total !== 100 && " — must be exactly 100%"}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase text-txt-secondary">
          <tr>
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">Installment</th>
            <th className="px-2 py-1">When</th>
            <th className="px-2 py-1">Stage / days</th>
            <th className="w-28 px-2 py-1">%</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {keyed.map(({ k, row: r }, i) => (
            <tr key={k} className="border-t" data-testid={`ppt-row-${i + 1}`}>
              <td className="px-2 py-1 text-xs text-txt-secondary">{i + 1}</td>
              <td className="px-2 py-1">
                <Input
                  value={r.label}
                  onChange={(e) => setRow(i, "label", e.target.value)}
                  placeholder={
                    r.trigger === "stage"
                      ? stages.find((s) => s.id === r.stage_id)?.name || "Label"
                      : "Label"
                  }
                  className="h-9"
                  data-testid={`ppt-row-label-${i + 1}`}
                />
              </td>
              <td className="px-2 py-1">
                <NativeSelect
                  className="input !h-9"
                  value={r.trigger}
                  onChange={(e) => setRow(i, "trigger", e.target.value)}
                  data-testid={`ppt-row-trigger-${i + 1}`}
                >
                  {TRIGGERS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </td>
              <td className="px-2 py-1">
                {r.trigger === "stage" && (
                  <NativeSelect
                    className="input !h-9"
                    value={r.stage_id}
                    onChange={(e) => {
                      setRow(i, "stage_id", e.target.value);
                      if (!r.label)
                        setRow(i, "label", stages.find((s) => s.id === e.target.value)?.name || "");
                    }}
                    data-testid={`ppt-row-stage-${i + 1}`}
                  >
                    <option value="">Stage…</option>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                {r.trigger === "days_after_booking" && (
                  <Input
                    type="number"
                    min="0"
                    value={r.days}
                    onChange={(e) => setRow(i, "days", e.target.value)}
                    placeholder="days"
                    className="h-9"
                    data-testid={`ppt-row-days-${i + 1}`}
                  />
                )}
              </td>
              <td className="px-2 py-1">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={r.percent}
                  onChange={(e) => setRow(i, "percent", e.target.value)}
                  className="h-9 text-right"
                  data-testid={`ppt-row-pct-${i + 1}`}
                />
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => setRows((a) => a.filter((_, j) => j !== i))}
                  className="rounded p-1 text-brick hover:bg-warm-50"
                  data-testid={`ppt-row-remove-${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setRows((a) => [...a, blank()])}
        data-testid="ppt-add-row"
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add installment
      </Button>
      {err && (
        <p className="rounded-md bg-brick-50 px-3 py-2 text-sm text-brick" data-testid="ppt-error">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          className="bg-ink-950 hover:bg-ink-800"
          why={!valid ? "Type a name; stages must add up to 100%" : undefined}
          disabled={!valid}
          onClick={save}
          data-testid="ppt-save"
        >
          Save template
        </Button>
        <Button variant="outline" onClick={onClose} data-testid="ppt-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function PaymentPlanTemplates() {
  const { can } = useAuth();
  const [items, setItems] = useState(null);
  const { stages } = useStages();
  const load = () =>
    api
      .get("/payment-plan-templates", { params: { include_inactive: true } })
      .then((r) => setItems(r.data.items))
      .catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
  }, []);
  return (
    <TemplateList
      title="Payment Plan Templates"
      subtitle="% per installment, triggered on booking, a construction stage, possession or days after booking. Must total 100%."
      items={items}
      testId="payment-plan-templates"
      perm={{
        create: can("masters.payment_plan.create"),
        edit: can("masters.payment_plan.edit"),
        del: can("masters.payment_plan.delete"),
      }}
      onDelete={(t) => api.delete(`/payment-plan-templates/${t.id}`)}
      onRestore={(t) => api.post(`/payment-plan-templates/${t.id}/restore`)}
      reload={load}
      Form={PaymentPlanTemplateForm}
      formProps={{ stages }}
      render={(t) => (
        <div className="mt-1 flex flex-wrap gap-1">
          {t.installments.map((i) => (
            <span
              key={`${i.label}-${i.trigger}-${i.stage_id || i.days || ""}`}
              className="rounded-full bg-warm-50 px-2 py-0.5 text-[11px] text-ink-950"
            >
              {i.label} <b>{i.percent}%</b>
            </span>
          ))}
        </div>
      )}
    />
  );
}
