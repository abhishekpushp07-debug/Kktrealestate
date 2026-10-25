import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, MapPin, MessageCircle, Check, ChevronLeft } from "lucide-react";
import api, { errMsg, BACKEND } from "./lib/api";
import { useSite, usePublic } from "./SiteShell";
import { VisitorFields, Consent, getVisitor, saveVisitor } from "./LeadGate";

const fmtDay = (iso) => { const d = new Date(`${iso}T00:00:00`); return { dow: d.toLocaleDateString("en-IN", { weekday: "short" }), day: d.getDate(), mon: d.toLocaleDateString("en-IN", { month: "short" }) }; };
export const fmtLong = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function VisitSuccess({ v, projectName }) {
  const { site } = useSite();
  return <div data-testid="visit-success"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-6 w-6" /></span>
    <p className="eyebrow mt-5">Visit confirmed · {v.visit_number}</p><h3 className="display mt-2 text-3xl text-navy" data-testid="visit-number">{fmtLong(v.date)}</h3><p className="mt-1 text-lg font-semibold text-navy">{v.slot} IST · {projectName || v.project}</p>
    {v.address && <p className="mt-4 flex items-start gap-2 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" /><span>{v.address}{v.maps_url && <> · <a href={v.maps_url} target="_blank" rel="noreferrer" className="font-semibold text-navy underline" data-testid="visit-maps">Open in Maps</a></>}</span></p>}
    {v.instructions && <p className="mt-2 text-xs text-slate-500">{v.instructions}</p>}
    <div className="mt-6 flex flex-wrap gap-3"><a href={`${BACKEND}${v.ics_url}`} className="btn-gold" data-testid="visit-ics"><CalendarPlus className="h-4 w-4" />Add to calendar</a><a href={`https://wa.me/${(site?.whatsapp || "").replace(/\D/g, "")}?text=${encodeURIComponent(`Hi, I booked site visit ${v.visit_number} on ${v.date} at ${v.slot_start}.`)}`} target="_blank" rel="noreferrer" className="btn-navy" data-testid="visit-whatsapp"><MessageCircle className="h-4 w-4" />WhatsApp RM</a></div>
    <Link to={v.manage_url} className="mt-5 inline-block text-sm font-semibold text-navy underline" data-testid="visit-manage">Manage this visit</Link>
  </div>;
}

export function VisitBooking({ projectSlug: initialSlug = "", compact = false, onDone }) {
  const { data: projects } = usePublic("/projects");
  const [slug, setSlug] = useState(initialSlug);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState(null);
  const vis = getVisitor();
  const [f, setF] = useState({ name: vis?.name || "", phone: vis?.phone || "", email: vis?.email || "", visitors_count: 1, message: "", consent: !!vis, website: "" });
  const [state, setState] = useState({ busy: false, err: null, done: null });
  const { data: avail, loading } = usePublic(slug ? `/site-visits/availability?project_slug=${slug}` : null, [slug]);
  const days = useMemo(() => (avail?.days || []).slice(0, 14), [avail]);
  useEffect(() => { setDate(""); setSlot(null); }, [slug]);
  useEffect(() => { if (!date && days.length) { const first = days.find((d) => d.slots.length); if (first) setDate(first.date); } }, [days, date]);
  const day = days.find((d) => d.date === date);
  const phoneOk = /^[6-9]\d{9}$/.test(f.phone);
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, err: null, done: null });
    try {
      const r = await api.post("/public/site-visits", { project_slug: slug, date, slot_start: slot, name: f.name, phone: f.phone, email: f.email || null, visitors_count: Number(f.visitors_count), message: f.message || null, consent: f.consent, website: f.website || null });
      saveVisitor(f); setState({ busy: false, err: null, done: r.data }); onDone?.(r.data);
    } catch (err) { setState({ busy: false, err: errMsg(err, "Could not book this slot"), done: null }); }
  };
  if (state.done) return <VisitSuccess v={state.done} />;
  const sel = "h-12 w-full appearance-none rounded-xl border border-navy/15 bg-white px-4 text-sm font-semibold text-navy outline-none focus:border-gold";
  return <form onSubmit={submit} className="min-w-0 space-y-6" data-testid="visit-booking">
    <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">1 · Project</p><select className={sel} value={slug} onChange={(e) => setSlug(e.target.value)} required aria-label="Project" data-testid="visit-project"><option value="">Choose a project</option>{(projects?.items || []).map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select>{avail && !avail.project.enabled && <p className="mt-2 text-sm text-red-700">Site visits are not open for this project yet — please request a call back.</p>}</div>
    {slug && <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">2 · Date</p>{loading && !avail ? <div className="h-20 animate-pulse rounded-xl bg-white" /> : <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]" role="radiogroup" aria-label="Date" data-testid="visit-dates">{days.map((d) => { const x = fmtDay(d.date); const off = !d.slots.length; return <button type="button" key={d.date} role="radio" aria-checked={date === d.date} disabled={off} onClick={() => { setDate(d.date); setSlot(null); }} className={`flex h-[72px] w-14 shrink-0 flex-col items-center justify-center rounded-2xl border text-xs transition-colors ${date === d.date ? "border-navy bg-navy text-white" : off ? "cursor-not-allowed border-slate-200 bg-white text-slate-300" : "border-navy/15 bg-white text-navy hover:border-gold"}`} data-testid={`visit-date-${d.date}`}><span className="uppercase">{x.dow}</span><span className="display text-xl leading-none">{x.day}</span><span>{x.mon}</span></button>; })}</div>}</div>}
    {day && <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">3 · Time slot (IST)</p><div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Slot" data-testid="visit-slots">{day.slots.map((s) => <button type="button" key={s.start} role="radio" aria-checked={slot === s.start} onClick={() => setSlot(s.start)} className={`relative h-12 rounded-full border px-5 text-sm font-semibold transition-colors ${slot === s.start ? "border-gold bg-gold text-navy" : "border-navy/15 bg-white text-navy hover:border-gold"}`} data-testid={`visit-slot-${s.start}`}>{s.start} – {s.end}{s.available_count <= 2 && <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{s.available_count} left</span>}</button>)}</div></div>}
    {slot && <div className="space-y-3"><p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">4 · Your details</p><div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}><VisitorFields f={f} setF={setF} /><div className="field"><select id="lg-visitors" value={f.visitors_count} onChange={(e) => setF({ ...f, visitors_count: e.target.value })} data-testid="visit-visitors">{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? "visitor" : "visitors"}</option>)}</select><label htmlFor="lg-visitors">Visitors</label></div><div className={`field ${compact ? "" : "sm:col-span-2"}`}><textarea id="lg-message" rows={2} placeholder=" " value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} data-testid="visit-message" /><label htmlFor="lg-message">Anything we should know? (optional)</label></div></div><input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} className="hidden" aria-hidden="true" /><Consent f={f} setF={setF} />{state.err && <p className="text-sm font-semibold text-red-700" data-testid="visit-error">{state.err}</p>}
      <button type="submit" disabled={state.busy || !f.consent || !phoneOk || f.name.length < 2} className="btn-gold w-full disabled:opacity-60 sm:w-auto" data-testid="visit-submit">{state.busy ? "Booking…" : `Confirm visit · ${fmtDay(date).day} ${fmtDay(date).mon}, ${slot}`}</button></div>}
  </form>;
}

export default function VisitPage() {
  const token = window.location.pathname.split("/visit/")[1];
  const [v, setV] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/public/site-visits/${token}`).then((r) => setV(r.data)).catch((e) => setErr(errMsg(e, "Visit not found"))); }, [token]);
  const cancel = async () => { if (!window.confirm("Cancel this site visit?")) return; setBusy(true); try { const r = await api.post(`/public/site-visits/${token}/cancel`, {}); setV(r.data); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return <section className="bg-ivory pb-24 pt-32 lg:pt-40"><div className="container-site max-w-2xl"><Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm font-semibold text-navy"><ChevronLeft className="h-4 w-4" />Home</Link>
    {err ? <div className="card-lux bg-white p-8" data-testid="visit-error"><h1 className="display text-3xl text-navy">Link not valid</h1><p className="mt-2 text-slate-600">{err}</p></div> : !v ? <div className="h-40 animate-pulse rounded-3xl bg-white" /> : <div className="card-lux bg-white p-6 sm:p-10" data-testid="visit-page"><h1 className="sr-only">Site visit {v.visit_number}</h1>{v.status === "Cancelled" ? <div><p className="eyebrow">Cancelled</p><h2 className="display mt-2 text-3xl text-navy">This visit was cancelled</h2><p className="mt-2 text-slate-600">{v.visit_number} · {fmtLong(v.date)} · {v.slot}. You can <Link to="/contact" className="font-semibold text-navy underline">book another</Link> any time.</p></div> : <><VisitSuccess v={v} /><button onClick={cancel} disabled={busy} className="mt-8 text-sm font-semibold text-red-700 underline" data-testid="visit-cancel">Cancel this visit</button></>}</div>}
  </div></section>;
}
