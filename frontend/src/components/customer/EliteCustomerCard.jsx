import { Link } from "react-router-dom";
import { MessageCircle, Phone, Receipt } from "lucide-react";
import { fmtDate, inr, inrShort } from "@/lib/format";

const TINT = {
  overdue: { card: "wine", dot: "#ff6a4d", cap: "#ff8a6a", ring: "#ff7a59", cta: "coral" },
  due: { card: "", dot: "#5b8cff", cap: "#7aa6ff", ring: "#3d7bff", cta: "blue" },
  clear: { card: "calm", dot: "#5ed3a2", cap: "#7fe0b6", ring: "#5ed3a2", cta: "ghost" },
};
const pad3 = (n) => String(n).padStart(3, "0");
const stop = (e) => e.stopPropagation();
const short = (p) => inrShort((p || 0) / 100);

function stateOf(k) {
  if (!k) return "clear";
  if (k.overdue_paise > 0) return "overdue";
  if (k.due_paise > 0) return "due";
  return "clear";
}

// Card status set (rendered caps via .e-jcap): OVERDUE N DAYS · DUE ON <date> · DUE TODAY · ADVANCE HELD ·
// NEXT · <stage> BILL · ALL CLEAR · NO BOOKING YET. Overdue = definitions.ageing_bands (incl. other charges).
function capOf(k, st) {
  if (!k) return "No booking yet";
  if (st === "overdue") return `Overdue ${k.overdue_days} days`;
  if (st === "due")
    return k.next?.kind === "bill" && k.next.due_date
      ? `Due on ${fmtDate(k.next.due_date).replace(/ \d{4}$/, "")}`
      : "Due today";
  if (k.advance_paise > 0) return "Advance held";
  if (k.next?.kind === "awaiting") return `Next · ${k.next.stage} bill`;
  return "All clear";
}

function metaOf(k, b) {
  if (!b) return "no booking yet · open to start one";
  if (k.next?.kind === "awaiting" && !(k.due_paise > 0))
    return `next · ${k.next.stage} · awaiting stage`;
  return [b.plan_name, b.stage_n ? `stage ${b.stage_k} of ${b.stage_n}` : null, b.current_stage]
    .filter(Boolean)
    .join(" · ");
}

function pillOf(c, st) {
  if (c.follow_up_today) return ["follow-up today", "#ffb39f"];
  if (c.kyc_status && c.kyc_status !== "Verified") return ["kyc pending", "#f5c07a"];
  if (c.card?.agreement_pending) return ["agreement pending", "#f5c07a"];
  if (st === "clear") return ["all clear", "#9fe3c4"];
  return ["kyc ✓", "#9fe3c4"];
}

/** REQ-191/192: customer list card — every figure from services/cards.py (tie-out). */
export function EliteCustomerCard({ c }) {
  const k = c.card;
  const bks = k?.bookings || [];
  const b = bks.find((x) => x.due_paise > 0) || bks[0];
  const st = stateOf(k);
  const t = TINT[st];
  const pct = k?.billed_paise
    ? Math.min(100, Math.round((k.received_paise * 100) / k.billed_paise))
    : k
      ? 100
      : 0;
  const third =
    k?.advance_paise > 0 && !(k.due_paise > 0)
      ? ["advance", k.advance_paise, "#7fe0b6"]
      : ["due", k?.due_paise || 0, k?.due_paise ? "#ff8f75" : undefined];
  const [pill, pillColor] = pillOf(c, st);
  const wa = (c.phone || "").replace(/\D/g, "");
  const collect = k?.due_paise > 0 && b;
  return (
    <article className={`e-jcard ${t.card}`} data-testid={`customer-card-${c.customer_code}`}>
      <div className="jlat" aria-hidden="true" />
      <div className="flex items-center justify-between gap-3">
        <span
          className="e-jtag"
          title={bks
            .map((x) => [x.project_code, x.tower, x.flat].filter(Boolean).join(" · "))
            .join(", ")}
        >
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: t.dot, boxShadow: `0 0 10px ${t.dot}` }}
          />
          {b ? [b.project_code, b.tower, b.flat].filter(Boolean).join(" · ") : c.phone}
          {bks.length > 1 && ` +${bks.length - 1}`}
        </span>
        {b?.member_no && (
          <span
            className="e-jno shrink-0 pl-2"
            data-testid={`customer-member-no-${c.customer_code}`}
          >
            № {pad3(b.member_no)}
            <span className="hidden min-[400px]:inline"> / {b.project_units || "—"}</span>
          </span>
        )}
      </div>
      <div className="mt-[18px] flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p
            className="e-jcap"
            style={{ color: t.cap }}
            data-testid={`customer-status-${c.customer_code}`}
          >
            {capOf(k, st)}
          </p>
          <Link
            to={`/customers/${c.id}`}
            className="e-jname block truncate hover:underline"
            data-testid={`customer-open-${c.customer_code}`}
          >
            {c.salutation ? `${c.salutation} ` : ""}
            {c.full_name}
          </Link>
        </div>
        {k && (
          <div
            className="e-jring relative"
            style={{
              background: `conic-gradient(${t.ring} 0 ${pct}%, rgba(255,255,255,.09) ${pct}% 100%)`,
            }}
          >
            <div>
              {pct}%<small>received</small>
            </div>
          </div>
        )}
      </div>
      {k && (
        <div
          className="e-jstats"
          title={`billed ${inr(k.billed_paise / 100)} · received ${inr(k.received_paise / 100)}`}
        >
          <div>
            <b>{short(k.billed_paise)}</b>
            <span>billed</span>
          </div>
          <div>
            <b>{short(k.received_paise)}</b>
            <span>received</span>
          </div>
          <div data-testid={`customer-balance-${c.customer_code}`}>
            <b style={third[2] ? { color: third[2] } : undefined}>{short(third[1])}</b>
            <span>{third[0]}</span>
          </div>
        </div>
      )}
      <div className="e-jmeta">
        <span className="min-w-0 truncate" data-testid={`customer-next-${c.customer_code}`}>
          {metaOf(k, b)}
        </span>
        <span className="e-jpill" style={{ color: pillColor }}>
          {pill}
        </span>
      </div>
      {collect ? (
        <Link
          to={`/bookings/${b.id}?pay=1`}
          className={`e-jcta ${t.cta}`}
          data-testid={`record-payment-${c.customer_code}`}
        >
          Collect {short(k.due_paise)} ›
        </Link>
      ) : (
        <Link
          to={`/customers/${c.id}`}
          className="e-jcta ghost"
          data-testid={`customer-cta-${c.customer_code}`}
        >
          Open customer ›
        </Link>
      )}
      <div className="e-jacts">
        <a
          href={`tel:${c.phone}`}
          onClick={stop}
          aria-label={`Call ${c.full_name}`}
          data-testid={`call-${c.customer_code}`}
        >
          <Phone className="h-3.5 w-3.5" /> call
        </a>
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          aria-label={`WhatsApp ${c.full_name}`}
          data-testid={`whatsapp-${c.customer_code}`}
        >
          <MessageCircle className="h-3.5 w-3.5" /> whatsapp
        </a>
        {b && !collect && (
          <Link to={`/bookings/${b.id}?pay=1`} data-testid={`record-payment-${c.customer_code}`}>
            <Receipt className="h-3.5 w-3.5" /> record payment
          </Link>
        )}
      </div>
    </article>
  );
}
