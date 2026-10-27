import { Link, Outlet, useLocation } from "react-router-dom";
import { ChevronRight, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

export const MASTER_GROUPS = [
  { label: "Project structure", items: [["Projects", "/masters/projects", "masters.project.view"], ["Towers", "/masters/towers", "masters.tower.view"], ["Flats / inventory", "/masters/flats", "masters.flat.view"], ["Floor plans", "/masters/m/floor-plan-templates", "masters.floor_plan.view"], ["Flat types", "/masters/m/flat-types", "masters.flat_type.view"], ["Block types", "/masters/m/block-types", "masters.block_type.view"], ["PLC", "/masters/m/plc-types", "masters.plc.view"], ["Rate cards", "/masters/rate-cards", "masters.rate_card.view"], ["Specifications", "/masters/m/spec-items", "masters.specification.view"], ["Spec categories", "/masters/m/spec-categories", "masters.specification.view"], ["Room types", "/masters/m/room-types", "masters.flat_type.view"], ["Area types", "/masters/m/area-types", "masters.flat_type.view"], ["Amenities", "/masters/m/amenities", "masters.amenity.view"]] },
  { label: "Construction", items: [["Construction Stage master", "/masters/m/construction-stages", "masters.construction_stage.view"], ["Construction Stage Plans", "/masters/stage-plans", "masters.stage_plan.view"]] },
  { label: "Finance", items: [["Payment Plans", "/masters/payment-plans", "masters.payment_plan.view"], ["Charge types", "/masters/m/charge-types", "masters.charge_type.view"], ["Bank accounts", "/masters/m/bank-accounts", "masters.bank_account.view"], ["Payment modes", "/masters/m/payment-modes", "masters.payment_mode.view"], ["Cancellation / Bounce policy defaults", "/settings?tab=policies", "admin.settings.view"]] },
  { label: "Sales", items: [["Lead sources & stages", "/settings?tab=sales", "admin.settings.view"], ["Catalogues (brochures)", "/catalogues", "masters.catalogue.view"]] },
  { label: "Service", items: [["Categories & SLA targets", "/settings?tab=service", "admin.settings.view"]] },
  { label: "Documents & Notices", items: [["Company & letterhead", "/masters/company", "masters.company.view"], ["Document types", "/masters/m/document-types", "masters.document_type.view"], ["Notice templates", "/website/notices", "website.cms.view"]] },
  { label: "People", items: [["Users", "/users", "admin.user.view"], ["Roles", "/admin/access-control", "admin.access_control.manage"]] },
];

export default function MastersHub() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const groups = MASTER_GROUPS.map((g) => ({ ...g, items: g.items.filter(([, , p]) => can(p)) })).filter((g) => g.items.length);
  const isIndex = pathname === "/masters";
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]" data-testid="masters-hub">
      <aside className="card h-fit !p-3 lg:sticky lg:top-20" data-testid="masters-nav">
        <p className="label-xs px-2 pb-2 flex items-center gap-1"><Database className="h-3.5 w-3.5" />Masters · enter once, reuse everywhere</p>
        {groups.map((g) => <div key={g.label} className="mb-2">
          <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-txt-muted">{g.label}</p>
          {g.items.map(([label, to]) => <Link key={label} to={to} className={cn("flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-warm-50", pathname.startsWith(to.split("?")[0]) && to.startsWith("/masters") && "bg-ink-950 text-white hover:bg-ink-900")} data-testid={`masters-link-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{label}<ChevronRight className="h-3.5 w-3.5 opacity-50" /></Link>)}
        </div>)}
      </aside>
      <section className="min-w-0">
        {isIndex ? <div className="card p-6" data-testid="masters-index">
          <h1 className="font-display text-2xl text-ink-950">Masters</h1>
          <p className="mt-1 text-sm text-txt-secondary">Every list the ERP depends on lives here. The owner's flow: <b>Construction Stage master → Stage Plan (per tower) → Payment Plan (% per stage) → Booking → Construction update raises dues.</b></p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{groups.flatMap((g) => g.items.map(([label, to]) => <Link key={g.label + label} to={to} className="card card-hover !p-4" data-testid={`masters-card-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}><p className="text-[11px] font-bold uppercase tracking-wide text-txt-muted">{g.label}</p><p className="mt-1 font-semibold text-ink-950">{label}</p></Link>))}</div>
        </div> : <Outlet />}
      </section>
    </div>
  );
}
