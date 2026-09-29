/**
 * check.ts: the type I error the gate delivers at a rate you name.
 *
 * The two-sample e-value is not an e-value at every fixed rate (README, "What
 * that guarantee rests on"), so its error control is computed rather than
 * assumed. This is that computation, for a caller whose rates, baseline sizes
 * or options sit outside the grid the tests check.
 */
import { twoSampleLogE, logGamma } from './stats.js';
import { cannotDropBy, DEFAULT_GATE_OPTIONS } from './gate.js';
import { PeeksafeError, requireOpenProbability } from './errors.js';

export interface TypeOneErrorOptions {
  /** Shared true pass rate of the baseline and the candidate. */
  rate: number;
  /** Baseline runs the case will be gated against. */
  baselineTrials: number;
  /** The bar is `1 / alpha`. For `gate`'s solo bar pass `fdr / suiteSize`. */
  alpha: number;
  /** The most candidate runs any case could reach, e.g. `shouldStop`'s `maxTrials`. */
  horizon: number;
  mde?: number;
  altConcentration?: number;
}

/**
 * Exact probability that a case which did not move is ever certified within
 * `horizon` candidate runs, however it was stopped. At or below `alpha` means
 * the gate keeps its promise for this case.
 *
 * Exact because the e-value depends on the candidate only through its counts,
 * so a dynamic program over the success count replaces simulation. A 240-run
 * baseline at a horizon of 600 takes tens of milliseconds.
 */
export function typeOneError(options: TypeOneErrorOptions): number {
  const { rate, baselineTrials: nb, alpha, horizon } = options;
  const mde = options.mde ?? DEFAULT_GATE_OPTIONS.mde;
  const concentration = options.altConcentration ?? DEFAULT_GATE_OPTIONS.altConcentration;
  requireOpenProbability(rate, 'rate', 'typeOneError');
  requireOpenProbability(alpha, 'alpha', 'typeOneError');
  requireOpenProbability(mde, 'mde', 'typeOneError');
  for (const [name, v] of [['baselineTrials', nb], ['horizon', horizon]] as const) {
    if (!Number.isInteger(v) || v < 1) {
      throw new PeeksafeError('PEEKSAFE_E_CONFIG', `typeOneError: ${name} must be a positive integer, got ${v}`, {
        detail: { [name]: v },
      });
    }
  }

  const bar = Math.log(1 / alpha);
  const logChoose = (n: number, k: number) => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  let total = 0;
  for (let sb = 0; sb <= nb; sb++) {
    const weight = Math.exp(logChoose(nb, sb) + sb * Math.log(rate) + (nb - sb) * Math.log(1 - rate));
    if (weight < 1e-12 || cannotDropBy({ successes: sb, trials: nb }, mde)) continue;
    let alive = new Float64Array(horizon + 1);
    alive[0] = 1;
    let crossed = 0;
    // Only the band of success counts still carrying mass is stepped.
    let lo = 0;
    let hi = 0;
    for (let n = 1; n <= horizon; n++) {
      const next = new Float64Array(horizon + 1);
      for (let s = lo; s <= hi; s++) {
        next[s + 1]! += alive[s]! * rate;
        next[s]! += alive[s]! * (1 - rate);
      }
      hi++;
      // logE falls as successes rise, so the paths that cross are a prefix.
      for (let s = lo; s <= hi && twoSampleLogE(s, n, sb, nb, mde, concentration) >= bar; s++) {
        crossed += next[s]!;
        next[s] = 0;
      }
      while (lo < hi && next[lo]! < 1e-18) lo++;
      while (hi > lo && next[hi]! < 1e-18) hi--;
      alive = next;
    }
    total += weight * crossed;
  }
  return total;
}
