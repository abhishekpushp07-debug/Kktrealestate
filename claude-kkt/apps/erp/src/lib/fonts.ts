/**
 * Applies the web-font stylesheet that index.html only preloads (audit v3 C9: the Google Fonts stylesheet was render-blocking on
 * every page). Turning the preload into a stylesheet from a module script keeps the CSP's `script-src 'self'` (no inline onload
 * handler) and lets the shell paint with the system font first; `display=swap` then swaps the faces in.
 */
export function applyPreloadedFonts(doc: Document = document): boolean {
  const preload = doc.getElementById("kkt-fonts");
  if (!(preload instanceof HTMLLinkElement) || preload.rel === "stylesheet") return false;
  const sheet = doc.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = preload.href;
  doc.head.appendChild(sheet);
  return true;
}
