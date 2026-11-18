import { Card, Money } from "@/components/v2";
import { BalanceText } from "@/components/booking/BookingParts";

function Fig({ label, children, testId }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="text-sm text-txt-secondary">{label}</p>
      <p className="tnum mt-1 text-2xl text-ink-950">{children}</p>
    </div>
  );
}

/** Zero in words: "no cash share", "other charges ₹6.4 L unpaid", else "Account ₹1 Cr of ₹1 Cr". */
function SplitPart({ label, paid, billed }) {
  if (!billed && !paid)
    return (
      <>
        no {label.toLowerCase()} {label === "Other charges" ? "billed" : "share"}
      </>
    );
  if (!paid)
    return (
      <>
        {label.toLowerCase()} <Money value={billed} short /> unpaid
      </>
    );
  return (
    <>
      {label} <Money value={paid} short /> of <Money value={billed} short />
    </>
  );
}

/** REQ-163: exactly four figures — Agreement, Billed, Received, Balance — plus one Cash · Account · Other split line. */
export function MoneyStrip({ agreement, s, testId = "money-strip" }) {
  return (
    <Card testId={testId}>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Fig label="Agreement" testId={`${testId}-agreement`}>
          <Money value={agreement} short />
        </Fig>
        <Fig label="Billed" testId={`${testId}-billed`}>
          <Money value={s.total_bill_raised} short />
        </Fig>
        <Fig label="Received" testId={`${testId}-received`}>
          <Money value={s.total_received} short />
        </Fig>
        <Fig label="Balance" testId={`${testId}-balance`}>
          <BalanceText s={s} testId="booking-overview-balance" />
        </Fig>
      </div>
      <p
        className="mt-4 border-t border-warm-200 pt-3 text-sm text-txt-secondary"
        data-testid={`${testId}-split`}
      >
        {[
          ["Cash", "cash", s.cash_paid, s.cash_bill_raised],
          ["Account", "account", s.account_paid, s.account_bill_raised],
          ["Other charges", "other", s.other_charges_paid, s.other_charges_demanded],
        ].map(([label, k, paid, billed], i) => (
          <span key={k}>
            {i > 0 && " · "}
            <SplitPart label={label} paid={paid} billed={billed} />
          </span>
        ))}
        {s.pending_cheques > 0 && (
          <>
            {" "}
            · <Money value={s.pending_cheques} short /> cheques in hand
          </>
        )}
      </p>
    </Card>
  );
}
