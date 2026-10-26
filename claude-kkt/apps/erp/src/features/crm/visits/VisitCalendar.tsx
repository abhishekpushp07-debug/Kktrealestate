import { Users } from "lucide-react";
import { useMemo } from "react";
import type { VisitRow, VisitStatus } from "@kkt/contracts";
import { Badge, EmptyState } from "@/components/ui";
import { todayIST } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatSlotTime, shortDay, type CalendarDay } from "../api";

export interface VisitCalendarProps {
  days: CalendarDay[];
  mode: "day" | "week";
  onOpen: (visit: VisitRow) => void;
}

const CHIP_CLASS: Readonly<Record<VisitStatus, string>> = {
  CONFIRMED: "border-info/30 bg-info-bg text-info-fg",
  RESCHEDULED: "border-status-hold-border bg-warning-bg text-warning-fg",
  COMPLETED: "border-status-available-border bg-success-bg text-success-fg",
  NO_SHOW: "border-danger/30 bg-danger-bg text-danger-fg",
  CANCELLED: "border-border bg-surface text-ink-subtle line-through",
};

function VisitChip({
  visit,
  compact,
  onOpen,
}: {
  visit: VisitRow;
  compact: boolean;
  onOpen: (visit: VisitRow) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(visit)}
      title={`${visit.name} · ${visit.visitors} visitor${visit.visitors === 1 ? "" : "s"}${visit.assignee_name ? ` · ${visit.assignee_name}` : ""}`}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-sm border px-1.5 py-1 text-left text-xs leading-tight focus-ring hover:shadow-card",
        CHIP_CLASS[visit.status],
      )}
      data-testid={`visit-chip-${visit.id}`}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{visit.name}</span>
      {!compact && (
        <span className="money inline-flex shrink-0 items-center gap-0.5 text-[10px]">
          <Users className="size-3" aria-hidden="true" />
          {visit.visitors}
        </span>
      )}
      {visit.rescheduled_from && (
        <span className="shrink-0 rounded-xs bg-card/80 px-1 text-[9px] font-bold uppercase tracking-wide">moved</span>
      )}
    </button>
  );
}

/** Day view (slot rows) or week view (7 columns × slot rows) with visitor chips. */
export function VisitCalendar({ days, mode, onOpen }: VisitCalendarProps) {
  const today = todayIST();
  const slotTimes = useMemo(() => {
    const set = new Set<string>();
    for (const day of days) for (const slot of day.slots) set.add(`${slot.start}|${slot.end}`);
    return [...set].sort();
  }, [days]);

  if (days.length === 0)
    return (
      <EmptyState
        title="No calendar data"
        description="Pick a project with site-visit settings."
        className="rounded-lg border border-border bg-card"
      />
    );

  if (mode === "day") {
    const day = days[0];
    if (!day) return null;
    const slots = [...day.slots].sort((a, b) => a.start.localeCompare(b.start));
    return (
      <div className="rounded-lg border border-border bg-card shadow-card" data-testid="visit-calendar-day">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <h3 className="font-display text-md font-bold text-navy-950">{shortDay(day.date)}</h3>
          {day.is_blackout && <Badge variant="danger">Blackout</Badge>}
          {!day.is_visit_day && !day.is_blackout && <Badge variant="neutral">Not a visit day</Badge>}
        </header>
        {slots.length === 0 ? (
          <EmptyState
            compact
            title="No slots"
            description={day.is_blackout ? "Blackout date." : "No visit slots on this day."}
          />
        ) : (
          <ol className="divide-y divide-border">
            {slots.map((slot) => {
              const visits = slot.visits.filter((visit) => visit.status !== "CANCELLED");
              const cancelled = slot.visits.filter((visit) => visit.status === "CANCELLED");
              return (
                <li
                  key={slot.start}
                  className={cn(
                    "grid grid-cols-[6.5rem_1fr] gap-3 px-4 py-2 sm:grid-cols-[8rem_1fr]",
                    slot.is_past && "bg-surface/50",
                  )}
                >
                  <div className="leading-tight">
                    <p className="money text-sm font-semibold text-navy-950">{formatSlotTime(slot.start)}</p>
                    <p className="money text-2xs text-ink-subtle">
                      {slot.booked}/{slot.seats} seats · {slot.available} left
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {visits.length === 0 && cancelled.length === 0 && (
                      <span className="text-xs text-ink-subtle">—</span>
                    )}
                    {visits.map((visit) => (
                      <div key={visit.id} className="w-full sm:w-56">
                        <VisitChip visit={visit} compact={false} onOpen={onOpen} />
                      </div>
                    ))}
                    {cancelled.map((visit) => (
                      <div key={visit.id} className="w-full sm:w-56">
                        <VisitChip visit={visit} compact={false} onOpen={onOpen} />
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-border bg-card shadow-card scrollbar-thin"
      data-testid="visit-calendar-week"
    >
      <div
        className="min-w-[56rem]"
        style={{ display: "grid", gridTemplateColumns: `5.5rem repeat(${days.length}, minmax(9rem, 1fr))` }}
      >
        <div className="sticky left-0 z-10 border-b border-border bg-surface px-2 py-2" />
        {days.map((day) => (
          <div
            key={day.date}
            className={cn(
              "border-b border-l border-border px-2 py-2 text-center",
              day.date === today && "bg-gold-light/60",
            )}
          >
            <p className={cn("text-xs font-bold text-navy-950", day.date === today && "text-gold-text")}>
              {shortDay(day.date)}
            </p>
            <p className="text-[10px] text-ink-subtle">
              {day.is_blackout
                ? "Blackout"
                : !day.is_visit_day
                  ? "Closed"
                  : `${day.slots.reduce((sum, slot) => sum + slot.booked, 0)} booked`}
            </p>
          </div>
        ))}
        {slotTimes.map((key) => {
          const [start, end] = key.split("|");
          return [
            <div
              key={`t-${key}`}
              className="sticky left-0 z-10 border-b border-border bg-surface px-2 py-2 leading-tight"
            >
              <p className="money text-xs font-semibold text-navy-950">{formatSlotTime(start ?? "")}</p>
              <p className="money text-[10px] text-ink-subtle">– {formatSlotTime(end ?? "")}</p>
            </div>,
            ...days.map((day) => {
              const slot = day.slots.find((item) => item.start === start);
              return (
                <div
                  key={`${day.date}-${key}`}
                  className={cn(
                    "min-h-14 space-y-1 border-b border-l border-border p-1",
                    day.date === today && "bg-gold-light/30",
                    slot?.is_past && "bg-surface/60",
                    !slot && "bg-[repeating-linear-gradient(135deg,var(--color-border)_0_1px,transparent_1px_8px)]",
                  )}
                >
                  {slot && slot.seats > 0 && (
                    <p className="money px-0.5 text-[10px] text-ink-subtle">
                      {slot.booked}/{slot.seats}
                    </p>
                  )}
                  {slot?.visits.map((visit) => (
                    <VisitChip key={visit.id} visit={visit} compact onOpen={onOpen} />
                  ))}
                </div>
              );
            }),
          ];
        })}
      </div>
    </div>
  );
}
