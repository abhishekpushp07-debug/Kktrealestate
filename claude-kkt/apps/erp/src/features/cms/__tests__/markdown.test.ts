import { describe, expect, it } from "vitest";
import { markdownExcerpt, parseInline, parseMarkdown, renderMarkdownToHtml, sanitizeUrl } from "../markdown";

describe("sanitizeUrl", () => {
  it("allows http(s), mailto, tel and relative paths", () => {
    expect(sanitizeUrl("https://kkt.example/projects")).toBe("https://kkt.example/projects");
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
    expect(sanitizeUrl("mailto:sales@example.com")).toBe("mailto:sales@example.com");
    expect(sanitizeUrl("tel:+919876543210")).toBe("tel:+919876543210");
    expect(sanitizeUrl("/privacy")).toBe("/privacy");
    expect(sanitizeUrl("#faq")).toBe("#faq");
    expect(sanitizeUrl("about-us")).toBe("about-us");
  });

  it("rejects javascript:, data:, vbscript:, protocol-relative and obfuscated schemes", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("JavaScript:alert(1)")).toBeNull();
    expect(sanitizeUrl(" javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("java\u0000script:alert(1)")).toBeNull();
    expect(sanitizeUrl("java&#115;cript:alert(1)")).toBeNull();
    expect(sanitizeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(sanitizeUrl("vbscript:msgbox")).toBeNull();
    expect(sanitizeUrl("//evil.example/x")).toBeNull();
    expect(sanitizeUrl("")).toBeNull();
  });
});

describe("renderMarkdownToHtml", () => {
  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdownToHtml('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders headings, paragraphs, emphasis and code", () => {
    expect(renderMarkdownToHtml("# Title\n\nSome **bold** and *italic* with `code`.")).toBe("<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> with <code>code</code>.</p>");
    expect(renderMarkdownToHtml("### Three")).toBe("<h3>Three</h3>");
    expect(renderMarkdownToHtml("snake_case_word stays")).toBe("<p>snake_case_word stays</p>");
  });

  it("renders unordered and ordered lists with safe links", () => {
    const html = renderMarkdownToHtml("- [Projects](https://kkt.example/projects)\n- Plain item\n\n1. first\n2. second");
    expect(html).toBe('<ul><li><a href="https://kkt.example/projects" target="_blank" rel="noopener noreferrer">Projects</a></li><li>Plain item</li></ul><ol><li>first</li><li>second</li></ol>');
    expect(renderMarkdownToHtml("3. third\n4. fourth")).toBe('<ol start="3"><li>third</li><li>fourth</li></ol>');
  });

  it("drops javascript: links (keeps the text) and unsafe images", () => {
    expect(renderMarkdownToHtml("[click](javascript:alert(1))")).toBe("<p>click</p>");
    expect(renderMarkdownToHtml("![logo](data:image/svg+xml;base64,AAAA)")).toBe("<p>logo</p>");
    expect(renderMarkdownToHtml("![logo](/media/1.webp)")).toBe('<p><img src="/media/1.webp" alt="logo" loading="lazy"></p>');
  });

  it("escapes attribute values inside links and titles", () => {
    const html = renderMarkdownToHtml('[x](https://a.example/?q="><script> "t")');
    expect(html).toContain('href="https://a.example/?q=&quot;&gt;&lt;script');
    expect(html).toContain('title="t"');
    expect(html).not.toContain("<script>");
  });

  it("renders fenced code blocks verbatim (escaped), quotes, rules and hard breaks", () => {
    expect(renderMarkdownToHtml("```html\n<b>raw</b>\n```")).toBe('<pre><code class="language-html">&lt;b&gt;raw&lt;/b&gt;</code></pre>');
    expect(renderMarkdownToHtml("> quoted **text**\n> more")).toBe("<blockquote><p>quoted <strong>text</strong> more</p></blockquote>");
    expect(renderMarkdownToHtml("a\n\n---\n\nb")).toBe("<p>a</p><hr><p>b</p>");
    expect(renderMarkdownToHtml("line one  \nline two")).toBe("<p>line one<br>line two</p>");
  });

  it("keeps internal links in the same tab", () => {
    expect(renderMarkdownToHtml("[Privacy](/privacy)")).toBe('<p><a href="/privacy">Privacy</a></p>');
  });
});

describe("parser helpers", () => {
  it("builds a tree with paragraphs separated by blank lines", () => {
    const blocks = parseMarkdown("one\ntwo\n\nthree");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe("paragraph");
  });

  it("treats unmatched markers as text", () => {
    expect(parseInline("a * b ** c")).toEqual([{ type: "text", text: "a * b ** c" }]);
    expect(parseInline("[not a link]")).toEqual([{ type: "text", text: "[not a link]" }]);
  });

  it("produces a plain-text excerpt", () => {
    expect(markdownExcerpt("# Hello\n\nSome **bold** text with [a link](https://x.example).")).toBe("Hello Some bold text with a link.");
    expect(markdownExcerpt("word ".repeat(100), 20).endsWith("…")).toBe(true);
  });
});
