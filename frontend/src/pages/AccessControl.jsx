import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Search, Save, ShieldCheck, ShieldOff, Copy, Users as UsersIcon } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/common/Bits";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ACTIONS = ["view", "create", "edit", "delete", "export", "approve", "custom"];

function Tri({ codes, value, onChange, testId, disabled }) {
  const n = codes.filter((c) => value.has(c)).length;
  const state = n === 0 ? false : n === codes.length ? true : "indeterminate";
  return <Checkbox checked={state} disabled={disabled} onCheckedChange={(v) => onChange(codes, v === true)} data-testid={testId} />;
}

function SourceBadge({ src }) {
  if (!src?.length) return null;
  return <span className="ml-1 inline-flex gap-1">{src.map((s, i) => <span key={i} className={cn("pill !px-1.5 !py-0 text-[10px]", s.type === "deny" ? "bg-brick/10 text-brick" : s.type === "allow" ? "bg-sage/15 text-sage" : "bg-warm-100 text-txt-secondary")} data-testid={`perm-source-${s.type}`}>{s.type === "role" ? s.role : s.type}</span>)}</span>;
}

export function PermissionTree({ tree, value, onToggle, sources = {}, disabled, hideUiOnly }) {
  const mods = (tree?.modules || []).map((m) => ({ ...m, features: m.features.map((f) => ({ ...f, actions: f.actions.filter((a) => !hideUiOnly || !a.ui_only) })).filter((f) => f.actions.length) })).filter((m) => m.features.length);
  const all = mods.flatMap((m) => m.features.flatMap((f) => f.actions.map((a) => a.code)));
  return (
    <div className="space-y-3" data-testid="permission-tree">
      <label className="flex items-center gap-2 text-sm font-semibold"><Tri codes={all} value={value} onChange={onToggle} disabled={disabled} testId="perm-select-all" />Select all ({value.size}/{all.length})</label>
      {mods.map((m) => { const mc = m.features.flatMap((f) => f.actions.map((a) => a.code)); return (
        <details key={m.module} open className="rounded-xl border border-warm-200 bg-white" data-testid={`perm-module-${m.module}`}>
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold"><Tri codes={mc} value={value} onChange={onToggle} disabled={disabled} testId={`perm-module-all-${m.module}`} />{m.label}<span className="text-xs font-normal text-txt-muted">{mc.filter((c) => value.has(c)).length}/{mc.length}</span></summary>
          <table className="w-full text-xs"><thead><tr className="label-xs text-left"><th className="px-3 py-1">Feature</th>{ACTIONS.map((a) => <th key={a} className="px-2 py-1 capitalize">{a}</th>)}</tr></thead>
            <tbody>{m.features.map((f) => { const fc = f.actions.map((a) => a.code); return (
              <tr key={f.feature} className="border-t" data-testid={`perm-feature-${m.module}-${f.feature}`}>
                <td className="px-3 py-1.5"><label className="flex items-center gap-2"><Tri codes={fc} value={value} onChange={onToggle} disabled={disabled} testId={`perm-feature-all-${f.feature}`} />{f.label}</label></td>
                {ACTIONS.map((act) => { const a = f.actions.find((x) => x.action === act); return <td key={act} className="px-2 py-1.5">{a && <label className="inline-flex items-center" title={`${a.hcode} · ${a.label}${a.route_refs?.length ? `\n${a.route_refs.join("\n")}` : ""}`}><Checkbox checked={value.has(a.code)} disabled={disabled} onCheckedChange={(v) => onToggle([a.code], v === true)} data-testid={`perm-${a.hcode}`} /><SourceBadge src={sources[a.code]} /></label>}</td>; })}
              </tr>); })}</tbody></table>
        </details>); })}
    </div>
  );
}

function UserAccess({ userId, tree, roles, projects, onSaved }) {
  const { user: me } = useAuth();
  const [acc, setAcc] = useState(null);
  const [roleIds, setRoleIds] = useState([]);
  const [scope, setScope] = useState(["*"]);
  const [direct, setDirect] = useState([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const load = () => api.get(`/admin/access/users/${userId}`).then((r) => { setAcc(r.data); setRoleIds(r.data.role_ids); setScope(r.data.user.project_scope || ["*"]); setDirect(r.data.direct.map((d) => ({ code: d.code, effect: d.effect, reason: d.reason }))); });
  useEffect(() => { load(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const roleById = useMemo(() => Object.fromEntries((roles || []).map((r) => [r.id, r])), [roles]);
  const isSuper = roleIds.some((id) => roleById[id]?.name === "Super Admin");
  const fromRoles = useMemo(() => new Set(roleIds.flatMap((id) => roleById[id]?.permissions || [])), [roleIds, roleById]);
  const effective = useMemo(() => {
    if (isSuper) return new Set((tree?.modules || []).flatMap((m) => m.features.flatMap((f) => f.actions.map((a) => a.code))));
    const s = new Set(fromRoles); direct.forEach((d) => (d.effect === "allow" ? s.add(d.code) : s.delete(d.code))); return s;
  }, [fromRoles, direct, isSuper, tree]);
  const sources = useMemo(() => { const o = {}; roleIds.forEach((id) => (roleById[id]?.permissions || []).forEach((c) => (o[c] = [...(o[c] || []), { type: "role", role: roleById[id].name }]))); direct.forEach((d) => (o[d.code] = [...(o[d.code] || []), { type: d.effect }])); return o; }, [roleIds, roleById, direct]);
  const toggle = (codes, on) => setDirect((cur) => { let d = cur.filter((x) => !codes.includes(x.code)); codes.forEach((c) => { const inRole = fromRoles.has(c); if (on && !inRole) d.push({ code: c, effect: "allow" }); if (!on && inRole) d.push({ code: c, effect: "deny" }); }); return d; });
  const save = async () => {
    setBusy(true);
    try { const r = await api.put(`/admin/access/users/${userId}`, { role_ids: roleIds, project_scope: scope, direct, version: acc.user.version }); setAcc(r.data); toast.success("Access updated — applies on the user's next request"); onSaved?.(); }
    catch (e) { if (e.response?.data?.code === "VERSION_CONFLICT") setConflict(e.response.data); else toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };
  if (!acc) return <div className="card p-6 text-sm text-txt-muted">Loading…</div>;
  return (
    <div className="space-y-5" data-testid="user-access-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="label">Access for</p><h2 className="font-display text-2xl text-ink-950" data-testid="access-user-name">{acc.user.name}</h2><p className="text-xs text-txt-secondary">{acc.user.email} · {isSuper ? "Super Admin — unrestrictable" : `${effective.size} effective permissions`}</p></div>
        <div className="flex gap-2"><HistoryButton entityType="user" entityId={userId} label={acc.user.name} />
          {userId === me?.id ? <span className="self-center text-xs text-txt-muted" data-testid="access-self-edit-reason" title="Rule R1: nobody changes their own roles, grants or scope">You cannot change your own access — ask another administrator</span> : null}
          <Button onClick={save} disabled={busy || userId === me?.id} data-testid="access-save-button"><Save className="mr-1.5 h-4 w-4" />Save</Button></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4"><p className="label-xs mb-2">Roles (multi)</p><div className="flex flex-wrap gap-2">{(roles || []).map((r) => <button key={r.id} type="button" onClick={() => setRoleIds((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id]))} className={cn("pill border", roleIds.includes(r.id) ? "border-ink-950 bg-ink-950 text-white" : "border-warm-200 bg-white text-txt-secondary")} data-testid={`access-role-${r.name.replace(/\s+/g, "-").toLowerCase()}`}>{r.name}</button>)}</div></div>
        <div className="card p-4"><p className="label-xs mb-2">Project scope</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setScope(["*"])} className={cn("pill border", scope.includes("*") ? "border-ink-950 bg-ink-950 text-white" : "border-warm-200 bg-white")} data-testid="access-scope-all">All projects</button>{(projects || []).map((p) => <button key={p.id} type="button" onClick={() => setScope((s) => { const b = s.filter((x) => x !== "*"); return b.includes(p.id) ? (b.length > 1 ? b.filter((x) => x !== p.id) : ["*"]) : [...b, p.id]; })} className={cn("pill border", scope.includes(p.id) ? "border-ink-950 bg-ink-950 text-white" : "border-warm-200 bg-white")} data-testid={`access-scope-${p.code}`}>{p.code}</button>)}</div></div>
      </div>
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="label-xs">Permission tree · tick = allow, untick a role permission = direct deny</p><div className="flex gap-1 text-[10px]"><span className="pill bg-warm-100">role</span><span className="pill bg-sage/15 text-sage">allow</span><span className="pill bg-brick/10 text-brick">deny</span></div></div>
        <PermissionTree tree={tree} value={effective} onToggle={toggle} sources={sources} disabled={isSuper} />
      </div>
      <details className="card p-4"><summary className="cursor-pointer text-sm font-semibold">Effective permissions preview ({effective.size})</summary><div className="mt-2 flex flex-wrap gap-1" data-testid="effective-permissions">{Array.from(effective).sort().map((c) => <code key={c} className="rounded bg-warm-50 px-1.5 py-0.5 text-[10px]">{c}</code>)}</div></details>
      <Dialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}><DialogContent data-testid="version-conflict-dialog"><DialogHeader><DialogTitle>Someone else changed this user</DialogTitle></DialogHeader><p className="text-sm text-txt-secondary">Their access was updated after you opened it. Reload to see the current state, then re-apply your changes.</p><DialogFooter><Button variant="outline" onClick={() => setConflict(null)}>Cancel</Button><Button onClick={() => { setConflict(null); load(); }} data-testid="conflict-reload">Reload</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function RolesTab({ tree, roles, reload }) {
  const [sel, setSel] = useState(null);
  const [perms, setPerms] = useState(new Set());
  const [name, setName] = useState("");
  const [members, setMembers] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const pick = (r) => { setSel(r); setPerms(new Set(r.permissions)); setName(r.name); api.get(`/admin/access/roles/${r.id}/users`).then((x) => setMembers(x.data.items)); };
  const toggle = (codes, on) => setPerms((s) => { const n = new Set(s); codes.forEach((c) => (on ? n.add(c) : n.delete(c))); return n; });
  const save = async () => { try { await api.patch(`/roles/${sel.id}`, { permissions: Array.from(perms), version: sel.version }); toast.success("Role saved"); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const clone = async () => { const n = window.prompt("Name for the cloned role", `${sel.name} copy`); if (!n) return; try { await api.post(`/admin/access/roles/${sel.id}/clone`, { name: n }); toast.success("Role cloned"); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const create = async () => { try { await api.post("/roles", { name, permissions: Array.from(perms) }); toast.success("Role created"); setNewOpen(false); reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <div className="card p-3"><Button size="sm" className="mb-3 w-full" onClick={() => { setSel(null); setPerms(new Set()); setName(""); setNewOpen(true); }} data-testid="role-create-button">+ Custom role</Button>{(roles || []).map((r) => <button key={r.id} onClick={() => pick(r)} className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm", sel?.id === r.id ? "bg-ink-950 text-white" : "hover:bg-warm-50")} data-testid={`role-row-${r.name.replace(/\s+/g, "-").toLowerCase()}`}><span>{r.name}{r.is_system && <ShieldCheck className="ml-1 inline h-3 w-3 opacity-60" />}</span><span className="text-xs opacity-60">{r.permissions.length}</span></button>)}</div>
      <div>{sel ? <div className="space-y-4" data-testid="role-editor">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-display text-xl">{sel.name}</h3><p className="text-xs text-txt-secondary">{sel.description}</p></div><div className="flex gap-2"><HistoryButton entityType="role" entityId={sel.id} label={sel.name} /><Button variant="outline" size="sm" onClick={clone} data-testid="role-clone-button"><Copy className="mr-1 h-3.5 w-3.5" />Clone</Button><Button size="sm" onClick={save} disabled={sel.name === "Super Admin"} data-testid="role-save-button"><Save className="mr-1 h-3.5 w-3.5" />Save</Button></div></div>
        <div className="card p-4"><PermissionTree tree={tree} value={perms} onToggle={toggle} disabled={sel.name === "Super Admin"} /></div>
        <div className="card p-4"><p className="label-xs mb-2 flex items-center gap-1"><UsersIcon className="h-3 w-3" />Users in this role ({members?.length ?? "…"})</p><div className="flex flex-wrap gap-2" data-testid="role-members">{members?.map((u) => <span key={u.id} className="pill bg-warm-100">{u.name}</span>)}{members?.length === 0 && <span className="text-xs text-txt-muted">None</span>}</div></div>
      </div> : <div className="card p-8 text-center text-sm text-txt-muted">Select a role to edit its permission tree.</div>}</div>
      <Dialog open={newOpen} onOpenChange={setNewOpen}><DialogContent className="max-w-3xl" data-testid="role-create-dialog"><DialogHeader><DialogTitle>New custom role</DialogTitle></DialogHeader><input className="input" placeholder="Role name" value={name} onChange={(e) => setName(e.target.value)} data-testid="role-name-input" /><div className="max-h-[50vh] overflow-y-auto"><PermissionTree tree={tree} value={perms} onToggle={toggle} /></div><DialogFooter><Button onClick={create} disabled={!name.trim()} data-testid="role-create-submit">Create</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

export default function AccessControl() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || "users";
  const [q, setQ] = useState("");
  const { data: tree } = useFetch("/admin/access/tree");
  const { data: rolesRes, reload: reloadRoles } = useFetch("/roles?limit=100");
  const { data: usersRes, reload: reloadUsers } = useFetch(`/users?limit=100&include_inactive=true${q ? `&search=${encodeURIComponent(q)}` : ""}`);
  const { data: projRes } = useFetch("/projects?limit=100");
  const selected = sp.get("user");
  const roles = rolesRes?.items;
  return (
    <div data-testid="access-control-page">
      <PageHeader title="Access control" subtitle="Roles, direct grants and the permission tree — what every person can see and do." actions={<Tabs value={tab} onValueChange={(v) => setSp({ tab: v }, { replace: true })}><TabsList><TabsTrigger value="users" data-testid="access-tab-users">Users</TabsTrigger><TabsTrigger value="roles" data-testid="access-tab-roles">Roles</TabsTrigger></TabsList></Tabs>} />
      {tab === "roles" ? <RolesTab tree={tree} roles={roles} reload={reloadRoles} /> : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <div className="card p-3">
            <div className="relative mb-3"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-txt-muted" /><input className="input !h-9 !pl-8" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} data-testid="access-user-search" /></div>
            <div className="max-h-[70vh] space-y-1 overflow-y-auto" data-testid="access-user-list">{usersRes?.items?.map((u) => <button key={u.id} onClick={() => setSp({ tab, user: u.id }, { replace: true })} className={cn("w-full rounded-lg px-3 py-2 text-left", selected === u.id ? "bg-ink-950 text-white" : "hover:bg-warm-50")} data-testid={`access-user-${u.email}`}><div className="flex items-center justify-between text-sm font-semibold"><span>{u.name}</span>{u.is_active ? <ShieldCheck className="h-3.5 w-3.5 text-sage" /> : <ShieldOff className="h-3.5 w-3.5 text-brick" />}</div><div className="mt-0.5 flex flex-wrap gap-1">{(u.role_names?.length ? u.role_names : [u.role_name]).filter(Boolean).map((r) => <span key={r} className={cn("pill !px-1.5 !py-0 text-[10px]", selected === u.id ? "bg-white/15" : "bg-warm-100 text-txt-secondary")}>{r}</span>)}</div></button>)}</div>
          </div>
          <div>{selected ? <UserAccess userId={selected} tree={tree} roles={roles} projects={projRes?.items} onSaved={reloadUsers} /> : <div className="card p-8 text-center text-sm text-txt-muted">Pick a user to manage their roles, scope and permissions.</div>}</div>
        </div>
      )}
    </div>
  );
}
