/**
 * stats.ts: the statistical core of peeksafe, implemented from scratch.
 *
 * Nothing here calls a library. Every function is a pure function of numbers so
 * it can be checked against closed-form or hand-computed values in test/.
 *
 * Contents:
 *   special functions   logGamma, logBeta, erf, normalCdf, normalQuantile, ibeta
 *   estimation          wilsonInterval, betaPosterior, betaCredibleInterval
 *   effect size         diffInterval (Newcombe hybrid score), cohensH
 *   testing             twoProportionZTest, fisherExact2x2, sprtDecision
 *   correction          bhCorrect, ebhCorrect
 *   evidence            twoSampleLogE, pairedLogE, probabilityMoved
 *   planning            sampleSizeTwoProportion, samplesForEvidence, mcnemarSamplesForEvidence
 *
 * **Domain discipline.** Every entry point that can be handed nonsense
 * (successes > trials, a negative count, a probability outside [0,1]) throws a
 * `PeeksafeError` with code `PEEKSAFE_E_STAT_DOMAIN` rather than returning NaN
 * or a plausible-looking number. Returning `Infinity` is reserved for questions
 * whose honest answer is "no finite sample size will do", see
 * `sampleSizeTwoProportion`.
 */
import { requireCounts, requireProbability, PeeksafeError } from './errors.js';

/* ────────────────────────── special functions ────────────────────────── */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Lanczos approximation to log Γ(x), x > 0. ~15 significant digits. */
export function logGamma(x: number): number {
  if (x < 0.5) {
    // reflection: Γ(x)Γ(1-x) = π / sin(πx)
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i]! / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export const logBeta = (a: number, b: number): number =>
  logGamma(a) + logGamma(b) - logGamma(a + b);

/** Series expansion of the regularized lower incomplete gamma P(a,x), x < a+1. */
function gammaPSeries(a: number, x: number): number {
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n < 500; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-17) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Lentz continued fraction for the regularized upper incomplete gamma Q(a,x). */
function gammaQContinued(a: number, x: number): number {
  const TINY = 1e-300;
  let b = x + 1 - a;
  let cf = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    cf = b + an / cf;
    if (Math.abs(cf) < TINY) cf = TINY;
    d = 1 / d;
    const del = d * cf;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularized lower incomplete gamma P(a,x), accurate to ~1e-15. */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  return x < a + 1 ? gammaPSeries(a, x) : 1 - gammaQContinued(a, x);
}

/**
 * erf(x) = sign(x)·P(½, x²).
 * Built on the incomplete gamma rather than a rational fit: the usual 7-digit
 * approximation is visible in a p-value and we compare p-values to thresholds.
 */
export function erf(x: number): number {
  if (x === 0) return 0;
  const p = gammaP(0.5, x * x);
  return x > 0 ? p : -p;
}

/** Φ(x): standard normal CDF. */
export const normalCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));

/** Φ⁻¹(p): Acklam's inverse normal CDF, refined by one Halley step. */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const cc = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((cc[0]! * q + cc[1]!) * q + cc[2]!) * q + cc[3]!) * q + cc[4]!) * q + cc[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((cc[0]! * q + cc[1]!) * q + cc[2]!) * q + cc[3]!) * q + cc[4]!) * q + cc[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  // One Halley refinement against our own Φ. Skipped in the far tails, where
  // exp(x²/2) overflows to Infinity and the refinement returns NaN, the
  // Acklam value is already good to ~1e-9 there. (REVIEW.md F6.)
  const half = (x * x) / 2;
  if (half > 300) return x;
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp(half);
  const refined = x - u / (1 + (x * u) / 2);
  return Number.isFinite(refined) ? refined : x;
}

/** Continued fraction for the incomplete beta (Lentz's method). */
function betacf(a: number, b: number, x: number): number {
  const TINY = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let cf = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    cf = 1 + aa / cf;
    if (Math.abs(cf) < TINY) cf = TINY;
    d = 1 / d;
    h *= d * cf;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    cf = 1 + aa / cf;
    if (Math.abs(cf) < TINY) cf = TINY;
    d = 1 / d;
    const del = d * cf;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/** Regularized incomplete beta Iₓ(a,b) = P(Beta(a,b) ≤ x). */
export function ibeta(a: number, b: number, x: number): number {
  if (!(a > 0) || !(b > 0) || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(x)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'ibeta: need finite a > 0, b > 0 and finite x', {
      detail: { a, b, x },
    });
  }
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b));
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(a, b, x)) / a
    : 1 - (Math.exp(b * Math.log(1 - x) + a * Math.log(x) - logBeta(b, a)) * betacf(b, a, 1 - x)) / b;
}

/* ─────────────────────────────── estimation ──────────────────────────── */

export interface Interval {
  low: number;
  high: number;
  point: number;
  /**
   * How many observations the interval rests on, when the producer knows.
   * `0` means the interval is vacuous and `point` is a placeholder, not an
   * estimate, check it before printing the point as a number.
   */
  observations?: number;
}

/**
 * Wilson score interval for a binomial proportion.
 * Correct at the boundaries (0/n and n/n) where Wald is degenerate, which is
 * exactly where eval cases live.
 */
export function wilsonInterval(successes: number, n: number, z = 1.959963984540054): Interval {
  requireCounts(successes, n, 'wilsonInterval');
  // No data is not "p = 0.5". The interval is the whole line and the point
  // estimate is NaN-free only because callers must check `n`, which is why
  // `n` is echoed back in `observations`.
  if (n === 0) return { low: 0, high: 1, point: 0.5, observations: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin), point: p, observations: n };
}

export interface BetaPosterior {
  alpha: number; beta: number;
  mean: number; mode: number; variance: number; sd: number;
  n: number; successes: number;
}

/** Conjugate Beta posterior for a per-case latent success probability. */
export function betaPosterior(
  successes: number,
  failures: number,
  prior: { alpha: number; beta: number } = { alpha: 1, beta: 1 }
): BetaPosterior {
  requireCounts(successes, successes + failures, 'betaPosterior');
  if (!(prior.alpha > 0) || !(prior.beta > 0)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'betaPosterior: prior parameters must be positive', {
      detail: { prior },
    });
  }
  const alpha = prior.alpha + successes;
  const beta = prior.beta + failures;
  const s = alpha + beta;
  return {
    alpha, beta,
    mean: alpha / s,
    mode: alpha > 1 && beta > 1 ? (alpha - 1) / (s - 2) : alpha / s,
    variance: (alpha * beta) / (s * s * (s + 1)),
    sd: Math.sqrt((alpha * beta) / (s * s * (s + 1))),
    n: successes + failures,
    successes,
  };
}

/** Inverse of the Beta CDF by bisection on ibeta (monotone, so this is exact to 1e-10). */
export function betaQuantile(alpha: number, beta: number, q: number): number {
  if (!(alpha > 0) || !(beta > 0) || !Number.isFinite(alpha) || !Number.isFinite(beta)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'betaQuantile: alpha and beta must be finite and positive', {
      detail: { alpha, beta, q },
    });
  }
  if (q <= 0) return 0;
  if (q >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (ibeta(alpha, beta, mid) < q) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

/**
 * Student-t quantile, from the Beta inverse CDF.
 *
 * Needed because the cluster-robust suite interval has a *small* number of
 * degrees of freedom, one per case family, not one per case, and at 39 df the
 * difference between t and z is already 3.2% of the half-width. Using z there
 * would reintroduce, in miniature, exactly the too-narrow-interval bug that
 * clustering exists to fix.
 *
 * The identity is the standard one: for T ~ t_ν and t > 0,
 *   P(|T| > t) = I_x(ν/2, ½)  with  x = ν/(ν + t²)
 * so inverting `ibeta` in x inverts the t CDF. Exact to the ~1e-10 of
 * `betaQuantile`, and it degenerates to `normalQuantile` as ν → ∞.
 */
export function tQuantile(p: number, df: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `tQuantile: p must be in (0,1), got ${p}`, {
      detail: { p, df },
    });
  }
  if (!Number.isFinite(df) || df <= 0) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `tQuantile: df must be finite and positive, got ${df}`, {
      detail: { p, df },
    });
  }
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  // Past this the Beta inversion loses to floating point long before the normal
  // approximation is wrong by anything a reader could see.
  if (df > 1e7) return normalQuantile(p);
  const twoSidedTail = 2 * (1 - p);
  const x = betaQuantile(df / 2, 0.5, twoSidedTail);
  if (!(x > 0)) return Infinity;
  return Math.sqrt((df * (1 - x)) / x);
}

/** Equal-tailed credible interval of a Beta posterior. */
export function betaCredibleInterval(post: BetaPosterior, level = 0.95): Interval {
  const tail = (1 - level) / 2;
  return {
    low: betaQuantile(post.alpha, post.beta, tail),
    high: betaQuantile(post.alpha, post.beta, 1 - tail),
    point: post.mean,
  };
}

/** P(a < θ < b) under a Beta posterior. */
export function betaMassBetween(post: BetaPosterior, a: number, b: number): number {
  requireProbability(a, 'a', 'betaMassBetween');
  requireProbability(b, 'b', 'betaMassBetween');
  if (a > b) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `betaMassBetween: need a ≤ b, got [${a}, ${b}]`, {
      detail: { a, b },
    });
  }
  return ibeta(post.alpha, post.beta, b) - ibeta(post.alpha, post.beta, a);
}

/* ─────────────────────────────── effect size ─────────────────────────── */

/**
 * Newcombe's hybrid-score interval for a difference of proportions (p₂ − p₁).
 * Built from the two Wilson intervals, so it stays inside [-1,1] and behaves at
 * the boundaries. This is the "effect size with a CI" that replaces "-4.5%".
 */
export function diffInterval(
  s1: number, n1: number, s2: number, n2: number, z = 1.959963984540054
): Interval {
  requireCounts(s1, n1, 'diffInterval(arm 1)');
  requireCounts(s2, n2, 'diffInterval(arm 2)');
  // With an empty arm there is no difference to estimate. Saying so beats
  // reporting `p2 − 0` as if the missing arm had scored zero.
  if (n1 === 0 || n2 === 0) return { low: -1, high: 1, point: 0, observations: 0 };
  const w1 = wilsonInterval(s1, n1, z);
  const w2 = wilsonInterval(s2, n2, z);
  const p1 = n1 > 0 ? s1 / n1 : 0;
  const p2 = n2 > 0 ? s2 / n2 : 0;
  const lower = p2 - p1 - Math.sqrt((p2 - w2.low) ** 2 + (w1.high - p1) ** 2);
  const upper = p2 - p1 + Math.sqrt((w2.high - p2) ** 2 + (p1 - w1.low) ** 2);
  return { low: Math.max(-1, lower), high: Math.min(1, upper), point: p2 - p1, observations: n1 + n2 };
}

/** Cohen's h, the scale-free effect size for proportions (arcsine transform). */
export function cohensH(p1: number, p2: number): number {
  requireProbability(p1, 'p1', 'cohensH');
  requireProbability(p2, 'p2', 'cohensH');
  return 2 * Math.asin(Math.sqrt(p2)) - 2 * Math.asin(Math.sqrt(p1));
}

/* ──────────────────────────────── testing ───────────────────────────── */

export interface TestResult { statistic: number; p: number }

/** Pooled two-proportion z-test, two-sided. */
export function twoProportionZTest(s1: number, n1: number, s2: number, n2: number): TestResult {
  requireCounts(s1, n1, 'twoProportionZTest(arm 1)');
  requireCounts(s2, n2, 'twoProportionZTest(arm 2)');
  if (n1 === 0 || n2 === 0) return { statistic: 0, p: 1 };
  const p1 = s1 / n1, p2 = s2 / n2;
  const pool = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (se === 0) return { statistic: 0, p: 1 };
  const z = (p2 - p1) / se;
  return { statistic: z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

const logChoose = (n: number, k: number): number =>
  logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);

/**
 * Fisher's exact test on a 2×2 table [[a,b],[c,d]], two-sided by the
 * sum-of-small-probabilities convention. Exact, which matters because eval
 * cases are run 8 to 30 times, not 8000.
 */
export function fisherExact2x2(a: number, b: number, cc: number, d: number): TestResult {
  for (const [name, v] of [['a', a], ['b', b], ['c', cc], ['d', d]] as const) {
    if (!Number.isInteger(v) || v < 0) {
      throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `fisherExact2x2: cell ${name} must be a non-negative integer, got ${v}`, {
        detail: { a, b, c: cc, d },
      });
    }
  }
  const r1 = a + b, r2 = cc + d, c1 = a + cc, n = r1 + r2;
  if (n === 0) return { statistic: 1, p: 1 };
  const logP = (x: number) => logChoose(r1, x) + logChoose(r2, c1 - x) - logChoose(n, c1);
  const pObs = Math.exp(logP(a));
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const px = Math.exp(logP(x));
    if (px <= pObs * (1 + 1e-7)) p += px;
  }
  const oddsRatio = b * cc === 0 ? Infinity : (a * d) / (b * cc);
  return { statistic: oddsRatio, p: Math.min(1, p) };
}

/* ──────────────────────────────── SPRT ──────────────────────────────── */

export type SprtDecision = 'ACCEPT_H0' | 'ACCEPT_H1' | 'CONTINUE';

export interface SprtResult {
  decision: SprtDecision;
  logLR: number;
  upper: number;
  lower: number;
  /** How far through the [lower, upper] corridor we are: -1 = H0 wall, +1 = H1 wall. */
  progress: number;
}

export interface SprtOpts {
  successes: number;
  trials: number;
  /** null hypothesis success probability (e.g. the baseline rate) */
  p0: number;
  /** alternative worth detecting (e.g. baseline − minimum detectable regression) */
  p1: number;
  alpha?: number;
  beta?: number;
}

/**
 * Wald's Sequential Probability Ratio Test for a Bernoulli stream.
 *
 * logLR = s·log(p₁/p₀) + (n−s)·log((1−p₁)/(1−p₀))
 * accept H₁ when logLR ≥ log((1−β)/α); accept H₀ when logLR ≤ log(β/(1−α)).
 *
 * The whole point: it is evaluated after *every* batch, so a case that is
 * obviously fine (or obviously broken) stops consuming samples immediately.
 */
export function sprtDecision(opts: SprtOpts): SprtResult {
  const { successes: s, trials: n, p0, p1 } = opts;
  requireCounts(s, n, 'sprtDecision');
  requireProbability(p0, 'p0', 'sprtDecision');
  requireProbability(p1, 'p1', 'sprtDecision');
  const alpha = opts.alpha ?? 0.05;
  const beta = opts.beta ?? 0.1;
  const e = 1e-12;
  const cl = (x: number) => Math.min(1 - e, Math.max(e, x));
  const q0 = cl(p0), q1 = cl(p1);
  const logLR = s * Math.log(q1 / q0) + (n - s) * Math.log((1 - q1) / (1 - q0));
  const upper = Math.log((1 - beta) / alpha);
  const lower = Math.log(beta / (1 - alpha));
  const decision: SprtDecision =
    logLR >= upper ? 'ACCEPT_H1' : logLR <= lower ? 'ACCEPT_H0' : 'CONTINUE';
  const progress = logLR >= 0 ? logLR / upper : -(logLR / lower);
  return { decision, logLR, upper, lower, progress: Math.max(-1, Math.min(1, progress)) };
}

/** Expected sample number for Wald's SPRT under a true rate p (Wald's approximation). */
export function sprtExpectedN(p: number, p0: number, p1: number, alpha = 0.05, beta = 0.1): number {
  requireProbability(p, 'p', 'sprtExpectedN');
  requireProbability(p0, 'p0', 'sprtExpectedN');
  requireProbability(p1, 'p1', 'sprtExpectedN');
  const A = Math.log((1 - beta) / alpha);
  const B = Math.log(beta / (1 - alpha));
  const num =
    p * Math.log(p1 / p0) + (1 - p) * Math.log((1 - p1) / (1 - p0));
  if (Math.abs(num) < 1e-12) return Infinity;
  // probability of ending at the H1 wall, Wald's approximation
  const L = p <= p1 ? 1 - beta : p >= p0 ? alpha : (p - p1) / (p0 - p1);
  return (L * A + (1 - L) * B) / num;
}

/* ───────────────────── multiple-comparison correction ────────────────── */

export interface BhResult {
  /** rejected[i] === true ⇒ case i is a discovery at FDR ≤ q */
  rejected: boolean[];
  /** BH-adjusted p-values (monotone step-up), aligned with the input order */
  adjusted: number[];
  /** the largest raw p-value that was rejected, or 0 if none */
  cutoff: number;
  discoveries: number;
}

/**
 * Benjamini-Hochberg FDR control.
 * With 200 cases at α=0.05 you expect ~10 false alarms per clean run; BH is why
 * a green suite stays green.
 */
export function bhCorrect(pvalues: number[], q = 0.05): BhResult {
  // A NaN here does not throw, it silently corrupts the sort and therefore the
  // whole step-up, so it is caught rather than propagated.
  for (let i = 0; i < pvalues.length; i++) {
    requireProbability(pvalues[i]!, `p[${i}]`, 'bhCorrect');
  }
  requireProbability(q, 'q', 'bhCorrect');
  const m = pvalues.length;
  const rejected = new Array<boolean>(m).fill(false);
  const adjusted = new Array<number>(m).fill(1);
  if (m === 0) return { rejected, adjusted, cutoff: 0, discoveries: 0 };
  const order = pvalues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let kMax = -1;
  for (let k = 0; k < m; k++) if (order[k]!.p <= ((k + 1) / m) * q) kMax = k;
  for (let k = 0; k <= kMax; k++) rejected[order[k]!.i] = true;
  // step-up monotone adjustment: q(k) = min_{j ≥ k} ( m/j · p(j) )
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    running = Math.min(running, (m / (k + 1)) * order[k]!.p);
    adjusted[order[k]!.i] = Math.min(1, running);
  }
  return {
    rejected, adjusted,
    cutoff: kMax >= 0 ? order[kMax]!.p : 0,
    discoveries: kMax + 1,
  };
}

/**
 * Log marginal likelihood of s successes in n Bernoulli trials when the rate
 * carries a Beta(a,b) prior, the beta-binomial, minus the C(n,s) term (which
 * cancels in every ratio we take).
 */
export function logMarginalBetaBinomial(s: number, n: number, a: number, b: number): number {
  // `s` may be fractional here, the planner evaluates the mean trajectory, so
  // this checks the range rather than integrality.
  if (!Number.isFinite(s) || !Number.isFinite(n) || s < 0 || n < 0 || s > n) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `logMarginalBetaBinomial: need 0 ≤ s ≤ n, got ${s}/${n}`, {
      detail: { s, n },
    });
  }
  if (!(a > 0) || !(b > 0) || !Number.isFinite(a) || !Number.isFinite(b)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'logMarginalBetaBinomial: prior parameters must be finite and positive', {
      detail: { a, b },
    });
  }
  return logBeta(a + s, b + n - s) - logBeta(a, b);
}

/**
 * A **two-sample e-value** for "the candidate is worse than the baseline".
 *
 * The one-sample alternative, test the candidate against the baseline's point
 * estimate, quietly assumes the baseline rate is known. It is not: it came
 * from 24 noisy runs, and a baseline that got lucky manufactures regressions
 * that were never there. (The demo's own Monte Carlo shows that mistake turning
 * a 5% false-discovery budget into 79% of runs.)
 *
 * So the null keeps the baseline's uncertainty: p ~ Beta(1+s_b, 1+f_b), and the
 * alternative is the same amount of information centred `mde` lower. The ratio
 * of the two marginal likelihoods is a Bayes factor, and a Bayes factor between
 * two joint distributions of the same sequence is a non-negative martingale
 * with mean 1 under the null, an e-value that stays valid however long you
 * choose to keep sampling.
 */
export function twoSampleLogE(
  candidateSuccesses: number,
  candidateTrials: number,
  baselineSuccesses: number,
  baselineTrials: number,
  mde: number,
  /**
   * Concentration of the alternative prior. Low values spread the alternative
   * over "anything materially worse", which is what actually happens when a
   * change breaks a case, it rarely lands exactly `mde` below.
   */
  altConcentration = 8
): number {
  // The central evidence primitive, and the one every verdict rests on, so it
  // gets the same domain discipline as everything else in this file rather
  // than turning `5 successes in 3 trials` into a plausible-looking Bayes
  // factor. (Found in adversarial review; it was the one function that skipped
  // the contract its own module header states.)
  requireCounts(candidateSuccesses, candidateTrials, 'twoSampleLogE(candidate)');
  requireCounts(baselineSuccesses, baselineTrials, 'twoSampleLogE(baseline)');
  requireProbability(mde, 'mde', 'twoSampleLogE');
  if (!(altConcentration > 0) || !Number.isFinite(altConcentration)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'twoSampleLogE: altConcentration must be finite and positive', {
      detail: { altConcentration },
    });
  }
  const a0 = 1 + baselineSuccesses;
  const b0 = 1 + baselineTrials - baselineSuccesses;
  const kappa = a0 + b0;
  const shifted = Math.min(0.995, Math.max(0.005, a0 / kappa - mde));
  const k1 = altConcentration;
  const a1 = Math.max(0.35, k1 * shifted);
  const b1 = Math.max(0.35, k1 * (1 - shifted));
  return (
    logMarginalBetaBinomial(candidateSuccesses, candidateTrials, a1, b1) -
    logMarginalBetaBinomial(candidateSuccesses, candidateTrials, a0, b0)
  );
}

/**
 * e-BH, Benjamini-Hochberg for **e-values** (Wang & Ramdas).
 *
 * Why this exists: a p-value computed after optional stopping is not a
 * p-value. The likelihood ratio a sequential test accumulates *is* a valid
 * e-value under H₀ (it is a non-negative martingale, so Ville's inequality
 * gives P(sup LR ≥ 1/α) ≤ α), and it stays valid if you keep sampling, which
 * is exactly what peeksafe does to confirm a flagged case.
 *
 * Reject the k largest e-values where k* = max{ k : e₍ₖ₎ ≥ m / (q·k) }.
 * Controls FDR at q under *arbitrary* dependence between cases.
 */
export interface EbhResult {
  rejected: boolean[];
  discoveries: number;
  /** the e-value a case had to beat, given how many discoveries were made */
  threshold: number;
}

export function ebhCorrect(evalues: number[], q = 0.05): EbhResult {
  for (let i = 0; i < evalues.length; i++) {
    const e = evalues[i]!;
    if (!Number.isFinite(e) || e < 0) {
      throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `ebhCorrect: e[${i}] must be finite and ≥ 0, got ${e}`, {
        detail: { index: i, value: e },
        hint: 'an e-value is a non-negative random variable with mean ≤ 1 under the null; Infinity and NaN corrupt the ranking',
      });
    }
  }
  requireProbability(q, 'q', 'ebhCorrect');
  const m = evalues.length;
  const rejected = new Array<boolean>(m).fill(false);
  if (m === 0) return { rejected, discoveries: 0, threshold: Infinity };
  const order = evalues.map((e, i) => ({ e, i })).sort((a, b) => b.e - a.e);
  let kStar = 0;
  for (let k = 1; k <= m; k++) if (order[k - 1]!.e >= m / (q * k)) kStar = k;
  for (let k = 0; k < kStar; k++) rejected[order[k]!.i] = true;
  return { rejected, discoveries: kStar, threshold: kStar > 0 ? m / (q * kStar) : m / q };
}

/** The e-value a case must reach to be certain of rejection whatever the others do. */
export const ebhSoloThreshold = (m: number, q = 0.05): number => m / q;

/* ──────────────────────────────── planning ──────────────────────────── */

/**
 * Fixed-N sample size per arm for detecting a `delta` drop from `p0` at the
 * given error rates. This is the "naive approach" peeksafe is measured against.
 *
 * Returns **Infinity** when the effect is one the case cannot suffer, a case
 * whose baseline rate is 10% cannot lose 15 points, and no number of samples
 * will find a drop that is arithmetically impossible. The old version clamped
 * `p1` to 1e-6 and answered "44 runs", which is a plausible-looking lie
 * (REVIEW.md F5) and exactly the sort of thing a budget planner must not do.
 */
export function sampleSizeTwoProportion(p0: number, delta: number, alpha = 0.05, beta = 0.1): number {
  requireProbability(p0, 'p0', 'sampleSizeTwoProportion');
  if (delta <= 0 || delta >= p0) return Infinity;
  const p1 = p0 - delta;
  const pbar = (p0 + p1) / 2;
  const zA = normalQuantile(1 - alpha / 2);
  const zB = normalQuantile(1 - beta);
  const n =
    (zA * Math.sqrt(2 * pbar * (1 - pbar)) + zB * Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))) ** 2 /
    (delta * delta);
  return Math.ceil(n);
}

/** Shannon entropy in bits of a Bernoulli(p), used as a raw instability signal. */
export function bernoulliEntropy(p: number): number {
  requireProbability(p, 'p', 'bernoulliEntropy');
  return p <= 0 || p >= 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

/* ═══════════════════ power economics: what will this cost? ════════════════
 *
 * Everything below exists to answer one question before any money is spent:
 * "given this baseline, how many runs does detecting an `mde`-point drop take,
 * and are there cases where the answer is *no number*?"
 */

/** log of the Beta(a,b) density at p. */
export function logBetaPdf(p: number, a: number, b: number): number {
  requireProbability(p, 'p', 'logBetaPdf');
  if (p <= 0 || p >= 1) {
    // density is 0 or ∞ at the boundary depending on the shape; the planner
    // only ever evaluates strictly inside, so clamp rather than return ±∞.
    p = Math.min(1 - 1e-12, Math.max(1e-12, p));
  }
  return (a - 1) * Math.log(p) + (b - 1) * Math.log(1 - p) - logBeta(a, b);
}

/** The two prior shapes `twoSampleLogE` compares. Exposed so the planner can
 *  reason about the *limit* of the evidence, not just its value at some n. */
export function twoSamplePriors(
  baselineSuccesses: number,
  baselineTrials: number,
  mde: number,
  altConcentration = 8
): { nullPrior: { a: number; b: number }; altPrior: { a: number; b: number } } {
  requireCounts(baselineSuccesses, baselineTrials, 'twoSamplePriors');
  const a0 = 1 + baselineSuccesses;
  const b0 = 1 + baselineTrials - baselineSuccesses;
  const kappa = a0 + b0;
  const shifted = Math.min(0.995, Math.max(0.005, a0 / kappa - mde));
  return {
    nullPrior: { a: a0, b: b0 },
    altPrior: {
      a: Math.max(0.35, altConcentration * shifted),
      b: Math.max(0.35, altConcentration * (1 - shifted)),
    },
  };
}

/**
 * The **evidence ceiling** of the unpaired two-sample e-value.
 *
 * This is the single most useful number the planner has, and it is not
 * obvious: the two-sample Bayes factor does *not* grow without bound in the
 * number of candidate runs. Both marginals are the same binomial likelihood
 * under different priors, so by Laplace approximation
 *
 *     log m_a(s, n) = n·h(p̂) + log f_a(p̂) + ½log(2π p̂(1−p̂)/n) + O(1/n)
 *
 * and every term except `log f(p̂)` is common to numerator and denominator.
 * The ratio therefore converges to the **prior density ratio at the observed
 * rate**:
 *
 *     lim_{n→∞} log E  =  log f_alt(p) − log f_null(p)
 *
 * Consequences the CLI reports directly:
 *   - a case whose ceiling sits below the e-BH bar `m/(q·k)` is **undetectable
 *     at any budget**: buying more candidate runs cannot certify it;
 *   - the remedy is more *baseline* runs, which sharpen f_null and raise the
 *     ceiling, that is the amortised baseline, quantified;
 *   - the paired design (`pairedLogE`) has no such ceiling, because its null is
 *     an exact point mass at ½ rather than an estimated prior.
 */
export function evidenceCeilingLogE(
  pTrue: number,
  baselineSuccesses: number,
  baselineTrials: number,
  mde: number,
  altConcentration = 8
): number {
  requireProbability(pTrue, 'pTrue', 'evidenceCeilingLogE');
  const { nullPrior, altPrior } = twoSamplePriors(
    baselineSuccesses, baselineTrials, mde, altConcentration
  );
  return logBetaPdf(pTrue, altPrior.a, altPrior.b) - logBetaPdf(pTrue, nullPrior.a, nullPrior.b);
}

/**
 * The **rate** at which the evidence ceiling grows in baseline runs: the
 * Kullback-Leibler divergence `KL(p_b ‖ p)` in nats, with the *baseline* rate
 * as the first argument.
 *
 * This is not the obvious direction, and getting it the wrong way round gives a
 * materially different number (at 85% losing 15 points: 0.0611 the right way,
 * 0.0720 the wrong way). It falls out of the Laplace expansion of the null
 * prior's own density, see `evidenceCeilingAsymptotic`.
 */
export function evidenceCeilingSlope(pBaseline: number, pCandidate: number): number {
  requireProbability(pBaseline, 'pBaseline', 'evidenceCeilingSlope');
  requireProbability(pCandidate, 'pCandidate', 'evidenceCeilingSlope');
  const a = Math.min(1 - 1e-12, Math.max(1e-12, pBaseline));
  const b = Math.min(1 - 1e-12, Math.max(1e-12, pCandidate));
  return a * Math.log(a / b) + (1 - a) * Math.log((1 - a) / (1 - b));
}

/**
 * The evidence ceiling in closed form, to O(1/n_b).
 *
 * `evidenceCeilingLogE` evaluates the exact prior density ratio. This says what
 * that ratio *is*, as a function of the baseline size, and it is the useful
 * form because it inverts:
 *
 *     ceiling(n_b) ≈ n_b · KL(p̄_b ‖ p) + log f_alt(p) + ½·log(2π p̄_b(1−p̄_b)/n_b)
 *
 * The leading term comes from Stirling on the null prior's normaliser:
 * `f_null` is a Beta posterior, its log density at `p` is
 * `−n_b·KL(p̄_b ‖ p) − ½log(2π p̄_b(1−p̄_b)/n_b) + O(1/n_b)`, and the alternative
 * prior does not move with `n_b` at all.
 *
 * Two consequences that are the practical point of the whole ceiling result:
 *
 *  - **the ceiling grows linearly in baseline runs**, at a rate that is a
 *    property of the case's pass rate and the MDE and of nothing else;
 *  - so the baseline size a case needs to be detectable at all is roughly
 *    `log(m/q) / KL(p̄_b ‖ p̄_b − δ)`, an O(1) formula where `plan.ts` searches.
 *    It is a *lower* bound: the two lower-order terms are negative at realistic
 *    `n_b`, so the honest quote is that rule of thumb plus about 20%, and
 *    `peeksafe plan` keeps reporting the exact search.
 *
 * Matches `evidenceCeilingLogE` to better than 0.1% for `n_b ≥ 240`; checked in
 * `test/paper.test.ts`.
 */
export function evidenceCeilingAsymptotic(
  baselineSuccesses: number,
  baselineTrials: number,
  pTrue: number,
  mde: number,
  altConcentration = 8
): number {
  requireCounts(baselineSuccesses, baselineTrials, 'evidenceCeilingAsymptotic');
  requireProbability(pTrue, 'pTrue', 'evidenceCeilingAsymptotic');
  if (baselineTrials === 0) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'evidenceCeilingAsymptotic: needs at least one baseline trial', {
      detail: { baselineTrials },
      hint: 'with no baseline there is no null to be uncertain about; use evidenceCeilingLogE, which handles the prior directly',
    });
  }
  // The expansion is a Laplace approximation around an *interior* rate. A
  // baseline of all passes or all failures has none, and the ½·log(2π p̄(1−p̄)/n)
  // term goes to −∞, which came back as a finite-looking -Infinity rather than
  // an error. `evidenceCeilingLogE` handles those cases exactly; this does not.
  if (baselineSuccesses === 0 || baselineSuccesses === baselineTrials) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN',
      `evidenceCeilingAsymptotic: the expansion needs an interior baseline rate, got ${baselineSuccesses}/${baselineTrials}`, {
        detail: { baselineSuccesses, baselineTrials },
        hint: 'use evidenceCeilingLogE, which evaluates the prior density ratio exactly and is defined at the boundary',
      });
  }
  // Around the observed baseline rate s/n, with n the baseline trial count. The
  // null prior is Beta(1+s, 1+n−s), so its shape parameters minus one are
  // exactly (s, n−s) and the Stirling expansion closes on s/n, shifting to the
  // posterior mean (s+1)/(n+2) instead leaves a residual that does *not* vanish.
  const pBar = baselineSuccesses / baselineTrials;
  const n = baselineTrials;
  const { altPrior } = twoSamplePriors(baselineSuccesses, baselineTrials, mde, altConcentration);
  return (
    n * evidenceCeilingSlope(pBar, pTrue) +
    logBetaPdf(pTrue, altPrior.a, altPrior.b) +
    0.5 * Math.log((2 * Math.PI * pBar * (1 - pBar)) / n)
  );
}

/**
 * The two-sample log e-value along the **mean trajectory**: the value it takes
 * when the candidate scores exactly its expected `pTrue·n` successes in `n`
 * runs. Fractional successes are legal, the beta-binomial marginal is a ratio
 * of Beta functions, which is defined on the reals.
 *
 * This is a plug-in for E[log E], not E[log E] itself. `expectedLogEExact`
 * computes the true expectation by summing over the binomial, and
 * `test/plan.test.ts` checks the two agree to within a few percent over the
 * range the planner actually uses.
 */
export function expectedLogE(
  pTrue: number,
  n: number,
  baselineSuccesses: number,
  baselineTrials: number,
  mde: number,
  altConcentration = 8
): number {
  requireProbability(pTrue, 'pTrue', 'expectedLogE');
  if (!(n >= 0) || !Number.isFinite(n)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'expectedLogE: n must be finite and ≥ 0', { detail: { n } });
  }
  const { nullPrior: n0, altPrior: a1 } = twoSamplePriors(
    baselineSuccesses, baselineTrials, mde, altConcentration
  );
  const s = pTrue * n;
  return (
    (logBeta(a1.a + s, a1.b + n - s) - logBeta(a1.a, a1.b)) -
    (logBeta(n0.a + s, n0.b + n - s) - logBeta(n0.a, n0.b))
  );
}

/** E[log E] computed exactly, by summing over every binomial outcome. O(n). */
export function expectedLogEExact(
  pTrue: number,
  n: number,
  baselineSuccesses: number,
  baselineTrials: number,
  mde: number,
  altConcentration = 8
): number {
  requireProbability(pTrue, 'pTrue', 'expectedLogEExact');
  if (!Number.isInteger(n) || n < 0) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', 'expectedLogEExact: n must be a non-negative integer', { detail: { n } });
  }
  let acc = 0;
  for (let s = 0; s <= n; s++) {
    const logW =
      logGamma(n + 1) - logGamma(s + 1) - logGamma(n - s + 1) +
      s * Math.log(Math.max(1e-300, pTrue)) + (n - s) * Math.log(Math.max(1e-300, 1 - pTrue));
    acc += Math.exp(logW) * twoSampleLogE(s, n, baselineSuccesses, baselineTrials, mde, altConcentration);
  }
  return acc;
}

/**
 * Smallest number of candidate runs whose mean-trajectory log e-value clears
 * `logThreshold`. Returns **Infinity** when the ceiling is below the threshold
 *, the honest answer to "how many runs would it take", when the answer is
 * that no number of runs will do.
 */
export function samplesForEvidence(
  pTrue: number,
  baselineSuccesses: number,
  baselineTrials: number,
  mde: number,
  logThreshold: number,
  maxN = 100_000,
  altConcentration = 8
): number {
  const ceiling = evidenceCeilingLogE(pTrue, baselineSuccesses, baselineTrials, mde, altConcentration);
  if (!(ceiling > logThreshold)) return Infinity;
  const f = (n: number) => expectedLogE(pTrue, n, baselineSuccesses, baselineTrials, mde, altConcentration);
  // exponential search then bisection; f is monotone in n below the ceiling
  let hi = 1;
  while (hi < maxN && f(hi) < logThreshold) hi *= 2;
  if (f(hi) < logThreshold) return Infinity;
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid) >= logThreshold) hi = mid;
    else lo = mid;
  }
  return hi;
}

/* ─────────────────── paired (matched) comparison, McNemar ────────────────
 *
 * Run the candidate and the baseline on the *same* input and the *same* seed
 * and you get matched pairs. Concordant pairs (both pass, both fail) carry no
 * information about a difference; the discordant ones do, and under the null
 * "nothing changed" the direction of a discordance is an exact coin flip.
 *
 * That exactness is the whole prize. The unpaired e-value has to keep the
 * baseline's own uncertainty inside its null, which is what caps its evidence.
 * The paired null is θ = ½, not estimated, not shrunk, *exact* by
 * exchangeability, so the paired e-value grows linearly in the number of
 * discordant pairs and has no ceiling.
 */

export interface PairedCounts {
  /** both arms passed */
  bothPass: number;
  /** baseline passed, candidate failed, the direction that indicates a regression */
  worse: number;
  /** candidate passed, baseline failed */
  better: number;
  /** both arms failed */
  bothFail: number;
}

export const discordant = (p: PairedCounts): number => p.worse + p.better;

/**
 * Phi coefficient of the 2×2 pair table, how well the pairing actually
 * coupled the two arms. 0 means the seeds bought nothing (the arms are
 * independent and you may as well not have paired); 1 means perfect coupling.
 * This is the number the variance-reduction claim has to be measured against,
 * not assumed.
 */
export function pairPhi(p: PairedCounts): number {
  const { bothPass: a, worse: b, better: cc, bothFail: d } = p;
  for (const [name, v] of [['bothPass', a], ['worse', b], ['better', cc], ['bothFail', d]] as const) {
    if (!Number.isInteger(v) || v < 0) {
      throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `pairPhi: ${name} must be a non-negative integer, got ${v}`, {
        detail: { counts: p },
      });
    }
  }
  const n = a + b + cc + d;
  if (n === 0) return 0;
  const den = Math.sqrt((a + b) * (cc + d) * (a + cc) * (b + d));
  return den === 0 ? 0 : (a * d - b * cc) / den;
}

/**
 * A **paired e-value** for "the candidate is worse".
 *
 * Null: each discordant pair points the wrong way with probability exactly ½.
 * Alternative: it points the wrong way with probability θ ~ Beta centred on
 * `thetaAlt`. The ratio of the two marginal likelihoods of the discordance
 * sequence is a Bayes factor, hence an e-value valid under optional stopping.
 */
export function pairedLogE(
  worse: number,
  discordantPairs: number,
  thetaAlt = 0.75,
  concentration = 6
): number {
  requireCounts(worse, discordantPairs, 'pairedLogE');
  requireProbability(thetaAlt, 'thetaAlt', 'pairedLogE');
  if (discordantPairs === 0) return 0;
  const a1 = Math.max(0.35, concentration * thetaAlt);
  const b1 = Math.max(0.35, concentration * (1 - thetaAlt));
  const alt = logMarginalBetaBinomial(worse, discordantPairs, a1, b1);
  const nul = discordantPairs * Math.log(0.5);
  return alt - nul;
}

/**
 * The discordance model a paired plan runs on.
 *
 * With probability `rho` the two arms see the same random draw and a
 * discordance can only occur inside the (p_c, p_b) gap, always in the "worse"
 * direction. With probability 1−rho they are independent and discordances go
 * both ways. `rho` is *measured* from a pilot (see `pairPhi`), not assumed.
 */
export function pairedDiscordance(
  pBaseline: number,
  mde: number,
  rho: number
): { rate: number; theta: number } {
  requireProbability(pBaseline, 'pBaseline', 'pairedDiscordance');
  requireProbability(rho, 'rho', 'pairedDiscordance');
  const pc = Math.max(0, pBaseline - mde);
  const coupledWorse = pBaseline - pc;
  const indepWorse = pBaseline * (1 - pc);
  const indepBetter = pc * (1 - pBaseline);
  const worse = rho * coupledWorse + (1 - rho) * indepWorse;
  const better = (1 - rho) * indepBetter;
  const rate = worse + better;
  return { rate, theta: rate === 0 ? 0.5 : worse / rate };
}

/**
 * Expected number of **pairs** for the paired e-value to clear `logThreshold`.
 * One pair costs one candidate run plus one baseline run, so the caller must
 * double it before comparing with `samplesForEvidence`. Even so it usually
 * wins, and unlike the unpaired design it never returns Infinity for a real
 * effect.
 */
export function mcnemarSamplesForEvidence(
  pBaseline: number,
  mde: number,
  rho: number,
  logThreshold: number,
  maxPairs = 100_000,
  concentration = 6
): number {
  const { rate, theta } = pairedDiscordance(pBaseline, mde, rho);
  if (rate <= 0 || theta <= 0.5) return Infinity;
  const f = (n: number) => {
    const nd = n * rate;
    const a1 = Math.max(0.35, concentration * theta);
    const b1 = Math.max(0.35, concentration * (1 - theta));
    const w = nd * theta;
    return (logBeta(a1 + w, b1 + nd - w) - logBeta(a1, b1)) - nd * Math.log(0.5);
  };
  let hi = 1;
  while (hi < maxPairs && f(hi) < logThreshold) hi *= 2;
  if (f(hi) < logThreshold) return Infinity;
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (f(mid) >= logThreshold) hi = mid;
    else lo = mid;
  }
  return hi;
}

/* ───────────────────────── screening statistic ───────────────────────── */

/**
 * P(p_candidate ≤ p_baseline − mde) under independent Beta posteriors, the
 * posterior probability that a case *moved*, given whatever handful of runs it
 * has so far.
 *
 * This is the screening score: cheap (one quadrature over `ibeta`), needs only
 * 3 to 4 candidate runs to be informative, and orders cases by where the
 * expensive sequential test can actually pay. It is deliberately **not** a
 * decision, screening decides where to spend, the e-value decides what is
 * true, and the FDR guarantee is unaffected by which cases you chose to look
 * at (e-BH is valid under arbitrary dependence, including a data-dependent
 * choice of which cases to sample further).
 */
export function probabilityMoved(
  baselineSuccesses: number,
  baselineTrials: number,
  candidateSuccesses: number,
  candidateTrials: number,
  mde: number,
  nodes = 256
): number {
  requireCounts(baselineSuccesses, baselineTrials, 'probabilityMoved(baseline)');
  requireCounts(candidateSuccesses, candidateTrials, 'probabilityMoved(candidate)');
  if (candidateTrials === 0) return 0;
  const a0 = 1 + baselineSuccesses, b0 = 1 + baselineTrials - baselineSuccesses;
  const a1 = 1 + candidateSuccesses, b1 = 1 + candidateTrials - candidateSuccesses;
  // Simpson's rule on ∫ f_b(x) · F_c(x − mde) dx over (0,1)
  const m = nodes % 2 === 0 ? nodes : nodes + 1;
  const h = 1 / m;
  let acc = 0;
  for (let i = 0; i <= m; i++) {
    const x = Math.min(1 - 1e-9, Math.max(1e-9, i * h));
    const w = i === 0 || i === m ? 1 : i % 2 === 1 ? 4 : 2;
    const fb = Math.exp(logBetaPdf(x, a0, b0));
    const fc = x - mde <= 0 ? 0 : ibeta(a1, b1, Math.min(1, x - mde));
    acc += w * fb * fc;
  }
  return Math.min(1, Math.max(0, (acc * h) / 3));
}
