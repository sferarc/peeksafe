/**
 * budget.test.ts: planning, and the honest answers it has to be able to give.
 *
 * Two of these pin refusals rather than results. A planner that always returns a
 * number is worse than one that sometimes says "no budget does this", because
 * the number gets put in a spreadsheet and the impossibility does not.
 */
import { describe, expect, it } from "vitest";
import {
  affordabilityGrid,
  type BaselineStat,
  type CaseRef,
  computeFrontier,
  DEFAULT_AXES,
  DEFAULT_FRONTIER,
  DEFAULT_PLAN,
  ebhSoloThreshold,
  evaluatePoint,
  evidenceCeilingLogE,
  expectedSequentialSamples,
  type FrontierConfig,
  makePlan,
  pairPhi,
  planCase,
  sampleSizeTwoProportion,
  toBaselineMap,
  typicalObservationsPerCase,
} from "../src/index.js";

const suite = (
  m: number,
  rate: number,
  nb: number,
): { cases: CaseRef[]; baseline: Map<string, BaselineStat> } => {
  const cases: CaseRef[] = Array.from({ length: m }, (_, i) => ({
    id: `c${i}`,
    suite: `file${i % 8}`,
  }));
  const baseline = toBaselineMap(
    cases.map((c) => ({ caseId: c.id, successes: Math.round(rate * nb), trials: nb })),
  );
  return { cases, baseline };
};

describe("the planner answers before anything is spent", () => {
  it("prices a suite and totals it", () => {
    const { cases, baseline } = suite(50, 0.85, 240);
    const plan = makePlan(cases, baseline, DEFAULT_PLAN);
    expect(plan.cases).toHaveLength(50);
    expect(plan.totals.unpairedRuns).toBeGreaterThan(0);
    expect(plan.totals.pairedRuns).toBeGreaterThan(0);
    expect(plan.totals.cases).toBe(50);
  });

  it("says IMPOSSIBLE for an effect larger than the rate, rather than quoting a budget", () => {
    // A case that passes 10% of the time cannot lose 15 points. The prototype
    // clamped the alternative rate away from zero and answered "44 runs".
    expect(sampleSizeTwoProportion(0.1, 0.15)).toBe(Infinity);
    const { cases, baseline } = suite(4, 0.1, 240);
    const plan = makePlan(cases, baseline, { ...DEFAULT_PLAN, mde: 0.15 });
    expect(plan.cases.every((c) => c.detectability === "IMPOSSIBLE")).toBe(true);
  });

  it('distinguishes "expensive" from "no candidate budget will do"', () => {
    // A short baseline caps the unpaired evidence below the bar, so the answer
    // is more baseline runs, not more candidate runs.
    const short = planCase(
      { id: "a", suite: "s" },
      { caseId: "a", successes: 20, trials: 24 },
      DEFAULT_PLAN,
      200,
    );
    const long = planCase(
      { id: "a", suite: "s" },
      { caseId: "a", successes: 816, trials: 960 },
      DEFAULT_PLAN,
      200,
    );
    expect(short.ceilingLogE).toBeLessThan(long.ceilingLogE);
    expect(short.baselineRunsNeeded === null || short.baselineRunsNeeded > 24).toBe(true);
  });

  it("refuses a zero MDE or a zero FDR rather than planning a suite nothing can decide", () => {
    const { cases, baseline } = suite(4, 0.85, 240);
    expect(() => makePlan(cases, baseline, { ...DEFAULT_PLAN, mde: 0 })).toThrow(/mde/);
    expect(() => makePlan(cases, baseline, { ...DEFAULT_PLAN, fdr: 0 })).toThrow(/fdr/);
  });

  it("refuses an empty suite", () => {
    expect(() => makePlan([], new Map(), DEFAULT_PLAN)).toThrow();
  });

  it("refuses a repeated case id, as gate does, rather than pricing the case twice", () => {
    const { cases, baseline } = suite(1, 0.85, 60);
    const twice = [cases[0]!, { ...cases[0]! }];
    for (const call of [
      () => makePlan(twice, baseline, DEFAULT_PLAN),
      () => expectedSequentialSamples(twice, baseline, DEFAULT_PLAN),
    ]) {
      expect(call).toThrow(expect.objectContaining({ code: "PEEKSAFE_E_CASE_DUPLICATE" }));
      expect(call).toThrow(/duplicate case id c0/);
    }
    // Listed once, the case keeps the figure the duplicate used to add twice to `samples`.
    const once = expectedSequentialSamples(cases, baseline, DEFAULT_PLAN);
    expect(once.samples).toBe(once.perCase.get("c0"));
    expect(makePlan(cases, baseline, DEFAULT_PLAN).cases).toHaveLength(1);
  });

  it("refuses an out-of-range alpha or beta rather than quoting every case at the cap", () => {
    // `sprtExpectedN` answers NaN or Infinity for an error rate outside (0,1),
    // and both of its callers here gate on `Number.isFinite(raw) && raw > 0`
    // and quote `maxTrials` when that fails. Both answers fail it, so the plan
    // came back with no error at all and every case priced at the per-case cap:
    // a budget a reader has no way to tell apart from a case that genuinely
    // needs the cap.
    const { cases, baseline } = suite(4, 0.85, 240);
    for (const bad of [0, 1, -1, 2, NaN, Infinity]) {
      expect(
        () => makePlan(cases, baseline, { ...DEFAULT_PLAN, alpha: bad }),
        `alpha=${bad}`,
      ).toThrow(/alpha/);
      expect(
        () => makePlan(cases, baseline, { ...DEFAULT_PLAN, beta: bad }),
        `beta=${bad}`,
      ).toThrow(/beta/);
    }
    // The fallback is a materially different answer and not a rounding one:
    // at the defaults these cases price well under the cap.
    const plan = makePlan(cases, baseline, DEFAULT_PLAN);
    expect(plan.totals.typicalRuns).toBeLessThan(cases.length * DEFAULT_PLAN.maxTrials);
  });

  it("refuses error rates that sum to 1 or more, through every planner door", () => {
    // Wald's walls meet or cross there, so the test decides before it sees a run.
    // At 0.6 and 0.5 `sprtExpectedN` answered 0.33 and the plan priced every case
    // at minTrials, with nothing to say the design had no error control left.
    const { cases, baseline } = suite(4, 0.85, 240);
    const config = expect.objectContaining({ code: "PEEKSAFE_E_CONFIG" });
    for (const [alpha, beta] of [
      [0.6, 0.5],
      [0.5, 0.5],
      [0.9, 0.9],
    ] as const) {
      const cfg = { ...DEFAULT_PLAN, alpha, beta };
      expect(() => makePlan(cases, baseline, cfg), `${alpha}+${beta}`).toThrow(config);
      expect(() => affordabilityGrid(0.85, 240, cfg, 10), `${alpha}+${beta}`).toThrow(config);
      expect(
        () => computeFrontier({ ...DEFAULT_FRONTIER, alpha, beta }),
        `${alpha}+${beta}`,
      ).toThrow(config);
    }
    expect(
      makePlan(cases, baseline, { ...DEFAULT_PLAN, alpha: 0.45, beta: 0.5 }).cases,
    ).toHaveLength(4);
  });

  it("refuses a run ceiling below one run rather than calling every case undecidable", () => {
    // The planners search up to eight times the ceiling. At NaN or 0 that search
    // never ran, so both designs answered Infinity and every case came back
    // with no design, under a reason that named the evidence bar.
    const { cases, baseline } = suite(4, 0.85, 240);
    const config = expect.objectContaining({ code: "PEEKSAFE_E_CONFIG" });
    for (const bad of [0, 0.5, -2000, NaN, Infinity]) {
      expect(
        () => makePlan(cases, baseline, { ...DEFAULT_PLAN, runsPerCaseCeiling: bad }),
        `makePlan ceiling=${bad}`,
      ).toThrow(config);
      expect(
        () => computeFrontier({ ...DEFAULT_FRONTIER, runsPerCaseCeiling: bad }),
        `computeFrontier ceiling=${bad}`,
      ).toThrow(/runsPerCaseCeiling/);
    }
    const plan = makePlan(cases, baseline, DEFAULT_PLAN);
    expect(plan.cases.every((c) => c.design !== null)).toBe(true);
  });

  it("refuses a trial grid the gate cannot sample on, through every planner door", () => {
    // Unchecked, a NaN bound or a zero batch made the typical bill NaN, and a
    // maxTrials of 1 under the default minTrials of 8 priced these four cases
    // at 4 runs where the defaults price 144 unpaired.
    const { cases, baseline } = suite(4, 0.85, 240);
    const config = expect.objectContaining({ code: "PEEKSAFE_E_CONFIG" });
    const bad: Array<Partial<typeof DEFAULT_PLAN>> = [
      { minTrials: NaN },
      { minTrials: 0 },
      { minTrials: 2.5 },
      { maxTrials: NaN },
      { maxTrials: Infinity },
      { maxTrials: 1 },
      { minTrials: 200 },
      { batchSize: 0 },
      { batchSize: -4 },
      { batchSize: 2.5 },
    ];
    for (const grid of bad) {
      const label = JSON.stringify(grid);
      const plan = { ...DEFAULT_PLAN, ...grid };
      const frontier = { ...DEFAULT_FRONTIER, ...grid };
      expect(() => makePlan(cases, baseline, plan), `makePlan ${label}`).toThrow(config);
      expect(() => expectedSequentialSamples(cases, baseline, plan), label).toThrow(config);
      expect(() => affordabilityGrid(0.85, 240, plan, 10), `grid ${label}`).toThrow(config);
      expect(() => computeFrontier(frontier), `computeFrontier ${label}`).toThrow(config);
      expect(() => typicalObservationsPerCase(0.85, 0.15, frontier, 240), label).toThrow(config);
    }
    const unpaired = { ...DEFAULT_PLAN, design: "unpaired" as const };
    expect(makePlan(cases, baseline, unpaired).totals.typicalRuns).toBe(144);
    expect(makePlan(cases, baseline, { ...DEFAULT_PLAN, minTrials: 96 }).cases).toHaveLength(4);
  });

  it("prices the fixed-N comparator at the plan's own error rates", () => {
    const at = (alpha: number, beta: number) =>
      planCase(
        { id: "a" },
        { caseId: "a", successes: 204, trials: 240 },
        { ...DEFAULT_PLAN, alpha, beta },
        4,
      ).fixedNPerArm;
    expect(at(DEFAULT_PLAN.alpha, DEFAULT_PLAN.beta)).toBe(sampleSizeTwoProportion(0.85, 0.15));
    expect(at(0.01, 0.2)).toBe(sampleSizeTwoProportion(0.85, 0.15, 0.01, 0.2));
    expect(at(0.01, 0.2)).not.toBe(at(DEFAULT_PLAN.alpha, DEFAULT_PLAN.beta));
  });

  it("prices a paired screening run at two runs, the same as any other paired observation", () => {
    // `screenRuns` is a count of observations, and under the paired design an
    // observation is two runs. The expected total already reads it that way, so
    // a screened total that reads it as one run prices a screening pass nobody
    // is going to run, and the two totals in the same object disagree.
    const { cases, baseline } = suite(200, 2 / 12, 12);
    const plan = makePlan(cases, baseline, DEFAULT_PLAN);
    expect(plan.recommendedDesign).toBe("paired");
    const followUp =
      Math.ceil(plan.totals.decidableBest * plan.totals.screenContinueFraction) *
      (plan.totals.bestRuns / plan.totals.decidableBest);
    expect(plan.totals.screenedRuns - followUp).toBeCloseTo(200 * DEFAULT_PLAN.screenRuns * 2, -1);
  });

  it("prices a paired screening run at two runs in the affordability grid too", () => {
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
    const at = (screenRuns: number) =>
      affordabilityGrid(0.85, 240, { ...DEFAULT_PLAN, screenRuns }, 500);
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

  it("never quotes a worst case below the expected cost it states in the same breath", () => {
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
            `m=${m} nb=${nb} rate=${r}: ${plan.verdict}`,
          ).toBeGreaterThanOrEqual(Number(plan.expectedCostUsd.toFixed(2)));
        }
      }
    }
    // Deleting the sentence would satisfy the loop above without fixing
    // anything, so the grid has to still be quoting a worst case somewhere.
    expect(quoted).toBeGreaterThan(0);
  });

  it("grids affordability over suite size and effect", () => {
    const grid = affordabilityGrid(0.85, 240, DEFAULT_PLAN, 500);
    expect(grid.length).toBeGreaterThan(0);
    for (const cell of grid) expect(Number.isFinite(cell.mde)).toBe(true);
  });

  it("refuses to grid a suite with no baseline rather than pricing it against Beta(1, 1)", () => {
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
    expect(() => affordabilityGrid(0.85, 0, DEFAULT_PLAN, 5, [20], [0.15])).toThrow(
      /baselineTrials/,
    );
    // A negative or fractional count did reach a refusal, but three frames down
    // in `requireCounts`, which reported a success count the caller never
    // passed: "need 0 ≤ successes ≤ trials, got -8/-10".
    expect(() => affordabilityGrid(0.85, -10, DEFAULT_PLAN, 5, [20], [0.15])).toThrow(
      /baselineTrials/,
    );
    expect(() => affordabilityGrid(0.85, 60.5, DEFAULT_PLAN, 5, [20], [0.15])).toThrow(
      /baselineTrials/,
    );
    // A recorded baseline still prices, so the guard refuses the missing
    // baseline and not the grid.
    expect(affordabilityGrid(0.85, 60, DEFAULT_PLAN, 5, [20], [0.15])).toHaveLength(1);
  });

  it("refuses an out-of-range nullQuantile, the same as makePlan", () => {
    const { cases, baseline } = suite(20, 0.85, 60);
    for (const bad of [0, 1, -0.5, 1.5, NaN]) {
      const cfg = { ...DEFAULT_PLAN, nullQuantile: bad };
      expect(() => makePlan(cases, baseline, cfg), `makePlan q=${bad}`).toThrow(/nullQuantile/);
      expect(
        () => affordabilityGrid(0.85, 60, cfg, 5, [20], [0.15]),
        `affordabilityGrid q=${bad}`,
      ).toThrow(/nullQuantile/);
    }
  });

  it("refuses the fdr and run price makePlan refuses, and a fractional case count", () => {
    // `affordabilityGrid` checked none of these. An fdr of 2 is a solo bar of m / 2,
    // so 50 cases at 90% over 60 baseline runs priced at 840 runs where 0.05
    // prices 1310, `affordable: true`, with nothing to say the error rate was
    // not one. A negative run price made every cell affordable, and a case
    // count of 2.5 priced a fractional suite.
    const grid = (cfg: typeof DEFAULT_PLAN, cases = [50]) =>
      affordabilityGrid(0.9, 60, cfg, 50, cases, [0.15]);
    expect(grid(DEFAULT_PLAN)[0]!.runs).toBe(1310);
    for (const fdr of [0, 1, 2, -0.1, NaN]) {
      const cfg = { ...DEFAULT_PLAN, fdr };
      expect(() => grid(cfg), `affordabilityGrid fdr=${fdr}`).toThrow(/fdr/);
      const { cases, baseline } = suite(20, 0.85, 60);
      expect(() => makePlan(cases, baseline, cfg), `makePlan fdr=${fdr}`).toThrow(/fdr/);
    }
    for (const costPerRunUsd of [-1, NaN]) {
      expect(() => grid({ ...DEFAULT_PLAN, costPerRunUsd }), `cost=${costPerRunUsd}`).toThrow(
        /costPerRunUsd/,
      );
    }
    for (const m of [0, -5, 2.5, NaN, Infinity]) {
      expect(() => grid(DEFAULT_PLAN, [20, m]), `cases=${m}`).toThrow(/case count/);
    }
  });
});

describe("the design per case, from a measured coupling", () => {
  const bl: BaselineStat[] = [
    { caseId: "flow", successes: 180, trials: 240 },
    { caseId: "nested", successes: 216, trials: 240 },
    { caseId: "thin", successes: 54, trials: 60 },
    { caseId: "low", successes: 6, trials: 60 },
  ];
  const cases = bl.map((b) => ({ id: b.caseId }));
  const byId = (plan: ReturnType<typeof makePlan>) =>
    Object.fromEntries(plan.cases.map((c) => [c.caseId, c]));

  it("picks the design that decides a case in fewer runs, and none for a case neither decides", () => {
    const plan = byId(makePlan(cases, toBaselineMap(bl), DEFAULT_PLAN));
    for (const c of Object.values(plan)) {
      if (c.detectability === "UNPAIRED")
        expect(c.design).toBe(c.paired.runs < c.unpaired.runs ? "paired" : "unpaired");
    }
    expect(plan.flow!.design).toBe("paired");
    expect(plan.nested!.design).toBe("unpaired");
    expect(plan.thin!.detectability).toBe("PAIRED_ONLY");
    expect(plan.thin!.design).toBe("paired");
    expect(plan.low!.design).toBeNull();
  });

  it("prices a case with a pilot at the pilot's pairPhi and leaves the others at the configured coupling", () => {
    const pilot = { bothPass: 27, worse: 3, better: 3, bothFail: 7 };
    const plan = byId(makePlan(cases, toBaselineMap(bl), DEFAULT_PLAN, new Map([["flow", pilot]])));
    expect(plan.flow!.pairCoupling).toBeCloseTo(pairPhi(pilot), 12);
    expect(plan.nested!.pairCoupling).toBe(DEFAULT_PLAN.pairCoupling);
    expect(plan.flow!.design).toBe("unpaired");
  });

  it("keeps a paired-only case paired under an independent pilot, and only its price moves", () => {
    const independent = { bothPass: 20, worse: 5, better: 5, bothFail: 0 };
    const assumed = byId(makePlan(cases, toBaselineMap(bl), DEFAULT_PLAN)).thin!;
    const measured = byId(
      makePlan(cases, toBaselineMap(bl), DEFAULT_PLAN, new Map([["thin", independent]])),
    ).thin!;
    expect(measured.pairCoupling).toBe(0);
    expect(measured.design).toBe("paired");
    expect(measured.paired.runs).toBeGreaterThan(assumed.paired.runs);
  });

  it("prices the expected bill and the screening pass per case, at each case's own design", () => {
    // One suite-wide design priced every case of a mixed suite alike: this one
    // recommends unpaired, so `flow` and `thin` were billed at one run an
    // observation although each runs paired, 108 runs where they cost 176.
    const at = (cfg: typeof DEFAULT_PLAN) => makePlan(cases, toBaselineMap(bl), cfg);
    const plan = at(DEFAULT_PLAN);
    const observations = expectedSequentialSamples(cases, toBaselineMap(bl), DEFAULT_PLAN).perCase;
    expect(plan.recommendedDesign).toBe("unpaired");
    expect(plan.cases.map((c) => [c.caseId, c.design, observations.get(c.caseId)])).toEqual([
      ["flow", "paired", 40],
      ["nested", "unpaired", 28],
      ["thin", "paired", 28],
      ["low", null, 12],
    ]);
    // `low` has no design and takes the suite's, unpaired here.
    expect(plan.totals.typicalRuns).toBe(40 * 2 + 28 + 28 * 2 + 12);
    expect(plan.totals.typicalRuns).toBe(176);
    expect(plan.totals.runsPerObservation).toBeCloseTo(176 / 108, 12);
    // Fixing the design still prices every case at it.
    expect(at({ ...DEFAULT_PLAN, design: "unpaired" }).totals.typicalRuns).toBe(108);
    expect(at({ ...DEFAULT_PLAN, design: "paired" }).totals.typicalRuns).toBe(216);
    // One more screening observation per case costs each case its own design's runs, in both screened totals.
    const dearer = at({ ...DEFAULT_PLAN, screenRuns: DEFAULT_PLAN.screenRuns + 1 });
    expect(dearer.totals.screenedRuns - plan.totals.screenedRuns).toBe(2 + 1 + 2 + 1);
    expect(dearer.totals.typicalScreenedRuns - plan.totals.typicalScreenedRuns).toBe(2 + 1 + 2 + 1);
  });

  it("prices a case with no design at the suite's design, and an unpaired case at one run", () => {
    // Two of five cases are PAIRED_ONLY, so the suite recommends pairing and
    // the bill used to price `nested` paired too: 264 runs where it costs 236.
    const five = [...bl, { caseId: "rerank", successes: 57, trials: 60 }];
    const plan = makePlan(
      five.map((b) => ({ id: b.caseId })),
      toBaselineMap(five),
      DEFAULT_PLAN,
    );
    expect(plan.recommendedDesign).toBe("paired");
    expect(plan.cases.map((c) => c.design)).toEqual([
      "paired",
      "unpaired",
      "paired",
      null,
      "paired",
    ]);
    expect(plan.totals.typicalRuns).toBe(40 * 2 + 28 + 28 * 2 + 12 * 2 + 24 * 2);
    expect(plan.totals.typicalRuns).toBe(236);
    expect(plan.recommendation).toMatch(/each case at its own design/);
  });

  it("floors a negative pilot phi at 0, ignores an empty pilot, and refuses a malformed one", () => {
    const negative = { bothPass: 2, worse: 10, better: 10, bothFail: 2 };
    expect(pairPhi(negative)).toBeLessThan(0);
    const floored = makePlan(cases, toBaselineMap(bl), DEFAULT_PLAN, new Map([["flow", negative]]));
    expect(floored.cases[0]!.pairCoupling).toBe(0);
    const empty = { bothPass: 0, worse: 0, better: 0, bothFail: 0 };
    const ignored = makePlan(cases, toBaselineMap(bl), DEFAULT_PLAN, new Map([["flow", empty]]));
    expect(ignored.cases[0]!.pairCoupling).toBe(DEFAULT_PLAN.pairCoupling);
    const zeroSum = { bothPass: -1, worse: 1, better: 0, bothFail: 0 };
    expect(() =>
      makePlan(cases, toBaselineMap(bl), DEFAULT_PLAN, new Map([["flow", zeroSum]])),
    ).toThrow(expect.objectContaining({ code: "PEEKSAFE_E_STAT_DOMAIN" }));
    const bad = { bothPass: -1, worse: 3, better: 3, bothFail: 7 };
    expect(() =>
      makePlan(cases, toBaselineMap(bl), DEFAULT_PLAN, new Map([["flow", bad]])),
    ).toThrow(expect.objectContaining({ code: "PEEKSAFE_E_STAT_DOMAIN" }));
  });
});

describe("the frontier", () => {
  it("computes a set of points and marks which are affordable", () => {
    const res = computeFrontier(DEFAULT_FRONTIER);
    expect(res.points.length).toBeGreaterThan(0);
    // Every recommendable point must also be feasible; the reverse need not hold.
    for (const p of res.points) if (p.recommendable) expect(p.feasible).toBe(true);
  });

  it("reports observations per case as a positive number", () => {
    expect(typicalObservationsPerCase(0.85, 0.15, DEFAULT_FRONTIER, 240)).toBeGreaterThan(0);
  });

  it("refuses an out-of-range alpha or beta, the same as makePlan", () => {
    // `evaluatePoint` checks mde, baselineRate, pairCoupling, cases,
    // baselineRuns and maxTrials, and skipped the two error rates it hands to
    // `sprtExpectedN`. The same options object was therefore a refusal through
    // one planner door and a priced frontier through the other.
    for (const bad of [0, 1, -1, 2, NaN, Infinity]) {
      expect(() => computeFrontier({ ...DEFAULT_FRONTIER, alpha: bad }), `alpha=${bad}`).toThrow(
        /alpha/,
      );
      expect(() => computeFrontier({ ...DEFAULT_FRONTIER, beta: bad }), `beta=${bad}`).toThrow(
        /beta/,
      );
    }
  });

  it("refuses an out-of-range nullQuantile, the same as makePlan", () => {
    for (const bad of [0, 1, -0.5, 1.5, NaN]) {
      const cfg = { ...DEFAULT_FRONTIER, nullQuantile: bad };
      expect(() => computeFrontier(cfg), `computeFrontier q=${bad}`).toThrow(/nullQuantile/);
      expect(
        () => typicalObservationsPerCase(0.85, 0.15, cfg, 240),
        `typicalObservationsPerCase q=${bad}`,
      ).toThrow(/nullQuantile/);
    }
  });

  it("refuses a paired baseline that is not a whole number of runs", () => {
    // Unchecked, 0 paired baseline runs priced the typical bill at 2400 where 20 price 6420.
    const at = (pairedBaselineRuns: number) =>
      evaluatePoint(100, 0.15, 240, "paired", "none", 0, {
        ...DEFAULT_FRONTIER,
        pairedBaselineRuns,
      });
    expect(at(DEFAULT_FRONTIER.pairedBaselineRuns).typical.totalUsd).toBe(6420);
    for (const bad of [0, -10, 2.5, NaN, Infinity]) {
      expect(() => at(bad), `evaluatePoint ${bad}`).toThrow(/pairedBaselineRuns/);
      expect(
        () => computeFrontier({ ...DEFAULT_FRONTIER, pairedBaselineRuns: bad }),
        `computeFrontier ${bad}`,
      ).toThrow(/pairedBaselineRuns/);
    }
  });

  it("refuses the budget, prices, keep fraction and amortisePrs enumerateFrontier refuses", () => {
    // Unchecked here, a run cost of -1 recommended a bill of -6420 and a keep fraction of 2 kept 200 of 100 cases.
    const at = (over: Partial<FrontierConfig>, screen: "none" | "expensive" = "none") =>
      evaluatePoint(100, 0.15, 240, "paired", screen, screen === "none" ? 0 : 4, {
        ...DEFAULT_FRONTIER,
        screenRecall: { expensive: 0.9, proxy: null },
        ...over,
      });
    expect(at({ budgetUsd: 1e9 }).recommendable).toBe(true);
    expect(at({ budgetUsd: Infinity }).recommendable).toBe(true);
    expect(at({ amortisePrs: 1 }).typical.totalUsd).toBe(8400);
    expect(at({}, "expensive").keep).toBe(15);
    const cases: Array<[Partial<FrontierConfig>, RegExp]> = [
      ...[-1, NaN].map((budgetUsd): [Partial<FrontierConfig>, RegExp] => [{ budgetUsd }, /budget/]),
      ...[-1, NaN, Infinity].flatMap(
        (v): Array<[Partial<FrontierConfig>, RegExp]> => [
          [{ costPerRunUsd: v }, /costs/],
          [{ costPerGradeUsd: v }, /costs/],
        ],
      ),
      ...[0, 0.5, 2.5, NaN].map((amortisePrs): [Partial<FrontierConfig>, RegExp] => [
        { amortisePrs },
        /amortisePrs/,
      ]),
    ];
    for (const [over, re] of cases) {
      expect(() => at(over), JSON.stringify(over)).toThrow(re);
      expect(() => computeFrontier({ ...DEFAULT_FRONTIER, ...over }), JSON.stringify(over)).toThrow(
        re,
      );
    }
    for (const screenKeepFraction of [0, 2, -0.5, NaN]) {
      expect(() => at({ screenKeepFraction }, "expensive"), `keep ${screenKeepFraction}`).toThrow(
        expect.objectContaining({
          code: "PEEKSAFE_E_CONFIG",
          message: expect.stringMatching(/screenKeepFraction/),
        }),
      );
    }
  });

  it("refuses a basis inherited from Object.prototype, as costShares does", () => {
    // `BILLS.toString` is inherited, so "toString" passed an undefined check and priced no bill.
    for (const basis of ["toString", "constructor", "hasOwnProperty"]) {
      const cfg = { ...DEFAULT_FRONTIER, basis: basis as never };
      expect(() => evaluatePoint(100, 0.15, 240, "paired", "none", 0, cfg), basis).toThrow(/basis/);
      expect(() => computeFrontier(cfg), basis).toThrow(/basis/);
    }
  });

  it("refuses an unknown design or screen and a screen recall outside [0, 1]", () => {
    // Only a null recall withheld the recommendation, so NaN moved the headline from 35 points ($83) to 25 ($78).
    const measured = (expensive: number | null) =>
      computeFrontier({ ...DEFAULT_FRONTIER, screenRecall: { expensive, proxy: null } }).headline;
    expect(measured(null)).toMatch(/10 cases at 35 points \(\$83\.00, unpaired\)/);
    expect(measured(0.9)).toMatch(/10 cases at 25 points \(\$78\.00, unpaired\)/);
    const at = (
      design: string,
      screen: string,
      screenRecall: FrontierConfig["screenRecall"] = { expensive: 0.9, proxy: null },
    ) =>
      evaluatePoint(100, 0.15, 240, design as never, screen as never, 4, {
        ...DEFAULT_FRONTIER,
        budgetUsd: 1e9,
        screenRecall,
      });
    expect(at("paired", "expensive").recommendable).toBe(true);
    expect(at("paired", "expensive", { expensive: 0, proxy: null }).recommendable).toBe(true);
    expect(at("paired", "expensive", { expensive: null, proxy: null }).recommendable).toBe(false);
    for (const bad of [NaN, -1, 2, Infinity, undefined]) {
      expect(
        () => at("paired", "expensive", { expensive: bad as never, proxy: null }),
        `expensive ${bad}`,
      ).toThrow(/screenRecall\.expensive/);
      expect(
        () => at("paired", "none", { expensive: null, proxy: bad as never }),
        `proxy ${bad}`,
      ).toThrow(/screenRecall\.proxy/);
      expect(
        () =>
          computeFrontier({
            ...DEFAULT_FRONTIER,
            screenRecall: { expensive: bad as never, proxy: null },
          }),
        `computeFrontier ${bad}`,
      ).toThrow(/screenRecall/);
    }
    for (const design of ["bogus", "Paired", "toString"]) {
      expect(() => at(design, "none"), design).toThrow(
        expect.objectContaining({
          code: "PEEKSAFE_E_CONFIG",
          message: expect.stringMatching(/design/),
        }),
      );
      expect(
        () => computeFrontier(DEFAULT_FRONTIER, { ...DEFAULT_AXES, designs: [design as never] }),
        design,
      ).toThrow(/design/);
    }
    for (const screen of ["bogus", "Proxy", "toString"]) {
      expect(() => at("paired", screen), screen).toThrow(
        expect.objectContaining({
          code: "PEEKSAFE_E_CONFIG",
          message: expect.stringMatching(/screen/),
        }),
      );
      expect(
        () => computeFrontier(DEFAULT_FRONTIER, { ...DEFAULT_AXES, screens: [screen as never] }),
        screen,
      ).toThrow(/screen must be/);
    }
  });

  it("refuses a rate, mde or baseline typicalObservationsPerCase cannot price", () => {
    // At 80% over 60 baseline runs an mde of 0 priced 96 runs and -0.1 priced 52.
    const typical = (rate: number, mde: number, runs: number) =>
      typicalObservationsPerCase(rate, mde, DEFAULT_FRONTIER, runs);
    for (const bad of [0, 1, -0.1, 1.5, NaN]) {
      expect(() => typical(bad, 0.15, 240), `rate ${bad}`).toThrow(/rate/);
      expect(() => typical(0.85, bad, 240), `mde ${bad}`).toThrow(/mde/);
    }
    for (const bad of [0, -5, 2.5, NaN, Infinity]) {
      expect(() => typical(0.85, 0.15, bad), `baselineRuns ${bad}`).toThrow(/baselineRuns/);
    }
  });

  it("refuses an fdr outside (0, 1), the same as makePlan", () => {
    // Unchecked, an fdr of 2 put the bar at log(m / 2) and priced a cheaper
    // frontier, and 0 put it at Infinity, which the unpaired points reported as
    // a ceiling below the bar and the paired ones refused under
    // `mcnemarSamplesForEvidence`'s name.
    for (const fdr of [0, 1, 2, -0.1, NaN]) {
      expect(() => computeFrontier({ ...DEFAULT_FRONTIER, fdr }), `fdr=${fdr}`).toThrow(/fdr/);
    }
  });
});

describe("baselineRunsNeeded is the smallest baseline that clears the bar", () => {
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
    planCase({ id: "a" }, { caseId: "a", successes, trials }, { ...DEFAULT_PLAN, mde }, m)
      .baselineRunsNeeded;

  it("answers a baseline under 5 runs when that is enough", () => {
    // The doubling search started at 8 and then bisected (4, 8], so no case
    // could ever be told it needed fewer than 5 baseline runs. This one needs 3.
    expect(firstClearing(0.5, 0.4, 1)).toBe(3);
    expect(needed(1, 2, 0.4, 1)).toBe(3);
  });

  it("agrees with a scan over a grid of baselines and effects", () => {
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

  it("never answers past the 100k baseline the search is allowed to reach", () => {
    // Doubling ran `while (hi <= cap)` and so stepped to 131072 with a cap of
    // 100000, then bisected inside a bracket that started above the cap. This
    // case was answered 126037: a baseline size the search never established.
    const answer = needed(95, 100, 0.0025, 1);
    expect(answer === null || answer <= 100_000).toBe(true);
  });
});
