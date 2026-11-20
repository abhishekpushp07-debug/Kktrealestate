import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import api, { BACKEND, errMsg } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, Field, StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { TypedMasterInput } from "@/components/common/TypedMasterInput";
import { ReasonDialog } from "@/components/common/ReasonDialog";
import { WhyDisabled } from "@/components/common/WhyDisabled";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const r = (p) => inr((p || 0) / 100);

/** REQ-243: request a waiver — instalments at share level (settle oldest-first like a receipt), charges per line. */
function GiveWaiver({ b, onClose, onDone }) {
  const opts = useMemo(() => {
    const s = b.summary || {};
    return [
      {
        value: "share:Account",
        label: "Account share",
        sub: `open ${r(s.account_due_paise)}`,
        open: s.account_due_paise,
      },
      {
        value: "share:Cash",
        label: "Cash share",
        sub: `open ${r(s.cash_due_paise)}`,
        open: s.cash_due_paise,
      },
      ...(b.other_charges || []).map((l) => ({
        value: `line:${l.line_id}`,
        label: l.name,
        sub: `open ${r(l.demanded_paise - l.paid_paise)}`,
        open: l.demanded_paise - l.paid_paise,
      })),
    ].filter((o) => o.open > 0);
  }, [b]);
  const [pick, setPick] = useState(opts[0]?.value || null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const sel = opts.find((o) => o.value === pick);
  const amt = Number(amount) || 0;
  const why = !sel
    ? "Nothing is open on this booking"
    : !amt
      ? "Enter the amount"
      : amt * 100 > sel.open
        ? `Only ${r(sel.open)} is open on the ${sel.label}`
        : reason.trim().length < 3
          ? "Pick or type the reason"
          : null;
  const save = async () => {
    const [kind, id] = pick.split(":");
    setBusy(true);
    try {
      const x = await api.post("/waivers", {
        booking_id: b.id,
        target: kind === "share" ? { kind, share: id } : { kind, line_id: id },
        amount: amt,
        reason: reason.trim(),
      });
      toast.success(
        x.data.status === "Approved"
          ? `${x.data.waiver_number} approved (self) · ${x.data.cn_number}`
          : `${x.data.waiver_number} sent for approval — no money moves until approved`,
      );
      onDone();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md"
        data-testid="waiver-sheet"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">
            Give waiver · {b.booking_number}
          </SheetTitle>
          <SheetDescription>
            Instalments are waived at share level and settle the oldest bills first, like a receipt.
            A charge is waived on its own line. Nothing moves until the owner approves.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-4">
          <Field label="Waive from" required>
            <Select
              options={opts}
              value={pick}
              onChange={setPick}
              allowAdd={false}
              clearable={false}
              testId="waiver-target"
            />
          </Field>
          <Field label="Amount (₹)" required>
            <Input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="waiver-amount"
            />
          </Field>
          {pick === "share:Account" && (
            <p className="text-xs text-txt-secondary" data-testid="waiver-gst-hint">
              The GST on agreement for this amount is credited too, at the booking&apos;s GST rate.
            </p>
          )}
          <Field label="Reason" required>
            <TypedMasterInput
              list="waiver_reason"
              value={reason}
              onChange={setReason}
              placeholder="e.g. Delay compensation"
              testId="waiver-reason"
            />
          </Field>
          <WhyDisabled reason={why} className="block" testId="waiver-why">
            <Button
              variant="primary"
              className="w-full"
              disabled={!!why || busy}
              onClick={save}
              data-testid="waiver-submit"
            >
              {busy ? "Saving…" : "Request waiver"}
            </Button>
          </WhyDisabled>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function WaiversPanel({ b, can, user, onChanged }) {
  const [items, setItems] = useState(null);
  const [give, setGive] = useState(false);
  const [ask, setAsk] = useState(null);
  const load = useCallback(
    () => api.get("/waivers", { params: { booking_id: b.id } }).then((x) => setItems(x.data.items)),
    [b.id],
  );
  useEffect(() => {
    if (can("finance.waiver.view")) load();
  }, [load, can]);
  if (!can("finance.waiver.view")) return null;
  const done = () => {
    load();
    onChanged();
  };
  const act = (w, a) =>
    api
      .post(`/waivers/${w.id}/${a}`)
      .then(() => toast.success(`${w.waiver_number} approved`))
      .then(done)
      .catch((e) => toast.error(errMsg(e)));
  const owner = user?.role_name === "Super Admin";
  return (
    <Card className="!p-0" testId="waivers-panel">
      <div className="flex items-center justify-between px-6 py-4">
        <h3 className="e-caps-blue">Waivers &amp; credit notes</h3>
        {can("finance.waiver.request") && b.status === "Active" && (
          <Button
            variant="soft"
            size="compact"
            onClick={() => setGive(true)}
            data-testid="give-waiver-btn"
          >
            Give waiver
          </Button>
        )}
      </div>
      {give && <GiveWaiver b={b} onClose={() => setGive(false)} onDone={done} />}
      {ask && (
        <ReasonDialog
          title={ask.a === "reject" ? `Reject ${ask.w.waiver_number}` : `Cancel ${ask.w.cn_number}`}
          body={
            ask.a === "cancel"
              ? "Posts exact reversing entries today; the numbers are kept, marked Cancelled."
              : undefined
          }
          cta={ask.a === "reject" ? "Reject" : "Cancel waiver"}
          testId={`waiver-${ask.a}`}
          onClose={() => setAsk(null)}
          onSubmit={async (reason) => {
            await api.post(`/waivers/${ask.w.id}/${ask.a}`, { reason });
            toast.success(
              ask.a === "reject" ? "Rejected — requester notified" : "Waiver cancelled",
            );
            done();
          }}
        />
      )}
      {!items?.length ? (
        <p className="px-6 pb-5 text-sm text-txt-muted">No waivers on this booking.</p>
      ) : (
        <ul className="divide-y divide-warm-200">
          {items.map((w) => (
            <li
              key={w.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm"
              data-testid={`waiver-row-${w.waiver_number}`}
            >
              <span className="font-semibold text-ink-950">{w.waiver_number}</span>
              <StatusPill status={w.status} />
              <span>
                {r(w.amount_paise)} · {w.target_label} · {w.reason}
              </span>
              {w.gst_note?.gst_paise > 0 && (
                <span className="text-xs text-txt-secondary">{w.gst_note.text}</span>
              )}
              {w.settles?.length > 0 && (
                <span className="text-xs text-txt-secondary">
                  settles{" "}
                  {w.settles.map((x) => `${x.demand_number} ${r(x.amount_paise)}`).join(", ")}
                </span>
              )}
              <span className="text-xs text-txt-muted">
                {w.requested_by_name} · {fmtDate(w.requested_on)}
                {w.self_approved && " · self-approved"}
                {w.reject_reason && ` · rejected: ${w.reject_reason}`}
              </span>
              <span className="ml-auto flex gap-2">
                {w.cn_number && (
                  <a
                    className="btn btn-ghost !h-8 text-xs"
                    target="_blank"
                    rel="noreferrer"
                    href={`${BACKEND}/api/waivers/${w.id}/credit-note.pdf`}
                    data-testid={`waiver-cn-${w.waiver_number}`}
                  >
                    {w.cn_number} PDF
                  </a>
                )}
                {w.status === "Pending" && can("finance.waiver.approve") && (
                  <>
                    <WhyDisabled
                      reason={
                        w.requested_by === user?.id && !owner
                          ? "You cannot approve your own request"
                          : null
                      }
                    >
                      <Button
                        size="compact"
                        variant="primary"
                        disabled={w.requested_by === user?.id && !owner}
                        onClick={() => act(w, "approve")}
                        data-testid={`waiver-approve-${w.waiver_number}`}
                      >
                        Approve
                      </Button>
                    </WhyDisabled>
                    <Button
                      size="compact"
                      variant="quiet"
                      onClick={() => setAsk({ w, a: "reject" })}
                      data-testid={`waiver-reject-${w.waiver_number}`}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {w.status === "Approved" && owner && (
                  <Button
                    size="compact"
                    variant="quiet"
                    onClick={() => setAsk({ w, a: "cancel" })}
                    data-testid={`waiver-cancel-${w.waiver_number}`}
                  >
                    Cancel
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
