import { useEffect, useMemo, useRef, useState } from "react";

/** Table UI state: density, hidden columns (persisted per table), visible/labelled columns, sort toggle, right-edge scroll affordance. */
export function useTableState({ columns, items, sort, setSort, testId, denseDefault }) {
  const [dense, setDense] = useState(denseDefault);
  const scrollRef = useRef(null);
  const [atEnd, setAtEnd] = useState(true);
  // localStorage: hidden-column preference per table — non-sensitive (CR-7)
  const [hidden, setHidden] = useState(() => new Set(JSON.parse(localStorage.getItem(`kkt:cols:${testId}`) || "[]")));
  const toggleCol = (k) => { const n = new Set(hidden); n.has(k) ? n.delete(k) : n.add(k); setHidden(n); localStorage.setItem(`kkt:cols:${testId}`, JSON.stringify([...n])); };
  const cols = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);
  const labelled = useMemo(() => columns.filter((c) => c.label), [columns]);
  const toggleSort = (key) => { if (setSort) setSort(sort === key ? `-${key}` : key); };
  const onScroll = () => { const el = scrollRef.current; if (el) setAtEnd(el.scrollWidth - el.clientWidth - el.scrollLeft < 4); };
  useEffect(() => { onScroll(); }, [items, cols.length]); // eslint-disable-line
  return { dense, setDense, hidden, toggleCol, cols, labelled, toggleSort, scrollRef, atEnd, onScroll };
}
