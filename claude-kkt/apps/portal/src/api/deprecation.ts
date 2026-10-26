// Deprecated API operations (docs/VERSIONING.md): every answer of a deprecated route carries `Deprecation: @<unix seconds>`,
// `Sunset: <HTTP-date>` and a `Link` to the docs. Native builds stay on old versions for a while, so the portal shows a non-blocking
// "please update the app" notice the first time a response it relies on is marked deprecated. Pure (no React Native imports).

export interface DeprecationInfo {
  /** API path that answered with the Deprecation header (without the /api/v1/portal prefix). */
  path: string;
  /** When the operation was deprecated (ISO), when known. */
  deprecatedAt: string | null;
  /** When it stops working (ISO), when the server sent Sunset. */
  sunset: string | null;
}

type Listener = (info: DeprecationInfo) => void;

let current: DeprecationInfo | null = null;
const listeners = new Set<Listener>();

/** `@1798761600` (RFC 9745) or an HTTP-date → ISO; null when unreadable. */
export function parseDeprecationDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (/^@\d+$/.test(raw)) return new Date(Number(raw.slice(1)) * 1000).toISOString();
  if (raw.toLowerCase() === "true") return null;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** Called by the API client for every response; remembers the first deprecated operation and tells the listeners once. */
export function noteDeprecation(path: string, headers: { get(name: string): string | null }): void {
  const header = headers.get("Deprecation");
  if (!header || current) return;
  current = { path, deprecatedAt: parseDeprecationDate(header), sunset: parseDeprecationDate(headers.get("Sunset")) };
  for (const listener of listeners) listener(current);
}

export function currentDeprecation(): DeprecationInfo | null {
  return current;
}

export function onDeprecation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper. */
export function resetDeprecation(): void {
  current = null;
}

/** The notice text ("…stops working on 1 Jan 2027"). */
export function deprecationMessage(info: DeprecationInfo): string {
  const when = info.sunset
    ? ` Parts of it stop working after ${new Date(info.sunset).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}.`
    : "";
  return `A newer version of the KKT app is available.${when} Please update the app to keep everything working.`;
}
