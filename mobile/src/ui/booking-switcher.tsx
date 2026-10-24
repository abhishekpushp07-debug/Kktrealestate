import type { Booking } from "@/src/hooks";
import { Pills } from "./pills";

export function BookingSwitcher({ items, active, select }: { items: Booking[]; active: Booking | null; select: (id: string) => void }) {
  if (items.length < 2 || !active) return null;
  return (
    <Pills
      testIDPrefix="booking-switch"
      items={items.map((b) => ({ key: b.id, label: `${b.flat_number} · ${b.block_name}` }))}
      value={active.id}
      onChange={select}
    />
  );
}
