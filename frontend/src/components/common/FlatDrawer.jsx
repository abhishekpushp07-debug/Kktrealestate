import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { undoToast } from "@/lib/undo";
import { useAuth } from "@/context/AuthContext";
import { useMasterOptions } from "@/hooks/useList";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectedTo } from "@/components/common/ConnectedTo";
import { FlatDrawerHeader } from "./flatdrawer/FlatDrawerHeader";
import { FlatStatusSection } from "./flatdrawer/FlatStatusSection";
import { FlatPricingSheet } from "./flatdrawer/FlatPricingSheet";
import { FlatActions, FlatFacts, FlatPrice } from "./flatdrawer/FlatActions";

const MANUAL = ["Available", "Hold", "Blocked"];

/** Flat side sheet (CR-2 C10: composed from flatdrawer/* sections; test ids unchanged). */
export function FlatDrawer({ flatId, onClose, onChanged }) {
  const { can } = useAuth();
  const [flat, setFlat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [extendTo, setExtendTo] = useState("");
  const [holdUntil, setHoldUntil] = useState("");
  const manualTargets = useMemo(() => MANUAL.filter((s) => s !== flat?.status), [flat?.status]);
  const { options: ftOptions } = useMasterOptions("flat-types");

  useEffect(() => {
    if (!flatId) {
      setFlat(null);
      return;
    }
    setFlat(null);
    api
      .get(`/flats/${flatId}`)
      .then((r) => setFlat(r.data))
      .catch((e) => toast.error(errMsg(e)));
  }, [flatId]);

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status) => {
    const prev = flat;
    setFlat((f) => ({ ...f, status })); // optimistic
    try {
      const r = await api.patch(`/flats/${flatId}/status`, {
        status,
        reason: reason || null,
        version: flat.version,
        ...(status === "Hold" ? { expires_at: new Date(holdUntil).toISOString() } : {}), // F2: expiry mandatory
      });
      setHoldUntil("");
      setFlat((f) => ({ ...f, ...r.data, inventory_state: r.data.status }));
      setReason("");
      if (MANUAL.includes(prev.status))
        undoToast({
          title: `${r.data.flat_number} is now ${status}`,
          description: `Was ${prev.status}`,
          testId: `flat-move-${flatId}`,
          onUndo: async () => {
            const u = await api.patch(`/flats/${flatId}/status`, {
              status: prev.status,
              reason: "Undo",
              version: r.data.version,
              ...(prev.status === "Hold" ? { expires_at: prev.hold?.expires_at } : {}),
            });
            setFlat((f) => ({ ...f, ...u.data }));
            onChanged?.();
            return `Reverted · ${u.data.flat_number} back to ${prev.status}`;
          },
        });
      else toast.success(`${r.data.flat_number} is now ${status}`);
      onChanged?.();
    } catch (e) {
      setFlat(prev);
      throw e;
    }
  };

  const extendHold = async () => {
    await api.post("/inventory/bulk", {
      flat_ids: [flatId],
      action: "extend_hold",
      expires_at: new Date(extendTo).toISOString(),
    });
    const r = await api.get(`/flats/${flatId}`);
    setFlat(r.data);
    setExtendTo("");
    toast.success(`${r.data.flat_number}: hold extended`);
    onChanged?.();
  };

  return (
    <Sheet open={!!flatId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="flat-drawer">
        {!flat ? (
          <div className="space-y-3 pt-6">
            <SheetTitle className="sr-only">Loading flat</SheetTitle>
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <>
            <FlatDrawerHeader
              flat={flat}
              can={can}
              busy={busy}
              extendTo={extendTo}
              setExtendTo={setExtendTo}
              onExtendHold={() => run(extendHold)}
            />
            <FlatActions
              flat={flat}
              onChanged={() => {
                api.get(`/flats/${flatId}`).then((r) => setFlat(r.data));
                onChanged?.();
              }}
            />
            <FlatPrice flat={flat} />
            <FlatFacts flat={flat} />
            {can("sales.hold.create") && (
              <FlatStatusSection
                flat={flat}
                manualTargets={manualTargets}
                reason={reason}
                setReason={setReason}
                holdUntil={holdUntil}
                setHoldUntil={setHoldUntil}
                busy={busy}
                onChange={(s) => run(() => changeStatus(s))}
              />
            )}
            {can("masters.flat.edit") && (
              <FlatPricingSheet
                flatId={flat.id}
                ftOptions={ftOptions}
                onChanged={() => {
                  api.get(`/flats/${flatId}`).then((r) => setFlat(r.data));
                  onChanged?.();
                }}
              />
            )}
            <ConnectedTo entity="flat" id={flat.id} className="mt-6" />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
