import { useSyncExternalStore } from "react";

// Pages name their own URL segment in the breadcrumb (e.g. a report key → its report name).
const labels = {};
const subs = new Set();

export function setCrumbLabel(segment, label) {
  if (!segment || !label || labels[segment] === label) return;
  labels[segment] = label;
  subs.forEach((f) => f());
}

export function useCrumbLabels() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => JSON.stringify(labels),
  );
}

export const crumbLabel = (segment) => labels[segment];
