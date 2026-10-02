/**
 * universal.test.ts: the always-valid two-sample e-value, and what it costs.
 *
 * `universalTwoSampleLogE` is valid at every rate by construction, so these
 * tests check the construction was built as described, that it holds exactly
 * where the default statistic does not, and how much power it gives up.
 */
import { describe, it, expect } from 'vitest';
import {
  universalTwoSampleLogE, universalCeilingLogE, twoSampleLogE, typeOneError, certifyProbability,
  gate, shouldStop, logGamma, logBeta, ibeta, type Evidence,
} from '../src/index.js';

const logBinom = (n: number, k: number, p: number): number =>
  logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p);

describe('the construction', () => {
  it('never exceeds the default statistic, and stays at or under its ceiling bound', () => {
    for (const [sb, nb] of [[5, 10], [51, 60], [216, 240], [30, 60]] as const) {
      for (const n of [1, 8, 96, 400]) {
        for (let s = 0; s <= n; s += Math.max(1, Math.floor(n / 25))) {
          const u = universalTwoSampleLogE(s, n, sb, nb, 0.15);
          expect(u, `${s}/${n} vs ${sb}/${nb}`).toBeLessThanOrEqual(twoSampleLogE(s, n, sb, nb, 0.15) + 1e-9);
          expect(u, `${s}/${n} vs ${sb}/${nb}`).toBeLessThanOrEqual(universalCeilingLogE(s / n, sb, nb) + 1e-9);
        }
      }
    }
  });

  it('has mean at most 1 at the fixed rate where the default statistic has mean above 2.5', () => {
    const [p, nb, n, mde] = [0.005, 30, 1000, 0.05];
    let universal = 0;
    for (let sb = 0; sb <= nb; sb++) {
      const weight = Math.exp(logBinom(nb, sb, p));
      if (weight < 1e-15) continue;
      for (let s = 0; s <= n; s++) universal += weight * Math.exp(logBinom(n, s, p) + universalTwoSampleLogE(s, n, sb, nb, mde));
    }
    expect(universal).toBeLessThanOrEqual(1);
  });

  it('refuses a baseline with no trials', () => {
    expect(() => universalTwoSampleLogE(1, 2, 0, 0, 0.15)).toThrow(expect.objectContaining({ code: 'PEEKSAFE_E_STAT_DOMAIN' }));
    expect(() => universalCeilingLogE(0.5, 0, 0)).toThrow(expect.objectContaining({ code: 'PEEKSAFE_E_STAT_DOMAIN' }));
  });
});

describe('error control', () => {
  it('stays under alpha in the corners where the default statistic does or did not', () => {
    const cells = [
      { rate: 0.005, baselineTrials: 30, mde: 0.05, alpha: 1 / 4000, horizon: 1000 },
      { rate: 0.005, baselineTrials: 5, mde: 0.15, alpha: 0.005, horizon: 600, altConcentration: 2 },
      { rate: 0.15, baselineTrials: 240, mde: 0.15, alpha: 1 / 4000, horizon: 600, altConcentration: 100 },
    ];
    for (const c of cells) expect(typeOneError({ ...c, evidence: 'universal' }), JSON.stringify(c)).toBeLessThanOrEqual(c.alpha);
    expect(typeOneError(cells[2]!)).toBeGreaterThan(cells[2]!.alpha);
  });

  it('certifyProbability computes the universal statistic it names', () => {
    // A brute-force crossing check on a small case, against universalTwoSampleLogE itself.
    const [pb, pc, nb, mde, alpha, horizon] = [0.9, 0.6, 20, 0.15, 0.05, 60];
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
          if (universalTwoSampleLogE(s, n, sb, nb, mde) >= Math.log(1 / alpha)) {
            crossed += next[s]!;
            next[s] = 0;
          }
        }
        alive = next;
      }
      brute += Math.exp(logBinom(nb, sb, pb)) * crossed;
    }
    const exact = certifyProbability({ baselineRate: pb, candidateRate: pc, baselineTrials: nb, mde, alpha, horizon, evidence: 'universal' });
    expect(exact).toBeCloseTo(brute, 10);
  });
});

describe('what it costs', () => {
  it('certifies less often at every cell of the comparison grid, and about as often with four times the baseline', () => {
    const rows: string[] = [];
    for (const m of [10, 200]) {
      for (const nb of [60, 240, 960]) {
        for (const pb of [0.75, 0.95]) {
          for (const mde of [0.15, 0.25]) {
            const o = { baselineRate: pb, candidateRate: pb - mde, baselineTrials: nb, mde, alpha: 0.05 / m, horizon: 200 };
            const bayes = certifyProbability(o);
            const universal = certifyProbability({ ...o, evidence: 'universal' });
            rows.push(`m=${m} nb=${nb} ${pb}-${mde}: bayes ${bayes.toFixed(3)} universal ${universal.toFixed(3)}`);
            expect(universal).toBeLessThanOrEqual(bayes);
            if (nb <= 240) {
              const moreBaseline = certifyProbability({ ...o, baselineTrials: nb * 4, evidence: 'universal' });
              expect(moreBaseline, `${m} ${nb} ${pb} ${mde}`).toBeGreaterThan(bayes * 0.85);
            }
          }
        }
      }
    }
    console.log(rows.join('\n'));
  });
});

describe('a provable statistic cannot close the gap by reshaping the alternative', () => {
  // inf over the baseline rate p of [uniform mixture / likelihood at p] times a candidate martingale whose alternative is
  // truncated below p and recentred at p - mde, so it is valid for every candidate rate at or above p. The inf is taken
  // on a grid, which can only overstate the statistic, so the power below is an upper bound on the real construction's.
  function truncatedPowerUpperBound(nb: number, pb: number, pc: number, mde: number, k: number, alpha: number, horizon: number): number {
    const G = 100;
    const grid = Array.from({ length: G }, (_, g) => (g + 0.5) / G);
    const xlogy = (x: number, y: number) => (x === 0 ? 0 : x * Math.log(y));
    const logLik = (s: number, n: number, p: number) => xlogy(s, p) + xlogy(n - s, 1 - p);
    const tables: Float64Array[] = [];
    for (let n = 1; n <= horizon; n++) {
      const row = new Float64Array((n + 1) * G);
      grid.forEach((p, g) => {
        const centre = Math.max(0.005, p - mde);
        const a = Math.max(0.35, k * centre);
        const b = Math.max(0.35, k * (1 - centre));
        const norm = logBeta(a, b) + Math.log(ibeta(a, b, p));
        for (let s = 0; s <= n; s++) row[s * G + g] = logBeta(a + s, b + n - s) + Math.log(ibeta(a + s, b + n - s, p)) - norm - logLik(s, n, p);
      });
      tables[n] = row;
    }
    const bar = Math.log(1 / alpha);
    let total = 0;
    for (let sb = 0; sb <= nb; sb++) {
      const weight = Math.exp(logBinom(nb, sb, pb));
      if (weight < 1e-12) continue;
      const A = grid.map((p) => logBeta(1 + sb, 1 + nb - sb) - logLik(sb, nb, p));
      let alive = new Float64Array(horizon + 1);
      alive[0] = 1;
      let crossed = 0;
      for (let n = 1; n <= horizon; n++) {
        const next = new Float64Array(horizon + 1);
        for (let s = 0; s < n; s++) {
          next[s + 1]! += alive[s]! * pc;
          next[s]! += alive[s]! * (1 - pc);
        }
        const row = tables[n]!;
        for (let s = 0; s <= n; s++) {
          if (next[s]! < 1e-18) continue;
          let e = Infinity;
          for (let g = 0; g < G; g++) e = Math.min(e, A[g]! + row[s * G + g]!);
          if (e >= bar) {
            crossed += next[s]!;
            next[s] = 0;
          }
        }
        alive = next;
      }
      total += weight * crossed;
    }
    return total;
  }

  it('gains a few points over universal, and stays far under the default', () => {
    for (const nb of [60, 240]) {
      const o = { baselineRate: 0.75, candidateRate: 0.6, baselineTrials: nb, mde: 0.15, alpha: 0.005, horizon: 200 };
      const bayes = certifyProbability(o);
      const universal = certifyProbability({ ...o, evidence: 'universal' });
      const reshaped = truncatedPowerUpperBound(nb, 0.75, 0.6, 0.15, 32, 0.005, 200);
      console.log(`nb=${nb}: bayes ${bayes.toFixed(3)} universal ${universal.toFixed(3)} reshaped at most ${reshaped.toFixed(3)}`);
      expect(reshaped - universal, `nb=${nb}`).toBeLessThan(0.06);
      expect(reshaped, `nb=${nb}`).toBeLessThan(bayes - 0.07);
    }
  });
});

describe('gate and shouldStop take it as an option', () => {
  const quickStart = [
    { id: 'parsing/nested', successes: 88, trials: 96, baseline: { caseId: 'parsing/nested', successes: 51, trials: 60 } },
    { id: 'routing/fallback', successes: 20, trials: 96, baseline: { caseId: 'routing/fallback', successes: 57, trials: 60 } },
  ];

  it('reaches the same verdict on the quick start, with less evidence', () => {
    const bayes = gate(quickStart);
    const universal = gate(quickStart, { evidence: 'universal' });
    expect(universal.options.evidence).toBe('universal');
    expect(universal.regressed.map((c) => c.id)).toEqual(bayes.regressed.map((c) => c.id));
    expect(universal.cases[1]!.evalue).toBeLessThan(bayes.cases[1]!.evalue);
  });

  it('stops a collapsed case as regressed and settles a healthy one', () => {
    const baseline = { caseId: 'c', successes: 216, trials: 240 };
    const opts = { suiteSize: 3, evidence: 'universal' as Evidence };
    expect(shouldStop({ successes: 20, trials: 48 }, baseline, opts).reason).toBe('regressed');
    expect(shouldStop({ successes: 216, trials: 240 }, baseline, opts).reason).toBe('settled');
  });

  it('refuses an evidence it does not know', () => {
    const bad = { evidence: 'frequentist' as unknown as Evidence };
    expect(() => gate(quickStart, bad)).toThrow(expect.objectContaining({ code: 'PEEKSAFE_E_CONFIG' }));
    expect(() => shouldStop({ successes: 1, trials: 2 }, quickStart[0]!.baseline, { suiteSize: 2, ...bad }))
      .toThrow(expect.objectContaining({ code: 'PEEKSAFE_E_CONFIG' }));
  });
});
