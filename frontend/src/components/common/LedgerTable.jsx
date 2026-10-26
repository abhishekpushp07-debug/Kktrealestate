import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API, tokens } from "@/lib/api";
import { inr, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_LABEL = { DEMAND: "Due raised", PAYMENT: "Receipt", REVERSAL: "Reversal", REFUND: "Refund", AGREEMENT_CHANGE: "Agreement change", OTHER_CHARGE_DEMAND: "Other charge", OTHER_CHARGE_PAYMENT: "Charge receipt", CANCELLATION: "Cancellation", TRANSFER: "Transfer" };
export const LEDGERS = [["combined", "Combined"], ["cash", "Cash"], ["account", "Account"], ["other", "Other charges"]];

export function Due({ v, testId }) {
  if (v == null) return <span>—</span>;
  if (v < 0) return <span className="font-semibold text-emerald-600 tabular" data-testid={testId}>{inr(-v)} <span className="text-[10px] font-medium">(advance)</span></span>;
  if (v === 0) return <span className="text-txt-secondary tabular" data-testid={testId}>₹0</span>;
  return <span className="font-semibold text-brick tabular" data-testid={testId}>{inr(v)}</span>;
}

export async function downloadCsv(path, filename) {
  const r = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}format=csv`, { headers: { Authorization: `Bearer ${tokens.access}` } });
  const blob = await r.blob();
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

/** Owner's law: Udhar (dues) | Jama (receipts; reversals/refunds negative) | Balance = Σ Udhar − Σ Jama, per ledger. */
export function sideRows(rows, ledger) {
  let bal = 0;
  const out = [];
  for (const r of rows) {
    let udhar = r.udhar || 0, jama = r.jama || 0;
    if (ledger === "cash") { udhar = r.udhar_cash || 0; jama = r.category === "Cash" ? r.jama || 0 : 0; }
    else if (ledger === "account") { udhar = r.udhar_account || 0; jama = r.category === "Account" ? r.jama || 0 : 0; }
    else if (ledger === "other") { udhar = r.type === "OTHER_CHARGE_DEMAND" ? r.udhar || 0 : 0; jama = r.type === "OTHER_CHARGE_PAYMENT" ? r.jama || 0 : 0; }
    if (!udhar && !jama && ledger !== "combined") continue;
    bal += udhar - jama;
    out.push({ ...r, udhar, jama, balance: bal });
  }
  return out;
}

export function LedgerTotals({ rows, advance, testId = "ledger-totals" }) {
  const tu = rows.reduce((s, r) => s + r.udhar, 0), tj = rows.reduce((s, r) => s + r.jama, 0);
  return (
    <div className="grid grid-cols-2 gap-3 border-t bg-warm-50/60 px-4 py-3 text-sm sm:grid-cols-4" data-testid={testId}>
      <div><p className="label-xs">Total Udhar</p><p className="font-semibold tabular text-ink-950" data-testid={`${testId}-udhar`}>{inr(tu)}</p></div>
      <div><p className="label-xs">Total Jama</p><p className="font-semibold tabular text-emerald-700" data-testid={`${testId}-jama`}>{inr(tj)}</p></div>
      <div><p className="label-xs">Balance (Udhar − Jama)</p><p className={cn("font-bold tabular", tu - tj > 0 ? "text-brick" : "text-emerald-700")} data-testid={`${testId}-balance`}>{inr(tu - tj)}</p></div>
      <div><p className="label-xs">Advance held</p><p className="font-semibold tabular text-emerald-700" data-testid={`${testId}-advance`}>{inr(advance ?? Math.max(tj - tu, 0))}</p></div>
    </div>
  );
}

export function LedgerTable({ rows = [], bookingId, bookingNumber, advance }) {
  const { can } = useAuth();
  const [ledger, setLedger] = useState("combined");
  const view = sideRows(rows, ledger);
  return (
    <div className="card overflow-hidden" data-testid="ledger-table">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 print:hidden">
        <div className="flex items-center gap-1" data-testid="ledger-tabs">{LEDGERS.map(([k, l]) => <button key={k} type="button" onClick={() => setLedger(k)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", ledger === k ? "bg-ink-950 text-white" : "bg-warm-50 text-txt-secondary hover:bg-warm-100")} data-testid={`ledger-tab-${k}`}>{l}</button>)}</div>
        <div className="flex gap-2">
          {can("finance.ledger.export") && <Button size="sm" variant="outline" onClick={() => downloadCsv(`/bookings/${bookingId}/ledger`, `ledger-${bookingNumber}.csv`)} data-testid="ledger-export-csv"><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>}
          <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="ledger-print"><Printer className="mr-1 h-3.5 w-3.5" />Print</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead className="bg-warm-50/60 text-left text-[11px] font-semibold uppercase tracking-wide text-txt-secondary">
            <tr>{["Date", "Particulars", "Udhar (₹)", "Jama (₹)", "Mode / Instrument", "Balance (₹)"].map((h, i) => <th key={h} className={`px-3 py-2 ${i === 2 || i === 3 || i === 5 ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {view.map((r) => <tr key={r.seq} className={cn("border-t", r.tag && "bg-brick-50/40", r.type === "DEMAND" && "bg-warm-50/40")} data-testid={`ledger-row-${r.seq}`}>
              <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(r.date)}</td>
              <td className="px-3 py-1.5"><span className="font-medium text-ink-950">{TYPE_LABEL[r.type] || r.type}</span>{r.note && <span className="ml-1 text-txt-secondary">· {r.note}</span>}{r.tag && <span className="ml-2 rounded-full bg-brick-50 px-2 py-0.5 text-[10px] font-bold text-brick" data-testid={`ledger-tag-${r.seq}`}>{r.tag}</span>}{r.ref && <span className="block text-[10px] text-txt-muted">{r.ref}</span>}</td>
              <td className="px-3 py-1.5 text-right tabular" data-testid={`ledger-udhar-${r.seq}`}>{r.udhar ? inr(r.udhar) : ""}</td>
              <td className={cn("px-3 py-1.5 text-right tabular", r.jama < 0 ? "text-brick" : "text-emerald-700")} data-testid={`ledger-jama-${r.seq}`}>{r.jama ? inr(r.jama) : ""}</td>
              <td className="px-3 py-1.5 text-txt-secondary whitespace-nowrap">{r.mode && r.mode !== "Due" ? r.mode : ""}{r.instrument ? ` · ${r.instrument}` : ""}{r.category && r.type !== "DEMAND" ? <span className="ml-1 text-[10px]">({r.category})</span> : null}</td>
              <td className={cn("px-3 py-1.5 text-right font-semibold tabular", r.balance > 0 ? "text-brick" : "text-emerald-700")} data-testid={`ledger-balance-${r.seq}`}>{inr(r.balance)}</td>
            </tr>)}
            {view.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-txt-secondary">No entries in this ledger yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <LedgerTotals rows={view} advance={ledger === "combined" ? advance : undefined} />
    </div>
  );
}
