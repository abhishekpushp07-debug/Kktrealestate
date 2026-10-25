import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/* Drop-in replacement for <Input type="date">: same `value` (ISO yyyy-mm-dd) and `onChange(e)` with e.target.value. */
export function DateInput({ value, onChange, min, max, required, className, placeholder = "Pick a date", disabled, ...rest }) {
  const [open, setOpen] = useState(false);
  const d = value ? parseISO(value) : null;
  const valid = d && isValid(d);
  const toDate = (s) => (s ? parseISO(s) : undefined);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={cn("flex h-10 w-full items-center gap-2 rounded-md border border-input bg-white px-3 text-left text-sm text-ink-950 shadow-sm transition-colors hover:border-gold focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50", !valid && "text-txt-secondary", className)} {...rest}>
          <CalendarDays className="h-4 w-4 shrink-0 text-txt-secondary" />
          <span className="min-w-0 flex-1 truncate tabular">{valid ? format(d, "dd MMM yyyy") : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={valid ? d : undefined} defaultMonth={valid ? d : undefined} disabled={(day) => (min && day < toDate(min)) || (max && day > toDate(max))} onSelect={(day) => { onChange?.({ target: { value: day ? format(day, "yyyy-MM-dd") : "" } }); setOpen(false); }} initialFocus />
        {!required && valid && <button type="button" className="w-full border-t px-3 py-2 text-xs text-txt-secondary hover:text-ink-950" onClick={() => { onChange?.({ target: { value: "" } }); setOpen(false); }}>Clear</button>}
      </PopoverContent>
    </Popover>
  );
}
