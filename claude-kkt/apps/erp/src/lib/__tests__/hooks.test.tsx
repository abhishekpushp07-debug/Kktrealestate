import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useNow, useOnChange } from "../utils";

/**
 * useOnChange replaced the "reset local state in an effect" pattern across the ERP (dialogs, form sheets, deep links).
 * These checks pin the timing it promises: it fires on the first render (like the effect it replaced) and on every key
 * change, adjusts state before anything is committed, and settles once the key is stable (no render loop).
 */
describe("useOnChange", () => {
  it("fires on the first render, so the first output already shows the adjusted state", () => {
    function Probe({ open }: { open: boolean }) {
      const [text, setText] = useState("stale");
      useOnChange(open, (isOpen) => setText(isOpen ? "fresh form" : "closed"));
      return <span>{text}</span>;
    }
    expect(renderToStaticMarkup(<Probe open />)).toBe("<span>fresh form</span>");
    expect(renderToStaticMarkup(<Probe open={false} />)).toBe("<span>closed</span>");
  });

  it("fires once per distinct key and stops when the key is stable", () => {
    const seen: number[] = [];
    function Probe() {
      // the key walks 1 → 2 → 3 through render-phase updates, then stays at 3
      const [key, setKey] = useState(1);
      if (key < 3) setKey(key + 1);
      const [fired, setFired] = useState(0);
      useOnChange(key, (next) => {
        seen.push(next);
        setFired((count) => count + 1);
      });
      return (
        <span>
          {key}:{fired}
        </span>
      );
    }
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>3:3</span>");
    expect(seen).toEqual([1, 2, 3]);
  });

  it("does not fire again for an equal primitive key (Object.is)", () => {
    let calls = 0;
    function Probe() {
      const [tick, setTick] = useState(0);
      if (tick < 2) setTick(tick + 1); // re-renders with the same key
      useOnChange("same-key", () => {
        calls += 1;
      });
      return <span>{tick}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>2</span>");
    expect(calls).toBe(1);
  });
});

describe("useNow", () => {
  it("returns the current time, identical for every reader in one render", () => {
    const reads: number[] = [];
    function Reader() {
      reads.push(useNow());
      return null;
    }
    const before = Date.now();
    renderToStaticMarkup(
      <>
        <Reader />
        <Reader />
        <Reader />
      </>,
    );
    expect(new Set(reads).size).toBe(1);
    expect(Math.abs((reads[0] ?? 0) - before)).toBeLessThan(30_000);
  });
});
