import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export const completeness = (c) => {
  const checks = [
    ["Email", !!c.email, "contact"], ["City", !!(c.city_id || c.address_current?.city), "address"], ["Locality", !!c.locality_id, "address"], ["Occupation", !!(c.occupation_id || c.occupation), "profile"],
    ["Income band", !!(c.income_band_id || c.annual_income_band), "profile"], ["Lead source", !!(c.source_id || c.source), "profile"], ["Segments", (c.segment_ids || []).length > 0, "profile"],
    ["Preferences", (c.preferences?.bhk_ids || []).length > 0 || !!c.preferences?.budget_band_id, "preferences"], ["PAN", !!(c.pan_masked || c.pan), "kyc"], ["Aadhaar", !!(c.aadhaar_masked || c.aadhaar), "kyc"], ["Bank", !!c.bank?.bank_name, "kyc"], ["Nominee", !!c.nominee?.name, "nominee"],
  ];
  const missing = checks.filter(([, ok]) => !ok);
  return { pct: Math.round(((checks.length - missing.length) / checks.length) * 100), missing };
};

export function CompletenessRing({ customer, size = 64, children }) {
  const { pct, missing } = completeness(customer);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const setOpen = setPinned;
  const r = (size + 8) / 2 - 2, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size + 8, height: size + 8 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <svg className="absolute inset-0 -rotate-90" width={size + 8} height={size + 8} aria-hidden><circle cx={(size + 8) / 2} cy={(size + 8) / 2} r={r} fill="none" stroke="#EAE4D8" strokeWidth="3" /><circle cx={(size + 8) / 2} cy={(size + 8) / 2} r={r} fill="none" stroke="#C9A227" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 600ms ease-out" }} /></svg>
      <div className="absolute inset-1">{children}</div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="absolute -bottom-1 -right-1 grid h-6 min-w-[24px] place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-ink-950 shadow" aria-label={`Profile ${pct}% complete`} aria-expanded={open} data-testid="profile-completeness">{pct}%</button>
      {open && <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-warm-200 bg-white p-3 text-xs shadow-lg" role="dialog" data-testid="completeness-popover">
        <p className="font-semibold text-ink-950">Profile {pct}% complete</p>
        {missing.length === 0 ? <p className="mt-1 text-sage">Everything is filled in.</p> : <ul className="mt-2 space-y-1">{missing.map(([l, , sec]) => <li key={l}><Link to={`/customers/${customer.id}/edit#${sec}`} className={cn("flex items-center justify-between rounded-lg px-2 py-1 text-txt-secondary hover:bg-warm-100 hover:text-ink-950")} data-testid={`completeness-missing-${l.toLowerCase().replace(/\s+/g, "-")}`}><span>{l}</span><span className="text-[10px] uppercase tracking-wider text-txt-muted">add →</span></Link></li>)}</ul>}
      </div>}
    </div>
  );
}
