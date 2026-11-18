import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { inrShort } from "@/lib/format";
import { Card, Skeleton, UNIT_COLORS } from "@/components/v2";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const ORDER = ["Available", "Hold", "Booked", "Sold", "Blocked"];
const CHIP =
  "h-8 min-w-[2.75rem] rounded-md px-1.5 text-[11px] font-semibold transition-transform " +
  "hover:scale-105 focus-visible:outline focus-visible:outline-2";

// Same /flats list (and its "Show to sales as" display layer) the Home Inventory widget counts
async function allFlats(projectId) {
  const out = [];
  for (let page = 1; page < 20; page += 1) {
    const { data } = await api.get("/flats", {
      params: { project_id: projectId, page, page_size: 200 },
    });
    out.push(...data.items);
    if (out.length >= data.total || data.items.length === 0) break;
  }
  return out;
}

function FlatDrawer({ f, onClose }) {
  const { can } = useAuth();
  return (
    <Sheet open={Boolean(f)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md" data-testid="flat-drawer">
        {f && (
          <>
            <SheetHeader>
              <SheetTitle>
                {f.block_name} · {f.flat_number}
              </SheetTitle>
            </SheetHeader>
            <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                ["Status", f.status],
                ["Floor", f.floor_label ?? f.floor],
                ["Type", f.flat_type_code],
                ["Area", f.saleable_sqft ? `${f.saleable_sqft} sq ft` : "—"],
                ["Facing", f.facing || "—"],
                ["Price", f.price ? inrShort(f.price) : "Not priced"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-txt-muted">{k}</dt>
                  <dd
                    className="font-semibold text-ink-950"
                    data-testid={`flat-drawer-${k.toLowerCase()}`}
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              {f.booking_id && can("sales.booking.view") && (
                <Link
                  to={`/bookings/${f.booking_id}`}
                  className="btn btn-secondary btn-sm"
                  data-testid="flat-drawer-booking"
                >
                  Open booking
                </Link>
              )}
              {f.bookable && can("sales.booking.create") && (
                <Link
                  to={`/bookings/new?flat_id=${f.id}`}
                  className="btn btn-primary btn-sm"
                  data-testid="flat-drawer-book"
                >
                  Book this flat
                </Link>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TowerGrid({ name, flats, onPick }) {
  const floors = useMemo(() => {
    const m = new Map();
    flats.forEach((f) => m.set(f.floor, [...(m.get(f.floor) || []), f]));
    return [...m.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([fl, fs]) => [fl, fs.sort((a, b) => a.position - b.position)]);
  }, [flats]);
  const counts = ORDER.map((st) => [st, flats.filter((f) => f.status === st).length]).filter(
    ([, n]) => n,
  );
  return (
    <Card testId={`inv-tower-${name}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="e-caps-blue">{name}</h3>
        <div className="flex flex-wrap gap-3 text-xs text-txt-secondary">
          {counts.map(([st, n]) => (
            <span
              key={st}
              className="flex items-center gap-1.5"
              data-testid={`inv-count-${name}-${st}`}
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNIT_COLORS[st] }} />
              {st} <b className="text-ink-950">{n}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {floors.map(([fl, fs]) => (
          <div key={fl} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-right text-[11px] text-txt-muted">
              {fs[0].floor_label ?? fl}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {fs.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onPick(f)}
                  title={`${f.flat_number} · ${f.status}`}
                  className={CHIP}
                  style={{
                    background: UNIT_COLORS[f.status] || "var(--line)",
                    color:
                      f.status === "Blocked"
                        ? "var(--text-1)"
                        : "var(--canvas)" /* AA: test_theme_contrast */,
                  }}
                  data-testid={`inv-flat-${f.flat_number}`}
                >
                  {f.flat_number}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** REQ-124: floor × flat colour grid per tower; click a flat → drawer. */
export function InventoryGrid({ projectId }) {
  const [flats, setFlats] = useState(null);
  const [pick, setPick] = useState(null);
  useEffect(() => {
    allFlats(projectId)
      .then(setFlats)
      .catch(() => setFlats([]));
  }, [projectId]);
  if (!flats) return <Skeleton className="h-64 rounded-2xl" />;
  if (!flats.length)
    return (
      <p className="text-sm text-txt-muted" data-testid="inv-empty">
        No flats yet — add a tower in Structure.
      </p>
    );
  const towers = [...new Set(flats.map((f) => f.block_name))];
  return (
    <div className="space-y-5" data-testid="inventory-grid">
      {towers.map((t) => (
        <TowerGrid
          key={t}
          name={t}
          flats={flats.filter((f) => f.block_name === t)}
          onPick={setPick}
        />
      ))}
      <FlatDrawer f={pick} onClose={() => setPick(null)} />
    </div>
  );
}
