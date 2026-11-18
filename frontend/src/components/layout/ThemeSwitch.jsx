import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES, useTheme } from "@/lib/theme";

const ICONS = { day: Sun, night: Moon };

/** Exactly "Night" / "Day" (REQ-174) — switching changes no data and no layout width. */
export function ThemeSwitch({ compact = false, className }) {
  const [theme, setTheme] = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex rounded-[10px] border border-warm-200 bg-warm-100 p-0.5",
        className,
      )}
      data-testid="theme-switch"
    >
      {THEMES.map(([id, label]) => {
        const Icon = ICONS[id];
        const on = theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setTheme(id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
              on ? "bg-white text-ink-950 shadow-warm" : "text-txt-secondary hover:text-ink-950",
            )}
            data-testid={`theme-${id}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {!compact && label}
          </button>
        );
      })}
    </div>
  );
}
