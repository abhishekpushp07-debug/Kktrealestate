import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export interface Breadcrumb {
  label: ReactNode;
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: readonly Breadcrumb[];
  actions?: ReactNode;
  /** Back link shown on phones (and as the first breadcrumb on desktop). */
  backTo?: string;
  /** Element rendered right after the title (status chip, badge). */
  titleAddon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, actions, backTo, titleAddon, className, children }: PageHeaderProps) {
  return (
    <header className={cn("mb-4 flex flex-col gap-3", className)}>
      {(breadcrumbs?.length || backTo) && (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-ink-subtle">
          {backTo && (
            <Link to={backTo} className="mr-1 inline-flex min-h-11 items-center gap-1 rounded-xs font-medium text-navy-700 hover:text-navy-950 focus-ring sm:hidden">
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Back
            </Link>
          )}
          <ol className="hidden min-w-0 items-center gap-1 sm:flex">
            {breadcrumbs?.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <li key={index} className="flex min-w-0 items-center gap-1">
                  {crumb.to && !last ? (
                    <Link to={crumb.to} className="truncate rounded-xs hover:text-navy-950 hover:underline focus-ring">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={cn("truncate", last && "text-ink-muted")} aria-current={last ? "page" : undefined}>
                      {crumb.label}
                    </span>
                  )}
                  {!last && <ChevronRight className="size-3 shrink-0" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-extrabold sm:text-2xl">{title}</h1>
            {titleAddon}
          </div>
          {description && <p className="mt-0.5 text-sm text-ink-subtle">{description}</p>}
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
