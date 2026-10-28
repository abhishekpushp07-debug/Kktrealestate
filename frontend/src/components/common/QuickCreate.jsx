import { lazy, Suspense, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { invalidateCatalogues } from "@/hooks/useCatalogues";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TowerForm } from "@/pages/masters/Towers";
import { ProjectForm } from "@/pages/masters/ProjectsMaster";
import { StagePlanForm } from "@/pages/masters/StagePlans";
import { PaymentPlanForm as StructuredPaymentPlanForm } from "@/pages/masters/PaymentPlans";
import { FlatTypeForm } from "@/pages/master/FlatTypeForm";
import { GenericMasterForm } from "@/pages/master/GenericMasterForm";
import { MASTERS } from "@/pages/master/masterConfig";
import { AddFlatSheet } from "@/components/structure/StructureSheets";

const QuickCustomerSheet = lazy(() => import("@/components/v2/QuickCustomerSheet"));

/** Every inline-creatable entity: permission (same as the normal create path) + human label. */
export const QUICK_KINDS = {
  project: { perm: "masters.project.create", label: "project" },
  tower: { perm: "masters.tower.create", label: "tower" },
  flat: { perm: "masters.flat.create", label: "flat" },
  customer: { perm: "sales.customer.create", label: "customer" },
  flat_type: { perm: "masters.flat_type.create", label: "flat type" },
  stage: { perm: "masters.construction_stage.create", label: "construction stage" },
  stage_plan: { perm: "masters.stage_plan.create", label: "stage plan" },
  payment_plan: { perm: "masters.payment_plan.create", label: "payment plan" },
};

function Panel({ title, children, onClose, testId }) {
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}><SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-3xl" data-testid={testId}>
      <SheetHeader><SheetTitle className="font-display text-2xl">{title}</SheetTitle></SheetHeader>
      <div className="mt-5">{children}</div>
    </SheetContent></Sheet>
  );
}

function FlatHost({ prefill, onDone, onClose }) {
  const [tower, setTower] = useState(null);
  useEffect(() => { api.get(`/projects/${prefill.project_id}/structure`).then((r) => setTower(r.data.towers.find((t) => t.id === prefill.block_id) || null)).catch((e) => { toast.error(errMsg(e)); onClose(); }); }, [prefill.project_id, prefill.block_id, onClose]);
  return tower ? <AddFlatSheet tower={tower} onClose={onClose} onSaved={onDone} /> : null;
}

/**
 * Opens the existing create form for `kind` (prefilled from `prefill`) and resolves with the created record.
 * The parent only receives onCreated(record) — its own form state is untouched.
 */
export function QuickCreateHost({ kind, prefill = {}, onCreated, onClose }) {
  const [projects, setProjects] = useState([]);
  const [stages, setStages] = useState([]);
  useEffect(() => { if (kind === "tower") api.get("/projects?page_size=200").then((r) => setProjects(r.data.items)); if (kind === "stage_plan") api.get("/master/construction-stages?page_size=200").then((r) => setStages(r.data.items.filter((s) => s.is_active !== false))); }, [kind]);
  const done = async (row) => { await invalidateCatalogues(); toast.success(`New ${QUICK_KINDS[kind].label} selected`); onCreated(row); };
  if (kind === "customer") return <Suspense fallback={null}><QuickCustomerSheet open onOpenChange={(o) => !o && onClose()} onSaved={done} /></Suspense>;
  if (kind === "flat_type") return <FlatTypeForm open onOpenChange={(o) => !o && onClose()} onSaved={async () => { const r = await api.get("/master/flat-types?page_size=200&sort=-created_at"); done(r.data.items[0]); }} />;
  if (kind === "stage") return <GenericMasterForm cfg={MASTERS.find((m) => m.kind === "construction-stages")} item={null} open onOpenChange={(o) => !o && onClose()} onSaved={(row) => row && done(row)} />;
  if (kind === "flat") return <FlatHost prefill={prefill} onDone={done} onClose={onClose} />;
  if (kind === "project") return <Panel title="New project" onClose={onClose} testId="quick-create-project"><ProjectForm project={{}} onClose={onClose} onSaved={done} /></Panel>;
  if (kind === "tower") return <Panel title="New tower" onClose={onClose} testId="quick-create-tower">{projects.length > 0 && <TowerForm tower={{ project_id: prefill.project_id || "" }} projects={projects} onClose={onClose} onSaved={done} />}</Panel>;
  if (kind === "stage_plan") return <Panel title="New stage plan" onClose={onClose} testId="quick-create-stage-plan"><StagePlanForm plan={{ project_id: prefill.project_id || "", block_id: prefill.block_id || "" }} stages={stages} onClose={onClose} onSaved={done} onStageAdded={async () => setStages((await api.get("/master/construction-stages?page_size=200")).data.items)} /></Panel>;
  if (kind === "payment_plan") return <Panel title="New payment plan" onClose={onClose} testId="quick-create-payment-plan"><StructuredPaymentPlanForm initial={prefill} onClose={onClose} onSaved={done} /></Panel>;
  return null;
}

/** "+ New …" button to sit beside a native <select>; hidden when the user lacks the create permission. */
export function QuickAddButton({ kind, prefill, onCreated, disabled, testId, className = "btn btn-ghost btn-sm" }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const meta = QUICK_KINDS[kind];
  if (!meta || !can(meta.perm)) return null;
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)} data-testid={testId || `quick-add-${kind}`} title={`Create new ${meta.label}`}><Plus className="h-3.5 w-3.5" />New</button>
      {open && <QuickCreateHost kind={kind} prefill={prefill} onClose={() => setOpen(false)} onCreated={(row) => { setOpen(false); onCreated(row); }} />}
    </>
  );
}

/** Hook form of the same thing for Select/Combobox `onCreateNew` footers. */
export function useQuickCreate(kind, prefill, onCreated) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const meta = QUICK_KINDS[kind];
  const allowed = !!meta && can(meta.perm);
  const node = open ? <QuickCreateHost kind={kind} prefill={prefill} onClose={() => setOpen(false)} onCreated={(row) => { setOpen(false); onCreated(row); }} /> : null;
  return { onCreateNew: allowed ? () => setOpen(true) : undefined, createLabel: meta ? `Create new ${meta.label}…` : undefined, node };
}
