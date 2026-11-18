import { useRef, useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useCatalogues } from "@/hooks/useCatalogues";
import { Combobox } from "@/components/common/Combobox";
import { fmtDate } from "@/lib/format";

const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (path, v) => {
  const [h, ...r] = path.split(".");
  return r.length ? { [h]: { [r.join(".")]: v } } : { [h]: v };
};

/** One inline-editable row: click pencil → input/dropdown → Enter/blur saves via PATCH /customers/{id} (audited, version-checked). */
function Row({ c, field, onSaved, canEdit }) {
  const { opts } = useCatalogues();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(get(c, field.path) ?? "");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const save = async (val) => {
    if (saving.current) return; // Enter + unmount-blur both fire — one PATCH only
    saving.current = true;
    if ((val ?? "") === (get(c, field.path) ?? "")) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      let body = setPath(field.path, val === "" ? null : val);
      if (
        field.path.startsWith("bank.") ||
        field.path.startsWith("nominee.") ||
        field.path.startsWith("address_current.")
      ) {
        const [h, k] = field.path.split(".");
        body = { [h]: { ...(c[h] || {}), [k]: val === "" ? null : val } };
        if (h === "bank" && !c.bank?.account_number && k !== "account_number")
          delete body.bank.account_number;
      }
      const r = await api.patch(`/customers/${c.id}`, { ...body, version: c.version });
      toast.success(`${field.label} saved`);
      onSaved(r.data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      setEditing(false);
    }
  };
  const tid = `inline-${field.path.replace(/\./g, "-")}`;
  const display = field.catalogue
    ? opts(field.catalogue).find((o) => o.value === v)?.label || v
    : field.type === "date"
      ? v
        ? fmtDate(v)
        : ""
      : v;
  return (
    <div
      className="flex items-center justify-between gap-3 py-1 text-sm"
      data-testid={`${tid}-row`}
    >
      <dt className="shrink-0 text-txt-secondary">{field.label}</dt>
      {editing ? (
        field.catalogue ? (
          <Combobox
            options={opts(field.catalogue)}
            value={v}
            onChange={(x) => {
              setV(x);
              save(x);
            }}
            className="!h-8 min-w-[180px]"
            testId={tid}
          />
        ) : (
          <input
            autoFocus
            type={field.type || "text"}
            value={v}
            disabled={busy}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => save(v)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save(v);
              if (e.key === "Escape") {
                setV(get(c, field.path) ?? "");
                setEditing(false);
              }
            }}
            className="input !h-8 w-44 text-right"
            data-testid={tid}
          />
        )
      ) : (
        <dd className="flex items-center gap-1.5 text-right font-medium text-ink-950">
          <span data-testid={`${tid}-value`}>{display || "—"}</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                saving.current = false;
                setEditing(true);
              }}
              className="rounded p-0.5 text-txt-muted hover:text-ink-950"
              aria-label={`Edit ${field.label}`}
              data-testid={`${tid}-edit`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
        </dd>
      )}
    </div>
  );
}

export const PROFILE_FIELDS = [
  { path: "salutation", label: "Salutation", catalogue: "salutation" },
  { path: "full_name", label: "Full name" },
  { path: "father_or_spouse_name", label: "Father / spouse" },
  { path: "dob", label: "Date of birth", type: "date" },
  { path: "gender", label: "Gender", catalogue: "gender" },
  { path: "residency_id", label: "Residency", catalogue: "residency" },
  { path: "occupation_id", label: "Occupation", catalogue: "occupation" },
  { path: "company_name", label: "Company" },
  { path: "income_band_id", label: "Income band", catalogue: "income_band" },
  { path: "source_id", label: "Source", catalogue: "lead_source" },
];
export const CONTACT_FIELDS = [
  { path: "phone", label: "Phone" },
  { path: "alt_phone", label: "Alt phone" },
  { path: "whatsapp_phone", label: "WhatsApp" },
  { path: "email", label: "Email", type: "email" },
  { path: "address_current.line1", label: "Address line 1" },
  { path: "address_current.line2", label: "Address line 2" },
  { path: "address_current.city", label: "City" },
  { path: "address_current.state", label: "State" },
  { path: "address_current.pincode", label: "PIN" },
];
export const KYC_FIELDS = [
  { path: "pan", label: "PAN" },
  { path: "aadhaar", label: "Aadhaar" },
];
export const BANK_FIELDS = [
  { path: "bank.bank_name", label: "Bank" },
  { path: "bank.account_number", label: "Account no." },
  { path: "bank.ifsc", label: "IFSC" },
];
export const NOMINEE_FIELDS = [
  { path: "nominee.name", label: "Nominee" },
  { path: "nominee.relation", label: "Relation", catalogue: "relation" },
  { path: "nominee.dob", label: "Nominee DOB", type: "date" },
];

export function InlineGroup({ c, fields, onSaved, canEdit, testId }) {
  return (
    <dl className="divide-y divide-warm-100" data-testid={testId}>
      {fields.map((f) => (
        <Row key={f.path} c={c} field={f} onSaved={onSaved} canEdit={canEdit} />
      ))}
    </dl>
  );
}
