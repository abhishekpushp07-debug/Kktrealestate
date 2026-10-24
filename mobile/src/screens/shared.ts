import { useState } from "react";

import { openFile } from "@/src/api/pdf";
import { errMsg } from "@/src/api/client";
import { haptic } from "@/src/haptics";
import { toast } from "@/src/ui/toast";

// Tracks which file is downloading so its button can show a spinner.
export function usePdf() {
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (path: string, name: string, mime?: string) => {
    if (busy) return;
    setBusy(path);
    try {
      await openFile(path, name, mime);
      haptic.success();
    } catch (e) {
      haptic.error();
      toast.error(errMsg(e, "Could not open the file"));
    } finally {
      setBusy(null);
    }
  };
  return { busy, open };
}

type Tone = "neutral" | "success" | "warning" | "error" | "info" | "gold";
export const statusTone = (s?: string): Tone =>
  (({
    Cleared: "success",
    Paid: "success",
    Completed: "success",
    Resolved: "success",
    Pending: "warning",
    Open: "warning",
    "In Progress": "warning",
    Overdue: "error",
    Bounced: "error",
    Cancelled: "error",
    Reversed: "neutral",
    Closed: "neutral",
    "Partially Paid": "info",
    "Partially paid": "info",
    Raised: "gold",
    "Not yet due": "neutral",
    New: "info",
    "Awaiting Customer": "gold",
  }) as Record<string, Tone>)[s || ""] || "neutral";
