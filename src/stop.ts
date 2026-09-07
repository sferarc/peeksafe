/**
 * stop.ts: should this case keep running?
 *
 * `gate` decides a whole suite from final counts. This decides one case, now,
 * from the counts you have so far — the loop every caller of this library ends
 * up writing, with the two ways of finishing early that are actually valid.
 *
 * ## Why there are two
 *
 * An e-value accumulates evidence *for* a regression, so a broken case reaches
 * the bar quickly and stops as `regressed`. On its own that gives you nothing
 * for a healthy case, which never accumulates evidence that it is healthy.
 *
 * The ceiling is what supplies the rest, and it is this package's own: the
 * unpaired e-value has a finite limit set by how well the baseline was
 * measured. Once that limit is under the bar, no number of further runs can
 * certify this case, and continuing spends money on an outcome that cannot
 * happen. Two different facts produce that, and they need different names:
 *
 *   `futile`   the BASELINE is too thin — an `mde`-sized drop could not be
 *              certified here however long you ran. Get more baseline runs.
 *   `settled`  the baseline is fine and the CASE is not bad enough. The counts
 *              have ruled out a certifiable regression. This is a pass, and it
 *              is the early exit a healthy case would otherwise never get.
 *
 * ## Futility is deliberately hard to trigger
 *
 * The ceiling depends on how bad the regression actually is, and early on that
 * is barely known: for a 60-run baseline the ceiling ranges from 2.9 at a rate
 * of 0.75 to 62 at a rate of 0.20. Declaring futility off a noisy point
 * estimate would abandon cases that were about to be certified — a missed
 * regression, reported as a green check, which is the exact failure this
 * library exists to prevent.
 *
 * So futility is judged at the **most pessimistic rate the data still permits**
 * (the lower end of a Wilson interval on the candidate). The question it asks
 * is "even if the truth is as bad as these counts plausibly allow, could more
 * runs ever clear the bar?" Only a no stops the case. The cost of that choice
 * is that futility fires late and rarely; the benefit is that it cannot fire on
 * a case that was going to be caught. A catastrophic regression is never
 * futile, at any sample size, which `test/stop.test.ts` pins.
 *
 * If you want to know a case is undetectable *before* spending anything, that
 * is `makePlan`'s job, and `PlanCase.baselineRunsNeeded` tells you what to do
 * about it. This is the safety net, not the plan.
 */
import { twoSampleLogE, evidenceCeilingLogE, ebhSoloThreshold, wilsonInterval } from './stats.js';
import { type BaselineStat } from './baseline.js';
import { PeeksafeError, requireCounts, requireOpenProbability } from './errors.js';
import { DEFAULT_GATE_OPTIONS } from './gate.js';

export type StopReason =
  /** certified on its own evidence: the e-value cleared `m / fdr` */
  | 'regressed'
  /**
   * The case is not regressing hard enough to ever be certified, and the data
   * is now good enough to say so. Good news, and an early exit for a healthy
   * case — which an e-value alone cannot give you.
   */
  | 'settled'
  /**
   * The baseline is too thin to certify an `mde`-sized drop at any candidate
   * budget. Nothing about this run can fix that; more baseline runs can.
   */
  | 'futile'
  /** `maxTrials` reached without a decision */
  | 'budget'
  /** keep running */
  | 'continue';

export interface StopDecision {
  stop: boolean;
  reason: StopReason;
  /** evidence so far. Larger is more evidence against the null. */
  evalue: number;
  logE: number;
  /** what this case must reach on its own evidence, whatever the others do */
  bar: number;
  /**
   * The most evidence this case could ever produce, judged at the most
   * pessimistic rate the counts still permit. Below `bar` it stops the case,
   * as `futile` when the baseline is what caps it and `settled` when the
   * case's own counts are.
   */
  ceiling: number;
  trials: number;
  /** one line saying why, suitable for a log */
  detail: string;
}

export interface StopOptions {
  /**
   * How many cases are being gated. The bar a case must clear on its own
   * evidence is `suiteSize / fdr`, so this has to be the size of the family
   * you will pass to `gate`, not the number still running.
   */
  suiteSize: number;
  /** The drop, in rate, that counts as a regression. */
  mde?: number;
  /** Target false discovery rate across the suite. */
  fdr?: number;
  /** Stop at this many trials whatever the evidence says. */
  maxTrials?: number;
  altConcentration?: number;
  /**
   * Confidence level for the pessimistic rate `futile` and `settled` are
   * judged at. Higher is
   * more conservative — futility fires later and less often. The default of
   * 0.95 is already conservative; lowering it trades a missed-regression risk
   * for runs saved, and you should have a reason.
   */
  futilityConfidence?: number;
}

export const DEFAULT_STOP_OPTIONS = {
  mde: DEFAULT_GATE_OPTIONS.mde,
  fdr: DEFAULT_GATE_OPTIONS.fdr,
  altConcentration: DEFAULT_GATE_OPTIONS.altConcentration,
  futilityConfidence: 0.95,
} as const;

/** z for a two-sided interval at the given confidence. 0.95 → 1.959964. */
const zFor = (confidence: number): number => {
  // Only the handful of levels anybody uses; anything else goes through the
  // quantile function rather than a table nobody can check.
  if (confidence === 0.95) return 1.959963984540054;
  if (confidence === 0.99) return 2.5758293035489004;
  if (confidence === 0.9) return 1.6448536269514722;
  throw new PeeksafeError('PEEKSAFE_E_CONFIG', `shouldStop: futilityConfidence must be one of 0.9, 0.95, 0.99, got ${confidence}`, {
    detail: { futilityConfidence: confidence },
    hint: 'these are the levels with a checkable z; pass one of them or judge futility yourself with evidenceCeilingLogE',
  });
};

/**
 * Decide whether to keep running one case.
 *
 * Call it after each batch. The guarantee `gate` gives does not depend on the
 * rule you used to stop, so you may also ignore this entirely and stop on a
 * hunch.
 *
 * ```ts
 * const d = shouldStop(state, baseline[id], { suiteSize: ids.length, maxTrials: 120 });
 * if (d.stop) { state.stopped = d.reason; log.info(d.detail); }
 * ```
 */
export function shouldStop(
  observed: { successes: number; trials: number },
  baseline: BaselineStat,
  options: StopOptions
): StopDecision {
  const opts = { ...DEFAULT_STOP_OPTIONS, ...options };
  requireCounts(observed.successes, observed.trials, 'shouldStop');
  requireCounts(baseline.successes, baseline.trials, 'shouldStop.baseline');
  requireOpenProbability(opts.mde, 'mde', 'shouldStop');
  requireOpenProbability(opts.fdr, 'fdr', 'shouldStop');
  if (!Number.isInteger(opts.suiteSize) || opts.suiteSize < 1) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `shouldStop: suiteSize must be a positive integer, got ${opts.suiteSize}`, {
      detail: { suiteSize: opts.suiteSize },
      hint: 'this is the number of cases in the family you will pass to gate(), which sets the bar m / fdr',
    });
  }
  if (opts.maxTrials !== undefined && (!Number.isInteger(opts.maxTrials) || opts.maxTrials < 1)) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `shouldStop: maxTrials must be a positive integer, got ${opts.maxTrials}`, {
      detail: { maxTrials: opts.maxTrials },
    });
  }
  if (baseline.trials === 0) {
    throw new PeeksafeError('PEEKSAFE_E_BASELINE_MISSING', 'shouldStop: this case has no baseline, so there is nothing to test against', {
      detail: { trials: observed.trials },
      hint: 'a case with no baseline is not gated at all — gate() returns it in newCases; do not run it against an invented null',
    });
  }

  const bar = ebhSoloThreshold(opts.suiteSize, opts.fdr);
  const logBar = Math.log(bar);

  const logE = twoSampleLogE(
    observed.successes, observed.trials, baseline.successes, baseline.trials, opts.mde, opts.altConcentration
  );
  const evalue = Math.exp(logE);

  // The most pessimistic rate the counts still permit. With no trials the
  // Wilson interval is the whole line, so `low` is 0, the ceiling is enormous,
  // and futility cannot fire before there is data. That is the intended
  // behaviour: futility is a statement about evidence, not about intentions.
  const low = observed.trials === 0 ? 0 : wilsonInterval(observed.successes, observed.trials, zFor(opts.futilityConfidence)).low;
  const pessimistic = Math.max(1e-6, Math.min(1 - 1e-6, low));
  const ceilingLog = evidenceCeilingLogE(
    pessimistic, baseline.successes, baseline.trials, opts.mde, opts.altConcentration
  );
  const ceiling = Math.exp(ceilingLog);

  const base = { evalue, logE, bar, ceiling, trials: observed.trials };

  if (logE >= logBar) {
    return {
      ...base, stop: true, reason: 'regressed',
      detail: `certified: e=${evalue.toExponential(2)} cleared the bar of ${bar} after ${observed.trials} trials`,
    };
  }
  if (ceilingLog < logBar) {
    // Two very different facts wear the same shape here, and an operator needs
    // to be told which one. Ask the baseline-only question: could an
    // *mde*-sized drop be certified against this baseline at all? If not, the
    // baseline is the problem and no run of any length fixes it. If it could,
    // then the baseline is fine and what stopped this case is that its own
    // counts are not bad enough — which is a pass, not a defect.
    const bRate = baseline.successes / baseline.trials;
    const pAlt = Math.max(1e-6, Math.min(1 - 1e-6, bRate - opts.mde));
    const baselineLimited =
      evidenceCeilingLogE(pAlt, baseline.successes, baseline.trials, opts.mde, opts.altConcentration) < logBar;

    return baselineLimited
      ? {
          ...base, stop: true, reason: 'futile',
          detail:
            `futile: a ${(opts.mde * 100).toFixed(0)}pt drop could not be certified against a baseline of ` +
            `${baseline.trials} runs at any candidate budget (ceiling ${ceiling.toExponential(2)}, bar ${bar}). ` +
            `More baseline runs, not more candidate runs.`,
        }
      : {
          ...base, stop: true, reason: 'settled',
          detail:
            `settled: even at a rate of ${pessimistic.toFixed(3)}, the worst these counts still permit, this case ` +
            `could only reach ${ceiling.toExponential(2)} against a bar of ${bar}. It is not regressing enough to ` +
            `be certified, so further runs cannot change the verdict.`,
        };
  }
  if (opts.maxTrials !== undefined && observed.trials >= opts.maxTrials) {
    return {
      ...base, stop: true, reason: 'budget',
      detail: `budget: ${observed.trials} trials reached with e=${evalue.toExponential(2)}, short of the bar of ${bar}`,
    };
  }
  return {
    ...base, stop: false, reason: 'continue',
    detail: `continue: e=${evalue.toExponential(2)} of a required ${bar}, ceiling ${ceiling.toExponential(2)}`,
  };
}
