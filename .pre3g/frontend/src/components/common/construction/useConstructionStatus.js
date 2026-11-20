import { useCallback, useEffect, useState } from "react";
import { showNextStep } from "@/components/common/NextStep";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { fmtDate, inr } from "@/lib/format";
import { businessToday } from "@/lib/businessDay";
import { useAuth } from "@/context/AuthContext";

/** Construction status state + actions for one tower: load, planned-date edit, confirm/apply stage completion (with dues preview), undo. */
export function useConstructionStatus(blockId, onChanged) {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [journey, setJourney] = useState(null);
  const [target, setTarget] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notes, setNotes] = useState("");
  const [showCustomers, setShowCustomers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [reason, setReason] = useState("");
  const load = useCallback(
    () =>
      api
        .get(`/blocks/${blockId}/construction`)
        .then((r) => setData(r.data))
        .catch((e) => toast.error(errMsg(e))),
    [blockId],
  );
  const savePlanned = async (s, v) => {
    if ((v || "") === (s.planned_date || "")) return;
    try {
      await api.patch(`/blocks/${blockId}/construction/stages/${s.stage_id}/planned-date`, {
        planned_date: v || null,
        version: data?.block?.version ?? 0,
      });
      toast.success(v ? `Planned ${fmtDate(v)}` : "Planned date cleared");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  useEffect(() => {
    load();
  }, [load]);
  const openConfirm = () => {
    const t = data.stages.find((s) => s.stage_id === target);
    if (!t) return;
    const today = businessToday();
    setConfirm({
      target: t,
      rows: data.stages
        .filter((s) => s.status !== "Completed" && s.seq <= t.seq)
        .map((s) => ({ ...s, date: today })),
    });
    setPreview(null);
    api
      .get(`/blocks/${blockId}/stages/${t.stage_id}/preview`)
      .then((r) => setPreview(r.data))
      .catch(() => setPreview({ error: true }));
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/blocks/${blockId}/construction/stage`, {
        stage_id: confirm.target.stage_id,
        completed_on: confirm.rows.at(-1).date,
        dates: Object.fromEntries(confirm.rows.map((x) => [x.stage_id, x.date])),
        version: data.block.version,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        visible_to_customers: showCustomers,
      });
      if (r.data.demands_raised > 0 && can("documents.document.view")) {
        const d = confirm.rows.at(-1).date;
        showNextStep({
          title: `${r.data.demands_raised} bill${r.data.demands_raised === 1 ? "" : "s"} raised`,
          actions: [
            {
              label: "Print bill letters",
              to: `/documents?mode=bulk&project_id=${data.block.project_id}&block_id=${blockId}&date_from=${d}&date_to=${businessToday()}`,
            },
          ],
        });
      }
      toast.success(
        r.data.demands_raised === 0 && preview?.no_dues_reason
          ? `Stage ${r.data.stage_name} completed — 0 dues raised: ${preview.no_dues_reason}`
          : `Stage ${r.data.stage_name} completed — ${r.data.demands_raised} bill(s) raised (${inr(r.data.demands_total)})`,
        {
          action: { label: "Where did this go?", onClick: () => setJourney(r.data.audit_id) },
          duration: 8000,
        },
      );
      setConfirm(null);
      setTarget("");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!reason.trim()) return;
    try {
      const r = await api.post(`/blocks/${blockId}/construction/undo`, {
        reason,
        version: data.block.version,
      });
      toast.success(`Stage ${r.data.stage_name} undone — ${r.data.demands_voided} bill(s) voided`, {
        action: { label: "Where did this go?", onClick: () => setJourney(r.data.audit_id) },
        duration: 8000,
      });
      setUndoOpen(false);
      setReason("");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return {
    data,
    journey,
    setJourney,
    target,
    setTarget,
    confirm,
    setConfirm,
    preview,
    notes,
    setNotes,
    showCustomers,
    setShowCustomers,
    busy,
    undoOpen,
    setUndoOpen,
    reason,
    setReason,
    savePlanned,
    openConfirm,
    apply,
    undo,
  };
}
