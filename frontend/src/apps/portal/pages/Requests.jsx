import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, LifeBuoy, Paperclip, Plus, Star } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Empty, PageTitle, Skeleton, useBase } from "../PortalShell";
import { fmtDateTime, useBookings } from "../hooks";
import papi, { perr } from "../api";

const tone = (s) => ({ New: "bg-blue-50 text-blue-700", "In Progress": "bg-amber-50 text-amber-700", "Awaiting Customer": "bg-[#FFF9E6] text-[#8a6d12]", Resolved: "bg-emerald-50 text-emerald-700", Closed: "bg-slate-100 text-slate-600" }[s] || "bg-slate-100");

function NewRequest({ onDone }) {
  const { data: bookings } = useBookings();
  const { data: cats } = useQuery({ queryKey: ["p-cats"], queryFn: () => papi.get("/service-categories").then((r) => r.data.items) });
  const [f, setF] = useState({ booking_id: "", category: "", priority: "Medium", subject: "", description: "" });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const fd = new FormData();
    Object.entries({ ...f, booking_id: f.booking_id || bookings?.[0]?.id, category: f.category || cats?.[0]?.name }).forEach(([k, v]) => fd.append(k, v));
    files.forEach((x) => fd.append("files", x));
    try { const { data } = await papi.post("/service-requests", fd); toast.success(`Ticket ${data.ticket_number} raised`); onDone(data); } catch (err) { toast.error(perr(err)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="pcard space-y-4 p-5 fade-up" data-testid="new-request-form">
      <p className="font-bold text-[#0B1F3A]">Raise a request</p>
      {bookings?.length > 1 && <div><label className="plabel">Booking</label><select className="pinput" value={f.booking_id || bookings[0].id} onChange={(e) => setF({ ...f, booking_id: e.target.value })} data-testid="nr-booking">{bookings.map((b) => <option key={b.id} value={b.id}>{b.flat_number} · {b.project_name}</option>)}</select></div>}
      <div className="grid gap-4 sm:grid-cols-2"><div><label className="plabel">Category</label><select className="pinput" value={f.category || cats?.[0]?.name || ""} onChange={(e) => setF({ ...f, category: e.target.value })} data-testid="nr-category">{(cats || []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></div><div><label className="plabel">Priority</label><select className="pinput" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} data-testid="nr-priority">{["Low", "Medium", "High"].map((p) => <option key={p}>{p}</option>)}</select></div></div>
      <div><label className="plabel">Subject</label><input className="pinput" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required minLength={3} maxLength={120} data-testid="nr-subject" /></div>
      <div><label className="plabel">Describe the issue</label><textarea className="pinput" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required minLength={3} data-testid="nr-description" /></div>
      <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-[rgba(11,31,58,0.2)] px-4 text-sm text-slate-600"><Paperclip className="h-4 w-4" />{files.length ? `${files.length} file(s) attached` : "Attach photos or PDF (optional)"}<input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => setFiles([...e.target.files])} data-testid="nr-files" /></label>
      <button className="pbtn w-full" disabled={busy} data-testid="nr-submit">{busy ? "Submitting…" : "Submit request"}</button>
    </form>
  );
}

function Detail({ id }) {
  const base = useBase();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: sr, isLoading } = useQuery({ queryKey: ["p-request", id], queryFn: () => papi.get(`/service-requests/${id}`).then((r) => r.data) });
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const inval = () => { qc.invalidateQueries({ queryKey: ["p-request", id] }); qc.invalidateQueries({ queryKey: ["p-requests"] }); };
  const act = async (fn) => { setBusy(true); try { await fn(); inval(); setMsg(""); setFiles([]); } catch (e) { toast.error(perr(e)); } finally { setBusy(false); } };
  const reply = () => act(async () => { const fd = new FormData(); fd.append("message", msg); files.forEach((x) => fd.append("files", x)); await papi.post(`/service-requests/${id}/reply`, fd); toast.success("Reply sent"); });
  const reopen = () => act(async () => { const fd = new FormData(); fd.append("message", msg || "Reopening — issue persists."); await papi.post(`/service-requests/${id}/reopen`, fd); toast.success("Ticket reopened"); });
  const rate = (n) => act(async () => { await papi.post(`/service-requests/${id}/rate`, { rating: n }); toast.success("Thanks for your feedback!"); });
  if (isLoading || !sr) return <Skeleton h={300} />;
  return (
    <div data-testid="request-detail">
      <button onClick={() => nav(`${base}/requests`)} className="mb-3 flex items-center gap-1 text-sm font-semibold text-[#0B1F3A]" data-testid="request-back"><ChevronLeft className="h-4 w-4" />All requests</button>
      <div className="pcard p-5 fade-up"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-slate-500" data-testid="request-ticket">{sr.ticket_number}</span><span className={`pchip ${tone(sr.status)}`} data-testid="request-status">{sr.status}</span><span className="pchip bg-slate-100 text-slate-600">{sr.priority}</span></div><h2 className="serif mt-2 text-2xl font-semibold text-[#0B1F3A]">{sr.subject}</h2><p className="text-xs text-slate-500">{sr.category} · Flat {sr.flat_number} · raised {fmtDateTime(sr.created_at)}</p></div>
      <div className="mt-4 space-y-3" data-testid="request-thread">{sr.thread.map((m, i) => <div key={i} className={`max-w-[88%] rounded-2xl p-4 fade-up ${m.by === "customer" ? "ml-auto bg-[#0B1F3A] text-white" : "pcard"}`}><p className={`text-[11px] font-bold ${m.by === "customer" ? "text-[#C9A227]" : "text-slate-500"}`}>{m.by === "customer" ? "You" : m.author_name || "KKT team"} · {fmtDateTime(m.at)}</p><p className="mt-1 whitespace-pre-wrap text-sm">{m.message}</p>{m.attachments?.length > 0 && <p className="mt-2 text-xs opacity-80"><Paperclip className="inline h-3 w-3" /> {m.attachments.map((a) => a.name).join(", ")}</p>}</div>)}</div>
      {sr.status === "Resolved" && !sr.rating && <div className="pcard mt-4 p-5 text-center fade-up" data-testid="request-rate"><p className="font-bold text-[#0B1F3A]">How did we do?</p><div className="mt-2 flex justify-center gap-2">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => rate(n)} disabled={busy} className="grid h-12 w-12 place-items-center rounded-full bg-[#F8F6F1]" aria-label={`${n} stars`} data-testid={`rate-${n}`}><Star className="h-5 w-5 text-[#C9A227]" /></button>)}</div>{sr.can_reopen && <button onClick={reopen} disabled={busy} className="mt-3 text-sm font-semibold text-[#0B1F3A] underline" data-testid="request-reopen">Issue not fixed? Reopen</button>}</div>}
      {sr.rating && <p className="mt-4 text-center text-sm text-slate-500" data-testid="request-rating">You rated this {sr.rating}/5. Thank you!</p>}
      {!["Closed", "Resolved"].includes(sr.status) && <div className="pcard mt-4 p-4 fade-up"><textarea className="pinput" placeholder="Write a reply…" value={msg} onChange={(e) => setMsg(e.target.value)} data-testid="request-reply-text" /><div className="mt-3 flex items-center gap-2"><label className="pbtn pbtn-sm pbtn-ghost cursor-pointer"><Paperclip className="h-4 w-4" />{files.length || ""}<input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => setFiles([...e.target.files])} /></label><button onClick={reply} disabled={busy || !msg.trim()} className="pbtn pbtn-sm ml-auto" data-testid="request-reply-send">Send</button></div></div>}
    </div>
  );
}

export default function Requests() {
  const { id } = useParams();
  const base = useBase();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["p-requests"], queryFn: () => papi.get("/service-requests").then((r) => r.data.items) });
  if (id) return <Detail id={id} />;
  return (
    <div data-testid="portal-requests">
      <PageTitle title="Requests" sub="Questions, documents, snags — we're here." right={<button onClick={() => setOpen((o) => !o)} className="pbtn pbtn-sm pbtn-gold" data-testid="new-request-btn"><Plus className="h-4 w-4" />New</button>} />
      {open && <div className="mb-4"><NewRequest onDone={(sr) => { setOpen(false); qc.invalidateQueries({ queryKey: ["p-requests"] }); nav(`${base}/requests/${sr.id}`); }} /></div>}
      {isLoading ? <Skeleton h={200} /> : data?.length ? <div className="space-y-3" data-testid="requests-list">{data.map((sr) => <Link key={sr.id} to={`${base}/requests/${sr.id}`} className="pcard block p-4 fade-up" data-testid={`request-card-${sr.ticket_number}`}><div className="flex items-center gap-2"><span className="font-mono text-[11px] text-slate-500">{sr.ticket_number}</span><span className={`pchip ${tone(sr.status)}`}>{sr.status}</span>{sr.status === "Awaiting Customer" && <span className="text-[11px] font-bold text-[#8a6d12]">Reply needed</span>}</div><p className="mt-1 font-bold text-[#0B1F3A]">{sr.subject}</p><p className="text-xs text-slate-500">{sr.category} · Flat {sr.flat_number} · {fmtDateTime(sr.updated_at || sr.created_at)}</p></Link>)}</div> : !open && <Empty title="No requests yet" hint="Tap New to raise your first request." icon={LifeBuoy} />}
    </div>
  );
}
