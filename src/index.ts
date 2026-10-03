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

export {
  type BaselineStat,
  baselineNullRate,
  type CaseRef,
  toBaselineMap,
} from "./baseline.js";
export {
  type CertifyProbabilityOptions,
  certifyProbability,
  type PairedCertifyProbabilityOptions,
  pairedCertifyProbability,
  type TypeOneErrorOptions,
  typeOneError,
} from "./check.js";
export {
  type ClusteredEffect,
  type ClusteredMean,
  type ClusterKeyDiagnostic,
  type ClusterObservation,
  caseFamily,
  clusteredEffect,
  clusterKey,
  clusterKeyDiagnostic,
  clusterRobustMean,
  compareEstimators,
  type FamilyEffect,
  type GroupingSummary,
  groupByCluster,
  iidMean,
  MIN_TRUSTWORTHY_CLUSTERS,
  type RandomEffectsMean,
  randomEffectsMean,
} from "./cluster.js";
/* ── errors and determinism ──────────────────────────────────────────────── */
export {
  PeeksafeError,
  type PeeksafeErrorCode,
  type PeeksafeErrorOptions,
} from "./errors.js";
export type { Evidence } from "./evidence.js";
export {
  computeFrontier,
  costShares,
  DEFAULT_AXES,
  DEFAULT_FRONTIER,
  enumerateFrontier,
  evaluatePoint,
  type FrontierAxes,
  type FrontierBasis,
  type FrontierCell,
  type FrontierConfig,
  type FrontierCost,
  type FrontierDesign,
  type FrontierPoint,
  type FrontierResult,
  type FrontierScreen,
  fmtRate,
  typicalObservationsPerCase,
} from "./frontier.js";
/* ── 1. the decision ─────────────────────────────────────────────────────── */
export {
  type CaseVerdict,
  DEFAULT_GATE_OPTIONS,
  type GateCase,
  type GateOptions,
  type GateResult,
  gate,
  type PairedGateCase,
} from "./gate.js";
/* ── 2. the budget ───────────────────────────────────────────────────────── */
export {
  type AffordabilityCell,
  affordabilityGrid,
  DEFAULT_PLAN,
  type Detectability,
  expectedSequentialSamples,
  makePlan,
  type Plan,
  type PlanCase,
  type PlanConfig,
  type PlanTotals,
  planCase,
} from "./plan.js";
export { hash32, makeRand, type Rand, streamFor } from "./rand.js";
/* ── 3. the statistics ───────────────────────────────────────────────────── */
export {
  type BetaPosterior,
  type BhResult,
  bernoulliEntropy,
  betaCredibleInterval,
  betaMassBetween,
  betaPosterior,
  betaQuantile,
  /* multiplicity */
  bhCorrect,
  cohensH,
  diffInterval,
  discordant,
  type EbhResult,
  ebhCorrect,
  ebhSoloThreshold,
  erf,
  evidenceCeilingAsymptotic,
  evidenceCeilingLogE,
  evidenceCeilingSlope,
  expectedLogE,
  expectedLogEExact,
  fisherExact2x2,
  gammaP,
  type Interval,
  ibeta,
  logBeta,
  logBetaPdf,
  /* special functions */
  logGamma,
  /* e-values */
  logMarginalBetaBinomial,
  mcnemarSamplesForEvidence,
  normalCdf,
  normalQuantile,
  type PairedCounts,
  pairedDiscordance,
  /* paired designs */
  pairedLogE,
  pairPhi,
  probabilityMoved,
  type SprtDecision,
  type SprtOpts,
  type SprtResult,
  /* power */
  sampleSizeTwoProportion,
  samplesForEvidence,
  /* sequential */
  sprtDecision,
  sprtExpectedN,
  type TestResult,
  /* fixed-sample tests, for comparison rather than for gating */
  twoProportionZTest,
  twoSampleLogE,
  twoSamplePriors,
  universalCeilingLogE,
  universalTwoSampleLogE,
  /* intervals and posteriors */
  wilsonInterval,
} from "./stats.js";
export {
  DEFAULT_STOP_OPTIONS,
  type PairedStopDecision,
  type PairedStopOptions,
  type PairedStopReason,
  type StopDecision,
  type StopOptions,
  type StopReason,
  shouldStop,
  shouldStopPaired,
} from "./stop.js";
