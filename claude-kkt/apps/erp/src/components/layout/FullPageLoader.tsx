import { BrandMark } from "@/components/layout/BrandMark";
import { Spinner } from "@/components/ui/spinner";

/** Centered brand + spinner used while the session is being restored or a page chunk loads. */
export function FullPageLoader({ label = "Loading KKT ERP" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface" role="status" aria-live="polite">
      <BrandMark size="lg" />
      <Spinner size="md" label={label} className="text-navy-700" />
    </div>
  );
}
