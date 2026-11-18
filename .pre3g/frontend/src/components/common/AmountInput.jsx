import { useLayoutEffect, useRef } from "react";
import { cleanAmount, groupINR } from "@/lib/amount";

const digitsBefore = (s, pos) => s.slice(0, pos).replace(/[^0-9.-]/g, "").length;

function caretAfter(s, count) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (/[0-9.-]/.test(s[i])) n++;
    if (n === count) return i + 1;
  }
  return count ? s.length : 0;
}

/** One ₹ amount field: shows 1,23,456 while typing; onChange gets the plain number text (e.target.value = "123456"). */
export function AmountInput({
  value,
  onChange,
  allowNegative = false,
  className = "input",
  ...rest
}) {
  const ref = useRef(null);
  const caret = useRef(null);
  const shown = groupINR(cleanAmount(value, { allowNegative }));
  useLayoutEffect(() => {
    if (caret.current == null || document.activeElement !== ref.current) return;
    const p = caretAfter(shown, caret.current);
    ref.current.setSelectionRange(p, p);
    caret.current = null;
  });
  const emit = (text, pos) => {
    caret.current = digitsBefore(text, pos);
    onChange?.({ target: { value: cleanAmount(text, { allowNegative }), name: rest.name } });
  };
  const change = (e) => emit(e.target.value, e.target.selectionStart ?? e.target.value.length);
  const keyDown = (e) => {
    const el = e.target;
    const pos = el.selectionStart;
    if (pos !== el.selectionEnd) return;
    // deleting a comma removes the digit beside it (otherwise nothing changes and the caret jumps)
    if (e.key === "Backspace" && pos > 1 && el.value[pos - 1] === ",") {
      e.preventDefault();
      emit(el.value.slice(0, pos - 2) + el.value.slice(pos), pos - 2);
    } else if (e.key === "Delete" && el.value[pos] === ",") {
      e.preventDefault();
      emit(el.value.slice(0, pos) + el.value.slice(pos + 2), pos);
    }
    rest.onKeyDown?.(e);
  };
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-txt-muted">
        ₹
      </span>
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`${className} !pl-7 tabular-nums`}
        value={shown}
        onChange={change}
        onKeyDown={keyDown}
      />
    </div>
  );
}
