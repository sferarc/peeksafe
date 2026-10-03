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

  it('prices a paired screening run at two runs, the same as any other paired observation', () => {
    // `screenRuns` is a count of observations, and under the paired design an
    // observation is two runs. The expected total already reads it that way, so
    // a screened total that reads it as one run prices a screening pass nobody
    // is going to run, and the two totals in the same object disagree.
    const { cases, baseline } = suite(200, 2 / 12, 12);
    const plan = makePlan(cases, baseline, DEFAULT_PLAN);
    expect(plan.recommendedDesign).toBe('paired');
    const followUp = Math.ceil(plan.totals.decidableBest * plan.totals.screenContinueFraction)
      * (plan.totals.bestRuns / plan.totals.decidableBest);
    expect(plan.totals.screenedRuns - followUp).toBeCloseTo(200 * DEFAULT_PLAN.screenRuns * 2, -1);
  });

  it('prices a paired screening run at two runs in the affordability grid too', () => {
    // `affordabilityGrid` has its own pair of totals, and `runs` priced the
    // screening pass at one run an observation while `typicalRuns`, seventeen
    // lines below it, priced the same pass at two. So the grid understated a
    // paired cell's ceiling by `m * screenRuns` runs, and `affordable` answered
    // "does the ceiling fit the budget?" against a ceiling cheaper than the one
    // the cell reports: at 200 cases and a 10-point MDE it quoted $18.06 for a
    // ceiling that honestly costs $19.74, so a $19 budget read as affordable.
    //
    // Nothing else in a cell depends on `screenRuns`, so running the grid at
    // two adjacent values isolates what each total charges for one screening
    // observation, without this test having to know which design a cell picked.
    const at = (screenRuns: number) => affordabilityGrid(0.85, 240, { ...DEFAULT_PLAN, screenRuns }, 500);
    const cheaper = at(4);
    const dearer = new Map(at(5).map((c) => [`${c.cases}:${c.mde}`, c] as const));
    let pairedCells = 0;
    for (const cell of cheaper) {
      const more = dearer.get(`${cell.cases}:${cell.mde}`);
      if (!more) throw new Error(`no ${cell.cases}-case mde ${cell.mde} cell at screenRuns 5`);
      const where = `${cell.cases} cases at mde ${cell.mde}`;
      const ceilingPrice = more.runs - cell.runs;
      const typicalPrice = more.typicalRuns - cell.typicalRuns;
      expect(ceilingPrice, where).toBe(typicalPrice);
      if (ceilingPrice === cell.cases * 2) pairedCells++;
    }
    // Both totals agree trivially on an unpaired cell, so a grid with no paired
    // cell in it would satisfy the loop above while proving nothing.
    expect(pairedCells).toBeGreaterThan(0);
  });

  it('never quotes a worst case below the expected cost it states in the same breath', () => {
    // A plan that says "about $11.42 per pull request. Worst case ... is $9.16"
    // is wrong on its face, and an operator sets a budget from the smaller
    // number. The all-regressed cost is genuinely not an upper bound: the
    // sequential test stops a regressed case at the bar and runs an unchanged
    // one to its full schedule, so it may come in lower. Saying so is fine;
    // calling it the worst case is not.
    const worstCase = /Worst case, every case regressing at once, is \$(\d+\.\d\d)/;
    let quoted = 0;
    for (const m of [1, 3, 10, 40, 200]) {
      for (const nb of [12, 24, 60, 240, 960]) {
        for (const r of [0.2, 0.4, 0.55, 0.7, 0.85, 0.95]) {
          const { cases, baseline } = suite(m, r, nb);
          const plan = makePlan(cases, baseline, DEFAULT_PLAN);
          const claim = worstCase.exec(plan.verdict);
          if (!claim) continue;
          quoted++;
          expect(
            Number(claim[1]),
            `m=${m} nb=${nb} rate=${r}: ${plan.verdict}`
          ).toBeGreaterThanOrEqual(Number(plan.expectedCostUsd.toFixed(2)));
        }
      }
    }
    // Deleting the sentence would satisfy the loop above without fixing
    // anything, so the grid has to still be quoting a worst case somewhere.
    expect(quoted).toBeGreaterThan(0);
  });

  it('grids affordability over suite size and effect', () => {
    const grid = affordabilityGrid(0.85, 240, DEFAULT_PLAN, 500);
    expect(grid.length).toBeGreaterThan(0);
    for (const cell of grid) expect(Number.isFinite(cell.mde)).toBe(true);
  });

  it('refuses to grid a suite with no baseline rather than pricing it against Beta(1, 1)', () => {
    // `affordabilityGrid` checked `baselineRate` and nothing else, so
    // `baselineTrials: 0` reached `twoSamplePriors` as 0 successes in 0 trials.
    // Its null prior is then Beta(1, 1), and the grid priced the whole suite
    // against "every case passes half the time", which is the invented-baseline
    // failure `src/baseline.ts` exists to refuse and which `planCase`,
    // `evaluatePoint` and `gate` all do refuse.
    //
    // It did not fail loudly either. At 20 cases and a 15-point MDE it answered
    // a complete cell, 504 runs and $1.06 a pull request, `affordable: true`,
    // on a *cheaper* typical bill than the same call at a real 60-run baseline
    // (196 runs against 288): the cheapest row on the page was the one with no
    // baseline behind it at all.
    expect(() => affordabilityGrid(0.85, 0, DEFAULT_PLAN, 5, [20], [0.15])).toThrow(/baselineTrials/);
    // A negative or fractional count did reach a refusal, but three frames down
    // in `requireCounts`, which reported a success count the caller never
    // passed: "need 0 ≤ successes ≤ trials, got -8/-10".
    expect(() => affordabilityGrid(0.85, -10, DEFAULT_PLAN, 5, [20], [0.15])).toThrow(/baselineTrials/);
    expect(() => affordabilityGrid(0.85, 60.5, DEFAULT_PLAN, 5, [20], [0.15])).toThrow(/baselineTrials/);
    // A recorded baseline still prices, so the guard refuses the missing
    // baseline and not the grid.
    expect(affordabilityGrid(0.85, 60, DEFAULT_PLAN, 5, [20], [0.15])).toHaveLength(1);
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
