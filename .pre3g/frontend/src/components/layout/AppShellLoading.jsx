/** Route skeleton: shown while a lazy page chunk loads — never a blank screen. */
export function PageSkeleton() {
  return (
    <div className="space-y-6" data-testid="page-skeleton" aria-busy="true" aria-label="Loading">
      <div className="skel h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel h-24" />
        ))}
      </div>
      <div className="skel h-72" />
    </div>
  );
}

export default function AppShellLoading() {
  return (
    <div className="v2 flex min-h-screen bg-warm-50" data-testid="app-loading">
      <div className="hidden w-[260px] shrink-0 border-r border-warm-200 bg-[var(--sidebar)] md:block" />
      <div className="flex-1 p-4 md:p-8">
        <div className="skel mb-8 h-10 w-full max-w-md" />
        <PageSkeleton />
      </div>
    </div>
  );
}
