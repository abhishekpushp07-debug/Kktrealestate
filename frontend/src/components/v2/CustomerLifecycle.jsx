import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/v2/Select";
import { ReasonDialog } from "@/components/common/ReasonDialog";
import { WhyDisabled } from "@/components/common/WhyDisabled";

/** REQ-221: Super Admin merges a duplicate into this (surviving) customer; every linked record moves, money unchanged. */
function MergeDialog({ c, onClose, onDone }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [dup, setDup] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .get("/customers", { params: { search: q || c.full_name, page_size: 20 } })
        .then((r) => setItems(r.data.items.filter((x) => x.id !== c.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, c.id, c.full_name]);
  const opts = useMemo(
    () =>
      items.map((x) => ({
        value: x.id,
        label: x.full_name,
        sub: `${x.customer_code} · ${x.phone}`,
      })),
    [items],
  );
  const why = !dup
    ? "Pick the duplicate profile"
    : reason.trim().length < 3
      ? "Type the reason"
      : null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post("/customers/merge", {
        survivor_id: c.id,
        merged_id: dup,
        reason: reason.trim(),
      });
      const n = Object.values(r.data.moved).reduce((s, x) => s + x, 0);
      toast.success(
        `${r.data.merged.customer_code} merged · ${n} records moved · money totals unchanged`,
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="merge-dialog">
        <DialogHeader>
          <DialogTitle>Merge a duplicate into {c.customer_code}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-txt-secondary">
          Every booking, payment, bill, document, lead, visit and service request of the duplicate
          moves to <b>{c.full_name}</b>. The duplicate stays read-only, pointing here. No money
          changes.
        </p>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the duplicate by name, phone or code"
          data-testid="merge-search"
        />
        <Select options={opts} value={dup} onChange={setDup} allowAdd={false} testId="merge-pick" />
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          data-testid="merge-reason"
        />
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <WhyDisabled reason={why}>
            <Button
              variant="primary"
              disabled={!!why || busy}
              onClick={go}
              data-testid="merge-submit"
            >
              {busy ? "Merging…" : "Merge into this customer"}
            </Button>
          </WhyDisabled>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerLifecycle({ c, action, onClose, onDone }) {
  if (action === "merge") return <MergeDialog c={c} onClose={onClose} onDone={onDone} />;
  if (action === "deactivate")
    return (
      <ReasonDialog
        title={`Deactivate ${c.full_name}`}
        body="Hidden from active lists; history stays read-only. Blocked while the customer has a live booking."
        cta="Deactivate"
        testId="deactivate-dialog"
        onClose={onClose}
        onSubmit={async (reason) => {
          await api.post(`/customers/${c.id}/deactivate`, { reason });
          toast.success("Customer deactivated");
          onDone();
        }}
      />
    );
  return null;
}

export function reactivate(c, onDone) {
  return api
    .post(`/customers/${c.id}/reactivate`)
    .then(() => {
      toast.success("Customer reactivated");
      onDone();
    })
    .catch((e) => toast.error(errMsg(e)));
}

export function MergedBanner({ c }) {
  if (!c.merged_into && c.is_active !== false) return null;
  return (
    <div
      className="rounded-2xl border border-amber2/40 bg-amber2-50/50 px-5 py-3 text-sm text-ink-950"
      data-testid="customer-inactive-banner"
    >
      {c.merged_into ? (
        <>
          Merged into{" "}
          <Link
            className="font-semibold underline"
            to={`/customers/${c.merged_into}`}
            data-testid="merged-into-link"
          >
            {c.merged_into_code || "the surviving customer"}
          </Link>{" "}
          · read-only · {c.merge_reason}
        </>
      ) : (
        <>Inactive · {c.deactivated_reason}</>
      )}
    </div>
  );
}
