import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, KeyRound, ShieldCheck, ShieldOff, Clock, UserX, UserCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import api, { errMsg } from "@/lib/api";
import { useList, useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { fmtDateTime } from "@/lib/format";
import { Card, StatTile, StatusPill, Field, Skeleton, EmptyState } from "@/components/v2";
import { Avatar } from "@/components/v2/CustomerBits";
import { Combobox } from "@/components/common/Combobox";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function UserSheet({ item, roles, projects, onClose, onSaved, onReset }) {
  const [form, setForm] = useState(item ? { ...item, password: "" } : { name: "", email: "", phone: "", role_id: null, project_scope: ["*"], password: "", is_active: true });
  const [busy, setBusy] = useState(false);
  const allScope = form.project_scope.includes("*");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (item) await api.patch(`/users/${item.id}`, { version: item.version, name: form.name, phone: form.phone || null, role_id: form.role_id, project_scope: form.project_scope, is_active: form.is_active });
      else await api.post("/users", { name: form.name, email: form.email, phone: form.phone || null, role_id: form.role_id, project_scope: form.project_scope, password: form.password });
      toast.success(item ? "User updated" : "Invitation created"); onSaved(); onClose();
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  const inp = "input !h-10";
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md" data-testid="user-form-sheet">
        <SheetHeader><p className="label">{item ? "Team member" : "Invite"}</p><SheetTitle className="font-display text-2xl">{item ? item.name : "Invite a user"} {item && <HistoryButton entityType="user" entityId={item.id} label={item.email} />}</SheetTitle></SheetHeader>
        {item && <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="pill bg-warm-100 text-txt-secondary"><Clock className="h-3 w-3" />Last login {fmtDateTime(item.last_login_at) || "never"}</span><span className={cn("pill", item.mfa_enabled ? "bg-sage-50 text-sage" : "bg-warm-100 text-txt-secondary")}>{item.mfa_enabled ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}MFA {item.mfa_enabled ? "on" : "off"}</span></div>}
        <form onSubmit={submit} className="mt-6 space-y-5">
          <Field label="Full name" required><input className={inp} value={form.name} onChange={(e) => set("name", e.target.value)} required data-testid="user-name-input" /></Field>
          <Field label="Email" required><input className={inp} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required disabled={!!item} data-testid="user-email-input" /></Field>
          <Field label="Phone"><input className={inp} value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} data-testid="user-phone-input" /></Field>
          {!item && <Field label="Temporary password" required hint="Min 8 chars, 1 letter, 1 number · they change it on first login"><input className={inp} type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required data-testid="user-password-input" /></Field>}
          <Field label="Role" required><Combobox options={roles.map((r) => ({ value: r.id, label: r.name, sub: r.is_system ? "system" : "custom" }))} value={form.role_id} onChange={(v) => set("role_id", v)} testId="user-role-combobox" /></Field>
          <Field label="Project scope">
            <div className="flex flex-wrap gap-2" data-testid="user-scope-projects">
              <button type="button" onClick={() => set("project_scope", ["*"])} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", allScope ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-txt-secondary")} data-testid="user-scope-all">All projects</button>
              {projects.map((p) => { const on = !allScope && form.project_scope.includes(p.id); return <button type="button" key={p.id} onClick={() => set("project_scope", on ? form.project_scope.filter((x) => x !== p.id) : [...form.project_scope.filter((x) => x !== "*"), p.id])} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", on ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-txt-secondary")} data-testid={`user-scope-${p.code}`}>{p.code}</button>; })}
            </div>
          </Field>
          {item && <Field label="Access"><div className="flex h-10 items-center gap-3"><Switch checked={form.is_active} onCheckedChange={(c) => set("is_active", c)} data-testid="user-active-switch" /><span className="text-sm">{form.is_active ? "Enabled" : "Disabled — cannot sign in"}</span></div></Field>}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={busy} className="btn btn-primary flex-1" data-testid="user-form-submit">{item ? "Save changes" : "Send invite"}</button>
            {item && <button type="button" className="btn btn-secondary" onClick={() => onReset(item)} data-testid="user-reset-btn"><KeyRound className="h-4 w-4" />Reset password</button>}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default function Users() {
  const { can, user: me } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState("");
  const list = useList("/users", { include_inactive: showInactive || undefined, page_size: 100 });
  const { data: rolesData } = useFetch("/roles?page_size=100");
  const { data: projData } = useFetch("/projects?page_size=100");
  const [editing, setEditing] = useState(undefined);
  const [resetFor, setResetFor] = useState(null);
  const [newPw, setNewPw] = useState("");
  const roles = rolesData?.items || [], projects = projData?.items || [];
  const users = (list.items || []).filter((u) => !q || `${u.name} ${u.email} ${u.role_name}`.toLowerCase().includes(q.toLowerCase()));
  const codes = (ids) => ids.includes("*") ? ["All projects"] : ids.length === 0 ? ["No projects"] : ids.map((id) => projects.find((p) => p.id === id)?.code || "?");
  const doReset = async () => { try { await api.post(`/users/${resetFor.id}/reset-password`, { new_password: newPw }); toast.success("Password reset"); setResetFor(null); setNewPw(""); } catch (e) { toast.error(errMsg(e)); } };
  const all = list.items || [];
  return (
    <div className="space-y-8" data-testid="users-page">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="label">Settings</p><h1 className="mt-1 font-display text-4xl text-ink-950">Users & Roles</h1><p className="mt-2 text-sm text-txt-secondary">Who can sign in, what they can do, and which projects they see.</p></div>
        <div className="flex gap-2"><Link to="/admin/access-control" className="btn btn-secondary" data-testid="access-control-link">Access control</Link><Link to="/roles" className="btn btn-secondary" data-testid="roles-link">Roles & permissions</Link>{can("admin.user.view") && <button onClick={() => setEditing(null)} className="btn btn-primary" data-testid="new-user-btn"><Plus className="h-4 w-4" />Invite user</button>}</div>
      </header>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active users" value={String(all.filter((u) => u.is_active).length)} hint={`${all.length} total`} icon={UserCheck} testId="users-tile-active" />
        <StatTile label="MFA enabled" value={String(all.filter((u) => u.mfa_enabled).length)} hint="two-factor on" icon={ShieldCheck} iconTone={all.some((u) => !u.mfa_enabled) ? "amber" : "sage"} testId="users-tile-mfa" />
        <StatTile label="Roles" value={String(roles.length)} hint={`${roles.filter((r) => r.is_system).length} system`} testId="users-tile-roles" />
        <StatTile label="Never signed in" value={String(all.filter((u) => !u.last_login_at).length)} hint="pending first login" icon={Clock} testId="users-tile-pending" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] max-w-md flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" /><input className="input !pl-9" placeholder="Search name, email, role…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="users-search" /></label>
        <label className="flex items-center gap-2 text-xs text-txt-secondary"><Switch checked={showInactive} onCheckedChange={setShowInactive} data-testid="users-show-inactive" />Show disabled</label>
      </div>
      {list.loading && !all.length ? <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div> : users.length === 0 ? <EmptyState icon={UserX} title="No users match" testId="users-empty" /> : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="users-grid">
          {users.map((u) => <Card key={u.id} hover className={cn("!p-5", !u.is_active && "opacity-60")} onClick={() => setEditing(u)} testId={`user-card-${u.id}`}>
            <div className="flex items-start gap-3"><Avatar name={u.name} size={44} /><div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold text-ink-950">{u.name}</p><p className="truncate text-xs text-txt-secondary">{u.email}</p></div><StatusPill status={u.role_name} /></div>
            <div className="mt-4 flex flex-wrap gap-1.5">{codes(u.project_scope || []).map((c) => <span key={c} className="pill bg-warm-100 text-txt-secondary">{c}</span>)}</div>
            <div className="mt-4 flex items-center justify-between border-t border-warm-100 pt-3 text-xs text-txt-muted">
              <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{u.last_login_at ? fmtDateTime(u.last_login_at) : "Never signed in"}</span>
              <span className="flex items-center gap-2">{u.mfa_enabled ? <span className="flex items-center gap-1 text-sage"><ShieldCheck className="h-3.5 w-3.5" />MFA</span> : <span className="flex items-center gap-1"><ShieldOff className="h-3.5 w-3.5" />No MFA</span>}{!u.is_active && <StatusPill status="Inactive" />}</span>
            </div>
          </Card>)}
        </div>
      )}
      {editing !== undefined && <UserSheet key={editing?.id || "new"} item={editing} roles={roles} projects={projects} onClose={() => setEditing(undefined)} onSaved={list.reload} onReset={(u) => { setEditing(undefined); setResetFor(u); }} />}
      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent className="v2" data-testid="reset-password-dialog"><DialogHeader><DialogTitle className="font-display text-xl">Reset password · {resetFor?.name}</DialogTitle></DialogHeader>
          <Field label="New temporary password" hint="Min 8 chars, 1 letter, 1 number"><input className="input !h-10" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} data-testid="reset-password-input" /></Field>
          <DialogFooter>{resetFor?.id === me?.id ? <p className="mr-auto self-center text-xs text-txt-muted" data-testid="reset-self-reason">You cannot reset your own password here — use Change password.</p> : null}<button onClick={doReset} disabled={resetFor?.id === me?.id} className="btn btn-primary" data-testid="reset-password-submit">Reset password</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
