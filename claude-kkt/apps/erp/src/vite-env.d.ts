/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public origin of the API (no trailing slash). Empty = same origin (dev proxy). */
  readonly VITE_API_URL?: string;
}
