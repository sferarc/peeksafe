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
