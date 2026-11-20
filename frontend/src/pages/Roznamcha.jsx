import { useState } from "react";
import { DateInput } from "@/components/common/DateInput";
import { AmountInput } from "@/components/common/AmountInput";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  Printer,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useMasterOptions } from "@/hooks/useList";
import { inr, fmtDate, MODE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, Field, Money, Num, Skeleton, StatTile, StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Avatar, Segmented } from "@/components/v2/CustomerBits";
import { Button } from "@/components/ui/button";
import { addDays, businessToday } from "@/lib/businessDay";
import { ReasonDialog } from "@/components/common/ReasonDialog";
import { WhyDisabled } from "@/components/common/WhyDisabled";

const shift = (s, n) => addDays(s, n);

function Group({ title, rows, testId }) {
  const entries = Object.entries(rows || {});
  return (
    <Card className="!p-0" testId={testId}>
      <h3 className="px-5 pt-4 e-caps-blue">{title}</h3>
      {entries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-txt-muted">No receipts</p>
      ) : (
        <ul className="mt-2 divide-y divide-warm-100">
          {entries.map(([k, v]) => (
            <li key={k} className="flex h-11 items-center justify-between px-5 text-sm">
              <span className="text-txt-secondary">
                {k}
                {v.count != null && (
                  <span className="ml-1.5 text-xs text-txt-muted">×{v.count}</span>
                )}
              </span>
              <Money value={v.amount} className="text-base text-ink-950" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Roznamcha({ embedded }) {
  const { can } = useAuth();
  const [date, setDate] = useState(() => businessToday());
  const [contra, setContra] = useState({
    kind: "DEPOSIT",
    amount: "",
    bank_account_id: null,
    remarks: "",
  });
  const { data: d, loading, reload } = useFetch(`/roznamcha?date=${date}`, [date]);
  const { options: banks } = useMasterOptions("bank-accounts", (b) => ({
    value: b.id,
    label: `${b.bank_name} ${b.account_number_masked || ""}`,
  }));
  const postContra = async () => {
    try {
      await api.post("/roznamcha/contra", {
        date,
        kind: contra.kind,
        amount: Number(contra.amount),
        bank_account_id: contra.bank_account_id,
        remarks: contra.remarks || null,
      });
      toast.success("Contra entry posted");
      setContra({ ...contra, amount: "", remarks: "" });
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const [opening, setOpening] = useState(null);
  const [undo, setUndo] = useState(null);
  const contraWhy = !Number(contra.amount)
    ? "Enter the amount"
    : !contra.bank_account_id
      ? "Pick the bank account"
      : null;
  const saveOpening = async () => {
    try {
      await api.post("/roznamcha/opening", {
        date: opening.date,
        amount: Number(opening.amount),
        remarks: opening.remarks || null,
      });
      toast.success("Opening cash saved");
      setOpening(null);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const days = Array.from({ length: 7 }, (_, i) => shift(date, i - 3));
  return (
    <div className="space-y-8" data-testid="roznamcha-page">
      {undo && (
        <ReasonDialog
          title={undo.kind === "contra" ? "Undo contra entry" : "Undo opening cash"}
          body="A reversing entry is posted on the same day; the original stays in the day book. Then post the correct one."
          cta="Post reversing entry"
          testId="rozn-undo"
          onClose={() => setUndo(null)}
          onSubmit={async (reason) => {
            await api.post(`/roznamcha/${undo.kind}/${undo.row.id}/undo`, { reason });
            toast.success("Reversing entry posted");
            reload();
          }}
        />
      )}
      <header className="print:hidden">
        <h1 className="e-title" data-testid="page-title">
          roznamcha.
        </h1>
        <p className="e-sub">
          The day book — cash in, cash out and what is left in hand, day by day.
        </p>
      </header>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between print:hidden">
        <div className="flex items-center gap-2" data-testid="rozn-date-strip">
          <Button
            onClick={() => setDate(shift(date, -1))}
            variant="soft"
            className="!h-10 !w-10 !px-0"
            aria-label="Previous day"
            data-testid="rozn-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex gap-1 overflow-x-auto scroll-x">
            {days.map((day) => (
              <button
                key={day}
                onClick={() => setDate(day)}
                className={cn(
                  "flex min-w-[64px] flex-col items-center rounded-xl px-3 py-1.5 transition-colors",
                  day === date
                    ? "bg-ink-950 text-warm-50"
                    : "bg-white text-txt-secondary ring-1 ring-warm-200 hover:bg-warm-100",
                )}
                data-testid={`rozn-day-${day}`}
              >
                <span className="text-[10px] font-semibold uppercase">
                  {new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" })}
                </span>
                <span className="font-display text-lg leading-tight">{day.slice(8)}</span>
              </button>
            ))}
          </div>
          <Button
            onClick={() => setDate(shift(date, 1))}
            variant="soft"
            className="!h-10 !w-10 !px-0"
            aria-label="Next day"
            data-testid="rozn-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <DateInput
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input !w-40"
            data-testid="rozn-date"
          />
        </div>
        <div className="flex items-center gap-2">
          {can("finance.roznamcha.opening_balance") && (
            <Button
              variant="soft"
              onClick={() => setOpening({ date, amount: "", remarks: "" })}
              data-testid="rozn-set-opening"
            >
              Set opening cash
            </Button>
          )}
          <Button variant="soft" onClick={() => window.print()} data-testid="rozn-print">
            <Printer className="h-4 w-4" strokeWidth={1.75} />
            Print day book
          </Button>
        </div>
      </div>
      {opening && (
        <Card className="print:hidden" testId="rozn-opening-form">
          <p className="text-sm text-txt-secondary">
            Opening balance of the cash book (first day). Closing cash = opening + cash receipts −
            deposits + withdrawals − cash refunds.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <Field label="As on date" required>
              <DateInput
                className="input"
                value={opening.date}
                onChange={(e) => setOpening({ ...opening, date: e.target.value })}
                data-testid="rozn-opening-date"
              />
            </Field>
            <Field label="Opening cash ₹" required>
              <AmountInput
                className="input"
                value={opening.amount}
                onChange={(e) => setOpening({ ...opening, amount: e.target.value })}
                data-testid="rozn-opening-amount"
              />
            </Field>
            <Field label="Remarks">
              <input
                className="input"
                value={opening.remarks}
                onChange={(e) => setOpening({ ...opening, remarks: e.target.value })}
                data-testid="rozn-opening-remarks"
              />
            </Field>
            <div className="flex items-end gap-2">
              <Button variant="primary" onClick={saveOpening} data-testid="rozn-opening-save">
                Save
              </Button>
              <Button variant="quiet" onClick={() => setOpening(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}
      {loading || !d ? (
        <div className="grid gap-6 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div
            className="grid min-w-0 grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4 [&>*]:min-w-0"
            data-testid="rozn-summary"
          >
            <StatTile
              label="Opening cash"
              value={inr(d.opening_cash)}
              hint={`carried into ${fmtDate(date)}`}
              icon={ArrowUpFromLine}
              testId="rozn-opening"
            />
            <StatTile
              label="Cash received"
              value={inr(d.cash_received)}
              hint={`${d.receipts.length} receipts · total ${inr(d.total_receipts)}`}
              icon={Receipt}
              testId="rozn-received"
            />
            <StatTile
              label="Cash paid out"
              value={inr(d.cash_paid_out)}
              hint={`deposited ${inr(d.bank_deposits)} · refunds ${inr(d.cash_refunds)} · reversed ${inr(d.cash_reversed)}`}
              icon={ArrowDownToLine}
              testId="rozn-paid-out"
            />
            <StatTile
              label="Closing cash"
              value={inr(d.closing_cash)}
              hint={`pending cheques ${inr(d.pending)}`}
              icon={Receipt}
              testId="rozn-closing"
            />
          </div>
          <p className="tnum text-sm text-txt-secondary" data-testid="rozn-formula">
            Opening {inr(d.opening_cash)} + cash in {inr(d.cash_received + d.cash_withdrawals)} −
            cash out {inr(d.cash_paid_out)} = closing {inr(d.closing_cash)}
            {d.cash_withdrawals ? ` (incl. ${inr(d.cash_withdrawals)} withdrawn from bank)` : ""}
          </p>
          <div className="grid gap-6 lg:grid-cols-3">
            <Group title="By mode" rows={d.by_mode} testId="rozn-by-mode" />
            <Group
              title="By bucket · project"
              rows={{
                ...d.by_category,
                ...Object.fromEntries(Object.entries(d.by_project).map(([k, v]) => [`▸ ${k}`, v])),
              }}
              testId="rozn-by-bucket"
            />
            <Card className="print:hidden" testId="rozn-contra">
              <h3 className="e-caps-blue">Contra entry</h3>
              {can("finance.roznamcha.view") ? (
                <div className="mt-4 space-y-4">
                  <Segmented
                    options={[
                      { value: "DEPOSIT", label: "Deposit to bank" },
                      { value: "WITHDRAWAL", label: "Withdraw cash" },
                    ]}
                    value={contra.kind}
                    onChange={(v) => setContra({ ...contra, kind: v })}
                    testId="contra-kind"
                  />
                  <Field label="Amount (₹)" required>
                    <AmountInput
                      className="input font-display text-lg"
                      value={contra.amount}
                      onChange={(e) => setContra({ ...contra, amount: e.target.value })}
                      data-testid="contra-amount"
                    />
                  </Field>
                  <Field label="Bank account" required>
                    <Select
                      options={banks}
                      value={contra.bank_account_id}
                      onChange={(v) => setContra({ ...contra, bank_account_id: v })}
                      allowAdd={false}
                      testId="contra-bank"
                    />
                  </Field>
                  <Field label="Remarks">
                    <input
                      className="input"
                      value={contra.remarks}
                      onChange={(e) => setContra({ ...contra, remarks: e.target.value })}
                      data-testid="contra-remarks"
                    />
                  </Field>
                  <WhyDisabled reason={contraWhy} className="block" testId="contra-why">
                    <Button
                      onClick={postContra}
                      disabled={!!contraWhy}
                      variant="primary"
                      className="w-full"
                      data-testid="contra-submit"
                    >
                      <ArrowDownToLine className="h-4 w-4" />
                      Post contra
                    </Button>
                  </WhyDisabled>
                </div>
              ) : (
                <p className="mt-3 text-sm text-txt-muted">payment.post required</p>
              )}
            </Card>
          </div>
          <Card className="!p-0" testId="rozn-receipts">
            <h3 className="px-6 pt-5 e-caps-blue">Entries · {fmtDate(date)}</h3>
            {d.receipts.length === 0 &&
            d.contra.length === 0 &&
            !d.opening_entries?.length &&
            d.refunds.length === 0 &&
            d.reversals.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-txt-muted">
                No entries on {fmtDate(date)}.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-txt-muted">
                      <th className="px-6 py-3">Receipt</th>
                      <th className="px-4 py-3">Customer · unit</th>
                      <th className="px-4 py-3">Towards</th>
                      <th className="px-4 py-3">Mode</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-6 py-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.receipts.map((p, i) => (
                      <tr
                        key={p.id}
                        className={cn("h-11", i % 2 === 1 && "bg-warm-50")}
                        data-testid={`rozn-receipt-${p.receipt_number}`}
                      >
                        <td className="px-6 py-2 font-mono text-xs text-txt-secondary">
                          {p.receipt_number}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Avatar name={p.customer_name} size={26} />
                            <span className="font-semibold text-ink-950">{p.customer_name}</span>
                            <span className="text-xs text-txt-muted">
                              {p.project_code} {p.flat_number}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-txt-secondary">
                          {p.against === "FLAT_VALUE" ? p.payment_category : p.other_charge_name}
                        </td>
                        <td className="px-4 py-2 text-txt-secondary">{p.payment_mode_name}</td>
                        <td className="px-4 py-2 text-right font-display text-base text-ink-950">
                          <Num s={inr(p.amount)} />
                        </td>
                        <td className="px-6 py-2 text-right">
                          <StatusPill status={p.status} />
                        </td>
                      </tr>
                    ))}
                    {d.refunds.map((r) => (
                      <tr
                        key={r.id}
                        className="h-11 bg-warm-100/60"
                        data-testid={`rozn-refund-${r.refund_number}`}
                      >
                        <td className="px-6 py-2 font-mono text-xs text-txt-secondary">
                          {r.refund_number}
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-semibold text-ink-950">{r.customer_name}</span>{" "}
                          <span className="text-xs text-txt-muted">{r.booking_number}</span>
                        </td>
                        <td className="px-4 py-2 text-txt-secondary">Refund on cancellation</td>
                        <td className="px-4 py-2 text-txt-secondary">
                          {r.mode === "CASH"
                            ? "Cash"
                            : `${MODE_LABEL[r.mode] || r.mode} · not cash`}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-2 text-right font-display text-base",
                            r.mode === "CASH" ? "text-brick" : "text-txt-muted",
                          )}
                        >
                          −<Num s={inr(r.paid_out)} />
                        </td>
                        <td className="px-6 py-2 text-right">
                          <StatusPill status="Paid" />
                        </td>
                      </tr>
                    ))}
                    {d.reversals
                      .filter((p) => p.payment_mode_code === "CASH")
                      .map((p) => (
                        <tr
                          key={`rev-${p.id}`}
                          className="h-11 bg-warm-100/60"
                          data-testid={`rozn-reversal-${p.receipt_number}`}
                        >
                          <td className="px-6 py-2 font-mono text-xs text-txt-secondary">
                            {p.receipt_number}
                          </td>
                          <td className="px-4 py-2">
                            <span className="font-semibold text-ink-950">{p.customer_name}</span>
                          </td>
                          <td className="px-4 py-2 text-txt-secondary">
                            Receipt reversed · cash back
                          </td>
                          <td className="px-4 py-2 text-txt-secondary">Cash</td>
                          <td className="px-4 py-2 text-right font-display text-base text-brick">
                            −<Num s={inr(p.amount)} />
                          </td>
                          <td className="px-6 py-2 text-right">
                            <StatusPill status="Reversed" />
                          </td>
                        </tr>
                      ))}
                    {d.contra.map((c) => (
                      <tr
                        key={c.id}
                        className="h-11 bg-warm-100/60"
                        data-testid={`rozn-contra-${c.id}`}
                      >
                        <td className="px-6 py-2 text-xs font-semibold text-txt-secondary">
                          CONTRA
                        </td>
                        <td className="px-4 py-2 text-txt-secondary" colSpan={3}>
                          {c.kind === "DEPOSIT" ? "Cash deposited to" : "Cash withdrawn from"}{" "}
                          {c.bank_name}
                          {c.remarks && ` · ${c.remarks}`}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-2 text-right font-display text-base",
                            c.kind === "DEPOSIT" ? "text-brick" : "text-sage",
                          )}
                        >
                          {(c.kind === "DEPOSIT") === c.amount >= 0 ? "−" : "+"}
                          <Num s={inr(Math.abs(c.amount))} />
                        </td>
                        <td className="px-6 py-2 text-right">
                          {c.reverses_id ? (
                            <StatusPill status="Reversal" />
                          ) : c.reversed_at ? (
                            <span title={c.reverse_reason}>
                              <StatusPill status="Undone" />
                            </span>
                          ) : (
                            can("finance.roznamcha.deposit") && (
                              <Button
                                variant="quiet"
                                size="sm"
                                onClick={() => setUndo({ kind: "contra", row: c })}
                                data-testid={`rozn-contra-undo-${c.id}`}
                              >
                                Undo
                              </Button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                    {(d.opening_entries || []).map((o) => (
                      <tr key={o.id} className="h-11" data-testid={`rozn-opening-row-${o.id}`}>
                        <td className="px-6 py-2 text-xs font-semibold text-txt-secondary">
                          OPENING
                        </td>
                        <td className="px-4 py-2 text-txt-secondary" colSpan={3}>
                          {o.reverses_id ? "Opening cash undone" : "Opening cash set"}
                          {o.remarks && ` · ${o.remarks}`} · {o.created_by_name}
                        </td>
                        <td className="px-4 py-2 text-right font-display text-base">
                          <Num s={inr(o.amount)} />
                        </td>
                        <td className="px-6 py-2 text-right">
                          {o.reverses_id ? (
                            <StatusPill status="Reversal" />
                          ) : o.reversed_at ? (
                            <span title={o.reverse_reason}>
                              <StatusPill status="Undone" />
                            </span>
                          ) : (
                            can("finance.roznamcha.opening_balance") && (
                              <Button
                                variant="quiet"
                                size="sm"
                                onClick={() => setUndo({ kind: "opening", row: o })}
                                data-testid={`rozn-opening-undo-${o.id}`}
                              >
                                Undo
                              </Button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
