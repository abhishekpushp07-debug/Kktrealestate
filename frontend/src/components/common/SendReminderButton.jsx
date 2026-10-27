import { useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";

/** "Send reminder now" — same server path as the nightly job; the toast shows the real provider result. */
export function SendReminderButton({ bookingId, testId, className = "btn btn-secondary btn-sm", onDone }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post("/messaging/reminders/send-now", { booking_id: bookingId });
      const m = r.data.message || {};
      const ok = ["sent", "delivered"].includes(r.data.status);
      toast[ok ? "success" : "error"](ok ? `Reminder sent by ${m.channel} to ${m.to} · ${r.data.days_overdue} days overdue` : `Reminder ${String(r.data.status).replace(/_/g, " ")}${m.error ? " · " + m.error : ""}`, { duration: 8000 });
      onDone?.(r.data);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return <button type="button" onClick={go} disabled={busy} className={className} data-testid={testId}><BellRing className="h-3.5 w-3.5" />{busy ? "Sending…" : "Send reminder now"}</button>;
}
