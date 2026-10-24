import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API, tokens } from "@/lib/api";
import { inr, fmtDate } from "@/lib/format";

const TYPE_LABEL = { DEMAND: "Demand", PAYMENT: "Payment", REVERSAL: "Reversal", AGREEMENT_CHANGE: "Agreement change", OTHER_CHARGE_DEMAND: "Charge demand", OTHER_CHARGE_PAYMENT: "Charge payment", CANCELLATION: "Cancellation" };

export function Due({ v, testId }) {
  if (v == null) return <span>—</span>;
  if (v < 0) return <span className="font-semibold text-emerald-600 tabular" data-testid={testId}>{inr(-v)} <span className="text-[10px] font-medium">(advance)</span></span>;
  if (v === 0) return <span className="text-slate-500 tabular" data-testid={testId}>₹0</span>;
  return <span className="font-semibold text-red-600 tabular" data-testid={testId}>{inr(v)}</span>;
}

export async function downloadCsv(path, filename) {
  const r = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}format=csv`, { headers: { Authorization: `Bearer ${tokens.access}` } });
  const blob = await r.blob();
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

export function LedgerTable({ rows = [], bookingId, bookingNumber }) {
  return (
    <div className="card-elev overflow-hidden" data-testid="ledger-table">
      <div className="flex items-center justify-between border-b px-4 py-2 print:hidden">
        <p className="text-sm font-semibold text-navy">Ledger · {rows.length} entries</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadCsv(`/bookings/${bookingId}/ledger`, `ledger-${bookingNumber}.csv`)} data-testid="ledger-export-csv"><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="ledger-print"><Printer className="mr-1 h-3.5 w-3.5" />Print</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[13px]">
          <thead className="bg-surface label-xs">
            <tr>{["#", "Date", "Type", "Construction %", "Category", "Amount", "Cash paid (cum)", "Account paid (cum)", "Cash order raised", "Account order raised", "Cash due", "Account due", "Total due", "Ref"].map((h, i) => <th key={h} className={`px-2 py-2 ${i >= 5 && i <= 12 ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => <tr key={r.seq} className={`border-t ${r.type === "REVERSAL" ? "bg-red-50/40" : r.type === "DEMAND" ? "bg-slate-50/60" : ""}`} data-testid={`ledger-row-${r.seq}`}>
              <td className="px-2 py-1.5 text-slate-500">{r.seq}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{fmtDate(r.date)}</td>
              <td className="px-2 py-1.5 font-medium text-navy whitespace-nowrap">{TYPE_LABEL[r.type] || r.type}{r.note && <span className="block text-[10px] font-normal text-slate-500">{r.note}</span>}</td>
              <td className="px-2 py-1.5">{r.construction_percent}%</td>
              <td className="px-2 py-1.5">{r.category || "—"}</td>
              <td className={`px-2 py-1.5 text-right tabular font-semibold ${r.amount < 0 ? "text-red-600" : ""}`}>{inr(r.amount)}</td>
              <td className="px-2 py-1.5 text-right tabular">{inr(r.cash_paid_cum)}</td>
              <td className="px-2 py-1.5 text-right tabular">{inr(r.account_paid_cum)}</td>
              <td className="px-2 py-1.5 text-right tabular">{inr(r.cash_order_raised)}</td>
              <td className="px-2 py-1.5 text-right tabular">{inr(r.account_order_raised)}</td>
              <td className="px-2 py-1.5 text-right"><Due v={r.cash_due} /></td>
              <td className="px-2 py-1.5 text-right"><Due v={r.account_due} /></td>
              <td className="px-2 py-1.5 text-right"><Due v={r.total_due} testId={`ledger-total-due-${r.seq}`} /></td>
              <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{r.ref || ""}</td>
            </tr>)}
            {rows.length === 0 && <tr><td colSpan={14} className="px-4 py-8 text-center text-slate-500">No ledger entries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
