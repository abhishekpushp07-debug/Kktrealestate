import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from "react";
import { formatINRShort, groupIndian, paiseToRupeesInput, rupeesInputToPaise } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";

type BaseProps = Omit<InputProps, "value" | "onChange" | "type" | "defaultValue" | "inputMode">;

/* ------------------------------------------------------------------ */
/* NumberInput                                                          */
/* ------------------------------------------------------------------ */

export interface NumberInputProps extends BaseProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Maximum decimal places accepted (default 2; 0 = integers). */
  decimals?: number;
  allowNegative?: boolean;
  /** Right-align digits (default true, ERP tables). */
  align?: "left" | "right";
}

function sanitizeNumber(raw: string, decimals: number, allowNegative: boolean): string {
  let text = raw.replace(/[^\d.-]/g, "");
  const negative = allowNegative && text.startsWith("-");
  text = text.replace(/-/g, "");
  const [intPart = "", ...rest] = text.split(".");
  let result = intPart;
  if (decimals > 0 && rest.length > 0) result += `.${rest.join("").slice(0, decimals)}`;
  return (negative ? "-" : "") + result;
}

function toNumber(text: string): number | null {
  if (text === "" || text === "-" || text === "." || text === "-.") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  decimals = 2,
  allowNegative = false,
  align = "right",
  className,
  onBlur,
  onFocus,
  ...props
}: NumberInputProps) {
  const [text, setText] = useState(() => (value === null || value === undefined ? "" : String(value)));
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setText(value === null || value === undefined ? "" : String(value));
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeNumber(event.target.value, decimals, allowNegative);
    setText(next);
    onChange(toNumber(next));
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    focused.current = false;
    let n = toNumber(text);
    if (n !== null) {
      if (min !== undefined && n < min) n = min;
      if (max !== undefined && n > max) n = max;
      n = Number(n.toFixed(decimals));
      setText(String(n));
      if (n !== value) onChange(n);
    } else {
      setText("");
    }
    onBlur?.(event);
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      autoComplete="off"
      value={text}
      step={step}
      className={cn("money", align === "right" && "text-right", className)}
      onChange={handleChange}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onBlur={handleBlur}
    />
  );
}

/* ------------------------------------------------------------------ */
/* PercentInput                                                         */
/* ------------------------------------------------------------------ */

export type PercentInputProps = Omit<NumberInputProps, "decimals" | "min" | "max" | "suffix" | "allowNegative">;

/** 0–100 with two decimals and a % suffix. */
export function PercentInput(props: PercentInputProps) {
  return <NumberInput {...props} decimals={2} min={0} max={100} suffix="%" className={cn("pr-8", props.className)} />;
}

/* ------------------------------------------------------------------ */
/* MoneyInput — user types rupees, value is integer paise               */
/* ------------------------------------------------------------------ */

export interface MoneyInputProps extends Omit<BaseProps, "prefix" | "suffix"> {
  /** Integer paise. */
  value: number | null | undefined;
  onChange: (paise: number | null) => void;
  /** Show the short form (₹1.2 Cr) inside the field once the amount is ≥ ₹1 L (default true). */
  showShort?: boolean;
  allowNegative?: boolean;
  minPaise?: number;
  maxPaise?: number;
}

function formatMoneyText(raw: string, allowNegative: boolean): string {
  let text = raw.replace(/[^\d.-]/g, "");
  const negative = allowNegative && text.startsWith("-");
  text = text.replace(/-/g, "");
  const dot = text.indexOf(".");
  const intPart = (dot === -1 ? text : text.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const fracPart = dot === -1 ? null : text.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  const grouped = intPart ? groupIndian(intPart) : "";
  return (negative ? "-" : "") + grouped + (fracPart === null ? "" : `.${fracPart}`);
}

function countDigits(text: string): number {
  return text.replace(/[^\d.]/g, "").length;
}

export function MoneyInput({
  value,
  onChange,
  showShort = true,
  allowNegative = false,
  minPaise,
  maxPaise,
  className,
  onBlur,
  onFocus,
  ...props
}: MoneyInputProps) {
  const [text, setText] = useState(() => paiseToRupeesInput(value));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setText(paiseToRupeesInput(value));
  }, [value]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const element = event.target;
    const raw = element.value;
    const caret = element.selectionStart ?? raw.length;
    const digitsBefore = countDigits(raw.slice(0, caret));
    // Shorthand like "45L" / "1.2cr" is accepted on blur; while typing keep digits only.
    const hasSuffix = /[a-zA-Z]/.test(raw);
    const next = hasSuffix ? raw : formatMoneyText(raw, allowNegative);
    setText(next);
    onChange(rupeesInputToPaise(next));
    if (!hasSuffix) {
      let position = 0;
      let seen = 0;
      while (position < next.length && seen < digitsBefore) {
        if (/[\d.]/.test(next.charAt(position))) seen += 1;
        position += 1;
      }
      requestAnimationFrame(() => {
        const node = inputRef.current;
        if (node && document.activeElement === node) node.setSelectionRange(position, position);
      });
    }
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    focused.current = false;
    let paise = rupeesInputToPaise(text);
    if (paise !== null) {
      if (!allowNegative && paise < 0) paise = Math.abs(paise);
      if (minPaise !== undefined && paise < minPaise) paise = minPaise;
      if (maxPaise !== undefined && paise > maxPaise) paise = maxPaise;
      setText(paiseToRupeesInput(paise));
      if (paise !== value) onChange(paise);
    } else {
      setText("");
      if (value !== null && value !== undefined) onChange(null);
    }
    onBlur?.(event);
  };

  const short = showShort && value !== null && value !== undefined && Math.abs(value) >= 1e7 ? formatINRShort(value) : undefined;

  return (
    <Input
      {...props}
      ref={(node) => {
        inputRef.current = node;
        const forwarded = props.ref;
        if (typeof forwarded === "function") forwarded(node);
        else if (forwarded && typeof forwarded === "object") forwarded.current = node;
      }}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      prefix="₹"
      suffix={short}
      value={text}
      className={cn("money text-right", short && "pr-16", className)}
      onChange={handleChange}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onBlur={handleBlur}
    />
  );
}
