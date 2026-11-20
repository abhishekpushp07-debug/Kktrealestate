import { Link } from "react-router-dom";
import { Lock } from "lucide-react";

/** PS.4 — every locked field says why and where to unlock it. */
export function LockHint({ reason, to, linkLabel = "Open", testId = "lock-hint" }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-amber2"
      title={reason}
      data-testid={testId}
    >
      <Lock className="h-3 w-3" />
      {reason}
      {to && (
        <>
          {" "}
          ·{" "}
          <Link to={to} className="underline">
            {linkLabel}
          </Link>
        </>
      )}
    </span>
  );
}
