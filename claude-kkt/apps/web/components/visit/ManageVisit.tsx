"use client";

import { useState } from "react";

import { useSiteConfig } from "@/components/SiteConfigProvider";
import { Button } from "@/components/ui/Button";
import { FormStatus } from "@/components/ui/Field";
import { CalendarIcon, ClockIcon, DownloadIcon, ExternalLinkIcon, MapPinIcon } from "@/components/ui/icons";
import { absoluteApiUrl, friendlyErrorMessage, publicClient, visitIcsUrl } from "@/lib/api";
import { formatDate, formatTimeRange } from "@/lib/format";
import type { SiteVisitManage } from "@/lib/types";

const STATUS_LABELS: Record<SiteVisitManage["status"], string> = {
  CONFIRMED: "Confirmed",
  RESCHEDULED: "Rescheduled",
  COMPLETED: "Completed",
  NO_SHOW: "Missed",
  CANCELLED: "Cancelled",
};

export function ManageVisit({ visit: initial, token }: { visit: SiteVisitManage; token: string }) {
  const { apiUrl } = useSiteConfig();
  const [visit, setVisit] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upcoming = visit.status === "CONFIRMED" || visit.status === "RESCHEDULED";
  const canCancel = upcoming && visit.can_cancel !== false;
  const ics = visit.ics_url ? absoluteApiUrl(apiUrl, visit.ics_url) : visitIcsUrl(apiUrl, token);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const updated = await publicClient(apiUrl).cancelSiteVisit(token);
      setVisit(updated && typeof updated === "object" && "status" in updated ? updated : { ...visit, status: "CANCELLED" });
      setConfirming(false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-line bg-white p-6 shadow-card sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-gold-600">Site visit</p>
          <h2 className="mt-2 font-display text-display-sm text-navy-900">{visit.visit_number}</h2>
          <p className="mt-1 text-ink-muted">{visit.project_name}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
            upcoming ? "bg-success/10 text-success" : visit.status === "CANCELLED" ? "bg-danger/10 text-danger" : "bg-navy-50 text-navy-900"
          }`}
          aria-live="polite"
        >
          {STATUS_LABELS[visit.status] ?? visit.status}
        </span>
      </div>

      <dl className="mt-8 grid gap-5 sm:grid-cols-2">
        <div className="flex gap-3">
          <CalendarIcon className="mt-0.5 shrink-0 text-gold-600" />
          <div>
            <dt className="text-xs uppercase tracking-widest text-ink-soft">Date</dt>
            <dd className="font-semibold text-navy-900">{formatDate(visit.date, "long")}</dd>
          </div>
        </div>
        <div className="flex gap-3">
          <ClockIcon className="mt-0.5 shrink-0 text-gold-600" />
          <div>
            <dt className="text-xs uppercase tracking-widest text-ink-soft">Time (IST)</dt>
            <dd className="font-semibold text-navy-900">{formatTimeRange(visit.start, visit.end)}</dd>
          </div>
        </div>
        {visit.visitors ? (
          <div>
            <dt className="text-xs uppercase tracking-widest text-ink-soft">Visitors</dt>
            <dd className="font-semibold text-navy-900">{visit.visitors}</dd>
          </div>
        ) : null}
        {visit.name ? (
          <div>
            <dt className="text-xs uppercase tracking-widest text-ink-soft">Booked for</dt>
            <dd className="font-semibold text-navy-900">{visit.name}</dd>
          </div>
        ) : null}
        {visit.address ? (
          <div className="flex gap-3 sm:col-span-2">
            <MapPinIcon className="mt-0.5 shrink-0 text-gold-600" />
            <div>
              <dt className="text-xs uppercase tracking-widest text-ink-soft">Site office</dt>
              <dd className="whitespace-pre-line text-navy-900">{visit.address}</dd>
              {visit.maps_link ? (
                <a href={visit.maps_link} className="mt-1 inline-flex min-h-12 items-center gap-1 text-gold-700 underline-offset-4 hover:underline" rel="noopener noreferrer" target="_blank">
                  Open in Maps <ExternalLinkIcon size={14} />
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </dl>
      {visit.instructions ? <p className="mt-6 rounded-xl bg-ivory-100 p-4 text-sm leading-6 text-ink-muted">{visit.instructions}</p> : null}

      {upcoming ? (
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button href={ics} external rel="noopener">
            <DownloadIcon size={18} /> Add to calendar (.ics)
          </Button>
          {canCancel && !confirming ? (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Cancel this visit
            </Button>
          ) : null}
        </div>
      ) : visit.status === "CANCELLED" ? (
        <p className="mt-8 text-ink-muted">This visit has been cancelled. You are welcome to book another time whenever it suits you.</p>
      ) : null}

      {confirming ? (
        <div className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-5" role="alertdialog" aria-labelledby="cancel-title" aria-describedby="cancel-desc">
          <p id="cancel-title" className="font-semibold text-navy-900">
            Cancel visit {visit.visit_number}?
          </p>
          <p id="cancel-desc" className="mt-1 text-sm text-ink-muted">
            Your seat will be released. This cannot be undone, but you can book a new visit any time.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button variant="secondary" onClick={cancel} disabled={busy} data-autofocus>
              {busy ? "Cancelling…" : "Yes, cancel my visit"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep my visit
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="mt-4">
          <FormStatus tone="error">{error}</FormStatus>
        </div>
      ) : null}
    </div>
  );
}
