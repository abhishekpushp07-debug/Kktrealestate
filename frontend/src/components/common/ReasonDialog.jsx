import { useState } from "react";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Ask for a typed reason (min 3 chars) before an undo / restore / deactivate; `onSubmit(reason)` does the call. */
export function ReasonDialog({
  title,
  body,
  cta = "Confirm",
  onSubmit,
  onClose,
  testId = "reason-dialog",
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const short = reason.trim().length < 3;
  const go = async () => {
    setBusy(true);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body && <DialogDescription>{body}</DialogDescription>}
        </DialogHeader>
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (at least 3 characters)"
          data-testid={`${testId}-reason`}
        />
        <div className="flex items-center justify-end gap-2">
          {short && (
            <span className="mr-auto text-xs text-txt-muted">Type a reason to continue</span>
          )}
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            why={short ? "Type a reason (3+ letters)" : undefined}
            disabled={short || busy}
            onClick={go}
            data-testid={`${testId}-submit`}
          >
            {busy ? "Saving…" : cta}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
