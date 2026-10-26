import type { AvailabilityGrid as AvailabilityGridData } from "@/lib/types";

/**
 * Availability rendered strictly from AVAILABLE | NOT_AVAILABLE cells: the public API never says
 * whether a flat is on hold, booked or blocked, and neither does this grid.
 */
export function AvailabilityGrid({ grid }: { grid: AvailabilityGridData }) {
  const blocks = grid.blocks.filter((b) => b.floors.length);
  if (!blocks.length) return null;
  const available = blocks.reduce((n, b) => n + b.available_count, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-ink-muted">
          <span className="font-semibold text-navy-900">{available}</span> {available === 1 ? "home" : "homes"} available right now
        </p>
        <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legend">
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-4 w-4 rounded-sm border border-gold-600 bg-gold-500" /> Available
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-4 w-4 rounded-sm border border-line bg-ivory-200" /> Not available
          </li>
        </ul>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {blocks.map((block) => (
          <div key={block.name} className="overflow-hidden rounded-card border border-line bg-white">
            <h3 className="border-b border-line px-5 py-3 font-display text-xl text-navy-900">{block.name}</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1 p-3 text-xs">
                <caption className="sr-only">Availability by floor for {block.name}</caption>
                <tbody>
                  {block.floors.map((floor) => (
                    <tr key={floor.floor_label}>
                      <th scope="row" className="whitespace-nowrap pr-3 text-left font-medium text-ink-soft">
                        {floor.floor_label}
                      </th>
                      {floor.cells.map((cell) => {
                        const open = cell.availability === "AVAILABLE";
                        return (
                          <td key={cell.flat_number} className="p-0">
                            <span
                              className={`flex min-h-9 min-w-12 items-center justify-center rounded-md border px-1.5 font-mono text-[0.7rem] ${
                                open ? "border-gold-600 bg-gold-500 text-navy-950 font-semibold" : "border-line bg-ivory-200 text-ink-soft"
                              }`}
                              title={`${cell.flat_number} · ${cell.configuration} · ${open ? "Available" : "Not available"}`}
                            >
                              {cell.flat_number}
                              <span className="sr-only">{open ? ", available" : ", not available"}</span>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
