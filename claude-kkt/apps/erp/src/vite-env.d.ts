/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public origin of the API (no trailing slash). Empty = same origin (dev proxy). */
  readonly VITE_API_URL?: string;
  /** Public origin of the marketing website (no trailing slash); enables "view on site" links in the CMS. */
  readonly VITE_WEB_URL?: string;
  /** Public origin of the customer portal (no trailing slash). */
  readonly VITE_PORTAL_URL?: string;
}
