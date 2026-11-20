import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/** Bold lowercase page title with a full stop + one muted summary line (REQ-171). */
export function PageTitle({ title, sub, testId }) {
  return (
    <div className="min-w-0">
      <h1 className="e-title" data-testid={testId || "page-title"}>
        {title}
      </h1>
      {sub && (
        <p className="e-sub" data-testid={`${testId || "page-title"}-sub`}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** Grey wide-spaced caps + optional "view all ›" link. */
export function SectionHead({ title, to, link, testId, className }) {
  return (
    <div className={cn("e-sec", className)} data-testid={testId}>
      <h2>{title}</h2>
      {to && <Link to={to}>{link || "view all"} ›</Link>}
    </div>
  );
}

/** The ONE Elite hero per screen: brushed metal, sapphire glow, faint gold lattice; dark in Day too. */
export function EliteHero({ children, className, testId, ornament = true }) {
  return (
    <section className={cn("e-hero elite-dark", className)} data-testid={testId}>
      <div className="e-glow" aria-hidden="true" />
      {ornament && <div className="e-lattice" aria-hidden="true" />}
      {ornament && <div className="e-diamond hidden md:block" aria-hidden="true" />}
      {children}
    </section>
  );
}

export function Ring({ pct, label, color = "#3d7bff", hole, size, testId }) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return (
    <div
      className="e-ring relative"
      style={{
        background: `conic-gradient(${color} 0 ${p}%, rgba(255,255,255,.08) ${p}% 100%)`,
        ...(hole ? { "--ring-hole": hole } : {}),
        ...(size ? { width: size, height: size } : {}),
      }}
      data-testid={testId}
    >
      <div>
        {p}%<small>{label}</small>
      </div>
    </div>
  );
}

export function Stats({ items, testId }) {
  return (
    <div className="e-stats" data-testid={testId}>
      {items.map((s) => {
        const body = (
          <>
            <b style={s.color ? { color: s.color } : undefined}>{s.value}</b>
            <span>{s.label}</span>
          </>
        );
        return s.to ? (
          <Link key={s.label} to={s.to} className="hover:bg-white/[.03]" data-testid={s.testId}>
            {body}
          </Link>
        ) : (
          <div key={s.label} data-testid={s.testId}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Pill money button with the amount + a status caption in spaced caps under it (REQ-175). */
export function MoneyPill({ to, onClick, children, cap, capTone = "grey", testId }) {
  const Cmp = to ? Link : "button";
  return (
    <div className="ml-auto shrink-0 text-right">
      <Cmp
        {...(to ? { to } : { type: "button", onClick })}
        className="e-pill-money"
        data-testid={testId}
      >
        {children}
      </Cmp>
      {cap && <span className={capTone === "orange" ? "e-ocap" : "e-gcap"}>{cap}</span>}
    </div>
  );
}

export function Chips({ items, value, onChange, testId }) {
  return (
    <div className="flex flex-wrap gap-2.5" role="tablist" data-testid={testId}>
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={value === c.id}
          onClick={() => onChange(c.id)}
          className={cn("e-chip", value === c.id && "on")}
          data-testid={`${testId}-${c.id}`}
        >
          {c.label}
          {c.count != null && <em>{c.count}</em>}
        </button>
      ))}
    </div>
  );
}

export function RoundIcon({ icon: Icon, className, style }) {
  return (
    <span className={cn("e-ic", className)} style={style}>
      <Icon />
    </span>
  );
}

export const initials = (n) =>
  (n || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

/** The owner's KKT logo — night / day variant follows the theme (REQ-185). */
export function KktLogo({ className, testId, night }) {
  const [theme] = useTheme();
  return (
    <img
      src={night || theme === "night" ? "/brand/kkt_logo_night.png" : "/brand/kkt_logo_day.png"}
      alt="KKT Constructions"
      className={cn("w-auto", className)}
      data-testid={testId}
    />
  );
}
