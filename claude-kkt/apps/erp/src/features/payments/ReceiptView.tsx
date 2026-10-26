import { PAYMENT_AGAINST_LABELS, PAYMENT_BUCKET_LABELS, type ReceiptData } from "@kkt/contracts";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Letterhead, PrintFacts, SignatureBlock } from "./print";

export interface ReceiptViewProps {
  receipt: ReceiptData;
  className?: string;
}

/** Branded A4 receipt: letterhead, received-from box, amount in words, instrument, CANCELLED watermark. */
export function ReceiptView({ receipt, className }: ReceiptViewProps) {
  const against = receipt.against === "FLAT_VALUE" ? `${PAYMENT_AGAINST_LABELS.FLAT_VALUE}${receipt.bucket ? ` — ${PAYMENT_BUCKET_LABELS[receipt.bucket]} bucket` : ""}` : `${PAYMENT_AGAINST_LABELS.OTHER_CHARGE}${receipt.other_charge_name ? ` — ${receipt.other_charge_name}` : ""}`;
  return (
    <article className={cn("relative text-ink", className)} data-testid="receipt-view" data-status={receipt.status}>
      {receipt.is_cancelled && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rotate-[-24deg] rounded-lg border-8 border-danger/60 px-10 py-4 font-display text-6xl font-extrabold uppercase tracking-[0.3em] text-danger/80">Cancelled</span>
        </div>
      )}
      <Letterhead
        company={receipt.company}
        title="Receipt"
        subtitle={
          <>
            <div>
              No. <span className="money font-semibold text-navy-950">{receipt.receipt_number}</span>
            </div>
            <div>
              Date <span className="money font-semibold text-navy-950">{formatDate(receipt.payment_date)}</span>
            </div>
          </>
        }
      />

      <section className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3 text-sm leading-6">
          <p>
            Received with thanks from <span className="font-semibold text-navy-950">{receipt.customer_name}</span>
            {receipt.customer_address && <span className="block text-xs text-ink-muted">{receipt.customer_address}</span>}
          </p>
          <p>
            towards <span className="font-semibold">{against}</span> for booking <span className="money font-semibold text-navy-950">{receipt.booking_number}</span>, flat{" "}
            <span className="money font-semibold text-navy-950">{receipt.flat_number}</span>, {receipt.block_name}, {receipt.project_name}.
          </p>
          <p>
            by <span className="font-semibold">{receipt.mode_name}</span>
            {receipt.instrument && (
              <>
                {" "}
                — No. <span className="money font-semibold">{receipt.instrument.number}</span>
                {receipt.instrument.date && <> dated {formatDate(receipt.instrument.date)}</>}
                {receipt.instrument.bank_name && <>, drawn on {receipt.instrument.bank_name}</>}
              </>
            )}
            {receipt.bank_account_label && <span className="block text-xs text-ink-muted">Credited to {receipt.bank_account_label}</span>}
          </p>
        </div>
        <div className="flex h-fit min-w-[12rem] flex-col items-end justify-center rounded-lg border-2 border-navy-950 bg-navy-50 px-5 py-3 text-right">
          <span className="label-caps">Amount</span>
          <span className="money font-display text-3xl font-extrabold text-navy-950">{formatINR(receipt.amount_paise, { decimals: "always" })}</span>
        </div>
      </section>

      <p className="mt-4 rounded-md border border-gold-border bg-gold-light px-3 py-2 text-sm font-medium text-gold-text">{receipt.amount_words}</p>

      {receipt.subject_to_realisation && !receipt.is_cancelled && (
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-warning-fg" data-testid="receipt-subject-to-realisation">
          Subject to realisation of the instrument
        </p>
      )}
      {receipt.is_cancelled && (
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-danger-fg" data-testid="receipt-cancelled-note">
          This receipt has been cancelled by a reversal and is not valid.
        </p>
      )}

      <section className="mt-6">
        <PrintFacts
          items={[
            { label: "Status", value: receipt.status.charAt(0) + receipt.status.slice(1).toLowerCase() },
            { label: "Received by", value: receipt.received_by_name ?? "—" },
            { label: "Remarks", value: receipt.remarks ?? "—" },
            { label: "Payment id", value: <span className="font-mono text-2xs">{receipt.payment_id}</span> },
          ]}
        />
      </section>

      <SignatureBlock name={receipt.company.signatory_name} title={receipt.company.signatory_title} forCompany={receipt.company.legal_name ?? receipt.company.name} />
    </article>
  );
}
