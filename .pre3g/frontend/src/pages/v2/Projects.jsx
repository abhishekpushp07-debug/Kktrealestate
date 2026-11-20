import { useState } from "react";
import { branch } from "@/lib/branch";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ProjectDialog } from "@/components/project/ProjectDialog";
import { Building2, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { EmptyState, SkeletonCards } from "@/components/v2";
import { ProjectCard } from "@/components/project/ProjectCard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { inrShort } from "@/lib/format";

export default function Projects() {
  const { can } = useAuth();
  const { data, loading } = useFetch("/projects?page_size=100&with_total=false");
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(sp.get("new") === "1");
  const [status, setStatus] = useState("All");
  const [city, setCity] = useState("All");
  const items = data?.items || [];
  const cities = ["All", ...new Set(items.map((p) => p.address?.city).filter(Boolean))];
  const statuses = ["All", ...Object.keys(data?.status_counts || {}).sort()];
  const list = items.filter(
    (p) =>
      (status === "All" || p.status === status) && (city === "All" || p.address?.city === city),
  );
  const sc = data?.status_counts || {};
  const Pills = ({ opts, v, set, id, count }) => (
    <div className="flex gap-2 overflow-x-auto pb-1" data-testid={id}>
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => set(o)}
          data-testid={`${id}-${o.toLowerCase().replace(/\s+/g, "-")}`}
          className={cn("e-chip", v === o && "on")}
        >
          {o.toLowerCase()}
          <em>{count(o)}</em>
        </button>
      ))}
    </div>
  );
  // summary figures: unit_counts (booked + sold) and services/cards.py outstanding — the same numbers as each banner
  const units = items.reduce((a, p) => a + (p.unit_counts?.total || 0), 0);
  const sold = items.reduce(
    (a, p) => a + (p.unit_counts?.booked || 0) + (p.unit_counts?.sold || 0),
    0,
  );
  const outstanding = items.reduce((a, p) => a + (p.card?.outstanding_paise || 0), 0);
  return (
    <div className="space-y-6" data-testid="projects-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="e-title" data-testid="page-title">
            projects.
          </h1>
          {items.length > 0 && (
            <p className="e-sub" data-testid="projects-summary">
              {items.length} {items.length === 1 ? "project" : "projects"} · {sold} of {units} units
              booked or sold · {inrShort(outstanding / 100)} outstanding
            </p>
          )}
        </div>
        {can("masters.project.create") && (
          <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-project-btn">
            <Plus className="h-4 w-4" />
            New project
          </Button>
        )}
      </header>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <Pills
          opts={statuses}
          v={status}
          set={setStatus}
          id="filter-status"
          count={(o) =>
            o === "All"
              ? Object.values(sc).reduce((a, n) => a + n, 0) || items.length
              : (sc[o] ?? 0)
          }
        />
        {cities.length > 2 && (
          <Pills
            opts={cities}
            v={city}
            set={setCity}
            id="filter-city"
            count={(o) =>
              o === "All" ? items.length : items.filter((p) => p.address?.city === o).length
            }
          />
        )}
      </div>
      {branch(
        loading,
        () => (
          <SkeletonCards n={3} h="h-72" />
        ),
        list.length === 0,
        () => (
          <EmptyState
            icon={Building2}
            title="No projects yet"
            description="Create a project, then add towers from templates — floors, flats and plans appear in one go."
            action={
              can("masters.project.create") && (
                <Button onClick={() => setCreating(true)} variant="gold">
                  New project
                </Button>
              )
            }
            testId="projects-empty"
          />
        ),
        () => (
          <div className="grid gap-4" data-testid="projects-grid">
            {list.map((p) => (
              <ProjectCard key={p.id} p={p} startSelling={`/projects/${p.id}?tab=structure`} />
            ))}
          </div>
        ),
      )}
      {creating && (
        <ProjectDialog
          onClose={() => {
            setCreating(false);
            if (sp.get("new")) setSp({});
          }}
          onSaved={(p) => navigate(`/projects/${p.id}?tab=structure`)}
        />
      )}
    </div>
  );
}
