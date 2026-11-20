import { useLocation } from "react-router-dom";
import { fmtDate } from "@/lib/format";
import { DrillFilterChip } from "@/components/common/DrillFilterChip";

const RANGES = [
  ["from_date", "to_date"],
  ["date_from", "date_to"],
  ["created_from", "created_to"],
  ["from", "to"],
];
const FLAGS = {
  hold_expiring: "Holds expiring in 48 h",
  due_today: "Follow-ups due today",
  unreplaced: "Not replaced",
  block_id: "One tower",
  tower: "One tower",
  project_id: "One project",
  project: "One project",
};

export function describeDrill(sp) {
  const parts = [];
  for (const [a, b] of RANGES)
    if (sp.get(a))
      parts.push(
        sp.get(a) === sp.get(b)
          ? fmtDate(sp.get(a))
          : `${fmtDate(sp.get(a))} → ${fmtDate(sp.get(b))}`,
      );
  if (sp.get("basis") === "due") parts.push("By due date");
  if (sp.get("stale_days")) parts.push(`No receipt for ${sp.get("stale_days")} days`);
  if (sp.get("bucket")) parts.push(`Ageing band ${sp.get("bucket")}`);
  if (sp.get("status")) parts.push(sp.get("status").split(",").join(" + "));
  Object.entries(FLAGS).forEach(
    ([k, label]) => sp.get(k) && !parts.includes(label) && parts.push(label),
  );
  return parts.join(" · ") || "Home figure";
}

// Any screen opened from a Home figure (?via=home) says so and offers one Clear back to the unfiltered screen.
export function HomeDrillBar() {
  const { search } = useLocation();
  const sp = new URLSearchParams(search);
  if (sp.get("via") !== "home") return null;
  return (
    <div className="mb-4 print:hidden">
      <DrillFilterChip text={describeDrill(sp)} testId="home-drill-chip" />
    </div>
  );
}
