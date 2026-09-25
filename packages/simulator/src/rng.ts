/**
 * Seeded RNG.
 *
 * Simulated telemetry has to be reproducible: a failing rules-engine or
 * threshold test is worthless if the numbers differ on the next run. mulberry32
 * is small, fast and good enough for plausible sensor noise — it is not, and
 * does not need to be, cryptographically sound.
 */

/** Returns a deterministic [0, 1) generator for the given seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
