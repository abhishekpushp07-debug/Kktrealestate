// Optimistic concurrency in the portal (contract C6; pure, test/session.test.ts). The portal has no version-REQUIRED endpoint (the
// API exempts customer self-service), but PATCH /portal/profile honours If-Match: the portal sends the loaded profile's `version`
// whenever the response carries one, and a 409 VERSION_CONFLICT reloads the profile and asks the customer to check it again.
import { ApiError } from "./errors";

export const VERSION_CONFLICT_COPY =
  "Your details were changed somewhere else (another device or our team) while you were editing. We have loaded the latest " +
  "version — please check it and save again.";

/** The resource's numeric `version` (PortalProfileResponse carries it since phase 7; tolerant of an older API without it). */
export function profileVersion(resource: object): number | undefined {
  const v = (resource as { version?: unknown }).version;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

export function isVersionConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && e.code === "VERSION_CONFLICT";
}
