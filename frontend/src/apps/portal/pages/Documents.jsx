import { FileText, Download } from "lucide-react";
import { toast } from "sonner";
import { Empty, PageTitle, Skeleton } from "../PortalShell";
import { fmtDate, useActiveBooking, useBookingSub } from "../hooks";
import { openPdf, perr } from "../api";
import { BookingSwitcher } from "./Home";

export default function Documents() {
  const { items, active, select, isLoading } = useActiveBooking();
  const { data, isLoading: l2 } = useBookingSub(active?.id, "documents");
  if (isLoading || l2) return <div className="space-y-4"><Skeleton h={48} /><Skeleton h={200} /></div>;
  if (!active) return <Empty title="No booking yet" icon={FileText} />;
  const dl = async (path, name) => { try { await openPdf(path, name); } catch (e) { toast.error(perr(e)); } };
  return (
    <div data-testid="portal-documents">
      <PageTitle title="Documents" sub="Letters and files shared by KKT for your booking." />
      <BookingSwitcher items={items} active={active} select={select} />
      <div className="pcard mb-4 p-5 fade-up"><p className="font-bold text-[#0B1F3A]">Generated for you</p>
        <div className="row"><div><p className="font-semibold text-[#0B1F3A]">Allotment letter</p><p className="text-xs text-slate-500">{active.booking_number}</p></div><button onClick={() => dl(`/bookings/${active.id}/allotment.pdf`, `allotment-${active.booking_number}.pdf`)} className="pbtn pbtn-sm pbtn-ghost" data-testid="doc-allotment-pdf"><Download className="h-4 w-4" />PDF</button></div>
        <div className="row"><div><p className="font-semibold text-[#0B1F3A]">Account statement</p><p className="text-xs text-slate-500">Full ledger to date</p></div><button onClick={() => dl(`/bookings/${active.id}/statement.pdf`, `statement-${active.booking_number}.pdf`)} className="pbtn pbtn-sm pbtn-ghost" data-testid="doc-statement-pdf"><Download className="h-4 w-4" />PDF</button></div>
      </div>
      {data?.items?.length ? <div className="pcard px-5 fade-up" data-testid="shared-documents"><p className="pt-5 font-bold text-[#0B1F3A]">Shared files</p>{data.items.map((d) => <div key={d.id} className="row" data-testid={`shared-doc-${d.id}`}><div className="min-w-0"><p className="truncate font-semibold text-[#0B1F3A]">{d.title || d.file_name}</p><p className="text-xs text-slate-500">{d.document_type_name} · {fmtDate(d.created_at)} · {(d.size / 1024).toFixed(0)} KB</p></div><button onClick={() => dl(`/bookings/${active.id}/documents/${d.id}/download`, d.file_name)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F8F6F1] text-[#0B1F3A]" aria-label="Download" data-testid={`shared-doc-dl-${d.id}`}><Download className="h-4 w-4" /></button></div>)}</div> : <Empty title="No shared files yet" hint="Your RM can share signed copies here." icon={FileText} />}
    </div>
  );
}
