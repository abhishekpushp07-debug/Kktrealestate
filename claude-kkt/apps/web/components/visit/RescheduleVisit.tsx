"use client";

import { useEffect, useState } from "react";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { Button } from "@/components/ui/Button";
import { FormStatus, Honeypot } from "@/components/ui/Field";
import { friendlyErrorMessage, isApiError, publicClient } from "@/lib/api";
import { addDays, dayOfMonth, formatDate, formatTime, monthShort, todayIST, weekdayShort } from "@/lib/format";
import type { SiteVisitManage, SiteVisitRescheduleResult, VisitDay, VisitSlot } from "@/lib/types";

const DAYS_AHEAD = 14;

/** Open slots per date, the visit's own current slot left out (moving onto it is a no-op). */
export function openSlotsByDate(
  days: readonly VisitDay[],
  current: { date: string; start: string },
): Map<string, VisitSlot[]> {
  return new Map(
    days.map((day) => [
      day.date,
      day.slots.filter((slot) => slot.available > 0 && !(day.date === current.date && slot.start === current.start)),
    ]),
  );
}

interface RescheduleVisitProps {
  visit: SiteVisitManage;
  token: string;
  onCancel: () => void;
  /** The visit moved: the response carries the NEW manage token (the old link stops working). */
  onMoved: (result: SiteVisitRescheduleResult) => void;
  /** 410: this link is no longer valid. */
  onExpired: (message: string) => void;
}

/** The visitor moves their own visit to another open slot (POST /public/site-visits/:token/reschedule). */
export function RescheduleVisit({ visit, token, onCancel, onMoved, onExpired }: RescheduleVisitProps) {
  const { apiUrl } = useSiteConfig();
  const [days, setDays] = useState<VisitDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<VisitSlot | null>(null);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from] = useState(todayIST);
  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(from, i));
  const current = { date: visit.visit_date, start: visit.slot_start };
  const byDate = openSlotsByDate(days ?? [], current);

  // Availability of the next two weeks (re-read after SLOT_FULL / SLOT_INVALID through reloadKey).
  useEffect(() => {
    let cancelled = false;
    publicClient(apiUrl)
      .getVisitAvailability(visit.project_slug, from, addDays(from, DAYS_AHEAD - 1))
      .then(
        (result) => {
          if (cancelled) return;
          setDays(result);
          const open = openSlotsByDate(result, { date: visit.visit_date, start: visit.slot_start });
          setSelectedDate((chosen) =>
            chosen && (open.get(chosen) ?? []).length
              ? chosen
              : (result.find((d) => (open.get(d.date) ?? []).length > 0)?.date ?? null),
          );
        },
        (err: unknown) => {
          if (cancelled) return;
          setDays([]);
          setError(friendlyErrorMessage(err));
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, from, visit.project_slug, visit.visit_date, visit.slot_start, reloadKey]);

  function reload() {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  async function submit() {
    if (!selectedDate || !selectedSlot) {
      setError("Please choose a new date and time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await publicClient(apiUrl).rescheduleSiteVisit(token, {
        date: selectedDate,
        start: selectedSlot.start,
        website: website as "",
      });
      onMoved(result);
    } catch (err) {
      if (isApiError(err) && err.status === 410) {
        onExpired(err.message);
        return;
      }
      setError(friendlyErrorMessage(err));
      if (isApiError(err) && (err.code === "SLOT_FULL" || err.code === "SLOT_INVALID")) {
        setSelectedSlot(null);
        reload();
      }
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean, disabled: boolean) =>
    `tap flex flex-col items-center justify-center rounded-2xl border px-3 py-2 text-sm transition ${
      disabled
        ? "cursor-not-allowed border-line text-ink-soft/50"
        : active
          ? "border-gold-500 bg-gold-500 text-navy-950 shadow-card"
          : "border-navy-900/55 bg-white text-navy-900 hover:border-gold-700"
    }`;

  return (
    <section
      className="mt-6 rounded-2xl border border-line bg-ivory-100 p-5"
      aria-labelledby="reschedule-title"
      data-testid="visit-reschedule-panel"
    >
      <h3 id="reschedule-title" className="font-semibold text-navy-900">
        Move your visit
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        Pick another open slot. Your current slot is freed and you get a new link for this page; the old link stops
        working.
      </p>
      <Honeypot value={website} onChange={setWebsite} />
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-semibold text-navy-900">New date</legend>
        <div
          className="hide-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1"
          role="radiogroup"
          aria-label="New visit date"
          aria-busy={loading}
        >
          {dates.map((date) => {
            const slots = byDate.get(date) ?? [];
            const disabled = loading || slots.length === 0;
            const active = selectedDate === date;
            return (
              <button
                key={date}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => {
                  setSelectedDate(date);
                  setSelectedSlot(null);
                }}
                className={`${chip(active, disabled)} w-[4.5rem] shrink-0 snap-start ${loading ? "skeleton" : ""}`}
                aria-label={`${formatDate(date, "long")}${disabled ? ", no slots" : `, ${slots.length} slot${slots.length === 1 ? "" : "s"}`}`}
              >
                <span className="text-[0.65rem] uppercase tracking-widest">{weekdayShort(date)}</span>
                <span className="font-display text-2xl leading-none">{dayOfMonth(date)}</span>
                <span className="text-[0.65rem] uppercase tracking-widest">{monthShort(date)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-semibold text-navy-900">New time (IST)</legend>
        {!loading && !selectedDate ? (
          <p className="text-sm text-ink-muted">
            No other slots are open in the next two weeks. Please call us to arrange a time.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="New visit time">
          {(selectedDate ? (byDate.get(selectedDate) ?? []) : []).map((slot) => {
            const active = selectedSlot?.start === slot.start;
            return (
              <button
                key={slot.start}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelectedSlot(slot)}
                className={`${chip(active, false)} min-w-[7.5rem]`}
              >
                <span className="font-semibold">{formatTime(slot.start)}</span>
                <span className={`text-[0.7rem] ${active ? "text-navy-950" : "text-ink-muted"}`}>
                  {slot.available} left
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      {error ? (
        <div className="mt-4">
          <FormStatus tone="error">{error}</FormStatus>
        </div>
      ) : null}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <Button onClick={submit} disabled={busy || !selectedSlot} data-testid="visit-reschedule-submit">
          {busy
            ? "Moving…"
            : selectedDate && selectedSlot
              ? `Move to ${formatDate(selectedDate, "medium")}, ${formatTime(selectedSlot.start)}`
              : "Move my visit"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Keep current time
        </Button>
      </div>
    </section>
  );
}
