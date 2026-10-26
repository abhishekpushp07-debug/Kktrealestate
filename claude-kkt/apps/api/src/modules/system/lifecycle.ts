/**
 * Process lifecycle shared by server.ts and the system routes: once a shutdown starts the process is "draining" — /ready answers 503 so
 * load balancers and Kubernetes stop sending new traffic while in-flight requests finish.
 */
export const lifecycle = {
  draining: false,
  drainingSince: 0,
};

/** Marks this process as draining (idempotent). */
export function startDraining(): void {
  if (lifecycle.draining) return;
  lifecycle.draining = true;
  lifecycle.drainingSince = Date.now();
}

/** Resets the state (tests). */
export function resetLifecycle(): void {
  lifecycle.draining = false;
  lifecycle.drainingSince = 0;
}
