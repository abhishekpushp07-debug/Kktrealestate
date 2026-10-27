import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useIsClient, usePrefersReducedMotion, useUtmParams } from "@/components/ui/hooks";

/**
 * The website hooks moved from "set state in a mount effect" to useSyncExternalStore. Server rendering (and therefore
 * hydration) must see the neutral values; the browser values arrive after hydration without a mismatch.
 */
describe("website hooks on the server", () => {
  it("report the neutral server values", () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useIsClient(), usePrefersReducedMotion(), useUtmParams());
      return null;
    }
    renderToString(<Probe />);
    expect(seen).toEqual([false, false, {}]);
  });
});
