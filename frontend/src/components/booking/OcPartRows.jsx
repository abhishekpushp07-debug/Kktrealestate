import { useState } from "react";
import { fmtDate, inr } from "@/lib/format";

const STATE = {
  paid: () => <span className="text-sage">Paid</span>,
  open: () => <span className="text-txt-secondary">Open</span>,
  overdue: (p) => (
    <span className="text-brick font-medium">
      Overdue {p.days_overdue} {p.days_overdue === 1 ? "day" : "days"}
    </span>
  ),
};

/** REQ-205: each billed part of an other-charge line as its own sub-row (billed on · due on · amount · state). */
export const OcPartRows = ({ line, cols }) => {
  const [all, setAll] = useState(false);
  const parts = line.parts || [];
  if (parts.length < 2) return null;
  const shown = all ? parts : parts.slice(0, 3);
  return (
    <>
      {shown.map((p, i) => (
        <tr
          key={`${p.bill_day}-${p.due_on}-${p.amount}`}
          className="text-xs bg-surface-2/40"
          data-testid={`oc-part-${line.line_id}-${i}`}
        >
          <td className="pl-8 pr-3 py-1.5 text-txt-secondary">Part {i + 1}</td>
          <td colSpan={cols - 5} className="px-3 py-1.5 text-txt-secondary">
            Billed {fmtDate(p.bill_day)} · due {fmtDate(p.due_on)}
          </td>
          <td className="px-3 py-1.5 text-right tabular">{inr(p.amount)}</td>
          <td className="px-3 py-1.5 text-right tabular">{inr(p.paid)}</td>
          <td className="px-3 py-1.5 text-right tabular">{p.open ? inr(p.open) : "—"}</td>
          <td className="px-3 py-1.5" data-testid={`oc-part-state-${line.line_id}-${i}`}>
            {STATE[p.status](p)}
          </td>
        </tr>
      ))}
      {parts.length > 3 && (
        <tr className="text-xs">
          <td colSpan={cols} className="pl-8 py-1">
            <button
              type="button"
              className="text-sapphire hover:underline"
              onClick={() => setAll(!all)}
              data-testid={`oc-parts-toggle-${line.line_id}`}
            >
              {all ? "Show fewer parts" : `Show all ${parts.length} parts`}
            </button>
          </td>
        </tr>
      )}
    </>
  );
};
