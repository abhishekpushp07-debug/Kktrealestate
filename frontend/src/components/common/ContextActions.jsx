import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

/**
 * "Add / Do next" bar: permission-gated, context-prefilled links to existing creation flows.
 * items: [{ label, to, perm, icon: Icon, primary, disabledReason, testId }]. Items the user cannot perform are hidden;
 * items with disabledReason render disabled with the reason as tooltip (e.g. "Assign a stage plan first").
 */
export function ContextActions({ items, title = "Add / Do next", testId = "context-actions", className }) {
  const { can } = useAuth();
  const visible = items.filter((i) => !i.perm || can(i.perm));
  if (!visible.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-2xl border border-warm-200 bg-white/70 px-4 py-3", className)} data-testid={testId}>
      <span className="label-xs mr-1 flex items-center gap-1 text-txt-muted"><Plus className="h-3.5 w-3.5" />{title}</span>
      {visible.map(({ label, to, icon: Icon, primary, disabledReason, testId: tid }) => disabledReason ? (
        <span key={label} className="btn btn-ghost btn-sm cursor-not-allowed opacity-50" title={disabledReason} aria-disabled="true" data-testid={tid || `ca-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{Icon && <Icon className="h-3.5 w-3.5" />}{label}</span>
      ) : (
        <Link key={label} to={to} className={cn("btn btn-sm", primary ? "btn-primary" : "btn-secondary")} data-testid={tid || `ca-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{Icon && <Icon className="h-3.5 w-3.5" />}{label}</Link>
      ))}
    </div>
  );
}
