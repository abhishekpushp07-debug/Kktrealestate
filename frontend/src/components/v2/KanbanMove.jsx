import { useEffect, useState } from "react";
import { ArrowRightLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const useNarrow = (bp = 1024) => {
  const [n, setN] = useState(() => typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => { const f = () => setN(window.innerWidth < bp); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [bp]);
  return n;
};

// Keyboard: ArrowLeft/Right moves card to previous/next column. Returns props to spread on the card wrapper.
export const moveKeyProps = (columns, current, onMove) => ({
  tabIndex: 0,
  onKeyDown: (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = columns.indexOf(current), j = e.key === "ArrowLeft" ? i - 1 : i + 1;
    if (j < 0 || j >= columns.length) return;
    e.preventDefault(); e.stopPropagation(); onMove(columns[j]);
  },
});

export function MoveMenu({ columns, current, onMove, testId }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn btn-secondary btn-sm !h-8 w-full justify-between" aria-haspopup="menu" aria-expanded={open} data-testid={testId}><span className="flex items-center gap-1.5"><ArrowRightLeft className="h-3.5 w-3.5" />Move to…</span><ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} /></button>
      {open && <ul role="menu" className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-warm-200 bg-white shadow-lg" data-testid={`${testId}-menu`}>
        {columns.filter((c) => c !== current).map((c) => <li key={c}><button type="button" role="menuitem" onClick={() => { setOpen(false); onMove(c); }} className="w-full px-3 py-2.5 text-left text-sm hover:bg-warm-100" data-testid={`${testId}-${c.replace(/\s+/g, "-").toLowerCase()}`}>{c}</button></li>)}
      </ul>}
    </div>
  );
}
