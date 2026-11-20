import { Link, useLocation } from "react-router-dom";
import { X } from "lucide-react";

// Shown when a list was opened from a Home figure, so the user sees why it is short and can reset it.
export function DrillFilterChip({ text, testId = "drill-filter-chip" }) {
  const { pathname, search } = useLocation();
  const tab = new URLSearchParams(search).get("tab");
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-warm-200 bg-warm-50 px-3 py-1 text-xs text-txt-secondary"
      data-testid={testId}
    >
      <span>
        Filtered from Home · <span className="font-semibold text-ink-950">{text}</span>
      </span>
      <Link
        to={tab ? `${pathname}?tab=${tab}` : pathname}
        state={{ cleared: Date.now() }} // remounts the screen so filters taken from the URL reset too
        className="inline-flex items-center gap-0.5 text-gold hover:underline"
        data-testid={`${testId}-clear`}
      >
        <X className="h-3 w-3" aria-hidden /> Clear
      </Link>
    </div>
  );
}
