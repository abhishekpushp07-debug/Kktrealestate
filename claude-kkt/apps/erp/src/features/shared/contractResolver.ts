import { toNestErrors, validateFieldsNatively } from "@hookform/resolvers";
import type { FieldError, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

/** Zod v4 reports missing values as "expected X, received undefined/null"; forms want "Required". */
function friendlyMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_type" && /received (null|undefined)/.test(issue.message)) return "Required";
  if (issue.code === "too_small" && issue.origin === "string" && issue.minimum === 1) return "Required";
  if (issue.code === "too_small" && issue.origin === "array" && issue.minimum === 1) return "Add at least one";
  return issue.message;
}

/**
 * react-hook-form resolver backed by a `@kkt/contracts` schema.
 *
 * The form state (`Values`) may be looser than the wire shape (numbers that are `null` while
 * empty, UI-only keys stripped by a `.transform().pipe()` wrapper); the schema decides what is
 * valid and `handleSubmit` receives the parsed `Output`, ready to send.
 */
export function contractResolver<Values extends FieldValues, Output>(
  schema: z.ZodType<Output>,
): Resolver<Values, unknown, Output> {
  return async (values, _context, options) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) {
      if (options.shouldUseNativeValidation) validateFieldsNatively({}, options);
      return { values: result.data, errors: {} };
    }
    const flat: Record<string, FieldError> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.map((segment) => String(segment)).join(".") || "root";
      if (!(path in flat)) flat[path] = { type: issue.code, message: friendlyMessage(issue) };
    }
    const errors = toNestErrors<Values>(flat, options);
    if (options.shouldUseNativeValidation) validateFieldsNatively(errors, options);
    return { values: {}, errors };
  };
}
