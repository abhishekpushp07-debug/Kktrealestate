import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../MarkdownView";

describe("<Markdown />", () => {
  it("renders raw HTML as escaped text, never as elements", () => {
    const html = renderToStaticMarkup(
      <Markdown source={"<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>"} />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders lists and safe links with noopener on external targets", () => {
    const html = renderToStaticMarkup(
      <Markdown source={"- [Site](https://kkt.example)\n- [Privacy](/privacy)\n\n1. one"} />,
    );
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain('href="https://kkt.example"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/<a[^>]*href="\/privacy"[^>]*>Privacy<\/a>/);
    expect(html).not.toMatch(/href="\/privacy"[^>]*target=/);
  });

  it("drops javascript: and data: URLs but keeps the link text", () => {
    const html = renderToStaticMarkup(
      <Markdown source={"[run](javascript:alert(1)) and ![p](data:image/png;base64,AAAA)"} />,
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<img");
    expect(html).toContain("run and p");
  });

  it("shows the empty hint for blank input", () => {
    expect(renderToStaticMarkup(<Markdown source="   " />)).toContain("Nothing to preview yet.");
  });
});
