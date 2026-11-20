import { useState } from "react";
import { ChevronDown, FileText, Printer } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/v2/Select";
import { WhyDisabled } from "@/components/common/WhyDisabled";
import { DateInput } from "@/components/common/DateInput";
import { businessToday } from "@/lib/businessDay";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// One "More" entry: enabled, or disabled with the server's own reason (GET /bookings/{id}/actions)
function Item({ label, reason, onSelect, testId, icon: Icon }) {
  return (
    <DropdownMenuItem
      disabled={Boolean(reason)}
      onSelect={onSelect}
      className="flex-col items-start gap-0.5 data-[disabled]:opacity-100"
      data-testid={testId}
      title={reason || undefined}
    >
      <span className={`flex items-center gap-2 font-medium ${reason ? "text-txt-muted" : ""}`}>
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
        {label}
      </span>
      {reason && (
        <span className="text-xs text-txt-secondary" data-testid={`${testId}-reason`}>
          {reason}
        </span>
      )}
    </DropdownMenuItem>
  );
}

function ChangePlanDialog({ b, plans, onClose, onDone }) {
  const [planId, setPlanId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const why = !planId
    ? "Choose the new plan"
    : reason.trim().length < 3
      ? "Type the reason (at least 3 characters)"
      : null;
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/bookings/${b.id}/payment-plan`, {
        payment_plan_id: planId,
        reason: reason.trim(),
      });
      toast.success("Payment plan changed");
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="change-plan-dialog">
        <DialogHeader>
          <DialogTitle>Change payment plan</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-txt-secondary">
            Current plan:{" "}
            <span className="font-semibold text-ink-950">
              {b.payment_plan_snapshot?.name || "—"}
            </span>
          </p>
          <Select
            options={plans
              .filter((p) => p.id !== b.payment_plan_id)
              .map((p) => ({ value: p.id, label: p.name }))}
            value={planId}
            onChange={(v) => setPlanId(v || "")}
            allowAdd={false}
            placeholder="Choose a plan"
            testId="change-plan-select"
          />
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for the change (shown in Activity)"
            data-testid="change-plan-reason"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="btn btn-secondary" onClick={onClose}>
              Close
            </Button>
            <WhyDisabled reason={why}>
              <Button onClick={save} disabled={!!why || busy} data-testid="change-plan-save">
                Change plan
              </Button>
            </WhyDisabled>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 3E: a marked signing date changes only here — owner / admin, with a reason (audited). */
function CorrectSignedDialog({ b, onClose, onDone }) {
  const [on, setOn] = useState(b.plan_acceptance?.accepted_on || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const why = !on
    ? "Pick the signing date"
    : reason.trim().length < 3
      ? "Type a reason (3+ letters)"
      : null;
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/bookings/${b.id}/agreement-signed/correct`, {
        signed_on: on,
        reason: reason.trim(),
      });
      toast.success("Signed date corrected");
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="correct-signed-dialog">
        <DialogHeader>
          <DialogTitle>Correct signed date</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-txt-secondary">
            Marked signed on <b>{b.plan_acceptance?.accepted_on}</b> · {b.plan_acceptance?.mode}
          </p>
          <DateInput
            value={on}
            min={String(b.booking_date || "").slice(0, 10)}
            max={businessToday()}
            onChange={(e) => setOn(e.target.value)}
            data-testid="correct-signed-on"
          />
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why the date is being corrected (shown in Activity)"
            data-testid="correct-signed-reason"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="btn btn-secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={save}
              why={why || undefined}
              disabled={!!why || busy}
              data-testid="correct-signed-save"
            >
              Correct date
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PRINTS = [
  ["Statement", "statement", "statement-pdf-btn"],
  ["Allotment letter", "allotment", "allotment-pdf-btn"],
  ["Cost sheet", "cost-sheet", "cost-sheet-pdf-btn"],
];

/** REQ-116: More = Mark agreement signed, Revise agreement, Change plan, Transfer, Cancel, Print / Share. */
export function BookingMore({ b, rules, onRevise, onTransfer, onCancel, onChanged, signedForm }) {
  const [plan, setPlan] = useState(false);
  const [signing, setSigning] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const r = rules?.actions || {};
  const signed = !!b.plan_acceptance?.marked_at;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="btn btn-secondary" data-testid="booking-more-btn">
            More <ChevronDown className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72" data-testid="booking-more-menu">
          {!signed && (
            <Item
              label="Mark agreement signed"
              reason={r.agreement_signed}
              onSelect={() => setSigning(true)}
              testId="agreement-signed-btn"
            />
          )}
          {signed && (
            <Item
              label="Correct signed date"
              reason={r.correct_signed}
              onSelect={() => setCorrecting(true)}
              testId="correct-signed-btn"
            />
          )}
          <Item
            label="Revise agreement"
            reason={r.revise}
            onSelect={onRevise}
            testId="revise-agreement-btn"
          />
          <Item
            label="Change plan"
            reason={r.change_plan}
            onSelect={() => setPlan(true)}
            testId="change-plan-btn"
          />
          <Item
            label="Transfer"
            reason={r.transfer}
            onSelect={onTransfer}
            testId="transfer-booking-btn"
          />
          <Item
            label="Cancel booking"
            reason={r.cancel}
            onSelect={onCancel}
            testId="cancel-booking-btn"
          />
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-txt-muted">Print / Share</DropdownMenuLabel>
          {PRINTS.map(([label, kind, testId]) => (
            <Item
              key={kind}
              label={label}
              icon={kind === "statement" ? FileText : Printer}
              onSelect={() => window.open(`${BASE_PATH}/print/${kind}/${b.id}`, "_blank")}
              testId={testId}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {plan && (
        <ChangePlanDialog
          b={b}
          plans={rules?.plans || []}
          onClose={() => setPlan(false)}
          onDone={() => {
            setPlan(false);
            onChanged();
          }}
        />
      )}
      {correcting && (
        <CorrectSignedDialog
          b={b}
          onClose={() => setCorrecting(false)}
          onDone={() => {
            setCorrecting(false);
            onChanged();
          }}
        />
      )}
      {signing && (
        <Dialog open onOpenChange={(o) => !o && setSigning(false)}>
          <DialogContent data-testid="agreement-signed-dialog">
            <DialogHeader>
              <DialogTitle>Mark agreement signed</DialogTitle>
            </DialogHeader>
            {signedForm(() => setSigning(false))}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
