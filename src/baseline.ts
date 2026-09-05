/**
 * baseline.ts: what a case's reference revision did, and the null it implies.
 *
 * peeksafe never runs anything. A caller brings counts, and these are the shapes
 * those counts arrive in.
 *
 * The distinction that matters is between a baseline that says "this case passed
 * 51 of 60 times" and no baseline at all. The prototype this library came from
 * treated a missing baseline as `0/60`, whose Beta(1,1) posterior median is 0.5,
 * and cheerfully gated against a null of "this case passes half the time". It
 * reported a verdict of PASS and a suite improvement of +87.5 points, measured
 * against nothing. Every entry point here therefore takes `BaselineStat |
 * undefined` explicitly and refuses to invent one.
 */
import { betaQuantile } from './stats.js';
import { requireCounts, requireOpenProbability } from './errors.js';

/** One case's recorded reference performance. */
export interface BaselineStat {
  caseId: string;
  successes: number;
  trials: number;
}

/**
 * The minimum a case has to declare to be planned or gated. `suite` groups
 * cases into families for the cluster-robust suite summary; leave it undefined
 * and every case is its own family.
 */
export interface CaseRef {
  id: string;
  suite?: string;
}

/**
 * The rate the null is tested at.
 *
 * Not `successes / trials`. A 60-run baseline at a true rate of 0.85 has a
 * standard error of 0.046, which is a third of a 15-point effect, so testing
 * against the point estimate treats a noisy number as an oracle. When the
 * baseline happens to have come in high, every candidate looks worse than it is.
 * Taking a low quantile of the baseline's own posterior instead is what stops
 * that, at the cost of some power.
 *
 * `q` is that quantile. Lower is more conservative.
 */
export function baselineNullRate(b: BaselineStat, q = 0.25): number {
  requireCounts(b.successes, b.trials, 'baselineNullRate');
  requireOpenProbability(q, 'q', 'baselineNullRate');
  return betaQuantile(1 + b.successes, 1 + b.trials - b.successes, q);
}

/** Index a list of baselines by case id, rejecting duplicates rather than merging them. */
export function toBaselineMap(stats: readonly BaselineStat[]): Map<string, BaselineStat> {
  const m = new Map<string, BaselineStat>();
  for (const b of stats) {
    if (m.has(b.caseId)) {
      throw new Error(`toBaselineMap: duplicate baseline for case ${b.caseId}`);
    }
    requireCounts(b.successes, b.trials, `toBaselineMap(${b.caseId})`);
    m.set(b.caseId, b);
  }
  return m;
}
