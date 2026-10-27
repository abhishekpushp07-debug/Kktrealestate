import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Field, Input, Select, Textarea } from "@/components/ui/Field";

function attrs(html: string, tag: string): Record<string, string> {
  const m = new RegExp(`<${tag}\\b([^>]*)>`).exec(html);
  const out: Record<string, string> = {};
  for (const a of (m?.[1] ?? "").matchAll(/([a-zA-Z-:]+)="([^"]*)"/g)) out[a[1]!] = a[2]!;
  return out;
}

describe("website form fields wire aria-invalid / aria-describedby to the error text", () => {
  it("an input in an errored Field is invalid and described by the error (role=alert)", () => {
    const html = renderToStaticMarkup(
      <Field label="Name" htmlFor="name" error="Please enter your name." required>
        <Input id="name" />
      </Field>,
    );
    expect(attrs(html, "input")).toMatchObject({
      id: "name",
      "aria-invalid": "true",
      "aria-describedby": "name-error",
      "aria-required": "true",
    });
    expect(html).toContain(
      '<p id="name-error" class="mt-1.5 text-sm text-danger" role="alert">Please enter your name.</p>',
    );
  });

  it("the hint describes the control when there is no error; textareas and selects are wired the same way", () => {
    const t = renderToStaticMarkup(
      <Field label="Message" htmlFor="msg" hint="Optional">
        <Textarea id="msg" />
      </Field>,
    );
    expect(attrs(t, "textarea")["aria-describedby"]).toBe("msg-hint");
    expect(attrs(t, "textarea")["aria-invalid"]).toBeUndefined();
    const s = renderToStaticMarkup(
      <Field label="BHK" htmlFor="bhk" error="Pick one">
        <Select id="bhk">
          <option>2</option>
        </Select>
      </Field>,
    );
    expect(attrs(s, "select")).toMatchObject({ "aria-invalid": "true", "aria-describedby": "bhk-error" });
  });

  it("a control's own aria-describedby keeps the error in the description (merged, never replaced); other controls are untouched", () => {
    const html = renderToStaticMarkup(
      <Field label="Phone" htmlFor="phone" error="Bad">
        <Input id="phone" aria-describedby="custom" />
        <Input id="other" />
      </Field>,
    );
    expect(attrs(html, "input")["aria-describedby"]).toBe("custom phone-error");
    const same = renderToStaticMarkup(
      <Field label="Phone" htmlFor="p2" error="Bad">
        <Input id="p2" aria-describedby="p2-error" />
      </Field>,
    );
    expect(attrs(same, "input")["aria-describedby"]).toBe("p2-error");
    expect(html).toMatch(/<input[^>]*id="other"(?![^>]*aria-invalid)[^>]*>/);
  });
});
