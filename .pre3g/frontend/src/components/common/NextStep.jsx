import { ArrowRight, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

function NextStepCard({ t, title, actions }) {
  const nav = useNavigate();
  const go = (a) => {
    toast.dismiss(t);
    if (a.onClick) a.onClick();
    else if (a.newTab) window.open(a.to, "_blank", "noopener");
    else nav(a.to);
  };
  return (
    <div
      className="w-[min(92vw,360px)] rounded-2xl border border-warm-200 bg-surface p-4 shadow-lg"
      role="status"
      data-testid="next-step"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-950">
          <Sparkles className="h-4 w-4 shrink-0 text-gold" />
          {title}
        </p>
        <button
          type="button"
          onClick={() => toast.dismiss(t)}
          className="rounded-md p-1 text-txt-muted hover:text-ink-950"
          aria-label="Dismiss"
          data-testid="next-step-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-txt-secondary">Next step</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((a, i) => (
          <button
            key={a.label}
            type="button"
            onClick={() => go(a)}
            className={i === 0 ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            data-testid={`next-step-${slug(a.label)}`}
          >
            {a.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** REQ-138…143: after a save, one dismissible, non-blocking prompt that opens the existing flow with the record picked. */
export function showNextStep({ title, actions }) {
  if (!actions?.length) return;
  toast.custom((t) => <NextStepCard t={t} title={title} actions={actions} />, {
    duration: 15000,
    id: `next-${slug(title)}`,
  });
}
