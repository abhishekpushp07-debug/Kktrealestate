import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X, Download, MessageCircle, Check } from "lucide-react";
import api, { errMsg, BACKEND } from "./lib/api";
import { useSite, Img } from "./SiteShell";

const KEY = "sgb_visitor";
export const getVisitor = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
export const saveVisitor = (v) => localStorage.setItem(KEY, JSON.stringify({ name: v.name, phone: v.phone, email: v.email || "" }));
const utm = () => Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([k]) => k.startsWith("utm_")));

export function Modal({ open, onClose, children, label, testId }) {
  const ref = useRef(null);
  useEffect(() => { if (!open) return; const h = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); document.body.style.overflow = "hidden"; ref.current?.querySelector("input,button")?.focus(); return () => { window.removeEventListener("keydown", h); document.body.style.overflow = ""; }; }, [open, onClose]);
  if (!open) return null;
  return createPortal(<div className="site fixed inset-0 z-[70] flex items-end justify-center bg-navy-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose} data-testid={testId}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()} className="fade-up relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-ivory shadow-2xl sm:max-w-lg sm:rounded-3xl">
      <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/80 text-navy hover:bg-white" data-testid="modal-close"><X className="h-5 w-5" /></button>
      {children}
    </div>
  </div>, document.body);
}

export function VisitorFields({ f, setF, withEmail = true }) {
  const phoneBad = f.phone && !/^[6-9]\d{9}$/.test(f.phone);
  return <>
    <div className="field"><input id="lg-name" placeholder=" " required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="lg-name" /><label htmlFor="lg-name">Full name *</label></div>
    <div className="field"><input id="lg-phone" placeholder=" " required inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} aria-invalid={!!phoneBad} data-testid="lg-phone" /><label htmlFor="lg-phone">Mobile (10 digits) *</label>{phoneBad && <p className="mt-1 text-xs font-semibold text-red-700" data-testid="lg-phone-error">Enter a valid 10-digit Indian mobile number</p>}</div>
    {withEmail && <div className="field"><input id="lg-email" type="email" placeholder=" " value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="lg-email" /><label htmlFor="lg-email">Email (optional)</label></div>}
  </>;
}

export const Consent = ({ f, setF }) => <label className="flex items-start gap-2.5 text-xs text-slate-600"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="check mt-0.5" data-testid="lg-consent" /><span>I agree to be contacted about this project and accept the <Link to="/privacy" className="underline" target="_blank">privacy policy</Link>.</span></label>;

export function BrochureModal({ project, open, onClose }) {
  const { site } = useSite();
  const v = getVisitor();
  const [f, setF] = useState({ name: v?.name || "", phone: v?.phone || "", email: v?.email || "", consent: !!v, website: "" });
  const [state, setState] = useState({ busy: false, url: null, err: null });
  const phoneOk = /^[6-9]\d{9}$/.test(f.phone);
  const request = async (e) => {
    e?.preventDefault();
    setState({ busy: true, url: null, err: null });
    try {
      const r = await api.post("/public/brochure-requests", { project_slug: project.slug, name: f.name, phone: f.phone, email: f.email || null, consent: f.consent, utm: utm(), website: f.website || null });
      saveVisitor(f);
      const url = `${BACKEND}${r.data.download_url}`;
      setState({ busy: false, url, err: null });
      const a = document.createElement("a"); a.href = url; a.download = ""; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { setState({ busy: false, url: null, err: errMsg(err, "Could not prepare the brochure") }); }
  };
  useEffect(() => { if (open && v && !state.url && !state.busy) request(); }, [open]); // eslint-disable-line
  return <Modal open={open} onClose={onClose} label="Download brochure" testId="brochure-modal">
    <div className="relative aspect-[16/7] overflow-hidden rounded-t-3xl">{project.cover && <Img src={project.cover} alt="" className="h-full w-full object-cover" sizes="520px" />}<div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/30 to-transparent" /><div className="absolute bottom-4 left-6 text-white"><p className="eyebrow">Brochure</p><p className="display text-2xl">{project.name}</p></div></div>
    <div className="p-6 sm:p-8">
      {state.url ? <div data-testid="brochure-success"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-6 w-6" /></span><h3 className="display mt-4 text-3xl text-navy">Your brochure is ready</h3><p className="mt-2 text-sm text-slate-600">If the download didn't start, use the button below. A relationship manager will reach out shortly.</p><div className="mt-6 flex flex-wrap gap-3"><a href={state.url} download className="btn-gold" data-testid="brochure-download"><Download className="h-4 w-4" />Download PDF</a><a href={`https://wa.me/${(site?.whatsapp || "").replace(/\D/g, "")}?text=${encodeURIComponent(`Hi, I downloaded the ${project.name} brochure. Please share more details.`)}`} target="_blank" rel="noreferrer" className="btn-navy" data-testid="brochure-whatsapp"><MessageCircle className="h-4 w-4" />WhatsApp us</a></div></div>
        : <form onSubmit={request} className="grid gap-3" data-testid="brochure-form"><h3 className="display text-3xl text-navy">Get the brochure</h3><p className="-mt-1 text-sm text-slate-600">Floor plans, specifications and payment plan — in your inbox and on your phone.</p><VisitorFields f={f} setF={setF} /><input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} className="hidden" aria-hidden="true" /><Consent f={f} setF={setF} />{state.err && <p className="text-sm font-semibold text-red-700" data-testid="brochure-error">{state.err}</p>}<button type="submit" disabled={state.busy || !f.consent || !phoneOk || f.name.length < 2} className="btn-gold mt-2 w-full disabled:opacity-60" data-testid="brochure-submit">{state.busy ? "Preparing…" : <><Download className="h-4 w-4" />Get the brochure</>}</button></form>}
    </div>
  </Modal>;
}
