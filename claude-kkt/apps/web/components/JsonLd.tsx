import type { JsonLdObject } from "@/lib/seo";

/**
 * Structured data. The payload is our own serialised JSON (never author HTML); "<" is escaped so
 * a string value can never close the script element.
 */
export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/-->/g, "--\\>");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
