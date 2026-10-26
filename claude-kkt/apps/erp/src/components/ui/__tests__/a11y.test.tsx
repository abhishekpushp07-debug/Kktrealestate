import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api";
import { reportsFor } from "@/features/reports/reports";
import type { PermissionRequirement } from "@/lib/permissions";
import { ErrorState } from "../error-state";
import { FieldWrapper } from "../form";
import { Input, Textarea } from "../input";
import { Select } from "../select";

/** Attributes of the first element matching `tag` in an HTML string. */
function attrs(html: string, tag: string): Record<string, string> {
  const m = new RegExp(`<${tag}\\b([^>]*)>`).exec(html);
  const out: Record<string, string> = {};
  for (const a of (m?.[1] ?? "").matchAll(/([a-zA-Z-:]+)="([^"]*)"/g)) out[a[1]!] = a[2]!;
  return out;
}

describe("form fields wire aria-invalid / aria-describedby to the error text", () => {
  it("a control given only the field id inherits aria-invalid, aria-describedby (→ the error) and aria-required", () => {
    const html = renderToStaticMarkup(
      <FieldWrapper label="Phone" error="Enter a 10-digit mobile number" required id="phone">
        {(control) => <Input id={control.id} />}
      </FieldWrapper>,
    );
    const input = attrs(html, "input");
    expect(input.id).toBe("phone");
    expect(input["aria-invalid"]).toBe("true");
    expect(input["aria-describedby"]).toBe("phone-error");
    expect(input["aria-required"]).toBe("true");
    expect(html).toMatch(/<p id="phone-error" role="alert"/);
    expect(attrs(html, "label").for).toBe("phone");
  });

  it("the hint is the description when there is no error; textareas and selects are wired the same way", () => {
    const hint = renderToStaticMarkup(<FieldWrapper label="Note" hint="Shown to the customer" id="note">{(c) => <Textarea id={c.id} />}</FieldWrapper>);
    expect(attrs(hint, "textarea")["aria-describedby"]).toBe("note-hint");
    expect(attrs(hint, "textarea")["aria-invalid"]).toBeUndefined();
    const select = renderToStaticMarkup(
      <FieldWrapper label="Mode" error="Pick a mode" id="mode">
        {(c) => <Select id={c.id} value={null} onValueChange={() => undefined} options={[{ value: "CASH", label: "Cash" }]} />}
      </FieldWrapper>,
    );
    const trigger = attrs(select, "button");
    expect(trigger.id).toBe("mode");
    expect(trigger["aria-invalid"]).toBe("true");
    expect(trigger["aria-describedby"]).toBe("mode-error");
  });

  it("a control's own aria-describedby keeps the field's error in the description (merged, not replaced)", () => {
    const html = renderToStaticMarkup(
      <FieldWrapper label="Amount" error="Exceeds the bucket cap" id="amt">
        {(c) => <Input id={c.id} aria-describedby="amt-words" />}
      </FieldWrapper>,
    );
    expect(attrs(html, "input")["aria-describedby"]).toBe("amt-words amt-error");
    const same = renderToStaticMarkup(<FieldWrapper label="A" error="Bad" id="a">{(c) => <Input id={c.id} aria-describedby="a-error" />}</FieldWrapper>);
    expect(attrs(same, "input")["aria-describedby"]).toBe("a-error");
  });

  it("controls with a different id are not touched (no duplicate wiring inside composite controls)", () => {
    const html = renderToStaticMarkup(<FieldWrapper label="X" error="Bad" id="x">{() => <Input id="other" />}</FieldWrapper>);
    expect(attrs(html, "input")["aria-invalid"]).toBeUndefined();
    expect(attrs(html, "input")["aria-describedby"]).toBeUndefined();
  });
});

describe("ErrorState: 403 and 404 render the existing states with their own copy and no Retry", () => {
  const forbidden = new ApiClientError({ status: 403, code: "FORBIDDEN", message: "Forbidden" });
  const missing = new ApiClientError({ status: 404, code: "NOT_FOUND", message: "Booking not found" });
  const failed = new ApiClientError({ status: 500, code: "INTERNAL", message: "Boom" });

  it("403 → no access, no retry", () => {
    const html = renderToStaticMarkup(<ErrorState error={forbidden} onRetry={() => undefined} />);
    expect(html).toContain("data-error-kind=\"forbidden\"");
    expect(html).toContain("have access");
    expect(html).not.toContain("Retry");
  });

  it("404 → not found (scoped users get 404 for other projects), no retry", () => {
    const html = renderToStaticMarkup(<ErrorState error={missing} onRetry={() => undefined} />);
    expect(html).toContain("data-error-kind=\"not-found\"");
    expect(html).toContain("Not found");
    expect(html).not.toContain("Retry");
  });

  it("other errors keep the message and the Retry button", () => {
    const html = renderToStaticMarkup(<ErrorState error={failed} onRetry={() => undefined} />);
    expect(html).toContain("data-error-kind=\"error\"");
    expect(html).toContain("Retry");
  });
});

describe("Activity report is gated on audit.view (the API guards GET /reports/activity with it)", () => {
  const canWith = (held: string[]) => (p: PermissionRequirement) => (Array.isArray(p) ? p : [p]).some((x) => held.includes(x as string));

  it("hidden without audit.view, shown with it; every other report stays visible to report.view", () => {
    const without = reportsFor(canWith(["report.view"])).map((r) => r.slug);
    const withAudit = reportsFor(canWith(["report.view", "audit.view"])).map((r) => r.slug);
    expect(without).not.toContain("activity");
    expect(withAudit).toContain("activity");
    expect(withAudit.length - without.length).toBe(1);
    expect(reportsFor(canWith(["report.view", "audit.view"])).find((r) => r.slug === "activity")?.permission).toBe("audit.view");
  });
});
