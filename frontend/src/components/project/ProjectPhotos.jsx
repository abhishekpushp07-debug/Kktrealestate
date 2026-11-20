import { useState } from "react";
import { ArrowLeft, ArrowRight, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { cn } from "@/lib/utils";

/** REQ-181/183: several project photos — add, reorder, remove, pick one as the cover (Emergent Object Storage). */
export function ProjectPhotos({ project, onChange }) {
  const [busy, setBusy] = useState(false);
  const photos = project.photos || [];
  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      onChange(r.data);
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = (files) =>
    run(
      async () => {
        let r;
        for (const f of files) {
          const fd = new FormData();
          fd.append("file", f);
          r = await api.post(`/projects/${project.id}/photos`, fd);
        }
        return r;
      },
      files.length === 1 ? "Photo added" : `${files.length} photos added`,
    );
  const order = (ids, cover) =>
    run(() =>
      api.put(`/projects/${project.id}/photos/order`, {
        ids,
        cover_id: cover ?? project.cover_photo_id ?? null,
      }),
    );
  const move = (i, d) => {
    const ids = photos.map((p) => p.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    order(ids);
  };
  return (
    <div data-testid="project-photos">
      <div className="flex flex-wrap gap-3">
        {photos.map((ph, i) => {
          const cover = ph.id === project.cover_photo_id;
          return (
            <figure
              key={ph.id}
              className={cn(
                "relative h-20 w-32 overflow-hidden rounded-lg border",
                cover ? "border-gold" : "border-warm-200",
              )}
              data-testid={`project-photo-${i}`}
            >
              <img src={ph.url} alt="" className="h-full w-full object-cover" />
              {cover && (
                <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-semibold text-white">
                  cover
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 px-1 py-0.5 text-white">
                <button
                  type="button"
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label="Move left"
                  className="disabled:opacity-30"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy || cover}
                  onClick={() =>
                    order(
                      photos.map((p) => p.id),
                      ph.id,
                    )
                  }
                  aria-label="Use as cover"
                  data-testid={`project-photo-cover-${i}`}
                  className="disabled:opacity-30"
                >
                  <Star className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api.delete(`/projects/${project.id}/photos/${ph.id}`),
                      "Photo removed",
                    )
                  }
                  aria-label="Remove photo"
                  data-testid={`project-photo-remove-${i}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy || i === photos.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move right"
                  className="disabled:opacity-30"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </figure>
          );
        })}
        <label
          className={
            "grid h-20 w-32 cursor-pointer place-items-center rounded-lg border border-dashed " +
            "border-warm-300 text-xs text-txt-muted hover:border-gold"
          }
        >
          <span className="flex flex-col items-center gap-1">
            <Upload className="h-4 w-4" />
            {busy ? "Uploading…" : "Add photos"}
          </span>
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const files = [...(e.target.files || [])];
              e.target.value = "";
              if (files.length) upload(files);
            }}
            data-testid="project-photos-upload"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-txt-muted">Images under 15 MB each.</p>
    </div>
  );
}
