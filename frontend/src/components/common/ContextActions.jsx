import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const tid = (label) => `ca-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * "Add / Do next" bar: permission-gated, context-prefilled actions that reuse existing creation flows.
 * items: [{ label, to | onClick | node, perm, icon, primary, disabledReason, testId }]. Items the user cannot perform are hidden;
 * items with disabledReason render disabled with the visible reason (e.g. "Landowner share — not saleable").
 */
export function ContextActions({ items, title = "Add / Do next", testId = "context-actions", className }) {
  const { can } = useAuth();
  const visible = items.filter((i) => i && (!i.perm || can(i.perm)));
  if (!visible.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-2xl border border-warm-200 bg-white/70 px-4 py-3", className)} data-testid={testId}>
      <span className="label-xs mr-1 flex items-center gap-1 text-txt-muted"><Plus className="h-3.5 w-3.5" />{title}</span>
      {visible.map(({ label, to, onClick, node, icon: Icon, primary, disabledReason, testId: t }) => {
        const id = t || tid(label);
        if (node) return <span key={label} data-testid={id}>{node}</span>;
        if (disabledReason) return (
          <span key={label} className="inline-flex items-center gap-1.5" data-testid={id} aria-disabled="true">
            <span className="btn btn-ghost btn-sm cursor-not-allowed opacity-50">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</span>
            <span className="text-xs text-brick" data-testid={`${id}-reason`}>{disabledReason}</span>
          </span>
        );
        const cls = cn("btn btn-sm", primary ? "btn-primary" : "btn-secondary");
        if (onClick) return <button key={label} type="button" onClick={onClick} className={cls} data-testid={id}>{Icon && <Icon className="h-3.5 w-3.5" />}{label}</button>;
        return <Link key={label} to={to} className={cls} data-testid={id}>{Icon && <Icon className="h-3.5 w-3.5" />}{label}</Link>;
      })}
    </div>
  );
}
