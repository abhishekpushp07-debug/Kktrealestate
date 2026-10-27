import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Skeleton } from "@/components/ui";
import { todayIST } from "@/lib/format";
import { cn, useOnChange } from "@/lib/utils";
import { Notice } from "@/features/inventory/components";
import { addDays, formatSlotTime, shortDay, useVisitCalendar, type CalendarDay } from "../api";

export interface SlotValue {
  date: string;
  start: string;
}

export interface SlotPickerProps {
  projectId: string | null;
  value: SlotValue | null;
  onChange: (value: SlotValue | null) => void;
  /** Reschedule: the visit's own seat counts as free. */
  excludeVisitId?: string | null;
  daysAhead?: number;
}

/** Date strip (next N days) + slot chips with "N left"; full / past slots are hidden. */
export function SlotPicker({ projectId, value, onChange, excludeVisitId = null, daysAhead = 14 }: SlotPickerProps) {
  const today = todayIST();
  const [offset, setOffset] = useState(0);
  const from = addDays(today, offset);
  const to = addDays(from, daysAhead - 1);
  const calendar = useVisitCalendar(projectId, from, to);
  const [date, setDate] = useState<string | null>(value?.date ?? null);

  // A chosen slot (from outside) moves the date strip to its day.
  useOnChange(value?.date ?? null, (chosen) => {
    if (chosen) setDate(chosen);
  });

  const days = useMemo<CalendarDay[]>(() => {
    return (calendar.data ?? []).map((day) => ({
      ...day,
      slots: day.slots
        .map((slot) => {
          const own = excludeVisitId ? slot.visits.some((visit) => visit.id === excludeVisitId) : false;
          return { ...slot, available: slot.available + (own ? 1 : 0) };
        })
        .filter((slot) => !slot.is_past && slot.available > 0),
    }));
  }, [calendar.data, excludeVisitId]);

  const selectedDay = days.find((day) => day.date === date) ?? null;

  if (!projectId) return <Notice tone="info">Pick a project to see available slots.</Notice>;

  return (
    <div className="space-y-3" data-testid="slot-picker">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          aria-label="Earlier dates"
          disabled={offset === 0}
          onClick={() => setOffset((value) => Math.max(0, value - daysAhead))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1 scrollbar-thin">
          {calendar.isPending &&
            Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-14 w-16 shrink-0 rounded-md" />)}
          {days.map((day) => {
            const open = day.slots.length > 0;
            const seats = day.slots.reduce((sum, slot) => sum + slot.available, 0);
            const active = date === day.date;
            return (
              <button
                key={day.date}
                type="button"
                disabled={!open}
                aria-pressed={active}
                onClick={() => {
                  setDate(day.date);
                  if (value && value.date !== day.date) onChange(null);
                }}
                title={day.is_blackout ? "Blackout date" : !day.is_visit_day ? "Not a visit day" : undefined}
                className={cn(
                  "flex h-14 w-16 shrink-0 flex-col items-center justify-center rounded-md border text-xs leading-tight focus-ring",
                  active
                    ? "border-navy-950 bg-navy-950 text-white"
                    : open
                      ? "border-border-strong bg-card text-ink hover:border-navy-300"
                      : "border-dashed border-border text-ink-subtle line-through",
                )}
                data-testid={`slot-day-${day.date}`}
              >
                <span className="font-semibold">{shortDay(day.date).split(" ")[0]}</span>
                <span className="money">{shortDay(day.date).split(" ").slice(1).join(" ")}</span>
                {open && (
                  <span className={cn("money text-[10px]", active ? "text-gold" : "text-ink-subtle")}>
                    {seats} left
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="xs"
          aria-label="Later dates"
          onClick={() => setOffset((value) => value + daysAhead)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      {calendar.isError && (
        <Notice tone="danger">Could not load availability. Check the project's site-visit settings.</Notice>
      )}
      {calendar.data && days.every((day) => day.slots.length === 0) && (
        <Notice tone="warning">No open slots in this range. Try later dates or adjust the visit settings.</Notice>
      )}
      {selectedDay && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Slots on ${shortDay(selectedDay.date)}`}>
          {selectedDay.slots.map((slot) => {
            const active = value?.date === selectedDay.date && value.start === slot.start;
            return (
              <button
                key={slot.start}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ date: selectedDay.date, start: slot.start })}
                className={cn(
                  "money inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold focus-ring",
                  active
                    ? "border-gold bg-gold text-navy-950"
                    : "border-border-strong bg-card text-ink hover:border-navy-300",
                )}
                data-testid={`slot-${selectedDay.date}-${slot.start}`}
              >
                {formatSlotTime(slot.start)}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px]",
                    active ? "bg-navy-950 text-white" : "bg-navy-50 text-ink-muted",
                  )}
                >
                  {slot.available} left
                </span>
              </button>
            );
          })}
        </div>
      )}
      {!selectedDay && calendar.data && days.some((day) => day.slots.length > 0) && (
        <p className="text-xs text-ink-subtle">Pick a date to see its slots.</p>
      )}
    </div>
  );
}
