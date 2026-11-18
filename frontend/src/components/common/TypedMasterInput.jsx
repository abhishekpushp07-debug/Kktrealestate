import { useEffect, useMemo, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { invalidateCatalogues, useCatalogues } from "@/hooks/useCatalogues";

const LIST_NAME = {
  lead_source: "Lead sources",
  lost_reason: "Lost reasons",
  bank: "Banks",
  visit_outcome: "Visit outcomes",
  cancel_reason: "Cancellation reasons",
  revision_reason: "Revision reasons",
  void_reason: "Void reasons",
  reversal_reason: "Reversal reasons",
  transfer_reason: "Transfer reasons",
  discount_reason: "Discount reasons",
  waiver_reason: "Waiver reasons",
  flat_status_reason: "Flat status reasons",
  inventory_reason: "Inventory reasons",
};

/** REQ-133…135: type any value (one-off is fine); on its 3rd use, offer "Save to master" inline — counted by the server. */
export function TypedMasterInput({
  list,
  value,
  onChange,
  testId,
  excludeId,
  placeholder,
  className,
}) {
  const { opts } = useCatalogues();
  const { can } = useAuth();
  const options = useMemo(() => opts(list) || [], [opts, list]);
  const [offer, setOffer] = useState(null);
  const [saving, setSaving] = useState(false);
  const v = (value || "").trim();
  const known = options.some((o) => o.label.toLowerCase() === v.toLowerCase());
  useEffect(() => {
    setOffer(null);
    if (!v || known || !can("masters.catalogue.create")) return undefined;
    const t = setTimeout(() => {
      api
        .get(`/catalogues/${list}/typed-value`, { params: { value: v, exclude_id: excludeId } })
        .then((r) => setOffer(r.data.offer ? r.data : null))
        .catch(() => setOffer(null));
    }, 300);
    return () => clearTimeout(t);
  }, [v, known, list, excludeId, can]);
  const save = async () => {
    setSaving(true);
    try {
      const r = await api.post(`/catalogues/${list}/items`, { label: v });
      await invalidateCatalogues();
      onChange(r.data.label);
      setOffer(null);
      toast.success(`"${r.data.label}" saved to ${LIST_NAME[list] || "the list"} and selected`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={className}>
      <input
        className="input"
        list={`${testId}-options`}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Pick or type"}
        autoComplete="off"
        data-testid={testId}
      />
      <datalist id={`${testId}-options`}>
        {options.map((o) => (
          <option key={o.value} value={o.label} />
        ))}
      </datalist>
      {offer && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-gold/40 bg-gold-light px-3 py-1.5 text-xs text-ink-950"
          data-testid={`${testId}-save-offer`}
        >
          <span>
            “{offer.value}” was typed on {offer.earlier_uses} earlier entries.
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1 font-semibold underline"
            data-testid={`${testId}-save-to-master`}
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            {saving ? "Saving…" : `Save to ${LIST_NAME[list] || "master"}`}
          </button>
        </div>
      )}
    </div>
  );
}
