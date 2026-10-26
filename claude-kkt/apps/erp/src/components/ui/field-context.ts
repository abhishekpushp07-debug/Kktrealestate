import { createContext, useContext } from "react";

/** Aria wiring a FieldWrapper hands to the control whose id matches its own (label → control, control → hint/error text). */
export interface FieldAria {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
  "aria-required": boolean | undefined;
}

export const FieldAriaContext = createContext<FieldAria | null>(null);

/**
 * Aria props for a form control rendered inside a FieldWrapper: when the control's `id` is the field's id, it inherits
 * aria-invalid / aria-describedby / aria-required unless it sets them itself. Controls with another id (or none) are untouched, so a
 * composite control's inner inputs never pick up the field's id.
 */
export function useFieldAria(id: string | undefined, own: { invalid?: boolean | undefined; "aria-invalid"?: unknown; "aria-describedby"?: string | undefined; "aria-required"?: unknown }): {
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
  "aria-required": boolean | undefined;
} {
  const field = useContext(FieldAriaContext);
  const wired = field !== null && id !== undefined && id === field.id;
  const ownInvalid = own.invalid === true || own["aria-invalid"] === true || own["aria-invalid"] === "true";
  return {
    "aria-invalid": ownInvalid || (wired && field["aria-invalid"]) || undefined,
    // a control's own description is kept and the field's error/hint is added to it (never replaced: the error must stay announced)
    "aria-describedby": mergeIds(own["aria-describedby"], wired ? field["aria-describedby"] : undefined),
    "aria-required": own["aria-required"] === true || own["aria-required"] === "true" || (wired && field["aria-required"]) || undefined,
  };
}

/** Space-separated id lists merged without duplicates (undefined when empty). */
function mergeIds(...lists: (string | undefined)[]): string | undefined {
  const ids = [...new Set(lists.flatMap((l) => (l ?? "").split(/\s+/)).filter(Boolean))];
  return ids.length > 0 ? ids.join(" ") : undefined;
}
