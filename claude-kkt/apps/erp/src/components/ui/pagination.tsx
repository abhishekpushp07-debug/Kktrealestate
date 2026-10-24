import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IconButton } from "./button";
import { Select } from "./select";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
  disabled?: boolean;
}

const DEFAULT_SIZES = [25, 50, 100, 200] as const;

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_SIZES,
  className,
  disabled = false,
}: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const sizes = pageSizeOptions.includes(pageSize) ? pageSizeOptions : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted", className)}>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <>
            <span className="hidden sm:inline">Rows</span>
            <Select
              aria-label="Rows per page"
              size="sm"
              className="w-20"
              value={String(pageSize)}
              onValueChange={(value) => value && onPageSizeChange(Number(value))}
              options={sizes.map((size) => ({ value: String(size), label: String(size) }))}
              disabled={disabled}
            />
          </>
        )}
        <span className="money">
          {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {formatNumber(total)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronsLeft} label="First page" size="sm" variant="outline" disabled={disabled || current <= 1} onClick={() => onPageChange(1)} className="hidden sm:inline-flex" />
        <IconButton icon={ChevronLeft} label="Previous page" size="sm" variant="outline" disabled={disabled || current <= 1} onClick={() => onPageChange(current - 1)} />
        <span className="money min-w-16 px-1 text-center">
          Page {current} / {pages}
        </span>
        <IconButton icon={ChevronRight} label="Next page" size="sm" variant="outline" disabled={disabled || current >= pages} onClick={() => onPageChange(current + 1)} />
        <IconButton icon={ChevronsRight} label="Last page" size="sm" variant="outline" disabled={disabled || current >= pages} onClick={() => onPageChange(pages)} className="hidden sm:inline-flex" />
      </div>
    </nav>
  );
}
