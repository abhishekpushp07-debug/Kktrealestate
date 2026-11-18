import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  IndianRupee,
  Layers,
  MessageCircle,
  Phone,
} from "lucide-react";
import {
  EliteHero,
  MoneyPill,
  Ring,
  RoundIcon,
  SectionHead,
  Stats,
  initials,
} from "@/components/elite";
import { rs } from "./WidgetCard";

const onlyDigits = (p) => (p || "").replace(/\D/g, "");
const dayCaps = (day) =>
  day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";

/** REQ-179 "Money today" — the one Elite hero on Home; every figure still drills to its list. */
export function MoneyTodayHero({ d, month, day }) {
  const pct = month?.recovery_pct;
  return (
    <section data-testid="widget-money_today">
      <SectionHead title="Money today" to="/roznamcha" link="view roznamcha" />
      <EliteHero testId="money-today-hero" className="metal">
        <div className="flex items-center justify-between">
          <span className="e-tag">
            <span className="e-dot" />
            Live · Today
          </span>
          <span className="e-caps !text-[#8a93a6]">{dayCaps(day)}</span>
        </div>
        <div className="mt-[18px] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="e-caps-blue">Received today</p>
            <Link
              to={d.total.drill?.to || "/payments"}
              className="e-stmt block hover:underline"
              data-testid="money-today-total"
            >
              {rs(d.total.amount)}
            </Link>
          </div>
          {pct != null && (
            <Ring pct={pct} label={`of ${month.label || "month"}`} testId="money-today-ring" />
          )}
        </div>
        <Stats
          testId="money-today-strip"
          items={[
            ...["cash", "account", "other"].map((k) => ({
              label: k,
              value: rs(d[k].amount),
              to: d[k].drill?.to,
              testId: `money-today-${k}`,
            })),
            {
              label: d.cheques.count === 1 ? "cheque to clear" : "cheques to clear",
              value: d.cheques.count || "0",
              to: d.cheques.drill?.to,
              testId: "money-today-cheques",
            },
          ]}
        />
      </EliteHero>
    </section>
  );
}

function Tile({ icon, label, value, to, tone, testId }) {
  return (
    <Link to={to || "#"} className="e-tile" data-testid={testId}>
      <RoundIcon icon={icon} style={tone ? { color: tone } : undefined} />
      <div className="min-w-0">
        <small>{label}</small>
        <b style={tone ? { color: tone } : undefined}>{value} ›</b>
      </div>
    </Link>
  );
}

export function MoneyMatters({ due, ageing, inflow }) {
  const tiles = [
    due && {
      icon: Clock3,
      label: `${due.label || "This month"}`,
      value: due.recovery_pct == null ? "—" : `${due.recovery_pct}% recovered`,
      to: due.received?.drill?.to,
      testId: "mm-recovery",
    },
    ageing && {
      icon: IndianRupee,
      label: "Outstanding",
      value: rs(ageing.total.amount),
      to: ageing.total.drill?.to,
      testId: "mm-outstanding",
    },
    ageing && {
      icon: AlertTriangle,
      label: "Overdue 90+",
      value: rs(ageing.d90.amount),
      to: ageing.d90.drill?.to,
      tone: ageing.d90.amount ? "var(--due)" : undefined,
      testId: "mm-overdue90",
    },
    inflow && {
      icon: ArrowRight,
      label: "Next 30 days",
      value: rs((inflow.bills.amount || 0) + (inflow.cheques.amount || 0)),
      to: inflow.bills.drill?.to,
      testId: "mm-next30",
    },
  ].filter(Boolean);
  if (!tiles.length) return null;
  return (
    <section data-testid="money-matters">
      <SectionHead title="Money matters" to="/reports" link="all reports" />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Tile key={t.testId} {...t} />
        ))}
      </div>
    </section>
  );
}

export function CallTodayList({ d }) {
  const people = d.overdue_customers || [];
  return (
    <section data-testid="widget-call_today">
      <SectionHead title={`Call today (${people.length})`} to="/customers?segment=overdue30" />
      <div className="e-list" data-testid="call-today-list">
        {people.length === 0 && (
          <p className="px-4 py-5 text-sm text-txt-muted" data-testid="call-today-empty">
            No overdue customers to call
          </p>
        )}
        {people.map((p) => (
          <div key={p.booking_id} className="e-row">
            <span className="e-av">{initials(p.name)}</span>
            <div className="min-w-0">
              <Link
                to={`/customers/${p.customer_id}`}
                className="e-rname block truncate hover:underline"
                data-testid={`call-today-name-${p.booking_id}`}
              >
                {p.name}
              </Link>
              <p className="e-rsub truncate">
                {[p.flat, p.booking_number].filter(Boolean).join(" · ")}
              </p>
            </div>
            {p.phone && (
              <span className="hidden gap-1.5 sm:flex">
                <a
                  href={`tel:${p.phone}`}
                  className="e-ic !h-9 !w-9"
                  aria-label={`Call ${p.name}`}
                  data-testid={`call-today-tel-${p.booking_id}`}
                >
                  <Phone />
                </a>
                <a
                  href={`https://wa.me/${onlyDigits(p.phone)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="e-ic !h-9 !w-9"
                  aria-label={`WhatsApp ${p.name}`}
                  data-testid={`call-today-wa-${p.booking_id}`}
                >
                  <MessageCircle />
                </a>
              </span>
            )}
            <MoneyPill
              to={`/customers/${p.customer_id}`}
              cap={p.overdue_days ? `Overdue ${p.overdue_days} days` : "Overdue"}
              capTone="orange"
              testId={`call-today-collect-${p.booking_id}`}
            >
              Collect {rs(p.overdue)}
            </MoneyPill>
          </div>
        ))}
        {(d.followups || d.visits_today) && (
          <div className="e-row text-sm text-txt-secondary">
            {d.followups && (
              <Link
                to={d.followups.drill?.to || "/leads"}
                className="hover:underline"
                data-testid="call-today-followups"
              >
                {d.followups.count || "No"} {d.followups.count === 1 ? "follow-up" : "follow-ups"}{" "}
                due
              </Link>
            )}
            {d.visits_today && (
              <Link
                to={d.visits_today.drill?.to || "/leads?tab=visits"}
                className="ml-auto hover:underline"
                data-testid="call-today-visits"
              >
                {d.visits_today.count || "No"} site visits today
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function ReadyToBill({ d }) {
  const rows = (d.towers || []).filter((t) => t.stage && t.expected?.amount);
  return (
    <section data-testid="widget-next_milestone">
      <SectionHead
        title={`Ready to bill (${rows.length})`}
        to="/construction"
        link="construction"
      />
      <div className="e-list">
        {rows.length === 0 && (
          <p className="px-4 py-5 text-sm text-txt-muted">
            No stage bill waiting — every booked tower is billed up to date
          </p>
        )}
        {rows.map((t) => (
          <div key={t.block_id} className="e-row" data-testid={`milestone-${t.block_id}`}>
            <RoundIcon icon={Layers} />
            <div className="min-w-0">
              <p className="e-rname truncate">
                {t.tower} · {t.stage}
              </p>
              <p className="e-rsub truncate">
                {t.project} · {t.active_bookings ?? t.bookings ?? 0} bookings · incl. GST
              </p>
            </div>
            <MoneyPill
              to={t.expected.drill?.to || "/construction"}
              cap="Stage pending"
              testId={`milestone-raise-${t.block_id}`}
            >
              Raise {rs(t.expected.amount)}
            </MoneyPill>
          </div>
        ))}
      </div>
    </section>
  );
}
