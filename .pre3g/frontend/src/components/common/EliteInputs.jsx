import { Children, isValidElement, useMemo } from "react";
import { Select } from "@/components/v2/Select";
import { DateInput } from "@/components/common/DateInput";

const text = (n) =>
  n == null || typeof n === "boolean"
    ? ""
    : typeof n === "string" || typeof n === "number"
      ? String(n)
      : Array.isArray(n)
        ? n.map(text).join("")
        : isValidElement(n)
          ? text(n.props.children)
          : "";

function collect(children, group, out) {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === "optgroup") return collect(c.props.children, c.props.label, out);
    if (c.type !== "option") return collect(c.props.children, group, out);
    const label = text(c.props.children);
    out.push({
      value: String(c.props.value ?? label),
      label,
      sub: group,
      disabled: c.props.disabled,
    });
  });
  return out;
}

// layout classes survive; the native "input" look is the Elite trigger's own
const KEEP =
  /^!?((sm|md|lg|xl):)?!?(w-|min-w-|max-w-|flex|grow|shrink|basis-|m[trblxy]?-|col-span|hidden|block|inline|self-|order-)/;
const layout = (cls) =>
  (cls || "")
    .split(/\s+/)
    .filter((t) => KEEP.test(t))
    .join(" ");

/** REQ-215: drop-in for a browser <select> — same value / onChange(e) / <option> children, Elite dropdown UI. */
export function NativeSelect({
  value,
  onChange,
  children,
  disabled,
  className,
  "data-testid": testId,
  "aria-label": ariaLabel,
}) {
  const all = useMemo(() => collect(children, undefined, []), [children]);
  const blank = all.find((o) => o.value === "");
  const options = all.filter(
    (o) => o.value !== "" && (!o.disabled || o.value === String(value ?? "")),
  );
  return (
    <Select
      options={options}
      value={value == null ? "" : String(value)}
      onChange={(v) => onChange?.({ target: { value: v ?? "" } })}
      placeholder={blank?.label || ariaLabel || "Select…"}
      clearable={!!blank}
      allowAdd={false}
      disabled={disabled}
      className={layout(className)}
      testId={testId}
    />
  );
}

const pad = (n) => String(n).padStart(2, "0");
const GRID = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

/** Drop-in for <input type="time"> (HH:MM, 15-minute steps; an off-grid stored value is kept). */
export function TimeInput({ value, onChange, disabled, className, "data-testid": testId }) {
  const opts = useMemo(() => {
    const g = value && !GRID.includes(value) ? [...GRID, value].sort() : GRID;
    return g.map((t) => ({ value: t, label: t }));
  }, [value]);
  return (
    <Select
      options={opts}
      value={value || ""}
      onChange={(v) => onChange?.({ target: { value: v || "" } })}
      placeholder="Time"
      clearable={false}
      allowAdd={false}
      recentKey="time-input"
      disabled={disabled}
      className={layout(className)}
      testId={testId}
    />
  );
}

/** Drop-in for <input type="datetime-local"> (YYYY-MM-DDTHH:MM): Elite date picker + time picker. */
export function DateTimeInput({
  value,
  onChange,
  min,
  disabled,
  className,
  "data-testid": testId,
}) {
  const [d, t] = (value || "").split("T");
  const emit = (nd, nt) =>
    onChange?.({ target: { value: nd ? `${nd}T${(nt || "10:00").slice(0, 5)}` : "" } });
  return (
    <div className={`flex gap-2 ${layout(className)}`} data-testid={testId}>
      <DateInput
        value={d || ""}
        min={min ? min.slice(0, 10) : undefined}
        onChange={(e) => emit(e.target.value, t)}
        disabled={disabled}
        className="min-w-0 flex-1"
        data-testid={testId ? `${testId}-date` : undefined}
      />
      <TimeInput
        value={(t || "").slice(0, 5)}
        onChange={(e) => emit(d, e.target.value)}
        disabled={disabled || !d}
        className="w-28"
        data-testid={testId ? `${testId}-time` : undefined}
      />
    </div>
  );
}
