import { toast } from "sonner";
import { errMsg } from "@/lib/api";

/* Success toast with an Undo action. `onUndo` must perform (and await) the reverting API call; we report "Reverted" or the error. */
export function undoToast({ title, description, onUndo, testId }) {
  let busy = false;
  return toast.success(title, {
    description,
    duration: 10000,
    action: {
      label: "Undo",
      onClick: async (e) => {
        e?.preventDefault?.();
        if (busy) return;
        busy = true;
        try { const msg = await onUndo(); toast.success(msg || "Reverted"); }
        catch (err) { toast.error(errMsg(err, "Undo failed")); }
        finally { busy = false; }
      },
    },
    ...(testId ? { id: testId } : {}),
  });
}
