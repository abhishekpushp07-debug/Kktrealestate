import { useEffect, useState } from "react";
import api from "@/lib/api";

const FALLBACK = process.env.REACT_APP_PORTAL_URL || "";

export default function PortalRedirect() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    api.get("/public/site").then((r) => setUrl(r.data.portal_url || FALLBACK)).catch(() => setUrl(FALLBACK));
  }, []);
  useEffect(() => { if (url) window.location.replace(url); }, [url]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8F6F1] px-6 text-center" data-testid="portal-redirect">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-navy text-lg font-extrabold text-gold">K</span>
      <p className="mt-4 text-lg font-bold text-navy">The customer portal has moved</p>
      <p className="mt-1 text-sm text-slate-500">Taking you there now…</p>
      {url && <a href={url} className="mt-4 text-sm font-semibold text-navy underline" data-testid="portal-redirect-link">{url}</a>}
      {url === "" && <p className="mt-2 text-sm text-red-600">Portal link is not configured. Please contact your Relationship Manager.</p>}
    </div>
  );
}
