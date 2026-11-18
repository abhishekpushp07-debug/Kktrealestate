import { Link } from "react-router-dom";
import { inr } from "@/lib/format";
import { MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Empty, Num, Row, rs } from "./WidgetCard";

const onlyDigits = (p) => (p || "").replace(/\D/g, "");

export function MoneyToday({ d }) {
  if (!d.total.amount && !d.cheques.count)
    return (
      <Empty
        text="No receipts today yet"
        to="/payments?new=1"
        action="Post a payment"
        testId="money-today-empty"
      />
    );
  return (
    <>
      <Num
        n={d.total}
        money
        className="text-3xl font-semibold text-ink-950"
        testId="money-today-total"
      />
      <p className="mb-2 text-xs text-txt-muted">received today</p>
      {["cash", "account", "other"].map((k) => (
        <Row key={k} label={k[0].toUpperCase() + k.slice(1)} testId={`money-today-${k}`}>
          <Num n={d[k]} money />
        </Row>
      ))}
      <Row label="Cheques to clear" testId="money-today-cheques">
        <Num n={d.cheques} money>
          {d.cheques.count ? `${d.cheques.count} · ${rs(d.cheques.amount)}` : "None"}
        </Num>
      </Row>
    </>
  );
}

export function DueVsReceived({ d }) {
  if (!d.due.amount && !d.received.amount)
    return <Empty text={`No bills fall due in ${d.label} and nothing received yet`} />;
  const max = Math.max(d.due.amount, d.received.amount, 1);
  const bar = (n, cls, label, key) => (
    <div className="mb-2" data-testid={`due-vs-received-${key}`}>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-txt-secondary">{label}</span>
        <Num n={n} money className="font-semibold" />
      </div>
      <div className="h-2 rounded-full bg-warm-100">
        <div
          className={cn("h-2 rounded-full", cls)}
          style={{ width: `${(n.amount * 100) / max}%` }}
        />
      </div>
    </div>
  );
  return (
    <>
      <p className="mb-3 text-3xl font-semibold text-ink-950" data-testid="due-vs-received-pct">
        {d.recovery_pct == null ? "—" : `${d.recovery_pct}%`}
        <span className="ml-2 text-xs font-normal text-txt-muted">recovery · {d.label}</span>
      </p>
      {bar(d.due, "bg-ink-700", "Bills falling due", "due")}
      {bar(d.received, "bg-sage", "Received", "received")}
    </>
  );
}

const BAND_CLS = ["bg-warm-300", "bg-amber/50", "bg-amber", "bg-brick/70", "bg-brick"];
export function Ageing({ d }) {
  const bands = ["not_due", "d0_30", "d31_60", "d61_90", "d90"].map((k) => d[k]);
  if (!d.total.amount) return <Empty text="Nothing outstanding — every bill is paid" />;
  return (
    <>
      <Num
        n={d.total}
        money
        className="text-3xl font-semibold text-ink-950"
        testId="ageing-total"
      />
      <p className="mb-2 text-xs text-txt-muted">outstanding · {rs(d.overdue.amount)} overdue</p>
      <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-warm-100">
        {bands.map((b, i) => (
          <div
            key={b.label}
            className={BAND_CLS[i]}
            style={{ width: `${(b.amount * 100) / d.total.amount}%` }}
          />
        ))}
      </div>
      {bands.map((b, i) => (
        <Row key={b.label} label={b.label} testId={`ageing-band-${i}`}>
          <Num n={b} money>
            {b.amount ? `${rs(b.amount)} · ${b.bookings} bkg` : "—"}
          </Num>
        </Row>
      ))}
    </>
  );
}

export function CallToday({ d }) {
  const people = d.overdue_customers || [];
  return (
    <>
      {people.length ? (
        <ul className="divide-y divide-warm-100" data-testid="call-today-list">
          {people.map((p) => (
            <li key={p.booking_id} className="flex items-center gap-2 py-2 text-sm">
              <Link
                to={`/customers/${p.customer_id}`}
                className="min-w-0 flex-1 truncate font-semibold hover:underline"
                data-testid={`call-today-name-${p.booking_id}`}
              >
                {p.name}
              </Link>
              <span className="tnum text-brick">{rs(p.overdue)}</span>
              {p.phone && (
                <>
                  <a
                    href={`tel:${p.phone}`}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-warm-200"
                    aria-label={`Call ${p.name}`}
                    data-testid={`call-today-tel-${p.booking_id}`}
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </a>
                  <a
                    href={`https://wa.me/${onlyDigits(p.phone)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-warm-200"
                    aria-label={`WhatsApp ${p.name}`}
                    data-testid={`call-today-wa-${p.booking_id}`}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="No overdue customers to call" testId="call-today-empty" />
      )}
      {d.followups && (
        <Row label="Follow-ups due" testId="call-today-followups">
          <Num n={d.followups}>{d.followups.count || "None"}</Num>
        </Row>
      )}
      {d.visits_today && (
        <Row label="Site visits today" testId="call-today-visits">
          {d.visits_today.count ? (
            <Num n={d.visits_today} />
          ) : (
            <Link to="/leads?tab=visits&new=visit" className="text-gold hover:underline">
              None · Book a visit
            </Link>
          )}
        </Row>
      )}
      <p className="mt-2 text-[11px] text-txt-muted">
        Messaging not configured — call or WhatsApp opens your phone.
      </p>
    </>
  );
}

export function Inflow({ d }) {
  const total = (d.bills.amount || 0) + (d.cheques.amount || 0);
  if (!total)
    return d.awaiting_stage.count ? (
      <Empty
        text={`No dated bills or cheques in the next 30 days · ${d.awaiting_stage.count} instalments wait for a stage`}
        to="/construction"
        action="Open Construction"
      />
    ) : (
      <Empty
        text="No dated bills or cheques due in the next 30 days"
        to="/demands"
        action="Open Bills"
      />
    );
  return (
    <>
      <p className="text-3xl font-semibold text-ink-950" data-testid="inflow-total">
        {rs(total)}
      </p>
      <Row label="Bills due in 30 days" testId="inflow-bills">
        <Num n={d.bills} money />
      </Row>
      <Row label="Cheques pending clearance" testId="inflow-cheques">
        <Num n={d.cheques} money />
      </Row>
      <Row label="Awaiting stage (no date yet)" testId="inflow-awaiting">
        <Link to="/construction" className="hover:underline">
          {d.awaiting_stage.count} instalments
        </Link>
      </Row>
    </>
  );
}

function Towers({ rows, empty, children }) {
  if (!rows?.length) return <Empty text={empty} to="/projects" action="Open Projects" />;
  return <ul className="divide-y divide-warm-100">{rows.map(children)}</ul>;
}

export function NextMilestone({ d }) {
  return (
    <Towers rows={d.towers} empty="No towers yet">
      {(t) => (
        <li key={t.block_id} className="py-2 text-sm" data-testid={`milestone-${t.block_id}`}>
          <div className="flex justify-between gap-2">
            <span className="truncate font-semibold">
              {t.project} · {t.tower}
            </span>
            {t.expected?.amount ? (
              <Num n={t.expected} money className="font-semibold" />
            ) : (
              <span className="text-txt-muted">
                {!t.stage
                  ? "All stages done"
                  : t.active_bookings
                    ? `No bill at this stage · ${t.active_bookings} bookings`
                    : "No bookings to bill"}
              </span>
            )}
          </div>
          <p className="text-xs text-txt-muted">
            {t.stage
              ? `Next: ${t.stage} · ${t.active_bookings ?? 0} bookings`
              : "Construction complete"}
          </p>
        </li>
      )}
    </Towers>
  );
}

const STATE_CLS = {
  Available: "bg-sage-50 text-sage",
  Hold: "bg-amber2-50 text-amber",
  Booked: "bg-gold-light text-gold",
  Sold: "bg-ink-100 text-ink-950",
  Blocked: "bg-warm-200 text-txt-secondary",
};
export function Inventory({ d }) {
  return (
    <Towers rows={d.towers} empty="No towers yet">
      {(t) => (
        <li key={t.block_id} className="py-2" data-testid={`inventory-${t.block_id}`}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="truncate font-semibold">
              {t.project} · {t.tower}
            </span>
            {t.unsold ? (
              <span className="text-xs text-txt-muted">{rs(t.unsold)} unsold</span>
            ) : null}
          </div>
          {t.total ? (
            <div className="flex flex-wrap gap-1.5">
              {t.states.map((s) => (
                <Num
                  key={s}
                  n={t[s.toLowerCase()]}
                  className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", STATE_CLS[s])}
                  testId={`inventory-${t.block_id}-${s.toLowerCase()}`}
                >
                  {s} {t[s.toLowerCase()].count}
                </Num>
              ))}
            </div>
          ) : (
            <Link to={`/blocks/${t.block_id}`} className="text-xs text-gold hover:underline">
              No flats yet · Add flats
            </Link>
          )}
        </li>
      )}
    </Towers>
  );
}

const CELL = {
  Available: "bg-sage/70",
  Hold: "bg-amber/70",
  Booked: "bg-gold",
  Sold: "bg-ink-700",
  Blocked: "bg-warm-300",
  "Not for sale": "bg-warm-200",
};
export function FlatStatus({ d }) {
  return (
    <>
      <Towers rows={d.towers} empty="No towers yet">
        {(t) => (
          <li key={t.block_id} className="py-2" data-testid={`flat-grid-${t.block_id}`}>
            <p className="mb-1 truncate text-sm font-semibold">
              {t.project} · {t.tower}
            </p>
            {t.floors.length ? (
              <div className="max-w-full space-y-0.5 overflow-x-auto">
                {t.floors.map((f) => (
                  <div key={f.floor} className="flex items-center gap-0.5">
                    <span className="w-6 shrink-0 text-[10px] text-txt-muted">{f.floor}</span>
                    {f.flats.map((x) => (
                      <Link
                        key={x.id}
                        to={`/flats?block_id=${t.block_id}&status=${x.s}`}
                        title={`${x.n} · ${x.s}`}
                        aria-label={`Flat ${x.n} ${x.s}`}
                        className={cn("h-4 w-4 shrink-0 rounded-[3px]", CELL[x.s] || "bg-warm-200")}
                        data-testid={`flat-cell-${x.id}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-txt-muted">No flats yet</p>
            )}
          </li>
        )}
      </Towers>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-txt-secondary">
        {(d.states || Object.keys(STATE_CLS)).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <i className={cn("h-2.5 w-2.5 rounded-[2px]", CELL[s])} />
            {s}
          </span>
        ))}
      </div>
    </>
  );
}

export function Construction({ d }) {
  return (
    <Towers rows={d.towers} empty="No towers yet">
      {(t) => (
        <li key={t.block_id} className="py-2 text-sm" data-testid={`construction-${t.block_id}`}>
          <Link to={t.drill.to} className="flex justify-between gap-2 hover:underline">
            <span className="truncate font-semibold">
              {t.project} · {t.tower}
            </span>
            <span className="tnum">{t.pct == null ? "No stages" : `${t.pct}%`}</span>
          </Link>
          <div className="my-1 h-1.5 rounded-full bg-warm-100">
            <div className="h-1.5 rounded-full bg-gold" style={{ width: `${t.pct || 0}%` }} />
          </div>
          <p className="text-xs text-txt-muted">
            {t.last_stage
              ? `${t.last_stage} · ${t.last_date || ""}`
              : `${t.done}/${t.total} stages · none completed yet`}
          </p>
        </li>
      )}
    </Towers>
  );
}

export function Pipeline({ d }) {
  if (!d.leads.count && !d.bookings?.count)
    return <Empty text={`No leads in ${d.label}`} to="/leads?new=1" action="Add a lead" />;
  const step = (n, label, key) =>
    n && (
      <div
        className="flex-1 rounded-xl bg-warm-100 p-2 text-center"
        data-testid={`pipeline-${key}`}
      >
        <Num n={n} className="block text-xl font-semibold" />
        <span className="text-[11px] text-txt-secondary">{label}</span>
      </div>
    );
  return (
    <>
      <div className="flex gap-2">
        {step(d.leads, "Leads", "leads")}
        {step(d.visits, "Visits", "visits")}
        {step(d.bookings, "Bookings", "bookings")}
      </div>
      <Row label="Conversion" testId="pipeline-conversion">
        {d.conversion_pct == null ? "—" : `${d.conversion_pct}%`}
      </Row>
      {d.discount && (
        <Row label="Discount given" testId="pipeline-discount">
          <Link to={d.discount.link} className="hover:underline">
            {inr(d.discount.amount_paise / 100)} · {d.discount.bookings} bookings
          </Link>
        </Row>
      )}
      <Row label="Lost" testId="pipeline-lost">
        <Num n={d.lost} />
      </Row>
      {d.lost.reasons.map((r) => (
        <p key={r.reason} className="flex justify-between text-xs text-txt-muted">
          <span>{r.reason}</span>
          <span>{r.count}</span>
        </p>
      ))}
    </>
  );
}

export function Attention({ d }) {
  const items = [
    ["Holds expiring in 48 h", d.holds_expiring, "attention-holds"],
    ["Bounced cheques not replaced", d.bounced, "attention-bounced"],
    ["Part-paid bills, no receipt 30 days", d.stale_part_paid, "attention-stale"],
    ["Waivers to approve", d.waivers_to_approve, "attention-waivers"],
  ].filter(([, n]) => n);
  if (!items.some(([, n]) => n.count)) return <Empty text="Nothing needs attention right now" />;
  return items.map(([label, n, id]) => (
    <Row key={id} label={label} testId={id}>
      <Num n={n} className={n.count ? "text-brick" : ""}>
        {n.count || "None"}
      </Num>
    </Row>
  ));
}

export const BODIES = {
  money_today: MoneyToday,
  due_vs_received: DueVsReceived,
  ageing: Ageing,
  call_today: CallToday,
  inflow_30: Inflow,
  next_milestone: NextMilestone,
  inventory: Inventory,
  flat_status: FlatStatus,
  construction: Construction,
  pipeline: Pipeline,
  attention: Attention,
};
