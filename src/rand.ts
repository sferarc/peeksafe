/**
 * rand.ts: deterministic randomness.
 *
 * Everything stochastic in peeksafe (the Monte Carlo checks in `test/`, and any
 * simulation a caller wants to run) draws from here.
 *
 * The generator is a Numerical Recipes LCG with an integer avalanche applied to
 * each draw. The LCG alone is not good enough: consecutive outputs of a linear
 * congruential generator sit on a lattice, which visibly biases Bernoulli
 * streams, and a Bernoulli stream is the only thing this library ever simulates.
 * The mixer decorrelates without adding a dependency and without losing
 * determinism.
 *
 * The exact stream matters. The measurements in the README and in
 * `test/paper.test.ts` were produced by this generator, so replacing it with a
 * better one (sfc32, pcg) would change every reported figure. That is a fine
 * thing to do deliberately, with the numbers re-derived and the README updated.
 * It is not a fine thing to do by accident, which is why the constants are
 * spelled out here rather than imported.
 */
import { PeeksafeError } from './errors.js';

export interface Rand {
  (): number;
  /** A single Bernoulli draw at rate `p`. */
  bernoulli(p: number): boolean;
  /** A uniform integer in `[0, nExclusive)`. */
  int(nExclusive: number): number;
  /** A uniform choice. Throws on an empty array rather than returning undefined. */
  pick<T>(xs: readonly T[]): T;
  /** A standard normal draw, via Box-Muller. */
  normal(): number;
}

/** Numerical Recipes LCG. Exact in float64: 2^32 * 1664525 sits under 2^53. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a. Used to derive an independent seed per named stream. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function makeRand(seed: number | string): Rand {
  const s = typeof seed === 'string' ? hash32(seed) : seed >>> 0;
  const base = lcg(s === 0 ? 1 : s);
  const next = (() => mix32(Math.floor(base() * 0x100000000)) / 0x100000000) as Rand;

  next.bernoulli = (p: number) => next() < p;

  next.int = (n: number) => {
    if (!Number.isInteger(n) || n < 1) {
      throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `rand.int: n must be a positive integer, got ${n}`, {
        detail: { n },
      });
    }
    return Math.floor(next() * n) % n;
  };

  // Typed `T`, so it must never hand back `undefined`. Returning `xs[0]` for an
  // empty array is `undefined` wearing a `T`, which is how a fail-open bug gets
  // past the type checker.
  next.pick = <T,>(xs: readonly T[]): T => {
    if (xs.length === 0) {
      throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'rand.pick: cannot pick from an empty array');
    }
    return xs[next.int(xs.length)]!;
  };

  next.normal = () => {
    const u = Math.max(1e-12, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  return next;
}

/** A stream keyed by name, reproducible regardless of call order elsewhere. */
export const streamFor = (...parts: Array<string | number>): Rand => makeRand(hash32(parts.join('|')));
