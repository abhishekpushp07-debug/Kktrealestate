import { CalendarDays } from "lucide-react";
import type { ChangeEvent } from "react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";

export interface DateInputProps extends Omit<InputProps, "value" | "onChange" | "type" | "min" | "max" | "defaultValue"> {
  /** Business date YYYY-MM-DD (null = empty). */
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  min?: string;
  max?: string;
  /** Render "24 Oct 2026" under the field (default false). */
  showDisplay?: boolean;
}

/** Native date picker bound to a YYYY-MM-DD string. */
export function DateInput({ value, onChange, min, max, showDisplay = false, className, ...props }: DateInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value ? event.target.value : null);
  };
  return (
    <div className="w-full min-w-0">
      <Input
        {...props}
        type="date"
        value={value ?? ""}
        min={min}
        max={max}
        leftIcon={CalendarDays}
        className={cn("money", className)}
        onChange={handleChange}
      />
      {showDisplay && value && <p className="mt-1 text-xs text-ink-subtle">{formatDate(value)}</p>}
    </div>
  );
}

/** "2026-10-24" → "24 Oct 2026" (re-exported for forms that show a read-only date). */
export const formatDateDisplay = formatDate;
