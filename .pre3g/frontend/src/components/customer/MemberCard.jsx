import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useFetch } from "@/hooks/useList";
import { fmtDate } from "@/lib/format";

const pad3 = (n) => String(n).padStart(3, "0");
const monthYear = (iso) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

function Front({ m }) {
  return (
    <div className="e-mcard" data-testid="member-card-front">
      <img className="mlogo" src="/brand/kkt_logo_night.png" alt="KKT Constructions" />
      <img className="dia" src="/brand/elite_diamond.png" alt="" />
      <div className="mproj">{m.project_name}</div>
      <div className="mcircle">
        {[m.tower, m.flat && `Flat ${m.flat}`].filter(Boolean).join(" · ")}
      </div>
      <div className="mrole">Homeowner · since {monthYear(m.booking_date)}</div>
      <div className="mname">{m.customer_name}</div>
      {m.member_no && (
        <div className="mno" data-testid="member-card-no">
          № <b>{pad3(m.member_no)}</b> / {m.project_units || "—"}
        </div>
      )}
    </div>
  );
}

function Back({ m }) {
  return (
    <div className="e-mcard mback" data-testid="member-card-back">
      <div className="ttl">Booking</div>
      <ul>
        <li>
          Booked {fmtDate(m.booking_date)}
          {m.plan_name ? ` · ${m.plan_name}` : ""}
        </li>
        <li>
          {[
            m.area_sqft && `${Number(m.area_sqft).toLocaleString("en-IN")} sq ft`,
            m.type,
            m.parking?.length ? `parking ${m.parking.join(", ")}` : "no parking",
          ]
            .filter(Boolean)
            .join(" · ")}
        </li>
        <li>
          {m.agreement_signed_on
            ? `Agreement signed ${fmtDate(m.agreement_signed_on)}`
            : "Agreement not signed"}
        </li>
        <li>Relationship manager · {m.relationship_manager || "not assigned"}</li>
      </ul>
      {m.rera_number ? (
        <>
          <div className="qr" data-testid="member-card-qr">
            <QRCodeSVG
              value={`BIHAR RERA ${m.rera_number}`}
              size={78}
              bgColor="transparent"
              fgColor="#dfe4ec"
            />
          </div>
          <div className="rera">
            Bihar RERA
            <br />
            <span>{m.rera_number}</span>
          </div>
        </>
      ) : (
        <>
          <div className="qr empty" data-testid="member-card-qr-empty">
            RERA
            <br />
            QR
          </div>
          <div className="rera">RERA no. not added · add in project</div>
        </>
      )}
      <div className="co">
        <img src="/brand/kkt_logo_night.png" alt="" />
        <div>
          {m.company_name}
          <small>{m.company_address}</small>
        </div>
      </div>
    </div>
  );
}

/** REQ-186…189: the owner's Elite member card; tap flips front ↔ back. */
export function MemberCards({ customerId }) {
  const { data } = useFetch(`/customers/${customerId}/member-cards`);
  const [i, setI] = useState(0);
  const [back, setBack] = useState(false);
  const cards = data?.cards || [];
  if (!cards.length) return null;
  const m = cards[Math.min(i, cards.length - 1)];
  return (
    <div className="shrink-0" data-testid="member-card">
      <button
        type="button"
        className={`e-flip ${back ? "is-back" : ""}`}
        onClick={() => setBack((v) => !v)}
        aria-label={back ? "Show card front" : "Show card back"}
        data-testid="member-card-flip"
      >
        <div className="e-flip-in">
          <Front m={m} />
          <Back m={m} />
        </div>
      </button>
      <div className="mt-2 flex items-center justify-between text-xs text-txt-muted">
        <span>tap the card to see its {back ? "front" : "back"} ›</span>
        {cards.length > 1 && (
          <span className="flex gap-1">
            {cards.map((x, n) => (
              <button
                key={x.booking_id}
                type="button"
                onClick={() => {
                  setI(n);
                  setBack(false);
                }}
                className={`rounded-full px-2 py-0.5 ${n === i ? "bg-gold-light text-gold" : ""}`}
                data-testid={`member-card-pick-${n}`}
              >
                {x.flat}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
