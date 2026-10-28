import { useRef, useState } from "react";
import { Check, Lock, Upload, X } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { uploadResumable } from "@/components/common/ResumableUpload";

export const KYC_KINDS = [["kyc_pan", "PAN"], ["kyc_aadhaar", "Aadhaar"], ["kyc_other", "Other ID"]];
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic";

/** Z.2 — one upload slot per KYC kind for a co-applicant. `value` = {kyc_pan: fileId|null, ...}; `coId` is the co-applicant id (client uuid in the wizard). */
export function KycSlots({ coId, value = {}, onChange, customerId, bookingId, compact, testId = "kyc" }) {
  const { can } = useAuth();
  const canOpen = can("sales.kyc.reveal") || can("sales.customer.edit");
  return (
    <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")} data-testid={`${testId}-slots`}>
      {KYC_KINDS.map(([kind, label]) => <Slot key={kind} kind={kind} label={label} coId={coId} fileId={value[kind]} canOpen={canOpen} canEdit={can("sales.customer.edit")} customerId={customerId} bookingId={bookingId}
        onUploaded={(f) => onChange?.({ ...value, [kind]: f.id })} testId={`${testId}-${kind.replace("kyc_", "")}`} />)}
    </div>
  );
}

function Slot({ kind, label, coId, fileId, canOpen, canEdit, customerId, bookingId, onUploaded, testId }) {
  const ref = useRef();
  const [pct, setPct] = useState(null);
  const pick = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error(`${label}: file must be 10 MB or smaller`);
    setPct(0);
    try {
      const f = await uploadResumable(file, { entity_type: "co_applicant", entity_id: coId, kind, customer_id: customerId || undefined, booking_id: bookingId || undefined }, setPct);
      onUploaded?.(f);
      toast.success(`${label} uploaded`);
    } catch (e) { toast.error(errMsg(e)); } finally { setPct(null); }
  };
  const open = async () => {
    try { const r = await api.get(`/files/${fileId}/url`); window.open(r.data.url, "_blank", "noopener"); } catch (e) { toast.error(errMsg(e)); }
  };
  const done = Boolean(fileId);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", done ? "border-sage/40 bg-sage/10 text-sage-700" : kind === "kyc_other" ? "border-warm-200 text-txt-muted" : "border-brick/30 bg-brick/5 text-brick")} data-testid={testId} data-state={done ? "done" : "missing"}>
      {done ? (canOpen ? <button type="button" onClick={open} className="inline-flex items-center gap-1 hover:underline" data-testid={`${testId}-open`}><Check className="h-3 w-3" />{label} ✓</button> : <span className="inline-flex items-center gap-1" title="Masked — KYC permission required"><Lock className="h-3 w-3" />{label}</span>)
        : <span>{label} {kind === "kyc_other" ? "" : "missing"}</span>}
      {canEdit && pct == null && <button type="button" onClick={() => ref.current?.click()} className="ml-0.5 rounded-full p-0.5 hover:bg-black/5" aria-label={`Upload ${label}`} data-testid={`${testId}-upload`}><Upload className="h-3 w-3" /></button>}
      {pct != null && <span className="tabular-nums">{pct}%</span>}
      <input ref={ref} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} data-testid={`${testId}-input`} />
    </span>
  );
}

/** Compact completeness badge for cards: "KYC complete 2/2" or "Missing: Aadhaar – Sita". */
export function KycBadge({ k, testId = "kyc-badge" }) {
  if (!k || !k.total) return null;
  const txt = k.complete ? `KYC complete ${k.done}/${k.total}` : `Missing: ${k.missing.slice(0, 2).map((m) => `${m.label} – ${m.name}`).join(", ")}${k.missing.length > 2 ? ` +${k.missing.length - 2}` : ""}`;
  return <span className={cn("pill", k.complete ? "bg-sage/10 text-sage-700" : "bg-brick/10 text-brick")} data-testid={testId} title={`${k.done}/${k.total} KYC files`}>{k.complete ? <Check className="mr-1 inline h-3 w-3" /> : <X className="mr-1 inline h-3 w-3" />}{txt}</span>;
}
