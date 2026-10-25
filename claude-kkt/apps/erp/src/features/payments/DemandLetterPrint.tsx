import { useMemo } from "react";
import { useParams } from "react-router-dom";
import type { BankAccountRow, DemandLetterData, DemandRow } from "@kkt/contracts";
import { isApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { amountInWords, formatDate, formatINR, formatPercent } from "@/lib/format";
import { useBookingDemands, useBookingDetail } from "@/features/bookings/api";
import { DueAmount } from "@/features/bookings/components";
import { useBankAccounts, useDemandLetter } from "./api";
import { Letterhead, PrintFacts, SignatureBlock } from "./print";
import { PrintFrame } from "./print";

/** Builds the letter from the booking + demand when the API has no JSON letter endpoint (only the PDF). */
function letterFromBooking(demand: DemandRow, booking: { customer_name: string; summary: { cash: { due_paise: number }; account: { due_paise: number } } }, bank: BankAccountRow | null): DemandLetterData {
  return {
    demand_number: demand.demand_number,
    demand_date: demand.demand_date,
    due_date: demand.due_date,
    customer_name: booking.customer_name,
    customer_address: null,
    booking_number: demand.booking_number,
    project_name: demand.project_name,
    block_name: demand.block_name,
    flat_number: demand.flat_number,
    installment_name: demand.installment_name,
    trigger_label: demand.trigger_label,
    percent: demand.percent,
    cash_demand_paise: demand.cash_demand_paise,
    account_demand_paise: demand.account_demand_paise,
    total_demand_paise: demand.total_demand_paise,
    total_words: amountInWords(demand.total_demand_paise),
    cash_due_paise: booking.summary.cash.due_paise,
    account_due_paise: booking.summary.account.due_paise,
    bank: bank ? { bank_name: bank.bank_name, branch: bank.branch, account_name: bank.account_name, account_number: bank.account_number_masked, ifsc: bank.ifsc } : null,
  };
}

/** `/print/demand/:bookingId/:demandId` — demand letter with both buckets, due date and bank details. */
export default function DemandLetterPrint() {
  const { bookingId, demandId } = useParams<{ bookingId: string; demandId: string }>();
  const { company: authCompany } = useAuth();
  const letter = useDemandLetter(bookingId, demandId);
  const needsFallback = letter.isError && isApiClientError(letter.error) && (letter.error.status === 404 || letter.error.status === 405);
  const booking = useBookingDetail(needsFallback ? bookingId : null);
  const demands = useBookingDemands(needsFallback ? bookingId : null);
  const banks = useBankAccounts(needsFallback);

  const data = useMemo<DemandLetterData | null>(() => {
    if (letter.data) return letter.data;
    if (!needsFallback || !booking.data || !demands.data) return null;
    const demand = demands.data.find((row) => row.id === demandId);
    if (!demand) return null;
    const bank = (banks.data ?? []).find((row) => row.is_default) ?? banks.data?.[0] ?? null;
    return letterFromBooking(demand, booking.data, bank);
  }, [letter.data, needsFallback, booking.data, demands.data, demandId, banks.data]);

  const loading = letter.isPending || (needsFallback && (booking.isPending || demands.isPending));
  const error = needsFallback ? (booking.error ?? demands.error ?? (demands.data && !data ? new Error("Demand not found on this booking") : null)) : letter.error;
  const title = data ? `Demand letter ${data.demand_number}` : "Demand letter";
  const settings = authCompany?.settings ?? {};
  const setting = (key: string): string | null => (typeof settings[key] === "string" && settings[key] !== "" ? (settings[key] as string) : null);
  const company = {
    name: authCompany?.name ?? "KKT",
    legal_name: setting("legal_name"),
    address: setting("address_text") ?? setting("address"),
    phone: setting("phone"),
    email: setting("email"),
    gstin: setting("gstin"),
  };

  return (
    <PrintFrame
      title={title}
      loading={loading}
      error={loading ? undefined : error}
      onRetry={() => void letter.refetch()}
      pdfPath={bookingId && demandId ? `/bookings/${bookingId}/demands/${demandId}/letter.pdf` : undefined}
      pdfFileName={`${title.replace(/[\\/]/g, "-")}.pdf`}
      backTo={bookingId ? `/bookings/${bookingId}?tab=demands` : "/demands"}
      backLabel="Booking"
      autoPrintReady={Boolean(data)}
    >
      {data && (
        <article className="text-ink" data-testid="demand-letter">
          <Letterhead
            company={company}
            title="Demand letter"
            subtitle={
              <>
                <div>
                  No. <span className="money font-semibold text-navy-950">{data.demand_number}</span>
                </div>
                <div>
                  Date <span className="money font-semibold text-navy-950">{formatDate(data.demand_date)}</span>
                </div>
              </>
            }
          />
          <section className="mt-6 space-y-1 text-sm leading-6">
            <p>To,</p>
            <p className="font-semibold text-navy-950">{data.customer_name}</p>
            {data.customer_address && <p className="text-xs text-ink-muted">{data.customer_address}</p>}
          </section>
          <p className="mt-5 text-sm font-semibold text-navy-950">
            Subject: Payment due for installment “{data.installment_name}” — Booking {data.booking_number}, Flat {data.flat_number}, {data.block_name}, {data.project_name}
          </p>
          <p className="mt-4 text-sm leading-6">
            Dear Sir/Madam, as per the payment plan accepted with your booking, the installment <span className="font-semibold">{data.installment_name}</span> ({formatPercent(data.percent)}) has become due on{" "}
            <span className="font-semibold">{data.trigger_label}</span>. Kindly remit the following amount on or before <span className="font-semibold">{formatDate(data.due_date)}</span>.
          </p>
          <table className="mt-5 w-full border-collapse text-sm">
            <thead>
              <tr className="bg-navy-50 text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="border border-border px-3 py-2">Particulars</th>
                <th className="money border border-border px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-border px-3 py-2">Cash bucket — {data.installment_name}</td>
                <td className="money border border-border px-3 py-2 text-right">{formatINR(data.cash_demand_paise)}</td>
              </tr>
              <tr>
                <td className="border border-border px-3 py-2">Account bucket — {data.installment_name}</td>
                <td className="money border border-border px-3 py-2 text-right">{formatINR(data.account_demand_paise)}</td>
              </tr>
              <tr className="bg-gold-light font-semibold">
                <td className="border border-border px-3 py-2">Total demanded</td>
                <td className="money border border-border px-3 py-2 text-right text-navy-950">{formatINR(data.total_demand_paise)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs font-medium text-gold-text">{data.total_words}</p>

          <section className="mt-6">
            <h3 className="label-caps mb-2">Position after this demand</h3>
            <PrintFacts
              items={[
                { label: "Cash bucket due", value: <DueAmount paise={data.cash_due_paise} /> },
                { label: "Account bucket due", value: <DueAmount paise={data.account_due_paise} /> },
              ]}
            />
          </section>

          {data.bank && (
            <section className="mt-6 rounded-md border border-navy-200 bg-navy-50 p-4">
              <h3 className="label-caps mb-2">Bank details for the Account bucket</h3>
              <PrintFacts
                items={[
                  { label: "Bank", value: `${data.bank.bank_name}${data.bank.branch ? ` · ${data.bank.branch}` : ""}` },
                  { label: "Account name", value: data.bank.account_name },
                  { label: "Account number", value: data.bank.account_number },
                  { label: "IFSC", value: data.bank.ifsc },
                ]}
              />
              <p className="mt-2 text-xs text-ink-muted">Please quote the booking number {data.booking_number} in the transfer narration and share the UTR with Accounts.</p>
            </section>
          )}

          <p className="mt-6 text-xs text-ink-muted">Payments after the due date may attract interest as per the agreement. Please ignore this letter if the amount has already been paid.</p>
          <SignatureBlock name={null} title={null} forCompany={company.name} />
        </article>
      )}
    </PrintFrame>
  );
}
