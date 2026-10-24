import { useNavigate } from "react-router-dom";
import { FileSignature, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useList } from "@/hooks/useList";
import { DataTable } from "@/components/common/DataTable";
import { PageHeader } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { Due } from "@/components/common/LedgerTable";
import { Button } from "@/components/ui/button";
import { inr, fmtDate } from "@/lib/format";

export const BOOKING_TONE = { Active: "navy", Cancelled: "red", Completed: "emerald" };

export default function Bookings() {
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useList("/bookings", {}, { sort: "-booking_date" });
  const columns = [
    { key: "booking_number", label: "Booking", sortable: true, render: (b) => <span className="font-mono text-xs font-semibold text-navy">{b.booking_number}</span> },
    { key: "customer_name", label: "Customer", sortable: true, render: (b) => <div><p className="font-semibold text-navy">{b.customer_name}</p><p className="text-xs text-slate-500">{b.customer_code}</p></div> },
    { key: "flat", label: "Unit", render: (b) => <span>{b.project_code} · {b.flat_snapshot?.flat_number} <span className="text-xs text-slate-500">{b.flat_snapshot?.flat_type_code}</span></span> },
    { key: "booking_date", label: "Date", sortable: true, render: (b) => fmtDate(b.booking_date) },
    { key: "agreement_value", label: "Agreement", align: "right", render: (b) => <span className="tabular font-semibold">{inr(b.agreement_value)}</span> },
    { key: "construction_percent", label: "Constr.", render: (b) => `${b.construction_percent}%` },
    { key: "paid", label: "Paid", align: "right", render: (b) => <span className="tabular text-emerald-700">{inr(b.summary?.paid)}</span> },
    { key: "due", label: "Due", align: "right", render: (b) => <Due v={b.summary?.due} /> },
    { key: "status", label: "Status", sortable: true, render: (b) => <Pill tone={BOOKING_TONE[b.status]}>{b.status}</Pill> },
  ];
  return (
    <div data-testid="bookings-page">
      <PageHeader title="Bookings" subtitle="Agreements, demands and collections per unit." actions={can("booking.create") && <Button onClick={() => nav("/erp/bookings/new")} className="bg-navy hover:bg-navy-700" data-testid="new-booking-btn"><Plus className="mr-1 h-4 w-4" />New booking</Button>} />
      <DataTable {...list} columns={columns} testId="bookings-table" exportPath="/bookings" searchPlaceholder="Booking no., customer, flat…" onRowClick={(b) => nav(`/erp/bookings/${b.id}`)} empty={{ icon: FileSignature, title: "No bookings yet" }} />
    </div>
  );
}
