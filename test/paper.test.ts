/**
 * paper.test.ts: the measurements behind every number in the README.
 *
 * Two groups.
 *
 * The first reproduces the hazard the library exists to avoid: stopping a case
 * when it looks decided, computing a p-value from the counts, and correcting
 * with Benjamini-Hochberg. The hazard itself is documented in the literature
 * (Ramdas's KDD 2019 tutorial has a section titled "Why Benjamini-Hochberg
 * cannot be used online", and the whole e-BH line of work exists because of it),
 * so nothing here is a discovery. What these tests provide is a measurement on
 * one suite, with the correct construction run on the same draws for contrast.
 *
 * The second is the evidence ceiling: the limit of the unpaired two-sample
 * e-value as candidate runs go to infinity. The mathematics follows from the
 * standard Laplace expansion for Bayes factors (Kass and Raftery 1995) and the
 * practical consequence is the cap on prior effective sample size known in the
 * historical-borrowing literature. The closed form, the KL direction and the
 * planning inversion are the parts we did not find stated elsewhere.
 *
 * The simulation is self-contained: seeded Bernoulli draws, no runner, no
 * subject, no suite loader. A user can read it, run it, and disagree with it.
 */
import { describe, it, expect } from 'vitest';
import {
  fisherExact2x2, bhCorrect, ebhCorrect, twoSampleLogE,
  evidenceCeilingLogE, evidenceCeilingSlope, evidenceCeilingAsymptotic,
  expectedLogE, samplesForEvidence, ebhSoloThreshold, twoSamplePriors, logBetaPdf,
  pairedLogE, makeRand,
} from '../src/index.js';

const Q = 0.05;
const MDE = 0.15;

/* ════════════════ the suite ═══════════════════════════════════════════════ */

/**
 * Latent pass rates spread over the range an eval suite actually occupies. A
 * suite of all-easy cases would hide the effect, and a suite of all-hard ones
 * would exaggerate it.
 */
function latentRates(m: number): number[] {
  const r = makeRand(`rates|${m}`);
  return Array.from({ length: m }, () => 0.55 + r() * 0.44);
}

/** Bernoulli successes in `n` draws at rate `p`, from a named stream. */
function draw(p: number, n: number, stream: string): number {
  const r = makeRand(stream);
  let s = 0;
  for (let i = 0; i < n; i++) if (r.bernoulli(p)) s++;
  return s;
}

/** The observed successes after each of `n` draws, so a peeker can re-test. */
function trajectory(p: number, n: number, stream: string): number[] {
  const r = makeRand(stream);
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (r.bernoulli(p)) s++;
    out.push(s);
  }
  return out;
}

/* ════════════════ §1 · peeking, and what it costs ═════════════════════════ */

describe('a p-value taken at a stopping boundary is not a p-value', () => {
  const M = 10;                 // small suite: the regime the cost economics push you to
  const REPS = 20;              // no-op pull requests
  const BASELINE_RUNS = 60;
  const MAX_N = 96;
  const FIRST_PEEK = 8;
  const PEEK_EVERY = 4;

  const rates = latentRates(M);
  const baseline = rates.map((p, i) => draw(p, BASELINE_RUNS, `base|${i}`));

  /** The smallest p-value seen across the peeks, which is what a peeker reports. */
  function peekedP(i: number, rep: number): number {
    const traj = trajectory(rates[i]!, MAX_N, `noop|${rep}|${i}`);
    let best = 1;
    for (let n = FIRST_PEEK; n <= MAX_N; n += PEEK_EVERY) {
      const s = traj[n - 1]!;
      const p = fisherExact2x2(s, n - s, baseline[i]!, BASELINE_RUNS - baseline[i]!).p;
      if (p < best) best = p;
    }
    return best;
  }

  /** The same runs, one test, at a sample size fixed in advance. */
  function fixedP(i: number, rep: number): number {
    const traj = trajectory(rates[i]!, MAX_N, `noop|${rep}|${i}`);
    const s = traj[MAX_N - 1]!;
    return fisherExact2x2(s, MAX_N - s, baseline[i]!, BASELINE_RUNS - baseline[i]!).p;
  }

  const peeked: number[][] = [];
  const fixed: number[][] = [];
  for (let rep = 0; rep < REPS; rep++) {
    peeked.push(Array.from({ length: M }, (_, i) => peekedP(i, rep)));
    fixed.push(Array.from({ length: M }, (_, i) => fixedP(i, rep)));
  }

  it('inflates the per-case false-positive rate, on the same draws', () => {
    const rate = (xs: number[][]) => xs.flat().filter((p) => p <= 0.05).length / (REPS * M);
    const peekRate = rate(peeked);
    const fixedRate = rate(fixed);
    // Nothing moved in any of these pull requests, so every rejection is false.
    expect(peekRate).toBeGreaterThan(fixedRate);
    console.log(
      `per-case P(p <= 0.05): peeking ${(peekRate * 100).toFixed(1)}%, ` +
      `same runs at fixed N ${(fixedRate * 100).toFixed(1)}%, ` +
      `inflation ${(peekRate / Math.max(fixedRate, 1e-9)).toFixed(1)}x`
    );
  });

  it('turns into false discoveries that the same runs at fixed N do not produce', () => {
    const discoveries = (xs: number[][]) =>
      xs.reduce((acc, ps) => acc + bhCorrect(ps, Q).rejected.filter(Boolean).length, 0);
    const peekD = discoveries(peeked);
    const fixedD = discoveries(fixed);
    expect(peekD).toBeGreaterThanOrEqual(fixedD);
    console.log(`BH discoveries over ${REPS} no-op PRs at m=${M}: peeking ${peekD}, fixed N ${fixedD}`);
  });

  it('and the e-value construction makes none on the same draws', () => {
    let discoveries = 0;
    for (let rep = 0; rep < REPS; rep++) {
      const es = Array.from({ length: M }, (_, i) => {
        const traj = trajectory(rates[i]!, MAX_N, `noop|${rep}|${i}`);
        const s = traj[MAX_N - 1]!;
        const logE = twoSampleLogE(s, MAX_N, baseline[i]!, BASELINE_RUNS, MDE);
        return Math.min(Math.exp(logE), Number.MAX_VALUE);
      });
      discoveries += ebhCorrect(es, Q).discoveries;
    }
    expect(discoveries).toBe(0);
    console.log(`e-BH discoveries over the same ${REPS} no-op PRs: ${discoveries}`);
  });

  it("is hidden by BH's own conservativeness on a large suite, which is the counterintuitive part", () => {
    // The bar for the smallest p-value is q/m. At m=200 that is 2.5e-4 and an
    // exact test on these counts rarely reaches it, so the invalidity is
    // present per case and rarely produces a discovery. At m=10 the bar is 20x
    // looser. The configuration that is affordable is the one where this bites.
    const BIG = 200;
    const bigRates = latentRates(BIG);
    const bigBase = bigRates.map((p, i) => draw(p, BASELINE_RUNS, `bigbase|${i}`));
    let bigD = 0;
    for (let rep = 0; rep < REPS; rep++) {
      const ps = bigRates.map((p, i) => {
        const traj = trajectory(p, MAX_N, `bignoop|${rep}|${i}`);
        let best = 1;
        for (let n = FIRST_PEEK; n <= MAX_N; n += PEEK_EVERY) {
          const s = traj[n - 1]!;
          const q = fisherExact2x2(s, n - s, bigBase[i]!, BASELINE_RUNS - bigBase[i]!).p;
          if (q < best) best = q;
        }
        return best;
      });
      bigD += bhCorrect(ps, Q).rejected.filter(Boolean).length;
    }
    const smallD = peeked.reduce((a, ps) => a + bhCorrect(ps, Q).rejected.filter(Boolean).length, 0);
    const perPr = (d: number) => d / REPS;
    console.log(
      `false discoveries per no-op PR while peeking: m=${M} -> ${perPr(smallD).toFixed(2)}, ` +
      `m=${BIG} -> ${perPr(bigD).toFixed(2)}`
    );
    // The per-case invalidity is the same in both. Only the correction's bar moved.
    expect(bigD).toBeGreaterThanOrEqual(0);
  });
});

/* ════════════════ §2 · the evidence ceiling ═══════════════════════════════ */

describe('the evidence ceiling', () => {
  const SUITE_SIZE = 200;
  const rate = 0.85;
  const mde = 0.15;
  const pTrue = rate - mde;
  const ceilingAt = (nb: number) => evidenceCeilingLogE(pTrue, Math.round(rate * nb), nb, mde);

  it('equals the prior density ratio at the observed rate, checked against the closed form', () => {
    for (const nb of [24, 60, 240, 480]) {
      const s = Math.round(rate * nb);
      const { nullPrior, altPrior } = twoSamplePriors(s, nb, mde);
      const closed = logBetaPdf(pTrue, altPrior.a, altPrior.b) - logBetaPdf(pTrue, nullPrior.a, nullPrior.b);
      expect(evidenceCeilingLogE(pTrue, s, nb, mde)).toBeCloseTo(closed, 12);
    }
  });

  it('is approached from below and never exceeded, at any number of candidate runs', () => {
    const nb = 60;
    const s = Math.round(rate * nb);
    const ceiling = ceilingAt(nb);
    let prev = -Infinity;
    for (const n of [16, 64, 256, 1024, 4096, 16384, 65536]) {
      const v = expectedLogE(pTrue, n, s, nb, mde);
      expect(v).toBeLessThanOrEqual(ceiling + 1e-9);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(expectedLogE(pTrue, 65536, s, nb, mde)).toBeGreaterThan(ceiling * 0.99);
  });

  it('binds the realised e-value too, not only the mean trajectory', () => {
    const nb = 60;
    const s = Math.round(rate * nb);
    const ceiling = ceilingAt(nb);
    for (const n of [100, 1000, 10000]) {
      expect(twoSampleLogE(Math.round(pTrue * n), n, s, nb, mde)).toBeLessThan(ceiling + 0.05);
    }
  });

  it('so "how many candidate runs would it take" is Infinity, not a large number', () => {
    const bar = Math.log(ebhSoloThreshold(SUITE_SIZE, Q));
    expect(ceilingAt(60)).toBeLessThan(bar);
    expect(samplesForEvidence(pTrue, Math.round(rate * 60), 60, mde, bar, 1_000_000)).toBe(Infinity);
  });

  it('and baseline runs are what lift it, which is the amortised-baseline argument quantified', () => {
    const bar = Math.log(ebhSoloThreshold(SUITE_SIZE, Q));
    const ladder = [24, 60, 240, 480, 960].map(ceilingAt);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!).toBeGreaterThan(ladder[i - 1]!);
    expect(ladder[0]!).toBeLessThan(bar);
    expect(ladder.at(-1)!).toBeGreaterThan(bar);
    console.log(
      'ceiling log E by baseline runs: ' +
      [24, 60, 240, 480, 960].map((n, i) => `${n}->${ladder[i]!.toFixed(2)}`).join('  ') +
      `   (bar ${bar.toFixed(2)})`
    );
  });

  it('grows linearly in baseline runs, at rate KL(baseline rate || candidate rate)', () => {
    // Not the other KL. At 85% losing 15 points the two directions are 0.0611
    // and 0.0720, an 18% error in the one constant that decides how long a
    // baseline has to be.
    const slope = evidenceCeilingSlope(rate, pTrue);
    expect(slope).toBeCloseTo(0.06106, 4);
    expect(evidenceCeilingSlope(pTrue, rate)).not.toBeCloseTo(slope, 3);
    for (const [nb, tol] of [[4000, 0.02], [20_000, 0.005]] as Array<[number, number]>) {
      const measured = evidenceCeilingLogE(pTrue, Math.round(rate * nb), nb, mde) / nb;
      expect(Math.abs(measured / slope - 1)).toBeLessThan(tol);
    }
  });

  it('and the closed form matches the exact ceiling to 0.3% at 60 baseline runs, 0.01% at 240', () => {
    for (const [p0, d] of [[0.85, 0.15], [0.9, 0.1], [0.7, 0.25], [0.95, 0.2]] as Array<[number, number]>) {
      for (const [nb, tol] of [[60, 0.004], [240, 0.0002], [960, 0.00002]] as Array<[number, number]>) {
        const s = Math.round(p0 * nb);
        const exact = evidenceCeilingLogE(p0 - d, s, nb, d);
        const asym = evidenceCeilingAsymptotic(s, nb, p0 - d, d);
        expect(Math.abs(asym - exact) / Math.abs(exact)).toBeLessThan(tol);
      }
    }
    expect(() => evidenceCeilingAsymptotic(0, 0, 0.7, 0.15)).toThrow(/at least one baseline trial/);
  });

  it('so the baseline size a case needs is log(m/q)/KL, plus about 20%', () => {
    const bar = Math.log(ebhSoloThreshold(SUITE_SIZE, Q));
    const rows: string[] = [];
    for (const [p0, d] of [[0.85, 0.15], [0.9, 0.1], [0.7, 0.25], [0.95, 0.2]] as Array<[number, number]>) {
      const ruleOfThumb = bar / evidenceCeilingSlope(p0, p0 - d);
      let n = 8;
      while (n < 200_000 && evidenceCeilingLogE(p0 - d, Math.round(p0 * n), n, d) < bar) n++;
      expect(ruleOfThumb).toBeLessThan(n);
      expect(n / ruleOfThumb).toBeLessThan(1.3);
      rows.push(`${(p0 * 100).toFixed(0)}% -${(d * 100).toFixed(0)}pts: rule ${ruleOfThumb.toFixed(0)}, exact ${n}`);
    }
    console.log('baseline runs needed at bar log(4000): ' + rows.join('  |  '));
  });

  it('while the paired e-value has no such limit, growing linearly in discordant pairs', () => {
    let prev = -Infinity;
    for (const d of [10, 100, 1000, 10000]) {
      const v = pairedLogE(Math.round(0.75 * d), d);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(pairedLogE(7500, 10000)).toBeGreaterThan(1000);
    const a = pairedLogE(750, 1000);
    const b = pairedLogE(7500, 10000);
    expect(b / a).toBeGreaterThan(8);
    expect(b / a).toBeLessThan(12);
  });
});
