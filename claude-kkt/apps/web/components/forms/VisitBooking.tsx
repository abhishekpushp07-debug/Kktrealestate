"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, FormStatus, Honeypot, Input, Select, Textarea } from "@/components/ui/Field";
import { CalendarIcon, CheckIcon, ClockIcon, DownloadIcon, ExternalLinkIcon, MapPinIcon } from "@/components/ui/icons";
import { absoluteApiUrl, friendlyErrorMessage, isApiError, publicClient } from "@/lib/api";
import { addDays, canonicalPhone, dayOfMonth, formatDate, formatTime, formatTimeRange, monthShort, todayIST, weekdayShort } from "@/lib/format";
import type { SiteVisitRequest, SiteVisitResult, VisitDay, VisitSlot } from "@/lib/types";

export interface VisitProjectOption {
  slug: string;
  name: string;
}

interface VisitBookingProps {
  projects: VisitProjectOption[];
  defaultProjectSlug?: string;
  /** Hide the project selector (project detail page). */
  fixedProject?: boolean;
  heading?: string;
  tone?: "light" | "dark";
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success"; result: SiteVisitResult };

const DAYS_AHEAD = 14;

export function VisitBooking({ projects, defaultProjectSlug, fixedProject = false, heading, tone = "light" }: VisitBookingProps) {
  const { apiUrl, siteUrl, brandName } = useSiteConfig();
  const id = useId();
  const [projectSlug, setProjectSlug] = useState(defaultProjectSlug ?? projects[0]?.slug ?? "");
  const [days, setDays] = useState<VisitDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<VisitSlot | null>(null);
  const [values, setValues] = useState({ name: "", phone: "", email: "", visitors: "1", message: "", consent: false, website: "" });
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string; consent?: string; slot?: string }>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const from = todayIST();
  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(from, i));
  const byDate = new Map((days ?? []).map((d) => [d.date, d.slots.filter((s) => s.available > 0)]));
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((v) => ({ ...v, [key]: value }));

  const loadAvailability = useCallback(async () => {
    if (!projectSlug) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await publicClient(apiUrl).getVisitAvailability(projectSlug, from, addDays(from, DAYS_AHEAD - 1));
      setDays(result);
      const open = result.find((d) => d.slots.some((s) => s.available > 0));
      setSelectedDate((current) => (current && result.some((d) => d.date === current && d.slots.some((s) => s.available > 0)) ? current : (open?.date ?? null)));
    } catch (error) {
      setDays([]);
      setLoadError(
        isApiError(error) && error.status === 404
          ? "Site visits are not open for this project yet. Please call us and we will arrange a private viewing."
          : friendlyErrorMessage(error),
      );
    } finally {
      setLoading(false);
    }
  }, [apiUrl, from, projectSlug]);

  useEffect(() => {
    setSelectedSlot(null);
    void loadAvailability();
  }, [loadAvailability]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!selectedDate || !selectedSlot) next.slot = "Please choose a date and time for your visit.";
    if (values.name.trim().length < 2) next.name = "Please enter your full name.";
    if (!canonicalPhone(values.phone)) next.phone = "Enter a valid 10-digit Indian mobile number.";
    if (values.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim())) next.email = "Enter a valid email address.";
    if (!values.consent) next.consent = "Please agree so we can confirm your visit.";
    setErrors(next);
    if (Object.keys(next).length || !selectedDate || !selectedSlot) return;

    setStatus({ kind: "submitting" });
    const body: SiteVisitRequest = {
      project_slug: projectSlug,
      visit_date: selectedDate,
      slot_start: selectedSlot.start,
      name: values.name.trim(),
      phone: canonicalPhone(values.phone) ?? values.phone,
      ...(values.email.trim() ? { email: values.email.trim() } : {}),
      visitors: Math.min(6, Math.max(1, Number(values.visitors) || 1)),
      ...(values.message.trim() ? { message: values.message.trim() } : {}),
      consent: true,
      website: values.website as "",
    };
    try {
      const result = await publicClient(apiUrl).bookSiteVisit(body);
      setStatus({ kind: "success", result });
    } catch (error) {
      if (isApiError(error) && error.code === "SLOT_FULL") {
        setSelectedSlot(null);
        await loadAvailability();
      }
      setStatus({ kind: "error", message: friendlyErrorMessage(error) });
    }
  }

  const dark = tone === "dark";
  const projectName = projects.find((p) => p.slug === projectSlug)?.name ?? "";

  if (status.kind === "success") {
    const r = status.result;
    const ics = absoluteApiUrl(apiUrl, r.ics_url);
    const manage = /^https?:\/\//.test(r.manage_url) ? r.manage_url : `${siteUrl}${r.manage_url.startsWith("/") ? "" : "/"}${r.manage_url}`;
    return (
      <div className={`rounded-card border p-6 sm:p-8 ${dark ? "border-ivory-100/15 bg-ivory-100/5 text-ivory-100" : "border-line bg-white text-ink"}`} role="status" aria-live="polite">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold-500 text-navy-950">
            <CheckIcon size={24} />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-display-sm">Your visit is confirmed</h3>
            <p className={`mt-1 ${dark ? "text-ivory-100/75" : "text-ink-muted"}`}>
              Visit number <span className="font-semibold text-gold-500">{r.visit_number}</span>
              {` · ${r.project_name || projectName}`}
            </p>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="flex gap-3">
            <CalendarIcon className="mt-0.5 shrink-0 text-gold-500" />
            <div>
              <dt className="text-xs uppercase tracking-widest opacity-70">Date</dt>
              <dd className="font-semibold">{formatDate(r.visit_date, "long")}</dd>
            </div>
          </div>
          <div className="flex gap-3">
            <ClockIcon className="mt-0.5 shrink-0 text-gold-500" />
            <div>
              <dt className="text-xs uppercase tracking-widest opacity-70">Time (IST)</dt>
              <dd className="font-semibold">{formatTimeRange(r.slot_start, r.slot_end)}</dd>
            </div>
          </div>
          {r.site_office_address ? (
            <div className="flex gap-3 sm:col-span-2">
              <MapPinIcon className="mt-0.5 shrink-0 text-gold-500" />
              <div>
                <dt className="text-xs uppercase tracking-widest opacity-70">Site office</dt>
                <dd className="whitespace-pre-line">{r.site_office_address}</dd>
                {r.maps_link ? (
                  <a href={r.maps_link} className="mt-1 inline-flex min-h-12 items-center gap-1 text-gold-600 underline-offset-4 hover:underline" rel="noopener noreferrer" target="_blank">
                    Open in Maps <ExternalLinkIcon size={14} />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </dl>
        {r.instructions ? <p className={`mt-5 rounded-xl p-4 text-sm leading-6 ${dark ? "bg-ivory-100/5" : "bg-ivory-100"}`}>{r.instructions}</p> : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button href={ics} external variant="primary" rel="noopener">
            <DownloadIcon size={18} /> Add to calendar (.ics)
          </Button>
          <Button href={manage} external variant={dark ? "outline-light" : "outline"} rel="noopener">
            Manage or cancel
          </Button>
        </div>
        <p className={`mt-4 text-xs ${dark ? "text-ivory-100/60" : "text-ink-soft"}`}>Keep the manage link private — anyone with it can cancel this visit.</p>
      </div>
    );
  }

  const busy = status.kind === "submitting";
  const chip = (active: boolean, disabled: boolean) =>
    `tap flex flex-col items-center justify-center rounded-2xl border px-3 py-2 text-sm transition ${
      disabled
        ? dark
          ? "cursor-not-allowed border-ivory-100/10 text-ivory-100/30"
          : "cursor-not-allowed border-line text-ink-soft/50"
        : active
          ? "border-gold-500 bg-gold-500 text-navy-950 shadow-card"
          : dark
            ? "border-ivory-100/20 text-ivory-100 hover:border-gold-300"
            : "border-navy-900/15 bg-white text-navy-900 hover:border-gold-500"
    }`;
  const labelTone = dark ? "[&_label]:text-ivory-100 [&_p]:text-ivory-100/70" : "";

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={busy} className={`relative ${labelTone}`}>
      {heading ? <h3 className={`mb-6 font-display text-display-sm ${dark ? "text-ivory-100" : "text-navy-900"}`}>{heading}</h3> : null}
      <Honeypot value={values.website} onChange={(v) => set("website", v)} />

      {!fixedProject ? (
        <Field label="Project" htmlFor={`${id}-project`} required className="mb-6 max-w-md">
          <Select id={`${id}-project`} name="project_slug" value={projectSlug} onChange={(e) => setProjectSlug(e.target.value)}>
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <fieldset className="mb-6">
        <legend className={`mb-3 text-sm font-semibold ${dark ? "text-ivory-100" : "text-navy-900"}`}>
          1. Choose a date <span className="font-normal opacity-70">(next 14 days)</span>
        </legend>
        {loadError ? <FormStatus tone="error">{loadError}</FormStatus> : null}
        <div className="hide-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Visit date" aria-busy={loading}>
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

      <fieldset className="mb-6">
        <legend className={`mb-3 text-sm font-semibold ${dark ? "text-ivory-100" : "text-navy-900"}`}>2. Pick a time (IST)</legend>
        {!loading && selectedDate && (byDate.get(selectedDate) ?? []).length === 0 ? (
          <p className={`text-sm ${dark ? "text-ivory-100/70" : "text-ink-muted"}`}>No slots on this day.</p>
        ) : !loading && !selectedDate ? (
          <p className={`text-sm ${dark ? "text-ivory-100/70" : "text-ink-muted"}`}>No visit slots are open in the next two weeks. Please call us to arrange a time.</p>
        ) : null}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Visit time">
          {(selectedDate ? (byDate.get(selectedDate) ?? []) : []).map((slot) => {
            const active = selectedSlot?.start === slot.start;
            return (
              <button key={slot.start} type="button" role="radio" aria-checked={active} onClick={() => setSelectedSlot(slot)} className={`${chip(active, false)} min-w-[7.5rem]`}>
                <span className="font-semibold">{formatTime(slot.start)}</span>
                <span className={`text-[0.7rem] ${active ? "text-navy-900/70" : "opacity-70"}`}>
                  {slot.available} left
                </span>
              </button>
            );
          })}
        </div>
        {errors.slot ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {errors.slot}
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className={`mb-3 text-sm font-semibold ${dark ? "text-ivory-100" : "text-navy-900"}`}>3. Your details</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" htmlFor={`${id}-name`} error={errors.name} required>
            <Input id={`${id}-name`} name="name" autoComplete="name" value={values.name} onChange={(e) => set("name", e.target.value)} invalid={!!errors.name} maxLength={80} />
          </Field>
          <Field label="Mobile number" htmlFor={`${id}-phone`} error={errors.phone} required>
            <Input id={`${id}-phone`} name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" value={values.phone} onChange={(e) => set("phone", e.target.value)} invalid={!!errors.phone} maxLength={14} />
          </Field>
          <Field label="Email" htmlFor={`${id}-email`} error={errors.email} hint="Optional">
            <Input id={`${id}-email`} name="email" type="email" autoComplete="email" value={values.email} onChange={(e) => set("email", e.target.value)} invalid={!!errors.email} maxLength={120} />
          </Field>
          <Field label="Visitors" htmlFor={`${id}-visitors`} required>
            <Select id={`${id}-visitors`} name="visitors" value={values.visitors} onChange={(e) => set("visitors", e.target.value)}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "person" : "people"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Anything we should know?" htmlFor={`${id}-message`} className="sm:col-span-2">
            <Textarea id={`${id}-message`} name="message" value={values.message} onChange={(e) => set("message", e.target.value)} maxLength={500} rows={2} />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox id={`${id}-consent`} name="consent" checked={values.consent} onChange={(e) => set("consent", e.target.checked)} error={errors.consent} label={<span className={dark ? "text-ivory-100/75" : ""}>I agree to be contacted by {brandName} to confirm my visit.</span>} />
          </div>
        </div>
      </fieldset>

      {status.kind === "error" ? (
        <div className="mt-5">
          <FormStatus tone="error">{status.message}</FormStatus>
        </div>
      ) : null}
      <Button type="submit" size="lg" className="mt-6 w-full sm:w-auto" disabled={busy || loading}>
        <CalendarIcon size={18} /> {busy ? "Booking…" : "Book my private visit"}
      </Button>
    </form>
  );
}
