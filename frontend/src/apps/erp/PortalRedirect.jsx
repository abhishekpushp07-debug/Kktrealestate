import { useEffect, useState } from "react";
import api, { portalHref } from "@/lib/api";

// Reached only when the ERP bundle is served for /portal (not the case in the packaged build, where /portal is the
// exported customer portal). Redirects to Site Settings → portal_url when it points somewhere else; otherwise links to /portal/.
const HERE = `${window.location.origin}/portal`;

export default function PortalRedirect() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    api.get("/public/site").then((r) => setUrl(portalHref(r.data.portal_url))).catch(() => setUrl(portalHref(null)));
  }, []);
  const external = url && !url.replace(/\/$/, "").startsWith(HERE);
  useEffect(() => { if (external) window.location.replace(url); }, [external, url]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8F6F1] px-6 text-center" data-testid="portal-redirect">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-navy text-lg font-extrabold text-gold">K</span>
      <p className="mt-4 text-lg font-bold text-navy">Customer portal</p>
      <p className="mt-1 text-sm text-slate-500">{external ? "Taking you there now…" : "Open the customer portal using the link below."}</p>
      {url && <a href={url} className="mt-4 text-sm font-semibold text-navy underline" data-testid="portal-redirect-link">{url}</a>}
    </div>
  );
}
