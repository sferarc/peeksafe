/**
 * plan.ts: power economics. What will this cost, and can we even detect it?
 *
 * The first version of peeksafe could tell you, after the fact, that it had
 * spent 8,000 model calls and still said INCONCLUSIVE. This module tells you
 * *before* you spend anything, and it will tell you that the honest answer is
 * sometimes "you cannot detect this at any price".
 *
 * The three numbers that matter, per case:
 *
 *  1. **The bar.** e-BH at FDR q over m cases certifies a case on its own only
 *     once its e-value clears m/q. That is the target the evidence has to hit.
 *
 *  2. **The ceiling.** `evidenceCeilingLogE`, the limit of the unpaired
 *     two-sample e-value as candidate runs go to infinity. Both marginals are
 *     the same binomial likelihood under different priors, so everything that
 *     grows with n cancels and the Bayes factor converges to the prior density
 *     ratio at the observed rate. If the ceiling is under the bar, no number of
 *     candidate runs will certify the case. This is not a budget problem and no
 *     budget fixes it: **more baseline runs** fix it, by sharpening the null.
 *
 *  3. **The paired alternative.** Re-run the baseline alongside the candidate
 *     on the same seed and the null becomes an exact point mass at ½ (a
 *     discordant pair points either way with probability exactly one half under
 *     "nothing changed"). Nothing is estimated, so nothing caps the evidence:
 *     the paired e-value grows linearly in discordant pairs. It costs two runs
 *     per observation and it is still, routinely, the cheaper design, and it
 *     is the only one that works at all for a case whose ceiling is under the
 *     bar.
 *
 * Everything here is a *plan*: it evaluates the mean trajectory (the candidate
 * scores exactly its expected successes). Realised sample counts vary around
 * it, and `test/plan.test.ts` checks the plan against what the gate actually
 * spends.
 */
import {
  evidenceCeilingLogE, samplesForEvidence, mcnemarSamplesForEvidence,
  pairedDiscordance, ebhSoloThreshold, sampleSizeTwoProportion, sprtExpectedN, betaQuantile,
} from './stats.js';
import { PeeksafeError, requireProbability, requireOpenProbability } from './errors.js';
import { baselineNullRate, type BaselineStat, type CaseRef } from './baseline.js';

export interface PlanConfig {
  /** the drop we want to be able to detect, in probability units (0.15 = 15 points) */
  mde: number;
  /** suite-level false discovery rate */
  fdr: number;
  /** USD per candidate run */
  costPerRunUsd: number;
  /** milliseconds per run, wall clock, at concurrency 1 */
  msPerRun: number;
  /** how many runs the screening pass spends per case */
  screenRuns: number;
  /**
   * Measured coupling between the paired arms, in [0,1]. 0 means the seeds
   * bought nothing; 1 means perfect common-random-numbers coupling. Measure it
   * with `pairPhi` on a pilot rather than assuming it, `peeksafe plan` prints
   * the plan at the measured value and at 0 so the sensitivity is visible.
   */
  pairCoupling: number;
  /** how many runs to fan out in parallel, only affects wall time */
  concurrency: number;
  /** beyond this many runs for one case we stop calling it "affordable" */
  runsPerCaseCeiling: number;
  /**
   * Which design the *expected* bill is priced for. A paired observation is two
   * runs, so this doubles `typicalRuns`.
   *
   * `undefined` means "price the design this plan recommends", which is the
   * only self-consistent answer: `makePlan` recommends pairing whenever more
   * than a quarter of the suite has an unpaired evidence ceiling under the bar,
   * and until round 5 it then quoted the *unpaired* bill underneath that
   * recommendation. Measured against a real paired run of the bundled suite,
   * the headline was 2.1× too low, and it crossed the printed "affordable
   * (≤ $5/PR)" boundary. `peeksafe calibrate` never caught it because its own
   * default design is unpaired. REVIEW.md F41.
   */
  design?: 'unpaired' | 'paired';

  /* ── the sequential design being priced ────────────────────────────────
   * Only the *expected* cost depends on these; the certify-all ceiling does
   * not. They mirror `DEFAULT_GATE` and must be kept in step with whatever
   * config the gate will actually run under, or the plan prices a design
   * nobody is going to execute.
   */
  alpha: number;
  beta: number;
  minTrials: number;
  maxTrials: number;
  batchSize: number;
  nullQuantile: number;
}

export const DEFAULT_PLAN: PlanConfig = {
  mde: 0.15,
  fdr: 0.05,
  // These three are *assumptions* until something measures them. `peeksafe
  // calibrate` fits the first two from a real run and `peeksafe harness verify`
  // measures the third; `peeksafe plan --coupling auto --cost-per-run auto`
  // reads them back. A plan built on this block alone should say so, and does.
  costPerRunUsd: 0.0021,
  msPerRun: 780,
  pairCoupling: 0.9,
  screenRuns: 4,
  concurrency: 8,
  runsPerCaseCeiling: 2000,
  alpha: 0.05,
  beta: 0.1,
  minTrials: 8,
  maxTrials: 96,
  batchSize: 4,
  nullQuantile: 0.5,
};

export type Detectability =
  /** the unpaired sequential test can certify this case within the run ceiling */
  | 'UNPAIRED'
  /** only the paired design can certify it, the unpaired evidence ceiling is under the bar */
  | 'PAIRED_ONLY'
  /** the run count is finite but past the ceiling: technically possible, practically not */
  | 'TOO_EXPENSIVE'
  /** the case cannot lose `mde` points at all, its baseline rate is not that high */
  | 'IMPOSSIBLE';

export interface PlanCase {
  caseId: string;
  suite: string;
  baseline: { successes: number; trials: number; rate: number };
  /** the rate the alternative sits at: baseline − mde, floored at 0 */
  alternativeRate: number;
  /** log of the e-value a case must reach to be certified on its own evidence */
  barLogE: number;
  /** the limit of the unpaired log e-value as runs → ∞ */
  ceilingLogE: number;
  unpaired: { runs: number; costUsd: number; wallMs: number };
  paired: { pairs: number; runs: number; costUsd: number; wallMs: number };
  detectability: Detectability;
  /**
   * How many baseline runs this case would need for the *unpaired* design to
   * work, or null if it already works. This is the actionable half of an
   * "undetectable" verdict.
   */
  baselineRunsNeeded: number | null;
  /** what a fixed-N two-proportion design would spend per arm, for comparison */
  fixedNPerArm: number;
  reason: string;
}

export interface PlanTotals {
  cases: number;
  /** how many cases each design can actually certify */
  decidableUnpaired: number;
  decidableBest: number;
  /** every case run to certification, unpaired */
  unpairedRuns: number;
  unpairedCostUsd: number;
  /** every case run to certification, paired */
  pairedRuns: number;
  pairedCostUsd: number;
  /** per case, the cheaper of the two designs that can decide it */
  bestRuns: number;
  bestCostUsd: number;
  /** screen everything cheaply, then pay only for what the screen keeps */
  screenedRuns: number;
  screenedCostUsd: number;
  /** the fixed-N design with the same nominal guarantees */
  fixedNRuns: number;
  fixedNCostUsd: number;
  wallMsUnpaired: number;
  wallMsPaired: number;
  wallMsBest: number;
  wallMsScreened: number;
  /** fraction of cases the screen is budgeted to carry through to the full test */
  screenContinueFraction: number;

  /* ── the expected cost, as opposed to the worst case ───────────────────
   * `bestRuns` above is what it costs to certify *every* case, i.e. a pull
   * request in which everything regressed by exactly the MDE. Real pull
   * requests move nothing, cases hit the H₀ wall early, and they stop costing
   * money. Measured against three real runs of this suite, `bestRuns`
   * over-predicts what the gate actually spends by 5 to 8×, and the numbers below
   * predict it to within about 10%. See `calibrate.ts`.
   */
  /** 1 unpaired, 2 paired, what one observation costs in runs */
  runsPerObservation: number;
  /** expected *runs* (not observations) for a pull request in which nothing moved */
  typicalRuns: number;
  typicalCostUsd: number;
  wallMsTypical: number;
  /** the same, with a screening pass in front */
  typicalScreenedRuns: number;
  typicalScreenedCostUsd: number;
}

export interface Plan {
  config: PlanConfig;
  cases: PlanCase[];
  totals: PlanTotals;
  /** cases no budget can decide with the current baseline */
  undecidable: PlanCase[];
  /** cases only the paired design can reach */
  pairedOnly: PlanCase[];
  /** cases whose baseline rate is too low to lose `mde` points at all */
  impossible: PlanCase[];
  /** the design the recommendation names, and the one `expectedCostUsd` prices */
  recommendedDesign: 'unpaired' | 'paired';
  /** the cheapest design that decides every decidable case */
  recommendation: string;
  /** honest one-liner about affordability at the configured cost per run */
  verdict: string;
  /**
   * What a *typical* pull request costs, one in which nothing moved, so most
   * cases stop at the H₀ wall. This is the headline number, and it is the one
   * `peeksafe calibrate` measures the residual of.
   */
  expectedCostUsd: number;
  /** What a pull request in which *every* case regressed would cost. A ceiling. */
  ceilingCostUsd: number;
}

const round = (x: number) => (Number.isFinite(x) ? Math.ceil(x) : Infinity);

const medianTrials = (ps: PlanCase[]): number => {
  const xs = ps.map((p) => p.baseline.trials).sort((a, b) => a - b);
  return xs.length === 0 ? 0 : xs[Math.floor(xs.length / 2)]!;
};

/**
 * How many baseline runs would lift this case's evidence ceiling over the bar?
 * Doubling search on the baseline trial count, holding the baseline *rate*
 * fixed, "if I keep measuring main at the same quality, how long until this
 * case becomes decidable at all?"
 */
function baselineRunsToClear(rate: number, mde: number, barLogE: number, cap = 100_000): number | null {
  const at = (n: number) => {
    const s = Math.round(rate * n);
    return evidenceCeilingLogE(Math.max(1e-6, Math.min(1 - 1e-6, rate - mde)), s, n, mde);
  };
  let hi = 8;
  while (hi <= cap && at(hi) < barLogE) hi *= 2;
  if (at(hi) < barLogE) return null;
  let lo = Math.floor(hi / 2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (at(mid) >= barLogE) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function planCase(
  c: CaseRef,
  b: BaselineStat | undefined,
  cfg: PlanConfig,
  m: number
): PlanCase {
  const barLogE = Math.log(ebhSoloThreshold(m, cfg.fdr));
  const trials = b?.trials ?? 0;
  const successes = b?.successes ?? 0;
  const rate = trials > 0 ? successes / trials : 0;
  const alt = Math.max(0, rate - cfg.mde);

  const base = {
    caseId: c.id,
    // `suite` groups cases into correlation families. A caller who does not
    // group them gets one family per case, which is the conservative reading.
    suite: c.suite ?? c.id,
    baseline: { successes, trials, rate },
    alternativeRate: alt,
    barLogE,
    fixedNPerArm: sampleSizeTwoProportion(Math.max(1e-6, rate), cfg.mde),
  };

  if (trials === 0) {
    return {
      ...base,
      ceilingLogE: 0,
      unpaired: { runs: Infinity, costUsd: Infinity, wallMs: Infinity },
      paired: { pairs: Infinity, runs: Infinity, costUsd: Infinity, wallMs: Infinity },
      detectability: 'IMPOSSIBLE',
      baselineRunsNeeded: null,
      reason: 'no baseline: nothing to compare against, record one first',
    };
  }
  if (rate <= cfg.mde) {
    return {
      ...base,
      ceilingLogE: 0,
      unpaired: { runs: Infinity, costUsd: Infinity, wallMs: Infinity },
      paired: { pairs: Infinity, runs: Infinity, costUsd: Infinity, wallMs: Infinity },
      detectability: 'IMPOSSIBLE',
      baselineRunsNeeded: null,
      reason:
        `baseline rate ${(rate * 100).toFixed(0)}% cannot lose ${(cfg.mde * 100).toFixed(0)} points, ` +
        `the effect is arithmetically impossible, not merely expensive`,
    };
  }

  const pTrue = Math.max(1e-6, Math.min(1 - 1e-6, alt));
  const ceilingLogE = evidenceCeilingLogE(pTrue, successes, trials, cfg.mde);
  const unpairedRuns = samplesForEvidence(pTrue, successes, trials, cfg.mde, barLogE, cfg.runsPerCaseCeiling * 8);
  const pairs = mcnemarSamplesForEvidence(rate, cfg.mde, cfg.pairCoupling, barLogE, cfg.runsPerCaseCeiling * 8);

  const unpaired = {
    runs: unpairedRuns,
    costUsd: unpairedRuns * cfg.costPerRunUsd,
    wallMs: unpairedRuns * cfg.msPerRun,
  };
  const paired = {
    pairs,
    runs: pairs * 2,
    costUsd: pairs * 2 * cfg.costPerRunUsd,
    wallMs: pairs * 2 * cfg.msPerRun,
  };

  let detectability: Detectability;
  let reason: string;
  if (Number.isFinite(unpairedRuns) && unpairedRuns <= cfg.runsPerCaseCeiling) {
    detectability = 'UNPAIRED';
    reason = `${unpairedRuns} candidate runs against the stored baseline`;
  } else if (Number.isFinite(pairs) && pairs * 2 <= cfg.runsPerCaseCeiling) {
    detectability = 'PAIRED_ONLY';
    reason = Number.isFinite(unpairedRuns)
      ? `unpaired needs ${unpairedRuns} runs (past the ${cfg.runsPerCaseCeiling} ceiling); paired needs ${pairs * 2}`
      : `unpaired evidence ceiling is e^${ceilingLogE.toFixed(1)}, under the bar e^${barLogE.toFixed(1)}, ` +
        `no number of candidate runs certifies it. Paired: ${pairs * 2} runs.`;
  } else if (Number.isFinite(unpairedRuns) || Number.isFinite(pairs)) {
    detectability = 'TOO_EXPENSIVE';
    reason = `cheapest design needs ${Math.min(unpairedRuns, pairs * 2)} runs, past the ${cfg.runsPerCaseCeiling} ceiling`;
  } else {
    detectability = 'IMPOSSIBLE';
    reason = `neither design reaches the bar within ${cfg.runsPerCaseCeiling * 8} runs`;
  }

  const baselineRunsNeeded =
    detectability === 'UNPAIRED' ? null : baselineRunsToClear(rate, cfg.mde, barLogE);

  return { ...base, ceilingLogE, unpaired, paired, detectability, baselineRunsNeeded, reason };
}

/**
 * Expected total samples for the sequential design, priced under Wald's
 * expected sample number at a supplied "true" rate per case, and clamped into
 * the gate's own [minTrials, maxTrials] batch grid.
 *
 * This is the number that predicts what the gate will actually spend.
 * `samplesForEvidence`, the one behind `PlanCase.unpaired.runs`, answers a
 * different question: how many runs it takes to *certify a regression*. A case
 * that did not regress never gets there; it hits the H₀ wall in a few batches
 * and stops. Conflating the two is what made round 2's plan over-predict the
 * bill by 5 to 8×.
 *
 * `trueRate` defaults to the case's own baseline rate, i.e. "nothing moved", * which is what almost every pull request looks like.
 */
export function expectedSequentialSamples(
  cases: Array<CaseRef>,
  baseline: Map<string, BaselineStat>,
  cfg: PlanConfig,
  trueRate: (caseId: string, b: BaselineStat) => number = (_id, b) => (b.trials > 0 ? b.successes / b.trials : 0)
): { samples: number; perCase: Map<string, number> } {
  const perCase = new Map<string, number>();
  let total = 0;
  for (const c of cases) {
    const b = baseline.get(c.id);
    if (!b || b.trials === 0) continue;
    const p0 = baselineNullRate(b, cfg.nullQuantile);
    const p1 = Math.max(0.005, p0 - cfg.mde);
    const p = Math.max(0, Math.min(1, trueRate(c.id, b)));
    const raw = sprtExpectedN(p, p0, p1, cfg.alpha, cfg.beta);
    const n = Number.isFinite(raw) && raw > 0
      ? Math.min(cfg.maxTrials, Math.max(cfg.minTrials, Math.ceil(raw)))
      : cfg.maxTrials;
    // The gate only ever adds whole batches past the minimum, so round the
    // prediction onto the same grid the gate samples on.
    const batched = cfg.minTrials + Math.ceil(Math.max(0, n - cfg.minTrials) / cfg.batchSize) * cfg.batchSize;
    const capped = Math.min(cfg.maxTrials, batched);
    perCase.set(c.id, capped);
    total += capped;
  }
  return { samples: total, perCase };
}

export function makePlan(
  cases: Array<CaseRef>,
  baseline: Map<string, BaselineStat>,
  cfg: PlanConfig = DEFAULT_PLAN
): Plan {
  // Open interval: mde = 0 asks for a zero-point drop and fdr = 0 asks for a
  // bar of Infinity. Both used to be accepted and produce a plan in which
  // nothing is decidable, for a reason the printed message blamed on the
  // baseline.
  requireOpenProbability(cfg.mde, 'mde', 'makePlan');
  requireOpenProbability(cfg.fdr, 'fdr', 'makePlan');
  requireProbability(cfg.pairCoupling, 'pairCoupling', 'makePlan');
  if (cases.length === 0) {
    throw new PeeksafeError('PEEKSAFE_E_SUITE_EMPTY', 'makePlan: no cases to plan for', {
      hint: 'point --cases at a directory containing case files',
    });
  }
  if (!(cfg.costPerRunUsd >= 0) || !(cfg.msPerRun >= 0)) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', 'makePlan: costPerRunUsd and msPerRun must be ≥ 0', {
      detail: { costPerRunUsd: cfg.costPerRunUsd, msPerRun: cfg.msPerRun },
    });
  }

  const m = cases.length;
  const planned = cases.map((c) => planCase(c, baseline.get(c.id), cfg, m));

  const finite = (x: number) => (Number.isFinite(x) ? x : 0);
  const decidableUnpaired = planned.filter((p) => p.detectability === 'UNPAIRED');
  const decidableAny = planned.filter(
    (p) => p.detectability === 'UNPAIRED' || p.detectability === 'PAIRED_ONLY'
  );

  const unpairedRuns = decidableUnpaired.reduce((a, p) => a + finite(p.unpaired.runs), 0);
  const pairedRuns = decidableAny.reduce((a, p) => a + finite(p.paired.runs), 0);
  // Per case, take the cheaper design that can actually decide it. This is the
  // number the recommendation and the affordability verdict are built on: a
  // design that is cheap because it decides nothing is not cheap.
  const bestRuns = decidableAny.reduce(
    (a, p) => a + Math.min(finite(p.unpaired.runs) || Infinity, finite(p.paired.runs) || Infinity),
    0
  );

  const pairedOnlyCount = planned.filter((p) => p.detectability === 'PAIRED_ONLY').length;
  // The design the recommendation will name, computed here because the
  // *expected* bill has to be priced for it. `pairedOnly > 25%` is the same
  // condition the recommendation string uses; they cannot drift apart.
  const recommendedDesign: 'unpaired' | 'paired' =
    cfg.design ?? (decidableAny.length > 0 && pairedOnlyCount > cases.length * 0.25 ? 'paired' : 'unpaired');
  const runsPerObservation = recommendedDesign === 'paired' ? 2 : 1;

  // Screening: everything gets `screenRuns`; only the cases the screen ranks as
  // plausibly moved go on to the sequential test. A clean PR moves nothing, so
  // in expectation only the FDR-sized tail continues, but a plan must be
  // conservative, so we budget for the worst realistic case: 10% continue.
  const screenContinueFraction = 0.1;
  const screenSelected = Math.ceil(decidableAny.length * screenContinueFraction);
  const meanBest = decidableAny.length > 0 ? bestRuns / decidableAny.length : 0;
  const screenedRuns = m * cfg.screenRuns + screenSelected * meanBest;

  const fixedNRuns = planned.reduce((a, p) => a + finite(p.fixedNPerArm), 0);

  // The expected cost of a pull request that changed nothing, which is what a
  // pull request almost always is, and therefore the number a budget should be
  // set from. Verified against real runs by `peeksafe calibrate`.
  // `expectedSequentialSamples` counts *observations*. A paired observation is
  // two runs, the candidate and the reference revision on the same seed, and
  // so is a paired screening run, because `GateSession` hands out both arms in
  // the screen phase too.
  const typical = expectedSequentialSamples(cases, baseline, cfg);
  const typicalRuns = typical.samples * runsPerObservation;
  const meanTypical = typical.perCase.size > 0 ? typical.samples / typical.perCase.size : 0;
  const typicalScreenedRuns = Math.ceil(
    (m * cfg.screenRuns + Math.ceil(m * screenContinueFraction) * meanTypical) * runsPerObservation
  );

  const totals: PlanTotals = {
    cases: m,
    decidableUnpaired: decidableUnpaired.length,
    decidableBest: decidableAny.length,
    unpairedRuns,
    unpairedCostUsd: unpairedRuns * cfg.costPerRunUsd,
    pairedRuns,
    pairedCostUsd: pairedRuns * cfg.costPerRunUsd,
    bestRuns: round(bestRuns),
    bestCostUsd: round(bestRuns) * cfg.costPerRunUsd,
    screenedRuns: round(screenedRuns),
    screenedCostUsd: round(screenedRuns) * cfg.costPerRunUsd,
    fixedNRuns,
    fixedNCostUsd: fixedNRuns * cfg.costPerRunUsd,
    wallMsUnpaired: (unpairedRuns * cfg.msPerRun) / Math.max(1, cfg.concurrency),
    wallMsPaired: (pairedRuns * cfg.msPerRun) / Math.max(1, cfg.concurrency),
    wallMsBest: (round(bestRuns) * cfg.msPerRun) / Math.max(1, cfg.concurrency),
    wallMsScreened: (round(screenedRuns) * cfg.msPerRun) / Math.max(1, cfg.concurrency),
    screenContinueFraction,
    runsPerObservation,
    typicalRuns,
    typicalCostUsd: typicalRuns * cfg.costPerRunUsd,
    wallMsTypical: (typicalRuns * cfg.msPerRun) / Math.max(1, cfg.concurrency),
    typicalScreenedRuns,
    typicalScreenedCostUsd: typicalScreenedRuns * cfg.costPerRunUsd,
  };

  const undecidable = planned.filter(
    (p) => p.detectability === 'TOO_EXPENSIVE' || p.detectability === 'IMPOSSIBLE'
  );
  const pairedOnly = planned.filter((p) => p.detectability === 'PAIRED_ONLY');
  const impossible = planned.filter((p) => p.detectability === 'IMPOSSIBLE');

  const recommendation =
    decidableAny.length === 0
      ? `nothing is decidable at ${(cfg.mde * 100).toFixed(0)} points against this baseline, record more baseline runs or raise the MDE`
      : recommendedDesign === 'paired'
        ? `pair the runs: ${pairedOnly.length}/${m} cases have an unpaired evidence ceiling under the bar, so no candidate budget can decide them` +
          ` (the costs below are priced at two runs an observation, which is what pairing costs)`
        : totals.screenedCostUsd < totals.bestCostUsd
          ? `screen first, then run the sequential test on what the screen keeps ` +
            `($${totals.screenedCostUsd.toFixed(2)} vs $${totals.bestCostUsd.toFixed(2)})`
          : `run the sequential test directly`;

  // The honest cost is the cheapest plan that still decides something. A design
  // that is free because it certifies nothing is not a cheap design.
  const ceilingCost =
    decidableAny.length === 0
      ? Infinity
      : Math.min(totals.screenedCostUsd, totals.bestCostUsd);
  // …and the honest *headline* is the expected cost, not the ceiling. Round 2
  // led with the ceiling and therefore over-stated the bill by 5 to 8× (measured;
  // see `calibrate.ts`). The ceiling is still printed, labelled as a ceiling.
  // Mirrors the ceiling's structure exactly, the cheapest plan of its kind, // so the two numbers are comparable. Comparing an unscreened expected cost
  // with a screened ceiling was the first version of this and it made the
  // "expected" figure look *larger* than the worst case.
  const expectedCost =
    decidableAny.length === 0
      ? Infinity
      : Math.min(totals.typicalCostUsd, totals.typicalScreenedCostUsd);
  const coverage = `${decidableAny.length}/${m} cases`;
  const ceilingNote = Number.isFinite(ceilingCost)
    ? ` Worst case, every case regressing at once, is $${ceilingCost.toFixed(2)}.`
    : '';
  const verdict =
    !Number.isFinite(expectedCost)
      ? `undecidable: no design reaches the bar for any case at ${(cfg.mde * 100).toFixed(0)} points with a ${medianTrials(planned)}-run baseline`
      : expectedCost <= 5
        ? `affordable: about $${expectedCost.toFixed(2)} per pull request, covering ${coverage}.${ceilingNote}`
        : expectedCost <= 100
          ? `viable but not free: about $${expectedCost.toFixed(2)} per pull request covering ${coverage}, worth gating a release on, not every commit.${ceilingNote}`
          : `not affordable per-PR at $${cfg.costPerRunUsd.toFixed(4)}/run: about $${expectedCost.toFixed(0)} a time for ${coverage}. ` +
            `Cut the suite, raise the MDE, or gate nightly instead of per-PR.${ceilingNote}`;

  return {
    config: cfg, cases: planned, totals, undecidable, pairedOnly, impossible,
    recommendedDesign, recommendation, verdict,
    expectedCostUsd: expectedCost, ceilingCostUsd: ceilingCost,
  };
}

/**
 * The suite size / MDE combinations that *are* affordable at a given per-run
 * cost and budget. This is the honest answer to "is this usable for a
 * coding-agent benchmark at $1 a run?", usually "not at 200 cases and 15
 * points, but yes at 20 cases and 25 points".
 */
export interface AffordabilityCell {
  cases: number;
  mde: number;
  /** runs to certify every case, the ceiling */
  runs: number;
  costUsd: number;
  /** runs a pull request that moved nothing actually spends, the expected bill */
  typicalRuns: number;
  typicalCostUsd: number;
  /** does the *ceiling* fit the budget? */
  affordable: boolean;
  /** does the *expected* cost fit the budget? */
  typicallyAffordable: boolean;
}

export function affordabilityGrid(
  baselineRate: number,
  baselineTrials: number,
  cfg: PlanConfig,
  budgetUsd: number,
  caseCounts: number[] = [20, 50, 100, 200],
  mdes: number[] = [0.1, 0.15, 0.25, 0.35]
): AffordabilityCell[] {
  requireProbability(baselineRate, 'baselineRate', 'affordabilityGrid');
  const out: AffordabilityCell[] = [];
  for (const m of caseCounts) {
    for (const mde of mdes) {
      const bar = Math.log(ebhSoloThreshold(m, cfg.fdr));
      const pTrue = Math.max(1e-6, baselineRate - mde);
      const s = Math.round(baselineRate * baselineTrials);
      const perCase = samplesForEvidence(pTrue, s, baselineTrials, mde, bar, 200_000);
      const pairs = mcnemarSamplesForEvidence(baselineRate, mde, cfg.pairCoupling, bar, 200_000);
      // the cheaper of the two designs, screened down to a 10% continue rate
      const best = Math.min(Number.isFinite(perCase) ? perCase : Infinity, pairs * 2);
      const runs = Number.isFinite(best)
        ? Math.ceil(m * cfg.screenRuns + Math.ceil(m * 0.1) * best)
        : Infinity;
      const costUsd = runs * cfg.costPerRunUsd;
      // The ceiling above prices a pull request in which every case regressed.
      // This prices one in which nothing did, which is what a pull request
      // almost always is, the same expected-N model `peeksafe calibrate`
      // measures to within ~10% of a real run.
      const p0 = betaQuantile(1 + s, 1 + baselineTrials - s, cfg.nullQuantile);
      const p1 = Math.max(0.005, p0 - mde);
      const rawN = sprtExpectedN(baselineRate, p0, p1, cfg.alpha, cfg.beta);
      const perCaseTypical = Number.isFinite(rawN) && rawN > 0
        ? Math.min(cfg.maxTrials, Math.max(cfg.minTrials, Math.ceil(rawN)))
        : cfg.maxTrials;
      // The ceiling above takes the cheaper of the two designs. The expected
      // bill has to be priced for the *same* design, or the cell quotes an
      // unpaired price for a plan only pairing can execute (REVIEW.md F41).
      const runsPerObs = Number.isFinite(perCase) && perCase <= pairs * 2 ? 1 : 2;
      const typicalRuns = Math.ceil(
        (m * cfg.screenRuns + Math.ceil(m * 0.1) * perCaseTypical) * runsPerObs
      );
      const typicalCostUsd = typicalRuns * cfg.costPerRunUsd;
      out.push({
        cases: m, mde, runs, costUsd, typicalRuns, typicalCostUsd,
        affordable: costUsd <= budgetUsd,
        typicallyAffordable: typicalCostUsd <= budgetUsd,
      });
    }
  }
  return out;
}
