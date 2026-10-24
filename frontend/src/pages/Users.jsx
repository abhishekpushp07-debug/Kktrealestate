import { useState } from "react";
import { Plus, Pencil, KeyRound } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useList, useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { fmtDateTime } from "@/lib/format";
import { PageHeader, Field } from "@/components/common/Bits";
import { DataTable } from "@/components/common/DataTable";
import { Pill } from "@/components/common/StatusChip";
import { Combobox } from "@/components/common/Combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function UserForm({ item, roles, projects, onClose, onSaved }) {
  const [form, setForm] = useState(item ? { ...item, password: "" } : { name: "", email: "", phone: "", role_id: null, project_scope: ["*"], password: "", is_active: true });
  const [busy, setBusy] = useState(false);
  const allScope = form.project_scope.includes("*");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (item) await api.patch(`/users/${item.id}`, { version: item.version, name: form.name, phone: form.phone || null, role_id: form.role_id, project_scope: form.project_scope, is_active: form.is_active });
      else await api.post("/users", { name: form.name, email: form.email, phone: form.phone || null, role_id: form.role_id, project_scope: form.project_scope, password: form.password });
      toast.success(item ? "User updated" : "User created"); onSaved(); onClose();
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-testid="user-form-sheet">
        <SheetHeader><SheetTitle>{item ? "Edit user" : "New user"}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Full name" required><Input value={form.name} onChange={(e) => set("name", e.target.value)} required data-testid="user-name-input" /></Field>
          <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required disabled={!!item} data-testid="user-email-input" /></Field>
          <Field label="Phone"><Input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} data-testid="user-phone-input" /></Field>
          {!item && <Field label="Password" required hint="Min 8 chars, 1 letter, 1 number"><Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} required data-testid="user-password-input" /></Field>}
          <Field label="Role" required><Combobox options={roles.map((r) => ({ value: r.id, label: r.name, sub: r.is_system ? "system" : "custom" }))} value={form.role_id} onChange={(v) => set("role_id", v)} testId="user-role-combobox" /></Field>
          <Field label="Project scope">
            <label className="mb-2 flex items-center gap-2 text-sm"><Checkbox checked={allScope} onCheckedChange={(c) => set("project_scope", c ? ["*"] : [])} data-testid="user-scope-all" />All projects</label>
            {!allScope && <div className="space-y-1 rounded-md border p-2" data-testid="user-scope-projects">{projects.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><Checkbox checked={form.project_scope.includes(p.id)} onCheckedChange={(c) => set("project_scope", c ? [...form.project_scope, p.id] : form.project_scope.filter((x) => x !== p.id))} data-testid={`user-scope-${p.code}`} />{p.code} · {p.name}</label>)}</div>}
          </Field>
          {item && <Field label="Active"><div><Switch checked={form.is_active} onCheckedChange={(c) => set("is_active", c)} data-testid="user-active-switch" /></div></Field>}
          <Button type="submit" disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="user-form-submit">{item ? "Save changes" : "Create user"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default function Users() {
  const { can } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const list = useList("/users", { include_inactive: showInactive || undefined });
  const { data: rolesData } = useFetch("/roles?page_size=100");
  const { data: projData } = useFetch("/projects?page_size=100");
  const [editing, setEditing] = useState(undefined);
  const [resetFor, setResetFor] = useState(null);
  const [newPw, setNewPw] = useState("");
  const roles = rolesData?.items || [], projects = projData?.items || [];
  const codeFor = (ids) => ids.includes("*") ? "All projects" : ids.map((id) => projects.find((p) => p.id === id)?.code || "?").join(", ");

  const doReset = async () => {
    try { await api.post(`/users/${resetFor.id}/reset-password`, { new_password: newPw }); toast.success("Password reset"); setResetFor(null); setNewPw(""); } catch (e) { toast.error(errMsg(e)); }
  };
  const columns = [
    { key: "name", label: "Name", sortable: true, render: (u) => <div><p className="font-bold text-navy">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></div> },
    { key: "role_name", label: "Role", render: (u) => <Pill tone="navy">{u.role_name}</Pill> },
    { key: "project_scope", label: "Scope", render: (u) => <span className="text-xs">{codeFor(u.project_scope || [])}</span> },
    { key: "phone", label: "Phone" },
    { key: "last_login_at", label: "Last login", render: (u) => <span className="text-xs">{fmtDateTime(u.last_login_at)}</span> },
    { key: "is_active", label: "Status", render: (u) => <Pill tone={u.is_active ? "green" : "slate"}>{u.is_active ? "Active" : "Inactive"}</Pill> },
    { key: "_a", label: "", className: "text-right", render: (u) => <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(u)} data-testid={`user-edit-${u.id}`}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setResetFor(u)} data-testid={`user-reset-${u.id}`}><KeyRound className="h-3.5 w-3.5" /></Button></div> },
  ];
  return (
    <div data-testid="users-page">
      <PageHeader title="Users" subtitle="Employees, their roles and project scope." actions={can("users.manage") && <Button onClick={() => setEditing(null)} className="bg-navy hover:bg-navy-700" data-testid="new-user-btn"><Plus className="mr-1.5 h-4 w-4" />New user</Button>} />
      <DataTable {...list} columns={columns} testId="users-table" onRowClick={(u) => setEditing(u)} toolbar={<label className="flex items-center gap-2 text-xs text-slate-600"><Switch checked={showInactive} onCheckedChange={setShowInactive} data-testid="users-show-inactive" />Show inactive</label>} />
      {editing !== undefined && <UserForm key={editing?.id || "new"} item={editing} roles={roles} projects={projects} onClose={() => setEditing(undefined)} onSaved={list.reload} />}
      <Dialog open={!!resetFor} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent data-testid="reset-password-dialog"><DialogHeader><DialogTitle>Reset password · {resetFor?.name}</DialogTitle></DialogHeader>
          <Field label="New password" hint="Min 8 chars, 1 letter, 1 number"><Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} data-testid="reset-password-input" /></Field>
          <DialogFooter><Button onClick={doReset} className="bg-navy hover:bg-navy-700" data-testid="reset-password-submit">Reset</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
