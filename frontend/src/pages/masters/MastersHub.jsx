import { Link, Outlet, useLocation } from "react-router-dom";
import { ChevronRight, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

/** Phase S1 — exactly 13 company-level masters. Everything else lives under Admin → Advanced. */
export const MASTER_GROUPS = [
  {
    label: "Unit templates",
    items: [
      ["Flat Types", "/masters/m/flat-types", "masters.flat_type.view"],
      ["Floor Templates", "/masters/floor-templates", "masters.floor_plan.view"],
      ["Tower Templates", "/masters/tower-templates", "masters.project.view"],
    ],
  },
  {
    label: "Construction & money",
    items: [
      ["Construction Stages", "/masters/m/construction-stages", "masters.construction_stage.view"],
      ["Stage Plan Templates", "/masters/stage-plan-templates", "masters.stage_plan.view"],
      ["Payment Plan Templates", "/masters/payment-plan-templates", "masters.payment_plan.view"],
      ["Charge Heads", "/masters/m/charge-types", "masters.charge_type.view"],
      ["Parking Slot Types", "/masters/m/parking-slot-types", "masters.flat.view"],
    ],
  },
  {
    label: "Lists",
    items: [
      ["Payment Modes", "/masters/m/payment-modes", "masters.payment_mode.view"],
      ["Bank Accounts", "/masters/m/bank-accounts", "masters.bank_account.view"],
      ["Lead Sources", "/settings?tab=sales", "admin.settings.view"],
      ["Document Types & Letterhead", "/masters/company", "masters.company.view"],
      ["Users & Roles", "/users", "admin.user.view"],
    ],
  },
];

/** Rarely-touched lists — shown collapsed under Admin → Advanced; old routes keep working. */
export const ADVANCED_ITEMS = [
  ["PLC types", "/masters/m/plc-types", "masters.plc.view"],
  ["Specification categories", "/masters/m/spec-categories", "masters.specification.view"],
  ["Specification items", "/masters/m/spec-items", "masters.specification.view"],
  ["Room types", "/masters/m/room-types", "masters.flat_type.view"],
  ["Area types", "/masters/m/area-types", "masters.flat_type.view"],
  ["Block types", "/masters/m/block-types", "masters.block_type.view"],
  ["Amenities", "/masters/m/amenities", "masters.amenity.view"],
  ["Rate cards", "/projects", "masters.rate_card.view"],
  ["Message templates", "/masters/templates", "masters.template.view"],
  ["Notice templates", "/website/notices", "website.cms.view"],
  ["Catalogues (brochures)", "/settings/catalogues", "masters.catalogue.view"],
  ["Website", "/website/settings", "website.cms.view"],
  ["Document types", "/masters/m/document-types", "masters.document_type.view"],
  ["Allocation categories", "/masters/m/allocation-categories", "masters.allocation_category.view"],
  ["Hold reasons", "/masters/m/hold-reasons", "masters.hold_reason.view"],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function MastersHub() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const groups = MASTER_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(([, , p]) => can(p)),
  })).filter((g) => g.items.length);
  const isIndex = pathname === "/masters";
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]" data-testid="masters-hub">
      <aside
        className={cn(
          "card h-fit max-h-[38vh] overflow-y-auto !p-3 lg:sticky lg:top-20 lg:block lg:max-h-none",
          !isIndex && "hidden",
        )}
        data-testid="masters-nav"
      >
        <p className="label-xs px-2 pb-2 flex items-center gap-1">
          <Database className="h-3.5 w-3.5" />
          Masters · set once, reuse everywhere
        </p>
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-txt-muted">
              {g.label}
            </p>
            {g.items.map(([label, to]) => (
              <Link
                key={label}
                to={to}
                className={cn(
                  "flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-warm-50",
                  pathname.startsWith(to.split("?")[0]) &&
                    to.startsWith("/masters") &&
                    "bg-ink-950 text-white hover:bg-ink-900",
                )}
                data-testid={`masters-link-${slug(label)}`}
              >
                {label}
                <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              </Link>
            ))}
          </div>
        ))}
        {can("admin.settings.view") && (
          <Link
            to="/admin/advanced"
            className="mt-2 block rounded-md px-2 py-1.5 text-xs text-txt-muted hover:bg-warm-50"
            data-testid="masters-advanced-link"
          >
            Rarely used lists → Admin · Advanced
          </Link>
        )}
      </aside>
      <section className="min-w-0">
        {isIndex ? (
          <div className="card p-6" data-testid="masters-index">
            <h1 className="e-title" data-testid="page-title">
              masters.
            </h1>
            <p className="mt-1 text-sm text-txt-secondary">
              Set these once. Then every project is just{" "}
              <b>Project → Towers (from a template) → Floors → Flats</b>, with stage &amp; payment
              plans picked from dropdowns.
            </p>
            {groups.map((g) => (
              <div key={g.label} className="mt-5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-txt-muted">
                  {g.label}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {g.items.map(([label, to]) => (
                    <Link
                      key={label}
                      to={to}
                      className="card card-hover !p-4"
                      data-testid={`masters-card-${slug(label)}`}
                    >
                      <p className="font-semibold text-ink-950">{label}</p>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Outlet />
        )}
      </section>
    </div>
  );
}
