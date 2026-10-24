import { describe, expect, it } from "vitest";
import { csvField, parseCsv, parseCsvObjects } from "../../src/lib/csv.js";

describe("RFC 4180 parser", () => {
  it("handles quotes, doubled quotes, embedded commas/newlines, CRLF and BOM", () => {
    const text = '﻿name,code,note\r\n"Aadhaar, front",AADHAAR,"He said ""hi""\nsecond line"\r\nPlain,PLAIN,\r\n';
    const rows = parseCsv(text);
    expect(rows).toEqual([["name", "code", "note"], ["Aadhaar, front", "AADHAAR", 'He said "hi"\nsecond line'], ["Plain", "PLAIN", ""]]);
  });
  it("maps header names to values with 1-based source lines and skips blank lines", () => {
    const { headers, rows } = parseCsvObjects("a,b\n1,2\n\n3,4\n");
    expect(headers).toEqual(["a", "b"]);
    expect(rows).toEqual([{ line: 2, values: { a: "1", b: "2" } }, { line: 3, values: { a: "3", b: "4" } }]);
  });
  it("quotes fields that need it", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField(null)).toBe("");
    expect(csvField(new Date("2025-04-01T00:00:00Z"))).toBe("2025-04-01T00:00:00.000Z");
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
  });
});
