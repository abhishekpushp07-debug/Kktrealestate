import { plural } from "@/lib/format";
import { TypedMasterInput } from "@/components/common/TypedMasterInput";
import { DateInput } from "@/components/common/DateInput";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showNextStep } from "@/components/common/NextStep";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useTransferValidation } from "./booking-ops/useTransferValidation";
import { SwapStep, TransferStep } from "./booking-ops/TransferSteps";
import { Field, EmptyState } from "@/components/common/Bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, StatusPill } from "@/components/v2";
import { inr, fmtDate, MODE_LABEL } from "@/lib/format";
import { useMasterOptions } from "@/hooks/useList";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { businessToday } from "@/lib/businessDay";
import { Select } from "@/components/v2/Select";
import { WhyDisabled } from "@/components/common/WhyDisabled";

const today = () => businessToday();

export function RefundsTab({ bookingId, canPay, onChanged, autoPay }) {
  const [items, setItems] = useState(null);
  const [pay, setPay] = useState(null);
  const { options: banks } = useMasterOptions("bank-accounts", (b) => ({
    value: b.id,
    label: `${b.bank_name} · ${b.account_name}`,
  }));
  // REQ-232: refund modes come from the Payment Modes master (a loan disbursement is never a refund mode)
  const { options: modes } = useMasterOptions("payment-modes", (m) => ({
    value: m.code,
    label: m.name,
  }));
  const refundModes = modes.filter((m) => m.value !== "LOAN_DISBURSEMENT");
  const load = useCallback(
    () =>
      api
        .get(`/bookings/${bookingId}/refunds`)
        .then((r) => setItems(r.data.items))
        .catch(() => setItems([])),
    [bookingId],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const r =
      autoPay && canPay && (items || []).find((x) => x.status === "Pending" && !x.parent_refund_id);
    if (r)
      setPay(
        (cur) =>
          cur || {
            id: r.id,
            paid_date: today(),
            mode: "NEFT_RTGS",
            bank_account_id: "",
            reference: "",
          },
      );
  }, [autoPay, canPay, items]);
  const submit = async () => {
    try {
      await api.post(`/refunds/${pay.id}/pay`, {
        paid_date: pay.paid_date,
        mode: pay.mode,
        bank_account_id: pay.mode === "CASH" ? null : pay.bank_account_id || null,
        reference: pay.reference || null,
      });
      toast.success("Refund paid — contra posted to ledger and Roznamcha");
      showNextStep({
        title: "Refund paid",
        actions: [
          {
            label: "Print refund letter",
            to: `/documents?type=cancellation&booking_id=${bookingId}`,
          },
        ],
      });
      setPay(null);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e), { duration: 8000 });
    }
  };
  const topLevel = useMemo(() => (items || []).filter((r) => !r.parent_refund_id), [items]);
  if (!items) return null;
  if (items.length === 0)
    return (
      <EmptyState
        title="No refunds"
        description="Refund records are created when a booking is cancelled with money received."
      />
    );
  return (
    <Card className="overflow-x-auto !p-0" testId="refunds-table">
      <table className="stack-table w-full text-sm">
        <thead className="text-[11px] font-semibold uppercase tracking-wide text-txt-muted">
          <tr>
            <th className="px-3 py-2 text-left">Refund</th>
            <th className="px-3 py-2 text-right">Received</th>
            <th className="px-3 py-2 text-right">Deduction</th>
            <th className="px-3 py-2 text-right">Payable</th>
            <th className="px-3 py-2 text-left">Due by</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Paid</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {topLevel.map((r) => (
            <tr key={r.id} className="border-t" data-testid={`refund-row-${r.status}`}>
              <td className="px-3 py-2 font-mono text-xs">
                <span className="inline-flex items-center gap-2">
                  <HistoryButton entityType="refund" entityId={r.id} />
                  {r.refund_number}
                </span>
              </td>
              <td className="px-3 py-2 text-right">{inr(r.received)}</td>
              <td className="px-3 py-2 text-right">{inr(r.deduction)}</td>
              <td className="px-3 py-2 text-right font-semibold">
                {inr(r.amount_total ?? r.amount)}
              </td>
              <td className="px-3 py-2">{r.due_by ? fmtDate(r.due_by) : "—"}</td>
              <td className="px-3 py-2">
                <StatusPill status={r.status} />
              </td>
              <td className="px-3 py-2 text-xs">
                {r.status === "Paid"
                  ? `${fmtDate(r.paid_date)} · ${r.mode} ${r.reference || ""}`
                  : "—"}
              </td>
              <td className="px-3 py-2 text-right">
                {r.status === "Pending" && canPay && (
                  <Button
                    size="sm"
                    onClick={() =>
                      setPay({
                        id: r.id,
                        paid_date: today(),
                        mode: "NEFT_RTGS",
                        bank_account_id: "",
                        reference: "",
                      })
                    }
                    data-testid="refund-pay-btn"
                  >
                    Mark paid
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent data-testid="refund-pay-dialog">
          <DialogHeader>
            <DialogTitle>Pay refund</DialogTitle>
            <DialogDescription>
              Posts a contra row in the bucket the money came from and a cash-out/bank-out line in
              the Roznamcha.
            </DialogDescription>
          </DialogHeader>
          {pay && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Paid on" required>
                  <DateInput
                    value={pay.paid_date}
                    max={today()}
                    onChange={(e) => setPay({ ...pay, paid_date: e.target.value })}
                    data-testid="refund-date"
                  />
                </Field>
                <Field label="Mode" required>
                  <Select
                    options={refundModes}
                    value={pay.mode}
                    onChange={(v) => setPay({ ...pay, mode: v || "CASH" })}
                    allowAdd={false}
                    clearable={false}
                    testId="refund-mode"
                  />
                </Field>
              </div>
              {pay.mode !== "CASH" && (
                <Field label="From bank account" required>
                  <Select
                    options={banks}
                    value={pay.bank_account_id}
                    onChange={(v) => setPay({ ...pay, bank_account_id: v || "" })}
                    allowAdd={false}
                    testId="refund-bank"
                  />
                </Field>
              )}
              <Field label="Reference / UTR">
                <Input
                  value={pay.reference}
                  onChange={(e) => setPay({ ...pay, reference: e.target.value })}
                  data-testid="refund-reference"
                />
              </Field>
              <WhyDisabled
                reason={
                  pay.mode !== "CASH" && !pay.bank_account_id
                    ? "Pick the bank account the refund is paid from"
                    : null
                }
                className="block"
                testId="refund-why"
              >
                <Button
                  className="w-full"
                  why={
                    pay.mode !== "CASH" && !pay.bank_account_id
                      ? "Pick the bank account the refund is paid from"
                      : undefined
                  }
                  disabled={pay.mode !== "CASH" && !pay.bank_account_id}
                  onClick={submit}
                  data-testid="refund-pay-submit"
                >
                  Confirm payout
                </Button>
              </WhyDisabled>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function TransferDialog({ open, onOpenChange, booking, onDone }) {
  const [mode, setMode] = useState("transfer");
  const [flats, setFlats] = useState([]);
  const [others, setOthers] = useState([]);
  const curPct = booking.agreement_value_paise
    ? Math.round((booking.cash_agreed_paise * 10000) / booking.agreement_value_paise) / 100
    : 0;
  const [f, setF] = useState({
    new_flat_id: "",
    reason: "",
    price_handling: "revise_agreement",
    old_flat_status: "Available",
    cash_percent: curPct,
    other_booking_id: "",
  });
  const v = useTransferValidation(booking, f, flats);
  const { revise, belowCash, belowAcc } = v;
  useEffect(() => {
    if (!open) return;
    api
      .get("/flats", { params: { status: "Available", page_size: 200 } })
      .then((r) => setFlats(r.data.items))
      .catch(() => setFlats([]));
    api
      .get("/bookings", { params: { status: "Active", page_size: 100 } })
      .then((r) => setOthers((r.data.items || []).filter((b) => b.id !== booking.id)))
      .catch(() => setOthers([]));
  }, [open, booking.id]);
  const submit = async () => {
    try {
      if (mode === "swap") {
        await api.post(`/bookings/${booking.id}/swap`, {
          other_booking_id: f.other_booking_id,
          reason: f.reason,
          version: booking.version,
        });
        toast.success("Units swapped between the two bookings");
      } else {
        const r = await api.post(`/bookings/${booking.id}/transfer`, {
          new_flat_id: f.new_flat_id,
          reason: f.reason,
          price_handling: f.price_handling,
          old_flat_status: f.old_flat_status,
          old_flat_hold_expires_at:
            f.old_flat_status === "Hold" && f.old_flat_hold_until
              ? new Date(f.old_flat_hold_until).toISOString()
              : null,
          cash_percent: revise ? Number(f.cash_percent) : null,
          version: booking.version,
        });
        toast.success(
          `Transferred ${r.data.transfer.from_flat} → ${r.data.transfer.to_flat} · ${plural(r.data.rebind.rebound, "bill")} re-bound`,
        );
      }
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(errMsg(e), { duration: 8000 });
    }
  };
  const transferWhy =
    mode === "swap"
      ? !f.other_booking_id
        ? "Pick the booking to swap with"
        : null
      : !f.new_flat_id
        ? "Pick the new flat"
        : belowCash || belowAcc
          ? "The new split is below what is already received"
          : f.old_flat_status === "Hold" && !f.old_flat_hold_until
            ? "Set until when the old flat stays on hold"
            : null;
  const transferBlock =
    transferWhy || (f.reason.trim().length < 3 ? "Type the reason (at least 3 characters)" : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="transfer-dialog">
        <DialogHeader>
          <DialogTitle>Transfer unit</DialogTitle>
          <DialogDescription>
            Money follows the customer: ledgers and receipts stay on {booking.booking_number}. Open
            demands and the unpaid schedule are recomputed from the new agreement.
          </DialogDescription>
        </DialogHeader>
        <div className="mb-3 flex gap-1.5">
          {[
            ["transfer", "Move to an available unit"],
            ["swap", "Swap with another booking"],
          ].map(([m, l]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`pill ${mode === m ? "bg-ink-950 text-warm-50" : "bg-warm-100 text-ink-950"}`}
              data-testid={`transfer-mode-${m}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {mode === "swap" ? (
            <SwapStep f={f} setF={setF} others={others} booking={booking} />
          ) : (
            <TransferStep f={f} setF={setF} flats={flats} booking={booking} v={v} />
          )}
          <Field label="Reason" required>
            <TypedMasterInput
              list="transfer_reason"
              value={f.reason}
              onChange={(v) => setF({ ...f, reason: v })}
              placeholder="Why the booking moves"
              testId="transfer-reason"
            />
          </Field>
          <WhyDisabled reason={transferBlock} className="block" testId="transfer-why">
            <Button
              className="w-full"
              disabled={!!transferBlock}
              onClick={submit}
              data-testid="transfer-submit"
            >
              {mode === "swap" ? "Swap units" : "Transfer"}
            </Button>
          </WhyDisabled>
        </div>
      </DialogContent>
    </Dialog>
  );
}
