import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ADVANCED_ITEMS } from "@/pages/masters/MastersHub";
import { cn } from "@/lib/utils";

/** Admin → Advanced: rarely-touched lists, collapsed by default. */
export default function AdminAdvanced() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const items = ADVANCED_ITEMS.filter(([, , p]) => can(p));
  return (
    <div className="space-y-4" data-testid="admin-advanced-page">
      <div>
        <h1 className="e-title" data-testid="page-title">
          advanced.
        </h1>
        <p className="text-sm text-txt-secondary">
          Lists most teams set once and never touch again. The 13 everyday masters live under{" "}
          <Link to="/masters" className="underline">
            Masters
          </Link>
          .
        </p>
      </div>
      <div className="card !p-0">
        <button
          className="flex w-full items-center justify-between px-5 py-4 text-left"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="admin-advanced-toggle"
        >
          <span className="font-semibold text-ink-950">
            Advanced lists <span className="ml-2 text-xs text-txt-muted">{items.length} items</span>
          </span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div
            className="grid gap-2 border-t border-warm-100 p-4 sm:grid-cols-2 xl:grid-cols-3"
            data-testid="admin-advanced-list"
          >
            {items.map(([label, to]) => (
              <Link
                key={label}
                to={to}
                className="rounded-lg border border-warm-200 px-3 py-2 text-sm hover:bg-warm-50"
                data-testid={`advanced-link-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
