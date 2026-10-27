import { useEffect, useState } from "react";

const KEY = "kkt:density";
// localStorage: density preference — non-sensitive (CR-7)
let cur = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) || "comfortable" : "comfortable";
const subs = new Set();
export const setDensity = (d) => { cur = d; localStorage.setItem(KEY, d); subs.forEach((f) => f(d)); };
export function useDensity() {
  const [d, setD] = useState(cur);
  useEffect(() => { subs.add(setD); return () => subs.delete(setD); }, []);
  return [d, setDensity];
}
