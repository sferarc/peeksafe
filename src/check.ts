/**
 * check.ts: the error rate and the power the gate delivers at rates you name.
 *
 * The two-sample e-value is not an e-value at every fixed rate (README, "What
 * that guarantee rests on"), so its error control is computed rather than
 * assumed. This is that computation, for a caller whose rates, baseline sizes
 * or options sit outside the grid the tests check. Moving the candidate below
 * the baseline turns the same computation into the power.
 */

import {
  PeeksafeError,
  requireOpenProbability,
  requirePositiveConfig,
  requireProbability,
} from "./errors.js";
import { type Evidence, requireEvidence } from "./evidence.js";
import { cannotDropBy, DEFAULT_GATE_OPTIONS } from "./gate.js";
import { logBeta, logGamma, pairedLogE, twoSamplePriors } from "./stats.js";

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
  /** Which e-value `gate` will use. */
  evidence?: Evidence;
}

export interface CertifyProbabilityOptions extends Omit<TypeOneErrorOptions, "rate"> {
  /** True pass rate of the baseline revision. */
  baselineRate: number;
  /** True pass rate of the candidate revision. */
  candidateRate: number;
}

/**
 * Exact probability that a case is certified as regressed within `horizon`
 * candidate runs, however it was stopped. With the candidate below the baseline
 * this is the power; at or above it, the type I error.
 *
 * Exact because the e-value depends on the candidate only through its counts,
 * so a dynamic program over the success count replaces simulation. A 240-run
 * baseline at a horizon of 600 takes tens of milliseconds.
 */
export function certifyProbability(options: CertifyProbabilityOptions): number {
  const { baselineRate, candidateRate: pc, baselineTrials: nb, alpha, horizon } = options;
  const mde = options.mde ?? DEFAULT_GATE_OPTIONS.mde;
  const concentration = options.altConcentration ?? DEFAULT_GATE_OPTIONS.altConcentration;
  const evidence = options.evidence ?? DEFAULT_GATE_OPTIONS.evidence;
  requireEvidence(evidence, "certifyProbability");
  requireOpenProbability(baselineRate, "baselineRate", "certifyProbability");
  requireOpenProbability(pc, "candidateRate", "certifyProbability");
  requireOpenProbability(alpha, "alpha", "certifyProbability");
  requireOpenProbability(mde, "mde", "certifyProbability");
  requirePositiveConfig(concentration, "altConcentration", "certifyProbability");
  for (const [name, v] of [
    ["baselineTrials", nb],
    ["horizon", horizon],
  ] as const) {
    if (!Number.isInteger(v) || v < 1) {
      throw new PeeksafeError(
        "PEEKSAFE_E_CONFIG",
        `certifyProbability: ${name} must be a positive integer, got ${v}`,
        {
          detail: { [name]: v },
        },
      );
    }
  }

  const bar = Math.log(1 / alpha);
  const logChoose = (n: number, k: number) =>
    logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  let total = 0;
  for (let sb = 0; sb <= nb; sb++) {
    const weight = Math.exp(
      logChoose(nb, sb) + sb * Math.log(baselineRate) + (nb - sb) * Math.log(1 - baselineRate),
    );
    if (weight < 1e-12 || cannotDropBy({ successes: sb, trials: nb }, mde)) continue;
    const { nullPrior: n0, altPrior: a1 } = twoSamplePriors(sb, nb, mde, concentration);
    let alive = new Float64Array(horizon + 1);
    alive[0] = 1;
    let crossed = 0;
    // Only the band of success counts still carrying mass is stepped.
    let lo = 0;
    let hi = 0;
    for (let n = 1; n <= horizon; n++) {
      const next = new Float64Array(horizon + 1);
      for (let s = lo; s <= hi; s++) {
        next[s + 1]! += alive[s]! * pc;
        next[s]! += alive[s]! * (1 - pc);
      }
      hi++;
      // Every count in the band is tested: logE is not monotone in s, so the
      // crossing set need not be a prefix. Successive counts differ by a ratio
      // of Beta functions, which keeps this cheap.
      let logE = rawLogE(lo, n, sb, nb, n0, a1);
      for (let s = lo; s <= hi; s++) {
        if (s > lo) {
          const f = n - s + 1;
          logE +=
            Math.log((a1.a + s - 1) / (a1.b + f - 1)) - Math.log((n0.a + s - 1) / (n0.b + f - 1));
        }
        const decided =
          evidence === "universal"
            ? universalFromBayes(logE, s, n, sb, nb)
            : s / n >= sb / nb
              ? Math.min(0, logE)
              : logE;
        if (decided >= bar) {
          crossed += next[s]!;
          next[s] = 0;
        }
      }
      while (lo < hi && next[lo]! < 1e-18) lo++;
      while (hi > lo && next[hi]! < 1e-18) hi--;
      alive = next;
    }
    total += weight * crossed;
  }
  return total;
}

const xlogy = (x: number, y: number): number => (x === 0 ? 0 : x * Math.log(y));

/** The uncapped Bayes factor, which both statistics are built from. */
const rawLogE = (
  s: number,
  n: number,
  _sb: number,
  _nb: number,
  n0: { a: number; b: number },
  a1: { a: number; b: number },
): number =>
  logBeta(a1.a + s, a1.b + n - s) -
  logBeta(a1.a, a1.b) -
  (logBeta(n0.a + s, n0.b + n - s) - logBeta(n0.a, n0.b));

/** `universalTwoSampleLogE`, from the uncapped Bayes factor: times the pooled mixture over the null maximum. */
function universalFromBayes(rawLog: number, s: number, n: number, sb: number, nb: number): number {
  const S = sb + s;
  const N = nb + n;
  const pb = sb / nb;
  const pc = s / n;
  const sup =
    pc >= pb
      ? xlogy(sb, pb) + xlogy(nb - sb, 1 - pb) + xlogy(s, pc) + xlogy(n - s, 1 - pc)
      : xlogy(S, S / N) + xlogy(N - S, 1 - S / N);
  return rawLog + logBeta(1 + S, 1 + N - S) - sup;
}

/**
 * Exact probability that a case which did not move is ever certified within
 * `horizon` candidate runs, however it was stopped. At or below `alpha` means
 * the gate keeps its promise for this case.
 */
export function typeOneError(options: TypeOneErrorOptions): number {
  const { rate, ...rest } = options;
  requireOpenProbability(rate, "rate", "typeOneError");
  return certifyProbability({ ...rest, baselineRate: rate, candidateRate: rate });
}

export interface PairedCertifyProbabilityOptions {
  /** True pass rate of the baseline revision. */
  baselineRate: number;
  /** True pass rate of the candidate revision. */
  candidateRate: number;
  /** Share of pairs whose two runs see the same random draw (a shared seed); 0 for independent runs. */
  coupling?: number;
  /** The bar is `1 / alpha`. For `gate`'s solo bar pass `fdr / suiteSize`. */
  alpha: number;
  /** The most pairs any case could reach. */
  horizon: number;
}

/**
 * `certifyProbability` for a paired case: the exact probability it is certified within
 * `horizon` pairs, however it was stopped. The power when the candidate is lower.
 */
export function pairedCertifyProbability(options: PairedCertifyProbabilityOptions): number {
  const { baselineRate: pb, candidateRate: pc, alpha, horizon } = options;
  const rho = options.coupling ?? 0;
  requireOpenProbability(pb, "baselineRate", "pairedCertifyProbability");
  requireOpenProbability(pc, "candidateRate", "pairedCertifyProbability");
  requireOpenProbability(alpha, "alpha", "pairedCertifyProbability");
  requireProbability(rho, "coupling", "pairedCertifyProbability");
  if (!Number.isInteger(horizon) || horizon < 1) {
    throw new PeeksafeError(
      "PEEKSAFE_E_CONFIG",
      `pairedCertifyProbability: horizon must be a positive integer, got ${horizon}`,
      {
        detail: { horizon },
      },
    );
  }
  const worse = rho * Math.max(0, pb - pc) + (1 - rho) * pb * (1 - pc);
  const better = rho * Math.max(0, pc - pb) + (1 - rho) * pc * (1 - pb);
  const bar = Math.log(1 / alpha);
  // The e-value depends on (worse, discordant) only, so crossing is tabulated once per state.
  const crosses = Array.from({ length: horizon + 1 }, (_, d) =>
    Uint8Array.from({ length: d + 1 }, (_, w) => (pairedLogE(w, d) >= bar ? 1 : 0)),
  );
  // alive[d][w]: probability of d discordant pairs, w of them worse, and no crossing yet.
  let alive: Float64Array[] = [Float64Array.of(1)];
  let crossed = 0;
  for (let n = 1; n <= horizon; n++) {
    const next = Array.from({ length: n + 1 }, (_, d) => new Float64Array(d + 1));
    for (let d = 0; d < n; d++) {
      const row = alive[d]!;
      for (let w = 0; w <= d; w++) {
        const m = row[w]!;
        if (m < 1e-300) continue;
        next[d]![w]! += m * (1 - worse - better);
        next[d + 1]![w + 1]! += m * worse;
        next[d + 1]![w]! += m * better;
      }
    }
    for (let d = 1; d <= n; d++) {
      const row = next[d]!;
      const cross = crosses[d]!;
      for (let w = 0; w <= d; w++) {
        if (cross[w] && row[w]! > 0) {
          crossed += row[w]!;
          row[w] = 0;
        }
      }
    }
    alive = next;
  }
  return crossed;
}
