import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, Download, Link2, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg, BASE_PATH } from "@/lib/api";

const KINDS = {
  receipt: { title: "Payment Receipt", pdf: ({ id }) => `/payments/${id}/receipt.pdf`, meta: ({ id }) => `/payments/${id}/receipt`, pick: (d) => ({ number: d.payment?.receipt_number, customer: d.customer?.full_name, booking: d.booking?.booking_number }) },
  demand: { title: "Demand Letter", pdf: ({ bookingId, demandId }) => `/bookings/${bookingId}/demands/${demandId}/letter.pdf`, meta: ({ bookingId }) => `/bookings/${bookingId}`, pick: (d) => ({ number: null, customer: d.customer_name, booking: d.booking_number }) },
  statement: { title: "Statement of Account", pdf: ({ bookingId }) => `/bookings/${bookingId}/statement.pdf`, meta: ({ bookingId }) => `/bookings/${bookingId}`, pick: (d) => ({ number: d.booking_number, customer: d.customer_name, booking: d.booking_number }) },
  allotment: { title: "Allotment Letter", pdf: ({ bookingId }) => `/bookings/${bookingId}/allotment.pdf`, meta: ({ bookingId }) => `/bookings/${bookingId}`, pick: (d) => ({ number: d.booking_number, customer: d.customer_name, booking: d.booking_number }) },
};

function filenameFrom(headers, fallback) {
  const m = /filename="?([^";]+)"?/.exec(headers?.["content-disposition"] || "");
  return m ? m[1] : fallback;
}

function statusMessage(e) {
  const s = e?.response?.status;
  if (s === 403) return "You don't have permission to view this document.";
  if (s === 404) return "This document was not found or is outside your project scope.";
  return errMsg(e) || "The document could not be generated.";
}

export default function PrintDocument({ kind }) {
  const params = useParams();
  const cfg = KINDS[kind];
  const [blobUrl, setBlobUrl] = useState(null);
  const [filename, setFilename] = useState(`${kind}.pdf`);
  const [meta, setMeta] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const frame = useRef(null);
  const pdfPath = useMemo(() => cfg.pdf(params), [cfg, params]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, m] = await Promise.all([api.get(pdfPath, { responseType: "blob" }), api.get(cfg.meta(params)).catch(() => null)]);
      setFilename(filenameFrom(r.headers, `${kind}.pdf`));
      if (m?.data) setMeta(cfg.pick(m.data));
      setBlobUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(new Blob([r.data], { type: "application/pdf" })); });
    } catch (e) {
      setError(e);
    } finally { setLoading(false); }
  }, [pdfPath, cfg, params, kind]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);
  useEffect(() => { document.title = `${cfg.title}${meta.number ? ` ${meta.number}` : ""} · KKT`; }, [cfg.title, meta.number]);

  const print = () => {
    const w = frame.current?.contentWindow;
    try { w.focus(); w.print(); } catch { window.open(blobUrl, "_blank"); }
  };
  const download = () => {
    const a = document.createElement("a"); a.href = blobUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  };
  const copyLink = async () => { await navigator.clipboard.writeText(window.location.href); toast.success("Link copied"); };

  return (
    <div className="v2 flex min-h-screen flex-col bg-warm-50 text-ink-950" data-testid="print-document">
      <header className="flex flex-wrap items-center gap-3 border-b border-warm-200 px-4 py-3 md:px-6">
        <button type="button" onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign(`${BASE_PATH}/dashboard`))} className="btn btn-ghost" data-testid="print-action-back"><ArrowLeft className="h-4 w-4" strokeWidth={1.75} />Back</button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gold">KKT · {cfg.title}</p>
          <h1 className="truncate font-display text-xl leading-tight md:text-2xl" data-testid="print-doc-title">{meta.number || cfg.title}{meta.customer && <span className="text-txt-secondary"> · {meta.customer}</span>}{meta.booking && meta.booking !== meta.number && <span className="text-txt-muted"> · {meta.booking}</span>}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={copyLink} className="btn btn-ghost" data-testid="print-action-copy"><Link2 className="h-4 w-4" strokeWidth={1.75} /><span className="hidden sm:inline">Copy link</span></button>
          <button onClick={download} disabled={!blobUrl} className="btn btn-secondary" data-testid="print-action-download"><Download className="h-4 w-4" strokeWidth={1.75} />Download</button>
          <button onClick={print} disabled={!blobUrl} className="btn btn-primary" data-testid="print-action-print"><Printer className="h-4 w-4" strokeWidth={1.75} />Print</button>
        </div>
      </header>
      <main className="relative flex-1 bg-[#1a1d24]">
        {loading && <div className="absolute inset-0 grid place-items-center" data-testid="print-doc-loading"><div className="aspect-[1/1.414] w-[min(92vw,720px)] animate-pulse rounded-sm bg-warm-50/10" /></div>}
        {error && <div className="absolute inset-0 grid place-items-center p-6" data-testid="print-doc-error"><div className="max-w-md rounded-2xl border border-white/10 bg-ink-900 p-6 text-center text-warm-50"><p className="font-display text-lg">Couldn't load the document</p><p className="mt-2 text-sm text-warm-50/60">{statusMessage(error)}</p><button onClick={load} className="btn btn-secondary mt-5" data-testid="print-action-retry"><RefreshCw className="h-4 w-4" strokeWidth={1.75} />Retry</button></div></div>}
        {blobUrl && !error && <iframe ref={frame} title={cfg.title} src={`${blobUrl}#toolbar=0&navpanes=0`} className="block h-[calc(100vh-61px)] w-full border-0" data-testid="print-doc-frame" />}
      </main>
    </div>
  );
}
