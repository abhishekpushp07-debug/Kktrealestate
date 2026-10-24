import { useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { Plus, Pencil, Ban, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useList } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/common/Bits";
import { DataTable } from "@/components/common/DataTable";
import { Pill } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MASTERS } from "./masterConfig";
import { GenericMasterForm } from "./GenericMasterForm";
import { FlatTypeForm } from "./FlatTypeForm";
import { PaymentPlanForm } from "@/pages/master/PaymentPlanForm";
import { FloorPlanForm } from "./FloorPlanForm";

export default function MasterPage() {
  const { kind } = useParams();
  const cfg = MASTERS.find((m) => m.kind === kind) || MASTERS[0];
  const { can } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const list = useList(`/master/${cfg.kind}`, { include_inactive: showInactive || undefined });
  const [editing, setEditing] = useState(undefined);

  const toggle = async (row) => {
    try {
      await api.post(`/master/${cfg.kind}/${row.id}/${row.is_active ? "deactivate" : "activate"}`);
      toast.success(row.is_active ? "Deactivated" : "Reactivated"); list.reload();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const columns = [
    ...cfg.columns,
    { key: "is_active", label: "Status", render: (r) => <Pill tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Inactive"}</Pill> },
    ...(can("master.write") ? [{ key: "_actions", label: "", className: "text-right", render: (r) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(r)} data-testid={`master-edit-${r.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
        <Button variant="ghost" size="sm" className={cn("h-7 px-2", r.is_active ? "text-red-600 hover:text-red-700" : "text-emerald-600")} onClick={() => toggle(r)} title={r.is_active ? "Deactivate" : "Restore"} data-testid={`master-toggle-${r.id}`}>{r.is_active ? <Ban className="h-3.5 w-3.5" /> : <><RotateCcw className="mr-1 h-3.5 w-3.5" />Restore</>}</Button>
      </div>) }] : []),
  ];

  const FormComp = cfg.custom === "flatType" ? FlatTypeForm : cfg.custom === "paymentPlan" ? PaymentPlanForm : cfg.custom === "floorPlan" ? FloorPlanForm : GenericMasterForm;
  return (
    <div data-testid="master-page">
      <PageHeader title="Master Data" subtitle="Canonical reference data. Structural entities always reference these by id." actions={can("master.write") && <Button onClick={() => setEditing(null)} className="bg-navy hover:bg-navy-700" data-testid="master-new-btn"><Plus className="mr-1.5 h-4 w-4" />New {cfg.label.replace(/ies$/, "y").replace(/s$/, "")}</Button>} />
      <div className="mb-4 flex flex-wrap gap-1.5" data-testid="master-tabs">
        {MASTERS.map((m) => <NavLink key={m.kind} to={`/master/${m.kind}`} className={({ isActive }) => cn("rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors", isActive ? "border-navy bg-navy text-white" : "border-slate-200 bg-white text-slate-600 hover:border-gold hover:text-navy")} data-testid={`master-tab-${m.kind}`}>{m.label}</NavLink>)}
      </div>
      <DataTable {...list} columns={columns} testId={`master-table`} exportPath={`/master/${cfg.kind}`} searchPlaceholder={`Search ${cfg.label.toLowerCase()}…`} onRowClick={can("master.write") ? (r) => setEditing(r) : undefined}
        toolbar={<label className="flex items-center gap-2 text-xs text-slate-600"><Switch checked={showInactive} onCheckedChange={setShowInactive} data-testid="master-show-inactive" />Show inactive</label>} />
      {editing !== undefined && <FormComp key={editing?.id || "new"} cfg={cfg} item={editing} open onOpenChange={(o) => !o && setEditing(undefined)} onSaved={list.reload} existing={list.items || list.rows || []} />}
    </div>
  );
}
