import { useCallback, useEffect, useState } from "react";
import { AmountInput } from "@/components/common/AmountInput";
import { toast } from "sonner";
import { Lock, Wand2 } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { inr, num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../Bits";
import { Combobox } from "../Combobox";

const MAINT = [
  { value: "none", label: "None" },
  { value: "per_sqft_months", label: "Rate / sq ft × months" },
  { value: "fixed", label: "Fixed amount" },
];
const FACINGS = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"].map((f) => ({ value: f, label: f }));
const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

function MaintenanceFields({ f, setM, d }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field
        label="Maintenance method"
        hint={`Project default: ${MAINT.find((m) => m.value === d.project_setup?.maintenance?.method)?.label || "None"}`}
      >
        <Combobox
          options={MAINT}
          value={f.maintenance.method}
          onChange={(v) => setM("method", v)}
          testId="flat-pricing-maint-method"
        />
      </Field>
      {f.maintenance.method === "per_sqft_months" && (
        <>
          <Field label="₹ / sq ft / month">
            <Input
              type="number"
              min="0"
              value={f.maintenance.rate_per_sqft}
              onChange={(e) => setM("rate_per_sqft", e.target.value)}
              placeholder={d.project_setup?.maintenance?.rate_per_sqft ?? ""}
              data-testid="flat-pricing-maint-rate"
            />
          </Field>
          <Field label="Months">
            <Input
              type="number"
              min="0"
              value={f.maintenance.months}
              onChange={(e) => setM("months", e.target.value)}
              placeholder={d.project_setup?.maintenance?.months ?? ""}
              data-testid="flat-pricing-maint-months"
            />
          </Field>
        </>
      )}
      {f.maintenance.method === "fixed" && (
        <Field label="Fixed amount ₹">
          <AmountInput
            value={f.maintenance.fixed_amount}
            onChange={(e) => setM("fixed_amount", e.target.value)}
            data-testid="flat-pricing-maint-fixed"
          />
        </Field>
      )}
      {d.maintenance_amount != null && (
        <Field label="Maintenance (advance)">
          <p
            className="input flex h-10 items-center tabular"
            data-testid="flat-pricing-maint-amount"
          >
            {inr(d.maintenance_amount)}
          </p>
        </Field>
      )}
    </div>
  );
}

function PricingStatePill({ d }) {
  const s = d.pricing_status;
  return (
    <span
      className={
        "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
        (s === "ready"
          ? "bg-sage/15 " + "text-sage"
          : s === "review"
            ? "bg-amber2-50 text-amber2"
            : "bg-brick/10 text-brick")
      }
      data-testid="flat-pricing-status"
    >
      {s === "ready" ? "Priced" : s === "review" ? "Needs a decision" : "Pricing pending"}
    </span>
  );
}

/**
 * Phase PS — per-flat pricing sheet: Saleable area, rate/lump sum, parking slots (own price),
 * maintenance method. Nothing pre-filled: type defaults only via the explicit button.
 */
export function FlatPricingSheet({ flatId, ftOptions, onChanged }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [slots, setSlots] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api
        .get(`/flats/${flatId}/pricing`)
        .then((r) => {
          const x = r.data;
          setD(x);
          setF({
            saleable_sqft: x.saleable_sqft ?? "",
            pricing_mode: x.pricing_mode || "rate",
            rate_per_sqft: x.rate_per_sqft ?? "",
            price: x.price ?? "",
            flat_type_id: x.flat_type_id,
            facing: x.facing || null,
            maintenance: {
              method: x.maintenance?.method || "none",
              rate_per_sqft: x.maintenance?.rate_per_sqft ?? "",
              months: x.maintenance?.months ?? "",
              fixed_amount: x.maintenance?.fixed_amount ?? "",
            },
            parking_slot_ids: (x.parking_slots || []).map((s) => s.id),
            notes: x.notes || "",
          });
          return api
            .get("/parking", { params: { project_id: x.project_id, page_size: 200 } })
            .then((pr) =>
              setSlots(
                pr.data.items.filter((s) => s.status === "Available" || s.flat_id === flatId),
              ),
            );
        })
        .catch((e) => toast.error(errMsg(e))),
    [flatId],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!d || !f) return null;
  const locked = d.lock;
  const set = (k, v) => setF({ ...f, [k]: v });
  const setM = (k, v) => setF({ ...f, maintenance: { ...f.maintenance, [k]: v } });
  const live =
    f.pricing_mode === "rate"
      ? (Number(f.saleable_sqft) || 0) * (Number(f.rate_per_sqft) || 0)
      : Number(f.price) || 0;
  const run = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(
      () =>
        api.patch(`/flats/${flatId}/pricing`, {
          saleable_sqft: numOrNull(f.saleable_sqft),
          pricing_mode: f.pricing_mode,
          rate_per_sqft: f.pricing_mode === "rate" ? numOrNull(f.rate_per_sqft) : undefined,
          price: f.pricing_mode === "lump_sum" ? numOrNull(f.price) : undefined,
          flat_type_id: f.flat_type_id !== d.flat_type_id ? f.flat_type_id : undefined,
          facing: f.facing || undefined,
          notes: f.notes || null,
          parking_slot_ids: f.parking_slot_ids,
          maintenance: {
            method: f.maintenance.method,
            rate_per_sqft: numOrNull(f.maintenance.rate_per_sqft),
            months: numOrNull(f.maintenance.months),
            fixed_amount: numOrNull(f.maintenance.fixed_amount),
          },
          version: d.version,
        }),
      "Pricing saved",
    );
  const applyDefaults = () =>
    run(() => api.post(`/flats/${flatId}/apply-type-defaults`), "Flat-type defaults applied");
  const slotOpts = slots.map((s) => ({
    value: s.id,
    label: `${s.number} · ${s.type}${s.level ? ` · ${s.level}` : ""}`,
    sub: s.price != null ? inr(s.price) : "no price",
  }));
  const chosen = slots.filter((s) => f.parking_slot_ids.includes(s.id));
  if (locked)
    return (
      <div
        className="mt-4 rounded-lg border border-amber/40 bg-amber2-50/40 p-4 text-sm"
        data-testid="flat-pricing-locked"
      >
        <p className="flex items-center gap-2 font-semibold text-ink-950">
          <Lock className="h-4 w-4" />
          Locked by booking {d.booking_number || ""}
        </p>
        <p className="mt-1 text-txt-secondary">
          Saleable area {num(d.saleable_sqft)} sq ft · {inr(d.price)} · {chosen.length} parking
          slot(s). Changes go through the agreement-revision flow
          {d.booking_id && (
            <>
              {" "}
              —{" "}
              <a
                className="underline"
                href={`/bookings/${d.booking_id}?revise=1`}
                data-testid="flat-pricing-revise-link"
              >
                open booking
              </a>
            </>
          )}
          .
        </p>
      </div>
    );
  return (
    <div className="mt-4 space-y-3 rounded-lg border p-4" data-testid="flat-pricing-sheet">
      <div className="flex items-center justify-between">
        <p className="label-xs">Pricing sheet</p>
        <PricingStatePill d={d} />
      </div>
      {d.pricing_status === "review" && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg bg-amber2-50/60 px-3 py-2 text-xs"
          data-testid="flat-pricing-review"
        >
          <span>Flat type changed — update saleable area &amp; rate from the new type?</span>
          <Button
            type="button"
            variant="primary"
            size="compact"
            disabled={busy}
            onClick={applyDefaults}
            data-testid="flat-apply-type-defaults"
          >
            Yes
          </Button>
          <Button
            type="button"
            variant="soft"
            size="compact"
            disabled={busy}
            onClick={() => run(() => api.post(`/flats/${flatId}/keep-values`), "Kept as is")}
            data-testid="flat-keep-values"
          >
            No, keep
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Flat type">
          <Combobox
            options={ftOptions}
            value={f.flat_type_id}
            onChange={(v) => set("flat_type_id", v)}
            testId="flat-pricing-type"
          />
        </Field>
        <Field label="Facing">
          <Combobox
            options={FACINGS}
            value={f.facing}
            onChange={(v) => set("facing", v)}
            placeholder="—"
            testId="flat-pricing-facing"
          />
        </Field>
        <Field label="Saleable area (sq ft)">
          <Input
            type="number"
            min="0"
            value={f.saleable_sqft}
            onChange={(e) => set("saleable_sqft", e.target.value)}
            placeholder="Enter area"
            data-testid="flat-pricing-saleable"
          />
        </Field>
        <Field label="Pricing mode">
          <Combobox
            options={[
              { value: "rate", label: "Rate / sq ft" },
              { value: "lump_sum", label: "Lump sum" },
            ]}
            value={f.pricing_mode}
            onChange={(v) => set("pricing_mode", v)}
            testId="flat-pricing-mode"
          />
        </Field>
        {f.pricing_mode === "rate" ? (
          <Field label="Rate ₹ / sq ft">
            <Input
              type="number"
              min="0"
              value={f.rate_per_sqft}
              onChange={(e) => set("rate_per_sqft", e.target.value)}
              placeholder="Enter rate"
              data-testid="flat-pricing-rate"
            />
          </Field>
        ) : (
          <Field label="Price ₹ (lump sum)">
            <AmountInput
              value={f.price}
              onChange={(e) => set("price", e.target.value)}
              placeholder="Enter price"
              data-testid="flat-pricing-price"
            />
          </Field>
        )}
        <Field label="Flat price">
          <p
            className="input flex h-10 items-center font-semibold tabular"
            data-testid="flat-pricing-computed"
          >
            {live ? inr(live) : "—"}
          </p>
        </Field>
      </div>
      {d.pricing_status !== "review" &&
        (d.type_defaults?.saleable_sqft || d.type_defaults?.rate_per_sqft) && (
          <Button
            type="button"
            variant="soft"
            size="compact"
            disabled={busy}
            onClick={applyDefaults}
            data-testid="flat-fill-from-type"
          >
            <Wand2 className="h-3.5 w-3.5" />
            Fill from flat type
            {d.type_defaults.saleable_sqft ? ` · ${num(d.type_defaults.saleable_sqft)} sq ft` : ""}
            {d.type_defaults.rate_per_sqft ? ` · ₹${num(d.type_defaults.rate_per_sqft)}/sq ft` : ""}
          </Button>
        )}
      <Field label={`Parking slots (${chosen.length})`}>
        <div className="flex flex-wrap gap-1.5" data-testid="flat-pricing-parking">
          {chosen.map((s) => (
            <span
              key={s.id}
              className="rounded-full bg-warm-50 px-2 py-0.5 text-xs"
              data-testid={`flat-slot-${s.number}`}
            >
              {s.number} · {s.price != null ? inr(s.price) : "no price"}{" "}
              <button
                type="button"
                className="ml-1 text-brick"
                onClick={() =>
                  set(
                    "parking_slot_ids",
                    f.parking_slot_ids.filter((x) => x !== s.id),
                  )
                }
                aria-label={`Remove ${s.number}`}
                data-testid={`flat-slot-remove-${s.number}`}
              >
                ×
              </button>
            </span>
          ))}
          <Combobox
            options={slotOpts.filter((o) => !f.parking_slot_ids.includes(o.value))}
            value={null}
            onChange={(v) => v && set("parking_slot_ids", [...f.parking_slot_ids, v])}
            placeholder="Add slot…"
            testId="flat-pricing-add-slot"
            className="min-w-[200px]"
          />
        </div>
      </Field>
      <MaintenanceFields f={f} setM={setM} d={d} />
      <Field label="Notes">
        <Textarea
          rows={2}
          value={f.notes}
          onChange={(e) => set("notes", e.target.value)}
          data-testid="flat-pricing-notes"
        />
      </Field>
      <Button
        size="sm"
        disabled={busy}
        onClick={save}
        className="bg-ink-950 hover:bg-ink-800"
        data-testid="flat-pricing-save"
      >
        Save pricing
      </Button>
    </div>
  );
}
