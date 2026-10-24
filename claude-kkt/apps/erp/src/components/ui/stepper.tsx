import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { BREAKPOINTS, cn, useMediaQuery } from "@/lib/utils";

export interface Step {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  /** Mark as invalid (red ring) e.g. a wizard step with errors. */
  error?: boolean;
}

export interface StepperProps {
  steps: readonly Step[];
  /** Index of the current step. */
  current: number;
  /** Indexes already completed (defaults to every index < current). */
  completed?: readonly number[];
  onStepClick?: (index: number) => void;
  /** auto = vertical on md+, compact horizontal on phones. */
  orientation?: "auto" | "vertical" | "horizontal";
  className?: string;
}

/** Wizard stepper with ticks; vertical on desktop, compact horizontal strip on phones. */
export function Stepper({ steps, current, completed, onStepClick, orientation = "auto", className }: StepperProps) {
  const isMobile = useMediaQuery(BREAKPOINTS.mobile);
  const horizontal = orientation === "horizontal" || (orientation === "auto" && isMobile);
  const done = new Set(completed ?? steps.map((_, index) => index).filter((index) => index < current));
  const currentStep = steps[current];

  const circle = (index: number, step: Step) => {
    const isDone = done.has(index) && index !== current;
    const isCurrent = index === current;
    return (
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors",
          isDone && "border-navy-950 bg-navy-950 text-white",
          isCurrent && "border-gold bg-gold text-navy-950 ring-4 ring-gold/25",
          !isDone && !isCurrent && "border-border-strong bg-card text-ink-subtle",
          step.error && "border-danger ring-4 ring-danger/20",
        )}
        aria-hidden="true"
      >
        {isDone ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
      </span>
    );
  };

  if (horizontal) {
    return (
      <div className={cn("rounded-md border border-border bg-card px-3 py-2", className)}>
        <ol className="flex items-center gap-1" aria-label="Steps">
          {steps.map((step, index) => {
            const clickable = Boolean(onStepClick) && (done.has(index) || index === current);
            return (
              <li key={step.id} className="flex min-w-0 flex-1 items-center last:flex-none">
                <button
                  type="button"
                  disabled={!clickable}
                  aria-current={index === current ? "step" : undefined}
                  aria-label={`Step ${index + 1}`}
                  onClick={() => onStepClick?.(index)}
                  className="rounded-full focus-ring disabled:cursor-default"
                >
                  {circle(index, step)}
                </button>
                {index < steps.length - 1 && <span className={cn("mx-1 h-0.5 min-w-2 flex-1 rounded-full", done.has(index) ? "bg-navy-950" : "bg-border")} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Step {current + 1} of {steps.length} · <span className="font-medium text-ink">{currentStep?.label}</span>
        </p>
      </div>
    );
  }

  return (
    <ol className={cn("space-y-0", className)} aria-label="Steps">
      {steps.map((step, index) => {
        const clickable = Boolean(onStepClick) && (done.has(index) || index === current);
        const last = index === steps.length - 1;
        return (
          <li key={step.id} className="relative flex gap-3 pb-6 last:pb-0">
            {!last && <span className={cn("absolute left-3.5 top-8 h-[calc(100%-1.25rem)] w-px", done.has(index) ? "bg-navy-950" : "bg-border")} aria-hidden="true" />}
            <button
              type="button"
              disabled={!clickable}
              aria-current={index === current ? "step" : undefined}
              onClick={() => onStepClick?.(index)}
              className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-ring disabled:cursor-default"
            >
              {circle(index, step)}
              <span className="min-w-0 pt-1">
                <span className={cn("block text-sm font-semibold", index === current ? "text-navy-950" : done.has(index) ? "text-ink" : "text-ink-subtle")}>{step.label}</span>
                {step.description && <span className="block text-xs text-ink-subtle">{step.description}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
