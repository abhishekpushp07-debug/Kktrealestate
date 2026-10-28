import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { StatusChip } from "../StatusChip";

/** Title, layers (real / displayed / category), hold expiry and the hold quick actions. */
export function FlatDrawerHeader({ flat, can, busy, extendTo, setExtendTo, onExtendHold }) {
  const nav = useNavigate();
  const holdCustomer = flat.hold?.for_customer_id ? `&customer_id=${flat.hold.for_customer_id}` : "";
  return (
    <SheetHeader>
      <SheetTitle className="flex items-center gap-3 text-2xl font-extrabold text-ink-950"><span data-testid="flat-drawer-number">{flat.flat_number}</span><StatusChip status={flat.status} testId="flat-drawer-status" /><HistoryButton entityType="flat" entityId={flat.id} label={flat.flat_number} /></SheetTitle>
      <p className="text-sm text-txt-secondary">{flat.project_name} · {flat.block_name} · Floor {flat.floor} · Position {flat.position}</p>
      {flat.inventory_state && <FlatLayers flat={flat} />}
      {flat.hold?.expires_at && <p className="mt-1 text-xs text-amber-700" data-testid="flat-hold-expiry">Hold expires {new Date(flat.hold.expires_at).toLocaleString()} ({Math.max(0, Math.round((new Date(flat.hold.expires_at) - Date.now()) / 36e5))} h left){flat.hold.for_customer_id ? " · reserved for a customer" : ""}</p>}
      {flat.status === "Hold" && (can("sales.booking.create") || can("inventory.hold.create")) && <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="flat-hold-actions">
        {can("sales.booking.create") && (flat.bookable !== false) && <Button size="sm" className="bg-ink-950 hover:bg-ink-800" onClick={() => nav(`/bookings/new?flat=${flat.id}${holdCustomer}`)} data-testid="flat-convert-hold-btn">Convert hold → booking</Button>}
        {can("inventory.hold.create") && <>
          <Input type="datetime-local" value={extendTo} onChange={(e) => setExtendTo(e.target.value)} className="h-8 w-52 text-xs" data-testid="flat-extend-input" />
          <Button size="sm" variant="outline" disabled={busy || !extendTo} onClick={onExtendHold} data-testid="flat-extend-hold-btn">Extend hold</Button>
        </>}
      </div>}
    </SheetHeader>
  );
}

function FlatLayers({ flat }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs" data-testid="flat-layers">
      <span className="rounded bg-ink-100 px-2 py-0.5">Real: <b>{flat.inventory_state}</b></span>
      <span className={`rounded px-2 py-0.5 ${flat.masked ? "bg-amber-100 text-amber-900" : "bg-ink-100"}`} data-testid="flat-display-layer">Displayed: <b>{flat.display_state}</b>{flat.masked ? " · masked" : ""}</span>
      {flat.allocation_category_code && <span className="rounded bg-ink-100 px-2 py-0.5" data-testid="flat-category">{flat.allocation_category_code}{flat.bookable ? "" : " · not saleable"}</span>}
    </div>
  );
}
