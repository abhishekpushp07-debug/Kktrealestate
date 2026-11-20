import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AmountInput } from "@/components/common/AmountInput";
import { Plus, X } from "lucide-react";
import api from "@/lib/api";
import { inr } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Combobox } from "./Combobox";
import { LockHint } from "./LockHint";

const TIMING = [
  ["on_booking", "On booking"],
  ["on_possession", "On possession"],
  ["stage", "With stages"],
  ["manual", "Manual"],
].map(([v, l]) => ({ value: v, label: l }));
const toLines = (d) =>
  d.charges.map((c) => ({
    charge_type_id: c.charge_type_id || null,
    name: c.name,
    source: c.source || null,
    amount: c.amount,
    gst_percent: c.gst_percent,
    demand_at: c.demand_at,
  }));

/**
 * PS.3 — booking value breakdown card. Lines come from the server (project heads, parking per
 * slot, maintenance); every line is editable; totals are server-computed.
 */
export function BreakdownCard({
  flatId,
  agreementValue,
  hasPlan,
  canEditAgreement,
  value,
  onChange,
}) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const timer = useRef();
  const fetch_ = useCallback(
    (body) =>
      api
        .post("/bookings/breakdown-preview", body)
        .then((r) => {
          setD(r.data);
          setErr(null);
          onChange({
            agreement_gst_percent: r.data.agreement_gst_percent,
            charges: toLines(r.data),
            total_final_value: r.data.total_final_value,
          });
        })
        .catch((e) => setErr(e.response?.data?.detail || "Could not compute breakdown")),
    [onChange],
  );
  // initial prelist (or re-prelist when the flat changes)
  useEffect(() => {
    if (flatId && agreementValue > 0 && !value?.charges)
      fetch_({ flat_id: flatId, agreement_value: agreementValue, has_plan: hasPlan });
  }, [flatId, agreementValue, hasPlan, value?.charges, fetch_]);
  const recompute = (lines, gstPct) => {
    clearTimeout(timer.current);
    const next = { ...value, charges: lines, agreement_gst_percent: gstPct };
    onChange(next);
    timer.current = setTimeout(
      () =>
        fetch_({
          flat_id: flatId,
          agreement_value: agreementValue,
          agreement_gst_percent: gstPct,
          has_plan: hasPlan,
          charges: lines.map((l) => ({
            ...l,
            amount: Number(l.amount) || 0,
            gst_percent: Number(l.gst_percent) || 0,
          })),
        }),
      350,
    );
  };
  useEffect(() => {
    if (value?.charges && agreementValue > 0)
      recompute(value.charges, value.agreement_gst_percent); /* agreement changed → totals follow */
  }, [agreementValue]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d && !err) return <p className="text-sm text-txt-muted">Computing breakdown…</p>;
  if (err)
    return (
      <p className="text-sm text-brick" data-testid="breakdown-error">
        {err}
      </p>
    );
  const lines = value?.charges || [];
  const gstPct = value?.agreement_gst_percent ?? d.agreement_gst_percent;
  const setLine = (i, patch) =>
    recompute(
      lines.map((l, j) => (j === i ? { ...l, ...patch } : l)),
      gstPct,
    );
  const addHead = (id) => {
    const h = d.heads.find((x) => x.id === id);
    if (h)
      recompute(
        [
          ...lines,
          {
            charge_type_id: h.id,
            name: h.name,
            amount: h.default_value ?? h.default_amount ?? 0,
            gst_percent: h.default_gst_percent ?? 18,
            demand_at: h.default_demand_timing || "on_booking",
          },
        ],
        gstPct,
      );
  };
  const headOpts = d.heads
    .filter((h) => !["AGR_GST"].includes(h.code))
    .map((h) => ({ value: h.id, label: h.name, sub: h.code }));
  return (
    <div className="rounded-xl border border-warm-200 bg-white p-4" data-testid="breakdown-card">
      <div className="mb-3 flex items-center justify-between">
        <p className="label">Value breakdown</p>
        {d.flat?.pricing_status && d.flat.pricing_status !== "ready" && (
          <span
            className="rounded-full bg-amber2-50 px-2 py-0.5 text-[11px] font-semibold text-amber2"
            data-testid="breakdown-flat-pending"
          >
            Flat pricing {d.flat.pricing_status}
          </span>
        )}
      </div>
      <table className="w-full text-sm" data-testid="breakdown-table">
        <thead className="text-left text-[11px] uppercase text-txt-secondary">
          <tr>
            <th className="py-1">Line</th>
            <th className="text-right">Amount ₹</th>
            <th className="w-16 text-right">GST %</th>
            <th className="text-right">GST</th>
            <th className="text-right">Total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr className="border-t" data-testid="breakdown-agreement">
            <td className="py-1.5 font-medium">
              Agreement value
              {!canEditAgreement && (
                <span className="ml-1 text-[10px] text-txt-muted">(locked)</span>
              )}
            </td>
            <td className="text-right tabular">{inr(agreementValue)}</td>
            <td>
              <Input
                type="number"
                min="0"
                max="28"
                step="0.01"
                value={gstPct}
                onChange={(e) => recompute(lines, Number(e.target.value) || 0)}
                className="input !h-8 min-w-[56px] !px-2 text-right"
                data-testid="breakdown-agreement-gst"
              />
            </td>
            <td className="pl-3 text-right tabular">{inr(d.agreement_gst)}</td>
            <td className="pl-3 text-right tabular">{inr(agreementValue + d.agreement_gst)}</td>
            <td />
          </tr>
          {lines.map((l, i) => {
            const lid = l.line_id || l.source || l.charge_type_id || `adhoc-${l.name}-${i}`;
            const dl =
              (d.charges || []).find((c) => c.line_id && c.line_id === l.line_id) || d.charges?.[i];
            return (
              <tr key={lid} className="border-t" data-testid={`breakdown-line-${i}`}>
                <td className="min-w-[180px] py-1.5">
                  <Input
                    value={l.name}
                    onChange={(e) => setLine(i, { name: e.target.value })}
                    className="input !h-8"
                    data-testid={`breakdown-line-name-${i}`}
                  />
                  <Combobox
                    options={TIMING}
                    value={l.demand_at}
                    onChange={(v) => setLine(i, { demand_at: v || "on_booking" })}
                    allowAdd={false}
                    clearable={false}
                    className="mt-1 !h-7 text-xs"
                    testId={`breakdown-line-timing-${i}`}
                  />
                  {l.source && (
                    <span className="text-[10px] text-txt-muted">
                      {l.source.startsWith("parking")
                        ? "attached parking slot"
                        : "from project setup"}
                    </span>
                  )}
                </td>
                <td className="min-w-[130px]">
                  <AmountInput
                    value={l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    className="input !h-8 text-right"
                    data-testid={`breakdown-line-amount-${i}`}
                  />
                </td>
                <td>
                  <Input
                    type="number"
                    min="0"
                    max="28"
                    value={l.gst_percent}
                    onChange={(e) => setLine(i, { gst_percent: e.target.value })}
                    className="input !h-8 min-w-[56px] !px-2 text-right"
                    data-testid={`breakdown-line-gst-${i}`}
                  />
                </td>
                <td className="pl-3 text-right tabular">{inr(dl?.gst ?? 0)}</td>
                <td className="pl-3 text-right tabular">{inr(dl?.total ?? 0)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() =>
                      recompute(
                        lines.filter((_, j) => j !== i),
                        gstPct,
                      )
                    }
                    className="text-txt-muted hover:text-brick"
                    aria-label="Remove line"
                    data-testid={`breakdown-line-remove-${i}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <Plus className="h-3.5 w-3.5 text-txt-muted" />
        <Combobox
          options={headOpts}
          value={null}
          onChange={(v) => v && addHead(v)}
          placeholder="Add charge head…"
          allowAdd={false}
          className="!h-8 min-w-[220px] text-xs"
          testId="breakdown-add-head"
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-warm-100 pt-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="label-xs">Additional charges</dt>
          <dd className="tabular" data-testid="breakdown-additional">
            {inr(d.additional_charges_total)}
          </dd>
        </div>
        <div>
          <dt className="label-xs">GST total</dt>
          <dd className="tabular" data-testid="breakdown-gst-total">
            {inr(d.gst_total)}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="label-xs">Total final value</dt>
          <dd className="font-display text-2xl text-ink-950" data-testid="breakdown-total-final">
            {inr(d.total_final_value)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Read-only price summary (Booking detail, Customer 360). */
export function PriceSummary({ booking, compact }) {
  const p = booking?.pricing;
  if (!p) return null;
  return (
    <div className={compact ? "text-sm" : "card p-5 text-sm"} data-testid="price-summary">
      {!compact && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="e-caps-blue">Price summary</h3>
          <LockHint
            reason="Locked at booking"
            to={`/bookings/${booking.id}?revise=1`}
            linkLabel="Revise agreement"
            testId="price-summary-lock"
          />
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
        <dt className="text-txt-secondary">Agreement value</dt>
        <dd className="text-right tabular">{inr(p.agreement_value)}</dd>
        <dt className="text-txt-secondary">GST on agreement ({p.agreement_gst_percent ?? 0}%)</dt>
        <dd className="text-right tabular">{inr(p.agreement_gst)}</dd>
        {(p.charges || []).map((c) => (
          <Fragment key={c.line_id}>
            <dt className="text-txt-secondary">
              {c.name}
              {c.gst_percent ? ` (+${c.gst_percent}% GST)` : ""}
            </dt>
            <dd className="text-right tabular">{inr(c.total)}</dd>
          </Fragment>
        ))}
        <dt className="border-t border-warm-100 pt-1 font-semibold text-ink-950">
          Total final value
        </dt>
        <dd
          className="border-t border-warm-100 pt-1 text-right font-semibold tabular text-ink-950"
          data-testid="price-summary-total"
        >
          {inr(p.total_final_value)}
        </dd>
      </dl>
    </div>
  );
}
