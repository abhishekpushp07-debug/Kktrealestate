import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Row actions in one icon menu. items: {label, icon, onClick | href, testId, danger, show}. Hidden when nothing to show. */
export function RowMenu({ items, testId, label = "Row actions" }) {
  const list = items.filter((i) => i.show !== false);
  if (!list.length) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="btn btn-ghost btn-sm !px-2"
          aria-label={label}
          title={label}
          data-testid={testId}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {list.map(({ label: l, icon: Icon, onClick, href, testId: t, danger }) => (
          <DropdownMenuItem
            key={l}
            asChild={!!href}
            onSelect={href ? undefined : onClick}
            className={cn("gap-2", danger && "text-brick focus:text-brick")}
            data-testid={href ? undefined : t}
          >
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" data-testid={t}>
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {l}
              </a>
            ) : (
              <>
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {l}
              </>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
