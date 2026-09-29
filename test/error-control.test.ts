/**
 * error-control.test.ts: does the gate keep the error rate it promises?
 *
 * `twoSampleLogE` is a Bayes factor whose null is the baseline's posterior. The
 * martingale argument makes it an e-value on average over the shared rate
 * (drawn from the uniform prior the posterior starts from), which the first
 * test checks exactly. It does not make it an e-value at every fixed rate, and
 * the third test shows a rate where it is not. So the frequentist property a
 * user relies on, that a case which did not move clears 1/alpha with
 * probability at most alpha however long it runs, is computed here directly
 * rather than inferred.
 *
 * The crossing probabilities come from `typeOneError`, which is exact rather
 * than simulated.
 */
import { describe, it, expect } from 'vitest';
import {
  twoSampleLogE, twoSamplePriors, logMarginalBetaBinomial, logGamma, logBeta, gate, shouldStop, makeRand,
  typeOneError, certifyProbability, type BaselineStat, type GateCase,
} from '../src/index.js';

const logChoose = (n: number, k: number): number => logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
const logBinom = (n: number, k: number, p: number): number =>
  logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p);

const typeOne = (rate: number, baselineTrials: number, mde: number, alpha: number, horizon: number, altConcentration = 8) =>
  typeOneError({ rate, baselineTrials, mde, alpha, horizon, altConcentration });

describe('what the martingale argument does guarantee', () => {
  it('has mean exactly 1 when the shared rate is drawn from the uniform prior, before the cap', () => {
    // Integrating p out of Binom(nb, p) x Binom(n, p) leaves C(nb,sb) C(n,s) B(1+sb+s, 1+fb+f).
    for (const [nb, n, mde] of [[10, 20, 0.15], [60, 96, 0.15], [24, 200, 0.05]] as const) {
      let raw = 0;
      let capped = 0;
      for (let sb = 0; sb <= nb; sb++) {
        const { nullPrior, altPrior } = twoSamplePriors(sb, nb, mde);
        for (let s = 0; s <= n; s++) {
          const w = logChoose(nb, sb) + logChoose(n, s) + logBeta(1 + sb + s, 1 + nb - sb + n - s);
          const bayesFactor =
            logMarginalBetaBinomial(s, n, altPrior.a, altPrior.b) - logMarginalBetaBinomial(s, n, nullPrior.a, nullPrior.b);
          raw += Math.exp(w + bayesFactor);
          capped += Math.exp(w + twoSampleLogE(s, n, sb, nb, mde));
        }
      }
      expect(raw, `nb=${nb} n=${n}`).toBeCloseTo(1, 9);
      expect(capped, `nb=${nb} n=${n}`).toBeLessThan(raw);
    }
  });
});

describe('what the gate promises at every fixed rate', () => {
  it('a case that did not move clears 1/alpha with probability at most alpha, however long it runs', () => {
    let worst = { ratio: 0, cell: '' };
    for (const alpha of [0.05, 1 / 4000]) {
      for (const nb of [10, 30, 60, 240]) {
        for (const mde of [0.05, 0.15, 0.3]) {
          for (const p of [0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 0.95, 0.99]) {
            const ratio = typeOne(p, nb, mde, alpha, 600) / alpha;
            if (ratio > worst.ratio) worst = { ratio, cell: `alpha=${alpha} nb=${nb} mde=${mde} p=${p}` };
            expect(ratio, `alpha=${alpha} nb=${nb} mde=${mde} p=${p}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    console.log(`worst type I error over the grid: ${worst.ratio.toFixed(3)} x alpha at ${worst.cell}`);
  });

  it('an improved case is certified with probability at most alpha, however long it runs', () => {
    // The null is "not worse", so a candidate above its baseline is a null case too.
    for (const alpha of [0.05, 1 / 4000]) {
      for (const nb of [10, 60, 240]) {
        for (const [baselineRate, candidateRate] of [[0.3, 0.5], [0.5, 0.6], [0.5, 0.95], [0.85, 0.9], [0.9, 0.99]] as const) {
          const p = certifyProbability({ baselineRate, candidateRate, baselineTrials: nb, alpha, horizon: 600 });
          expect(p / alpha, `alpha=${alpha} nb=${nb} ${baselineRate} -> ${candidateRate}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is not an e-value at every fixed rate, which is why the crossing is checked directly', () => {
    // At 0.5% the uniform prior's posterior sits well above the truth, so the
    // candidate looks worse than a baseline it matches.
    const [p, nb, n, mde] = [0.005, 30, 1000, 0.05];
    let mean = 0;
    for (let sb = 0; sb <= nb; sb++) {
      const weight = Math.exp(logBinom(nb, sb, p));
      if (weight < 1e-15 || sb / nb <= mde) continue;
      for (let s = 0; s <= n; s++) mean += weight * Math.exp(logBinom(n, s, p) + twoSampleLogE(s, n, sb, nb, mde));
    }
    expect(mean).toBeGreaterThan(2.5);
  });

  it('certifyProbability agrees with a brute-force scan of every count', () => {
    const [pb, pc, nb, mde, alpha, horizon] = [0.8, 0.6, 20, 0.15, 0.01, 60];
    let brute = 0;
    for (let sb = 0; sb <= nb; sb++) {
      if (sb / nb <= mde) continue;
      let alive = new Float64Array(horizon + 1);
      alive[0] = 1;
      let crossed = 0;
      for (let n = 1; n <= horizon; n++) {
        const next = new Float64Array(horizon + 1);
        for (let s = 0; s < n; s++) {
          next[s + 1]! += alive[s]! * pc;
          next[s]! += alive[s]! * (1 - pc);
        }
        for (let s = 0; s <= n; s++) {
          if (twoSampleLogE(s, n, sb, nb, mde) >= Math.log(1 / alpha)) {
            crossed += next[s]!;
            next[s] = 0;
          }
        }
        alive = next;
      }
      brute += Math.exp(logBinom(nb, sb, pb)) * crossed;
    }
    expect(certifyProbability({ baselineRate: pb, candidateRate: pc, baselineTrials: nb, mde, alpha, horizon })).toBeCloseTo(brute, 10);
  });
});

describe('typeOneError refuses what it cannot compute', () => {
  it('throws on a horizon or baseline that is not a positive integer, and on a rate at 0 or 1', () => {
    const ok = { rate: 0.5, baselineTrials: 60, alpha: 0.05, horizon: 100 };
    expect(() => typeOneError({ ...ok, horizon: 0 })).toThrow(expect.objectContaining({ code: 'PEEKSAFE_E_CONFIG' }));
    expect(() => typeOneError({ ...ok, baselineTrials: 2.5 })).toThrow(expect.objectContaining({ code: 'PEEKSAFE_E_CONFIG' }));
    expect(() => typeOneError({ ...ok, rate: 1 })).toThrow(expect.objectContaining({ code: 'PEEKSAFE_E_STAT_DOMAIN' }));
  });
});

describe('where the bound is known not to hold', () => {
  // Pinned so the README's list of exceptions stays true; a fix should flip these.
  it('exceeds alpha in the corners the README names', () => {
    const cells = [
      { label: '30-run baseline at 0.5%, mde 0.05', ratio: typeOne(0.005, 30, 0.05, 1 / 4000, 1000) * 4000 },
      { label: 'altConcentration 2, 5-run baseline', ratio: typeOne(0.005, 5, 0.15, 0.005, 600, 2) / 0.005 },
      { label: 'altConcentration 100, rate at mde', ratio: typeOne(0.15, 240, 0.15, 1 / 4000, 600, 100) * 4000 },
    ];
    for (const c of cells) console.log(`type I error ${c.ratio.toFixed(2)} x alpha: ${c.label}`);
    for (const c of cells) expect(c.ratio, c.label).toBeGreaterThan(1);
  });
});

describe('the whole loop: shouldStop to decide when to stop, gate to decide', () => {
  const M = 10;
  const PRS = 400;
  const CAP = 200;

  /** One simulated pull request, every case run through shouldStop in batches of 8. */
  function runPr(seed: string, rates: number[], drops: number[]): { regressed: boolean[] } {
    const r = makeRand(seed);
    const draw = (p: number, n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) if (r.bernoulli(p)) s++;
      return s;
    };
    const baselines: BaselineStat[] = rates.map((p, i) => ({ caseId: `c${i}`, successes: draw(p, 60), trials: 60 }));
    const cases: GateCase[] = rates.map((p, i) => {
      const truth = Math.max(0, p - drops[i]!);
      const s = { successes: 0, trials: 0 };
      while (true) {
        s.successes += draw(truth, 8);
        s.trials += 8;
        if (shouldStop(s, baselines[i]!, { suiteSize: M, maxTrials: CAP }).stop) break;
      }
      return { id: `c${i}`, ...s, baseline: baselines[i]! };
    });
    return { regressed: gate(cases).cases.map((c) => c.regressed) };
  }

  const rates = (seed: string) => {
    const r = makeRand(seed);
    return Array.from({ length: M }, () => 0.55 + r() * 0.44);
  };

  it('a suite where nothing moved raises a false alarm on at most fdr of pull requests', () => {
    let alarms = 0;
    for (let k = 0; k < PRS; k++) {
      if (runPr(`noop|${k}`, rates(`rates|${k}`), new Array(M).fill(0)).regressed.some(Boolean)) alarms++;
    }
    console.log(`no-op pull requests with a false alarm: ${alarms}/${PRS}`);
    expect(alarms / PRS).toBeLessThanOrEqual(0.05);
  });

  it('a suite with three real regressions keeps the false discovery proportion under fdr on average', () => {
    const drops = [0.3, 0.3, 0.3, 0, 0, 0, 0, 0, 0, 0];
    let fdp = 0;
    let caught = 0;
    for (let k = 0; k < PRS; k++) {
      const { regressed } = runPr(`mixed|${k}`, rates(`rates|${k}`), drops);
      const discoveries = regressed.filter(Boolean).length;
      const falseOnes = regressed.filter((x, i) => x && drops[i] === 0).length;
      fdp += discoveries === 0 ? 0 : falseOnes / discoveries;
      caught += regressed.filter((x, i) => x && drops[i]! > 0).length;
    }
    console.log(`mean FDP ${(fdp / PRS).toFixed(4)}, regressions caught ${caught}/${3 * PRS}`);
    expect(fdp / PRS).toBeLessThanOrEqual(0.05);
    expect(caught / (3 * PRS)).toBeGreaterThan(0.5);
  });
});
