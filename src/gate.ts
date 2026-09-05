/**
 * gate.ts: the decision.
 *
 * You bring counts. This decides which cases regressed, at a false discovery
 * rate you name, in a way that stays valid however many times you looked at the
 * data on the way here.
 *
 * ## Why this is safe to peek at
 *
 * The usual construction is: run the suite, stop a case when it looks
 * significant, compute a p-value from the counts, hand the p-values to
 * Benjamini-Hochberg. That is invalid in two independent places.
 *
 * A p-value computed at a stopping boundary is not a p-value. `P(p_n <= a) <= a`
 * holds for each fixed `n`; a procedure that adds runs and re-tests until the
 * result looks significant reports `min` over the peeks, and that minimum is not
 * bounded by `a`. Benjamini-Hochberg takes `P(p <= t) <= t` as its input
 * assumption, so it inherits nothing and controls nothing.
 *
 * This module never computes a p-value. It computes an e-value, which is a
 * non-negative statistic with mean at most 1 under the null. Ville's inequality
 * bounds `P(sup_n E_n >= 1/a) <= a` over the whole trajectory, so an e-value is
 * valid at any stopping time, including one chosen after looking. The
 * multiplicity correction is e-BH (Wang and Ramdas), which takes e-values
 * directly and controls FDR under arbitrary dependence between cases.
 *
 * The practical consequence: you may stop a case whenever you like, for any
 * reason, including "it already looks bad". Nothing here cares when you stopped.
 *
 * ## What it will refuse to do
 *
 * Gate a case with no baseline. There is no null to test against, and the
 * failure mode of inventing one is not a wrong number, it is a confident wrong
 * number: a missing baseline read as `0/0` has a Beta(1,1) posterior median of
 * 0.5, which gates the case against "it passes half the time" and reports a
 * large improvement against nothing at all. Cases without a baseline come back
 * in `newCases` and take no part in the verdict or the e-BH family.
 */
import { twoSampleLogE, ebhCorrect, ebhSoloThreshold, evidenceCeilingLogE } from './stats.js';
import { type BaselineStat } from './baseline.js';
import { PeeksafeError, requireCounts, requireOpenProbability } from './errors.js';

/** One case's candidate result, and the baseline it is measured against. */
export interface GateCase {
  id: string;
  /** Successes observed for the revision under test. */
  successes: number;
  /** Trials run for the revision under test. Stop whenever you like. */
  trials: number;
  /** The reference revision's recorded counts, or undefined if there are none. */
  baseline?: BaselineStat;
}

export interface GateOptions {
  /** Minimum detectable effect: the drop, in rate, that counts as a regression. */
  mde?: number;
  /** Target false discovery rate across the suite. */
  fdr?: number;
  /**
   * Concentration of the alternative prior. Lower spreads the alternative over
   * "anything materially worse", which is closer to how a broken case behaves
   * than a point mass exactly `mde` below the baseline.
   */
  altConcentration?: number;
}

export const DEFAULT_GATE_OPTIONS = {
  mde: 0.15,
  fdr: 0.05,
  altConcentration: 8,
} as const;

export interface CaseVerdict {
  id: string;
  /** True when e-BH certifies this case as regressed at the suite's FDR. */
  regressed: boolean;
  /** The e-value. Larger is more evidence against the null. */
  evalue: number;
  /** log of the above, which is what the arithmetic actually uses. */
  logE: number;
  /**
   * The largest e-value this case could ever reach against its current
   * baseline, however many candidate runs you add. When this is below
   * `threshold`, the case is undetectable at any candidate budget and the only
   * remedy is more baseline runs.
   */
  ceiling: number;
  /** True when `ceiling` is below the bar the case has to clear. */
  undetectable: boolean;
  observed: { successes: number; trials: number };
  baseline: { successes: number; trials: number };
}

export interface GateResult {
  /** PASS when nothing was certified as regressed. */
  verdict: 'PASS' | 'FAIL';
  cases: CaseVerdict[];
  /** Cases certified as regressed, in the order given. */
  regressed: CaseVerdict[];
  /**
   * Cases with no baseline. These are reported, not gated: they have no null to
   * be tested against and they are excluded from the e-BH family.
   */
  newCases: string[];
  /** The e-value a case had to beat, given how many discoveries were made. */
  threshold: number;
  /** The e-value a case must reach to be certified whatever the others do. */
  soloThreshold: number;
  options: Required<GateOptions>;
}

/**
 * Decide which cases regressed.
 *
 * Valid at any stopping time. Run every case to a fixed count, or stop each one
 * the moment it looks decided, or anything in between; the guarantee does not
 * depend on the rule you used.
 */
export function gate(cases: readonly GateCase[], options: GateOptions = {}): GateResult {
  const opts: Required<GateOptions> = { ...DEFAULT_GATE_OPTIONS, ...options };
  requireOpenProbability(opts.mde, 'mde', 'gate');
  requireOpenProbability(opts.fdr, 'fdr', 'gate');
  if (!Number.isFinite(opts.altConcentration) || opts.altConcentration <= 0) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `gate: altConcentration must be positive, got ${opts.altConcentration}`, {
      detail: { altConcentration: opts.altConcentration },
    });
  }

  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) {
      throw new PeeksafeError('PEEKSAFE_E_CASE_DUPLICATE', `gate: duplicate case id ${c.id}`, {
        detail: { id: c.id },
        hint: 'two cases sharing an id would be merged into one baseline entry and counted once',
      });
    }
    seen.add(c.id);
    requireCounts(c.successes, c.trials, `gate(${c.id})`);
    if (c.baseline) requireCounts(c.baseline.successes, c.baseline.trials, `gate(${c.id}).baseline`);
  }

  const newCases = cases.filter((c) => !c.baseline || c.baseline.trials === 0).map((c) => c.id);
  const gated = cases.filter((c) => c.baseline && c.baseline.trials > 0);

  if (gated.length === 0) {
    throw new PeeksafeError('PEEKSAFE_E_BASELINE_MISSING', 'gate: no case has a baseline, so there is nothing to test against', {
      detail: { cases: cases.length, newCases: newCases.length },
      hint: 'record a baseline on the reference revision first; gating without one compares against a Beta(1,1) prior, which reads as "this case passes half the time"',
    });
  }

  const m = gated.length;
  const logEs = gated.map((c) =>
    twoSampleLogE(c.successes, c.trials, c.baseline!.successes, c.baseline!.trials, opts.mde, opts.altConcentration)
  );
  // e-BH ranks on the e-value, and exp() of a large logE overflows to Infinity,
  // which ebhCorrect rejects because an infinite entry corrupts the ranking.
  // Clamping at the largest finite double preserves the order and the decision.
  const evalues = logEs.map((l) => (Number.isFinite(Math.exp(l)) ? Math.exp(l) : Number.MAX_VALUE));
  const ebh = ebhCorrect(evalues, opts.fdr);
  const solo = ebhSoloThreshold(m, opts.fdr);

  const verdicts: CaseVerdict[] = gated.map((c, i) => {
    // The ceiling is evaluated at the rate a regression would actually sit at,
    // one MDE below the baseline's own rate. That is the alternative the gate is
    // trying to detect, so it is the right place to ask "could this ever clear
    // the bar". Matches how plan.ts prices the same case.
    const bRate = c.baseline!.successes / c.baseline!.trials;
    const pAlt = Math.max(1e-6, Math.min(1 - 1e-6, bRate - opts.mde));
    const ceilingLog = evidenceCeilingLogE(
      pAlt, c.baseline!.successes, c.baseline!.trials, opts.mde, opts.altConcentration
    );
    const ceiling = Math.exp(ceilingLog);
    return {
      id: c.id,
      regressed: ebh.rejected[i]!,
      evalue: evalues[i]!,
      logE: logEs[i]!,
      ceiling,
      undetectable: ceiling < solo,
      observed: { successes: c.successes, trials: c.trials },
      baseline: { successes: c.baseline!.successes, trials: c.baseline!.trials },
    };
  });

  const regressed = verdicts.filter((v) => v.regressed);

  return {
    verdict: regressed.length === 0 ? 'PASS' : 'FAIL',
    cases: verdicts,
    regressed,
    newCases,
    threshold: ebh.threshold,
    soloThreshold: solo,
    options: opts,
  };
}
