import { useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useMasterOptions } from "@/hooks/useList";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/common/DateInput";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/Bits";
import { Checkbox } from "@/components/ui/checkbox";

const EMPTY = { name: "", code: "", description: "", project_type: "Residential", address: { line1: "", city: "", state: "", pincode: "" }, rera_number: "", launch_date: "", expected_possession_date: "", status: "Planning", amenity_ids: [], milestone_template_id: null, cover_image_url: "" };

export function ProjectForm({ open, onOpenChange, project, onSaved }) {
  const [form, setForm] = useState(project ? { ...EMPTY, ...project, address: { ...EMPTY.address, ...(project.address || {}) } } : EMPTY);
  const [busy, setBusy] = useState(false);
  const { items: amenities } = useMasterOptions("amenities");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setAddr = (k, v) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const clean = (v) => (v === "" ? null : v);
    const payload = { version: project?.version, name: form.name, description: clean(form.description), project_type: form.project_type, address: form.address, rera_number: clean(form.rera_number), launch_date: clean(form.launch_date), expected_possession_date: clean(form.expected_possession_date), status: form.status, amenity_ids: form.amenity_ids, milestone_template_id: form.milestone_template_id || null, cover_image_url: clean(form.cover_image_url) };
    try {
      const r = project ? await api.patch(`/projects/${project.id}`, payload) : await api.post("/projects", { ...payload, code: form.code });
      toast.success(project ? "Project updated" : "Project created");
      onSaved?.(r.data); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="project-form-sheet">
        <SheetHeader><SheetTitle>{project ? "Edit project" : "New project"}</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Project name" required className="col-span-2"><Input value={form.name} onChange={(e) => set("name", e.target.value)} required data-testid="project-name-input" /></Field>
            <Field label="Code" required hint="Uppercase, unique"><Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required disabled={!!project} data-testid="project-code-input" /></Field>
          </div>
          <Field label="Description"><Textarea value={form.description || ""} onChange={(e) => set("description", e.target.value)} data-testid="project-description-input" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><Select value={form.project_type} onValueChange={(v) => set("project_type", v)}><SelectTrigger data-testid="project-type-select"><SelectValue /></SelectTrigger><SelectContent>{["Residential", "Commercial", "Mixed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Status"><Select value={form.status} onValueChange={(v) => set("status", v)}><SelectTrigger data-testid="project-status-select"><SelectValue /></SelectTrigger><SelectContent>{["Planning", "Under Construction", "Ready", "Completed"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
          </div>
          <Field label="Address line"><Input value={form.address.line1 || ""} onChange={(e) => setAddr("line1", e.target.value)} data-testid="project-address-input" /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City"><Input value={form.address.city || ""} onChange={(e) => setAddr("city", e.target.value)} data-testid="project-city-input" /></Field>
            <Field label="State"><Input value={form.address.state || ""} onChange={(e) => setAddr("state", e.target.value)} /></Field>
            <Field label="Pincode"><Input value={form.address.pincode || ""} onChange={(e) => setAddr("pincode", e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="RERA number"><Input value={form.rera_number || ""} onChange={(e) => set("rera_number", e.target.value)} data-testid="project-rera-input" /></Field>
            <Field label="Launch date"><DateInput value={form.launch_date || ""} onChange={(e) => set("launch_date", e.target.value)} /></Field>
            <Field label="Expected possession"><DateInput value={form.expected_possession_date || ""} onChange={(e) => set("expected_possession_date", e.target.value)} /></Field>
          </div>
          
          <Field label="Cover image URL"><Input value={form.cover_image_url || ""} onChange={(e) => set("cover_image_url", e.target.value)} placeholder="https://…" /></Field>
          <Field label="Amenities">
            <div className="grid grid-cols-2 gap-2 rounded-md border p-3" data-testid="project-amenities">
              {amenities.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm"><Checkbox checked={form.amenity_ids.includes(a.id)} onCheckedChange={(c) => set("amenity_ids", c ? [...form.amenity_ids, a.id] : form.amenity_ids.filter((x) => x !== a.id))} data-testid={`amenity-check-${a.id}`} />{a.name}</label>
              ))}
            </div>
          </Field>
          <Button type="submit" disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="project-form-submit">{project ? "Save changes" : "Create project"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
