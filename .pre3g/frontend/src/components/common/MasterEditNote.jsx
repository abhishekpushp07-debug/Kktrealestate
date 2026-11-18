import { Info } from "lucide-react";

/** REQ-136: every master edit screen says edits reach new entries only (bookings keep their snapshot). */
export function MasterEditNote({
  item,
  keeps = "Existing bookings keep the values they were made with.",
}) {
  if (!item?.id) return null;
  const n = item.usage_count;
  return (
    <p
      className="mt-3 flex items-start gap-2 rounded-lg border border-warm-200 bg-warm-100/60 px-3 py-2 text-xs text-txt-secondary"
      data-testid="master-change-note"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Changes apply to new entries only
        {n != null && (
          <>
            {" · "}
            <b className="text-ink-950" data-testid="master-change-used-in">
              Used in {n} {item.usage_label || "places"}
            </b>
          </>
        )}
        . {keeps}
      </span>
    </p>
  );
}
