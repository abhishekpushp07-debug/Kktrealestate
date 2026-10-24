import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Building2 } from "lucide-react";
import { useList } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { inrShort, fmtDate } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/common/Bits";
import { DataTable } from "@/components/common/DataTable";
import { Pill } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { ProjectForm } from "@/components/forms/ProjectForm";

export default function Projects() {
  const list = useList("/projects");
  const { can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const columns = [
    { key: "code", label: "Code", sortable: true, render: (p) => <span className="rounded bg-navy px-2 py-0.5 text-[11px] font-bold text-gold">{p.code}</span> },
    { key: "name", label: "Project", sortable: true, render: (p) => <div><p className="font-bold text-navy">{p.name}</p><p className="text-xs text-slate-500">{p.address?.city}{p.rera_number ? ` · RERA ${p.rera_number}` : ""}</p></div> },
    { key: "project_type", label: "Type" },
    { key: "status", label: "Status", sortable: true, render: (p) => <Pill tone={p.status === "Ready" ? "green" : p.status === "Under Construction" ? "amber" : "slate"}>{p.status}</Pill> },
    { key: "block_count", label: "Blocks", className: "text-right tabular" },
    { key: "inventory", label: "Units (Avail / Hold / Blocked)", render: (p) => <span className="tabular text-xs"><b className="text-navy">{p.inventory.total}</b> · <span className="text-emerald-600">{p.inventory.Available}</span> / <span className="text-amber-600">{p.inventory.Hold}</span> / <span className="text-slate-500">{p.inventory.Blocked}</span></span> },
    { key: "launch_date", label: "Launch", sortable: true, render: (p) => fmtDate(p.launch_date) },
  ];
  return (
    <div data-testid="projects-page">
      <PageHeader title="Projects" subtitle="Residential, commercial and mixed-use developments." actions={can("project.write") && <Button onClick={() => setOpen(true)} className="bg-navy hover:bg-navy-700" data-testid="new-project-btn"><Plus className="mr-1.5 h-4 w-4" />New project</Button>} />
      <DataTable {...list} columns={columns} testId="projects-table" onRowClick={(p) => navigate(`/projects/${p.id}`)} searchPlaceholder="Search name, code, city…"
        empty={<EmptyState icon={Building2} title="No projects yet" description="Create a project, then add blocks to auto-generate inventory." actionLabel={can("project.write") ? "Create project" : undefined} onAction={() => setOpen(true)} testId="projects-empty" />} />
      {open && <ProjectForm open={open} onOpenChange={setOpen} onSaved={() => list.reload()} />}
    </div>
  );
}
