import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Lock, Plus, Trash2, X } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { inrShort, num } from "@/lib/format";
import { useMasterOptions } from "@/hooks/useList";
import { Combobox } from "@/components/common/Combobox";
import { BulkEditBar } from "./BulkEditBar";
import { Button } from "@/components/ui/button";

/** Phase PS.2 — floor-by-floor designer: each floor row has its own flat mix (count, per-position type, names). Booked/Sold flats are locked individually. */
export function FloorDesigner({ blockId, can, onChanged }) {
  const [d, setD] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [applyDefaults, setApplyDefaults] = useState(false);
  const [sel, setSel] = useState(new Set());
  const toggleSel = (id) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const { options: ftOptions } = useMasterOptions("flat-types");
  const load = useCallback(
    () =>
      api
        .get(`/blocks/${blockId}/floors`)
        .then((r) => {
          setD(r.data);
          setDraft({});
        })
        .catch((e) => toast.error(errMsg(e))),
    [blockId],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!d) return <p className="p-4 text-sm text-txt-muted">Loading…</p>;
  const rows = (fl) =>
    draft[fl.floor] ||
    fl.flats.map((f) => ({
      id: f.id,
      position: f.position,
      flat_type_id: f.flat_type_id,
      flat_number: f.flat_number,
      locked: f.locked,
      saleable_sqft: f.saleable_sqft,
      price: f.price,
      pricing_status: f.pricing_status,
      pricing_review: f.pricing_review,
    }));
  const setRows = (floor, r) =>
    setDraft({ ...draft, [floor]: r.map((x, i) => ({ ...x, position: i + 1 })) });
  const run = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (fl) =>
    run(
      () =>
        api.put(`/blocks/${blockId}/floors/${fl.floor}`, {
          positions: rows(fl).map((r) => ({
            position: r.position,
            flat_type_id: r.flat_type_id,
            flat_number: r.flat_number || null,
          })),
          apply_type_defaults: applyDefaults,
          version: d.block.version,
        }),
      `Floor ${fl.label} saved`,
    );
  const del = (fl) => {
    if (!window.confirm(`Delete floor ${fl.label} and its ${fl.flats.length} flats?`)) return;
    run(() => api.delete(`/blocks/${blockId}/floors/${fl.floor}`), `Floor ${fl.label} removed`);
  };
  const copy = (fl) => {
    const to = window.prompt(`Copy floor ${fl.label} mix to floors (comma separated):`);
    if (!to) return;
    run(
      () =>
        api.post(`/blocks/${blockId}/floors/${fl.floor}/copy`, {
          to_floors: to
            .split(",")
            .map((x) => Number(x.trim()))
            .filter((n) => !isNaN(n)),
          apply_type_defaults: applyDefaults,
        }),
      "Floor mix copied",
    );
  };
  const editable = can("masters.tower.edit");
  return (
    <div className="card p-4" data-testid="floor-designer">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="e-caps-blue">Floor designer</h3>
        <span className="text-xs text-txt-muted">
          {d.block.floors} floors · {d.pending_pricing} flats without saleable area / price ·{" "}
          {d.locked} locked by bookings
        </span>
        {editable && (
          <label className="ml-auto flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={applyDefaults}
              onChange={(e) => setApplyDefaults(e.target.checked)}
              data-testid="designer-apply-defaults"
            />
            Apply flat-type default saleable area and rate to new flats
          </label>
        )}
      </div>
      <div className="divide-y divide-warm-100">
        {[...d.floors].reverse().map((fl) => {
          const r = rows(fl);
          const dirty = !!draft[fl.floor];
          return (
            <div key={fl.floor} className="py-3" data-testid={`designer-floor-${fl.floor}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="w-20 font-semibold">Floor {fl.label}</span>
                <span
                  className="text-xs text-txt-muted"
                  data-testid={`designer-floor-count-${fl.floor}`}
                >
                  {r.length} flats{fl.locked_count ? ` · ${fl.locked_count} locked` : ""}
                  {fl.pending_pricing ? ` · ${fl.pending_pricing} without area / price` : ""}
                </span>
                {editable && (
                  <div className="ml-auto flex gap-1">
                    <Button
                      type="button"
                      variant="quiet"
                      size="compact"
                      onClick={() =>
                        setRows(fl.floor, [
                          ...r,
                          {
                            position: r.length + 1,
                            flat_type_id: r[r.length - 1]?.flat_type_id || ftOptions[0]?.value,
                            flat_number: "",
                          },
                        ])
                      }
                      data-testid={`designer-add-${fl.floor}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Flat
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      size="compact"
                      onClick={() => copy(fl)}
                      disabled={busy || !fl.flats.length}
                      data-testid={`designer-copy-${fl.floor}`}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy to…
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      size="compact"
                      className="text-brick"
                      onClick={() => del(fl)}
                      disabled={busy || fl.locked_count > 0}
                      title={fl.locked_count ? "Floor has booked flats" : ""}
                      data-testid={`designer-delete-${fl.floor}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    {dirty && (
                      <>
                        <Button
                          type="button"
                          variant="primary"
                          size="compact"
                          disabled={busy}
                          onClick={() => save(fl)}
                          data-testid={`designer-save-${fl.floor}`}
                        >
                          Save floor
                        </Button>
                        <Button
                          type="button"
                          variant="quiet"
                          size="compact"
                          onClick={() => {
                            const n = { ...draft };
                            delete n[fl.floor];
                            setDraft(n);
                          }}
                          data-testid={`designer-cancel-${fl.floor}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {r.map((x, i) => (
                  <div
                    key={x.id || `new-${i}`}
                    className={`rounded-lg border p-2 text-xs ${x.locked ? "bg-warm-50" : "bg-white"}`}
                    data-testid={`designer-pos-${fl.floor}-${x.position}`}
                  >
                    <div className="mb-1 flex items-center gap-1">
                      {x.id && !x.locked && editable && (
                        <input
                          type="checkbox"
                          checked={sel.has(x.id)}
                          onChange={() => toggleSel(x.id)}
                          aria-label={`Select ${x.flat_number}`}
                          data-testid={`designer-select-${fl.floor}-${x.position}`}
                        />
                      )}
                      <input
                        className="input !h-7 w-24 text-xs font-semibold"
                        value={x.flat_number || ""}
                        placeholder="auto"
                        disabled={!editable || x.locked}
                        onChange={(e) =>
                          setRows(
                            fl.floor,
                            r.map((y, j) => (j === i ? { ...y, flat_number: e.target.value } : y)),
                          )
                        }
                        data-testid={`designer-number-${fl.floor}-${x.position}`}
                      />
                      {x.locked ? (
                        <span
                          className="ml-auto flex items-center gap-1 text-amber"
                          title="Locked by booking"
                        >
                          <Lock className="h-3 w-3" />
                          locked
                        </span>
                      ) : (
                        editable && (
                          <button
                            type="button"
                            className="ml-auto text-txt-muted hover:text-brick"
                            onClick={() =>
                              setRows(
                                fl.floor,
                                r.filter((_, j) => j !== i),
                              )
                            }
                            aria-label="Remove flat"
                            data-testid={`designer-remove-${fl.floor}-${x.position}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )
                      )}
                    </div>
                    <Combobox
                      options={ftOptions}
                      value={x.flat_type_id}
                      onChange={(v) =>
                        setRows(
                          fl.floor,
                          r.map((y, j) => (j === i ? { ...y, flat_type_id: v } : y)),
                        )
                      }
                      disabled={!editable || x.locked}
                      className="!h-7 text-xs"
                      testId={`designer-type-${fl.floor}-${x.position}`}
                    />
                    {x.id && (
                      <p className="mt-1 text-[11px] text-txt-muted">
                        {x.saleable_sqft ? (
                          `${num(x.saleable_sqft)} sq ft`
                        ) : (
                          <span className="text-brick">no area</span>
                        )}{" "}
                        ·{" "}
                        {x.price ? inrShort(x.price) : <span className="text-brick">no price</span>}
                      </p>
                    )}
                    {x.pricing_status === "review" && (
                      <div
                        className="mt-1 flex flex-wrap items-center gap-1"
                        data-testid={`designer-review-${fl.floor}-${x.position}`}
                      >
                        <span className="text-[10px] text-amber2">
                          Type changed — update area &amp; rate from the new type?
                        </span>
                        {editable && (
                          <>
                            <button
                              type="button"
                              className="text-[10px] font-semibold underline"
                              onClick={() =>
                                run(
                                  () => api.post(`/flats/${x.id}/apply-type-defaults`),
                                  "Updated from flat type",
                                )
                              }
                              data-testid={`designer-apply-${fl.floor}-${x.position}`}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              className="text-[10px] underline"
                              onClick={() =>
                                run(() => api.post(`/flats/${x.id}/keep-values`), "Kept as is")
                              }
                              data-testid={`designer-keep-${fl.floor}-${x.position}`}
                            >
                              No, keep
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {sel.size > 0 && (
        <BulkEditBar
          selectedIds={[...sel]}
          onDone={() => {
            setSel(new Set());
            load();
            onChanged?.();
          }}
          onClear={() => setSel(new Set())}
        />
      )}
    </div>
  );
}
