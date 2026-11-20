/** REQ-216: a greyed-out control says why — tooltip on desktop, a line under it on phones. */
export function WhyDisabled({ reason, children, className, testId }) {
  if (!reason) return children;
  return (
    <span className={className} title={reason} data-testid={testId}>
      <span className="pointer-events-none block">{children}</span>
      <span className="mt-1 block text-xs text-txt-muted md:sr-only">{reason}</span>
    </span>
  );
}
