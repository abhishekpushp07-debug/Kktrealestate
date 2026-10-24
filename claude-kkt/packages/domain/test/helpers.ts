/** Deterministic PRNG (mulberry32) for property-style tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [min, max]. */
export function randInt(next: () => number, min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1));
}

/** Random list of positive basis points that sums to exactly 10000. */
export function randomPercentBps(next: () => number, count: number): number[] {
  const cuts = new Set<number>();
  while (cuts.size < count - 1) {
    cuts.add(randInt(next, 1, 9999));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: number[] = [];
  let prev = 0;
  for (const cut of sorted) {
    out.push(cut - prev);
    prev = cut;
  }
  out.push(10000 - prev);
  return out;
}
