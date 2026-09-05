/**
 * frontier.ts: what *is* certifiable at coding-agent prices, and how.
 *
 * ## Why this module exists
 *
 * Round 3 published a negative: at $1 a run a 200-case suite at a 15-point MDE
 * is $1,320 a pull request, so peeksafe is not a per-PR gate for a coding-agent
 * benchmark. That is true and it is half an answer. The other half, the one a
 * buyer actually needs, is **which configurations *are* affordable**, and
 * nobody had drawn it.
 *
 * A configuration is a point in five dimensions:
 *
 *     suite size m  ×  MDE δ  ×  design  ×  screening  ×  baseline runs n_b
 *
 * and it is usable only if it is *both* affordable and **certifiable**. Those
 * are different constraints and conflating them is how the round-2 numbers went
 * wrong. Cheap is easy: run fewer cases. Cheap *and able to decide anything* is
 * the hard part, because `evidenceCeilingLogE` says a case whose unpaired
 * ceiling sits under the e-BH bar cannot be certified at any budget, and the
 * bar `m/q` moves with the suite size, so shrinking the suite raises the
 * ceiling's odds *and* lowers the bar at the same time. That interaction is not
 * something you can eyeball.
 *
 * ## The cost model, and the term the plan was missing
 *
 * `plan.ts` prices an observation at one number, `costPerRunUsd`. That is wrong
 * in two ways at coding-agent prices, and both matter:
 *
 *  1. **Grading is not free.** An LLM judge is a model call; a coding-agent
 *     grader is a test suite in a container. So
 *
 *         cost(observation) = costPerRunUsd + costPerGradeUsd
 *
 *     and the second term is the *only* one a cheap proxy grader can reduce
 *     (`proxy.ts`). When `costPerGradeUsd` is 0, which is the default,
 *     matching this package's own free graders, a proxy screen saves exactly
 *     nothing, and this module says so instead of offering it as an economy.
 *
 *  2. **The baseline is not free either, and it is not amortised over
 *     infinity.** The README calls the baseline "amortised, you pay it once on
 *     main". At $0.002 a run that is a rounding error. At $1 a run, a 200-case
 *     suite with a 240-run baseline is 48,000 runs, **$48,000**, and spread
 *     over a hundred pull requests it is still $480 each, which is larger than
 *     everything else in the bill put together. The unpaired design's evidence
 *     ceiling is bought with baseline runs, so *the amortised baseline is the
 *     dominant cost of the unpaired design at coding-agent prices*, and the
 *     paired design's headline advantage is not variance reduction. It is that
 *     it does not need to buy a ceiling.
 *
 * ## What this module will not do
 *
 * It will not recommend a screened configuration whose **recall cost has not
 * been measured**. Screening is the largest cost lever available and it is paid
 * for in missed regressions; `measureScreenRecall` in `proxy.ts` measures that
 * against planted ground truth, and until someone has, the honest price of a
 * screened plan is unknown rather than low. Round 3's lesson, applied to the
 * one number this module would most like to assume.
 */
import {
  evidenceCeilingLogE, samplesForEvidence, mcnemarSamplesForEvidence,
  ebhSoloThreshold, sprtExpectedN, betaQuantile,
} from './stats.js';
import { PeeksafeError, requireProbability, requireOpenProbability } from './errors.js';
import { DEFAULT_PLAN } from './plan.js';

export type FrontierDesign = 'unpaired' | 'paired';

/**
 * What the screening pass grades with.
 *  - `none`      every case goes straight to the sequential test
 *  - `expensive` the screen pays the real grader for its k runs per case
 *  - `proxy`     the screen ranks on a cheap deterministic grader, so its runs
 *                cost `costPerRunUsd` and no grade. Sound, a screen chooses
 *                where to spend and cannot falsely certify, but it ranks on an
 *                effect attenuated by Youden's J (`proxy.ts`), so it costs
 *                power, and the power is what has to be measured.
 */
export type FrontierScreen = 'none' | 'expensive' | 'proxy';

/**
 * Which bill the budget is checked against. Three, because they are three
 * genuinely different questions, and answering one while quoting another is
 * the round-3 error this module exists downstream of.
 *
 *  `'typical'`, a pull request that changed nothing. Almost every pull request
 *  is this one, and `peeksafe calibrate` scored this model to within ~10% of
 *  three real runs. Budget from it and a genuine regression overruns and comes
 *  back INCONCLUSIVE rather than uncertified, which is what `peeksafe run
 *  --budget` already does, and it is a survivable failure.
 *
 *  `'certify-all'`, every case regressed by exactly the MDE and every one had
 *  to be certified. This is the number `peeksafe plan` calls "the ceiling", and
 *  it is **not** an upper bound: at a large MDE against a sharp baseline,
 *  certifying a real regression is *cheaper* than clearing a case that did not
 *  move, so this bill can come in under the typical one. The arithmetic was
 *  never wrong; the word "ceiling" was.
 *
 *  `'ceiling'`, every case the screen kept runs to the per-case cap
 *  (`maxTrials` observations). The gate cannot spend more than that by
 *  construction, so nothing can overrun it. This is the basis to use when the
 *  gate must return a verdict rather than a deferral, and it changes which
 *  *design* wins: paired costs two runs an observation and loses the typical
 *  basis by construction, while on the ceiling basis, and whenever the
 *  baseline cannot be amortised, it wins outright.
 */
export type FrontierBasis = 'typical' | 'certify-all' | 'ceiling';

export interface FrontierAxes {
  cases: number[];
  /** in probability units, e.g. 0.15 for 15 points */
  mdes: number[];
  baselineRuns: number[];
  designs: FrontierDesign[];
  screens: FrontierScreen[];
  /** screening runs per case; only consulted for screens other than `none` */
  screenRuns: number[];
}

export const DEFAULT_AXES: FrontierAxes = {
  cases: [10, 20, 50, 100, 200],
  mdes: [0.10, 0.15, 0.25, 0.35],
  baselineRuns: [30, 60, 120, 240, 480],
  designs: ['unpaired', 'paired'],
  screens: ['none', 'expensive', 'proxy'],
  screenRuns: [4, 8],
};

export interface FrontierConfig {
  /** the budget one pull request may spend */
  budgetUsd: number;
  /** which bill the budget is checked against */
  basis: FrontierBasis;
  /** USD to execute the agent once on one case */
  costPerRunUsd: number;
  /**
   * USD to *grade* one output with the real grader. Zero for this package's own
   * graders; a model call or a container run for anything real. This is the
   * only term a proxy grader can reduce.
   */
  costPerGradeUsd: number;
  /** the pass rate a typical case sits at, used for every power calculation */
  baselineRate: number;
  /** suite-level false discovery rate */
  fdr: number;
  /** measured pair coupling in [0,1] */
  pairCoupling: number;
  /**
   * How many pull requests one recorded baseline is spread over before it is
   * re-recorded. The README's "amortised" claim is exactly this number, and it
   * had never been written down.
   */
  amortisePrs: number;
  /**
   * Baseline runs per case the *paired* design needs. The paired e-value's null
   * is a point mass, so the stored baseline is not part of its validity and
   * does not set a ceiling, it only feeds the SPRT stopping rule and the
   * screen. A short one is enough, and that asymmetry is most of why the paired
   * design wins at these prices.
   */
  pairedBaselineRuns: number;
  /** fraction of cases a screen carries through to the expensive test */
  screenKeepFraction: number;
  /** past this many runs for one case, call it unaffordable regardless of budget */
  runsPerCaseCeiling: number;
  /**
   * Measured recall of the screen, per screen kind. `null` means nobody has
   * measured it, and a configuration using that screen will be reported but
   * never *recommended*.
   */
  screenRecall: { expensive: number | null; proxy: number | null };
  /** free text saying where `screenRecall` came from; printed next to it */
  screenRecallSource: string;
  /** the sequential design being priced, mirrors `DEFAULT_GATE` */
  alpha: number;
  beta: number;
  minTrials: number;
  maxTrials: number;
  batchSize: number;
  nullQuantile: number;
}

export const DEFAULT_FRONTIER: FrontierConfig = {
  budgetUsd: 100,
  basis: 'typical',
  costPerRunUsd: 1,
  costPerGradeUsd: 0,
  baselineRate: 0.85,
  fdr: 0.05,
  pairCoupling: DEFAULT_PLAN.pairCoupling,
  amortisePrs: 100,
  pairedBaselineRuns: 20,
  screenKeepFraction: 0.15,
  runsPerCaseCeiling: DEFAULT_PLAN.runsPerCaseCeiling,
  screenRecall: { expensive: null, proxy: null },
  screenRecallSource: 'not measured',
  alpha: DEFAULT_PLAN.alpha,
  beta: DEFAULT_PLAN.beta,
  minTrials: DEFAULT_PLAN.minTrials,
  maxTrials: DEFAULT_PLAN.maxTrials,
  batchSize: DEFAULT_PLAN.batchSize,
  nullQuantile: DEFAULT_PLAN.nullQuantile,
};

/** A cost broken into the three things a pull request actually pays for. */
export interface FrontierCost {
  screenRuns: number;
  screenUsd: number;
  testRuns: number;
  testUsd: number;
  /** baseline runs charged to *this* pull request after amortisation */
  baselineRunsAmortised: number;
  baselineUsd: number;
  totalUsd: number;
}

export interface FrontierPoint {
  cases: number;
  mde: number;
  baselineRuns: number;
  design: FrontierDesign;
  screen: FrontierScreen;
  /** 0 when `screen` is `none` */
  screenRunsPerCase: number;
  /** how many cases the screen carries through */
  keep: number;
  /** e-BH solo bar, in logs */
  barLogE: number;
  /** unpaired evidence ceiling at this baseline size, in logs. −∞ is not used;
   *  the paired design has no ceiling and this field is `null` for it. */
  ceilingLogE: number | null;
  feasible: boolean;
  /** why not, when not. Never empty when `feasible` is false. */
  infeasibleBecause: string | null;
  /** observations per case to certify a case that really regressed */
  certifyObservations: number;
  /** observations per case on a pull request that changed nothing */
  typicalObservations: number;
  /**
   * The per-case run cap this configuration needs, `peeksafe run --max-runs`.
   * Larger than `DEFAULT_GATE.maxTrials` means the gate must be reconfigured or
   * it will stop short and return UNDECIDED, however much budget is left.
   */
  requiresMaxRuns: number;
  /** true when `requiresMaxRuns` exceeds the gate's configured cap */
  exceedsGateCap: boolean;
  /** a pull request that changed nothing, the number to budget from */
  typical: FrontierCost;
  /** every case regressed by exactly the MDE and had to be certified. A scenario, not a bound. */
  certifyAll: FrontierCost;
  /** every kept case ran to the per-case cap, the bill nothing can exceed */
  ceiling: FrontierCost;
  /** whichever of the three the configured `basis` selects, what the budget is checked against */
  basisCostUsd: number;
  withinBudget: boolean;
  /** measured recall of this configuration's screen; null when unmeasured */
  screenRecall: number | null;
  /** true when this configuration may be *recommended*, not merely reported */
  recommendable: boolean;
  /** why it is reported but not recommendable */
  caveat: string | null;
}

const RUNS_PER_OBS: Record<FrontierDesign, number> = { unpaired: 1, paired: 2 };

/** $1.00, but $0.0021 rather than $0.00, a per-run price rounds to nothing. */
export const fmtRate = (x: number): string =>
  !Number.isFinite(x) ? (Number.isNaN(x) ? '$?' : '$∞')
    : x >= 0.01 || x === 0 ? `$${x.toFixed(2)}` : `$${x.toPrecision(2)}`;

/** Cost of `runs` runs, all of them graded by the real grader. */
const graded = (runs: number, cfg: FrontierConfig): number =>
  runs * (cfg.costPerRunUsd + cfg.costPerGradeUsd);

/**
 * Observations per case on a pull request where nothing moved, clamped onto the
 * gate's own batch grid. Same model `peeksafe calibrate` scored to within ~10%
 * of three real runs, see `calibrate.ts`.
 */
export function typicalObservationsPerCase(rate: number, mde: number, cfg: FrontierConfig, baselineRuns: number): number {
  const s = Math.round(rate * baselineRuns);
  const p0 = betaQuantile(1 + s, 1 + baselineRuns - s, cfg.nullQuantile);
  const p1 = Math.max(0.005, p0 - mde);
  const raw = sprtExpectedN(rate, p0, p1, cfg.alpha, cfg.beta);
  const n = Number.isFinite(raw) && raw > 0
    ? Math.min(cfg.maxTrials, Math.max(cfg.minTrials, Math.ceil(raw)))
    : cfg.maxTrials;
  const batched = cfg.minTrials + Math.ceil(Math.max(0, n - cfg.minTrials) / cfg.batchSize) * cfg.batchSize;
  return Math.min(cfg.maxTrials, batched);
}

export function evaluatePoint(
  cases: number,
  mde: number,
  baselineRuns: number,
  design: FrontierDesign,
  screen: FrontierScreen,
  screenRunsPerCase: number,
  cfg: FrontierConfig
): FrontierPoint {
  // Strictly open: an MDE of 0 means "detect a zero-point drop", which every
  // design correctly refuses, but it refuses with a message about the evidence
  // ceiling, which sends the reader looking for a baseline problem that is not
  // there. Same for a baseline rate of 0 or 1.
  requireOpenProbability(mde, 'mde', 'evaluatePoint');
  requireOpenProbability(cfg.baselineRate, 'baselineRate', 'evaluatePoint');
  requireProbability(cfg.pairCoupling, 'pairCoupling', 'evaluatePoint');
  if (!Number.isInteger(cases) || cases < 1) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `frontier: cases must be a positive integer, got ${cases}`, {
      detail: { cases },
    });
  }
  if (!Number.isInteger(baselineRuns) || baselineRuns < 1) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `frontier: baselineRuns must be a positive integer, got ${baselineRuns}`, {
      detail: { baselineRuns },
    });
  }
  if (!Number.isInteger(cfg.maxTrials) || cfg.maxTrials < 1 || cfg.maxTrials < cfg.minTrials) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG',
      `frontier: maxTrials must be a positive integer ≥ minTrials, got ${cfg.maxTrials} vs ${cfg.minTrials}`, {
        detail: { maxTrials: cfg.maxTrials, minTrials: cfg.minTrials },
        hint: 'the ceiling bill is priced at this cap; a cap of zero prices a gate that never runs',
      });
  }
  if (screen !== 'none' && (!Number.isInteger(screenRunsPerCase) || screenRunsPerCase < 1)) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `frontier: a ${screen} screen needs at least one run per case, got ${screenRunsPerCase}`, {
      detail: { screen, screenRunsPerCase },
    });
  }

  const rate = cfg.baselineRate;
  const barLogE = Math.log(ebhSoloThreshold(cases, cfg.fdr));
  // The baseline this design actually needs. The paired design's null is exact,
  // so its stored baseline only tunes the stopping rule: a short one suffices,
  // and pretending it needs the same n_b as the unpaired design would price a
  // ceiling it never buys.
  const effectiveBaselineRuns = design === 'paired' ? cfg.pairedBaselineRuns : baselineRuns;
  const s = Math.round(rate * effectiveBaselineRuns);

  let ceilingLogE: number | null = null;
  let certifyObservations: number;
  let infeasibleBecause: string | null = null;

  if (rate <= mde) {
    infeasibleBecause =
      `a case at ${(rate * 100).toFixed(0)}% cannot lose ${(mde * 100).toFixed(0)} points, ` +
      'the effect is arithmetically impossible, not merely expensive';
    certifyObservations = Infinity;
  } else if (design === 'unpaired') {
    const pTrue = Math.max(1e-6, Math.min(1 - 1e-6, rate - mde));
    ceilingLogE = evidenceCeilingLogE(pTrue, s, effectiveBaselineRuns, mde);
    certifyObservations = samplesForEvidence(
      pTrue, s, effectiveBaselineRuns, mde, barLogE, cfg.runsPerCaseCeiling * 8
    );
    if (!Number.isFinite(certifyObservations)) {
      infeasibleBecause =
        `unpaired evidence ceiling e^${ceilingLogE.toFixed(1)} is below the bar e^${barLogE.toFixed(1)} ` +
        `at a ${effectiveBaselineRuns}-run baseline, no candidate budget certifies it`;
    }
  } else {
    const pairs = mcnemarSamplesForEvidence(
      rate, mde, cfg.pairCoupling, barLogE, cfg.runsPerCaseCeiling * 8
    );
    certifyObservations = pairs;
    if (!Number.isFinite(pairs)) {
      infeasibleBecause = `paired: no number of pairs reaches the bar at ρ = ${cfg.pairCoupling.toFixed(2)}`;
    }
  }

  const runsPerObs = RUNS_PER_OBS[design];
  if (infeasibleBecause === null && certifyObservations * runsPerObs > cfg.runsPerCaseCeiling) {
    infeasibleBecause =
      `${Math.ceil(certifyObservations * runsPerObs)} runs for one case, past the ` +
      `${cfg.runsPerCaseCeiling}-run per-case ceiling`;
  }
  const feasible = infeasibleBecause === null;

  const typicalObservations = typicalObservationsPerCase(rate, mde, cfg, effectiveBaselineRuns);
  const keep = screen === 'none' ? cases : Math.max(1, Math.ceil(cases * cfg.screenKeepFraction));

  // Screening runs are graded by whichever grader the screen uses. A proxy
  // screen still *executes* the agent, it only skips the grade, so it saves
  // `costPerGradeUsd` per screening run and not one cent more.
  //
  // And a screening *observation* costs `runsPerObs` runs, exactly as a test
  // observation does: `GateSession.nextBatch` hands out both arms in the screen
  // phase too (`requestsFor` is design-aware and the screen's own budget guard
  // multiplies by `armsPerObs`). Charging the paired screen one run an
  // observation understated it by 2×, in the direction that makes pairing look
  // cheaper, which is the conclusion this module publishes. REVIEW.md F42.
  const screenRuns = screen === 'none' ? 0 : cases * screenRunsPerCase * runsPerObs;
  const screenUsd =
    screen === 'none' ? 0
      : screen === 'proxy' ? screenRuns * cfg.costPerRunUsd
        : graded(screenRuns, cfg);

  // The baseline. Unpaired buys its ceiling here; paired does not.
  const baselineRunsTotal = cases * effectiveBaselineRuns;
  const baselineRunsAmortised = baselineRunsTotal / Math.max(1, cfg.amortisePrs);
  const baselineUsd = graded(baselineRunsAmortised, cfg);

  const costFor = (obsPerCase: number): FrontierCost => {
    const testRuns = Number.isFinite(obsPerCase) ? keep * obsPerCase * runsPerObs : Infinity;
    const testUsd = Number.isFinite(testRuns) ? graded(testRuns, cfg) : Infinity;
    return {
      screenRuns, screenUsd,
      testRuns, testUsd,
      baselineRunsAmortised, baselineUsd,
      totalUsd: screenUsd + testUsd + baselineUsd,
    };
  };
  const typical = costFor(typicalObservations);
  const certifyAll = costFor(certifyObservations);
  // The per-case cap this configuration would have to run under.
  //
  // Found while writing this module, and it is a real inconsistency in the rest
  // of the package: `DEFAULT_GATE.maxTrials` is 96, but `samplesForEvidence`
  // routinely answers "219 runs to certify this case". A plan quoting 219 is
  // quoting a design the default gate is configured never to execute, it would
  // stop at 96 and return UNDECIDED. So the cap is not a constant here; it is
  // whatever this configuration *needs*, and `requiresMaxRuns` says so out loud
  // whenever that is more than the gate's default.
  const capObservations = Number.isFinite(certifyObservations)
    ? Math.max(cfg.maxTrials, Math.ceil(certifyObservations))
    : cfg.maxTrials;
  // The gate stops paying for a case at that cap, so this is a real upper
  // bound rather than a scenario, and scenarios do not bound anything.
  const ceiling = costFor(capObservations);

  const screenRecall =
    screen === 'none' ? 1 : screen === 'proxy' ? cfg.screenRecall.proxy : cfg.screenRecall.expensive;

  // A lookup, not a `?:` chain with `typical` on the else branch. A typo'd
  // basis silently selecting the cheapest bill is precisely the
  // malformed-input-becomes-the-most-permissive-result failure this codebase
  // keeps finding in itself.
  const BILLS: Record<FrontierBasis, FrontierCost> = { typical, 'certify-all': certifyAll, ceiling };
  const basisCost = BILLS[cfg.basis];
  if (basisCost === undefined) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG',
      `frontier: basis must be one of ${Object.keys(BILLS).join(', ')}, got "${String(cfg.basis)}"`, {
        detail: { basis: cfg.basis },
        hint: 'an unrecognised basis silently defaulting to the cheaper bill is how a budget becomes fiction',
      });
  }
  const withinBudget = feasible && basisCost.totalUsd <= cfg.budgetUsd;

  // Reportable and recommendable are different. A screen whose recall nobody
  // measured is cheap in a way we cannot price, and a proxy screen at zero
  // grading cost is cheaper than nothing at all, which is to say, it is not.
  let caveat: string | null = null;
  if (screen !== 'none' && screenRecall === null) {
    caveat = `the ${screen} screen's recall cost is unmeasured, it drops regressions at an unknown rate`;
  } else if (screen === 'proxy' && cfg.costPerGradeUsd <= 0) {
    caveat = 'a proxy screen saves only grading cost, and grading here is free, it buys nothing and costs recall';
  }

  return {
    cases, mde, baselineRuns, design, screen,
    screenRunsPerCase: screen === 'none' ? 0 : screenRunsPerCase,
    keep, barLogE, ceilingLogE,
    feasible, infeasibleBecause,
    certifyObservations, typicalObservations,
    requiresMaxRuns: capObservations,
    exceedsGateCap: capObservations > cfg.maxTrials,
    typical, certifyAll, ceiling, basisCostUsd: basisCost.totalUsd, withinBudget,
    screenRecall,
    recommendable: withinBudget && caveat === null,
    caveat,
  };
}

/** Every point in the swept space, feasible or not. */
export function enumerateFrontier(cfg: FrontierConfig, axes: FrontierAxes = DEFAULT_AXES): FrontierPoint[] {
  if (!(cfg.budgetUsd >= 0) || !(cfg.costPerRunUsd >= 0) || !(cfg.costPerGradeUsd >= 0)) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', 'frontier: budget and costs must be ≥ 0 and not NaN', {
      detail: {
        budgetUsd: cfg.budgetUsd, costPerRunUsd: cfg.costPerRunUsd, costPerGradeUsd: cfg.costPerGradeUsd,
      },
    });
  }
  if (!(cfg.screenKeepFraction > 0) || !(cfg.screenKeepFraction <= 1)) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `frontier: screenKeepFraction must be in (0,1], got ${cfg.screenKeepFraction}`, {
      detail: { screenKeepFraction: cfg.screenKeepFraction },
    });
  }
  if (!Number.isInteger(cfg.amortisePrs) || cfg.amortisePrs < 1) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `frontier: amortisePrs must be a positive integer, got ${cfg.amortisePrs}`, {
      detail: { amortisePrs: cfg.amortisePrs },
      hint: 'a baseline spread over "infinity" pull requests is how the baseline cost disappeared from the round-3 model',
    });
  }
  for (const [name, xs] of Object.entries(axes) as Array<[string, unknown[]]>) {
    if (!Array.isArray(xs) || xs.length === 0) {
      throw new PeeksafeError('PEEKSAFE_E_CONFIG', `frontier: axis "${name}" is empty, nothing to sweep`, {
        detail: { axis: name },
      });
    }
  }
  const out: FrontierPoint[] = [];
  for (const m of axes.cases) {
    for (const mde of axes.mdes) {
      for (const design of axes.designs) {
        // The baseline axis is real for the unpaired design and a fiction for
        // the paired one, which uses `pairedBaselineRuns` whatever this says.
        // Sweeping it anyway would emit five identical paired rows and make the
        // frontier look like it had five times the evidence it has.
        const baselines = design === 'paired' ? [cfg.pairedBaselineRuns] : axes.baselineRuns;
        for (const nb of baselines) {
          for (const screen of axes.screens) {
            const ks = screen === 'none' ? [0] : axes.screenRuns;
            for (const k of ks) out.push(evaluatePoint(m, mde, nb, design, screen, k, cfg));
          }
        }
      }
    }
  }
  return out;
}

export interface FrontierCell {
  cases: number;
  mde: number;
  /** the cheapest recommendable configuration that certifies this cell */
  best: FrontierPoint;
  /** the cheapest configuration ignoring the recommendable rule, when it differs */
  cheapestReported: FrontierPoint | null;
}

export interface FrontierResult {
  config: FrontierConfig;
  axes: FrontierAxes;
  /** everything swept */
  points: FrontierPoint[];
  /** feasible, within budget, and recommendable */
  affordable: FrontierPoint[];
  /**
   * The frontier proper: the (cases, mde) cells that are achievable within
   * budget and not dominated by another achievable cell, i.e. no other cell
   * has at least as many cases *and* an MDE at least as tight.
   */
  frontier: FrontierCell[];
  /** cheapest feasible configuration overall, whether or not it fits */
  cheapestFeasible: FrontierPoint | null;
  /** the smallest budget at which anything at all becomes recommendable */
  minimumViableBudgetUsd: number | null;
  headline: string;
}

/**
 * A cell (m, δ) dominates (m', δ') when it covers at least as many cases and
 * detects at least as small a drop, and is strictly better on one of them. The
 * frontier is what survives.
 */
function paretoCells(cells: FrontierCell[]): FrontierCell[] {
  return cells.filter((a) =>
    !cells.some((b) =>
      b !== a && b.cases >= a.cases && b.mde <= a.mde && (b.cases > a.cases || b.mde < a.mde)
    )
  );
}

export function computeFrontier(cfg: FrontierConfig, axes: FrontierAxes = DEFAULT_AXES): FrontierResult {
  const points = enumerateFrontier(cfg, axes);
  const feasible = points.filter((p) => p.feasible);
  const affordable = points.filter((p) => p.recommendable);

  const cheaper = (a: FrontierPoint, b: FrontierPoint) => (a.basisCostUsd <= b.basisCostUsd ? a : b);
  const byCell = new Map<string, FrontierCell>();
  for (const p of affordable) {
    const key = `${p.cases}|${p.mde}`;
    const cur = byCell.get(key);
    if (!cur) byCell.set(key, { cases: p.cases, mde: p.mde, best: p, cheapestReported: null });
    else cur.best = cheaper(cur.best, p);
  }
  // For each cell on the frontier, also name the cheapest *reported* option, so
  // an operator can see what the "unmeasured recall" rule cost them.
  for (const cell of byCell.values()) {
    const reported = points
      .filter((p) => p.cases === cell.cases && p.mde === cell.mde && p.withinBudget)
      .reduce<FrontierPoint | null>((best, p) => (best === null ? p : cheaper(best, p)), null);
    cell.cheapestReported =
      reported && reported.basisCostUsd < cell.best.basisCostUsd ? reported : null;
  }

  const frontier = paretoCells([...byCell.values()]).sort((a, b) => b.cases - a.cases || a.mde - b.mde);

  const cheapestFeasible = feasible.reduce<FrontierPoint | null>(
    (best, p) => (best === null || p.basisCostUsd < best.basisCostUsd ? p : best), null
  );
  // The smallest budget at which *something* becomes recommendable. `caveat`
  // is exactly the recommendable rule minus the budget test, so reusing it here
  // means the headline and the recommendation cannot disagree about what counts.
  const cleanFeasible = feasible.filter((p) => p.caveat === null);
  const minimumViableBudgetUsd = cleanFeasible.length === 0
    ? null
    : Math.min(...cleanFeasible.map((p) => p.basisCostUsd));

  const headline = frontier.length === 0
    ? minimumViableBudgetUsd === null
      ? `nothing in the swept space is certifiable at ${(cfg.baselineRate * 100).toFixed(0)}% baseline rate, ` +
        'every configuration is either arithmetically impossible or past the per-case run ceiling'
      : `nothing fits $${cfg.budgetUsd.toFixed(2)} at ${fmtRate(cfg.costPerRunUsd)}/run on the ${cfg.basis} bill. ` +
        `The cheapest certifiable configuration is $${minimumViableBudgetUsd.toFixed(2)} per pull request` +
        (cheapestFeasible
          ? `, ${cheapestFeasible.cases} cases at ${(cheapestFeasible.mde * 100).toFixed(0)} points, ${cheapestFeasible.design}.`
          : '.')
    : (() => {
        const widest = frontier[0]!;
        const tightest = [...frontier].sort((a, b) => a.mde - b.mde)[0]!;
        return `at ${fmtRate(cfg.costPerRunUsd)}/run and $${cfg.budgetUsd.toFixed(2)} a pull request (${cfg.basis} bill) you can certify ` +
          `${widest.cases} cases at ${(widest.mde * 100).toFixed(0)} points ` +
          `($${widest.best.basisCostUsd.toFixed(2)}, ${widest.best.design})` +
          (tightest !== widest
            ? `, or ${tightest.cases} cases at ${(tightest.mde * 100).toFixed(0)} points ` +
              `($${tightest.best.basisCostUsd.toFixed(2)}, ${tightest.best.design})`
            : '') + '.';
      })();

  return {
    config: cfg, axes, points, affordable, frontier,
    cheapestFeasible, minimumViableBudgetUsd, headline,
  };
}

/**
 * Where the money goes, for one configuration. Printed under the frontier
 * because the shares are the actual finding: at coding-agent prices the
 * unpaired design's amortised baseline is usually the largest line, and it is
 * the one the README used to call free.
 */
export function costShares(
  p: FrontierPoint,
  basis: FrontierBasis = 'typical'
): { screen: number; test: number; baseline: number } {
  const cost = basis === 'ceiling' ? p.ceiling : basis === 'certify-all' ? p.certifyAll : p.typical;
  const t = cost.totalUsd;
  if (!(t > 0) || !Number.isFinite(t)) return { screen: 0, test: 0, baseline: 0 };
  return {
    screen: cost.screenUsd / t,
    test: cost.testUsd / t,
    baseline: cost.baselineUsd / t,
  };
}
