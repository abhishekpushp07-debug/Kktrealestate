/* eslint-disable react/no-array-index-key -- fixed-length skeleton placeholders (never reordered) */
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { inr, inrShort, initials } from "@/lib/format";
import { CheckCircle2, ChevronRight, Inbox } from "lucide-react";

export const STATUS = {
  Available: ["sage", "bg-sage-50 text-sage"], Hold: ["amber", "bg-amber2-50 text-amber2"], Booked: ["slate", "bg-slate2-50 text-slate2"], Sold: ["gold", "bg-gold-light text-[#8a6d12]"], Blocked: ["ink", "bg-warm-100 text-txt-secondary"],
  Active: ["sage", "bg-sage-50 text-sage"], Completed: ["gold", "bg-gold-light text-[#8a6d12]"], Cancelled: ["brick", "bg-brick-50 text-brick"], Pending: ["amber", "bg-amber2-50 text-amber2"], Cleared: ["sage", "bg-sage-50 text-sage"], Bounced: ["brick", "bg-brick-50 text-brick"], Reversed: ["ink", "bg-warm-100 text-txt-secondary"],
  "Under Construction": ["amber", "bg-amber2-50 text-amber2"], Ready: ["sage", "bg-sage-50 text-sage"], Planning: ["slate", "bg-slate2-50 text-slate2"], Launched: ["sage", "bg-sage-50 text-sage"], Open: ["amber", "bg-amber2-50 text-amber2"], Paid: ["sage", "bg-sage-50 text-sage"], Overdue: ["brick", "bg-brick-50 text-brick"], "Partially Paid": ["amber", "bg-amber2-50 text-amber2"],
  Verified: ["sage", "bg-sage-50 text-sage"], Submitted: ["amber", "bg-amber2-50 text-amber2"], Rejected: ["brick", "bg-brick-50 text-brick"], Lead: ["slate", "bg-slate2-50 text-slate2"], Prospect: ["amber", "bg-amber2-50 text-amber2"], Buyer: ["sage", "bg-sage-50 text-sage"], Owner: ["gold", "bg-gold-light text-[#8a6d12]"], Dormant: ["ink", "bg-warm-100 text-txt-secondary"],
  New: ["slate", "bg-slate2-50 text-slate2"], "Awaiting Customer": ["gold", "bg-gold-light text-[#8a6d12]"], "In Progress": ["amber", "bg-amber2-50 text-amber2"], Resolved: ["sage", "bg-sage-50 text-sage"], Closed: ["ink", "bg-warm-100 text-txt-secondary"], Scheduled: ["slate", "bg-slate2-50 text-slate2"], Draft: ["ink", "bg-warm-100 text-txt-secondary"], Voided: ["ink", "bg-warm-100 text-txt-secondary"], Raised: ["amber", "bg-amber2-50 text-amber2"],
};
export const CELL = { Available: "bg-sage/15 text-sage border border-sage/30", Hold: "bg-amber2/15 text-amber2 border border-amber2/30", Booked: "bg-slate2 text-white", Sold: "bg-gold text-ink-950", Blocked: "bg-warm-200 text-txt-muted" };
export const UNIT_COLORS = { Available: "#2F7D5B", Hold: "#B7791F", Booked: "#5B6B85", Sold: "#C9A227", Blocked: "#DCD4C4" };

export function StatusPill({ status, className, testId }) {
  const cls = STATUS[status]?.[1] || "bg-warm-100 text-txt-secondary";
  return <span className={cn("pill", cls, className)} data-testid={testId}>{status}</span>;
}

export function Num({ s, className }) {
  if (s == null) return <span className={className}>—</span>;
  const str = String(s);
  if (!str.startsWith("₹")) return <span className={className}>{str}</span>;
  return <span className={className}><span className="rs">₹</span>{str.slice(1)}</span>;
}

export function Money({ value, short, className, light }) {
  if (value == null) return <span className={className}>—</span>;
  return <span className={cn("font-display tabular-nums", light && "text-gold-400", className)} title={inr(value)}><Num s={short ? inrShort(value) : inr(value)} /></span>;
}

export function IconTile({ icon: Icon, tone, className }) {
  return <span className={cn("icon-tile", tone, className)}><Icon /></span>;
}

export function ProgressRing({ value = 0, size = 56, stroke = 5, light, children, className }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }} data-testid="progress-ring">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={light ? "rgba(255,255,255,.12)" : "#EAE4D8"} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#C9A227" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, value) / 100)} style={{ transition: "stroke-dashoffset .6s ease-out" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children ?? <span className={cn("font-display text-[13px] font-semibold", light ? "text-warm-50" : "text-ink-950")}>{Math.round(value)}%</span>}</div>
    </div>
  );
}

export function Card({ className, children, hover, onClick, testId, as: As = "div" }) {
  return <As className={cn("card p-6", hover && "card-hover cursor-pointer", className)} onClick={onClick} data-testid={testId}>{children}</As>;
}

export function StatTile({ label, value, hint, icon: Icon, spark, tone, to, testId, iconTone }) {
  const hasSpark = Array.isArray(spark) && spark.some((v) => v > 0);
  const body = (
    <Card className="flex items-center justify-between gap-4 !p-5" hover={!!to} testId={testId}>
      <div className="min-w-0">
        <p className="stat-label">{label}</p>
        <p className={cn("stat-value font-display text-ink-950", tone === "brick" && "text-brick", tone === "sage" && "text-sage")}><Num s={value} /></p>
        {hint && <p className="stat-hint truncate">{hint}</p>}
      </div>
      {hasSpark ? <Sparkline data={spark} /> : Icon && <IconTile icon={Icon} tone={iconTone} />}
    </Card>
  );
  return to ? <Link to={to} className="block" data-testid={testId ? `${testId}-link` : undefined}>{body}</Link> : body;
}

export function Sparkline({ data = [], w = 72, h = 28 }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1), step = w / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return <svg width={w} height={h} className="shrink-0"><polyline points={pts} fill="none" stroke="#C9A227" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

export function MiniBar({ counts = {}, className, order = ["Available", "Hold", "Booked", "Sold", "Blocked"], legend }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className={className}>
      <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-warm-100" title={order.map((k) => `${k} ${counts[k] || 0}`).join(" · ")}>
        {order.filter((k) => counts[k]).map((k) => <span key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: UNIT_COLORS[k] }} />)}
      </div>
      {legend && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-txt-secondary">{order.filter((k) => counts[k]).map((k) => <span key={k} className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: UNIT_COLORS[k] }} />{counts[k]} {k.toLowerCase()}</span>)}</div>}
    </div>
  );
}

export function Monogram({ name, className }) {
  const h = [...(name || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className={cn("relative grid h-full w-full place-items-center overflow-hidden", className)} style={{ background: `linear-gradient(135deg, hsl(${h} 18% 14%), hsl(${(h + 40) % 360} 22% 24%))` }}>
      <div className="absolute inset-0 grain opacity-60" />
      <span className="relative grid h-12 w-12 place-items-center rounded-full border border-gold/50 font-display text-lg text-gold-400">{initials(name)}</span>
    </div>
  );
}

export function PageHero({ dark = true, eyebrow, title, subtitle, chips, ring, stats = [], actions, cover, crumbs, children, testId }) {
  return (
    <section className={cn("relative overflow-hidden rounded-2xl", dark ? "hero" : "card")} data-testid={testId}>
      {cover && <div className="absolute inset-0 bg-cover bg-center opacity-20 blur-xl" style={{ backgroundImage: `url(${cover})` }} />}
      <div className="relative px-6 py-7 md:px-8">
        {crumbs && <nav className={cn("mb-3 flex flex-wrap items-center gap-1 text-xs", dark ? "text-warm-200/70" : "text-txt-muted")}>{crumbs.map((c, i) => <span key={c.to || c.label || c} className="flex items-center gap-1">{i > 0 && <ChevronRight className="h-3 w-3" />}{c.to ? <Link to={c.to} className="hover:underline">{c.label}</Link> : <span>{c.label}</span>}</span>)}</nav>}
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-5">
            {ring != null && <div className="flex flex-col items-center gap-1"><ProgressRing value={ring} size={72} stroke={6} light={dark} /><span className={cn("text-[11px] font-semibold", dark ? "text-warm-200/70" : "text-txt-muted")}>Construction</span></div>}
            <div className="min-w-0">
              {eyebrow && <p className={cn("label", dark && "!text-gold-400")}>{eyebrow}</p>}
              <h1 className={cn("font-display text-3xl leading-tight md:text-[40px] md:leading-[1.1]", dark ? "text-warm-50" : "text-ink-950")} data-testid="hero-title">{title}</h1>
              {subtitle && <p className={cn("mt-2 text-sm", dark ? "text-warm-200/80" : "text-txt-secondary")}>{subtitle}</p>}
              {chips && <div className="mt-3 flex flex-wrap gap-2">{chips}</div>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        {stats.length > 0 && (
          <div className={cn("mt-7 grid grid-cols-2 gap-4 border-t pt-6 md:grid-cols-4", dark ? "border-white/10" : "border-warm-200")}>
            {stats.map((s) => <div key={s.label}><p className={cn("label", dark && "!text-warm-200/60")}>{s.label}</p><p className={cn("mt-1 font-display text-2xl md:text-[28px]", s.tone === "sage" ? "text-sage-300" : dark ? "text-gold-400" : "text-ink-950")} style={s.tone === "sage" ? { color: "#7FC8A4" } : undefined}><Num s={s.value} /></p>{s.hint && <p className={cn("mt-1 text-[13px]", dark ? "text-warm-200/80" : "text-txt-muted")}>{s.hint}</p>}</div>)}
          </div>
        )}
        {children}
      </div>
      {dark && <div className="hero-hair" />}
    </section>
  );
}

export function EntityCard({ to, cover, title, subtitle, status, meta = [], counts, progress, foot, initialsOf, testId, onClick, money }) {
  const inner = (
    <Card hover className="flex h-full flex-col !p-0 overflow-hidden" testId={testId} onClick={onClick}>
      {cover !== undefined && (
        <div className="relative aspect-[16/9] w-full bg-ink-900">
          {cover ? <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Monogram name={initialsOf || title} />}
          {progress != null && <div className="absolute right-3 top-3 flex flex-col items-center rounded-xl bg-ink-950/70 px-2 py-1.5 backdrop-blur"><ProgressRing value={progress} size={44} stroke={4} light /><span className="mt-0.5 text-[10px] font-semibold text-warm-200/80">Construction</span></div>}
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="truncate font-display text-base font-semibold text-ink-950">{title}</p>
          {cover === undefined && progress != null && <ProgressRing value={progress} size={44} stroke={4} />}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {subtitle ? <p className="truncate text-xs text-txt-secondary">{subtitle}</p> : <span />}
          {status && <StatusPill status={status} />}
        </div>
        {meta.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{meta.map((m) => <span key={String(m)} className="pill bg-warm-100 text-txt-secondary">{m}</span>)}</div>}
        {counts && <MiniBar counts={counts} className="mt-4" legend />}
        {money && <div className="mt-4 grid grid-cols-2 gap-3 border-t border-warm-100 pt-4">{money.map((m) => <div key={m.label}><p className="text-[11px] font-semibold text-txt-secondary">{m.label}</p><Money value={m.value} short className={cn("text-xl", m.tone === "brick" ? "text-brick" : m.tone === "sage" ? "text-sage" : "text-ink-950")} /></div>)}</div>}
        {foot && <div className="mt-4 flex items-end justify-between gap-3 border-t border-warm-100 pt-3 text-xs text-txt-secondary">{foot}</div>}
      </div>
    </Card>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}

export function FormSection({ title, helper, children, className }) {
  const anchor = title ? title.toLowerCase().replace(/\s+/g, "-") : undefined;
  return (
    <section id={anchor} className={cn("card scroll-mt-24 p-6 target:ring-2 target:ring-gold", className)}>
      {title && <div className="mb-5"><h3 className="font-display text-lg text-ink-950">{title}</h3>{helper && <p className="mt-1 text-sm text-txt-secondary">{helper}</p>}</div>}
      <div className="grid gap-5 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function Field({ label, children, hint, error, required, className, testId }) {
  return (
    <label className={cn("block", className)} data-testid={testId}>
      <span className="label !normal-case !tracking-normal !text-txt-secondary">{label}{required && <span className="text-brick"> *</span>}</span>
      <div className="mt-1.5">{children}</div>
      {error ? <p className="mt-1 text-xs text-brick" role="alert">{error}</p> : hint && <p className="mt-1 text-xs text-txt-muted">{hint}</p>}
    </label>
  );
}

export function Stepper({ steps, current, onStep, onJump, testId, vertical, allowJump }) {
  const labelOf = (s) => (typeof s === "string" ? s : s.label);
  const jump = onJump || onStep;
  if (vertical || steps.some((s) => typeof s !== "string")) return (
    <ol className="flex gap-2 overflow-x-auto scroll-x pb-1 lg:block lg:space-y-1" data-testid={testId || "stepper"}>
      {steps.map((s, i) => { const done = i < current, active = i === current; return (
        <li key={labelOf(s)}><button type="button" onClick={() => jump?.(i)} disabled={!allowJump && i > current} className={cn("flex w-full shrink-0 items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", active ? "bg-ink-950 text-warm-50" : done ? "text-ink-950 hover:bg-warm-100" : allowJump ? "text-txt-secondary hover:bg-warm-100" : "text-txt-muted")} data-testid={`step-${i + 1}`} aria-current={active ? "step" : undefined}>
          <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold", active ? "bg-gold text-ink-950" : done ? "bg-sage text-white" : "bg-warm-200 text-txt-secondary")}>{done ? "✓" : i + 1}</span>
          <span className={cn("min-w-0", !active && "hidden lg:block")}><span className="block text-sm font-semibold">{labelOf(s)}</span>{s.desc && <span className={cn("hidden text-[11px] lg:block", active ? "text-warm-200/70" : "text-txt-muted")}>{s.desc}</span>}</span>
        </button></li>); })}
    </ol>
  );
  return (
    <ol className="flex items-center gap-2 overflow-x-auto scroll-x pb-1" data-testid={testId || "stepper"}>
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <li key={s} className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => jump?.(i)} disabled={!allowJump && i > current} className={cn("flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-semibold transition-colors", active ? "bg-ink-950 text-warm-50" : done ? "text-ink-950 hover:bg-warm-100" : "text-txt-muted")} data-testid={`step-${i + 1}`}>
              <span className={cn("grid h-6 w-6 place-items-center rounded-full text-xs", active ? "bg-gold text-ink-950" : done ? "bg-sage text-white" : "bg-warm-200 text-txt-secondary")}>{done ? "✓" : i + 1}</span>
              <span className={cn(!active && "hidden md:inline")}>{s}</span>
            </button>
            {i < steps.length - 1 && <span className="h-px w-6 bg-warm-200" />}
          </li>
        );
      })}
    </ol>
  );
}

export function Tabs({ tabs, value, onChange, testId }) {
  return (
    <div className="flex max-w-full gap-6 overflow-x-auto border-b border-warm-200 scroll-x" role="tablist" data-testid={testId}>
      {tabs.map((t) => <button key={t.value} role="tab" aria-selected={value === t.value} className={cn("tab", value === t.value && "active")} onClick={() => onChange(t.value)} data-testid={`tab-${t.value}`}>{t.label}{t.count != null && <span className="ml-2 rounded-full bg-warm-100 px-2 py-0.5 text-[11px] text-txt-secondary">{t.count}</span>}</button>)}
    </div>
  );
}

export function Timeline({ items = [], render }) {
  return (
    <ol className="relative ml-2 border-l border-warm-200 pl-6" data-testid="timeline">
      {items.map((it, i) => (
        <li key={it.id || i} className="relative pb-5 last:pb-0">
          <span className={cn("absolute -left-[31px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-warm-50", it.tone === "brick" ? "bg-brick" : it.tone === "sage" ? "bg-sage" : it.tone === "gold" ? "bg-gold" : "bg-ink-700")} />
          {render ? render(it) : <><p className="text-sm font-semibold text-ink-950">{it.title}</p>{it.subtitle && <p className="text-xs text-txt-secondary">{it.subtitle}</p>}</>}
        </li>
      ))}
    </ol>
  );
}

export function EmptyState({ title = "Nothing here yet", description, action, icon: Icon = Inbox, testId }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center" data-testid={testId}>
      <span className="icon-tile h-14 w-14 rounded-2xl"><Icon className="!h-6 !w-6" /></span>
      <p className="mt-4 font-display text-lg text-ink-950">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-txt-secondary">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn("skel", className)} aria-hidden />;
}

export function SkeletonCards({ n = 3, h = "h-40" }) {
  return <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className={cn("rounded-2xl", h)} />)}</div>;
}

export function SegmentBar({ segments, total, counts, emptyText = "No overdue dues" }) {
  const sum = total || segments.reduce((a, s) => a + s.value, 0);
  if (!sum) return <div className="flex items-center gap-3 rounded-xl bg-sage-50 px-4 py-3 text-sm font-semibold text-sage" data-testid="segment-empty"><CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />{emptyText}</div>;
  return (
    <div>
      <div className="flex h-3 w-full gap-px overflow-hidden rounded-full bg-warm-100">{segments.filter((s) => s.value > 0).map((s) => <span key={s.label} style={{ width: `${(s.value / sum) * 100}%`, background: s.color }} title={`${s.label}: ${inr(s.value)}`} />)}</div>
      <ul className="mt-4 space-y-2 text-sm">{segments.map((s) => <li key={s.label} className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-txt-secondary"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}{s.count != null && <span className="text-xs text-txt-muted">· {s.count} {s.count === 1 ? "demand" : "demands"}</span>}</span><Money value={s.value} short className="text-base text-ink-950" /></li>)}</ul>
    </div>
  );
}
