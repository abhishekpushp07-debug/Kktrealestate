import { useState } from "react";
import { ContextActions } from "@/components/common/ContextActions";
import { InventoryActions } from "@/components/common/InventoryActions";
import { useAuth } from "@/context/AuthContext";
import { inr, inrShort, sqft, num } from "@/lib/format";
import { KV } from "../Bits";
import { HistoryTimeline } from "../HistoryTimeline";
import { Button } from "@/components/ui/button";

function bookDisabledReason(flat) {
  if (flat.bookable === false)
    return `${flat.allocation_category_name || flat.allocation_category_code || "Non-saleable"} — not builder-saleable`;
  if (["Booked", "Sold"].includes(flat.status)) return "Already booked";
  if (flat.status === "Blocked")
    return `Blocked${flat.block_reason ? ` — ${flat.block_reason}` : ""} — release first`;
  if (flat.status === "Hold" && !flat.hold?.for_customer_id)
    return "On hold — release or convert the hold first";
  return undefined;
}

/** Context actions (book / construction / document / tower). */
export function FlatActions({ flat, onChanged }) {
  const { can } = useAuth();
  const [inv, setInv] = useState(false);
  const canInv = [
    "inventory.block.set",
    "inventory.display.set",
    "inventory.category.set",
    "inventory.hold.create",
  ].some(can);
  const holdCustomer = flat.hold?.for_customer_id
    ? `&customer_id=${flat.hold.for_customer_id}`
    : "";
  const items = [
    {
      label: "Book this flat",
      to: `/bookings/new?project=${flat.project_id}&block=${flat.block_id}&flat=${flat.id}${holdCustomer}`,
      perm: "sales.booking.create",
      primary: true,
      disabledReason: bookDisabledReason(flat),
    },
    {
      label: "Construction update",
      to: `/construction?project=${flat.project_id}&tower=${flat.block_id}`,
      perm: "construction.stage.update",
    },
    {
      label: "Generate document",
      to: `/documents?mode=generate&project_id=${flat.project_id}&block_id=${flat.block_id}`,
      perm: "documents.document.generate",
    },
    { label: "Tower", to: `/blocks/${flat.block_id}`, perm: "masters.flat.view" },
  ];
  return (
    <>
      <ContextActions className="mt-4" testId="flat-context-actions" items={items} />
      {canInv && (
        <Button
          type="button"
          variant="soft"
          size="compact"
          className="mt-2"
          onClick={() => setInv(true)}
          data-testid="flat-inventory-actions-btn"
        >
          Inventory actions
        </Button>
      )}
      {inv && (
        <InventoryActions
          flatIds={[flat.id]}
          open={inv}
          onClose={() => setInv(false)}
          onDone={() => {
            setInv(false);
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

/** Price card. */
export function FlatPrice({ flat }) {
  return (
    <div className="mt-6 rounded-xl bg-ink-950 p-5 text-white">
      <p className="label-xs text-gold">Listed price</p>
      <p className="mt-1 text-3xl font-extrabold tabular" data-testid="flat-drawer-price">
        {inrShort(flat.price)}
      </p>
      <p className="text-xs text-txt-muted">
        {inr(flat.price)}
        {flat.rate_per_sqft
          ? ` · ₹${num(flat.rate_per_sqft)}/sq.ft × ${num(flat.saleable_sqft)} sq.ft saleable`
          : " · lump sum"}
        {flat.rate_card?.name ? ` · ${flat.rate_card.name}` : ""}
      </p>
      {flat.price_source === "manual" && (
        <p
          className="mt-2 rounded bg-amber/15 px-2 py-1 text-xs text-amber"
          data-testid="flat-price-manual-override"
        >
          Custom value
          {flat.rate_card_breakup?.length
            ? ` (was ${flat.rate_card_breakup.map((b) => b.label).join(" + ")})`
            : ""}
        </p>
      )}
      {flat.price_breakup?.length > 0 && (
        <ul
          className="mt-3 space-y-1 border-t border-white/10 pt-2 text-xs"
          data-testid="flat-price-breakup"
        >
          {flat.price_breakup.map((b) => (
            <li key={b.label} className="flex justify-between">
              <span className="text-txt-muted">{b.label}</span>
              <span className="tabular font-semibold">{inr(b.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Areas, rooms, specifications and history. */
export function FlatFacts({ flat }) {
  return (
    <>
      <div className="mt-5 grid grid-cols-3 gap-4">
        <KV label="Type" value={`${flat.flat_type?.name} (${flat.flat_type?.bhk} BHK)`} />
        <KV label="Facing" value={flat.facing} />
        <KV label="Floor" value={flat.floor} mono />
        <KV
          label="Saleable area"
          value={flat.saleable_sqft ? sqft(flat.saleable_sqft) : "Not set"}
          mono
        />
        {flat.pricing_status && flat.pricing_status !== "ready" && (
          <KV label="Pricing" value="Pending" />
        )}
      </div>
      <div className="mt-6">
        <p className="label-xs mb-2">Rooms</p>
        <table className="w-full text-sm" data-testid="flat-rooms-table">
          <tbody>
            {flat.rooms_snapshot?.map((r) => (
              <tr key={r.label} className="border-b border-warm-200">
                <td className="py-1.5 text-txt-secondary">
                  {r.label}
                  <span className="ml-1 text-[10px] text-txt-muted">{r.room_type_name}</span>
                </td>
                <td className="py-1.5 text-right tabular text-xs text-txt-secondary">
                  {r.length_ft} × {r.width_ft} ft
                </td>
                <td className="py-1.5 text-right font-semibold tabular">
                  {num(r.area_sqft)} sq.ft
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="label-xs mb-2 mt-4">Areas</p>
        <div className="flex flex-wrap gap-2" data-testid="flat-areas-list">
          {flat.areas_snapshot?.map((a) => (
            <span
              key={a.area_type_name || a.label}
              className="rounded-md border bg-warm-50 px-2 py-1 text-xs"
            >
              <b className="text-ink-950">{a.area_type_name}</b> {num(a.value_sqft)}
            </span>
          ))}
        </div>
        {flat.specifications?.length > 0 && (
          <>
            <p className="label-xs mb-2 mt-4">Specifications</p>
            <div className="grid grid-cols-2 gap-1 text-xs" data-testid="flat-specs">
              {flat.specifications.map((s) => (
                <div key={s.id} className="rounded border bg-white px-2 py-1">
                  <span className="text-txt-muted">{s.category}: </span>
                  <b className="text-ink-950">{s.name}</b>
                  {s.brand ? <span className="text-txt-secondary"> · {s.brand}</span> : null}
                </div>
              ))}
            </div>
          </>
        )}
        <details className="mt-4">
          <summary className="label-xs cursor-pointer">History</summary>
          <div className="mt-2">
            <HistoryTimeline entityType="flat" entityId={flat.id} />
          </div>
        </details>
      </div>
    </>
  );
}
