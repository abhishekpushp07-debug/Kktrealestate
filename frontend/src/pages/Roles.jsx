import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Lock, Trash2, Search, Check, Minus, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useFetch } from "@/hooks/useList";
import { cn } from "@/lib/utils";
import { Card, Field, Skeleton } from "@/components/v2";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ACTIONS = ["read", "view", "write", "create", "manage", "assign", "approve", "post", "export", "delete"];
const actionOf = (code) => code.split(".").pop();

function RoleEditor({ role, groups, onSaved }) {
  const isNew = !role.id;
  const locked = role.is_system && role.name === "Super Admin";
  const [form, setForm] = useState({ name: role.name || "", description: role.description || "", permissions: role.permissions || [] });
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const has = (c) => form.permissions.includes(c);
  const toggle = (c) => !locked && setForm((f) => ({ ...f, permissions: has(c) ? f.permissions.filter((x) => x !== c) : [...f.permissions, c] }));
  const toggleGroup = (g) => { if (locked) return; const codes = g.permissions.map((p) => p.code); const all = codes.every(has); setForm((f) => ({ ...f, permissions: all ? f.permissions.filter((x) => !codes.includes(x)) : Array.from(new Set([...f.permissions, ...codes])) })); };
  const cols = useMemo(() => ACTIONS.filter((a) => groups.some((g) => g.permissions.some((p) => actionOf(p.code) === a))), [groups]);
  const visible = groups.filter((g) => !q || g.group.toLowerCase().includes(q.toLowerCase()) || g.permissions.some((p) => p.label.toLowerCase().includes(q.toLowerCase())));
  const added = form.permissions.filter((c) => !(role.permissions || []).includes(c)), removed = (role.permissions || []).filter((c) => !form.permissions.includes(c));
  const labelOf = (c) => groups.flatMap((g) => g.permissions).find((p) => p.code === c)?.label || c;
  const dirty = added.length || removed.length || form.name !== (role.name || "") || form.description !== (role.description || "");
  const save = async () => {
    setBusy(true);
    try {
      const payload = role.is_system ? { version: role.version, description: form.description, permissions: form.permissions } : { ...form, version: role.version };
      if (locked) delete payload.permissions;
      const r = isNew ? await api.post("/roles", form) : await api.patch(`/roles/${role.id}`, payload);
      toast.success(isNew ? "Role created" : "Role saved"); setPreview(false); onSaved(r.data);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async () => { if (!window.confirm(`Deactivate role "${role.name}"?`)) return; try { await api.delete(`/roles/${role.id}`); toast.success("Role deactivated"); onSaved(null); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Card className="!p-0 overflow-hidden" testId="role-editor">
      <div className="grid gap-5 border-b border-warm-100 p-6 md:grid-cols-[1fr_2fr]">
        <Field label="Role name" required><input className="input !h-10" value={form.name} disabled={role.is_system} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="role-name-input" /></Field>
        <Field label="Description"><input className="input !h-10" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="role-description-input" /></Field>
      </div>
      {locked && <p className="mx-6 mt-4 rounded-xl bg-gold-light px-4 py-2.5 text-xs font-semibold text-[#6b5410]">Super Admin always has every permission — the matrix is read-only.</p>}
      <div className="flex flex-wrap items-center gap-3 px-6 pt-5">
        <label className="relative min-w-[200px] max-w-xs flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" /><input className="input !h-9 !pl-9 text-sm" placeholder="Search areas or permissions…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="perm-search" /></label>
        <span className="text-xs text-txt-secondary" data-testid="perm-count">{form.permissions.length} of {groups.reduce((a, g) => a + g.permissions.length, 0)} permissions</span>
      </div>
      <div className="overflow-x-auto px-6 py-5"><table className="w-full min-w-[640px] text-sm" data-testid="permission-groups">
        <thead><tr className="text-[11px] font-semibold uppercase tracking-wider text-txt-muted"><th className="pb-3 text-left">Area</th>{cols.map((c) => <th key={c} className="pb-3 text-center">{c}</th>)}<th className="pb-3 text-right">All</th></tr></thead>
        <tbody>{visible.map((g, i) => { const codes = g.permissions.map((p) => p.code); const n = codes.filter(has).length; return (
          <tr key={g.group} className={cn("h-12 border-t border-warm-100", i % 2 && "bg-warm-50/60")} data-testid={`perm-group-${g.group.replace(/\s+/g, "-").toLowerCase()}`}>
            <td className="pr-4 font-semibold text-ink-950">{g.group}<span className="ml-2 text-xs font-normal text-txt-muted">{n}/{codes.length}</span></td>
            {cols.map((a) => { const ps = g.permissions.filter((p) => actionOf(p.code) === a); return <td key={a} className="text-center">{ps.map((p) => <button key={p.code} type="button" title={p.label} onClick={() => toggle(p.code)} disabled={locked} className={cn("mx-0.5 inline-grid h-7 w-7 place-items-center rounded-lg border transition-colors", has(p.code) ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-transparent hover:border-gold", locked && "cursor-not-allowed")} aria-pressed={has(p.code)} aria-label={p.label} data-testid={`perm-${p.code}`}><Check className="h-3.5 w-3.5" /></button>)}</td>; })}
            <td className="text-right"><button type="button" onClick={() => toggleGroup(g)} disabled={locked} className={cn("inline-grid h-7 w-7 place-items-center rounded-lg border", n === codes.length ? "border-gold bg-gold text-ink-950" : n ? "border-warm-300 bg-warm-100 text-ink-950" : "border-warm-200 bg-white text-txt-muted")} aria-label={`Toggle all ${g.group}`} data-testid={`perm-group-toggle-${g.group.replace(/\s+/g, "-").toLowerCase()}`}>{n === codes.length ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}</button></td>
          </tr>); })}</tbody>
      </table></div>
      <div className="flex items-center justify-between gap-3 border-t border-warm-100 bg-warm-50/60 px-6 py-4">
        {!role.is_system && !isNew ? <button className="btn btn-ghost text-brick" onClick={del} data-testid="role-delete-btn"><Trash2 className="h-4 w-4" />Deactivate role</button> : <span className="text-xs text-txt-muted">{role.is_system ? "System role · name is fixed" : ""}</span>}
        <div className="flex items-center gap-3">{dirty ? <span className="text-xs text-txt-secondary" data-testid="role-diff-summary">+{added.length} / −{removed.length}</span> : null}<button className="btn btn-primary" disabled={busy || (!dirty && !isNew)} onClick={() => (isNew && !added.length ? save() : setPreview(true))} data-testid="role-save-btn">{isNew ? "Create role" : "Review & save"}</button></div>
      </div>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="v2 max-w-lg" data-testid="role-diff-dialog"><DialogHeader><DialogTitle className="font-display text-xl">Confirm changes to {form.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            {added.length > 0 && <div><p className="label text-sage">Granting {added.length}</p><ul className="mt-2 flex flex-wrap gap-1.5">{added.map((c) => <li key={c} className="pill bg-sage-50 text-sage">+ {labelOf(c)}</li>)}</ul></div>}
            {removed.length > 0 && <div><p className="label text-brick">Revoking {removed.length}</p><ul className="mt-2 flex flex-wrap gap-1.5">{removed.map((c) => <li key={c} className="pill bg-brick-50 text-brick">− {labelOf(c)}</li>)}</ul></div>}
            {!added.length && !removed.length && <p className="text-txt-secondary">Only the name or description changed.</p>}
            {role.user_count > 0 && <p className="rounded-xl bg-warm-100 px-3 py-2 text-xs text-txt-secondary">Applies immediately to <b className="text-ink-950">{role.user_count} user{role.user_count > 1 ? "s" : ""}</b> with this role.</p>}
          </div>
          <DialogFooter><button className="btn btn-secondary" onClick={() => setPreview(false)}>Back</button><button className="btn btn-primary" disabled={busy} onClick={save} data-testid="role-confirm-save">Save role</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function Roles() {
  const { data: roles, loading, reload } = useFetch("/roles?page_size=100");
  const { data: perms } = useFetch("/permissions");
  const [selected, setSelected] = useState(null);
  const items = roles?.items || [];
  const current = selected === "new" ? {} : items.find((r) => r.id === selected) || items[0];
  return (
    <div className="space-y-8" data-testid="roles-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><Link to="/users" className="mb-2 inline-flex items-center gap-1 text-[13px] text-txt-secondary hover:text-ink-950" data-testid="roles-back"><ArrowLeft className="h-3.5 w-3.5" />Users</Link><p className="label">Settings</p><h1 className="mt-1 font-display text-4xl text-ink-950">Roles & permissions</h1><p className="mt-2 text-sm text-txt-secondary">Roles bundle permission codes by area. System roles cannot be deleted.</p></div>
        <button onClick={() => setSelected("new")} className="btn btn-primary" data-testid="new-role-btn"><Plus className="h-4 w-4" />New role</button>
      </header>
      {loading ? <div className="grid gap-6 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="roles-list">
          {items.map((r) => { const on = current?.id === r.id; return <Card key={r.id} hover onClick={() => setSelected(r.id)} className={cn("!p-5 cursor-pointer", on && "!border-ink-950 ring-1 ring-ink-950")} testId={`role-item-${r.name.replace(/\s+/g, "-").toLowerCase()}`}>
            <div className="flex items-start justify-between gap-2"><p className="text-[15px] font-semibold text-ink-950">{r.name}</p>{r.is_system && <Lock className="h-4 w-4 text-txt-muted" />}</div>
            <p className="mt-1 line-clamp-2 min-h-[32px] text-xs text-txt-secondary">{r.description || "—"}</p>
            <div className="mt-3 flex items-center justify-between text-xs text-txt-muted"><span><b className="font-display text-base text-ink-950">{r.permissions.length}</b> permissions</span><span>{r.user_count} user{r.user_count === 1 ? "" : "s"}</span></div>
          </Card>; })}
          {selected === "new" && <Card className="!p-5 !border-ink-950 ring-1 ring-ink-950"><p className="text-[15px] font-semibold text-ink-950">New role</p><p className="mt-1 text-xs text-txt-secondary">Name it and pick permissions below.</p></Card>}
        </div>
      )}
      {current && perms ? <RoleEditor key={current.id || "new"} role={current} groups={perms.groups} onSaved={(r) => { reload(); setSelected(r?.id || null); }} /> : !loading && <Skeleton className="h-96" />}
    </div>
  );
}
