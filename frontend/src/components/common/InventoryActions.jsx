import { TypedMasterInput } from "@/components/common/TypedMasterInput";
import { plural } from "@/lib/format";
import { DateTimeInput, NativeSelect } from "@/components/common/EliteInputs";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const DISPLAY = ["Show as Available", "Show as Sold", "Show as Hold", "Hidden"];

export function InventoryActions({ flatIds, open, onClose, onDone }) {
  const { can } = useAuth();
  const [action, setAction] = useState("hold");
  const [cats, setCats] = useState([]);
  const [reasons, setReasons] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [f, setF] = useState({
    category_id: "",
    reason_id: "",
    reason: "",
    note: "",
    for_customer_id: "",
    expires_at: "",
    display_state: "Show as Sold",
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    api
      .get("/master/allocation-categories")
      .then((r) => setCats(r.data.items || []))
      .catch(() => {});
    api
      .get("/master/hold-reasons")
      .then((r) => setReasons(r.data.items || []))
      .catch(() => {});
    api
      .get("/customers", { params: { page_size: 50 } })
      .then((r) => setCustomers(r.data.items || []))
      .catch(() => {});
  }, [open]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const actions = [
    ["set_category", "Owner share", can("inventory.category.set")],
    ["hold", "Hold", can("inventory.hold.create")],
    ["extend_hold", "Extend hold", can("inventory.hold.create")],
    ["release", "Release", can("inventory.hold.release")],
    ["block", "Block", can("inventory.block.set")],
    ["unblock", "Unblock", can("inventory.block.set")],
    ["set_display", "Show to sales as", can("inventory.display.set")],
    ["clear_display", "Clear sales display", can("inventory.display.set")],
  ].filter((a) => a[2]);
  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        flat_ids: flatIds,
        action,
        ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")),
      };
      if (body.expires_at) body.expires_at = new Date(body.expires_at).toISOString();
      const r = await api.post("/inventory/bulk", body);
      toast.success(
        `${plural(r.data.done, "unit")} updated${
          r.data.skipped.length
            ? ` · ${r.data.skipped.length} skipped (${r.data.skipped
                .map((s) => `${s.flat_number}: ${s.reason}`)
                .slice(0, 3)
                .join("; ")})`
            : ""
        }`,
      );
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="w-[400px] overflow-y-auto sm:max-w-[400px]"
        data-testid="inventory-actions-sheet"
      >
        <SheetHeader>
          <SheetTitle>Inventory actions · {flatIds.length} unit(s)</SheetTitle>
        </SheetHeader>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {actions.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setAction(k)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${action === k ? "border-ink-950 bg-ink-950 text-white" : "bg-white"}`}
              data-testid={`inv-action-${k}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="mt-5 space-y-3 text-sm">
          {action === "set_category" && (
            <label className="block">
              <span className="label-xs">Owner share</span>
              <NativeSelect
                className="input mt-1 h-9 w-full"
                value={f.category_id}
                onChange={set("category_id")}
                data-testid="inv-category"
              >
                <option value="">Select…</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.bookable ? " (bookable)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          {action === "hold" && (
            <>
              <label className="block">
                <span className="label-xs">Hold reason *</span>
                <NativeSelect
                  className="input mt-1 h-9 w-full"
                  value={f.reason_id}
                  onChange={set("reason_id")}
                  data-testid="inv-hold-reason"
                >
                  <option value="">Select…</option>
                  {reasons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="block">
                <span className="label-xs">For customer (optional)</span>
                <NativeSelect
                  className="input mt-1 h-9 w-full"
                  value={f.for_customer_id}
                  onChange={set("for_customer_id")}
                  data-testid="inv-hold-customer"
                >
                  <option value="">—</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </>
          )}
          {(action === "hold" || action === "extend_hold") && (
            <label className="block">
              <span className="label-xs">Expires at * (mandatory — no default)</span>
              <DateTimeInput
                value={f.expires_at}
                onChange={set("expires_at")}
                className="mt-1 h-9"
                data-testid="inv-hold-expires"
              />
            </label>
          )}
          {(action === "block" || action === "set_display") && (
            <label className="block">
              <span className="label-xs">Reason *</span>
              <TypedMasterInput
                list="inventory_reason"
                value={f.reason}
                onChange={(v) => setF({ ...f, reason: v })}
                className="mt-1"
                testId="inv-reason"
              />
            </label>
          )}
          {action === "set_display" && (
            <label className="block">
              <span className="label-xs">Show to sales as</span>
              <NativeSelect
                className="input mt-1 h-9 w-full"
                value={f.display_state}
                onChange={set("display_state")}
                data-testid="inv-display-state"
              >
                {DISPLAY.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </NativeSelect>
            </label>
          )}
          {action !== "set_display" && action !== "set_category" && (
            <label className="block">
              <span className="label-xs">Note</span>
              <Input
                value={f.note}
                onChange={set("note")}
                className="mt-1 h-9"
                data-testid="inv-note"
              />
            </label>
          )}
          {action === "set_display" && (
            <p className="rounded bg-amber2-50 p-2 text-xs text-amber">
              Overrides what non-privileged users and the public see. The real status is unchanged;
              the unit shows a <b>masked</b> tag for privileged users and the change is audited.
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} data-testid="inv-cancel">
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} data-testid="inv-apply">
            {busy ? "Applying…" : "Apply"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
