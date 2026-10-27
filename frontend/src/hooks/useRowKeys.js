import { useRef } from "react";

const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k${Math.random().toString(36).slice(2)}`);

/**
 * Stable per-row keys for positional form rows that have no id of their own.
 * A key is minted when a row first appears and follows the row through edits (same index, replaced object),
 * removals (surviving rows keep their identity → keep their key) and appends (new object → new key),
 * so inputs never remount. Returns [{ k, row }] in row order.
 */
export function useRowKeys(rows) {
  const prev = useRef({ rows: [], keys: [] });
  const list = rows || [];
  const byIdentity = new Map(prev.current.rows.map((r, i) => [r, prev.current.keys[i]]));
  const used = new Set();
  const keys = list.map((r, i) => {
    let k = byIdentity.get(r);
    if (k === undefined || used.has(k)) {
      const atIndex = prev.current.keys[i];
      k = atIndex !== undefined && !used.has(atIndex) && !list.some((o, j) => j !== i && byIdentity.get(o) === atIndex) ? atIndex : newKey();
    }
    used.add(k);
    return k;
  });
  prev.current = { rows: list, keys };
  return list.map((row, i) => ({ k: keys[i], row }));
}
