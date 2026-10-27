/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public origin of the API (no trailing slash). Empty = same origin (dev proxy). */
  readonly VITE_API_URL?: string;
  /** Public origin of the marketing website (no trailing slash); enables "view on site" links in the CMS. */
  readonly VITE_WEB_URL?: string;
  /** Public origin of the customer portal (no trailing slash). */
  readonly VITE_PORTAL_URL?: string;
  /** Build / release identifier sent with client error reports (e.g. the git sha). */
  readonly VITE_RELEASE?: string;
  /** Share of distinct client errors reported to POST /client-errors (0..1, default 1). */
  readonly VITE_CLIENT_ERROR_SAMPLE_RATE?: string;
}
