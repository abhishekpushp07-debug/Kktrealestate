import type { ReactNode } from "react";
import { clamp, cn } from "@/lib/utils";

export interface ProgressRingProps {
  /** 0–100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  /** Centre content; defaults to "NN%". */
  label?: ReactNode;
  tone?: "navy" | "gold" | "success" | "warning" | "danger";
  className?: string;
  "aria-label"?: string;
}

const STROKES = {
  navy: "stroke-navy-950",
  gold: "stroke-gold",
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
} as const;

export function ProgressRing({ value, size = 64, strokeWidth = 6, label, tone = "navy", className, ...aria }: ProgressRingProps) {
  const pct = clamp(Number.isFinite(value) ? value : 0, 0, 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={aria["aria-label"] ?? "Progress"}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-navy-50" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn("transition-[stroke-dashoffset] duration-500", STROKES[tone])}
        />
      </svg>
      <span className="money absolute inset-0 flex items-center justify-center font-display text-xs font-bold text-navy-950" style={{ fontSize: Math.max(10, size / 4.5) }}>
        {label ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}
