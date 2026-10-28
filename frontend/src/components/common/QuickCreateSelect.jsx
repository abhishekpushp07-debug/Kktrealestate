import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { Select } from "@/components/v2/Select";
import { FlatTypeForm } from "@/pages/master/FlatTypeForm";
import { PaymentPlanForm } from "@/pages/master/PaymentPlanForm";
import api from "@/lib/api";

const QuickCustomerSheet = lazy(() => import("@/components/v2/QuickCustomerSheet"));

/** kind → { perm, list endpoint used to find the newly created row, form } */
const KINDS = {
  customer: { perm: "sales.customer.create", label: "customer" },
  flat_type: { perm: "masters.flat_type.create", label: "flat type", list: "/master/flat-types?page_size=200&sort=-created_at" },
  payment_plan: { perm: "masters.payment_plan.create", label: "payment plan", list: "/master/payment-plans?page_size=200&sort=-created_at" },
};

/**
 * Dependent dropdown with a "+ Create new …" footer: opens the existing create form in a sheet, then auto-selects the new
 * record and keeps the parent form state (the parent only receives onChange(newId)). Permission-filtered.
 */
export function QuickCreateSelect({ kind, value, onChange, options, onOptionsChanged, ...rest }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const meta = KINDS[kind];
  const allowed = meta && can(meta.perm);
  const before = new Set((options || []).map((o) => o.value));
  const created = async (row) => {
    setOpen(false);
    let id = row?.id;
    if (!id && meta.list) {
      const items = (await api.get(meta.list)).data.items || [];
      id = (items.find((i) => !before.has(i.id)) || items[0])?.id;
    }
    await qc.invalidateQueries({ queryKey: ["fetch"] });
    await qc.invalidateQueries({ queryKey: ["catalogues"] });
    onOptionsChanged?.();
    if (id) { onChange(id); toast.success(`New ${meta.label} selected`); }
  };
  return (
    <>
      <Select value={value} onChange={onChange} options={options} onCreateNew={allowed ? () => setOpen(true) : undefined} createLabel={meta ? `Create new ${meta.label}…` : undefined} {...rest} />
      {open && kind === "customer" && <Suspense fallback={null}><QuickCustomerSheet open onOpenChange={setOpen} onSaved={created} /></Suspense>}
      {open && kind === "flat_type" && <FlatTypeForm open onOpenChange={setOpen} onSaved={created} />}
      {open && kind === "payment_plan" && <PaymentPlanForm open onOpenChange={setOpen} onSaved={created} />}
    </>
  );
}
