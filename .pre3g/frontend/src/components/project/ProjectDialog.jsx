import { useState } from "react";
import { NativeSelect } from "@/components/common/EliteInputs";
import { DateInput } from "@/components/common/DateInput";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { Field } from "@/components/v2";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProjectPhotos } from "@/components/project/ProjectPhotos";

const TYPES = ["Residential", "Commercial", "Mixed"];

/** Create / edit project — ONE dialog. Essentials up top, everything else under "More". */
export function ProjectDialog({ project, onClose, onSaved }) {
  const isNew = !project?.id;
  const p = project || {};
  const [f, setF] = useState({
    name: p.name || "",
    code: p.code || "",
    project_type: p.project_type || "Residential",
    city: p.address?.city || "",
    locality: p.address?.line1 || "",
    rera_number: p.rera_number || "",
    launch_date: p.launch_date || "",
    expected_possession_date: p.expected_possession_date || "",
    state: p.address?.state || "",
    pincode: p.address?.pincode || "",
    cover_image_url: p.cover_image_url || "",
    default_cash_percent: p.default_cash_percent ?? "",
    description: p.description || "",
  });
  const [more, setMore] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [ver, setVer] = useState(p.version);
  const [photosChanged, setPhotosChanged] = useState(false);
  const close = () => (photosChanged ? onSaved({ ...p, ...photos, version: ver }) : onClose()); // hero cover refreshes
  const [photos, setPhotos] = useState({
    photos: p.photos || [],
    cover_photo_id: p.cover_photo_id || null,
  });
  const save = async () => {
    setBusy(true);
    setErr(null);
    const body = {
      name: f.name.trim(),
      project_type: f.project_type,
      rera_number: f.rera_number || null,
      launch_date: f.launch_date || null,
      expected_possession_date: f.expected_possession_date || null,
      cover_image_url: f.cover_image_url || null,
      description: f.description || null,
      address: {
        ...(p.address || {}),
        city: f.city || null,
        line1: f.locality || null,
        state: f.state || null,
        pincode: f.pincode || null,
      },
    };
    if (!isNew && f.default_cash_percent !== "")
      body.default_cash_percent = Number(f.default_cash_percent);
    try {
      const r = isNew
        ? await api.post("/projects", { ...body, code: f.code.trim().toUpperCase() })
        : await api.patch(`/projects/${p.id}`, { ...body, version: ver });
      toast.success(isNew ? "Project created — now add towers" : "Project saved");
      onSaved(r.data);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent
        className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-xl"
        data-testid="project-dialog"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">
            {isNew ? "New project" : "Edit project"}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-5 space-y-4 text-sm">
          <div className="border-b border-line pb-2 pt-2">
            <h3 className="e-caps-blue">Project</h3>
            <p className="mt-1 text-xs text-txt-secondary">
              Name and short code — the code goes on every booking and bill number.
            </p>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Project name" required>
              <input
                className="input !h-10"
                value={f.name}
                onChange={(e) => set("name", e.target.value)}
                data-testid="project-name"
              />
            </Field>
            <Field label="Code" required>
              <input
                className="input !h-10 uppercase"
                value={f.code}
                disabled={!isNew}
                onChange={(e) => set("code", e.target.value)}
                data-testid="project-code"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Type">
              <NativeSelect
                className="input !h-10"
                value={f.project_type}
                onChange={(e) => set("project_type", e.target.value)}
                data-testid="project-type"
              >
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="City">
              <input
                className="input !h-10"
                value={f.city}
                onChange={(e) => set("city", e.target.value)}
                data-testid="project-city"
              />
            </Field>
            <Field label="Locality">
              <input
                className="input !h-10"
                value={f.locality}
                onChange={(e) => set("locality", e.target.value)}
                data-testid="project-locality"
              />
            </Field>
          </div>
          <div className="border-b border-line pb-2 pt-2">
            <h3 className="e-caps-blue">Registration & dates</h3>
            <p className="mt-1 text-xs text-txt-secondary">
              RERA number prints on the member card and every letter; dates are for planning only.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="RERA no.">
              <input
                className="input !h-10"
                value={f.rera_number}
                onChange={(e) => set("rera_number", e.target.value)}
                data-testid="project-rera"
              />
            </Field>
            <Field label="Launch">
              <DateInput
                className="input !h-10"
                value={f.launch_date}
                onChange={(e) => set("launch_date", e.target.value)}
                data-testid="project-launch"
              />
            </Field>
            <Field label="Possession">
              <DateInput
                className="input !h-10"
                value={f.expected_possession_date}
                onChange={(e) => set("expected_possession_date", e.target.value)}
                data-testid="project-possession"
              />
            </Field>
          </div>
          <div className="border-b border-line pb-2 pt-2">
            <h3 className="e-caps-blue">Photos</h3>
            <p className="mt-1 text-xs text-txt-secondary">
              Add several; the starred one is the cover on the banner and the project page.
            </p>
          </div>
          {isNew ? (
            <p className="text-xs text-txt-muted">Save the project first, then add photos here.</p>
          ) : (
            <ProjectPhotos
              project={{ ...p, photos: photos.photos, cover_photo_id: photos.cover_photo_id }}
              onChange={(d) => {
                setPhotos(d);
                if (d.version != null) setVer(d.version); // photo ops bump the project version: keep the form current
                setPhotosChanged(true);
                set("cover_image_url", d.cover_image_url || "");
              }}
            />
          )}
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-txt-secondary"
            onClick={() => setMore((o) => !o)}
            data-testid="project-more-toggle"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")} />
            More details (address, cash share, description)
          </button>
          {more && (
            <div className="grid grid-cols-2 gap-3" data-testid="project-more">
              <Field label="State">
                <input
                  className="input !h-10"
                  value={f.state}
                  onChange={(e) => set("state", e.target.value)}
                  data-testid="project-state"
                />
              </Field>
              <Field label="Pincode">
                <input
                  className="input !h-10"
                  value={f.pincode}
                  onChange={(e) => set("pincode", e.target.value)}
                  data-testid="project-pincode"
                />
              </Field>
              {!isNew && (
                <Field label="Default cash %">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    className="input !h-10"
                    value={f.default_cash_percent}
                    onChange={(e) => set("default_cash_percent", e.target.value)}
                    data-testid="project-cash-pct"
                  />
                </Field>
              )}
              <Field label="Description" className={isNew ? "col-span-2" : ""}>
                <input
                  className="input !h-10"
                  value={f.description}
                  onChange={(e) => set("description", e.target.value)}
                  data-testid="project-description"
                />
              </Field>
              {!isNew && (
                <p className="col-span-2 text-xs text-txt-muted">
                  Cancellation &amp; bounce policy: Admin → Settings → Policies.
                </p>
              )}
            </div>
          )}
          {err && (
            <p
              className="rounded-lg border border-brick/30 bg-brick/5 px-3 py-2 text-xs text-brick"
              data-testid="project-error"
            >
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="soft" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              why={!f.name.trim() || !f.code.trim() ? "Fill name and code" : undefined}
              disabled={busy || !f.name.trim() || !f.code.trim()}
              onClick={save}
              data-testid="project-save"
            >
              {isNew ? "Create project" : "Save"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
