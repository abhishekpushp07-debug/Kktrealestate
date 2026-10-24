/**
 * Runtime environment access.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` member expressions at build time. Reading through a
 * computed key keeps the value dynamic on the server, so a container can be reconfigured without a
 * rebuild. Client bundles never import this module directly; they receive values via SiteConfig.
 */
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export const DEFAULTS = {
  apiUrl: "http://localhost:4000",
  portalUrl: "http://localhost:8081",
  erpUrl: "http://localhost:5173",
  siteUrl: "http://localhost:3000",
} as const;

/** Browser-facing API origin, e.g. https://erp.example.com */
export function publicApiUrl(): string {
  return stripTrailingSlash(readEnv("NEXT_PUBLIC_API_URL") ?? DEFAULTS.apiUrl);
}

/** API origin used by the Next.js server for data fetching (in-cluster), falling back to the public one. */
export function internalApiUrl(): string {
  return stripTrailingSlash(readEnv("API_INTERNAL_URL") ?? publicApiUrl());
}

export function portalUrl(): string {
  return stripTrailingSlash(readEnv("NEXT_PUBLIC_PORTAL_URL") ?? DEFAULTS.portalUrl);
}

export function erpUrl(): string {
  return stripTrailingSlash(readEnv("NEXT_PUBLIC_ERP_URL") ?? DEFAULTS.erpUrl);
}

export function siteUrl(): string {
  return stripTrailingSlash(readEnv("NEXT_PUBLIC_SITE_URL") ?? DEFAULTS.siteUrl);
}

/** Values safe to ship to the browser. */
export interface SiteConfig {
  apiUrl: string;
  portalUrl: string;
  erpUrl: string;
  siteUrl: string;
}

export function siteConfig(): SiteConfig {
  return { apiUrl: publicApiUrl(), portalUrl: portalUrl(), erpUrl: erpUrl(), siteUrl: siteUrl() };
}
