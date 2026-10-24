import { parseHostMap, resolveApp } from "./hostResolver";

const MAP = { "erp.example.com": "erp", "my.example.com": "portal", "www.example.com": "site" };

test("parseHostMap tolerates bad JSON", () => {
  expect(parseHostMap("nope")).toEqual({});
  expect(parseHostMap(JSON.stringify(MAP))).toEqual(MAP);
});

test("path-based routing on unmapped hosts (preview)", () => {
  expect(resolveApp("preview.emergentagent.com", "/", MAP)).toMatchObject({ app: "site", base: "" });
  expect(resolveApp("preview.emergentagent.com", "/erp/dashboard", MAP)).toMatchObject({ app: "erp", base: "/erp" });
  expect(resolveApp("preview.emergentagent.com", "/portal/payments", MAP)).toMatchObject({ app: "portal", base: "/portal" });
});

test("host-mapped apps mount at / and redirect prefixed paths", () => {
  expect(resolveApp("my.example.com", "/payments", MAP)).toMatchObject({ app: "portal", base: "", hostMode: true });
  expect(resolveApp("my.example.com", "/portal/payments", MAP)).toMatchObject({ app: "portal", redirect: "/payments" });
  expect(resolveApp("erp.example.com", "/erp", MAP)).toMatchObject({ app: "erp", redirect: "/" });
  expect(resolveApp("www.example.com", "/erp/login", MAP)).toMatchObject({ app: "site", redirect: "/" });
  expect(resolveApp("WWW.example.com", "/projects", MAP)).toMatchObject({ app: "site", hostMode: true });
});
