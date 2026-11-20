import { TypedMasterInput } from "@/components/common/TypedMasterInput";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/common/EliteInputs";
import { AmountInput } from "@/components/common/AmountInput";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../Bits";
import { Combobox } from "../Combobox";

const TARGET_CLASS = {
  Hold: "border-amber/40 text-amber2 hover:bg-amber2-50",
  Blocked: "border-warm-200 text-txt-secondary",
};

/** Manual status change (Available / Hold / Blocked) — Booked / Sold belong to the booking engine. */
export function FlatStatusSection({
  flat,
  manualTargets,
  reason,
  setReason,
  holdUntil,
  setHoldUntil,
  busy,
  onChange,
}) {
  const manual = ["Available", "Hold", "Blocked"].includes(flat.status);
  return (
    <div className="mt-6 rounded-lg border p-4" data-testid="flat-status-section">
      <p className="label-xs mb-2">Change status</p>
      {manual ? (
        <>
          <TypedMasterInput
            list="flat_status_reason"
            placeholder="Reason (optional)"
            value={reason}
            onChange={setReason}
            className="mb-2"
            testId="flat-status-reason"
          />
          {manualTargets.includes("Hold") && (
            <label className="mb-2 block text-xs text-txt-secondary">
              Hold until (required to mark Hold)
              <DateTimeInput
                value={holdUntil}
                onChange={(e) => setHoldUntil(e.target.value)}
                className="mt-1 h-9"
                data-testid="flat-status-hold-until"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {manualTargets.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                why={s === "Hold" && !holdUntil ? "Pick a hold-until date" : undefined}
                disabled={busy || (s === "Hold" && !holdUntil)}
                onClick={() => onChange(s)}
                data-testid={`flat-status-${s.toLowerCase()}-btn`}
                className={TARGET_CLASS[s] || "border-sage/40 text-sage hover:bg-sage-50"}
              >
                Mark {s}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-txt-muted">
            Booked / Sold are set by the booking engine (Phase 2).
          </p>
        </>
      ) : (
        <p className="text-sm text-txt-secondary">Status is controlled by the booking.</p>
      )}
    </div>
  );
}

/** Price / rate / notes / flat-type edit form. */
export function FlatEditSection({ flat, edit, setEdit, ftOptions, busy, onSave }) {
  return (
    <div className="mt-4 rounded-lg border p-4 space-y-3" data-testid="flat-edit-section">
      <p className="label-xs">Edit flat</p>
      <Field
        label="Flat type"
        hint={
          flat.status !== "Available"
            ? "Only editable while Available"
            : "Changing re-snapshots rooms & areas"
        }
      >
        <Combobox
          options={ftOptions}
          value={edit.flat_type_id}
          onChange={(v) => setEdit({ ...edit, flat_type_id: v })}
          disabled={flat.status !== "Available"}
          testId="flat-edit-type"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rate ₹/sq.ft">
          <Input
            type="number"
            value={edit.rate_per_sqft}
            onChange={(e) => setEdit({ ...edit, rate_per_sqft: e.target.value })}
            data-testid="flat-edit-rate"
          />
        </Field>
        <Field label="Price ₹">
          <AmountInput
            value={edit.price}
            onChange={(e) => setEdit({ ...edit, price: e.target.value })}
            data-testid="flat-edit-price"
          />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea
          rows={2}
          value={edit.notes}
          onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
          data-testid="flat-edit-notes"
        />
      </Field>
      <Button
        size="sm"
        disabled={busy}
        onClick={onSave}
        className="bg-ink-950 hover:bg-ink-800"
        data-testid="flat-edit-save"
      >
        Save changes
      </Button>
    </div>
  );
}
