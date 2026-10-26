import {
  Banknote,
  Building2,
  CalendarClock,
  Landmark,
  ParkingSquare,
  Route,
  Sigma,
  UserRound,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  PARKING_TYPE_LABELS,
  PLAN_ACCEPTANCE_MODE_LABELS,
  PLAN_TYPE_LABELS,
  TRIGGER_TYPE_LABELS,
  type BookingDetailResponse,
  type BucketSummary,
} from "@kkt/contracts";
import { Badge, Card, CardContent, CardHeader, CardTitle, KeyValueList } from "@/components/ui";
import {
  formatDate,
  formatDateTime,
  formatINR,
  formatINRShort,
  formatPercent,
  formatPhone,
  formatSqft,
} from "@/lib/format";
import { BucketCard, DueAmount } from "../components";

function totalBucket(booking: BookingDetailResponse): BucketSummary {
  const { cash, account } = booking.summary;
  return {
    agreed_paise: booking.agreement_value_paise,
    order_raised_paise: booking.summary.total_order_raised_paise,
    paid_paise: booking.summary.total_paid_paise,
    due_paise: booking.summary.total_due_paise,
    advance_paise: cash.advance_paise + account.advance_paise,
    pending_paise: booking.summary.pending_cheques_paise,
  };
}

function otherBucket(booking: BookingDetailResponse): BucketSummary {
  const s = booking.summary;
  return {
    agreed_paise: s.other_charges_total_paise,
    order_raised_paise: s.other_charges_demanded_paise,
    paid_paise: s.other_charges_paid_paise,
    due_paise: s.other_charges_due_paise,
    advance_paise: Math.max(0, -s.other_charges_due_paise),
    pending_paise: 0,
  };
}

/** Agreement value − list price recorded at booking (null when the list price is unknown on old bookings). */
export function bookingDeviation(
  booking: Pick<BookingDetailResponse, "agreement_value_paise" | "list_price_paise">,
): number | null {
  return typeof booking.list_price_paise === "number" ? booking.agreement_value_paise - booking.list_price_paise : null;
}

/** The price deviation approved at booking (agreement.edit holder + reason), shown under the flat card. */
function PriceDeviation({ booking }: { booking: BookingDetailResponse }) {
  const deviation = bookingDeviation(booking);
  if (!deviation) return null;
  return (
    <div
      className="mt-2 rounded-md border border-gold-border bg-gold-light px-3 py-2 text-xs"
      data-testid="booking-price-deviation"
    >
      <p className="font-semibold text-navy-950">
        {deviation < 0 ? "Discount" : "Premium"} of <span className="money">{formatINR(Math.abs(deviation))}</span> on
        the list price
      </p>
      <p className="text-ink-muted">
        {booking.price_deviation_reason
          ? `Reason: ${booking.price_deviation_reason}`
          : "No reason recorded (booked before deviations needed one)."}
      </p>
    </div>
  );
}

/** Overview: per-bucket cards, next installment, flat / plan / customer / parking cards. */
export function OverviewTab({ booking }: { booking: BookingDetailResponse }) {
  const snapshot = booking.flat_snapshot;
  const plan = booking.plan_snapshot;
  const next = booking.summary.next_installment;
  return (
    <div className="space-y-4" data-testid="overview-tab">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BucketCard bucket="CASH" summary={booking.summary.cash} icon={Banknote} />
        <BucketCard bucket="ACCOUNT" summary={booking.summary.account} icon={Landmark} />
        <BucketCard bucket="TOTAL" title="Flat value total" summary={totalBucket(booking)} icon={Sigma} />
        <BucketCard bucket="OTHER" summary={otherBucket(booking)} icon={Wallet} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-gold-text" aria-hidden="true" /> Where we are
            </CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValueList
              layout="inline"
              items={[
                {
                  label: "Raised so far",
                  value: <span className="money">{formatPercent(booking.summary.raised_percent)} of agreement</span>,
                },
                { label: "Total due", value: <DueAmount paise={booking.summary.total_due_paise} /> },
                {
                  label: "Cheques in hand",
                  value:
                    booking.summary.pending_cheques_paise > 0 ? (
                      <span className="money text-warning-fg">{formatINR(booking.summary.pending_cheques_paise)}</span>
                    ) : (
                      "None"
                    ),
                },
                {
                  label: "Last payment",
                  value: booking.summary.last_payment_at ? formatDateTime(booking.summary.last_payment_at) : "—",
                },
                {
                  label: "Next installment",
                  value: next ? (
                    <span className="block text-right leading-tight">
                      <span className="block font-medium">
                        {next.seq}. {next.name}
                      </span>
                      <span className="money block text-xs text-ink-muted">
                        {formatINRShort(next.cash_paise + next.account_paise)} · {next.trigger_label}
                        {next.expected_date ? ` · ${formatDate(next.expected_date)}` : ""}
                      </span>
                    </span>
                  ) : (
                    "All raised"
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-gold-text" aria-hidden="true" /> Flat (snapshot at booking)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValueList
              layout="inline"
              items={[
                {
                  label: "Project · Tower",
                  value: (
                    <Link to={`/blocks/${booking.block_id}`} className="text-navy-800 hover:underline">
                      {booking.project_name} · {booking.block_name}
                    </Link>
                  ),
                },
                {
                  label: "Flat",
                  value: (
                    <Link
                      to={`/flats/${booking.flat_id}`}
                      className="money font-semibold text-navy-800 hover:underline"
                    >
                      {snapshot.flat_number}
                    </Link>
                  ),
                },
                { label: "Type · Floor", value: `${snapshot.flat_type_name} · ${snapshot.floor_label}` },
                {
                  label: "Carpet / built-up / super",
                  value: (
                    <span className="money">
                      {snapshot.carpet_sqft ?? "—"} / {snapshot.builtup_sqft ?? "—"} /{" "}
                      {formatSqft(snapshot.super_builtup_sqft)}
                    </span>
                  ),
                },
                { label: "Facing", value: snapshot.facing ?? "—" },
                {
                  label: "List price at booking",
                  value: formatINR(booking.list_price_paise ?? snapshot.price_paise),
                  numeric: true,
                },
                { label: "Agreement value", value: formatINR(booking.agreement_value_paise), numeric: true },
                {
                  label: "Rate / sq ft",
                  value: booking.rate_per_sqft_paise !== null ? formatINR(booking.rate_per_sqft_paise) : "—",
                  numeric: true,
                },
              ]}
            />
            <PriceDeviation booking={booking} />
            {snapshot.price_breakup.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-medium text-navy-800">
                  Price breakup ({snapshot.price_breakup.length} lines)
                </summary>
                <dl className="mt-1 space-y-0.5">
                  {snapshot.price_breakup.map((line) => (
                    <div key={line.label} className="flex justify-between gap-2">
                      <dt className="text-ink-muted">{line.label}</dt>
                      <dd className="money">{formatINR(line.amount_paise)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Route className="size-4 text-gold-text" aria-hidden="true" /> Payment plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <KeyValueList
              layout="inline"
              items={[
                {
                  label: "Plan",
                  value: (
                    <span>
                      {plan.name} <span className="money text-2xs text-ink-subtle">{plan.code}</span>
                    </span>
                  ),
                },
                { label: "Type", value: PLAN_TYPE_LABELS[plan.plan_type] },
                { label: "Installments", value: String(plan.installments.length), numeric: true },
                { label: "Grace days", value: String(plan.grace_days), numeric: true },
                {
                  label: "Accepted",
                  value: booking.plan_acceptance_mode
                    ? `${PLAN_ACCEPTANCE_MODE_LABELS[booking.plan_acceptance_mode]}${booking.plan_accepted_on ? ` · ${formatDate(booking.plan_accepted_on)}` : ""}`
                    : "—",
                },
                {
                  label: "Revisions",
                  value: `${booking.agreement_revisions.length} agreement · ${booking.plan_revisions.length} plan`,
                },
              ]}
            />
            <ol className="mt-2 space-y-0.5 text-xs">
              {plan.installments.slice(0, 6).map((installment) => (
                <li key={installment.seq} className="flex justify-between gap-2 text-ink-muted">
                  <span className="truncate">
                    {installment.seq}. {installment.name} · {TRIGGER_TYPE_LABELS[installment.trigger_type]}
                  </span>
                  <span className="money shrink-0 font-medium text-ink">{formatPercent(installment.percent)}</span>
                </li>
              ))}
              {plan.installments.length > 6 && (
                <li className="text-ink-subtle">… {plan.installments.length - 6} more on the Schedule tab</li>
              )}
            </ol>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4 text-gold-text" aria-hidden="true" /> Applicants
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-navy-100 bg-navy-50 px-3 py-2">
              <div className="min-w-0">
                <Link
                  to={`/customers/${booking.customer_id}`}
                  className="text-sm font-semibold text-navy-900 hover:underline"
                >
                  {booking.customer_name}
                </Link>
                <p className="money text-xs text-ink-muted">
                  {booking.customer_code} · {formatPhone(booking.customer_phone)}
                </p>
              </div>
              <Badge variant="navy">Primary</Badge>
            </div>
            {booking.co_applicants.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {booking.co_applicants.map((person) => (
                  <li
                    key={person.customer_id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <Link
                      to={`/customers/${person.customer_id}`}
                      className="truncate font-medium text-navy-800 hover:underline"
                    >
                      {person.full_name}
                    </Link>
                    <span className="money text-xs text-ink-muted">{formatPhone(person.phone)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-subtle">No co-applicants.</p>
            )}
            <KeyValueList
              columns={3}
              items={[
                { label: "Sales person", value: booking.sales_user_name ?? "—" },
                { label: "Broker", value: booking.broker_name ?? "—" },
                {
                  label: "Lead",
                  value: booking.lead_id ? (
                    <Link to={`/leads/${booking.lead_id}`} className="text-navy-800 hover:underline">
                      Open lead
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                { label: "Remarks", value: booking.remarks ?? "—", full: true },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ParkingSquare className="size-4 text-gold-text" aria-hidden="true" /> Parking
            </CardTitle>
          </CardHeader>
          <CardContent>
            {booking.parking_slots.length === 0 ? (
              <p className="text-xs text-ink-subtle">No parking allotted.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {booking.parking_slots.map((slot) => (
                  <li key={slot.id} className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm">
                    <span className="money font-semibold text-navy-950">{slot.number}</span>
                    <span className="block text-2xs text-ink-subtle">{PARKING_TYPE_LABELS[slot.slot_type]}</span>
                  </li>
                ))}
              </ul>
            )}
            {booking.cancellation && (
              <div className="mt-3 rounded-md border border-danger/30 bg-danger-bg p-3 text-xs text-danger-fg">
                <p className="font-semibold">
                  Cancelled {formatDateTime(booking.cancellation.at)}
                  {booking.cancellation.by_name ? ` by ${booking.cancellation.by_name}` : ""}
                </p>
                <p className="mt-0.5">{booking.cancellation.reason}</p>
                <p className="money mt-1">
                  Deduction {formatINR(booking.cancellation.deduction_paise)} · Refund{" "}
                  {formatINR(booking.cancellation.refund_paise)}
                </p>
              </div>
            )}
            {booking.completed_at && (
              <div className="mt-3 rounded-md border border-navy-200 bg-navy-50 p-3 text-xs text-navy-950">
                <p className="font-semibold">
                  Completed {formatDateTime(booking.completed_at)}
                  {booking.completed_by_name ? ` by ${booking.completed_by_name}` : ""}
                </p>
                {booking.completion_notes && <p className="mt-0.5 text-ink-muted">{booking.completion_notes}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
