import { useState } from "react";
import { Plus, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useFetch } from "@/hooks/useList";
import { cn } from "@/lib/utils";
import { PageHeader, Field } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

function RoleEditor({ role, groups, onSaved }) {
  const isNew = !role.id;
  const locked = role.is_system && role.name === "Super Admin";
  const [form, setForm] = useState({ name: role.name || "", description: role.description || "", permissions: role.permissions || [] });
  const [busy, setBusy] = useState(false);
  const has = (c) => form.permissions.includes(c);
  const toggle = (c) => setForm((f) => ({ ...f, permissions: has(c) ? f.permissions.filter((x) => x !== c) : [...f.permissions, c] }));
  const toggleGroup = (g) => { const codes = g.permissions.map((p) => p.code); const all = codes.every(has); setForm((f) => ({ ...f, permissions: all ? f.permissions.filter((x) => !codes.includes(x)) : Array.from(new Set([...f.permissions, ...codes])) })); };
  const save = async () => {
    setBusy(true);
    try {
      const payload = role.is_system ? { version: role.version, description: form.description, permissions: form.permissions } : { ...form, version: role.version };
      if (locked) delete payload.permissions;
      const r = isNew ? await api.post("/roles", form) : await api.patch(`/roles/${role.id}`, payload);
      toast.success(isNew ? "Role created" : "Role saved"); onSaved(r.data);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm(`Deactivate role "${role.name}"?`)) return;
    try { await api.delete(`/roles/${role.id}`); toast.success("Role deactivated"); onSaved(null); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="card-elev p-5" data-testid="role-editor">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex-1 space-y-3">
          <Field label="Role name" required><Input value={form.name} disabled={role.is_system} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="role-name-input" /></Field>
          <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="role-description-input" /></Field>
        </div>
        {role.is_system && <Pill tone="gold" className="mt-1"><Lock className="mr-1 h-3 w-3" />System role</Pill>}
      </div>
      {locked && <p className="mb-3 rounded-md bg-gold-light px-3 py-2 text-xs text-[#855D00]">Super Admin always has every permission.</p>}
      <div className="grid gap-3 md:grid-cols-2" data-testid="permission-groups">
        {groups.map((g) => {
          const codes = g.permissions.map((p) => p.code); const all = codes.every(has), some = codes.some(has);
          return (
            <div key={g.group} className="rounded-lg border p-3" data-testid={`perm-group-${g.group.replace(/\s+/g, "-").toLowerCase()}`}>
              <label className="mb-2 flex items-center gap-2 text-sm font-bold text-navy"><Checkbox checked={all ? true : some ? "indeterminate" : false} disabled={locked} onCheckedChange={() => toggleGroup(g)} />{g.group}<span className="ml-auto text-[11px] font-normal text-slate-400">{codes.filter(has).length}/{codes.length}</span></label>
              <div className="space-y-1.5 pl-6">
                {g.permissions.map((p) => <label key={p.code} className="flex items-center gap-2 text-sm text-slate-700"><Checkbox checked={has(p.code)} disabled={locked} onCheckedChange={() => toggle(p.code)} data-testid={`perm-${p.code}`} />{p.label}<code className="ml-auto text-[10px] text-slate-400">{p.code}</code></label>)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex items-center justify-between">
        {!role.is_system && !isNew ? <Button variant="outline" onClick={del} className="text-red-600" data-testid="role-delete-btn"><Trash2 className="mr-1.5 h-4 w-4" />Deactivate role</Button> : <span />}
        <Button onClick={save} disabled={busy} className="bg-navy hover:bg-navy-700" data-testid="role-save-btn">{isNew ? "Create role" : "Save role"}</Button>
      </div>
    </div>
  );
}

export default function Roles() {
  const { data: roles, loading, reload } = useFetch("/roles?page_size=100");
  const { data: perms } = useFetch("/permissions");
  const [selected, setSelected] = useState(null);
  const items = roles?.items || [];
  const current = selected === "new" ? {} : items.find((r) => r.id === selected) || items[0];
  return (
    <div data-testid="roles-page">
      <PageHeader title="Roles & Permissions" subtitle="Roles are bundles of canonical permission codes. System roles cannot be deleted." actions={<Button onClick={() => setSelected("new")} className="bg-navy hover:bg-navy-700" data-testid="new-role-btn"><Plus className="mr-1.5 h-4 w-4" />New role</Button>} />
      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="card-elev p-2" data-testid="roles-list">
          {loading ? <Skeleton className="h-40" /> : items.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} className={cn("flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm transition-colors", current?.id === r.id ? "bg-navy text-white" : "hover:bg-slate-50")} data-testid={`role-item-${r.name.replace(/\s+/g, "-").toLowerCase()}`}>
              <div><p className="font-bold">{r.name}</p><p className={cn("text-[11px]", current?.id === r.id ? "text-slate-300" : "text-slate-500")}>{r.permissions.length} permissions · {r.user_count} users</p></div>
              {r.is_system && <Lock className="h-3.5 w-3.5 opacity-60" />}
            </button>
          ))}
        </div>
        {current && perms ? <RoleEditor key={current.id || "new"} role={current} groups={perms.groups} onSaved={(r) => { reload(); setSelected(r?.id || null); }} /> : <Skeleton className="h-96" />}
      </div>
    </div>
  );
}
