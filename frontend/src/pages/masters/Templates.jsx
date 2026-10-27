import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Field } from "@/components/common/Bits";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function Templates() {
  const { can } = useAuth();
  const canEdit = can("masters.template.edit");
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [lang, setLang] = useState("en");
  const [prev, setPrev] = useState(null);
  const [bk, setBk] = useState("");
  const [bookings, setBookings] = useState([]);
  const load = () => api.get("/messaging/templates").then((r) => { setList(r.data); if (!sel && r.data.items[0]) setSel(r.data.items[0]); }).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); api.get("/bookings", { params: { status: "Active", page_size: 20 } }).then((r) => { setBookings(r.data.items); if (r.data.items[0]) setBk(r.data.items[0].id); }).catch(() => {}); }, []); // eslint-disable-line
  const set = (k, v) => setSel({ ...sel, [lang]: { ...(sel[lang] || {}), [k]: v } });
  const save = async () => { try { const r = await api.patch(`/messaging/templates/${sel.id}`, { code: sel.code, name: sel.name, en: sel.en, hi: sel.hi, version: sel.version }); setSel(r.data); toast.success("Template saved"); load(); } catch (e) { toast.error(errMsg(e)); } };
  const preview = async () => { try { const r = await api.get(`/messaging/templates/${sel.code}/preview`, { params: { booking_id: bk, lang } }); setPrev(r.data); } catch (e) { toast.error(errMsg(e)); } };
  if (!list) return <div className="card h-64 animate-pulse" />;
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]" data-testid="templates-page">
      <aside className="card !p-2"><p className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-txt-muted">Templates</p>{list.items.map((t) => <button key={t.id} onClick={() => { setSel(t); setPrev(null); }} className={cn("block w-full rounded-lg px-3 py-2 text-left text-sm", sel?.id === t.id ? "bg-gold-light font-semibold text-ink-950" : "hover:bg-warm-50")} data-testid={`tpl-${t.code}`}>{t.name}<div className="text-[11px] text-txt-muted">{t.code}</div></button>)}</aside>
      {sel && <section className="card space-y-4 !p-6" data-testid="template-editor">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-2xl text-ink-950">{sel.name}</h1><p className="text-xs text-txt-muted">{sel.code} · v{sel.version}</p></div>
          <div className="flex items-center gap-2"><div className="flex gap-1 rounded-full bg-warm-100 p-1">{["en", "hi"].map((l) => <button key={l} onClick={() => setLang(l)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", lang === l ? "bg-white shadow" : "text-txt-secondary")} data-testid={`tpl-lang-${l}`}>{l === "en" ? "English" : "हिन्दी"}</button>)}</div><HistoryButton entityType="message_template" entityId={sel.id} label={sel.name} />{canEdit && <Button onClick={save} data-testid="tpl-save">Save</Button>}</div></div>
        <Field label="Subject"><Input value={sel[lang]?.subject || ""} onChange={(e) => set("subject", e.target.value)} disabled={!canEdit} data-testid="tpl-subject" /></Field>
        <Field label="Body"><textarea className="input min-h-[220px] font-mono text-xs" value={sel[lang]?.body || ""} onChange={(e) => set("body", e.target.value)} disabled={!canEdit} data-testid="tpl-body" /></Field>
        <p className="text-xs text-txt-secondary">Placeholders: {list.placeholders.map((p) => <code key={p} className="mr-1 rounded bg-warm-100 px-1 text-[10px]">{`{{${p}}}`}</code>)}</p>
        <div className="flex flex-wrap items-end gap-3 border-t border-warm-100 pt-4"><Field label="Preview with a real booking"><select className="input !w-auto" value={bk} onChange={(e) => setBk(e.target.value)} data-testid="tpl-preview-booking">{bookings.map((b) => <option key={b.id} value={b.id}>{b.booking_number} · {b.customer_name}</option>)}</select></Field><Button variant="outline" onClick={preview} disabled={!bk} data-testid="tpl-preview">Preview</Button></div>
        {prev && <div className="rounded-xl border border-warm-200 bg-warm-50 p-4 text-sm" data-testid="tpl-preview-out"><p className="font-bold text-ink-950">{prev.subject}</p><pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-txt-secondary">{prev.body}</pre></div>}
      </section>}
    </div>
  );
}
