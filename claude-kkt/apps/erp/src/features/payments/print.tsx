import { ArrowLeft, Download, Printer } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/layout/BrandMark";
import { downloadPdf } from "@/features/bookings/api";

/** A4 print rules shared by every print route (receipt, demand letter). */
export const PRINT_PAGE_CSS = `
@page { size: A4; margin: 14mm 14mm 16mm; }
@media print {
  html, body { background: #fff !important; }
  .kkt-print-toolbar { display: none !important; }
  .kkt-print-sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; padding: 0 !important; max-width: none !important; width: auto !important; }
  a { color: inherit !important; text-decoration: none !important; }
}
@media screen {
  .kkt-print-sheet { min-height: 29.7cm; }
}
`;

export interface CompanyBlock {
  name: string;
  legal_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
}

/** Letterhead: brand mark, legal name, address, contacts, GSTIN. */
export function Letterhead({ company, title, subtitle }: { company: CompanyBlock; title: string; subtitle?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-navy-950 pb-4">
      <div className="flex min-w-0 items-start gap-3">
        <BrandMark withText={false} />
        <div className="min-w-0">
          <p className="font-display text-xl font-extrabold leading-6 text-navy-950">{company.name}</p>
          {company.legal_name && company.legal_name !== company.name && <p className="text-xs text-ink-muted">{company.legal_name}</p>}
          {company.address && <p className="mt-1 max-w-sm text-xs leading-4 text-ink-muted">{company.address}</p>}
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-muted">
            {company.phone && <span>{company.phone}</span>}
            {company.email && <span>{company.email}</span>}
            {company.gstin && <span className="money">GSTIN {company.gstin}</span>}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-display text-2xl font-extrabold uppercase tracking-wide text-gold-text">{title}</p>
        {subtitle && <div className="mt-1 text-xs text-ink-muted">{subtitle}</div>}
      </div>
    </header>
  );
}

export interface PrintFrameProps {
  /** Document title for the browser tab / PDF name. */
  title: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** `GET` path of the server-rendered PDF, when one exists. */
  pdfPath?: string;
  pdfFileName?: string;
  backTo?: string;
  backLabel?: string;
  /** Print as soon as the content has rendered when `?autoprint=1` is on the URL. */
  autoPrintReady?: boolean;
  children: ReactNode;
  className?: string;
}

/** Full-page print layout outside the app shell: toolbar (screen only) + white A4 sheet. */
export function PrintFrame({ title, loading = false, error, onRetry, pdfPath, pdfFileName, backTo, backLabel = "Back", autoPrintReady = false, children, className }: PrintFrameProps) {
  const [params] = useSearchParams();
  const { status } = useAuth();
  const printed = useRef(false);
  const autoprint = params.get("autoprint") === "1";

  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  useEffect(() => {
    if (!autoprint || printed.current || !autoPrintReady || loading || error) return;
    printed.current = true;
    const handle = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(handle);
  }, [autoprint, autoPrintReady, loading, error]);

  const savePdf = async () => {
    if (!pdfPath) return;
    try {
      await downloadPdf(pdfPath, pdfFileName ?? `${title}.pdf`);
    } catch (cause) {
      toast.error(describeError(cause));
    }
  };

  return (
    <div className="min-h-dvh bg-surface text-ink">
      <style>{PRINT_PAGE_CSS}</style>
      <div className="kkt-print-toolbar sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-[21cm] flex-wrap items-center gap-2 px-4 py-2">
          {backTo && (
            <Button asChild variant="ghost" size="sm" leftIcon={ArrowLeft}>
              <Link to={backTo}>{backLabel}</Link>
            </Button>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-950">{title}</span>
          {pdfPath && (
            <Button variant="outline" size="sm" leftIcon={Download} onClick={() => void savePdf()} disabled={loading || Boolean(error) || status !== "authenticated"} data-testid="print-download-pdf">
              PDF
            </Button>
          )}
          <Button size="sm" leftIcon={Printer} onClick={() => window.print()} disabled={loading || Boolean(error)} data-testid="print-now">
            Print
          </Button>
        </div>
      </div>
      <main className={cn("kkt-print-sheet mx-auto my-4 w-[calc(100vw-2rem)] max-w-[21cm] rounded-lg border border-border bg-white p-6 shadow-card sm:p-10", className)}>
        {loading && (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-16" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-40" />
          </div>
        )}
        {!loading && error ? <ErrorState error={error} onRetry={onRetry} /> : null}
        {!loading && !error && children}
      </main>
    </div>
  );
}

/** Two-column "label: value" grid used by both documents. */
export function PrintFacts({ items, columns = 2 }: { items: ReadonlyArray<{ label: string; value: ReactNode }>; columns?: 2 | 3 }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-2 text-sm", columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-3 border-b border-dotted border-border pb-1">
          <dt className="shrink-0 text-xs text-ink-muted">{item.label}</dt>
          <dd className="money min-w-0 text-right font-medium text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Signature block at the bottom of a document. */
export function SignatureBlock({ name, title, forCompany }: { name: string | null | undefined; title: string | null | undefined; forCompany: string }) {
  return (
    <div className="mt-12 flex items-end justify-between gap-6 text-xs">
      <p className="max-w-xs text-ink-subtle">This is a computer-generated document. Figures are in Indian Rupees; amounts in paise are rounded to the nearest rupee only for display.</p>
      <div className="text-right">
        <p className="mb-10 text-ink-muted">For {forCompany}</p>
        <p className="border-t border-navy-950 pt-1 font-semibold text-navy-950">{name ?? "Authorised Signatory"}</p>
        {title && <p className="text-ink-muted">{title}</p>}
      </div>
    </div>
  );
}
