/**
 * peeksafe: statistically valid gates for non-deterministic eval suites.
 *
 * The problem this exists for: you run an eval suite, watch results arrive, stop
 * a case when it looks decided, then correct for multiplicity with
 * Benjamini-Hochberg. That construction has no error control. A p-value computed
 * at a stopping boundary is not a p-value, and BH assumes it is.
 *
 * The library is organised in three layers, and most callers only need the first.
 *
 * ## 1. The decision
 *
 *   gate(cases, options)   which cases regressed, valid at any stopping time
 *
 * You bring counts. It brings e-values and e-BH. Nothing here knows or cares how
 * you ran the evals, and nothing here will gate a case that has no baseline.
 *
 * ## 2. The budget
 *
 *   makePlan(...)          how many runs each case needs, and which are impossible
 *   computeFrontier(...)   what is certifiable inside a budget
 *   affordabilityGrid(...) the same question as a grid over two axes
 *
 * These answer "how many runs do I need" before you spend anything, including
 * the case where the honest answer is that no candidate budget will do and only
 * more baseline runs will.
 *
 * ## 3. The statistics
 *
 * Everything the first two layers are built from, exported so a caller can check
 * the arithmetic, build a different gate, or use one piece on its own: special
 * functions, intervals, the SPRT, e-values, e-BH, power, paired designs, and the
 * cluster-robust suite summary.
 *
 * Cases in a suite are not independent draws. Several cases generated from one
 * source file share a failure mode, so a change that breaks the file moves all
 * of them together. `clusteredEffect` and the rest of `cluster` are what stop
 * the suite-level interval from being too narrow for that reason.
 */

/* ── 1. the decision ─────────────────────────────────────────────────────── */
export {
  gate,
  DEFAULT_GATE_OPTIONS,
  type GateCase,
  type GateOptions,
  type GateResult,
  type CaseVerdict,
} from './gate.js';

export {
  baselineNullRate,
  toBaselineMap,
  type BaselineStat,
  type CaseRef,
} from './baseline.js';

/* ── 2. the budget ───────────────────────────────────────────────────────── */
export {
  makePlan,
  planCase,
  expectedSequentialSamples,
  affordabilityGrid,
  DEFAULT_PLAN,
  type PlanConfig,
  type Plan,
  type PlanCase,
  type PlanTotals,
  type Detectability,
  type AffordabilityCell,
} from './plan.js';

export {
  computeFrontier,
  enumerateFrontier,
  evaluatePoint,
  typicalObservationsPerCase,
  costShares,
  fmtRate,
  DEFAULT_FRONTIER,
  DEFAULT_AXES,
  type FrontierConfig,
  type FrontierResult,
  type FrontierPoint,
  type FrontierCell,
  type FrontierCost,
  type FrontierDesign,
  type FrontierScreen,
  type FrontierBasis,
  type FrontierAxes,
} from './frontier.js';

/* ── 3. the statistics ───────────────────────────────────────────────────── */
export {
  /* special functions */
  logGamma, logBeta, gammaP, erf, normalCdf, normalQuantile, ibeta,
  /* intervals and posteriors */
  wilsonInterval, betaPosterior, betaQuantile, betaCredibleInterval, betaMassBetween,
  diffInterval, cohensH,
  type Interval, type BetaPosterior,
  /* fixed-sample tests, for comparison rather than for gating */
  twoProportionZTest, fisherExact2x2, type TestResult,
  /* sequential */
  sprtDecision, sprtExpectedN, type SprtDecision, type SprtResult, type SprtOpts,
  /* multiplicity */
  bhCorrect, ebhCorrect, ebhSoloThreshold, type BhResult, type EbhResult,
  /* e-values */
  logMarginalBetaBinomial, twoSampleLogE, twoSamplePriors, logBetaPdf,
  evidenceCeilingLogE, evidenceCeilingSlope, evidenceCeilingAsymptotic,
  expectedLogE, expectedLogEExact, samplesForEvidence,
  /* paired designs */
  pairedLogE, pairedDiscordance, mcnemarSamplesForEvidence, discordant, pairPhi,
  probabilityMoved, type PairedCounts,
  /* power */
  sampleSizeTwoProportion, bernoulliEntropy,
} from './stats.js';

export {
  caseFamily, clusterKey, groupByCluster,
  iidMean, clusterRobustMean, randomEffectsMean, clusteredEffect,
  compareEstimators, clusterKeyDiagnostic, MIN_TRUSTWORTHY_CLUSTERS,
  type ClusterObservation, type ClusteredMean, type RandomEffectsMean,
  type FamilyEffect, type ClusteredEffect, type GroupingSummary,
  type ClusterKeyDiagnostic,
} from './cluster.js';

/* ── errors and determinism ──────────────────────────────────────────────── */
export {
  PeeksafeError,
  type PeeksafeErrorCode,
  type PeeksafeErrorOptions,
} from './errors.js';

export { makeRand, streamFor, hash32, type Rand } from './rand.js';
