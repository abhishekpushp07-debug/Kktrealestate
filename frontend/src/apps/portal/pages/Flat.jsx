import { useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { PageTitle, Skeleton } from "../PortalShell";
import { fmtDate, inr, useBookingSub } from "../hooks";
import { openPdf } from "../api";

const KV = ({ k, v, testId }) => <div className="row"><span className="text-sm text-slate-500">{k}</span><span className="text-right text-sm font-semibold text-[#0B1F3A]" data-testid={testId}>{v ?? "—"}</span></div>;

export default function Flat() {
  const { id } = useParams();
  const { data: b, isLoading } = useBookingSub(id, "");
  if (isLoading || !b) return <div className="space-y-4"><Skeleton h={48} /><Skeleton h={220} /><Skeleton h={180} /></div>;
  return (
    <div data-testid="portal-flat">
      <PageTitle title={`Flat ${b.flat_number}`} sub={`${b.project_name} · ${b.block_name} · ${b.booking_number}${b.co_applicant ? " · you are a co-applicant" : ""}`} right={<button onClick={() => openPdf(`/bookings/${b.id}/allotment.pdf`, `allotment-${b.booking_number}.pdf`)} className="pbtn pbtn-sm pbtn-ghost" data-testid="flat-allotment-pdf"><Download className="h-4 w-4" />Allotment</button>} />
      {(b.flat.floor_plan_image || b.cover_image) && <img src={b.flat.floor_plan_image || b.cover_image} alt="Floor plan" loading="lazy" className="pcard mb-4 w-full object-cover fade-up" style={{ maxHeight: 320 }} data-testid="flat-plan-image" />}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="pcard p-5 fade-up"><p className="font-bold text-[#0B1F3A]">Unit details</p>
          <KV k="Type" v={`${b.flat.type_name || b.flat_type}${b.flat.bhk ? ` · ${b.flat.bhk} BHK` : ""}`} /><KV k="Floor" v={b.floor} /><KV k="Super built-up" v={`${b.super_builtup_sqft} sq.ft.`} /><KV k="Facing" v={b.flat.facing} /><KV k="Booking date" v={fmtDate(b.booking_date)} /><KV k="Status" v={b.status} testId="flat-status" />
          {b.parking?.length > 0 && <KV k="Parking" v={b.parking.map((p) => `${p.slot_number}${p.level ? ` (${p.level})` : ""}`).join(", ")} />}
          {b.rera_number && <KV k="RERA" v={b.rera_number} />}
        </div>
        <div className="pcard p-5 fade-up"><p className="font-bold text-[#0B1F3A]">Price breakup</p>
          <KV k="Agreement value" v={inr(b.price_breakup.agreement_value)} testId="flat-agreement-value" /><KV k="Cash component" v={inr(b.price_breakup.cash)} /><KV k="Account component" v={inr(b.price_breakup.account)} />
          {b.price_breakup.other_charges.map((c) => <KV key={c.name} k={c.name} v={`${inr(c.total)}${c.paid ? ` · paid ${inr(c.paid)}` : ""}`} />)}
          {b.agreement_revisions?.length > 0 && <p className="mt-3 text-xs text-slate-500">Revised {b.agreement_revisions.length}× — latest {fmtDate(b.agreement_revisions.at(-1)?.at)}</p>}
        </div>
        {b.flat.rooms?.length > 0 && <div className="pcard p-5 fade-up"><p className="font-bold text-[#0B1F3A]">Rooms</p>{b.flat.rooms.map((r, i) => <KV key={i} k={r.label || r.room} v={r.length_ft && r.width_ft ? `${r.length_ft}' × ${r.width_ft}'` : "—"} />)}</div>}
        {(b.flat.areas?.length > 0 || Object.keys(b.flat.specifications || {}).length > 0) && <div className="pcard p-5 fade-up"><p className="font-bold text-[#0B1F3A]">Areas & specifications</p>{b.flat.areas.map((a, i) => <KV key={i} k={a.area} v={`${a.sqft} sq.ft.`} />)}{Object.entries(b.flat.specifications || {}).map(([k, v]) => <KV key={k} k={k} v={String(v)} />)}</div>}
      </div>
      {b.relationship_manager && <p className="mt-4 text-center text-xs text-slate-500">Relationship Manager: {b.relationship_manager.name}{b.relationship_manager.phone ? ` · ${b.relationship_manager.phone}` : ""}</p>}
    </div>
  );
}
