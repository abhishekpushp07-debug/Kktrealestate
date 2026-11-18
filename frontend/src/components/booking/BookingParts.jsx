import { Link } from "react-router-dom";
import { inr } from "@/lib/format";
import { IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Money } from "@/components/v2";
import { SendReminderButton } from "@/components/common/SendReminderButton";
import { fmtDate, inrShort } from "@/lib/format";
import { cn } from "@/lib/utils";

// One Balance everywhere on the booking (header, Overview, Ledger foot): outstanding − advance
export function BalanceText({ s, testId }) {
  const net = (s.outstanding || 0) - (s.advance || 0);
  const label = net > 0 ? "Due" : net < 0 ? "Advance" : "Settled";
  return (
    <span
      className={cn("whitespace-nowrap font-semibold", net > 0 ? "text-brick" : "text-sage")}
      data-testid={testId}
    >
      {label} {net !== 0 && <Money value={Math.abs(net)} short />}
    </span>
  );
}

/** REQ-113/117: Record payment while Active; a cancelled booking only offers "Pay refund" when one is due. */
export function MainAction({ b, rules, onPay, onRefund }) {
  const r = rules?.actions || {};
  if (b.status === "Active") {
    const why = rules ? r.record_payment : null;
    if (why)
      // a visible reason, not only a hover title (touch users)
      return (
        <span className="text-xs text-txt-secondary" data-testid="post-payment-reason">
          Record payment · {why}
        </span>
      );
    return (
      <Button
        onClick={onPay}
        why={why}
        disabled={Boolean(why)}
        title={why || ""}
        className="btn btn-primary"
        data-testid="post-payment-btn"
      >
        <IndianRupee className="h-4 w-4" strokeWidth={1.75} />
        Record payment
      </Button>
    );
  }
  if (rules && !r.pay_refund)
    return (
      <Button onClick={onRefund} className="btn btn-primary" data-testid="pay-refund-main-btn">
        Pay refund
      </Button>
    );
  return null;
}

function nextDue(b) {
  return (b.demands || [])
    .filter(
      (d) =>
        !d.voided &&
        !["Paid", "Cancelled"].includes(d.status) &&
        (d.total_demand || 0) > (d.paid || 0),
    )
    .sort((x, y) => String(x.due_date).localeCompare(String(y.due_date)))[0];
}

// demanded-but-unpaid other charges (club, parking …) are bills too
const ocDue = (b) => (b.other_charges || []).filter((l) => (l.demanded || 0) - (l.paid || 0) > 0.5);

export function OverviewTop({ b, s }) {
  const live = b.status !== "Cancelled";
  const d = live ? nextDue(b) : null;
  const oc = live ? ocDue(b) : [];
  const ocAmt = oc.reduce((a, l) => a + l.demanded - l.paid, 0);
  const disc = b.discount;
  const given = disc?.status === "recorded" ? disc.list - b.agreement_value : null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-txt-secondary" data-testid="booking-discount-line">
        {given == null
          ? "Discount not recorded"
          : `List ${inr(disc.list)} · ${given >= 0 ? "discount" : "above list"} ${inr(Math.abs(given))} (${((Math.abs(given) / disc.list) * 100).toFixed(2)}%)${
              [
                disc.reason,
                ...(b.discount_events || []).map((e) => `${e.kind}: ${e.reason}`),
              ].filter(Boolean).length
                ? ` · ${[disc.reason, ...(b.discount_events || []).map((e) => `${e.kind}: ${e.reason}`)].filter(Boolean).join("; ")}`
                : ""
            }`}
      </p>
      {b.status === "Cancelled" && (
        <div
          className="rounded-2xl border border-brick/30 bg-brick-50 px-5 py-3 text-sm text-brick"
          data-testid="booking-void-banner"
        >
          <span className="font-semibold tracking-wide">VOID</span> · cancelled{" "}
          {fmtDate(b.cancellation?.at)} — figures below are kept for the record only
        </div>
      )}
      <div className="grid gap-4">
        {live && (
          <Card testId="booking-next-due-card">
            <p className="text-xs text-txt-muted">Next bill due</p>
            {d ? (
              <>
                <p className="mt-1 text-xl font-semibold text-ink-950">
                  <Money value={(d.total_demand || 0) - (d.paid || 0)} short /> by{" "}
                  {fmtDate(d.due_date)}
                </p>
                <p
                  className="mt-1 text-xs text-txt-secondary"
                  data-testid="booking-next-due-detail"
                >
                  {d.demand_number} · {d.milestone_name}
                  {d.paid_detail ? ` · ${d.paid_detail}` : ""}
                </p>
              </>
            ) : oc.length ? (
              <>
                <p className="mt-1 text-xl font-semibold text-ink-950">
                  <Money value={ocAmt} short /> other charges
                </p>
                <p
                  className="mt-1 text-xs text-txt-secondary"
                  data-testid="booking-next-due-detail"
                >
                  {oc
                    .map((l) =>
                      l.paid > 0
                        ? `${l.name} · part-paid ${inrShort(l.paid)} of ${inrShort(l.demanded)}`
                        : `${l.name} · unpaid ${inrShort(l.demanded)}`,
                    )
                    .join(" · ")}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-txt-secondary" data-testid="booking-next-due-none">
                No bill is waiting — the next one is raised when its stage is reached
              </p>
            )}
            {d && oc.length > 0 && (
              <p className="mt-1 text-xs text-brick" data-testid="booking-next-due-charges">
                Also unpaid: <Money value={ocAmt} short /> other charges (
                {oc.map((l) => l.name).join(", ")})
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

export function LedgerLaw({ s }) {
  return (
    <p className="tnum text-right text-sm text-txt-secondary" data-testid="ledger-law">
      Σ Billed <Money value={s.total_udhar} /> − Σ Received <Money value={s.total_jama} /> ={" "}
      <span className="font-semibold text-ink-950">
        <Money value={(s.total_udhar || 0) - (s.total_jama || 0)} />
      </span>{" "}
      = outstanding <Money value={s.outstanding} /> − advance <Money value={s.advance} /> (
      <BalanceText s={s} />)
    </p>
  );
}

export function BillsToolbar({ b, can }) {
  return (
    <div className="flex flex-wrap justify-end gap-2" data-testid="booking-bills-toolbar">
      {can("demands.register.create") && b.status === "Active" && (
        <Link
          to={`/demands?new=manual&project_id=${b.project_id}&block_id=${b.block_id}&booking_id=${b.id}`}
          className="btn btn-secondary btn-sm"
          data-testid="booking-raise-demand"
        >
          Raise manual bill
        </Link>
      )}
      {can("messaging.message.send") && b.status === "Active" && (
        <SendReminderButton
          bookingId={b.id}
          testId="ca-send-reminder-btn"
          className="btn btn-secondary btn-sm"
        />
      )}
    </div>
  );
}
