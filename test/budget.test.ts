/**
 * budget.test.ts: planning, and the honest answers it has to be able to give.
 *
 * Two of these pin refusals rather than results. A planner that always returns a
 * number is worse than one that sometimes says "no budget does this", because
 * the number gets put in a spreadsheet and the impossibility does not.
 */
import { describe, it, expect } from 'vitest';
import {
  makePlan, planCase, DEFAULT_PLAN, affordabilityGrid,
  computeFrontier, DEFAULT_FRONTIER, typicalObservationsPerCase,
  toBaselineMap, sampleSizeTwoProportion,
  evidenceCeilingLogE, ebhSoloThreshold,
  type CaseRef, type BaselineStat,
} from '../src/index.js';

const suite = (m: number, rate: number, nb: number): { cases: CaseRef[]; baseline: Map<string, BaselineStat> } => {
  const cases: CaseRef[] = Array.from({ length: m }, (_, i) => ({ id: `c${i}`, suite: `file${i % 8}` }));
  const baseline = toBaselineMap(
    cases.map((c) => ({ caseId: c.id, successes: Math.round(rate * nb), trials: nb }))
  );
  return { cases, baseline };
};

describe('the planner answers before anything is spent', () => {
  it('prices a suite and totals it', () => {
    const { cases, baseline } = suite(50, 0.85, 240);
    const plan = makePlan(cases, baseline, DEFAULT_PLAN);
    expect(plan.cases).toHaveLength(50);
    expect(plan.totals.unpairedRuns).toBeGreaterThan(0);
    expect(plan.totals.pairedRuns).toBeGreaterThan(0);
    expect(plan.totals.cases).toBe(50);
  });

  it('says IMPOSSIBLE for an effect larger than the rate, rather than quoting a budget', () => {
    // A case that passes 10% of the time cannot lose 15 points. The prototype
    // clamped the alternative rate away from zero and answered "44 runs".
    expect(sampleSizeTwoProportion(0.1, 0.15)).toBe(Infinity);
    const { cases, baseline } = suite(4, 0.1, 240);
    const plan = makePlan(cases, baseline, { ...DEFAULT_PLAN, mde: 0.15 });
    expect(plan.cases.every((c) => c.detectability === 'IMPOSSIBLE')).toBe(true);
  });

  it('distinguishes "expensive" from "no candidate budget will do"', () => {
    // A short baseline caps the unpaired evidence below the bar, so the answer
    // is more baseline runs, not more candidate runs.
    const short = planCase({ id: 'a', suite: 's' }, { caseId: 'a', successes: 20, trials: 24 }, DEFAULT_PLAN, 200);
    const long = planCase({ id: 'a', suite: 's' }, { caseId: 'a', successes: 816, trials: 960 }, DEFAULT_PLAN, 200);
    expect(short.ceilingLogE).toBeLessThan(long.ceilingLogE);
    expect(short.baselineRunsNeeded === null || short.baselineRunsNeeded > 24).toBe(true);
  });

  it('refuses a zero MDE or a zero FDR rather than planning a suite nothing can decide', () => {
    const { cases, baseline } = suite(4, 0.85, 240);
    expect(() => makePlan(cases, baseline, { ...DEFAULT_PLAN, mde: 0 })).toThrow(/mde/);
    expect(() => makePlan(cases, baseline, { ...DEFAULT_PLAN, fdr: 0 })).toThrow(/fdr/);
  });

  it('refuses an empty suite', () => {
    expect(() => makePlan([], new Map(), DEFAULT_PLAN)).toThrow();
  });

  it('grids affordability over suite size and effect', () => {
    const grid = affordabilityGrid(0.85, 240, DEFAULT_PLAN, 500);
    expect(grid.length).toBeGreaterThan(0);
    for (const cell of grid) expect(Number.isFinite(cell.mde)).toBe(true);
  });
});

describe('the frontier', () => {
  it('computes a set of points and marks which are affordable', () => {
    const res = computeFrontier(DEFAULT_FRONTIER);
    expect(res.points.length).toBeGreaterThan(0);
    // Every recommendable point must also be feasible; the reverse need not hold.
    for (const p of res.points) if (p.recommendable) expect(p.feasible).toBe(true);
  });

  it('reports observations per case as a positive number', () => {
    expect(typicalObservationsPerCase(0.85, 0.15, DEFAULT_FRONTIER, 240)).toBeGreaterThan(0);
  });
});

describe('baselineRunsNeeded is the smallest baseline that clears the bar', () => {
  // The evidence ceiling is not monotone in the baseline size, because forcing
  // an integer success count makes the implied rate jitter around the real one.
  // So the answer has to be scanned for. A bisection returns whichever crossing
  // the doubling search happened to bracket, which is not a defined quantity.
  const firstClearing = (rate: number, mde: number, m: number, cap = 100_000): number | null => {
    const bar = Math.log(ebhSoloThreshold(m, 0.05));
    const alt = Math.max(1e-6, Math.min(1 - 1e-6, rate - mde));
    for (let n = 1; n <= cap; n++) {
      if (evidenceCeilingLogE(alt, Math.round(rate * n), n, mde) >= bar) return n;
    }
    return null;
  };

  const needed = (successes: number, trials: number, mde: number, m: number): number | null =>
    planCase({ id: 'a' }, { caseId: 'a', successes, trials }, { ...DEFAULT_PLAN, mde }, m).baselineRunsNeeded;

  it('answers a baseline under 5 runs when that is enough', () => {
    // The doubling search started at 8 and then bisected (4, 8], so no case
    // could ever be told it needed fewer than 5 baseline runs. This one needs 3.
    expect(firstClearing(0.5, 0.4, 1)).toBe(3);
    expect(needed(1, 2, 0.4, 1)).toBe(3);
  });

  it('agrees with a scan over a grid of baselines and effects', () => {
    for (const m of [1, 4, 20, 200]) {
      for (const rate of [0.3, 0.5, 0.8, 0.85, 0.9, 0.95, 0.99]) {
        for (const mde of [0.05, 0.1, 0.15, 0.2]) {
          if (rate <= mde) continue;
          const trials = 60;
          const successes = Math.round(rate * trials);
          const observed = needed(successes, trials, mde, m);
          if (observed === null) continue;
          const scanned = firstClearing(successes / trials, mde, m, 5000);
          expect(observed, `m=${m} rate=${rate} mde=${mde}`).toBe(scanned);
        }
      }
    }
  });

  it('never answers past the 100k baseline the search is allowed to reach', () => {
    // Doubling ran `while (hi <= cap)` and so stepped to 131072 with a cap of
    // 100000, then bisected inside a bracket that started above the cap. This
    // case was answered 126037: a baseline size the search never established.
    const answer = needed(95, 100, 0.0025, 1);
    expect(answer === null || answer <= 100_000).toBe(true);
  });
});
